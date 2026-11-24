<script lang="ts">
  import { page } from '$app/state';
  import { hasCenterCapability } from '$lib/capabilities';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import CouponHead from '$lib/ui/CouponHead.svelte';
  import Stamp from '$lib/ui/Stamp.svelte';
  import RecordPaymentModal from '$lib/ui/RecordPaymentModal.svelte';
  import OverpaymentApprovalModal from '$lib/ui/OverpaymentApprovalModal.svelte';
  import {
    db,
    type CachedSettlement,
    type CachedSettlementPayment,
    type CachedPayable,
    type CachedPaymentMethod,
  } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  const settlementId = $derived(page.params.id ?? '');

  let settlement = $state<CachedSettlement | null>(null);
  let payable = $state<CachedPayable | null>(null);
  let method = $state<CachedPaymentMethod | null>(null);
  let payments = $state<CachedSettlementPayment[]>([]);
  let isMonthClosed = $state(false);

  let recordModalOpen = $state(false);
  let reversalModalOpen = $state(false);
  let overpaymentModalOpen = $state(false);
  let selectedPaymentForReversal = $state<CachedSettlementPayment | null>(null);
  let selectedPaymentReversibleBalance = $state<bigint | null>(null);
  let signedReceiptUrls = $state<Record<string, string>>({});

  const isAuthorized = $derived(
    hasCenterCapability(session.user?.role ?? 'staff', 'settlement.read'),
  );

  const canRecordPayment = $derived(
    !isMonthClosed ||
      (settlement ? BigInt(settlement.paid_poisha) < BigInt(settlement.expected_poisha) : false),
  );

  function getChipVariant(
    code?: string,
  ): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (
      lower === 'bkash' ||
      lower === 'visa' ||
      lower === 'mastercard' ||
      lower === 'vat' ||
      lower === 'commission'
    ) {
      return lower;
    }
    return 'default';
  }

  // Calculates remaining reversible balance for a payment (PRD Test #13 partial reversal support)
  function getReversibleBalance(
    p: CachedSettlementPayment,
    allPayments: CachedSettlementPayment[],
  ): bigint {
    if (p.is_reversal) return 0n;
    const original = BigInt(p.amount_poisha);
    const reversed = allPayments
      .filter(
        (other) => other.is_reversal && (other.reverses_payment_id ?? other.reverses_id) === p.id,
      )
      .reduce((acc, r) => acc + BigInt(r.amount_poisha), 0n);
    return original > reversed ? original - reversed : 0n;
  }

  // Fetch payments and settlement from server and cache in Dexie
  async function loadServerPayments(sId: string) {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(
        `/api/v1/settlements/payments?settlement_id=${encodeURIComponent(sId)}`,
        {
          headers: { Authorization: `Bearer ${token ?? ''}` },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          settlement?: CachedSettlement;
          payments?: CachedSettlementPayment[];
        };
        if (data.settlement) {
          await db.settlements.put(data.settlement);
        }
        if (Array.isArray(data.payments)) {
          await db.settlementPayments.bulkPut(data.payments);
        }
      }
    } catch (err) {
      console.warn(
        'Offline: viewing cached payments from Dexie',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Reactive Dexie Subscriptions
  $effect(() => {
    if (!settlementId || !isAuthorized) return;

    loadServerPayments(settlementId);

    const subSettlement = liveQuery(() => db.settlements.get(settlementId)).subscribe((s) => {
      settlement = s ?? null;
      if (s) {
        db.payables.get(s.payable_id).then((p) => {
          payable = p ?? null;
          if (p?.method_id) {
            db.methods.get(p.method_id).then((m) => {
              method = m ?? null;
            });
          }
        });
        db.monthCloses
          .where('month')
          .equals(s.month)
          .first()
          .then((mc) => {
            isMonthClosed = mc?.status === 'closed';
          });
      }
    });

    const subPayments = liveQuery(() =>
      db.settlementPayments.where('settlement_id').equals(settlementId).toArray(),
    ).subscribe((pList) => {
      // Sort payments chronologically descending
      payments = pList.sort((a, b) => b.paid_on.localeCompare(a.paid_on));
    });

    return () => {
      subSettlement.unsubscribe();
      subPayments.unsubscribe();
    };
  });

  async function viewReceipt(receiptPath: string) {
    if (signedReceiptUrls[receiptPath]) {
      window.open(signedReceiptUrls[receiptPath], '_blank');
      return;
    }

    // Synchronously open popup window to avoid mobile browser popup blockers during async await
    const popup = window.open('about:blank', '_blank');

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(
        `/api/v1/settlements/receipts/signed-url?path=${encodeURIComponent(receiptPath)}`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } },
      );

      if (!res.ok) throw new Error('Failed to retrieve signed URL');
      const data = (await res.json()) as { signedUrl?: string };
      if (!data.signedUrl) throw new Error('Failed to retrieve signed URL');
      signedReceiptUrls[receiptPath] = data.signedUrl;
      if (popup) {
        popup.location.href = data.signedUrl;
      }
    } catch {
      if (popup) popup.close();
      alert('Unable to load receipt photo. Please verify connectivity.');
    }
  }

  function openReversalModal(p: CachedSettlementPayment) {
    selectedPaymentForReversal = p;
    selectedPaymentReversibleBalance = getReversibleBalance(p, payments);
    reversalModalOpen = true;
  }
