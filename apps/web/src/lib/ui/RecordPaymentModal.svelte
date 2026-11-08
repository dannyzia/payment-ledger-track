<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db, type CachedSettlementPayment, type CachedSettlement } from '$lib/db';
  import { formatPoishaToBdt, parseBdtToPoisha } from '@clt/shared';
  import { describePaymentError } from '$lib/settlements/payment-errors';

  interface Props {
    open: boolean;
    settlementId: string;
    isReversal?: boolean;
    reversesPayment?: CachedSettlementPayment | null;
    maxReversiblePoisha?: bigint | null;
    expectedPoisha?: string | null;
    paidPoisha?: string | null;
    isMonthClosed?: boolean;
    onclose: () => void;
    onsuccess: (payment: CachedSettlementPayment, settlement?: CachedSettlement) => void;
  }

  let {
    open = $bindable(),
    settlementId,
    isReversal = false,
    reversesPayment = null,
    maxReversiblePoisha = null,
    expectedPoisha = null,
    paidPoisha = null,
    isMonthClosed = false,
    onclose,
    onsuccess,
  }: Props = $props();

  // The settlement detail page can mount this modal twice (a payment and a reversal),
  // so the reversal instance namespaces its field ids to keep the DOM ids unique.
  const idPrefix = $derived(isReversal ? 'reversal-' : '');

  let amountBdt = $state('');
  let paidOn = $state(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  let reference = $state('');
  let note = $state('');
  let receiptFile = $state<File | null>(null);
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  // Initialize or reset form state whenever modal opens
  $effect(() => {
    if (open) {
      errorMessage = null;
      if (isReversal && reversesPayment) {
        // In reversal mode: default to remaining reversible balance (supports partial reversals, PRD Test #13)
        const maxReversible = maxReversiblePoisha ?? BigInt(reversesPayment.amount_poisha);
        const bdtWhole = (maxReversible / 100n).toString();
        const poishaDec = (maxReversible % 100n).toString().padStart(2, '0');
        amountBdt = `${bdtWhole}.${poishaDec}`;
        reference = reversesPayment.reference ? `REV-${reversesPayment.reference}` : 'REV';
        note = '';
      } else {
        amountBdt = '';
        reference = '';
        note = '';
        receiptFile = null;
      }
    }
  });

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      receiptFile = input.files[0];
    }
  }

  async function uploadReceipt(): Promise<string | null> {
    if (!receiptFile) return null;

    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const formData = new FormData();
    formData.append('file', receiptFile);

    const res = await fetch('/api/v1/settlements/receipts/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
      throw new Error(err.message || err.error || 'Receipt upload failed');
    }

    const data = (await res.json()) as { path?: string };
    return data.path ?? null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();

    // Closed-month policy: reversals are locked; payouts only allowed up to expected liability (PRD §7.3, §8.4)
    if (isMonthClosed && isReversal) {
      errorMessage = 'Month is closed. Payment reversals are permanently locked.';
      return;
    }

    errorMessage = null;
    isSubmitting = true;

    try {
      // Hard Rule 2: Pure integer poisha parsing via @clt/shared (zero float math).
      // parseBdtToPoisha throws on invalid input (authentic @clt/shared contract, CLT-D-018).
      let parsedPoisha: bigint;
      try {
        parsedPoisha = parseBdtToPoisha(amountBdt.trim());
      } catch {
        errorMessage = 'Please enter a valid amount greater than 0';
        isSubmitting = false;
        return;
      }
      if (parsedPoisha <= 0n) {
        errorMessage = 'Please enter a valid amount greater than 0';
        isSubmitting = false;
        return;
      }

      // Reversal limit verification: cannot reverse more than remaining balance
      if (isReversal) {
        const maxAllowed = maxReversiblePoisha ?? (reversesPayment ? BigInt(reversesPayment.amount_poisha) : 0n);
        if (parsedPoisha > maxAllowed) {
          errorMessage = `Reversal amount cannot exceed remaining reversible balance (${formatPoishaToBdt(maxAllowed)})`;
          isSubmitting = false;
          return;
        }
      }

      // Closed month payout policy: cannot exceed remaining expected liability
      if (isMonthClosed) {
        const remainingLiability = BigInt(expectedPoisha ?? '0') - BigInt(paidPoisha ?? '0');
        if (remainingLiability <= 0n) {
          errorMessage = 'Month is closed and liability is fully settled. No additional payments allowed.';
          isSubmitting = false;
          return;
        }
        if (parsedPoisha > remainingLiability) {
          errorMessage = `On closed months, payments cannot exceed remaining liability (${formatPoishaToBdt(remainingLiability)}). Overpayments are prohibited.`;
          isSubmitting = false;
          return;
        }
      }

      const amountPoisha = parsedPoisha.toString();

      let receiptPath: string | null = null;
      if (receiptFile) {
        receiptPath = await uploadReceipt();
      }

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/v1/settlements/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          settlementId,
          amountPoisha,
          paidOn,
          reference: reference.trim() || null,
          receiptPath,
          note: note.trim() || null,
          isReversal,
          reversesId: isReversal && reversesPayment ? reversesPayment.id : null,
        }),
      });

      const result = (await res.json()) as {
        message?: string;
        error?: string;
        settlement?: CachedSettlement;
        payment?: CachedSettlementPayment;
        paymentId?: string;
      };
      if (!res.ok) {
        throw new Error(describePaymentError(result));
      }

      // If server returned updated settlement, update local Dexie immediately
      if (result.settlement) {
        await db.settlements.put(result.settlement);
      }

      // Populate local Dexie payment table immediately for reactive UI update
      const newPayment: CachedSettlementPayment = result.payment ?? {
        id: result.paymentId ?? crypto.randomUUID(),
        settlement_id: settlementId,
        amount_poisha: amountPoisha,
        paid_on: paidOn,
        reference: reference.trim() || undefined,
        receipt_storage_path: receiptPath ?? undefined,
        note: note.trim() || undefined,
        is_reversal: isReversal,
        reverses_payment_id: isReversal && reversesPayment ? reversesPayment.id : undefined,
        created_at: new Date().toISOString(),
      };

      await db.settlementPayments.put(newPayment);
      onsuccess(newPayment, result.settlement);
      open = false;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Payment submission failed';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal bind:open title={isReversal ? 'Record Payment Reversal' : 'Record Settlement Payment'} onclose={() => { open = false; onclose(); }}>
  <div class="record-payment-modal">
    {#if isMonthClosed}
      <div class="p-3 mb-4 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold">
        🔒 Month is closed. {isReversal ? 'Reversals are permanently locked.' : 'Only payments settling remaining liability are permitted.'}
      </div>
    {/if}

    {#if errorMessage}
      <div class="p-3 mb-4 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleSubmit} class="space-y-4">
      <div>
        <label for={`${idPrefix}pay-amount`} class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Amount (BDT)
        </label>
        <input
          id={`${idPrefix}pay-amount`}
          type="text"
          inputmode="decimal"
          required
          disabled={isMonthClosed && isReversal}
          bind:value={amountBdt}
          placeholder="0.00"
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-60"
        />
        {#if isReversal && reversesPayment}
          <p class="text-[10px] text-[var(--muted)] mt-1">Reversal up to remaining balance: {formatPoishaToBdt(maxReversiblePoisha ?? BigInt(reversesPayment.amount_poisha))}.</p>
        {/if}
      </div>

      <div>
        <label for={`${idPrefix}pay-date`} class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Payment Date
        </label>
        <input
          id={`${idPrefix}pay-date`}
          type="date"
          required
          disabled={isMonthClosed && isReversal}
          bind:value={paidOn}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <div>
        <label for={`${idPrefix}pay-ref`} class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Transaction Reference / Bank Slip #
        </label>
        <input
          id={`${idPrefix}pay-ref`}
          type="text"
          disabled={isMonthClosed && isReversal}
          bind:value={reference}
          placeholder="e.g. TXN-100234, Cheque #4920"
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {#if !isReversal}
        <div>
          <label for={`${idPrefix}pay-file`} class="block text-xs font-semibold text-[var(--muted)] mb-1">
            Receipt Image or PDF (Max 5 MB)
          </label>
          <input
            id={`${idPrefix}pay-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={isMonthClosed && isReversal}
            onchange={handleFileChange}
            class="w-full text-xs text-[var(--muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--accent)]/10 file:text-[var(--accent)] hover:file:bg-[var(--accent)]/20 cursor-pointer"
          />
        </div>
      {/if}

      <div>
        <label for={`${idPrefix}pay-note`} class="block text-xs font-semibold text-[var(--muted)] mb-1">
          {isReversal ? 'Mandatory Reversal Reason *' : 'Notes'}
        </label>
        <textarea
          id={`${idPrefix}pay-note`}
          rows="2"
          required={isReversal}
          disabled={isMonthClosed && isReversal}
          bind:value={note}
          placeholder={isReversal ? 'Provide reason for reversing this payment (mandatory audit trail)' : 'Optional notes regarding settlement'}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="default" onclick={() => { open = false; onclose(); }} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button id={`${idPrefix}btn-submit`} variant="commission" type="submit" disabled={isSubmitting || (isMonthClosed && isReversal)}>
          {isSubmitting ? 'Recording...' : isReversal ? 'Confirm Reversal' : 'Record Payment'}
        </Button>
      </div>
    </form>
  </div>
</Modal>
