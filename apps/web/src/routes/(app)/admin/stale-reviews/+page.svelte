<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { formatPoishaToBdt } from '@clt/shared';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface StaleEntry {
    id: string;
    entry_number: number;
    entry_date: string;
    gross_amount: string; // Poisha decimal string
    vat_amount: string;
    net_amount: string;
    device_id: string;
    rate_profile_version: number;
    created_at: string;
  }

  let entries = $state<StaleEntry[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let reviewAction = $state<'approved' | 'rejected'>('approved');
  let selectedEntry = $state<StaleEntry | null>(null);
  let reviewReason = $state('');
  let submitting = $state(false);
  let errorMessage = $state('');

  async function loadStaleEntries() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-reviews');
      if (res.ok) {
        const data = await res.json();
        entries = data.entries ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load stale reviews';
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  function openReview(entry: StaleEntry, action: 'approved' | 'rejected') {
    selectedEntry = entry;
    reviewAction = action;
    reviewReason = action === 'approved' ? 'Offline entry verified against paper receipt' : 'Rate variance unacceptable';
    showModal = true;
  }

  async function submitReview() {
    if (!selectedEntry) return;
    submitting = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: selectedEntry.id,
          action: reviewAction,
          reason: reviewReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to submit review');
      }

      showModal = false;
      selectedEntry = null;
      await loadStaleEntries();
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      submitting = false;
    }
  }

  onMount(loadStaleEntries);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Stale Rate Review Queue</h1>
      <p class="text-sm text-[var(--muted)]">Audit high-value offline transactions (&gt;৳50,000) recorded under superseded rate profiles.</p>
    </div>
    <Button variant="default" onclick={loadStaleEntries}>Refresh Queue</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Entry #</th>
          <th class="py-3 px-4 font-semibold">Entry Date</th>
          <th class="py-3 px-4 font-semibold">Gross Amount</th>
          <th class="py-3 px-4 font-semibold">Rate Snapshot</th>
          <th class="py-3 px-4 font-semibold">Flag Reason</th>
          <th class="py-3 px-4 font-semibold text-right">Review Action</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each entries as e (e.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4 font-mono font-medium text-[var(--ink)]">#{e.entry_number}</td>
            <td class="py-3 px-4 font-mono text-xs">{e.entry_date}</td>
            <td class="py-3 px-4 font-mono font-bold text-[var(--ink)]">
              {formatPoishaToBdt(BigInt(e.gross_amount))}
            </td>
            <td class="py-3 px-4">
              <span class="font-mono text-xs text-[var(--muted)]">Profile v{e.rate_profile_version}</span>
            </td>
            <td class="py-3 px-4">
              <Chip variant="default" class="bg-amber-500/10 text-amber-800 border border-amber-500/20">&gt;৳50,000 Offline Flag</Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <div class="flex items-center justify-end gap-2">
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-green-700 border-green-500/20 hover:bg-green-500/10"
                  onclick={() => openReview(e, 'approved')}
                >
                  Approve
                </Button>
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-red-700 border-red-500/20 hover:bg-red-500/10"
                  onclick={() => openReview(e, 'rejected')}
                >
                  Void Entry
                </Button>
              </div>
            </td>
          </tr>
        {/each}
        {#if entries.length === 0 && !loading && !errorMessage}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No pending stale rate reviews in queue.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Review Action Modal -->
<Modal bind:open={showModal} title={reviewAction === 'approved' ? 'Approve Stale-Rate Entry' : 'Void Flagged Stale Entry'} onclose={() => (showModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Reviewing Entry <strong class="font-mono">#{selectedEntry?.entry_number}</strong> with gross amount
      <strong class="font-mono">{selectedEntry ? formatPoishaToBdt(BigInt(selectedEntry.gross_amount)) : ''}</strong>.
    </p>

    {#if reviewAction === 'approved'}
      <div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-800">
        Approving retains the historical snapshot calculations and clears the audit flag. Settlements will reflect these snapshot numbers.
      </div>
    {:else}
      <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800">
        Rejecting voids this entry under advisory sequence lock and recomputes monthly payable settlements. This mutation is audited.
      </div>
    {/if}

    <div>
      <label for="review-reason-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Audit Justification Note</label>
      <textarea
        id="review-reason-input"
        rows="3"
        bind:value={reviewReason}
        placeholder="Enter mandatory audit rationale..."
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      ></textarea>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class={reviewAction === 'rejected' ? 'bg-red-700 hover:bg-red-800 text-white' : ''}
        onclick={submitReview}
        disabled={submitting || !reviewReason}
      >
        {submitting ? 'Submitting...' : reviewAction === 'approved' ? 'Confirm Approval' : 'Execute Void'}
      </Button>
    </div>
  </div>
</Modal>
