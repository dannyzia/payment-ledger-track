<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db, type CachedSettlement } from '$lib/db';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    open: boolean;
    settlement: CachedSettlement;
    onclose: () => void;
    onsuccess: (settlement: CachedSettlement) => void;
  }

  let { open = $bindable(), settlement, onclose, onsuccess }: Props = $props();

  let reason = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  const surplusPoisha = $derived(
    BigInt(settlement.paid_poisha) - BigInt(settlement.expected_poisha)
  );

  $effect(() => {
    if (open) {
      reason = '';
      errorMessage = null;
    }
  });

  async function handleApprove(e: SubmitEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      errorMessage = 'Approval reason is mandatory.';
      return;
    }

    errorMessage = null;
    isSubmitting = true;

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/v1/settlements/overpayment-approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          settlementId: settlement.id,
          reason: reason.trim(),
        }),
      });

      const result = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(result.message || result.error || 'Failed to approve overpayment');
      }

      const updatedSettlement: CachedSettlement = {
        ...settlement,
        overpayment_review_status: 'approved',
        overpayment_approved_amount_poisha: surplusPoisha.toString(),
        overpayment_reason: reason.trim(),
        overpayment_approved_at: new Date().toISOString(),
      };

      await db.settlements.put(updatedSettlement);
      onsuccess(updatedSettlement);
      open = false;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Overpayment approval failed';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal bind:open title="Owner Overpayment Approval" onclose={() => { open = false; onclose(); }}>
  <div class="overpayment-modal">
    {#if errorMessage}
      <div class="p-3 mb-4 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <div class="p-4 mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5">
      <div class="text-xs text-purple-900 dark:text-purple-300 font-semibold mb-1">
        Surplus Amount to Authorize:
      </div>
      <div class="text-2xl font-bold tabular-nums text-purple-700 dark:text-purple-400">
        +{formatPoishaToBdt(surplusPoisha)}
      </div>
      <p class="text-[11px] text-purple-700/80 dark:text-purple-300/80 mt-1">
        This approval binds strictly to this exact surplus amount. If expected liabilities or payments change,
        this approval automatically invalidates (PRD §8.4, F68).
      </p>
    </div>

    <form onsubmit={handleApprove} class="space-y-4">
      <div>
        <label for="approval-reason" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Mandatory Approval Reason / Justification *
        </label>
        <textarea
          id="approval-reason"
          rows="3"
          required
          bind:value={reason}
          placeholder="State the business reason for authorizing this overpayment (e.g., Pre-payment for next billing cycle, provider adjustment fee refund)"
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="default" onclick={() => { open = false; onclose(); }} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button id="btn-submit" variant="commission" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Approving...' : 'Authorize Surplus'}
        </Button>
      </div>
    </form>
  </div>
</Modal>
