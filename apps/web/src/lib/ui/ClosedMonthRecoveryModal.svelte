<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { parseStrictBdtToPoisha, currentDhakaMonth } from '$lib/reconcile/tolerance';
  import { resolveEffectiveRateProfile } from '$lib/db/rates';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    open: boolean;
    entryId: string;
    originalDate: string;
    grossPoisha: string;
    destinationVatMode?: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    onclose: () => void;
    onreassign: (newDate: string, reason: string, manualVatPoisha?: bigint) => Promise<void>;
    onreopen: (targetMonth: string, reason: string) => Promise<void>;
    ondiscard: (reason: string) => Promise<void>;
  }

  let {
    open = $bindable(),
    entryId,
    originalDate,
    grossPoisha,
    destinationVatMode,
    onclose,
    onreassign,
    onreopen,
    ondiscard,
  }: Props = $props();

  let mode = $state<'choose' | 'reassign' | 'reopen' | 'discard'>('choose');

  const defaultDestinationDate = `${currentDhakaMonth()}-01`;
  let reassignDate = $state(defaultDestinationDate);
  let reassignReason = $state('');
  let manualVatBdt = $state('');
  let reopenReason = $state('');
  let discardReason = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  let currentDestinationVatMode = $state<'manual' | 'percent_of_gross' | 'percent_inclusive' | undefined>(undefined);

  // Dynamically resolve destination date rate profile to determine whether manual VAT input is required (PRD §6.3, F20);
  // reading destinationVatMode inside the effect keeps it reactive (captures-initial-prop warning fix)
  $effect(() => {
    if (destinationVatMode) {
      currentDestinationVatMode = destinationVatMode;
      return;
    }
    if (reassignDate) {
      resolveEffectiveRateProfile(reassignDate).then((profile) => {
        if (profile) currentDestinationVatMode = profile.vat_mode;
      });
    }
  });

  const originalMonth = $derived(originalDate ? originalDate.substring(0, 7) : currentDhakaMonth());
  const destinationMonth = $derived(reassignDate ? reassignDate.substring(0, 7) : currentDhakaMonth());
  const vatInputRequired = $derived(currentDestinationVatMode === 'manual');

  async function handleReassignSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!reassignReason.trim()) return;
    isSubmitting = true;
    errorMessage = '';
    try {
      let manualVatPoisha: bigint | undefined;
      if (vatInputRequired) {
        const parsed = parseStrictBdtToPoisha(manualVatBdt);
        if (parsed === null) {
          throw new Error('Please enter a valid VAT amount in BDT (maximum 2 decimal places).');
        }
        manualVatPoisha = parsed;
      }
      await onreassign(reassignDate, reassignReason.trim(), manualVatPoisha);
      onclose();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to reassign entry.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleReopenSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!reopenReason.trim() || session.user?.role !== 'owner') return;
    isSubmitting = true;
    errorMessage = '';
    try {
      await onreopen(originalMonth, reopenReason.trim());
      onclose();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to reopen month.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleDiscardSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!discardReason.trim()) return;
    isSubmitting = true;
    errorMessage = '';
    try {
      await ondiscard(discardReason.trim());
      onclose();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to discard entry.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="recovery-modal">
  <Modal bind:open title="Needs Attention: Closed Month Entry" {onclose}>
    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    {#if mode === 'choose'}
      <div class="flex flex-col gap-4 text-sm">
        <p class="text-xs text-[var(--c-muted,#6b7280)]">
          This transaction originally dated <span class="font-bold text-[var(--c-ink,#111827)]">{originalDate}</span> (Gross: {formatPoishaToBdt(BigInt(grossPoisha || '0'))}, Entry ID: <span class="font-mono">{entryId}</span>) was recorded offline, but the calendar month was closed before sync (PRD §8.4). Choose an audited resolution:
        </p>

        <div class="flex flex-col gap-2">
          <Button variant="default" class="w-full justify-start py-3 min-h-[44px]" onclick={() => { mode = 'reassign'; }}>
            1. Reassign to Open Month (1st of open month)
          </Button>

          <Button
            variant="default"
            class="w-full justify-start py-3 min-h-[44px]"
            disabled={session.user?.role !== 'owner'}
            onclick={() => { mode = 'reopen'; }}
          >
            2. Reopen Month {originalMonth} (Owner Only)
            {#if session.user?.role !== 'owner'}
              <span class="text-xs text-[var(--c-muted,#6b7280)] ml-2">(Owner role required)</span>
            {/if}
          </Button>

          <Button variant="default" class="w-full justify-start py-3 min-h-[44px]" onclick={() => { mode = 'discard'; }}>
            3. Discard Entry with Audited Reason
          </Button>
        </div>
      </div>
    {:else if mode === 'reassign'}
      <form onsubmit={handleReassignSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          Warning: Reassigning this transaction shifts VAT and merchant liability from the closed month ({originalMonth}) to destination month ({destinationMonth}).
        </div>

        <div>
          <label for="reassign-date" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Destination Open Month Date</label>
          <input
            id="reassign-date"
            type="date"
            required
            bind:value={reassignDate}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
          />
        </div>

        {#if vatInputRequired}
          <div class="p-3 rounded-xl bg-blue-500/10 text-xs text-blue-800">
            Notice: Destination rate profile uses Manual VAT mode. Please re-enter the VAT amount to satisfy mode exclusivity.
          </div>
          <div>
            <label for="manual-vat-bdt" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Manual VAT Input (BDT)</label>
            <input
              id="manual-vat-bdt"
              type="text"
              inputmode="decimal"
              required
              placeholder="0.00"
              bind:value={manualVatBdt}
              class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
            />
          </div>
        {/if}

        <div>
          <label for="reassign-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Reassign Reason</label>
          <textarea
            id="reassign-reason"
            required
            rows="2"
            bind:value={reassignReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit justification for reassigning date to open month..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="commission" type="submit" loading={isSubmitting} disabled={!reassignReason.trim()}>
            Confirm Reassignment
          </Button>
        </div>
      </form>
    {:else if mode === 'reopen'}
      <form onsubmit={handleReopenSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          Warning: Reopening month {originalMonth} unfreezes financial entries, un-reconciles all reconciled statements for that month (flipping them back to open), and re-queues this operation to sync immediately.
        </div>

        <div>
          <label for="reopen-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Month Reopen Reason</label>
          <textarea
            id="reopen-reason"
            required
            rows="3"
            bind:value={reopenReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit explanation for reopening this closed calendar month..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="mastercard" type="submit" loading={isSubmitting} disabled={!reopenReason.trim()}>
            Confirm Reopen Month
          </Button>
        </div>
      </form>
    {:else if mode === 'discard'}
      <form onsubmit={handleDiscardSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-red-500/10 text-xs text-red-800">
          Caution: Discarding permanently drops this transaction from synchronization after recording an audited discard operation in the outbox.
        </div>

        <div>
          <label for="discard-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Discard Reason</label>
          <textarea
            id="discard-reason"
            required
            rows="3"
            bind:value={discardReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit justification for permanently discarding this transaction..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="mastercard" type="submit" loading={isSubmitting} disabled={!discardReason.trim()}>
            Confirm Discard
          </Button>
        </div>
      </form>
    {/if}
  </Modal>
</div>