</script>

<div class="settlement-detail p-6 max-w-4xl mx-auto w-full">
  {#if !isAuthorized}
    <div
      class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12"
    >
      <span class="text-3xl mb-2 block">🔒</span>
      <h2 class="text-base font-bold text-amber-900 dark:text-amber-200">Access Restricted</h2>
      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
        Settlement details are restricted to Admin and Owner roles.
      </p>
      <Button variant="default" class="mt-4" onclick={() => goto('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  {:else if !settlement}
    <div class="p-12 text-center text-sm text-[var(--muted)]">
      Loading settlement record or record not found...
    </div>
  {:else}
    <CouponHead
      tab="Settlement"
      title={payable?.name ?? 'Settlement Liability'}
      subtitle={`Statement month ${settlement.month}`}
    >
      {#if payable?.kind === 'vat'}
        <span
          class="tab-caps px-2 py-1 rounded-full text-[10px] bg-[var(--c-vat-bg)] text-[var(--c-vat)] border border-[var(--c-vat)]"
          >VAT</span
        >
      {:else if method}
        <Chip variant={getChipVariant(method.code)}>
          {method.code}
        </Chip>
      {/if}
    </CouponHead>

    <div class="mb-6 flex flex-wrap items-center justify-end gap-2">
      <Button variant="default" onclick={() => goto('/settlements')}>← Back to Settlements</Button>
      <Button
        class="btn-stamp min-h-[44px]"
        onclick={() => {
          recordModalOpen = true;
        }}
        disabled={!canRecordPayment}
      >
        + Record Payment
      </Button>
    </div>

    {#if isMonthClosed}
      <div
        class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-700 dark:text-red-400"
      >
        🔒 This month is closed. Payment reversals and overpayments are permanently locked.
      </div>
    {/if}

    <!-- Financial Status Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card class="p-5">
        <div class="tab-caps text-[11px] text-[var(--muted)] mb-1">Expected Liability</div>
        <div class="text-xl font-bold carbon-nums text-[var(--carbon)]">
          {formatPoishaToBdt(BigInt(settlement.expected_poisha))}
        </div>
        <div class="text-[10px] text-[var(--muted)] mt-1">Calculated from active entries</div>
      </Card>

      <Card class="p-5">
        <div class="tab-caps text-[11px] text-[var(--muted)] mb-1">Total Paid to Date</div>
        <div class="text-xl font-bold carbon-nums text-[var(--carbon)]">
          {formatPoishaToBdt(BigInt(settlement.paid_poisha))}
        </div>
        <div class="text-[10px] text-[var(--muted)] mt-1">{payments.length} payment records</div>
      </Card>

      <Card class="p-5">
        <div class="tab-caps text-[11px] text-[var(--muted)] mb-1">Settlement Status</div>
        <div class="flex items-center min-h-[32px]">
          {#if settlement.status === 'paid'}
            <Stamp label="PAID" class="-rotate-6" />
          {:else if settlement.status === 'due'}
            <span
              class="tab-caps px-2.5 py-1 rounded-full text-[10px] bg-[var(--accent-2)] text-[var(--navy-ink)]"
              >Due</span
            >
          {:else if settlement.status === 'partly_paid'}
            <span
              class="tab-caps px-2.5 py-1 rounded-full text-[10px] bg-[var(--c-vat-bg)] text-[var(--c-vat)] border border-[var(--c-vat)]"
              >Partly Paid</span
            >
          {:else if settlement.status === 'overpaid'}
            <Stamp label="Overpaid" />
          {:else}
            <span
              class="tab-caps px-2.5 py-1 rounded-full text-[10px] border border-[var(--muted)] text-[var(--muted)]"
              >Not Applicable</span
            >
          {/if}
        </div>
        <div class="text-[10px] carbon-nums text-[var(--muted)] mt-1">
          Variance: {formatPoishaToBdt(
            BigInt(settlement.paid_poisha) - BigInt(settlement.expected_poisha),
          )}
        </div>
      </Card>
    </div>

    <!-- Overpayment Review Status Section (PRD §8.4) -->
    {#if settlement.status === 'overpaid'}
      <div class="mb-6">
        <Card class="p-5 border-[var(--accent)]/25 bg-[var(--accent)]/5">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span
                  class="tab-caps text-[10px] px-2.5 py-1 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold border border-[var(--accent)]/40"
                >
                  {settlement.overpayment_review_status === 'approved'
                    ? '✓ Overpayment Approved'
                    : '⚠️ Overpayment Pending Approval'}
                </span>
                <span class="text-xs text-[var(--ink)] font-bold carbon-nums">
                  Surplus: +{formatPoishaToBdt(
                    BigInt(settlement.paid_poisha) - BigInt(settlement.expected_poisha),
                  )}
                </span>
              </div>

              {#if settlement.overpayment_review_status === 'approved'}
                <p class="text-xs text-[var(--muted)] mt-1">
                  Reason: "{settlement.overpayment_reason}" &bull; Authorized: {settlement.overpayment_approved_at?.slice(
                    0,
                    10,
                  )}
                </p>
              {:else}
                <p class="text-xs text-[var(--muted)] mt-1">
                  Owner approval is required to authorize surplus prior to month close (PRD §8.4).
                </p>
              {/if}
            </div>

            {#if settlement.overpayment_review_status !== 'approved' && hasCenterCapability(session.user?.role ?? 'staff', 'settlement.approve_overpayment')}
              <Button
                class="btn-stamp min-h-[44px]"
                onclick={() => {
                  overpaymentModalOpen = true;
                }}
              >
                Authorize Surplus
              </Button>
            {/if}
          </div>
        </Card>
      </div>
    {/if}

    <!-- Payment Records Ledger Table -->
    <Card class="p-6">
      <div
        class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4"
      >
        <h2 class="text-base font-bold text-[var(--ink)]">Settlement Payments &amp; Reversals</h2>
        <span class="text-xs text-[var(--muted)]">{payments.length} items</span>
      </div>

      {#if payments.length === 0}
        <div class="p-8 text-center text-sm text-[var(--muted)]">
          No payments recorded for this settlement.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr
                class="tab-caps text-[11px] text-[var(--muted)] border-b border-[var(--pearl-border)]"
              >
                <th class="pb-2">Date</th>
                <th class="pb-2 text-right">Amount (BDT)</th>
                <th class="pb-2">Reference</th>
                <th class="pb-2">Receipt</th>
                <th class="pb-2">Notes</th>
                <th class="pb-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--pearl-border)] text-xs">
              {#each payments as p (p.id)}
                {@const reversibleBalance = getReversibleBalance(p, payments)}
                {@const isFullyReversed = !p.is_reversal && reversibleBalance === 0n}
                {@const isPartlyReversed =
                  !p.is_reversal &&
                  reversibleBalance > 0n &&
                  reversibleBalance < BigInt(p.amount_poisha)}
                {@const receiptPath = p.receipt_storage_path ?? p.receipt_path}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-3 carbon-nums text-[var(--ink)]">
                    {p.paid_on}
                    {#if p.is_reversal}
                      <span
                        class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-bold"
                        >Reversal</span
                      >
                    {:else if isFullyReversed}
                      <span
                        class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-black/10 text-[var(--muted)] font-bold"
                        >Reversed</span
                      >
                    {:else if isPartlyReversed}
                      <span
                        class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold"
                        >Partly Reversed</span
                      >
                    {/if}
                  </td>
                  <td
                    class="py-3 text-right font-bold carbon-nums {p.is_reversal
                      ? 'text-red-600 dark:text-red-400 line-through decoration-[var(--accent)]'
                      : 'text-[var(--carbon)]'}"
                  >
                    {p.is_reversal ? '-' : ''}{formatPoishaToBdt(BigInt(p.amount_poisha))}
                  </td>
                  <td class="py-3 carbon-nums text-[var(--muted)]">{p.reference || '—'}</td>
                  <td class="py-3">
                    {#if receiptPath}
                      <button
                        type="button"
                        onclick={() => viewReceipt(receiptPath)}
                        class="text-xs text-[var(--accent)] hover:underline font-medium cursor-pointer"
                      >
                        View Receipt ↗
                      </button>
                    {:else}
                      <span class="text-[var(--muted)]">—</span>
                    {/if}
                  </td>
                  <td class="py-3 font-sans text-xs text-[var(--muted)] max-w-xs truncate">
                    {p.note || '—'}
                  </td>
                  <td class="py-3 text-right">
                    {#if !p.is_reversal && reversibleBalance > 0n}
                      <button
                        type="button"
                        disabled={isMonthClosed}
                        onclick={() => openReversalModal(p)}
                        class="text-xs text-red-600 hover:underline font-medium cursor-pointer disabled:opacity-40"
                      >
                        {isPartlyReversed ? 'Reverse More' : 'Reverse'}
                      </button>
                    {:else}
                      <span class="text-[var(--muted)]">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>

    <RecordPaymentModal
      bind:open={recordModalOpen}
      {settlementId}
      isReversal={false}
      expectedPoisha={settlement.expected_poisha}
      paidPoisha={settlement.paid_poisha}
      {isMonthClosed}
      onclose={() => {
        recordModalOpen = false;
      }}
      onsuccess={(newP, updatedSett) => {
        // The Dexie liveQuery also delivers this row, so replace by id instead of
        // prepending blindly: a duplicate keyed entry throws each_key_duplicate.
        payments = [newP, ...payments.filter((p) => p.id !== newP.id)];
        if (updatedSett) {
          settlement = updatedSett;
        }
      }}
    />

    {#if selectedPaymentForReversal}
      <RecordPaymentModal
        bind:open={reversalModalOpen}
        {settlementId}
        isReversal={true}
        reversesPayment={selectedPaymentForReversal}
        maxReversiblePoisha={selectedPaymentReversibleBalance}
        {isMonthClosed}
        onclose={() => {
          reversalModalOpen = false;
          selectedPaymentForReversal = null;
        }}
        onsuccess={(newP, updatedSett) => {
          payments = [newP, ...payments.filter((p) => p.id !== newP.id)];
          if (updatedSett) {
            settlement = updatedSett;
          }
        }}
      />
    {/if}

    <OverpaymentApprovalModal
      bind:open={overpaymentModalOpen}
      {settlement}
      onclose={() => {
        overpaymentModalOpen = false;
      }}
      onsuccess={(updated) => {
        settlement = updated;
      }}
    />
  {/if}
</div>
