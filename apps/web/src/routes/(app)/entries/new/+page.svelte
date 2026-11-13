<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import ReceiptBreakdown from '$lib/ui/ReceiptBreakdown.svelte';
  import DuplicateWarning from '$lib/ui/DuplicateWarning.svelte';
  import { resolveEffectiveRateProfile, getMaxKnownRateVersion } from '$lib/db/rates';
  import { saveLocalEntry, checkDuplicate } from '$lib/db/entries';
  import { db, type CachedPaymentMethod, type CachedRateProfile } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { calculateEntry, DeductionsExceedGrossError, mulBp, type RateSnapshot } from '@clt/calc';
  import { parseBdtToPoisha, formatPoishaToBdt } from '@clt/shared';

  // Form State initialized to Asia/Dhaka current date (PRD §8.1)
  let entryDate = $state(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()),
  );
  let customerName = $state('');
  let subQty = $state(1);
  let subDescription = $state('');
  let grossInput = $state('');
  let selectedMethodId = $state<string>(''); // Method UUID
  let txnRef = $state('');
  let manualVatInput = $state('');
  let isVatOverridden = $state(false);
  let vatOverrideMode = $state<'amount' | 'percent'>('amount');
  let vatOverrideAmountInput = $state('');
  let vatOverridePercentInput = $state('');
  let vatOverrideReason = $state('Counter override');
  let notes = $state('');

  // Operational State
  let methods = $state<CachedPaymentMethod[]>([]);
  let activeProfile = $state<CachedRateProfile | null>(null);
  let latestRateVersion = $state<number>(1);
  let isSaving = $state(false);
  let duplicateVisible = $state(false);
  let isMonthClosed = $state(false);
  let saveSuccessMessage = $state('');
  let saveErrorMessage = $state('');
  let txnRefError = $state('');

  // Supersede Mode State (S07)
  let supersedingOriginalId = $state<string | null>(null);
  let supersedingOriginalBadge = $state<string | null>(null);
  let requireExplicitMethodSelection = $state(false);
  let unavailableSupersedeMethodWarning = $state('');

  // Computed selected method record
  let currentMethod = $derived(methods.find((m) => m.id === selectedMethodId));
  let requiresTxnRef = $derived(currentMethod?.requires_txn_ref ?? false);

  // CLT-R-026: only offer methods the active profile can price. Offering a
  // cached method the profile has no rate for makes an unpriceable chip the
  // default selection and leaves Save disabled behind "Selected payment method
  // is not configured in the active rate profile".
  let selectableMethods = $derived(
    activeProfile
      ? methods.filter((m) => activeProfile!.method_rates[m.id] !== undefined)
      : methods,
  );

  // Keep the selection on a priceable method, adopting the first configured one
  // when the previous default was stale or is not configured for this date.
  // Never overwrite explicit selection requirement when superseding an entry
  // whose original payment method is no longer available.
  $effect(() => {
    if (requireExplicitMethodSelection) return;
    const available = selectableMethods;
    if (available.length > 0 && !available.some((m) => m.id === selectedMethodId)) {
      selectedMethodId = available[0].id;
    }
  });

  // Historical Rate Difference Notice
  let hasRateDeviation = $derived(
    activeProfile !== null && activeProfile.version !== latestRateVersion,
  );

  async function loadInitialContext() {
    // 1. Load active payment methods with memory filter to avoid IndexedDB boolean key bugs
    const allMethods = await db.methods.orderBy('display_order').toArray();
    methods = allMethods.filter((m) => m.active);

    const supersedeId =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('supersede')
        : null;

    if (!supersedeId && methods.length > 0 && !selectedMethodId) {
      selectedMethodId = methods[0].id;
    }

    // 2. Resolve latest watermark version
    latestRateVersion = await getMaxKnownRateVersion();

    // 3. Resolve profile for selected date
    await updateProfileForDate();

    // 4. Check for ?supersede=<id> query parameter
    if (supersedeId) {
      const orig = await db.entries.get(supersedeId);
      if (orig && orig.status === 'active') {
        supersedingOriginalId = orig.id;
        supersedingOriginalBadge = orig.local_id || orig.id.substring(0, 8);
        entryDate = orig.entry_date;
        customerName = orig.customer_name;
        subQty = Math.max(1, orig.sub_qty);
        subDescription = orig.sub_description ?? '';

        // Pure integer derivation without floating point conversions (Rule 2)
        const gp = BigInt(orig.gross_poisha);
        const gTaka = gp / 100n;
        const gRem = gp % 100n;
        grossInput = `${gTaka.toString()}.${gRem.toString().padStart(2, '0')}`;

        const vatSource = orig.vat_input_poisha ?? orig.vat_poisha;
        if (vatSource && BigInt(vatSource) > 0n) {
          const vp = BigInt(vatSource);
          const vTaka = vp / 100n;
          const vRem = vp % 100n;
          manualVatInput = `${vTaka.toString()}.${vRem.toString().padStart(2, '0')}`;
        }

        if (orig.vat_override_poisha && BigInt(orig.vat_override_poisha) > 0n) {
          isVatOverridden = true;
          vatOverrideMode = 'amount';
          const vp = BigInt(orig.vat_override_poisha);
          const vTaka = vp / 100n;
          const vRem = vp % 100n;
          vatOverrideAmountInput = `${vTaka.toString()}.${vRem.toString().padStart(2, '0')}`;
          vatOverrideReason = orig.vat_override_reason ?? 'Counter override';
        }

        txnRef = orig.txn_ref ?? '';
        notes = orig.notes
          ? `[Supersedes ${supersedingOriginalBadge}] ${orig.notes}`
          : `[Supersedes ${supersedingOriginalBadge}]`;
        await updateProfileForDate();

        const origMethod = allMethods.find((m) => m.id === orig.method_id);
        const isMethodActive = Boolean(origMethod && origMethod.active);
        const isMethodConfigured =
          !activeProfile || activeProfile.method_rates[orig.method_id] !== undefined;

        if (isMethodActive && isMethodConfigured) {
          selectedMethodId = orig.method_id;
          requireExplicitMethodSelection = false;
          unavailableSupersedeMethodWarning = '';
        } else {
          const methodLabel = origMethod?.name ?? orig.method_id;
          requireExplicitMethodSelection = true;
          selectedMethodId = '';
          unavailableSupersedeMethodWarning = !isMethodActive
            ? `Original payment method "${methodLabel}" is no longer active. Please pick an active replacement payment method before saving.`
            : `Original payment method "${methodLabel}" is not configured for ${orig.entry_date}. Please pick an active replacement payment method before saving.`;
        }
      } else if (orig && orig.status !== 'active') {
        saveErrorMessage = 'Cannot supersede transaction that is already voided or superseded.';
      }
    }
  }

  async function updateProfileForDate() {
    if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return;

    activeProfile = await resolveEffectiveRateProfile(entryDate);

    // Verify month closed status
    const monthPrefix = entryDate.slice(0, 7) + '-01';
    const closeRow = await db.monthCloses.get(monthPrefix);
    isMonthClosed = closeRow?.status === 'closed';

    await triggerDuplicateCheck();
  }

  // Pure derived Gross input validation (no state mutation inside derived)
  let grossInputError = $derived.by(() => {
    if (!grossInput.trim()) return '';
    if (grossInput.includes('.') && grossInput.split('.')[1].length > 2) {
      return 'Maximum 2 decimal digits allowed.';
    }
    try {
      parseBdtToPoisha(grossInput);
      return '';
    } catch {
      return 'Invalid amount format.';
    }
  });

  let grossPoisha = $derived.by(() => {
    if (!grossInput.trim() || !!grossInputError) return 0n;
    try {
      return parseBdtToPoisha(grossInput);
    } catch {
      return 0n;
    }
  });

  let manualVatPoisha = $derived.by(() => {
    if (!manualVatInput.trim()) return 0n;
    try {
      return parseBdtToPoisha(manualVatInput);
    } catch {
      return 0n;
    }
  });

  let vatOverrideError = $derived.by(() => {
    if (!isVatOverridden || activeProfile?.vat_mode === 'manual') return '';
    if (vatOverrideMode === 'amount') {
      if (!vatOverrideAmountInput.trim()) return '';
      if (vatOverrideAmountInput.includes('.') && vatOverrideAmountInput.split('.')[1].length > 2) {
        return 'Maximum 2 decimal digits allowed for VAT amount.';
      }
      try {
        const p = parseBdtToPoisha(vatOverrideAmountInput);
        if (p < 0n) return 'VAT amount cannot be negative.';
        if (grossPoisha > 0n && p > grossPoisha) return 'VAT override cannot exceed gross amount.';
        return '';
      } catch {
        return 'Invalid VAT amount format.';
      }
    } else {
      if (!vatOverridePercentInput.trim()) return '';
      const num = Number(vatOverridePercentInput);
      if (isNaN(num) || num < 0) return 'Invalid VAT percentage.';
      if (num > 100) return 'VAT percentage cannot exceed 100%.';
      return '';
    }
  });

  let vatOverridePoisha = $derived.by(() => {
    if (!isVatOverridden || activeProfile?.vat_mode === 'manual' || !!vatOverrideError) {
      return undefined;
    }
    if (vatOverrideMode === 'amount') {
      if (!vatOverrideAmountInput.trim()) return undefined;
      try {
        return parseBdtToPoisha(vatOverrideAmountInput);
      } catch {
        return undefined;
      }
    } else {
      if (!vatOverridePercentInput.trim()) return undefined;
      const num = Number(vatOverridePercentInput);
      if (isNaN(num) || num < 0 || num > 100) return undefined;
      const bp = Math.round(num * 100);
      return mulBp(grossPoisha, bp);
    }
  });

  // Pure derived Authoritative Calculation via packages/calc (Rule 3)
  let calculationState = $derived.by(() => {
    if (!activeProfile || !selectedMethodId || grossPoisha <= 0n) {
      return {
        grossPoisha: 0n,
        vatPoisha: 0n,
        commissionPoisha: 0n,
        chargePoisha: 0n,
        businessChargePoisha: 0n,
        customerChargePoisha: 0n,
        netAfterDeductionsPoisha: 0n,
        error: '',
      };
    }

    const methodRate = activeProfile.method_rates[selectedMethodId];
    if (!methodRate) {
      return {
        grossPoisha,
        vatPoisha: 0n,
        commissionPoisha: 0n,
        chargePoisha: 0n,
        businessChargePoisha: 0n,
        customerChargePoisha: 0n,
        netAfterDeductionsPoisha: 0n,
        error: 'Selected payment method is not configured in the active rate profile.',
      };
    }

    const snapshot: RateSnapshot = {
      rateProfileId: activeProfile.id,
      version: activeProfile.version,
      engineVersion: 1,
      vat: {
        mode: activeProfile.vat_mode,
        bp: activeProfile.vat_bp ?? 0,
      },
      commission: {
        bp: activeProfile.commission_bp,
        base: activeProfile.commission_base,
      },
      chargeBp: methodRate.fee_bp,
      chargesBorneBy: methodRate.charges_borne_by,
      rounding: 'half_up',
    };

    const isOverrideActive =
      activeProfile.vat_mode !== 'manual' && isVatOverridden && vatOverridePoisha !== undefined;

    try {
      const res = calculateEntry({
        grossPoisha,
        snapshot,
        vatInputPoisha: activeProfile.vat_mode === 'manual' ? manualVatPoisha : undefined,
        vatOverridePoisha: isOverrideActive ? vatOverridePoisha : undefined,
        vatOverrideReason: isOverrideActive
          ? vatOverrideReason.trim() || 'Counter override'
          : undefined,
      });
      return { ...res, error: '' };
    } catch (e) {
      const msg =
        e instanceof DeductionsExceedGrossError
          ? 'Total deductions (VAT + Commission + Provider Fee) exceed gross collected. Net cannot be negative.'
          : e instanceof Error
            ? e.message
            : 'Calculation error';
      return {
        grossPoisha,
        vatPoisha: 0n,
        commissionPoisha: 0n,
        chargePoisha: 0n,
        businessChargePoisha: 0n,
        customerChargePoisha: 0n,
        netAfterDeductionsPoisha: 0n,
        error: msg,
      };
    }
  });

  let calculated = $derived(calculationState);
  let calculationError = $derived(calculationState.error);

  async function triggerDuplicateCheck() {
    if (customerName.trim() && grossPoisha > 0n && selectedMethodId) {
      duplicateVisible = await checkDuplicate({
        entryDate,
        methodId: selectedMethodId,
        txnRef: txnRef.trim() || undefined,
        customerName: customerName.trim(),
        grossPoisha,
        excludeEntryId: supersedingOriginalId ?? undefined,
      });
    } else {
      duplicateVisible = false;
    }
  }

  async function handleLocalSave(e: SubmitEvent) {
    e.preventDefault();
    saveErrorMessage = '';
    txnRefError = '';

    if (!session.user) {
      saveErrorMessage = 'User session is not available. Please log in.';
      return;
    }
    if (!activeProfile) {
      saveErrorMessage = 'No active rate profile found for this date. Cannot record transaction.';
      return;
    }
    if (!selectedMethodId) {
      saveErrorMessage = 'Please select a payment method.';
      return;
    }
    if (!customerName.trim()) {
      saveErrorMessage = 'Customer name is required.';
      return;
    }
    if (
      grossPoisha <= 0n ||
      isMonthClosed ||
      !!calculationError ||
      !!grossInputError ||
      !!vatOverrideError
    ) {
      return;
    }
    if (requiresTxnRef && !txnRef.trim()) {
      // Rendered next to the field: the channel name is the part a staff member
      // needs, and the browser's own bubble cannot say which channel it means.
      txnRefError = `Enter the ${currentMethod?.name ?? 'payment channel'} transaction reference before saving.`;
      document.getElementById('input-txn-ref')?.focus();
      return;
    }

    const methodRate = activeProfile.method_rates[selectedMethodId];
    if (!methodRate) {
      saveErrorMessage = 'Selected payment method rate configuration is missing.';
      return;
    }

    isSaving = true;
    saveSuccessMessage = '';
    const normalizedTxnRef = txnRef.trim() ? txnRef.trim().toUpperCase() : undefined;

    const completeSnapshot: RateSnapshot = {
      rateProfileId: activeProfile.id,
      version: activeProfile.version,
      engineVersion: 1,
      vat: {
        mode: activeProfile.vat_mode,
        bp: activeProfile.vat_bp ?? 0,
      },
      commission: {
        bp: activeProfile.commission_bp,
        base: activeProfile.commission_base,
      },
      chargeBp: methodRate.fee_bp,
      chargesBorneBy: methodRate.charges_borne_by,
      rounding: 'half_up',
    };

    try {
      const saved = await saveLocalEntry({
        entryDate,
        customerName: customerName.trim(),
        centerId: session.user?.centerId ?? undefined,
        subQty: Math.max(1, subQty),
        subDescription: subDescription.trim() || undefined,
        methodId: selectedMethodId,
        grossPoisha,
        vatPoisha: calculated.vatPoisha,
        commissionPoisha: calculated.commissionPoisha,
        businessChargePoisha: calculated.businessChargePoisha,
        customerChargePoisha: calculated.customerChargePoisha,
        netPoisha: calculated.netAfterDeductionsPoisha,
        snapshot: completeSnapshot,
        vatInputPoisha: activeProfile.vat_mode === 'manual' ? manualVatPoisha : undefined,
        vatOverridePoisha:
          activeProfile.vat_mode !== 'manual' && isVatOverridden ? vatOverridePoisha : undefined,
        vatOverrideReason:
          activeProfile.vat_mode !== 'manual' && isVatOverridden
            ? (vatOverrideReason.trim() || 'Counter override')
            : undefined,
        txnRef: normalizedTxnRef,
        notes: notes.trim() || undefined,
        rateProfileId: activeProfile.id,
        userId: session.user.id,
        supersedesOriginalId: supersedingOriginalId ?? undefined,
      });

      saveSuccessMessage = `Saved offline as ${saved.local_id} — pending background sync.`;

      // Reset form fields
      customerName = '';
      grossInput = '';
      txnRef = '';
      txnRefError = '';
      manualVatInput = '';
      isVatOverridden = false;
      vatOverrideMode = 'amount';
      vatOverrideAmountInput = '';
      vatOverridePercentInput = '';
      vatOverrideReason = 'Counter override';
      notes = '';
      subDescription = '';
      subQty = 1;
      supersedingOriginalId = null;
      supersedingOriginalBadge = null;
      requireExplicitMethodSelection = false;
      unavailableSupersedeMethodWarning = '';
      duplicateVisible = false;

      const customerInput = document.getElementById('input-customer');
      customerInput?.focus();
    } catch (err: unknown) {
      saveErrorMessage = `Save error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      isSaving = false;
    }
  }

  onMount(loadInitialContext);
</script>

<div class="p-6 max-w-4xl mx-auto w-full">
  <!-- Header with Local-First Badge -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Record Transaction</h1>
      <p class="text-sm text-[var(--muted)]">
        Local-first payment recording completes in &lt;100ms and syncs automatically.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Chip variant="default">{session.isOnline ? 'Online' : 'Offline'}</Chip>
      <Chip variant="default">
        {session.user?.centerCode ? `E-${session.user.centerCode}-…` : '#LOCAL-xxxx'}
      </Chip>
    </div>
  </div>

  {#if saveSuccessMessage}
    <div
      class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm"
    >
      {saveSuccessMessage}
    </div>
  {/if}

  {#if saveErrorMessage}
    <div
      class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm font-semibold"
    >
      {saveErrorMessage}
    </div>
  {/if}

  {#if !activeProfile && methods.length > 0}
    <div
      class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-sm"
    >
      No published rate profile found effective for {entryDate}. Please verify the entry date or
      connect to sync published rates.
    </div>
  {/if}

  {#if isMonthClosed}
    <div
      class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm font-semibold"
    >
      Selected month is closed. New entries cannot be recorded for closed calendar months.
    </div>
  {/if}

  {#if hasRateDeviation}
    <div
      class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-xs"
    >
      Rates for {entryDate} differ from current rates (v{activeProfile?.version} vs current v{latestRateVersion}).
    </div>
  {/if}

  {#if calculationError}
    <div
      class="mb-6 p-4 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs font-semibold"
    >
      ⚠ {calculationError}
    </div>
  {/if}

  {#if unavailableSupersedeMethodWarning}
    <div
      role="alert"
      class="mb-6 p-4 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs font-semibold"
    >
      {unavailableSupersedeMethodWarning}
    </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Form Card -->
    <div class="lg:col-span-2">
      <Card class="p-6">
        {#if supersedingOriginalId}
          <div
            class="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-800 dark:text-blue-300 text-xs flex items-center justify-between"
          >
            <span
              >Superseding Entry: <strong>{supersedingOriginalBadge}</strong> (original entry will be
              marked superseded)</span
            >
            <button
              type="button"
              class="text-xs font-semibold underline hover:opacity-80 ml-2"
              onclick={() => {
                supersedingOriginalId = null;
                supersedingOriginalBadge = null;
                requireExplicitMethodSelection = false;
                unavailableSupersedeMethodWarning = '';
              }}>Cancel supersede</button
            >
          </div>
        {/if}

        <form onsubmit={handleLocalSave} class="flex flex-col gap-4">
          <DuplicateWarning visible={duplicateVisible} />

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="input-date" class="block text-xs font-semibold text-[var(--muted)] mb-1"
                >Date (Asia/Dhaka)</label
              >
              <input
                id="input-date"
                type="date"
                required
                bind:value={entryDate}
                onchange={updateProfileForDate}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
              />
            </div>

            <div>
              <label
                for="input-customer"
                class="block text-xs font-semibold text-[var(--muted)] mb-1">Customer Name</label
              >
              <input
                id="input-customer"
                type="text"
                required
                placeholder="e.g. Rahim Ahmed"
                bind:value={customerName}
                oninput={triggerDuplicateCheck}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
              />
            </div>

            <div>
              <label for="input-qty" class="block text-xs font-semibold text-[var(--muted)] mb-1"
                >Sub Quantity / Sessions</label
              >
              <input
                id="input-qty"
                type="number"
                min="1"
                bind:value={subQty}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
              />
            </div>

            <div>
              <label
                for="input-sub-desc"
                class="block text-xs font-semibold text-[var(--muted)] mb-1"
                >Item / Session Description</label
              >
              <input
                id="input-sub-desc"
                type="text"
                placeholder="Optional description"
                bind:value={subDescription}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
              />
            </div>
          </div>

          <div>
            <label for="input-gross" class="block text-xs font-semibold text-[var(--muted)] mb-1"
              >Gross Collected (BDT)</label
            >
            <input
              id="input-gross"
              type="text"
              required
              placeholder="0.00"
              bind:value={grossInput}
              oninput={triggerDuplicateCheck}
              class="w-full px-3 py-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-lg font-bold font-mono tracking-tight"
            />
            {#if grossInputError}
              <p class="text-xs text-red-600 mt-1">{grossInputError}</p>
            {/if}
          </div>

          <!-- Payment Channel Chips dynamically rendered from db.methods -->
          <div>
            <!-- a11y_label_has_associated_control: grouping caption for the method chip buttons below; no single form control to associate (CLT-D-013 pattern) -->
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-xs font-semibold text-[var(--muted)] mb-2"
              >Payment Method</label
            >
            <div class="flex flex-wrap gap-2">
              {#each selectableMethods as m (m.id)}
                <button
                  type="button"
                  aria-pressed={selectedMethodId === m.id}
                  class="px-3 py-1.5 rounded-full text-xs font-medium border transition-all {selectedMethodId ===
                  m.id
                    ? 'bg-[var(--ink)] text-[var(--bg)] border-transparent'
                    : 'bg-white/40 border-black/10 text-[var(--ink)] hover:bg-white/70'}"
                  onclick={() => {
                    selectedMethodId = m.id;
                    requireExplicitMethodSelection = false;
                    unavailableSupersedeMethodWarning = '';
                    txnRefError = '';
                    triggerDuplicateCheck();
                  }}
                >
                  {m.name}
                </button>
              {/each}
            </div>
          </div>

          <!-- Transaction Reference -->
          <div>
            <label for="input-txn-ref" class="block text-xs font-semibold text-[var(--muted)] mb-1">
              Transaction Reference {requiresTxnRef ? '(Mandatory)' : '(Optional)'}
            </label>
            <input
              id="input-txn-ref"
              type="text"
              aria-invalid={txnRefError ? 'true' : undefined}
              aria-describedby={txnRefError ? 'input-txn-ref-error' : undefined}
              placeholder="e.g. BJT84920KL"
              bind:value={txnRef}
              oninput={(e) => {
                txnRef = (e.target as HTMLInputElement).value.toUpperCase();
                txnRefError = '';
                triggerDuplicateCheck();
              }}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono uppercase"
            />
            {#if txnRefError}
              <p id="input-txn-ref-error" class="text-xs text-red-600 mt-1">{txnRefError}</p>
            {/if}
          </div>

          <!-- VAT Section: Manual or Configured Default with Override (CLT-POLICY-Q1) -->
          {#if activeProfile?.vat_mode === 'manual'}
            <div>
              <label for="input-vat" class="block text-xs font-semibold text-[var(--muted)] mb-1"
                >Manual VAT Collected (BDT)</label
              >
              <input
                id="input-vat"
                type="text"
                placeholder="0.00"
                bind:value={manualVatInput}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
              />
            </div>
          {:else if activeProfile?.vat_mode}
            <div
              class="rounded-lg border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/20 p-3"
            >
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs font-semibold text-[var(--ink)]">
                    VAT: {((activeProfile.vat_bp ?? 0) / 100).toFixed(2)}% of gross
                  </span>
                  <span class="text-xs font-mono text-[var(--muted)] ml-2">
                    ({formatPoishaToBdt(calculated.vatPoisha)})
                  </span>
                </div>
                {#if !isVatOverridden}
                  <button
                    type="button"
                    class="text-xs text-[var(--accent)] hover:underline font-medium"
                    onclick={() => {
                      isVatOverridden = true;
                      vatOverrideMode = 'amount';
                      const vp = calculated.vatPoisha;
                      const vTaka = vp / 100n;
                      const vRem = vp % 100n;
                      vatOverrideAmountInput = `${vTaka.toString()}.${vRem.toString().padStart(2, '0')}`;
                      vatOverridePercentInput = ((activeProfile?.vat_bp ?? 0) / 100).toFixed(2);
                    }}
                  >
                    Change VAT
                  </button>
                {:else}
                  <button
                    type="button"
                    class="text-xs text-red-600 hover:underline font-medium"
                    onclick={() => {
                      isVatOverridden = false;
                      vatOverrideAmountInput = '';
                      vatOverridePercentInput = '';
                    }}
                  >
                    Revert to default ({((activeProfile?.vat_bp ?? 0) / 100).toFixed(2)}%)
                  </button>
                {/if}
              </div>

              {#if isVatOverridden}
                <div class="mt-3 pt-3 border-t border-black/10 dark:border-white/10 space-y-2">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-xs text-[var(--muted)]">Override by:</span>
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded text-xs {vatOverrideMode === 'amount'
                        ? 'bg-[var(--ink)] text-[var(--bg)] font-medium'
                        : 'bg-black/5 dark:bg-white/5 text-[var(--ink)]'}"
                      onclick={() => (vatOverrideMode = 'amount')}
                    >
                      Amount (BDT)
                    </button>
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded text-xs {vatOverrideMode === 'percent'
                        ? 'bg-[var(--ink)] text-[var(--bg)] font-medium'
                        : 'bg-black/5 dark:bg-white/5 text-[var(--ink)]'}"
                      onclick={() => (vatOverrideMode = 'percent')}
                    >
                      Rate (%)
                    </button>
                  </div>

                  {#if vatOverrideMode === 'amount'}
                    <div>
                      <label
                        for="input-vat-override-amount"
                        class="block text-[11px] font-semibold text-[var(--muted)] mb-1"
                        >Override VAT Amount (BDT)</label
                      >
                      <input
                        id="input-vat-override-amount"
                        type="text"
                        placeholder="0.00"
                        bind:value={vatOverrideAmountInput}
                        class="w-full px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/70 text-sm font-mono"
                      />
                    </div>
                  {:else}
                    <div>
                      <label
                        for="input-vat-override-percent"
                        class="block text-[11px] font-semibold text-[var(--muted)] mb-1"
                        >Override VAT Rate (%)</label
                      >
                      <input
                        id="input-vat-override-percent"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="0.00"
                        bind:value={vatOverridePercentInput}
                        class="w-full px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/70 text-sm font-mono"
                      />
                    </div>
                  {/if}

                  {#if vatOverrideError}
                    <p class="text-xs text-red-600">{vatOverrideError}</p>
                  {/if}

                  <div>
                    <label
                      for="input-vat-override-reason"
                      class="block text-[11px] font-semibold text-[var(--muted)] mb-1"
                      >Override Reason</label
                    >
                    <input
                      id="input-vat-override-reason"
                      type="text"
                      placeholder="e.g. Special customer exemption"
                      bind:value={vatOverrideReason}
                      class="w-full px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/70 text-xs"
                    />
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <div>
            <label for="input-notes" class="block text-xs font-semibold text-[var(--muted)] mb-1"
              >Notes</label
            >
            <textarea
              id="input-notes"
              rows="2"
              placeholder="Additional comments or context"
              bind:value={notes}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
            ></textarea>
          </div>

          <Button
            id="btn-save"
            variant="default"
            type="submit"
            class="w-full py-3 text-sm font-semibold mt-2"
            disabled={isSaving ||
              isMonthClosed ||
              grossPoisha <= 0n ||
              !customerName.trim() ||
              !selectedMethodId ||
              !activeProfile ||
              !!grossInputError ||
              !!vatOverrideError ||
              !!calculationError}
          >
            {isSaving
              ? 'Saving...'
              : supersedingOriginalId
                ? 'Supersede & Save Entry'
                : 'Save Entry (<100ms)'}
          </Button>
        </form>
      </Card>
    </div>

    <!-- Live Receipt Breakdown -->
    <div class="lg:col-span-1">
      <ReceiptBreakdown
        grossPoisha={calculated.grossPoisha}
        vatPoisha={calculated.vatPoisha}
        commissionPoisha={calculated.commissionPoisha}
        chargePoisha={calculated.chargePoisha}
        netPoisha={calculated.netAfterDeductionsPoisha}
        chargesBorneBy={activeProfile?.method_rates[selectedMethodId]?.charges_borne_by ??
          'business'}
        methodName={currentMethod?.name ?? 'Method Charge'}
        vatMode={activeProfile?.vat_mode}
        vatBp={activeProfile?.vat_bp}
        isVatOverridden={activeProfile?.vat_mode !== 'manual' &&
          isVatOverridden &&
          vatOverridePoisha !== undefined}
        commissionBp={activeProfile?.commission_bp}
        chargeBp={activeProfile?.method_rates[selectedMethodId]?.fee_bp}
      />
    </div>
  </div>
</div>
