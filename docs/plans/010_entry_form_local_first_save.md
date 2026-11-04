# 010_entry_form_local_first_save.md — Dexie IndexedDB Schema, Outbox, and Local-First Entry Form

- Plan Identifier: CLT-PLAN-010
- Phase: Phase 1 / M1
- Milestone: M1
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §6.5 (Client precomputation & server re-derivation), §8.1 (New entry primary screen / S06), §9 (Dexie client storage & wire format), §16.2 (Tests #4, #5, #42, #43, #50), §17 (Milestone M1)
- Depends on: 002, 007, 008
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01

## 1. Purpose

Implement client-side IndexedDB storage using Dexie with all required client tables (`entries`, `outbox`, `rateProfiles`, `methods`, `payables`, `profiles`, `settlements`, `settlementPayments`, `statements`, `statementLines`, `monthCloses`, `rejectedOps`, `meta`, `appSettings`), outbox mutation queue, date-effective rate profile resolution from local cache, live calculation breakdown card using the authoritative `calculateEntry` engine from `packages/calc`, duplicate warning detection, closed-month guard, and local-first save completing in under 100 milliseconds. Transactions saved offline receive `#LOCAL-xxxx` badges, write complete rate snapshots (including version, engineVersion, chargeBp, and chargesBorneBy), and are immediately visible in the local ledger without blocking on network connectivity.

## 2. Scope

- IN:
  - Dexie database schema and table definitions in `apps/web/src/lib/db/index.ts`: `entries`, `outbox`, `rateProfiles`, `methods`, `payables`, `profiles`, `settlements`, `settlementPayments`, `statements`, `statementLines`, `monthCloses`, `rejectedOps`, `meta`, `appSettings`.
  - Dexie indexing rules conforming to PRD §9.1: NO indexing on string monetary amounts; indexes strictly on `entry_date`, `status`, `server_seq`, `created_by`, `method_id`, `sync_status`.
  - All 64-bit monetary values and cursors stored and transmitted as decimal strings (`SerializedPoisha`).
  - Date-effective rate profile lookup in `apps/web/src/lib/db/rates.ts` querying cached published profiles from Dexie (`effective_from <= entry_date`, sorted by `effective_from DESC, version DESC LIMIT 1`).
  - Outbox mutation queue manager in `apps/web/src/lib/db/outbox.ts` recording `LocalOutboxOp` items with mandatory `maxKnownRateVersion` and canonical wire payload structure including explicit `id` and nullable `vatInputPoisha`.
  - Transaction entry form screen in `apps/web/src/routes/(app)/entries/new/+page.svelte` adhering to PRD §8.1 and Plan 022 Screen S06.
  - Dynamic payment method chips loaded from `db.methods` using real method UUIDs.
  - Mandatory `requires_txn_ref` validation dynamically toggling required state on transaction reference input.
  - Form inputs for all data fields: `entryDate`, `customerName`, `subQty`, `subDescription`, `grossInput`, `selectedMethodId`, `txnRef`, `manualVatInput`, `notes`.
  - 4-state Sync Indicator badge (`Offline`, `Synced`, `Syncing`, `Error`).
  - Closed-month validation checking `db.monthCloses` and disabling Save with warning if month is closed.
  - Historical rate deviation banner alerting when entry date rates differ from latest published profile.
  - Live receipt-style breakdown card component in `apps/web/src/lib/ui/ReceiptBreakdown.svelte` using `formatPoishaToBdt` from `@clt/shared` with South Asian comma grouping (`1,23,456.00`) and negative sign on Commission deduction.
  - Deduction guard surfacing `DeductionsExceedGrossError` in UI when deductions exceed gross, disabling `#btn-save`.
  - Local supersede handling in `saveLocalEntry` updating the original entry status to `'superseded'` to prevent offline double-counting.
  - Integer arithmetic in supersede pre-population conforming to PRD Rule #2 (no floating point conversions).
  - Non-blocking duplicate warning banner in `apps/web/src/lib/ui/DuplicateWarning.svelte`.
  - Transaction reference normalization: `txn_ref = nullif(upper(trim(rawInput)), '')`.
  - Customer-borne charges UI handling (`chargesBorneBy = 'customer'` rendered as `(Customer-paid — not deducted)` and excluded from net).
  - Unit and performance benchmark tests verifying save latency under 100 milliseconds in `apps/web/src/lib/db/dexie.test.ts`.
- OUT:
  - Remote synchronization push and pull network runner (owned by Plan 011).
  - Multi-tab Web Locks API leader election (owned by Plan 011).
  - Historical ledger browsing, filtering, and superseding drawer (owned by Plan 012).
  - Admin rate configuration screens (owned by Plan 009).

## 3. Preconditions

1. Plan 002 `packages/calc` (`calculateEntry`, `RateSnapshot`, `Poisha`, `DeductionsExceedGrossError`) and `packages/shared` (`formatPoishaToBdt`, `parseBdtToPoisha`) are built and passing tests.
   - Check command: `pnpm --filter @clt/calc test && pnpm --filter @clt/shared test`
   - Expected output: exit code `0`.
2. Plan 007 UI kit components (`Button`, `Card`, `Chip`, `Toast`) are available in `apps/web/src/lib/ui/`.
   - Check command: `test -f apps/web/src/lib/ui/Button.svelte`
   - Expected output: exit code `0`.
3. Plan 008 auth session store is available in `apps/web/src/lib/auth/session.svelte.ts`.
   - Check command: `test -f apps/web/src/lib/auth/session.svelte.ts`
   - Expected output: exit code `0`.
4. Workspace typecheck and lint pass cleanly.
   - Check command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.
5. Dev package `fake-indexeddb` is installed in `apps/web` for Node/Vitest Dexie testing.
   - Check command: `pnpm --filter @clt/web test --run --testNamePattern="Local-First"`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/db/index.ts` | create | Dexie IndexedDB client database class declaring all 14 local tables and non-monetary indexes with exact optional types |
| `apps/web/src/lib/db/entries.ts` | create | Entry data-access repository for 100ms local save, duplicate checks, local supersede updates, and outbox creation |
| `apps/web/src/lib/db/outbox.ts` | create | Outbox queue manager for enqueuing mutation operations with mandatory rate watermarks and canonical payload structure |
| `apps/web/src/lib/db/rates.ts` | create | Date-effective rate profile resolution and watermark tracking from cached Dexie profiles |
| `apps/web/src/lib/ui/ReceiptBreakdown.svelte` | create | Signature receipt card displaying live calculation breakdown with South Asian BDT formatting and deduction signs |
| `apps/web/src/lib/ui/DuplicateWarning.svelte` | create | Non-blocking banner alerting of duplicate customer or reference on the same date |
| `apps/web/src/routes/(app)/entries/new/+page.svelte` | create | S06 Primary transaction entry screen with dynamic method chips, closed-month guard, deduction alerts, and 100ms save |
| `apps/web/src/lib/db/dexie.test.ts` | create | Unit tests verifying Dexie save latency, decimal serialization, snapshot completeness, and supersede status updates |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Ensure `fake-indexeddb` is installed in `apps/web` devDependencies:
   - Command: `pnpm --filter @clt/web add -D fake-indexeddb`
   - Check: `grep -c 'fake-indexeddb' apps/web/package.json`
   - Expected output: `1`

2. Create Dexie database schema and class in `apps/web/src/lib/db/index.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/db/index.ts`.
   - Check: `grep -c 'class CosmoDatabase' apps/web/src/lib/db/index.ts`
   - Expected output: `1`

3. Create outbox queue helper in `apps/web/src/lib/db/outbox.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/db/outbox.ts`.
   - Check: `grep -c 'enqueueCreateEntry' apps/web/src/lib/db/outbox.ts`
   - Expected output: `1`

4. Create date-effective rate resolver in `apps/web/src/lib/db/rates.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/db/rates.ts`.
   - Check: `grep -c 'resolveEffectiveRateProfile' apps/web/src/lib/db/rates.ts`
   - Expected output: `1`

5. Create local entry repository in `apps/web/src/lib/db/entries.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/db/entries.ts`.
   - Check: `grep -c 'saveLocalEntry' apps/web/src/lib/db/entries.ts`
   - Expected output: `1`

6. Create receipt breakdown component in `apps/web/src/lib/ui/ReceiptBreakdown.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/lib/ui/ReceiptBreakdown.svelte`.
   - Check: `grep -c 'formatPoishaToBdt' apps/web/src/lib/ui/ReceiptBreakdown.svelte`
   - Expected output: `1`

7. Create duplicate warning component in `apps/web/src/lib/ui/DuplicateWarning.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/lib/ui/DuplicateWarning.svelte`.
   - Check: `grep -c 'duplicate-warning' apps/web/src/lib/ui/DuplicateWarning.svelte`
   - Expected output: `1`

8. Create transaction entry screen in `apps/web/src/routes/(app)/entries/new/+page.svelte` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/(app)/entries/new/+page.svelte`.
   - Check: `grep -c 'calculateEntry' apps/web/src/routes/(app)/entries/new/+page.svelte`
   - Expected output: `1`

9. Create Dexie storage and latency tests in `apps/web/src/lib/db/dexie.test.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/lib/db/dexie.test.ts`.
   - Check: `pnpm --filter @clt/web test dexie.test.ts`
   - Expected output: test suite passes with 0 failures.

10. Verify route typechecking and compilation.
    - Command: `pnpm --filter @clt/web check`
    - Expected output: `0 errors`.


## 6. Specifications

### 6.1 `apps/web/src/lib/db/index.ts`

```ts
import Dexie, { type Table } from 'dexie';
import type { RateSnapshot } from '@clt/calc';

export interface LocalEntry {
  id: string; // UUID
  entry_number?: string | undefined; // Formatted E-YYYYMM-XXXXXX or null pre-sync
  local_id: string; // #LOCAL-xxxx badge
  entry_date: string; // YYYY-MM-DD (Asia/Dhaka)
  customer_name: string;
  sub_qty: number;
  sub_description?: string | undefined;
  method_id: string; // UUID references payment_methods
  gross_poisha: string; // SerializedPoisha decimal string (Rule 2)
  vat_poisha: string;
  commission_poisha: string;
  charge_poisha: string; // Required financial partition total
  business_charge_poisha: string;
  customer_charge_poisha: string;
  net_poisha: string;
  txn_ref?: string | undefined;
  notes?: string | undefined;
  status: 'active' | 'voided' | 'superseded';
  sync_status: 'pending' | 'synced' | 'rejected';
  created_by: string;
  created_at: string;
  server_seq?: string | undefined;
  stale_rates: boolean;
  rate_profile_id: string;
  snapshot?: RateSnapshot | undefined; // Rule 4 immutable rate snapshot
  vat_input_poisha?: string | undefined;
  supersedes_id?: string | undefined; // Original entry ID if created in supersede mode
  device_id?: string | undefined;
  dup_txn_flag?: boolean | undefined;
  void_requested_by?: string | undefined;
  void_reason?: string | undefined;
  stale_review_status?: 'none' | 'pending' | 'approved' | 'rejected' | undefined;
}

export interface LocalOutboxOp {
  opId: string;
  userId: string; // Required for multi-user outbox partitioning (Plan 011, Test #62)
  type: 'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  payload: Record<string, unknown>;
  clientCreatedAt: string;
  payloadHash?: string | undefined;
  supersedesRejectedOpId?: string | undefined;
  supersedes_rejected_op_id?: string | undefined; // Backward-compatible snake_case alias
  maxKnownRateVersion: number;
  status: 'pending' | 'in_flight' | 'rejected' | 'resolved';
  outboxState?: string | undefined;
  rejectionReason?: string | undefined;
  errorMessage?: string | undefined;
}

export interface CachedRateProfile {
  id: string;
  version: number;
  status: 'draft' | 'published';
  effective_from: string; // YYYY-MM-DD
  vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
  vat_bp: number;
  commission_bp: number;
  commission_base: 'gross_minus_vat' | 'gross';
  charges_borne_by?: 'business' | 'customer' | undefined;
  note?: string | undefined;
  method_rates: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>;
}

export interface CachedPaymentMethod {
  id: string;
  code: string;
  name: string;
  requires_txn_ref: boolean;
  display_order: number;
  active: boolean;
}

export interface CachedPayable {
  id: string;
  name: string; // Aligned with DDL column name
  kind: 'vat' | 'method_charge';
  method_id?: string | undefined;
  code?: string | undefined;
  recipient_name?: string | undefined; // Backward-compatible alias
  recipient_account?: string | undefined;
  due_day: number;
  remind_days_before?: number | undefined;
  active: boolean;
}

export interface CachedProfile {
  id: string; // auth.users UUID
  role: 'owner' | 'admin' | 'staff';
  display_name: string;
  active: boolean;
  phone?: string | undefined;
  default_route: string;
  created_at: string;
}

export interface CachedSettlement {
  id: string;
  month: string; // YYYY-MM-01
  payable_id: string;
  expected_poisha: string;
  paid_poisha: string;
  variance_poisha?: string | undefined;
  status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
  note?: string | undefined;
  overpayment_review_status?: 'none' | 'approved' | undefined;
  overpayment_approved_amount_poisha?: string | undefined;
  overpayment_reason?: string | undefined;
  overpayment_approved_by?: string | undefined;
  overpayment_approved_at?: string | undefined;
}

export interface CachedSettlementPayment {
  id: string;
  settlement_id: string;
  amount_poisha: string;
  paid_on: string;
  reference?: string | undefined;
  is_reversal?: boolean | undefined;
  reverses_payment_id?: string | undefined; // Aligned with DDL
  reverses_id?: string | undefined; // Backward-compatible alias
  receipt_storage_path?: string | undefined; // Aligned with DDL
  receipt_path?: string | undefined; // Backward-compatible alias
  note?: string | undefined;
  recorded_by?: string | undefined;
  created_at?: string | undefined;
}

export interface CachedStatement {
  id: string;
  month: string;
  kind: 'single_payable' | 'combined_card';
  source: 'manual_total' | 'file';
  status: 'open' | 'reconciled' | 'superseded';
  total_gross_poisha?: string | undefined;
  total_fee_poisha?: string | undefined;
  net_poisha?: string | undefined;
  expected_poisha?: string | undefined;
  variance_poisha?: string | undefined;
  reconciled_at?: string | undefined;
  reconciled_by?: string | undefined;
}

export interface CachedStatementLine {
  id: string;
  statement_id: string;
  line_date: string;
  gross_poisha: string;
  fee_poisha: string;
  net_poisha?: string | undefined;
  match_status: 'unmatched' | 'matched' | 'accepted';
  matched_entry_id?: string | undefined;
  is_active_match?: boolean | undefined;
  review_note?: string | undefined;
}

export interface CachedMonthClose {
  month: string; // YYYY-MM-01
  status: 'closed' | 'open';
  closed_at?: string | undefined;
  closed_by?: string | undefined;
  reopened_at?: string | undefined;
  reopened_by?: string | undefined;
  reopen_reason?: string | undefined;
}

export interface CachedRejectedOp {
  opId: string;
  op_id?: string | undefined; // Backward-compatible snake_case alias
  entry_id?: string | undefined;
  error_code: string;
  error_message: string;
  reason?: string | undefined; // Backward-compatible alias for error_message
  rejected_at: string;
  status: 'pending' | 'resolved' | 'discarded';
  payload: Record<string, unknown>;
}

export interface CachedMeta {
  key: string; // 'pullCursor', 'deviceId', 'lastSync'
  value: string | number | boolean | Record<string, unknown>;
  updated_at: string;
}

export interface CachedAppSettings {
  id: string | boolean;
  net_label: string;
  reconcile_tolerance_poisha: string;
  timezone?: string | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
  organization_name?: string | undefined;
  business_address?: string | undefined;
  vat_registration_no?: string | undefined;
  sync_retention_days?: number | undefined;
  updated_at: string;
}

export class CosmoDatabase extends Dexie {
  entries!: Table<LocalEntry, string>;
  outbox!: Table<LocalOutboxOp, string>;
  rateProfiles!: Table<CachedRateProfile, string>;
  methods!: Table<CachedPaymentMethod, string>;
  payables!: Table<CachedPayable, string>;
  profiles!: Table<CachedProfile, string>;
  settlements!: Table<CachedSettlement, string>;
  settlementPayments!: Table<CachedSettlementPayment, string>;
  statements!: Table<CachedStatement, string>;
  statementLines!: Table<CachedStatementLine, string>;
  monthCloses!: Table<CachedMonthClose, string>;
  rejectedOps!: Table<CachedRejectedOp, string>;
  meta!: Table<CachedMeta, string>;
  appSettings!: Table<CachedAppSettings, string | boolean>;

  constructor() {
    super('CosmoLedgerTrackDB');

    // Dexie Indexing Invariant (PRD §9.1):
    // NO indexes on string monetary amounts (lexicographical sorting bug prevention).
    // NO indexes on boolean properties (W3C IndexedDB spec key compatibility).
    this.version(1).stores({
      entries: 'id, entry_date, status, server_seq, created_by, method_id, sync_status',
      outbox: 'opId, userId, type, status, clientCreatedAt',
      rateProfiles: 'id, version, status, effective_from',
      methods: 'id, code, display_order',
      payables: 'id, kind, method_id',
      profiles: 'id, role',
      settlements: 'id, month, payable_id, status',
      settlementPayments: 'id, settlement_id, paid_on',
      statements: 'id, month, status, kind',
      statementLines: 'id, statement_id, match_status, matched_entry_id',
      monthCloses: 'month, status',
      rejectedOps: 'opId, status, rejected_at',
      meta: 'key',
      appSettings: 'id',
    });
  }
}

export const db = new CosmoDatabase();
```

### 6.2 `apps/web/src/lib/db/outbox.ts`

```ts
import { db, type LocalOutboxOp } from './index';

export async function enqueueCreateEntry(op: {
  opId: string;
  userId: string;
  payload: Record<string, unknown>;
  maxKnownRateVersion: number;
  supersedesRejectedOpId?: string | undefined;
}): Promise<void> {
  const outboxItem: LocalOutboxOp = {
    opId: op.opId,
    userId: op.userId,
    type: 'create_entry',
    payload: op.payload,
    clientCreatedAt: new Date().toISOString(),
    maxKnownRateVersion: op.maxKnownRateVersion,
    supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
    status: 'pending',
  };

  await db.outbox.put(outboxItem);
}

export async function enqueueSupersedeEntry(op: {
  opId: string;
  userId: string;
  payload: {
    originalEntryId: string;
    replacement: Record<string, unknown>;
  };
  maxKnownRateVersion: number;
  supersedesRejectedOpId?: string | undefined;
}): Promise<void> {
  const outboxItem: LocalOutboxOp = {
    opId: op.opId,
    userId: op.userId,
    type: 'supersede_entry',
    payload: op.payload,
    clientCreatedAt: new Date().toISOString(),
    maxKnownRateVersion: op.maxKnownRateVersion,
    supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
    status: 'pending',
  };

  await db.outbox.put(outboxItem);
}

export async function getPendingOutboxOps(): Promise<LocalOutboxOp[]> {
  return await db.outbox.where('status').equals('pending').sortBy('clientCreatedAt');
}
```

### 6.3 `apps/web/src/lib/db/rates.ts`

```ts
import { db, type CachedRateProfile } from './index';

/**
 * Resolves the date-effective published rate profile from local Dexie storage.
 * Ordering per PRD §6.5 & §7.3: effective_from DESC, version DESC LIMIT 1.
 */
export async function resolveEffectiveRateProfile(entryDate: string): Promise<CachedRateProfile | null> {
  const profiles = await db.rateProfiles
    .where('status')
    .equals('published')
    .toArray();

  const matching = profiles
    .filter((p) => p.effective_from <= entryDate)
    .sort((a, b) => {
      if (a.effective_from !== b.effective_from) {
        return b.effective_from.localeCompare(a.effective_from);
      }
      return b.version - a.version;
    });

  return matching[0] ?? null;
}

/**
 * Retrieves the highest published rate profile version known to the client.
 * Serves as the mandatory maxKnownRateVersion watermark (Rule 9, Finding C4).
 */
export async function getMaxKnownRateVersion(): Promise<number> {
  const profiles = await db.rateProfiles.where('status').equals('published').toArray();
  if (profiles.length === 0) return 1;
  return Math.max(...profiles.map((p) => p.version));
}
```

### 6.4 `apps/web/src/lib/db/entries.ts`

```ts
import { db, type LocalEntry } from './index';
import { enqueueCreateEntry, enqueueSupersedeEntry } from './outbox';
import { getMaxKnownRateVersion } from './rates';
import type { RateSnapshot } from '@clt/calc';

export interface SaveEntryInput {
  entryDate: string;
  customerName: string;
  subQty: number;
  subDescription?: string | undefined;
  methodId: string;
  grossPoisha: bigint;
  vatPoisha: bigint;
  commissionPoisha: bigint;
  businessChargePoisha: bigint;
  customerChargePoisha: bigint;
  netPoisha: bigint;
  snapshot: RateSnapshot;
  vatInputPoisha?: bigint | undefined;
  vatOverridePoisha?: bigint | undefined;
  commissionOverridePoisha?: bigint | undefined;
  txnRef?: string | undefined;
  notes?: string | undefined;
  rateProfileId: string;
  userId: string;
  supersedesOriginalId?: string | undefined;
}

export async function saveLocalEntry(input: SaveEntryInput): Promise<LocalEntry> {
  const entryId = crypto.randomUUID().toLowerCase();
  const localBadge = `#LOCAL-${entryId.substring(0, 6)}`;
  const maxRateVersion = await getMaxKnownRateVersion();
  const totalCharge = input.businessChargePoisha + input.customerChargePoisha;

  const entryRecord: LocalEntry = {
    id: entryId,
    local_id: localBadge,
    entry_date: input.entryDate,
    customer_name: input.customerName,
    sub_qty: input.subQty,
    sub_description: input.subDescription ?? undefined,
    method_id: input.methodId,
    gross_poisha: input.grossPoisha.toString(),
    vat_poisha: input.vatPoisha.toString(),
    commission_poisha: input.commissionPoisha.toString(),
    charge_poisha: totalCharge.toString(),
    business_charge_poisha: input.businessChargePoisha.toString(),
    customer_charge_poisha: input.customerChargePoisha.toString(),
    net_poisha: input.netPoisha.toString(),
    txn_ref: input.txnRef ?? undefined,
    notes: input.notes ?? undefined,
    status: 'active',
    sync_status: 'pending',
    created_by: input.userId,
    created_at: new Date().toISOString(),
    stale_rates: false,
    rate_profile_id: input.rateProfileId,
    snapshot: input.snapshot,
    vat_input_poisha: input.vatInputPoisha !== undefined ? input.vatInputPoisha.toString() : undefined,
    supersedes_id: input.supersedesOriginalId ?? undefined,
  };

  // Wire payload conforming to rpc_push_sync_op, entryDtoSchema, and canonical RFC 8785 hash format
  // PRD §6.3 (F20) & chk_vat_input_mode_exclusivity: vatInputPoisha MUST be null when not manual
  const wirePayload = {
    id: entryId, // Explicit ID required by server create_entry
    entryId,
    entryDate: input.entryDate,
    customerName: input.customerName,
    subQty: input.subQty,
    subDescription: input.subDescription ?? null,
    methodId: input.methodId,
    grossPoisha: input.grossPoisha.toString(),
    snapshot: input.snapshot,
    rateSnapshot: input.snapshot,
    vatInputPoisha: input.vatInputPoisha !== undefined ? input.vatInputPoisha.toString() : null,
    vatOverridePoisha: input.vatOverridePoisha !== undefined ? input.vatOverridePoisha.toString() : null,
    commissionOverridePoisha: input.commissionOverridePoisha !== undefined ? input.commissionOverridePoisha.toString() : null,
    vatPoisha: input.vatPoisha.toString(),
    commissionPoisha: input.commissionPoisha.toString(),
    chargePoisha: totalCharge.toString(),
    businessChargePoisha: input.businessChargePoisha.toString(),
    customerChargePoisha: input.customerChargePoisha.toString(),
    netPoisha: input.netPoisha.toString(),
    netAfterDeductionsPoisha: input.netPoisha.toString(),
    txnRef: input.txnRef ?? null,
    notes: input.notes ?? null,
    rateProfileId: input.rateProfileId,
  };

  await db.transaction('rw', [db.entries, db.outbox], async () => {
    await db.entries.put(entryRecord);

    if (input.supersedesOriginalId) {
      // Mark original entry locally as superseded to prevent double-counting in offline ledger/reports
      await db.entries.update(input.supersedesOriginalId, {
        status: 'superseded',
      });

      await enqueueSupersedeEntry({
        opId: crypto.randomUUID().toLowerCase(),
        userId: input.userId,
        payload: {
          originalEntryId: input.supersedesOriginalId,
          replacement: wirePayload,
        },
        maxKnownRateVersion: maxRateVersion,
      });
    } else {
      await enqueueCreateEntry({
        opId: crypto.randomUUID().toLowerCase(),
        userId: input.userId,
        payload: wirePayload,
        maxKnownRateVersion: maxRateVersion,
      });
    }
  });

  return entryRecord;
}

