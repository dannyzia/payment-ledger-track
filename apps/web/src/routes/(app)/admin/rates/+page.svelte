<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface MethodRateItem {
    payment_method_id: string;
    code: string;
    name: string;
    fee_bp: number;
    charges_borne_by: 'business' | 'customer';
  }

  interface RateProfileView {
    id: string;
    version: number;
    effective_from: string;
    vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    vat_bp: number;
    commission_base: 'gross_minus_vat' | 'gross';
    commission_bp: number;
    note?: string;
    method_rates: MethodRateItem[];
  }

  let publishedProfile = $state<RateProfileView | null>(null);
  let draftProfile = $state<RateProfileView | null>(null);
  let methods = $state<{ id: string; code: string; name: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read in template via svelte compile (CLT-D-013)
  let loading = $state(true);
  let saving = $state(false);
  let publishing = $state(false);
  let showPublishModal = $state(false);
  let errorMessage = $state('');

  // Draft editing state
  function getDhakaToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  }
  let effectiveFrom = $state(getDhakaToday());
  let vatMode = $state<'manual' | 'percent_of_gross' | 'percent_inclusive'>('manual');
  let vatBp = $state(0);
  let commissionBase = $state<'gross_minus_vat' | 'gross'>('gross_minus_vat');
  let commissionBp = $state(4200);
  let draftNote = $state('');
  let methodRatesList = $state<MethodRateItem[]>([]);

  // Computed total deductions
  let maxMethodCharge = $derived(
    methodRatesList.length > 0 ? Math.max(...methodRatesList.map((m) => m.fee_bp)) : 0
  );
  let totalDeductionsBp = $derived(
    (vatMode === 'manual' ? 0 : vatBp) + commissionBp + maxMethodCharge
  );
  let exceeds100Percent = $derived(totalDeductionsBp > 10000);

  async function loadData() {
    loading = true;
    errorMessage = '';
    try {
      const [ratesRes, methodsRes] = await Promise.all([
        authFetch('/api/v1/admin/rates/draft'),
        authFetch('/api/v1/admin/methods'),
      ]);

      if (methodsRes.ok) {
        const mData = await methodsRes.json();
        methods = mData.methods ?? [];
      }

      if (ratesRes.ok) {
        const rData = await ratesRes.json();
        publishedProfile = rData.published;
        draftProfile = rData.draft;

        if (draftProfile) {
          effectiveFrom = draftProfile.effective_from;
          vatMode = draftProfile.vat_mode;
          vatBp = draftProfile.vat_bp;
          commissionBase = draftProfile.commission_base;
          commissionBp = draftProfile.commission_bp;
          draftNote = draftProfile.note ?? '';
          methodRatesList = draftProfile.method_rates ?? [];
        } else if (publishedProfile) {
          effectiveFrom = getDhakaToday();
          vatMode = publishedProfile.vat_mode;
          vatBp = publishedProfile.vat_bp;
          commissionBase = publishedProfile.commission_base;
          commissionBp = publishedProfile.commission_bp;
          draftNote = '';
          methodRatesList = publishedProfile.method_rates.map((mr) => ({ ...mr }));
        } else {
          methodRatesList = methods.map((m) => ({
            payment_method_id: m.id,
            code: m.code,
            name: m.name,
            fee_bp: 150,
            charges_borne_by: 'business',
          }));
        }
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message || 'Failed to load rate profiles' : String(e);
    } finally {
      loading = false;
    }
  }

  async function saveDraft() {
    if (exceeds100Percent) {
      errorMessage = 'Total deductions exceed 100% (10,000 basis points). Adjust rates before saving.';
      return;
    }

    saving = true;
    errorMessage = '';
    try {
      const payload = {
        draftId: draftProfile?.id,
        effectiveFrom,
        vat: { mode: vatMode, rateBp: vatBp },
        commission: { rateBp: commissionBp, base: commissionBase },
        methodRates: methodRatesList.map((m) => ({
          payment_method_id: m.payment_method_id,
          fee_bp: m.fee_bp,
          charges_borne_by: m.charges_borne_by,
        })),
        note: draftNote || undefined,
      };

      const res = await authFetch('/api/v1/admin/rates/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save draft');
      }

      await loadData();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function publishDraft() {
    if (!draftProfile?.id) return;
    publishing = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/rates/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: draftProfile.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to publish profile');
      }

      showPublishModal = false;
      await loadData();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      publishing = false;
    }
  }

  onMount(loadData);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Rate Profiles & Rules</h1>
      <p class="text-sm text-[var(--muted)]">Configure versioned financial deductions, VAT modes, and channel charges.</p>
    </div>
    <div class="flex gap-3">
      <Button variant="default" onclick={saveDraft} disabled={saving || exceeds100Percent}>
        {saving ? 'Saving...' : 'Save Draft'}
      </Button>
      {#if draftProfile}
        <Button variant="commission" onclick={() => (showPublishModal = true)} disabled={publishing || exceeds100Percent}>
          Publish Profile
        </Button>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  {#if exceeds100Percent}
    <div class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-sm flex items-center justify-between">
      <div>
        <span class="font-semibold">Deduction Boundary Violation:</span> Total deductions equal {(totalDeductionsBp / 100).toFixed(2)}%, which exceeds 100.00%. Entries cannot yield negative merchant net.
      </div>
      <Chip variant="default" class="bg-amber-500/20 text-amber-900 border border-amber-500/30">{(totalDeductionsBp / 100).toFixed(2)}%</Chip>
    </div>
  {/if}

  <!-- Active Published Profile Summary -->
  {#if publishedProfile}
    <Card class="p-5 mb-8 border-l-4 border-l-[var(--c-commission)]">
      <div class="flex items-center justify-between mb-4">
        <div>
          <span class="text-xs font-semibold text-[var(--c-commission)] uppercase tracking-wider">Active Published Profile</span>
          <h2 class="text-lg font-bold text-[var(--ink)]">Version {publishedProfile.version} (Effective: {publishedProfile.effective_from})</h2>
        </div>
        <Chip variant="commission">Published</Chip>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div>
          <span class="text-[var(--muted)] block">VAT Mode</span>
          <span class="font-semibold capitalize text-[var(--ink)]">{publishedProfile.vat_mode.replace('_', ' ')}</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">VAT Rate</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.vat_bp / 100}%</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">Commission</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.commission_bp / 100}% ({publishedProfile.commission_base})</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">Channels Configured</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.method_rates.length} methods</span>
        </div>
      </div>
    </Card>
  {/if}

  <!-- Draft Profile Editor Form -->
  <Card class="p-6">
    <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6">
      <div>
        <h2 class="text-lg font-semibold text-[var(--ink)]">Draft Rate Profile</h2>
        <p class="text-xs text-[var(--muted)]">Updates take effect on or after the effective date once published.</p>
      </div>
      <Chip variant="default">{draftProfile ? 'Draft in Progress' : 'New Draft'}</Chip>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div>
        <label for="effective-date" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Effective Date (Asia/Dhaka)</label>
        <input
          id="effective-date"
          type="date"
          bind:value={effectiveFrom}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">Must be today or in the future; past dates will be rejected upon publishing.</p>
      </div>

      <div>
        <label for="vat-mode-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">VAT Calculation Mode</label>
        <select
          id="vat-mode-select"
          bind:value={vatMode}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value="manual">Manual Entry (Staff inputs exact VAT amount)</option>
          <option value="percent_of_gross">Percent of Gross (e.g. 5% applied directly to gross)</option>
          <option value="percent_inclusive">Percent Inclusive (VAT included in gross amount)</option>
        </select>
      </div>

      {#if vatMode !== 'manual'}
        <div>
          <label for="vat-bp-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Default VAT Rate (Basis Points)</label>
          <div class="flex items-center gap-2">
            <input
              id="vat-bp-input"
              type="number"
              min="0"
              max="10000"
              bind:value={vatBp}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
            />
            <span class="text-sm font-mono text-[var(--muted)]">{(vatBp / 100).toFixed(2)}%</span>
          </div>
        </div>
      {/if}

      <div>
        <label for="comm-bp-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Default Commission Rate (Basis Points)</label>
        <div class="flex items-center gap-2">
          <input
            id="comm-bp-input"
            type="number"
            min="0"
            max="10000"
            bind:value={commissionBp}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
          />
          <span class="text-sm font-mono text-[var(--muted)]">{(commissionBp / 100).toFixed(2)}%</span>
        </div>
      </div>

      <div>
        <label for="comm-base-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Commission Base</label>
        <select
          id="comm-base-select"
          bind:value={commissionBase}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value="gross_minus_vat">Gross Minus VAT (Standard)</option>
          <option value="gross">Gross Total</option>
        </select>
      </div>

      <div>
        <label for="draft-note-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Draft Revision Note (Optional)</label>
        <input
          id="draft-note-input"
          type="text"
          placeholder="e.g. Q4 Updated Gateway Rates"
          bind:value={draftNote}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
      </div>
    </div>

    <!-- Payment Method Rates Table -->
    <div class="mt-8 border-t border-black/10 dark:border-white/10 pt-6">
      <h3 class="text-sm font-bold text-[var(--ink)] mb-4">Payment Method Charges & Liability</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="border-b border-black/10 dark:border-white/10 text-[var(--muted)]">
            <tr>
              <th class="py-2 px-3 font-semibold">Channel</th>
              <th class="py-2 px-3 font-semibold">Charge (Basis Points)</th>
              <th class="py-2 px-3 font-semibold">Percentage</th>
              <th class="py-2 px-3 font-semibold">Charges Borne By</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5 dark:divide-white/5">
            {#each methodRatesList as mr}
              <tr>
                <td class="py-3 px-3 font-medium text-[var(--ink)]">
                  {mr.name} <span class="font-mono text-[var(--muted)]">({mr.code})</span>
                </td>
                <td class="py-3 px-3">
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    aria-label={`Fee in basis points for ${mr.name}`}
                    bind:value={mr.fee_bp}
                    class="w-28 px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
                  />
                </td>
                <td class="py-3 px-3 font-mono text-[var(--muted)]">
                  {(mr.fee_bp / 100).toFixed(2)}%
                </td>
                <td class="py-3 px-3">
                  <select
                    bind:value={mr.charges_borne_by}
                    aria-label={`Charges borne by for ${mr.name}`}
                    class="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50 text-xs"
                  >
                    <option value="business">Business Borne</option>
                    <option value="customer">Customer Borne</option>
                  </select>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </Card>
</div>

<!-- Publish Confirmation Modal -->
<Modal bind:open={showPublishModal} title="Confirm Rate Profile Publication" onclose={() => (showPublishModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Publishing this rate profile will make it immutable and effective starting <strong class="font-mono">{effectiveFrom}</strong>.
    </p>
    <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 space-y-1">
      <p class="font-semibold">Immutability Notice:</p>
      <p>• Published profiles cannot be edited, deleted, or backdated.</p>
      <p>• Historical entries will NOT be retroactively recalculated.</p>
      <p>• Offline entries using older rates will be audited upon sync.</p>
    </div>
    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showPublishModal = false)}>Cancel</Button>
      <Button variant="commission" onclick={publishDraft} disabled={publishing}>
        {publishing ? 'Publishing...' : 'Confirm Publication'}
      </Button>
    </div>
  </div>
</Modal>
