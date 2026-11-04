<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';

  interface Props {
    open: boolean;
    isAdmin: boolean;
    isApproval?: boolean;
    existingReason?: string;
    onclose: () => void;
    onsubmit: (reason: string) => Promise<void>;
  }

  let {
    open = $bindable(false),
    isAdmin,
    isApproval = false,
    existingReason = '',
    onclose,
    onsubmit,
  }: Props = $props();

  let reason = $state('');
  let isSubmitting = $state(false);

  $effect(() => {
    if (open) {
      reason = existingReason || '';
      isSubmitting = false;
    }
  });

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!reason.trim() || isSubmitting) return;
    void submit();
  }

  async function submit() {
    isSubmitting = true;
    try {
      await onsubmit(reason.trim());
      onclose();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="void-modal-wrapper">
  <Modal
    bind:open
    title={isApproval ? 'Approve Void Request' : isAdmin ? 'Confirm Direct Void' : 'Request Transaction Void'}
    {onclose}
  >
    <form onsubmit={handleSubmit} class="flex flex-col gap-4">
      <p class="text-xs text-[var(--muted)] leading-relaxed">
        {#if isApproval}
          Staff has requested this entry to be voided. Confirming will mark it as voided and exclude it from reports.
        {:else if isAdmin}
          Directly voiding this transaction will exclude it from reports and mark it as voided. Entries are never hard-deleted.
        {:else}
          Staff void requests require Administrator approval before taking effect.
        {/if}
      </p>

      <div class="flex flex-col gap-1.5">
        <label for="void-reason" class="text-xs font-semibold text-[var(--ink)]">
          Audit Justification <span class="text-red-500">*</span>
        </label>
        <textarea
          id="void-reason"
          required
          rows="3"
          bind:value={reason}
          class="w-full px-4 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/50 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="State the audit justification for voiding this transaction..."
        ></textarea>
      </div>

      <div class="flex justify-end gap-3 mt-2">
        <Button variant="default" type="button" onclick={onclose}>Cancel</Button>
        <Button variant="default" type="submit" disabled={!reason.trim() || isSubmitting}>
          {isSubmitting ? 'Submitting...' : isApproval ? 'Approve Void' : isAdmin ? 'Confirm Void' : 'Submit Request'}
        </Button>
      </div>
    </form>
  </Modal>
</div>