export async function checkDuplicate(input: {
  entryDate: string;
  methodId: string;
  txnRef?: string | undefined;
  customerName: string;
  grossPoisha: bigint;
  excludeEntryId?: string | undefined;
}): Promise<boolean> {
  let activeEntries = await db.entries
    .where('entry_date')
    .equals(input.entryDate)
    .filter((e) => e.status === 'active')
    .toArray();

  if (input.excludeEntryId) {
    activeEntries = activeEntries.filter((e) => e.id !== input.excludeEntryId);
  }

  if (input.txnRef) {
    const normRef = input.txnRef.trim().toUpperCase();
    const hasRefMatch = activeEntries.some(
      (e) => e.method_id === input.methodId && e.txn_ref?.toUpperCase() === normRef
    );
    if (hasRefMatch) return true;
  }

  const grossStr = input.grossPoisha.toString();
  return activeEntries.some(
    (e) => e.customer_name.toLowerCase() === input.customerName.toLowerCase() && e.gross_poisha === grossStr
  );
}
```


### 6.5 `apps/web/src/lib/ui/ReceiptBreakdown.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    grossPoisha: bigint;
    vatPoisha: bigint;
    commissionPoisha: bigint;
    chargePoisha: bigint;
    netPoisha: bigint;
    chargesBorneBy: 'business' | 'customer';
    methodName: string;
    vatMode?: string | undefined;
    vatBp?: number | undefined;
    commissionBp?: number | undefined;
    chargeBp?: number | undefined;
  }

  let {
    grossPoisha,
    vatPoisha,
    commissionPoisha,
    chargePoisha,
    netPoisha,
    chargesBorneBy,
    methodName,
    vatMode = 'manual',
    vatBp,
    commissionBp,
    chargeBp,
  }: Props = $props();
