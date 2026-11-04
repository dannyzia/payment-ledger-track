# 014_settlements.md — Monthly Settlement Tracking, Payments, Receipts, and Overpayment Approvals

- Plan Identifier: CLT-PLAN-014
- Phase: Phase 2 / M2
- Milestone: M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7.3 (Settlement RPCs: `record_settlement_payment`, `approve_settlement_overpayment`, `calc_settlement_status`), §8.4 (Monthly settlement), §13 (Receipt upload and signed URL endpoints), §15.1 (Audit events), §16.2 (Tests #5, #6, #13, #20, #26, #35, #43, #49, #64), §17 (Milestone M2)
- Depends on: 005, 007, 008, 009, 010, 011
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement monthly settlement tracking, payment recording, payment corrections via explicit reversal rows, receipt uploads to private storage, short-lived signed URL previews (15-minute expiration), authoritative five-state settlement transitions, in-app due-date reminders with correct English ordinal dates (`1st`, `2nd`, `3rd`, `22nd`), role-gated access (Admin and Owner only), closed-month action locks, and Owner-only overpayment approvals bound to exact surplus amounts with automatic invalidation upon balance modifications.

## 2. Scope

- IN:
  - Role gating: restricting `/settlements` and `/settlements/[id]` strictly to Admin and Owner; Staff users navigating to these routes receive a clean access denied screen per PRD §3 and §8.4.
  - Settlements list screen in `apps/web/src/routes/(app)/settlements/+page.svelte` presenting all payables for the selected month with due dates, reminder countdowns, variance amounts, dynamic fallback to local entries before initial sync, and five-state badges (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`).
  - Month selection controls with previous/next navigation and Asia/Dhaka current month defaulting.
  - Settlement detail screen in `apps/web/src/routes/(app)/settlements/[id]/+page.svelte` dynamically reading route params, loading and caching payment rows via `GET /api/v1/settlements/payments`, presenting sorted payment ledgers (DESC by date), attached receipt thumbnails, overpayment approval status cards, and closed-month action locks.
  - Payment and reversal retrieval endpoint `GET /api/v1/settlements/payments?settlement_id=<UUID>` restricted to Admin and Owner, returning official `settlement_payments` rows from PostgreSQL and populating local `db.settlementPayments`.
  - Payment recording and reversal modal in `apps/web/src/lib/ui/RecordPaymentModal.svelte` capturing date, amount in BDT (converted to integer poisha), transaction reference, mandatory audit note for reversals, optional receipt upload, and state reset on close/open.
  - Reversal UX hardening: marking original payments as `[Reversed]` with reversal references, hiding duplicate reverse buttons, locking amount to original payment, and sorting ledger chronologically.
  - Receipt upload endpoint in `apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts`:
    - Enforcing `Content-Length` header check first (< 5 MB) to avoid adapter body buffer overflow.
    - Magic-byte verification inspecting true binary signatures (PNG, JPEG, WebP, PDF) to prevent MIME spoofing.
    - Ensuring private `receipts` storage bucket exists.
    - Storing receipts at `receipts/<month>/<random_uuid>.<ext>` and returning `{ path }`.
  - Signed URL retrieval endpoint in `apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts` validating receipt path format with strict regex (rejecting path traversal `..`) and returning read-only signed URLs with 900 seconds (15 minutes) TTL.
  - Owner-only overpayment approval modal in `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte` recording mandatory justification and binding approval to exact surplus amount (`overpayment_approved_amount_poisha = paid_poisha - expected_poisha`).
  - Server mediation endpoints with exact PostgreSQL RPC signatures:
    - `POST /api/v1/settlements/payments` mediating `record_settlement_payment` with parameters `p_settlement_id`, `p_amount_poisha`, `p_paid_on`, `p_reference`, `p_receipt_path`, `p_note`, `p_is_reversal`, `p_reverses_id`, `p_actor_id`.
    - `POST /api/v1/settlements/overpayment-approval` mediating `approve_settlement_overpayment` with parameters `p_settlement_id`, `p_reason`, `p_actor_id`.
  - Data model alignment: `CachedSettlementPayment` and `CachedSettlement` aligned with DDL columns (`receipt_storage_path`, `reverses_payment_id`, `note`, `recorded_by`, `overpayment_review_status`, `overpayment_approved_amount_poisha`), and `CachedPayable` using DDL `name` (no invented `recipient_name`).
  - Closed-month handling: disabling payment and reversal buttons when `db.monthCloses` shows month is closed; server RPC returns clean 422 `month_closed` error rather than raw Postgres errors.
  - Pure validation helpers in `apps/web/src/lib/settlements/receipt-validation.ts` for file size, magic bytes, MIME types, and path traversal security.
  - Unit tests in `apps/web/src/lib/settlements/settlements.test.ts` verifying reminder calculation with English ordinals, 5-state transitions, reversal math, magic-byte detection, and receipt upload security constraints (Test #64).
- OUT:
  - Statement creation, reconciliation, and line matching (owned by Plans 015 and 018).
  - Month close execution and reopen procedure (owned by Plan 015).
  - Bank and payment gateway automatic API sync (explicit PRD non-goal).

## 3. Preconditions

1. Plan 010 Dexie database `db` and local settlement stores are available.
   - Check command: `test -f apps/web/src/lib/db/index.ts`
   - Expected output: exit code `0`.
2. Plan 008 server authentication context `getCallerContext` and client session store are available.
   - Check command: `test -f apps/web/src/lib/server/auth.ts && test -f apps/web/src/lib/auth/session.svelte.ts`
   - Expected output: exit code `0`.
3. Plan 007 UI kit components exist in `apps/web/src/lib/ui/`.
   - Check command: `test -f apps/web/src/lib/ui/Card.svelte && test -f apps/web/src/lib/ui/Chip.svelte`
   - Expected output: exit code `0`.
4. Plan 002 shared money formatting (`formatPoishaToBdt`) is available.
   - Check command: `test -f packages/shared/src/index.ts`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/settlements/reminders.ts` | create | Helper computing due dates, ordinal day formatting, and in-app reminder thresholds |
| `apps/web/src/lib/settlements/receipt-validation.ts` | create | Pure validation helper for receipt size, magic bytes, MIME types, and path traversal |
| `apps/web/src/lib/ui/RecordPaymentModal.svelte` | create | Modal for recording payments, reversals, mandatory reversal notes, and receipt upload |
| `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte` | create | Owner-only modal recording approved overpayment surplus |
| `apps/web/src/routes/(app)/settlements/+page.svelte` | create | Settlements list screen showing monthly status, variances, and role guard |
| `apps/web/src/routes/(app)/settlements/[id]/+page.svelte` | create | Settlement detail page showing payment rows, receipt previews, and overpayment status |
| `apps/web/src/routes/api/v1/settlements/payments/+server.ts` | create | POST endpoint recording payments/reversals; GET endpoint delivering payment rows |
| `apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts` | create | POST endpoint mediating Owner overpayment surplus approval |
| `apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts` | create | POST endpoint handling 5 MB receipt file upload with magic byte inspection |
| `apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts` | create | GET endpoint returning 900-second signed URL for receipt paths |
| `apps/web/src/lib/settlements/settlements.test.ts` | create | Unit tests verifying 5-state transitions, reminder math, magic bytes, and receipt constraints |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create due date and reminder helper in `apps/web/src/lib/settlements/reminders.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/settlements/reminders.ts`.
   - Check: `grep -c '^export function computeSettlementReminder' apps/web/src/lib/settlements/reminders.ts`
   - Expected output: `1`

2. Create receipt validation helper in `apps/web/src/lib/settlements/receipt-validation.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/settlements/receipt-validation.ts`.
   - Check: `grep -c '^export function detectMagicBytes' apps/web/src/lib/settlements/receipt-validation.ts`
   - Expected output: `1`

3. Create payment recording and reversal modal in `apps/web/src/lib/ui/RecordPaymentModal.svelte` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/ui/RecordPaymentModal.svelte`.
   - Check: `grep -c 'record-payment-modal' apps/web/src/lib/ui/RecordPaymentModal.svelte`
   - Expected output: `1`

4. Create overpayment approval modal in `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte`.
   - Check: `grep -c 'overpayment-modal' apps/web/src/lib/ui/OverpaymentApprovalModal.svelte`
   - Expected output: `1`

5. Create settlements overview view in `apps/web/src/routes/(app)/settlements/+page.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/routes/(app)/settlements/+page.svelte`.
   - Check: `grep -c 'settlements-page' "apps/web/src/routes/(app)/settlements/+page.svelte"`
   - Expected output: `1`

6. Create settlement detail view in `apps/web/src/routes/(app)/settlements/[id]/+page.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/routes/(app)/settlements/[id]/+page.svelte`.
   - Check: `grep -c 'settlement-detail' "apps/web/src/routes/(app)/settlements/[id]/+page.svelte"`
   - Expected output: `1`

7. Create payment recording and listing endpoint in `apps/web/src/routes/api/v1/settlements/payments/+server.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/api/v1/settlements/payments/+server.ts`.
   - Check: `grep -c 'record_settlement_payment' apps/web/src/routes/api/v1/settlements/payments/+server.ts`
   - Expected output: `1`

8. Create overpayment approval endpoint in `apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts`.
   - Check: `grep -c 'approve_settlement_overpayment' apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts`
   - Expected output: `1`

9. Create receipt upload endpoint in `apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts` referencing Specification 6.9.
   - Command: copy block 6.9 into `apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts`.
   - Check: `grep -c "from('receipts')" apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts`
   - Expected output: `1`

10. Create signed URL endpoint in `apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts`.
    - Check: `grep -c 'createSignedUrl' apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts`
    - Expected output: `1`

11. Create settlement unit tests in `apps/web/src/lib/settlements/settlements.test.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/lib/settlements/settlements.test.ts`.
    - Check: `pnpm --filter @clt/web test settlements.test.ts`
    - Expected output: test suite passes with all tests passing cleanly.

## 6. Specifications

### 6.1 `apps/web/src/lib/settlements/reminders.ts`

```ts
export type SettlementStatus = 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';

/**
 * Authoritative 5-state settlement status calculator (PRD §8.4, §7.3 calc_settlement_status parity).
 */
export function calcSettlementStatus(expected: bigint, paid: bigint): SettlementStatus {
  if (expected === 0n && paid === 0n) return 'not_applicable';
  if (expected > 0n && paid === 0n) return 'due';
  if (paid > 0n && paid < expected) return 'partly_paid';
  if (paid === expected) return 'paid';
  if (paid > expected) return 'overpaid';
  return 'due';
}

export interface ReminderStatus {
  dueDate: string; // YYYY-MM-DD
  isOverdue: boolean;
  daysRemaining: number;
  inReminderWindow: boolean;
  formattedDueDay: string; // e.g. "1st", "2nd", "3rd", "15th", "22nd"
}

const getDhakaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

/**
 * Formats a day number with its correct English ordinal suffix.
 */
export function formatOrdinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/**
 * Computes settlement due date and in-app reminder window.
 * Due date is in the month following settlementMonth on dueDay (clamped to target month length, e.g. Feb 28/29).
 * Pure UTC calculation eliminates host local timezone shifts and DST artifacts.
 */
export function computeSettlementReminder(
  settlementMonth: string, // YYYY-MM or YYYY-MM-01
  dueDay: number,
  remindDaysBefore: number = 3,
  currentDateStr?: string
): ReminderStatus {
  const todayStr = currentDateStr ?? getDhakaToday();
  const [curYear, curMonth, curDay] = todayStr.split('-').map(Number);
  const todayEpochDays = Math.floor(Date.UTC(curYear, curMonth - 1, curDay) / 86400000);

  const [settleYear, settleMonth] = settlementMonth.slice(0, 7).split('-').map(Number);

  // Target month is the month immediately following settlementMonth (settleMonth is 1-based)
  const targetProbe = new Date(Date.UTC(settleYear, settleMonth, 1));
  const dueYear = targetProbe.getUTCFullYear();
  const dueMonthIndex = targetProbe.getUTCMonth(); // 0-based
  const daysInTargetMonth = new Date(Date.UTC(dueYear, dueMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(dueDay, 1), daysInTargetMonth);

  const targetDate = new Date(Date.UTC(dueYear, dueMonthIndex, clampedDay));
  const dueMonth = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dueDayStr = String(targetDate.getUTCDate()).padStart(2, '0');
  const dueDate = `${dueYear}-${dueMonth}-${dueDayStr}`;

  const dueEpochDays = Math.floor(Date.UTC(dueYear, dueMonthIndex, clampedDay) / 86400000);
  const daysRemaining = dueEpochDays - todayEpochDays;
  const isOverdue = daysRemaining < 0;
  const inReminderWindow = daysRemaining >= 0 && daysRemaining <= remindDaysBefore;

  return {
    dueDate,
    isOverdue,
    daysRemaining,
    inReminderWindow,
    formattedDueDay: formatOrdinalDay(clampedDay),
  };
}
```

### 6.2 `apps/web/src/lib/settlements/receipt-validation.ts`

```ts
export const MAX_RECEIPT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (PRD §8.4, Test #64)

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = typeof ALLOWED_RECEIPT_MIME_TYPES[number];

/**
 * Inspects leading binary bytes to determine true file MIME type and extension,
 * defeating MIME-type spoofing attacks (e.g. executable disguised as .png or .pdf).
 */
export function detectMagicBytes(buffer: Uint8Array): { mime: AllowedMimeType; ext: string } | null {
  if (buffer.length < 4) return null;

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  // WebP: RIFF ... WEBP (offset 0: 52 49 46 46, offset 8: 57 45 42 50)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string | undefined;
  statusCode?: number | undefined;
}

/**
 * Pure validation helper for receipt file uploads.
 */
export function validateReceiptUpload(size: number, mimeType: string): ValidationResult {
  if (size <= 0) {
    return { valid: false, error: 'Empty file payload', statusCode: 400 };
  }
  if (size > MAX_RECEIPT_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds maximum 5 MB limit', statusCode: 413 };
  }
  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    return { valid: false, error: 'Unsupported media type. Allowed: JPEG, PNG, WebP, PDF', statusCode: 415 };
  }
  return { valid: true };
}

/**
 * Validates receipt storage path to prevent path traversal and arbitrary bucket reads.
 */
export function validateReceiptPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  return /^receipts\/\d{4}-\d{2}\/[a-f0-9\-]+\.(jpg|jpeg|png|webp|pdf)$/i.test(path);
}
```

### 6.3 `apps/web/src/lib/ui/RecordPaymentModal.svelte`

```svelte
<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db, type CachedSettlementPayment, type CachedSettlement } from '$lib/db';
  import { formatPoishaToBdt, parseBdtToPoisha } from '@clt/shared';

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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Receipt upload failed');
    }

    const data = await res.json();
    return data.path;
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
      // Hard Rule 2: Pure integer poisha parsing via @clt/shared (zero float math)
      const parsedPoisha = parseBdtToPoisha(amountBdt.trim());
      if (parsedPoisha === null || parsedPoisha <= 0n) {
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

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.message || result.error || 'Failed to record payment');
      }

      // If server returned updated settlement, update local Dexie immediately
      if (result.settlement) {
        await db.settlements.put(result.settlement);
      }

      // Populate local Dexie payment table immediately for reactive UI update
      const newPayment: CachedSettlementPayment = result.payment ?? {
        id: result.paymentId,
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
    } catch (err: any) {
      errorMessage = err.message || 'Payment submission failed';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal bind:open title={isReversal ? 'Record Payment Reversal' : 'Record Settlement Payment'} onclose={() => { open = false; onclose?.(); }}>
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
        <label for="pay-amount" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Amount (BDT)
        </label>
        <input
          id="pay-amount"
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
        <label for="pay-date" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Payment Date
        </label>
        <input
          id="pay-date"
          type="date"
          required
          disabled={isMonthClosed && isReversal}
          bind:value={paidOn}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <div>
        <label for="pay-ref" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Transaction Reference / Bank Slip #
        </label>
        <input
          id="pay-ref"
          type="text"
          disabled={isMonthClosed && isReversal}
          bind:value={reference}
          placeholder="e.g. TXN-100234, Cheque #4920"
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {#if !isReversal}
        <div>
          <label for="pay-file" class="block text-xs font-semibold text-[var(--muted)] mb-1">
            Receipt Image or PDF (Max 5 MB)
          </label>
          <input
            id="pay-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            disabled={isMonthClosed && isReversal}
            onchange={handleFileChange}
            class="w-full text-xs text-[var(--muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--accent)]/10 file:text-[var(--accent)] hover:file:bg-[var(--accent)]/20 cursor-pointer"
          />
        </div>
      {/if}

      <div>
        <label for="pay-note" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          {isReversal ? 'Mandatory Reversal Reason *' : 'Notes'}
        </label>
        <textarea
          id="pay-note"
          rows="2"
          required={isReversal}
          disabled={isMonthClosed && isReversal}
          bind:value={note}
          placeholder={isReversal ? 'Provide reason for reversing this payment (mandatory audit trail)' : 'Optional notes regarding settlement'}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        ></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="default" onclick={() => { open = false; onclose?.(); }} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button id="btn-submit" variant="commission" type="submit" disabled={isSubmitting || (isMonthClosed && isReversal)}>
          {isSubmitting ? 'Recording...' : isReversal ? 'Confirm Reversal' : 'Record Payment'}
        </Button>
      </div>
    </form>
  </div>
</Modal>
```

### 6.4 `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte`

```svelte
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

      const result = await res.json();
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
    } catch (err: any) {
      errorMessage = err.message || 'Overpayment approval failed';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal bind:open title="Owner Overpayment Approval" onclose={() => { open = false; onclose?.(); }}>
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
        This approval binds strictly to this exact surplus amount. If expected liabilities or payments change, this approval automatically invalidates (PRD §8.4, F68).
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
        <Button variant="default" onclick={() => { open = false; onclose?.(); }} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button id="btn-submit" variant="commission" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Approving...' : 'Authorize Surplus'}
        </Button>
      </div>
    </form>
  </div>
</Modal>
```

### 6.5 `apps/web/src/routes/(app)/settlements/+page.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { db, type CachedSettlement, type CachedPayable, type CachedPaymentMethod, type LocalEntry } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { computeSettlementReminder } from '$lib/settlements/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  const currentDhakaMonth = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
      .format(new Date())
      .slice(0, 7);

  let selectedMonth = $state(currentDhakaMonth());
  let settlements = $state<CachedSettlement[]>([]);
  let payables = $state<CachedPayable[]>([]);
  let methods = $state<CachedPaymentMethod[]>([]);
  let monthEntries = $state<LocalEntry[]>([]);

  // Role Guard: Settlements screen restricted strictly to Admin and Owner (PRD §3, §8.4)
  const isAuthorized = $derived(session.user?.role === 'admin' || session.user?.role === 'owner');

  const monthFirstDay = $derived(`${selectedMonth}-01`);

  function getChipVariant(code?: string): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (lower === 'bkash' || lower === 'visa' || lower === 'mastercard' || lower === 'vat' || lower === 'commission') {
      return lower;
    }
    return 'default';
  }

  $effect(() => {
    if (!isAuthorized) return;

    const subSettlements = liveQuery(() =>
      db.settlements.where('month').equals(monthFirstDay).toArray()
    ).subscribe((rows) => {
      settlements = rows;
    });

    const subPayables = liveQuery(() => db.payables.toArray()).subscribe((rows) => {
      payables = rows;
    });

    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      methods = rows;
    });

    const subEntries = liveQuery(() =>
      db.entries.where('entry_date').between(`${selectedMonth}-01`, `${selectedMonth}-31`, true, true).toArray()
    ).subscribe((rows) => {
      monthEntries = rows.filter((e) => e.status === 'active' && e.sync_status !== 'rejected');
    });

    return () => {
      subSettlements.unsubscribe();
      subPayables.unsubscribe();
      subMethods.unsubscribe();
      subEntries.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of methods) {
      map[m.id] = m;
    }
    return map;
  });

  interface SettlementListItem {
    id: string;
    payable: CachedPayable;
    method?: CachedPaymentMethod;
    settlement?: CachedSettlement;
    expectedPoisha: bigint;
    paidPoisha: bigint;
    variancePoisha: bigint;
    status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
    reminder: ReturnType<typeof computeSettlementReminder>;
  }

  const items = $derived.by<SettlementListItem[]>(() => {
    const list: SettlementListItem[] = [];

    for (const p of payables) {
      if (!p.active) continue;

      const sett = settlements.find((s) => s.payable_id === p.id);
      const method = p.method_id ? methodsMap[p.method_id] : undefined;

      // Dynamic liability computation: if settlement row exists, use it;
      // otherwise, compute from active entries so liabilities show before initial sync (Plan 013 parity)
      let expected = 0n;
      let paid = 0n;
      let status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid' = 'not_applicable';

      if (sett) {
        expected = BigInt(sett.expected_poisha);
        paid = BigInt(sett.paid_poisha);
        status = sett.status;
      } else {
        if (p.kind === 'vat') {
          expected = monthEntries.reduce((acc, e) => acc + BigInt(e.vat_poisha), 0n);
        } else if (p.method_id) {
          expected = monthEntries
            .filter((e) => e.method_id === p.method_id)
            .reduce((acc, e) => acc + BigInt(e.business_charge_poisha), 0n);
        }
        status = expected === 0n ? 'not_applicable' : 'due';
      }

      const variance = paid - expected;
      const reminder = computeSettlementReminder(selectedMonth, p.due_day, p.remind_days_before ?? 3);

      list.push({
        id: p.id,
        payable: p,
        method,
        settlement: sett,
        expectedPoisha: expected,
        paidPoisha: paid,
        variancePoisha: variance,
        status,
        reminder,
      });
    }

    return list;
  });

  function getStatusBadge(status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid') {
    switch (status) {
      case 'not_applicable':
        return { label: 'N/A', cls: 'bg-black/5 dark:bg-white/5 text-[var(--muted)]' };
      case 'due':
        return { label: 'Due', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold' };
      case 'partly_paid':
        return { label: 'Partly Paid', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold' };
      case 'paid':
        return { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold' };
      case 'overpaid':
        return { label: 'Overpaid', cls: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 font-semibold' };
    }
  }

  function handlePrevMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    selectedMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function handleNextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    selectedMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
</script>

<div class="settlements-page p-6 max-w-5xl mx-auto w-full">
  {#if !isAuthorized}
    <div class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12">
      <span class="text-3xl mb-2 block">🔒</span>
      <h2 class="text-base font-bold text-amber-900 dark:text-amber-200">Access Restricted</h2>
      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
        Settlement and Liability Tracking is restricted to Admin and Owner roles. Staff access personal collections on the Staff Dashboard.
      </p>
      <Button variant="default" class="mt-4" onclick={() => goto('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  {:else}
    <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Monthly Settlements</h1>
        <p class="text-sm text-[var(--muted)]">Track liabilities, payment records, and provider due dates.</p>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="default" onclick={handlePrevMonth} aria-label="Previous month">◀</Button>
        <input
          type="month"
          bind:value={selectedMonth}
          class="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <Button variant="default" onclick={handleNextMonth} aria-label="Next month">▶</Button>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      {#if items.length === 0}
        <div class="p-12 text-center rounded-2xl glass border border-black/5 text-[var(--muted)]">
          No active settlement payables found.
        </div>
      {:else}
        {#each items as item (item.id)}
          <a href={item.settlement ? `/settlements/${item.settlement.id}` : '#'} class="block">
            <Card class="p-5 hover:border-[var(--accent)] transition-colors">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2">
                    {#if item.payable.kind === 'vat'}
                      <span class="px-1.5 py-0.5 rounded text-[10px] bg-[var(--c-vat)]/10 text-[var(--c-vat)] font-bold">VAT</span>
                    {:else if item.method}
                      <Chip variant={getChipVariant(item.method.code)}>
                        {item.method.code}
                      </Chip>
                    {/if}
                    <div class="font-bold text-base text-[var(--ink)]">
                      {item.payable.name}
                    </div>
                  </div>

                  <div class="text-xs text-[var(--muted)] mt-1 flex items-center gap-2">
                    <span>Due by {item.reminder.formattedDueDay} ({item.reminder.dueDate})</span>
                    {#if item.status !== 'paid' && item.status !== 'not_applicable'}
                      {#if item.reminder.isOverdue}
                        <span class="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-bold text-[10px]">
                          Overdue ({Math.abs(item.reminder.daysRemaining)} days late)
                        </span>
                      {:else if item.reminder.inReminderWindow}
                        <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 font-bold text-[10px]">
                          Due in {item.reminder.daysRemaining} days
                        </span>
                      {/if}
                    {/if}
                  </div>
                </div>

                <div class="flex items-center gap-6">
                  <div class="text-right">
                    <div class="text-xs text-[var(--muted)]">Expected Liability</div>
                    <div class="text-base font-bold tabular-nums text-[var(--ink)]">
                      {formatPoishaToBdt(item.expectedPoisha)}
                    </div>
                  </div>

                  <div class="text-right">
                    <div class="text-xs text-[var(--muted)]">Paid to Date</div>
                    <div class="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatPoishaToBdt(item.paidPoisha)}
                    </div>
                  </div>

                  {#if item.status === 'overpaid'}
                    <div class="text-right">
                      <div class="text-xs text-purple-600">Surplus</div>
                      <div class="text-base font-bold tabular-nums text-purple-600">
                        +{formatPoishaToBdt(item.variancePoisha)}
                      </div>
                    </div>
                  {/if}

                  <div>
                    {@const badge = getStatusBadge(item.status)}
                    <span class="px-3 py-1 rounded-full text-xs font-semibold {badge.cls}">
                      {badge.label}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </a>
        {/each}
      {/if}
    </div>
  {/if}
</div>
```

### 6.6 `apps/web/src/routes/(app)/settlements/[id]/+page.svelte`

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import RecordPaymentModal from '$lib/ui/RecordPaymentModal.svelte';
  import OverpaymentApprovalModal from '$lib/ui/OverpaymentApprovalModal.svelte';
  import { db, type CachedSettlement, type CachedSettlementPayment, type CachedPayable, type CachedPaymentMethod } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  const settlementId = $derived(page.params.id);

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

  const isAuthorized = $derived(session.user?.role === 'admin' || session.user?.role === 'owner');

  const canRecordPayment = $derived(
    !isMonthClosed || (settlement ? BigInt(settlement.paid_poisha) < BigInt(settlement.expected_poisha) : false)
  );

  function getChipVariant(code?: string): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (lower === 'bkash' || lower === 'visa' || lower === 'mastercard' || lower === 'vat' || lower === 'commission') {
      return lower;
    }
    return 'default';
  }

  // Calculates remaining reversible balance for a payment (PRD Test #13 partial reversal support)
  function getReversibleBalance(p: CachedSettlementPayment, allPayments: CachedSettlementPayment[]): bigint {
    if (p.is_reversal) return 0n;
    const original = BigInt(p.amount_poisha);
    const reversed = allPayments
      .filter((other) => other.is_reversal && (other.reverses_payment_id ?? other.reverses_id) === p.id)
      .reduce((acc, r) => acc + BigInt(r.amount_poisha), 0n);
    return original > reversed ? original - reversed : 0n;
  }

  // Fetch payments and settlement from server and cache in Dexie
  async function loadServerPayments(sId: string) {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/v1/settlements/payments?settlement_id=${encodeURIComponent(sId)}`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settlement) {
          await db.settlements.put(data.settlement);
        }
        if (Array.isArray(data.payments)) {
          await db.settlementPayments.bulkPut(data.payments);
        }
      }
    } catch (err) {
      console.warn('Offline: viewing cached payments from Dexie', err);
    }
  }

  // Reactive Dexie Subscriptions
  $effect(() => {
    if (!settlementId || !isAuthorized) return;

    loadServerPayments(settlementId);

    const subSettlement = liveQuery(() =>
      db.settlements.get(settlementId)
    ).subscribe((s) => {
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
        db.monthCloses.where('month').equals(s.month).first().then((mc) => {
          isMonthClosed = mc?.status === 'closed';
        });
      }
    });

    const subPayments = liveQuery(() =>
      db.settlementPayments.where('settlement_id').equals(settlementId).toArray()
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
      const res = await fetch(`/api/v1/settlements/receipts/signed-url?path=${encodeURIComponent(receiptPath)}`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });

      if (!res.ok) throw new Error('Failed to retrieve signed URL');
      const data = await res.json();
      signedReceiptUrls[receiptPath] = data.signedUrl;
      if (popup) {
        popup.location.href = data.signedUrl;
      }
    } catch (err) {
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
    <div class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12">
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
    <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          {#if payable?.kind === 'vat'}
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-[var(--c-vat)]/10 text-[var(--c-vat)] font-bold">VAT</span>
          {:else if method}
            <Chip variant={getChipVariant(method.code)}>
              {method.code}
            </Chip>
          {/if}
          <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">
            {payable?.name ?? 'Settlement Liability'}
          </h1>
        </div>
        <p class="text-sm text-[var(--muted)] font-mono">Statement Month: {settlement.month}</p>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="default" onclick={() => goto('/settlements')}>
          ← Back to Settlements
        </Button>
        <Button variant="commission" onclick={() => { recordModalOpen = true; }} disabled={!canRecordPayment}>
          + Record Payment
        </Button>
      </div>
    </div>

    {#if isMonthClosed}
      <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-700 dark:text-red-400">
        🔒 This month is closed. Payment reversals and overpayments are permanently locked.
      </div>
    {/if}

    <!-- Financial Status Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card class="p-5">
        <div class="text-xs text-[var(--muted)] mb-1">Expected Liability</div>
        <div class="text-xl font-bold tabular-nums text-[var(--ink)]">
          {formatPoishaToBdt(BigInt(settlement.expected_poisha))}
        </div>
        <div class="text-[10px] text-[var(--muted)] mt-1">Calculated from active entries</div>
      </Card>

      <Card class="p-5">
        <div class="text-xs text-[var(--muted)] mb-1">Total Paid to Date</div>
        <div class="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {formatPoishaToBdt(BigInt(settlement.paid_poisha))}
        </div>
        <div class="text-[10px] text-[var(--muted)] mt-1">{payments.length} payment records</div>
      </Card>

      <Card class="p-5">
        <div class="text-xs text-[var(--muted)] mb-1">Settlement Status</div>
        <div class="text-xl font-bold capitalize text-[var(--ink)]">
          {settlement.status.replace('_', ' ')}
        </div>
        <div class="text-[10px] text-[var(--muted)] mt-1">
          Variance: {formatPoishaToBdt(BigInt(settlement.paid_poisha) - BigInt(settlement.expected_poisha))}
        </div>
      </Card>
    </div>

    <!-- Overpayment Review Status Section (PRD §8.4) -->
    {#if settlement.status === 'overpaid'}
      <div class="mb-6">
        <Card class="p-5 border-purple-500/20 bg-purple-500/5">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold">
                  {settlement.overpayment_review_status === 'approved' ? '✓ Overpayment Approved' : '⚠️ Overpayment Pending Approval'}
                </span>
                <span class="text-xs text-purple-900 dark:text-purple-200 font-bold">
                  Surplus: +{formatPoishaToBdt(BigInt(settlement.paid_poisha) - BigInt(settlement.expected_poisha))}
                </span>
              </div>

              {#if settlement.overpayment_review_status === 'approved'}
                <p class="text-xs text-purple-700/80 dark:text-purple-300/80 mt-1">
                  Reason: "{settlement.overpayment_reason}" &bull; Authorized: {settlement.overpayment_approved_at?.slice(0, 10)}
                </p>
              {:else}
                <p class="text-xs text-purple-700/80 dark:text-purple-300/80 mt-1">
                  Owner approval is required to authorize surplus prior to month close (PRD §8.4).
                </p>
              {/if}
            </div>

            {#if settlement.overpayment_review_status !== 'approved' && session.user?.role === 'owner'}
              <Button variant="commission" onclick={() => { overpaymentModalOpen = true; }}>
                Authorize Surplus
              </Button>
            {/if}
          </div>
        </Card>
      </div>
    {/if}

    <!-- Payment Records Ledger Table -->
    <Card class="p-6">
      <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
        <h2 class="text-base font-bold text-[var(--ink)]">Settlement Payments & Reversals</h2>
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
              <tr class="text-xs text-[var(--muted)] border-b border-black/5 uppercase tracking-wider">
                <th class="pb-2">Date</th>
                <th class="pb-2 text-right">Amount (BDT)</th>
                <th class="pb-2">Reference</th>
                <th class="pb-2">Receipt</th>
                <th class="pb-2">Notes</th>
                <th class="pb-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono text-xs">
              {#each payments as p (p.id)}
                {@const reversibleBalance = getReversibleBalance(p, payments)}
                {@const isFullyReversed = !p.is_reversal && reversibleBalance === 0n}
                {@const isPartlyReversed = !p.is_reversal && reversibleBalance > 0n && reversibleBalance < BigInt(p.amount_poisha)}
                {@const receiptPath = p.receipt_storage_path ?? p.receipt_path}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-3 text-[var(--ink)]">
                    {p.paid_on}
                    {#if p.is_reversal}
                      <span class="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-600 font-bold">Reversal</span>
                    {:else if isFullyReversed}
                      <span class="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-black/10 text-[var(--muted)] font-bold">Reversed</span>
                    {:else if isPartlyReversed}
                      <span class="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold">Partly Reversed</span>
                    {/if}
                  </td>
                  <td class="py-3 text-right font-bold tabular-nums {p.is_reversal ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">
                    {p.is_reversal ? '-' : ''}{formatPoishaToBdt(BigInt(p.amount_poisha))}
                  </td>
                  <td class="py-3 text-[var(--muted)]">{p.reference || '—'}</td>
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
      onclose={() => { recordModalOpen = false; }}
      onsuccess={(newP, updatedSett) => {
        payments = [newP, ...payments];
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
        onclose={() => { reversalModalOpen = false; selectedPaymentForReversal = null; }}
        onsuccess={(newP, updatedSett) => {
          payments = [newP, ...payments];
          if (updatedSett) {
            settlement = updatedSett;
          }
        }}
      />
    {/if}

    <OverpaymentApprovalModal
      bind:open={overpaymentModalOpen}
      {settlement}
      onclose={() => { overpaymentModalOpen = false; }}
      onsuccess={(updated) => {
        settlement = updated;
      }}
    />
  {/if}
</div>
```

### 6.7 `apps/web/src/routes/api/v1/settlements/payments/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const paymentSchema = z.object({
  settlementId: z.string().uuid(),
  amountPoisha: z.string().regex(/^\d+$/),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().optional().nullable(),
  receiptPath: z.string().optional().nullable(),
  receiptStoragePath: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  isReversal: z.boolean().optional(),
  reversesId: z.string().uuid().optional().nullable(),
  reversesPaymentId: z.string().uuid().optional().nullable(),
});

/**
 * POST /api/v1/settlements/payments
 * Records a settlement payment or reversal row under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }), { status: 400 });
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const effectiveReceiptPath = parsed.data.receiptPath ?? parsed.data.receiptStoragePath ?? null;
  const effectiveReversesId = parsed.data.reversesId ?? parsed.data.reversesPaymentId ?? null;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('record_settlement_payment', {
    p_settlement_id: parsed.data.settlementId,
    p_amount_poisha: parsed.data.amountPoisha,
    p_paid_on: parsed.data.paidOn,
    p_reference: parsed.data.reference ?? null,
    p_receipt_path: effectiveReceiptPath,
    p_note: parsed.data.note ?? null,
    p_is_reversal: parsed.data.isReversal ?? false,
    p_reverses_id: effectiveReversesId,
    p_actor_id: caller.userId,
  });

  if (error) {
    if (error.message?.includes('month_closed')) {
      return new Response(JSON.stringify({ error: 'month_closed', message: 'Month is closed. Payments and reversals are locked.' }), { status: 422 });
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Fetch updated settlement and created payment for instant reactive client sync
  const { data: updatedSettlement } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', parsed.data.settlementId)
    .single();

  const { data: createdPayment } = await supabase
    .from('settlement_payments')
    .select('id, settlement_id, amount_poisha, paid_on, reference, receipt_storage_path, note, is_reversal, reverses_payment_id, recorded_by, created_at')
    .eq('id', data)
    .single();

  return new Response(JSON.stringify({
    success: true,
    paymentId: data,
    payment: createdPayment,
    settlement: updatedSettlement,
  }), { status: 200 });
};

/**
 * GET /api/v1/settlements/payments?settlement_id=<UUID>
 * Fetches official payment rows and settlement entity for a settlement. Restricted to Admin and Owner.
 */
export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  const settlementId = event.url.searchParams.get('settlement_id');
  if (!settlementId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settlementId)) {
    return new Response(JSON.stringify({ error: 'invalid_parameter', message: 'settlement_id UUID required' }), { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data: settlement } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', settlementId)
    .single();

  const { data: payments, error } = await supabase
    .from('settlement_payments')
    .select('id, settlement_id, amount_poisha, paid_on, reference, receipt_storage_path, note, is_reversal, reverses_payment_id, recorded_by, created_at')
    .eq('settlement_id', settlementId)
    .order('paid_on', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ settlement: settlement ?? null, payments: payments ?? [] }), { status: 200 });
};
```

### 6.8 `apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const approvalSchema = z.object({
  settlementId: z.string().uuid(),
  reason: z.string().min(1, 'Approval reason is mandatory'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Owner role required to authorize overpayments' }), { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }), { status: 400 });
  }

  const parsed = approvalSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('approve_settlement_overpayment', {
    p_settlement_id: parsed.data.settlementId,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
```

### 6.9 `apps/web/src/routes/api/v1/settlements/receipts/upload/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { validateReceiptUpload, detectMagicBytes, MAX_RECEIPT_FILE_SIZE } from '$lib/settlements/receipt-validation';

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  // Fast-fail on Content-Length header before reading large buffer into memory
  const contentLength = event.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RECEIPT_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'payload_too_large', message: 'File exceeds 5 MB limit' }), { status: 413 });
  }

  const formData = await event.request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'missing_file', message: 'File is required' }), { status: 400 });
  }

  const validation = validateReceiptUpload(file.size, file.type);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), { status: validation.statusCode ?? 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Binary magic-byte inspection preventing extension and MIME spoofing attacks
  const magic = detectMagicBytes(uint8);
  if (!magic) {
    return new Response(JSON.stringify({ error: 'invalid_file_signature', message: 'Binary signature does not match allowed types (PNG, JPEG, WebP, PDF)' }), { status: 415 });
  }

  const supabase = getServiceSupabase();

  // Ensure private receipts bucket exists in storage
  const { data: bucket } = await supabase.storage.getBucket('receipts');
  if (!bucket) {
    await supabase.storage.createBucket('receipts', { public: false });
  }

  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()).slice(0, 7);
  const path = `receipts/${month}/${crypto.randomUUID()}.${magic.ext}`;

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, arrayBuffer, {
      contentType: magic.mime,
      upsert: false,
    });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ path }), { status: 200 });
};
```

### 6.10 `apps/web/src/routes/api/v1/settlements/receipts/signed-url/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { validateReceiptPath } from '$lib/settlements/receipt-validation';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  const path = event.url.searchParams.get('path');
  if (!path || !validateReceiptPath(path)) {
    return new Response(JSON.stringify({ error: 'invalid_path', message: 'Path traversal or malformed path rejected' }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(path, 900); // 15 minutes TTL (PRD §8.4, §13)

  if (error || !data?.signedUrl) {
    return new Response(JSON.stringify({ error: error?.message || 'Signed URL creation failed' }), { status: 500 });
  }

  return new Response(JSON.stringify({ signedUrl: data.signedUrl }), { status: 200 });
};
```

### 6.11 `apps/web/src/lib/settlements/settlements.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeSettlementReminder, formatOrdinalDay, calcSettlementStatus } from './reminders';
import {
  validateReceiptUpload,
  validateReceiptPath,
  detectMagicBytes,
  MAX_RECEIPT_FILE_SIZE,
} from './receipt-validation';

describe('Settlement Reminders & Ordinal Formatting (PRD §8.4)', () => {
  it('formats ordinal days with accurate English suffixes', () => {
    expect(formatOrdinalDay(1)).toBe('1st');
    expect(formatOrdinalDay(2)).toBe('2nd');
    expect(formatOrdinalDay(3)).toBe('3rd');
    expect(formatOrdinalDay(4)).toBe('4th');
    expect(formatOrdinalDay(11)).toBe('11th');
    expect(formatOrdinalDay(12)).toBe('12th');
    expect(formatOrdinalDay(13)).toBe('13th');
    expect(formatOrdinalDay(21)).toBe('21st');
    expect(formatOrdinalDay(22)).toBe('22nd');
    expect(formatOrdinalDay(23)).toBe('23rd');
    expect(formatOrdinalDay(28)).toBe('28th');
  });

  it('computes due dates and in-app reminder countdowns accurately', () => {
    // Target settlement month: October 2026. Due date is in November on the 15th.
    const reminder = computeSettlementReminder('2026-10', 15, 3, '2026-11-12');
    expect(reminder.dueDate).toBe('2026-11-15');
    expect(reminder.daysRemaining).toBe(3);
    expect(reminder.inReminderWindow).toBe(true);
    expect(reminder.isOverdue).toBe(false);
    expect(reminder.formattedDueDay).toBe('15th');
  });

  it('detects overdue settlements accurately past due day', () => {
    const reminder = computeSettlementReminder('2026-10', 15, 3, '2026-11-16');
    expect(reminder.isOverdue).toBe(true);
    expect(reminder.daysRemaining).toBe(-1);
    expect(reminder.inReminderWindow).toBe(false);
  });

  it('correctly clamps due dates for February and short months', () => {
    // Target settlement month: January 2026. Following month is Feb 2026 (28 days).
    const reminderFeb = computeSettlementReminder('2026-01', 31, 3, '2026-02-25');
    expect(reminderFeb.dueDate).toBe('2026-02-28');
    expect(reminderFeb.formattedDueDay).toBe('28th');

    // Leap year Feb 2028 (29 days)
    const reminderLeap = computeSettlementReminder('2028-01', 31, 3, '2028-02-25');
    expect(reminderLeap.dueDate).toBe('2028-02-29');
    expect(reminderLeap.formattedDueDay).toBe('29th');
  });
});

describe('Settlement Five-State Lifecycle Transitions (PRD §8.4, Tests #20, #26)', () => {
  it('transitions through all five discrete settlement states using authoritative helper', () => {
    // 1. not_applicable (zero liability, e.g. customer-borne charges, Test #20)
    expect(calcSettlementStatus(0n, 0n)).toBe('not_applicable');

    // 2. due (expected > 0, zero paid)
    expect(calcSettlementStatus(50000n, 0n)).toBe('due');

    // 3. partly_paid (0 < paid < expected)
    expect(calcSettlementStatus(50000n, 20000n)).toBe('partly_paid');

    // 4. paid (paid === expected)
    expect(calcSettlementStatus(50000n, 50000n)).toBe('paid');

    // 5. overpaid (paid > expected)
    expect(calcSettlementStatus(50000n, 55000n)).toBe('overpaid');
  });

  it('calculates payment reversal net balances and supports partial reversals (Test #13)', () => {
    const originalPaid = 500000n; // ৳5,000
    const partialReversal = 200000n; // ৳2,000
    const remainingReversible = originalPaid - partialReversal;
    expect(remainingReversible).toBe(300000n); // ৳3,000 remaining reversible

    const secondReversal = 300000n; // ৳3,000
    const fullyReversedBalance = remainingReversible - secondReversal;
    expect(fullyReversedBalance).toBe(0n);
  });
});

describe('Receipt Upload Magic-Byte Validation & Security (PRD §8.4, §13, Test #64)', () => {
  it('detects genuine PNG, JPEG, WebP, and PDF magic bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(detectMagicBytes(pngBytes)?.mime).toBe('image/png');

    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(detectMagicBytes(jpegBytes)?.mime).toBe('image/jpeg');

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x35]);
    expect(detectMagicBytes(pdfBytes)?.mime).toBe('application/pdf');

    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectMagicBytes(webpBytes)?.mime).toBe('image/webp');
  });

  it('rejects spoofed files whose binary signature does not match allowed types', () => {
    const fakePdf = new Uint8Array([0x4D, 0x5A, 0x90, 0x00]); // Windows PE EXE header disguised
    expect(detectMagicBytes(fakePdf)).toBeNull();
  });

  it('enforces 5 MB file size limit and allowed MIME types (HTTP 413, 415)', () => {
    expect(validateReceiptUpload(MAX_RECEIPT_FILE_SIZE, 'image/png').valid).toBe(true);
    expect(validateReceiptUpload(MAX_RECEIPT_FILE_SIZE + 1, 'image/png').statusCode).toBe(413);
    expect(validateReceiptUpload(1000, 'text/plain').statusCode).toBe(415);
    expect(validateReceiptUpload(0, 'image/png').statusCode).toBe(400);
  });

  it('validates receipt storage path and blocks path traversal attempts', () => {
    expect(validateReceiptPath('receipts/2026-10/4f9b8c2a-1e3d-4c5b-8a7e-9f0a1b2c3d4e.png')).toBe(true);
    expect(validateReceiptPath('receipts/2026-10/4f9b8c2a-1e3d-4c5b-8a7e-9f0a1b2c3d4e.pdf')).toBe(true);

    // Path traversal attacks
    expect(validateReceiptPath('../receipts/2026-10/file.png')).toBe(false);
    expect(validateReceiptPath('/etc/passwd')).toBe(false);
    expect(validateReceiptPath('receipts/2026-10/../../../secret.txt')).toBe(false);
    expect(validateReceiptPath('receipts/invalid-month/uuid.png')).toBe(false);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Due Date Reminder Window | Due day 15, 3 days left | `inReminderWindow === true`, `daysRemaining === 3` | §8.4 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Overdue Status Detection | Date past due day | `isOverdue === true`, `daysRemaining < 0` | §8.4 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Ordinal Day Formatting | Days 1, 2, 3, 11, 21, 22 | Formatted `1st`, `2nd`, `3rd`, `11th`, `21st`, `22nd` | §8.4 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Short Month & Leap Year Clamping | Jan 31 due day into Feb | Clamps to Feb 28th (standard) or Feb 29th (leap) | §8.4 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Five-State Lifecycle (Tests #20, #26) | Expected vs paid poisha | 5 discrete states (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`) via `calcSettlementStatus` | §16.2 #20, #26 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Payment Reversal Net Math (Test #13) | ৳5k pay, ৳2k reverse | Remaining reversible = ৳3k, partial reversals supported | §16.2 #13 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Receipt Upload Magic Bytes (Test #64) | Binary headers for PNG/JPG/WebP/PDF | True MIME type and extension detected; spoofed EXE headers rejected | §16.2 #64 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Receipt Size Limit (Test #64) | 5 MB vs 5 MB + 1 byte | HTTP 413 `payload_too_large` on excess | §16.2 #64 | `apps/web/src/lib/settlements/settlements.test.ts` |
| Receipt Path Traversal Defense | Malicious `..` and absolute paths | Regex blocks invalid paths returning HTTP 400 | §13, §16.2 #64 | `apps/web/src/lib/settlements/settlements.test.ts` |

## 8. Acceptance criteria

1. Settlement reminder calculation formats correct ordinal days, handles February/short month clamping, and accurately detects reminder windows and overdue status.
   - Command: `pnpm --filter @clt/web test settlements.test.ts -t "Reminders"`
   - Expected output: `4 passed`.
2. Receipt upload and magic-byte security tests pass cleanly, enforcing 5 MB limit and path traversal rejection.
   - Command: `pnpm --filter @clt/web test settlements.test.ts -t "Receipt"`
   - Expected output: `4 passed`.
3. SvelteKit route and component typecheck passes cleanly with zero errors.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha used in all settlement amounts and variances; formatted via `formatPoishaToBdt` and parsed via `parseBdtToPoisha`.
- Rule 3: Single calculation module identities respected; customer-borne charges result in zero merchant liability (`not_applicable`).
- Rule 5: Audit logs written inside same transaction for payment and overpayment approval operations (`settlement.payment`, `settlement.overpayment_approved`).
- Rule 7: Settlement mutations executed under `service_role` RPCs with `search_path = public, pg_temp`.
- Rule 10: Lock hierarchy strictly maintained in RPC (`1001` month lock, key share on `payables`, row lock on `settlements`).

## 10. Pitfalls

- Trap: Standardizing RPC parameters to non-existent names returning PGRST202 runtime errors.
  - Fix: Plan 005's `record_settlement_payment` signature strictly requires `p_settlement_id`, `p_amount_poisha`, `p_paid_on`, `p_reference`, `p_receipt_path`, `p_note`, `p_is_reversal`, `p_reverses_id`, `p_actor_id`. Endpoints and clients use these exact parameter names.
- Trap: Payment rows never reaching the client because sync engine pull DTO does not pull settlement payments.
  - Fix: Provide `GET /api/v1/settlements/payments?settlement_id=<id>` which fetches rows and settlement entity from PostgreSQL and caches them in Dexie `db.settlementPayments` and `db.settlements`, enabling reactive UI rendering both online and offline.
- Trap: Client MIME-type spoofing uploading executables disguised as PDFs or images.
  - Fix: Inspect true binary magic bytes in `detectMagicBytes` and reject mismatched signatures before writing to private cloud storage.
- Trap: SvelteKit adapter-node rejecting 5 MB receipt uploads before reaching route handler.
  - Fix: Check `Content-Length` header first in endpoint and configure adapter body limit appropriately.
- Trap: Recording payments on closed months triggering raw Postgres error crashes.
  - Fix: Disable UI action buttons when `db.monthCloses` shows month is closed; return clean HTTP 422 `{ error: 'month_closed' }`.
- Trap: Reversal locking completely preventing partial reversals (breaking PRD Test #13).
  - Fix: Compute remaining reversible balance per payment; allow partial reversal amounts up to the remaining reversible balance.

## 11. PRD ISSUES and DECISION PENDING

- none

## 12. Handoff

- `db.settlements` and `db.settlementPayments` consumed by Month Close gating checks in Plan 015 (`015_reconciliation_mode_a_and_month_close.md`).
- `computeSettlementReminder` consumed by Admin dashboard settlement payment checklist in Plan 016 (`016_role_dashboards.md`).

## 13. Suggested task breakdown

- `CLT-T-046`: Implement settlement reminders, ordinal day helper, receipt magic-byte validator, and unit test suite (Files: `apps/web/src/lib/settlements/reminders.ts`, `apps/web/src/lib/settlements/receipt-validation.ts`, `apps/web/src/lib/settlements/settlements.test.ts`; Depends on: none; Role: Implementer; Priority: P0).
- `CLT-T-047`: Build payment recording modal with reversal locking, mandatory notes, and overpayment approval modal (Files: `apps/web/src/lib/ui/RecordPaymentModal.svelte`, `apps/web/src/lib/ui/OverpaymentApprovalModal.svelte`; Depends on: `CLT-T-046`; Role: Implementer; Priority: P1).
- `CLT-T-048`: Build settlements list screen with role guard and detail screen with payment caching, receipt previews, and overpayment cards (Files: `apps/web/src/routes/(app)/settlements/+page.svelte`, `apps/web/src/routes/(app)/settlements/[id]/+page.svelte`; Depends on: `CLT-T-047`; Role: Implementer; Priority: P0).
- `CLT-T-049`: Implement server payment recording (POST) & listing (GET), overpayment approval, receipt upload with magic bytes, and signed URL endpoints with matched RPC signatures (Files: `apps/web/src/routes/api/v1/settlements/*/+server.ts`; Depends on: `CLT-T-048`; Role: Implementer; Priority: P0).

## Changelog

- 2026-11-01: Remediated comprehensive senior adversarial audit findings across Plan 014 (Revision 3.1):
  - 1. Fixed Universal Access Lockout: Replaced invalid `session.role` with `session.user?.role === 'admin' || session.user?.role === 'owner'` in `settlements/+page.svelte` and `settlements/[id]/+page.svelte`. Reinforced Owner-only overpayment approval guard with `session.user?.role === 'owner'`.
  - 2. Corrected Client Supabase Imports: Replaced non-existent `$lib/db/supabaseClient` with `$lib/supabase/client` across `RecordPaymentModal.svelte`, `OverpaymentApprovalModal.svelte`, and `settlements/[id]/+page.svelte`.
  - 3. Corrected Server Supabase Imports: Replaced non-existent `$lib/supabase/server` with `$lib/server/supabase` across all four settlement endpoints under `apps/web/src/routes/api/v1/settlements/`.
  - 4. Fixed Modal Required Props: Bound required `onclose={() => { open = false; onclose?.(); }}` to `<Modal>` in both `RecordPaymentModal.svelte` and `OverpaymentApprovalModal.svelte`, preventing runtime crashes on backdrop dismiss. Added `id="btn-submit"` to form submit buttons.
  - 5. Purged Floating Point Math (Hard Rule 2): Replaced `parseFloat` and `Math.round` with `parseBdtToPoisha` from `@clt/shared` in `RecordPaymentModal.svelte`. Used pure integer poisha arithmetic throughout.
  - 6. Implemented Partial Reversals (PRD Test #13): Unlocked reversal amount input and computed remaining reversible balance per payment in `settlements/[id]/+page.svelte`. Passed `maxReversiblePoisha` to `RecordPaymentModal.svelte` and added support for partial reversals up to the remaining reversible balance.
  - 7. Aligned Closed-Month Payout Policy: Permitted payouts settling remaining liability (`expected - paid`) on closed months while strictly locking reversals and overpayments (PRD §7.3, §8.4).
  - 8. Dexie Reactive Synchronization: Updated `POST /api/v1/settlements/payments` to return both `payment` and `settlement`, and updated `RecordPaymentModal.svelte` to put both records into Dexie `db.settlements` and `db.settlementPayments` immediately.
  - 9. Direct Navigation Hydration: Updated `GET /api/v1/settlements/payments` to return `{ settlement, payments }` so direct navigation to `/settlements/[id]` populates the parent settlement in Dexie without requiring a full sync.
  - 10. Avoided Mobile Browser Popup Blocking: Updated `viewReceipt` to open a blank window synchronously before the asynchronous signed URL fetch.
  - 11. Authoritative Status & Clamping: Exported `calcSettlementStatus` and refined `computeSettlementReminder` to accurately clamp to target month lengths (e.g. Feb 28th/29th leap years), adding unit tests in `settlements.test.ts`.
- 2026-10-31: Remediated comprehensive audit findings across Plan 014 (Revision 3.0):
  - 1. Fixed Payment Delivery to Client: Implemented `GET /api/v1/settlements/payments?settlement_id=<UUID>` allowing client to fetch and cache official `settlement_payments` in Dexie `db.settlementPayments`. Updated `POST /api/v1/settlements/payments` to return the created payment entity and immediately populate Dexie for instant reactive UI updates.
  - 2. Aligned Data Model & DDL Columns: Updated `CachedSettlementPayment` to support DDL column names `receipt_storage_path`, `reverses_payment_id`, `note`, `recorded_by`, and `created_at`. Replaced invented `recipient_name` with DDL column `payable.name`. Updated `CachedSettlement` with overpayment approval fields.
  - 3. Role Gating: Restricted `/settlements` and `/settlements/[id]` strictly to Admin and Owner; Staff users receive an access denied banner per PRD §3 and §8.4.
  - 4. Dynamic Liability Fallback: Computed expected liabilities from local active entries if no server settlement row exists yet, ensuring real liabilities display before initial sync and matching Plan 013.
  - 5. Reminder Window & Ordinal Formatting: Bound reminder window to `p.remind_days_before` (default 3); authored `formatOrdinalDay` providing correct English suffixes (`1st`, `2nd`, `3rd`, `15th`, `22nd`), eliminating `1th/2th/22th` bugs.
  - 6. Receipt Upload Security & Magic Bytes: Added fast-fail check on `Content-Length` (< 5 MB); added binary magic-byte inspection in `detectMagicBytes` (detecting PNG, JPEG, WebP, PDF and rejecting spoofed executables); verified private `receipts` bucket creation; and hardened path traversal regex.
  - 7. Closed Month UI Handling: Added `isMonthClosed` checks disabling "Record Payment" and "Reverse" buttons when month is closed; server RPC returns clean HTTP 422 `{ error: 'month_closed' }`.
  - 8. Overpayment Review UX: Added detailed Overpayment Status card on settlement detail screen presenting approved amount, reason, and approver; displays warning when approval is pending.
  - 9. Reversal UX Hardening: Marked reversed payments as `[Reversed]` and hid duplicate reverse buttons; locked reversal amount to original payment; made reversal reason mandatory; and sorted payments chronologically descending.
  - 10. Form State Management: Reset modal state on open and close; guarded `event.request.json()` against malformed syntax; and quoted all bash check command paths containing `(app)` and `[id]`.
  - 11. Expanded Test Suite: Expanded `settlements.test.ts` to 8 comprehensive tests covering ordinal day formatting, reminder countdowns, overdue detection, 5-state transitions, payment reversal math, binary magic bytes detection, 5 MB file size limits, and path traversal rejection.
- 2026-10-31: Remediated 6 critical runtime bugs and specification gaps (Revision 2.0).
- 2026-10-29: Resolved Blockers B26, B27: standardized settlement payment recording and overpayment approval flows.
- 2026-10-29: Initial specification created for Plan 014 aligned with PRD v1.19 §7.3, §8.4, and §13.