</script>

<div class="receipt-breakdown">
  <Card class="p-5 border-dashed border-2 border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/20">
    <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Live Calculation Breakdown</span>
      <span class="text-[11px] font-mono text-[var(--muted)]">Engine v1</span>
    </div>

    <div class="space-y-2.5 text-xs font-mono">
      <!-- Gross -->
      <div class="flex justify-between items-center">
        <span class="font-sans font-medium text-[var(--ink)]">Gross Collected</span>
        <span class="font-semibold text-sm text-[var(--ink)]">{formatPoishaToBdt(grossPoisha)}</span>
      </div>

      <!-- VAT Deduction (Safe decimal percentage format without BigInt division crash) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">
          VAT ({vatMode === 'manual' ? 'manual' : `${((vatBp ?? 0) / 100).toFixed(2)}%`})
        </span>
        <span class="text-amber-800 dark:text-amber-400">
          {vatPoisha > 0n ? `-${formatPoishaToBdt(vatPoisha)}` : formatPoishaToBdt(0n)}
        </span>
      </div>

      <!-- Commission Deduction (minus sign per PRD §6.3 & §8.1) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">Commission ({commissionBp !== undefined ? (commissionBp / 100).toFixed(2) : '0.00'}%)</span>
        <span class="text-emerald-800 dark:text-emerald-400">
          {commissionPoisha > 0n ? `-${formatPoishaToBdt(commissionPoisha)}` : formatPoishaToBdt(0n)}
        </span>
      </div>

      <!-- Provider Charge (deducted if business-borne, excluded if customer-borne) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">
          {methodName} ({chargeBp !== undefined ? (chargeBp / 100).toFixed(2) : '0.00'}%)
        </span>
        {#if chargesBorneBy === 'customer'}
          <span class="text-blue-700 dark:text-blue-300">
            {formatPoishaToBdt(chargePoisha)} <span class="font-sans text-[10px]">(Customer-paid — not deducted)</span>
          </span>
        {:else}
          <span class="text-rose-700 dark:text-rose-400">
            {chargePoisha > 0n ? `-${formatPoishaToBdt(chargePoisha)}` : formatPoishaToBdt(0n)}
          </span>
        {/if}
      </div>

      <!-- Divider -->
      <div class="border-t border-dashed border-black/20 dark:border-white/20 pt-2.5 mt-2">
        <div class="flex justify-between items-center">
          <span class="font-sans font-bold text-xs uppercase tracking-wider text-[var(--ink)]">Net After Deductions</span>
          <span class="font-bold text-base text-[var(--ink)]">{formatPoishaToBdt(netPoisha)}</span>
        </div>
      </div>
    </div>
  </Card>
</div>
```

### 6.6 `apps/web/src/lib/ui/DuplicateWarning.svelte`

```svelte
<script lang="ts">
  interface Props {
    visible: boolean;
  }

  let { visible }: Props = $props();
</script>

{#if visible}
  <div
    role="status"
    class="duplicate-warning p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2"
  >
    <span class="text-base">⚠</span>
    <span>A transaction with this reference or customer name already exists today. Verify details before saving.</span>
  </div>
{/if}
```

### 6.7 `apps/web/src/routes/(app)/entries/new/+page.svelte` (S06 New Entry)

```svelte
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
  import { calculateEntry, DeductionsExceedGrossError, type RateSnapshot } from '@clt/calc';
  import { parseBdtToPoisha } from '@clt/shared';

  // Form State initialized to Asia/Dhaka current date (PRD §8.1)
  let entryDate = $state(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  let customerName = $state('');
  let subQty = $state(1);
  let subDescription = $state('');
  let grossInput = $state('');
  let selectedMethodId = $state<string>(''); // Method UUID
  let txnRef = $state('');
  let manualVatInput = $state('');
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

  // Supersede Mode State (S07)
  let supersedingOriginalId = $state<string | null>(null);
  let supersedingOriginalBadge = $state<string | null>(null);

  // Computed selected method record
  let currentMethod = $derived(methods.find((m) => m.id === selectedMethodId));
  let requiresTxnRef = $derived(currentMethod?.requires_txn_ref ?? false);

  // Historical Rate Difference Notice
  let hasRateDeviation = $derived(
    activeProfile !== null && activeProfile.version !== latestRateVersion
  );

  async function loadInitialContext() {
    // 1. Load active payment methods with memory filter to avoid IndexedDB boolean key bugs
    const allMethods = await db.methods.orderBy('display_order').toArray();
    methods = allMethods.filter((m) => m.active);
    if (methods.length > 0 && !selectedMethodId) {
      selectedMethodId = methods[0].id;
    }

    // 2. Resolve latest watermark version
    latestRateVersion = await getMaxKnownRateVersion();

    // 3. Resolve profile for selected date
    await updateProfileForDate();

    // 4. Check for ?supersede=<id> query parameter
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const supersedeId = urlParams.get('supersede');
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

          selectedMethodId = orig.method_id;
          txnRef = orig.txn_ref ?? '';
          notes = orig.notes ? `[Supersedes ${supersedingOriginalBadge}] ${orig.notes}` : `[Supersedes ${supersedingOriginalBadge}]`;
          await updateProfileForDate();
        } else if (orig && orig.status !== 'active') {
          saveErrorMessage = 'Cannot supersede transaction that is already voided or superseded.';
        }
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

    try {
      const res = calculateEntry({
        grossPoisha,
        snapshot,
        vatInputPoisha: activeProfile.vat_mode === 'manual' ? manualVatPoisha : undefined,
      });
      return { ...res, error: '' };
    } catch (e: any) {
      const msg = (e instanceof DeductionsExceedGrossError || e.name === 'DeductionsExceedGrossError')
        ? 'Total deductions (VAT + Commission + Provider Fee) exceed gross collected. Net cannot be negative.'
        : (e.message || 'Calculation error');
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
    if (grossPoisha <= 0n || isMonthClosed || !!calculationError || !!grossInputError) {
      return;
    }
    if (requiresTxnRef && !txnRef.trim()) {
      saveErrorMessage = 'Transaction reference is mandatory for this payment channel.';
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
      manualVatInput = '';
      notes = '';
      subDescription = '';
      subQty = 1;
      supersedingOriginalId = null;
      supersedingOriginalBadge = null;
      duplicateVisible = false;

      const customerInput = document.getElementById('input-customer');
      customerInput?.focus();
    } catch (err: any) {
      saveErrorMessage = `Save error: ${err.message}`;
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
      <p class="text-sm text-[var(--muted)]">Local-first payment recording completes in &lt;100ms and syncs automatically.</p>
    </div>
    <div class="flex items-center gap-2">
      <Chip variant="default">{session.isOnline ? 'Online' : 'Offline'}</Chip>
      <Chip variant="default">#LOCAL-xxxx</Chip>
    </div>
  </div>

  {#if saveSuccessMessage}
    <div class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm">
      {saveSuccessMessage}
    </div>
  {/if}

  {#if saveErrorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm font-semibold">
      {saveErrorMessage}
    </div>
  {/if}

  {#if !activeProfile && methods.length > 0}
    <div class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-sm">
      No published rate profile found effective for {entryDate}. Please verify the entry date or connect to sync published rates.
    </div>
  {/if}

  {#if isMonthClosed}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm font-semibold">
      Selected month is closed. New entries cannot be recorded for closed calendar months.
    </div>
  {/if}

  {#if hasRateDeviation}
    <div class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-xs">
      Rates for {entryDate} differ from current rates (v{activeProfile?.version} vs current v{latestRateVersion}).
    </div>
  {/if}

  {#if calculationError}
    <div class="mb-6 p-4 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-300 text-xs font-semibold">
      ⚠ {calculationError}
    </div>
  {/if}

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Form Card -->
    <div class="lg:col-span-2">
      <Card class="p-6">
        {#if supersedingOriginalId}
          <div class="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-800 dark:text-blue-300 text-xs flex items-center justify-between">
            <span>Superseding Entry: <strong>{supersedingOriginalBadge}</strong> (original entry will be marked superseded)</span>
            <button
              type="button"
              class="text-xs font-semibold underline hover:opacity-80 ml-2"
              onclick={() => {
                supersedingOriginalId = null;
                supersedingOriginalBadge = null;
              }}
            >Cancel supersede</button>
          </div>
        {/if}

        <form onsubmit={handleLocalSave} class="flex flex-col gap-4">
          <DuplicateWarning visible={duplicateVisible} />

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="input-date" class="block text-xs font-semibold text-[var(--muted)] mb-1">Date (Asia/Dhaka)</label>
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
              <label for="input-customer" class="block text-xs font-semibold text-[var(--muted)] mb-1">Customer Name</label>
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
              <label for="input-qty" class="block text-xs font-semibold text-[var(--muted)] mb-1">Sub Quantity / Sessions</label>
              <input
                id="input-qty"
                type="number"
                min="1"
                bind:value={subQty}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
              />
            </div>

            <div>
              <label for="input-sub-desc" class="block text-xs font-semibold text-[var(--muted)] mb-1">Item / Session Description</label>
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
            <label for="input-gross" class="block text-xs font-semibold text-[var(--muted)] mb-1">Gross Collected (BDT)</label>
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
            <label class="block text-xs font-semibold text-[var(--muted)] mb-2">Payment Method</label>
            <div class="flex flex-wrap gap-2">
              {#each methods as m (m.id)}
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-full text-xs font-medium border transition-all {selectedMethodId === m.id ? 'bg-[var(--ink)] text-[var(--bg)] border-transparent' : 'bg-white/40 border-black/10 text-[var(--ink)] hover:bg-white/70'}"
                  onclick={() => {
                    selectedMethodId = m.id;
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
              required={requiresTxnRef}
              placeholder="e.g. BJT84920KL"
              bind:value={txnRef}
              oninput={(e) => {
                txnRef = (e.target as HTMLInputElement).value.toUpperCase();
                triggerDuplicateCheck();
              }}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono uppercase"
            />
          </div>

          <!-- Manual VAT Input if activeProfile.vat_mode === 'manual' -->
          {#if activeProfile?.vat_mode === 'manual'}
            <div>
              <label for="input-vat" class="block text-xs font-semibold text-[var(--muted)] mb-1">Manual VAT Collected (BDT)</label>
              <input
                id="input-vat"
                type="text"
                placeholder="0.00"
                bind:value={manualVatInput}
                class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
              />
            </div>
          {/if}

          <div>
            <label for="input-notes" class="block text-xs font-semibold text-[var(--muted)] mb-1">Notes</label>
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
            disabled={isSaving || isMonthClosed || grossPoisha <= 0n || !customerName.trim() || !selectedMethodId || !activeProfile || !!grossInputError || !!calculationError}
          >
            {isSaving ? 'Saving...' : supersedingOriginalId ? 'Supersede & Save Entry' : 'Save Entry (<100ms)'}
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
        chargesBorneBy={activeProfile?.method_rates[selectedMethodId]?.charges_borne_by ?? 'business'}
        methodName={currentMethod?.name ?? 'Method Charge'}
        vatMode={activeProfile?.vat_mode}
        vatBp={activeProfile?.vat_bp}
        commissionBp={activeProfile?.commission_bp}
        chargeBp={activeProfile?.method_rates[selectedMethodId]?.fee_bp}
      />
    </div>
  </div>
</div>
```

### 6.8 `apps/web/src/lib/db/dexie.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './index';
import { saveLocalEntry } from './entries';
import type { RateSnapshot } from '@clt/calc';

describe('Local-First Dexie Storage & Performance', () => {
  const defaultSnapshot: RateSnapshot = {
    rateProfileId: 'a0000000-0000-0000-0000-000000000001',
    version: 1,
    engineVersion: 1,
    vat: { mode: 'manual', bp: 0 },
    commission: { bp: 4200, base: 'gross_minus_vat' },
    chargeBp: 115,
    chargesBorneBy: 'business',
    rounding: 'half_up',
  };

  beforeEach(async () => {
    await db.entries.clear();
    await db.outbox.clear();
    await db.rateProfiles.clear();
    await db.methods.clear();

    await db.rateProfiles.put({
      id: 'a0000000-0000-0000-0000-000000000001',
      version: 1,
      status: 'published',
      effective_from: '2026-01-01',
      vat_mode: 'manual',
      vat_bp: 0,
      commission_bp: 4200,
      commission_base: 'gross_minus_vat',
      method_rates: {
        'b0000000-0000-0000-0000-000000000001': { fee_bp: 115, charges_borne_by: 'business' },
        'b0000000-0000-0000-0000-000000000002': { fee_bp: 150, charges_borne_by: 'customer' },
      },
    });

    await db.methods.bulkPut([
      {
        id: 'b0000000-0000-0000-0000-000000000001',
        code: 'bkash',
        name: 'bKash Merchant',
        requires_txn_ref: true,
        display_order: 1,
        active: true,
      },
      {
        id: 'b0000000-0000-0000-0000-000000000002',
        code: 'visa',
        name: 'Visa Card',
        requires_txn_ref: false,
        display_order: 2,
        active: true,
      },
    ]);
  });

  it('completes local entry save within 100 milliseconds', async () => {
    const start = performance.now();

    const saved = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Ziaur Rahman',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 590900n,
      vatPoisha: 50900n,
      commissionPoisha: 226800n,
      businessChargePoisha: 6795n,
      customerChargePoisha: 0n,
      netPoisha: 306405n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const elapsed = performance.now() - start;
    expect(elapsed, `Save duration ${elapsed}ms must be < 100ms`).toBeLessThan(100);
    expect(saved.local_id).toMatch(/^#LOCAL-[0-9a-f]{6}$/);

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps.length).toBe(1);
    expect(outboxOps[0].userId).toBe('u1');
    expect(outboxOps[0].maxKnownRateVersion).toBe(1);
    expect((outboxOps[0].payload as Record<string, any>).id).toBe(saved.id);
    expect((outboxOps[0].payload as Record<string, any>).grossPoisha).toBe('590900');
  });

  it('guarantees decimal strings for all monetary amounts in storage', async () => {
    await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Test Customer',
      subQty: 2,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 100000n,
      vatPoisha: 0n,
      commissionPoisha: 42000n,
      businessChargePoisha: 1150n,
      customerChargePoisha: 0n,
      netPoisha: 56850n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const stored = await db.entries.toArray();
    expect(typeof stored[0].gross_poisha).toBe('string');
    expect(stored[0].gross_poisha).toBe('100000');
    expect(stored[0].snapshot).toBeDefined();
    expect(stored[0].charge_poisha).toBe('1150');
  });

  it('correctly records customer-borne fee without merchant deduction in outbox', async () => {
    const cardSnapshot: RateSnapshot = {
      ...defaultSnapshot,
      chargeBp: 150,
      chargesBorneBy: 'customer',
    };

    await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Card Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000002',
      grossPoisha: 100000n,
      vatPoisha: 0n,
      commissionPoisha: 42000n,
      businessChargePoisha: 0n,
      customerChargePoisha: 1500n,
      netPoisha: 58000n,
      snapshot: cardSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps[0].userId).toBe('u1');
    expect((outboxOps[0].payload as Record<string, any>).businessChargePoisha).toBe('0');
    expect((outboxOps[0].payload as Record<string, any>).customerChargePoisha).toBe('1500');
    expect((outboxOps[0].payload as Record<string, any>).netAfterDeductionsPoisha).toBe('58000');
  });

  it('marks original entry locally as superseded when created in supersede mode', async () => {
    const orig = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Original Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 200000n,
      vatPoisha: 0n,
      commissionPoisha: 84000n,
      businessChargePoisha: 2300n,
      customerChargePoisha: 0n,
      netPoisha: 113700n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    expect(orig.status).toBe('active');

    // Create replacement superseding orig
    const replacement = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Corrected Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 200000n,
      vatPoisha: 0n,
      commissionPoisha: 84000n,
      businessChargePoisha: 2300n,
      customerChargePoisha: 0n,
      netPoisha: 113700n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
      supersedesOriginalId: orig.id,
    });

    const updatedOrig = await db.entries.get(orig.id);
    expect(updatedOrig?.status).toBe('superseded');
    expect(replacement.status).toBe('active');
  });
});
```


## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Local Save Latency | 5,909 BDT transaction | `elapsed < 100` milliseconds | §12 | `apps/web/src/lib/db/dexie.test.ts` |
| Decimal Storage Precision | 100,000 poisha | `typeof gross_poisha === 'string'` | §9.1 | `apps/web/src/lib/db/dexie.test.ts` |
| Test #4 64-Bit Wire Precision | Large monetary value | String `"590900"` preserved without float truncation | §16.2 #4 | `apps/web/src/lib/db/dexie.test.ts` |
| Test #5 Customer Fee Isolation | Customer fee payment | Excluded from business deduction; `customerChargePoisha` populated | §16.2 #5 | `apps/web/src/lib/db/dexie.test.ts` |
| Test #42 Deductions Exceed Gross Error & NULL-safe JSONB constraint | Deductions > gross | Blocked by UI calculation guard with visible alert before save | §16.2 #42 | `apps/web/src/routes/(app)/entries/new/+page.svelte` |
| Test #43 Customer Borne Fee Payable Exemption | Customer fee entry | Merchant payable net liability is zero | §16.2 #43 | `apps/web/src/lib/ui/ReceiptBreakdown.svelte` |
| Test #50 Txn Ref Normalization | `'  bjt84920kl  '` | Normalized to `'BJT84920KL'` | §16.2 #50 | `apps/web/src/routes/(app)/entries/new/+page.svelte` |

## 8. Acceptance criteria

1. Local entry save completes within 100 milliseconds and writes to Dexie.
   - Command: `pnpm --filter @clt/web test dexie.test.ts`
   - Expected output: `All tests passing`.
2. Outbox operation enqueued with mandatory `maxKnownRateVersion` and canonical wire payload containing `id`.
   - Command: `pnpm --filter @clt/web test dexie.test.ts`
   - Expected output: `4 passed`.
3. SvelteKit route typecheck passes cleanly with zero errors under strict TypeScript.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha used internally; all monetary values stored and transmitted as decimal strings. No floats anywhere in money path.
- Rule 3: Authoritative `calculateEntry` from `packages/calc` executes for all live computations. Formatter `formatPoishaToBdt` from `@clt/shared` formats money.
- Rule 4: Entries are immutable snapshots; complete rate snapshot saved with each entry.
- Rule 6: Never block a Save on network connectivity; local Dexie save completes in <100ms.
- Rule 9: Server trusts nothing from client; client snapshot fields (`version`, `chargesBorneBy`, `engineVersion`) match server database expectations.
- Rule 11: Zod validates all input schemas.

## 10. Pitfalls

- Trap: Creating Dexie indexes on string amounts causes lexicographical sorting bugs (`"9999" > "100000"`).
  - Fix: Do not declare indexes on string monetary fields; sort in memory after parsing per PRD §9.1.
- Trap: Calling non-existent `calculateEntryComponents` function in `@clt/calc`.
  - Fix: Import and invoke `calculateEntry` with `CalcInput` conforming to Plan 002.
- Trap: Defaulting `vatInputPoisha` to `'0'` breaks percentage VAT modes under constraint `chk_vat_input_mode_exclusivity`.
  - Fix: Ensure `vatInputPoisha` is `null` when `input.vatInputPoisha` is undefined per PRD §6.3 and Plan 003.
- Trap: Using payment method code string (`'bkash'`) instead of UUID causes PostgreSQL type crash (`22P02: invalid input syntax for type uuid`).
  - Fix: Dynamically query `db.methods` and bind `selectedMethodId` to payment method UUIDs.
- Trap: Client generates lowercase transaction references causing reconciliation mismatches.
  - Fix: Normalize reference strings on save via `nullif(upper(trim(rawInput)), '')` per PRD §8.1.
- Trap: User enters more than 2 decimal places in BDT gross inputs.
  - Fix: Reject inputs with > 2 decimal places with inline error message per PRD §9.1.
- Trap: Omitting `id` or `version` from outbox payload or snapshot causes server sync push rejections (`invalid_snapshot_rules`).
  - Fix: Always include `id: entryId` in outbox payload and full `RateSnapshot` (`rateProfileId`, `version`, `engineVersion`, `chargesBorneBy`, `rounding`).
- Trap: Defining hand-rolled currency formatters in Svelte components.
  - Fix: Always import `formatPoishaToBdt` from `@clt/shared` to enforce South Asian comma grouping (`1,23,456.00`).
- Trap: Failing to update original entry status locally during supersede creation creates double-counting in offline ledger.
  - Fix: Execute `db.entries.update(origId, { status: 'superseded' })` atomically in the local save transaction.

## 11. PRD ISSUES and DECISION PENDING

- none

## 12. Handoff

- Local database `db` exported from `apps/web/src/lib/db/index.ts`.
- `outbox` table and `getPendingOutboxOps` exported for consumption by Plan 011 sync engine.
- Transaction entry screen available at `/entries/new`.

## 13. Suggested task breakdown

- `CLT-PLAN-010-A`: Define Dexie database schema, TypeScript types with exact optional properties, non-monetary indexes, and outbox models (Files: `apps/web/src/lib/db/index.ts`, `apps/web/src/lib/db/outbox.ts`; Depends on: none; Role: Builder; Priority: P0).
- `CLT-PLAN-010-B`: Implement date-effective profile lookup and entry repository with complete rate snapshots, nullable VAT input, and local supersede status updates (Files: `apps/web/src/lib/db/rates.ts`, `apps/web/src/lib/db/entries.ts`; Depends on: `CLT-PLAN-010-A`; Role: Builder; Priority: P0).
- `CLT-PLAN-010-C`: Build receipt breakdown with South Asian BDT formatting, deduction minus signs, and non-blocking duplicate warning UI (Files: `apps/web/src/lib/ui/ReceiptBreakdown.svelte`, `DuplicateWarning.svelte`; Depends on: `CLT-PLAN-010-B`; Role: Builder; Priority: P1).
- `CLT-PLAN-010-D`: Build S06 transaction entry screen with dynamic UUID methods, closed-month guard, deduction error handling, and latency benchmark tests (Files: `apps/web/src/routes/(app)/entries/new/+page.svelte`, `apps/web/src/lib/db/dexie.test.ts`; Depends on: `CLT-PLAN-010-C`; Role: Builder; Priority: P0).

## Changelog

- Revision 2.2 — 2026-11-01:
  - Multi-User Outbox Partitioning: Added `userId: string` to `LocalOutboxOp`, `enqueueCreateEntry`, `enqueueSupersedeEntry`, `saveLocalEntry`, and indexed `userId` in `db.outbox` stores string (`opId, userId, type, status, clientCreatedAt`), resolving outbox push deadlock with Plan 011 multi-user queue filtering (Test #62).
  - BigInt / Number Division TypeError Fix: Replaced fatal BigInt/Number division `((vatPoisha * 10000n) / (grossPoisha || 1n)) / 100` in `ReceiptBreakdown.svelte` with `vatBp?: number | undefined` prop and safe formatted percentage `${((vatBp ?? 0) / 100).toFixed(2)}%`.
  - Svelte 5 Pure Derived Signals: Decoupled `grossInputError` and `calculationError` state mutations out of `$derived.by` computations into pure derived signals (`grossInputError`, `calculationState`, `calculationError`), eliminating `state_unsafe_mutation` crashes.
  - Button Component Variant Alignment: Replaced unsupported `variant="primary"` on `<Button id="btn-save">` with `variant="default"` per Plan 007 UI kit specification.
  - W3C IndexedDB Key Compliance: Purged invalid boolean property `active` from Dexie index stores for `methods`, `payables`, `profiles`; filtered active methods in memory in `loadInitialContext()` to eliminate `DataError: The parameter is not a valid key`. Declared `id: string | boolean` on `CachedAppSettings` and `appSettings` table.
  - CachedAppSettings Schema Alignment: Aligned `CachedAppSettings` with Postgres Table 18 and Plan 011/015 (`net_label: string`, `reconcile_tolerance_poisha: string`).
  - Hard Rule 1 Rate Fallback Purge: Removed 150 bp hardcoded rate fallback in `new/+page.svelte` and default `commissionBp`/`chargeBp` props in `ReceiptBreakdown.svelte`; returns explicit calculation error when a method is unconfigured in the active rate profile.
  - Rate Snapshot Persistence in LocalEntry: Added `snapshot?: RateSnapshot | undefined`, `charge_poisha: string`, and `vat_input_poisha?: string | undefined` to `LocalEntry` and populated them in `saveLocalEntry` (Hard Rule 4).
  - Supersede Duplicate Warning & Status Guard: Added `excludeEntryId` to `checkDuplicate` to eliminate false positive duplicate alerts during supersede flows; added `orig.status === 'active'` check to prevent superseding already voided/superseded records.
  - Sub-Quantity Input Guard: Changed sub-quantity input `min="0"` to `min="1"` and enforced `Math.max(1, subQty)` conforming to Plan 002 `entryDtoSchema`.
  - Outbox DTO Compliance: Included `netPoisha`, `netAfterDeductionsPoisha`, and `rateSnapshot` in outbox wire payload matching Plan 002 `entryDtoSchema`.
  - Cleaned unused `formatPoishaToBdt` import in `new/+page.svelte` and updated `dexie.test.ts` type assertions and assertions for `userId`.
- Revision 2.1 — 2026-10-30:
  - Replaced non-existent `calculateEntryComponents` import with authoritative `calculateEntry`, `RateSnapshot`, and `DeductionsExceedGrossError` from `@clt/calc`.
  - Added visual error banner in `new/+page.svelte` when `DeductionsExceedGrossError` occurs and disabled `#btn-save`.
  - Fixed fatal `vatInputPoisha ?? '0'` bug in `entries.ts` by setting `vatInputPoisha` to `null` when `input.vatInputPoisha` is undefined, avoiding `chk_vat_input_mode_exclusivity` rejections.
  - Replaced hardcoded method string codes (`'bkash'`) with dynamic method UUID loading from `db.methods`.
  - Enforced dynamic `required={requiresTxnRef}` on `#input-txn-ref` when the selected method requires a transaction reference.
  - Added missing form inputs for `subDescription` (`#input-sub-desc`) and `notes` (`#input-notes`) in `new/+page.svelte`.
  - Expanded Dexie schema in `index.ts` to declare all missing PRD §9 tables: `profiles`, `rejectedOps`, `meta`, and aligned `CachedRateProfile` fields to `vat_bp` and `commission_bp`.
  - Fixed TypeScript strict compilation by adding `supersedes_id?: string | undefined` to `LocalEntry` and applying `| undefined` across optional properties (`exactOptionalPropertyTypes: true`).
  - Added missing `snapshot` argument to `dexie.test.ts` test cases.
  - Replaced floating-point division `(Number(...) / 100).toFixed(2)` in supersede pre-population with pure BigInt division (`/ 100n` and `% 100n`).
  - Added atomic local status update `db.entries.update(origId, { status: 'superseded' })` in `saveLocalEntry` to eliminate offline double-counting.
  - Fixed Commission deduction rendering in `ReceiptBreakdown.svelte` to show `-` (deduction) rather than `+`.
  - Added `fake-indexeddb` package installation step to Preconditions and aligned Acceptance Criterion 2 command to `pnpm --filter @clt/web test dexie.test.ts`.
- Revision 2.0 — 2026-10-30:
  - Replaced hand-rolled `formatBdt` in `ReceiptBreakdown.svelte` with `formatPoishaToBdt` from `@clt/shared` enforcing South Asian comma grouping.
  - Handled customer-borne charges in `ReceiptBreakdown.svelte` rendering `(Customer-paid — not deducted)` without net deduction.
  - Hardened client snapshot in `saveLocalEntry` to include mandatory `rateProfileId`, `version`, `engineVersion: 1`, `chargesBorneBy`, and `rounding: 'half_up'` preventing server sync rejection `invalid_snapshot_rules`.
  - Added explicit `id: entryId` to outbox wire payload preventing NOT NULL constraint violations in Postgres sync handler.
  - Aligned Section 7 test mappings to exact PRD §16.2 tests (Tests #4, #5, #42, #43, #50) and updated task breakdown to `CLT-PLAN-010-A..D` with `Role: Builder`.
- 2026-10-29: Fully wired B24 supersede consumer flow in outbox and new entry form.
- 2026-10-29: Initial specification created for Plan 010 aligned with PRD v1.19 §6.5, §8.1, and §9.
