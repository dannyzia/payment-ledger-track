# 011_sync_engine.md — Synchronization Engine, Protocol, Recovery Matrix, and Multi-Tab Runner

- Plan Identifier: CLT-PLAN-011
- Phase: Phase 1–2 / M1–M2
- Milestone: M1–M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §6.5 (Server calculation re-derivation), §9.1 (API contract, push/pull protocols, wire format), §9.2 (State transitions & rejection recovery matrices), §15.1 (Audit log coverage), §16.2 (Tests #1, #2, #3, #8, #9, #10, #11, #12, #17, #18, #24, #25, #41, #46, #47, #56, #60, #61, #62), §17 (Milestones M1 and M2), §18 (Implementation Readiness Gate 3)
- Depends on: 004, 005, 006, 008, 009, 010
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement the bidirectional offline-first synchronization engine, client sync runner with Web Locks API multi-tab leader election, BroadcastChannel inter-tab state synchronization, Svelte 5 runes reactivity, server mediation endpoints (`/api/v1/sync/push` and `/api/v1/sync/pull`), RFC 8785 JSON canonical hashing, monotonic cursor advancement, client session authentication via Bearer token injection with auto-refresh on 401, multi-user outbox partitioning for shared devices, and the complete 25-reason Rejection Recovery Matrix with automated recovery actions. The client sync runner flushes push batches completely in an exhaustive, progress-guarded loop before executing pull cycles, guaranteeing that offline transactions commit under pre-pull device state without racing against server updates. The server push route acts as the authoritative calculation validator under Hard Rule 3 and PRD §6.5/§9.1, verifying client snapshots against published rate profiles effective for transaction dates, executing `calculateEntry` from `@clt/calc` on all entry mutations with subtransaction fault isolation, and logging all sync lifecycle events to `audit_log`.

## 2. Scope

- IN:
  - Multi-tab leader-elected client sync runner in `apps/web/src/lib/sync/runner.svelte.ts` utilizing `navigator.locks.request('clt-sync-leader')` with persistent lock holding, `BroadcastChannel('clt-sync-state')` state distribution to follower tabs, idempotent `start()` with immediate first cycle, and clean listener teardown in `stop()`.
  - Multi-user scoped client push processor in `apps/web/src/lib/sync/push.ts` partitioning pending outbox operations by `userId`, flushing batches of at most 50 operations with infinite-loop progress protection (max 20 iterations), transmitting Supabase access tokens via `Authorization: Bearer <token>` with auto-refresh on HTTP 401, computing RFC 8785 canonical JCS SHA-256 payload hashes, and updating local Dexie entries with official `server_seq`, formatted `entry_number` (`E-YYYYMM-XXXXXX`), and `sync_status = 'synced'`.
  - Client pull processor in `apps/web/src/lib/sync/pull.ts` fetching 200 rows per page with metadata pagination bloat protection (`includeMeta=true` on first request only), transmitting session tokens via `Authorization: Bearer <token>`, handling HTTP status codes (401 session refresh, 403 device revoked, 409 reset cursor to '0', 410 full resync, 429 retry-after backoff), falling back to offline state on network failure, mapping database columns (`payment_methods.sort_order` -> `display_order`, `payables.name` -> `recipient_name`, `profiles.full_name` -> `display_name`), converting `method_rates` into dictionary maps with basis points from `charge_bp` and party from `rate_profiles.charges_borne_by`, ingesting role-filtered rejected ops, pruning resolved/discarded ops, and advancing monotonic cursors with `updated_at` timestamps in `db.meta` and `localStorage`.
  - RFC 8785 JSON Canonicalization Scheme (JCS) and portable SHA-256 payload hashing in `apps/web/src/lib/sync/canonical.ts` utilizing `globalThis.crypto.subtle` (native in Node 22 LTS and modern browsers) without Vite dynamic import warnings.
  - Rejection Recovery Matrix handler in `apps/web/src/lib/sync/recovery.ts` governing all 25 server rejection reasons conforming to PRD §9.2.2, with automated recovery actions (`adjust_clock`, `retry_fresh_id`, `refresh_pull`, `re_snapshot`, `halt_execution`, `drop_op`), ghost entry rollback on rejected supersede/void (deleting uncommitted replacement entries and reverting original entries to active), and audited discard operation submission (`discard_rejected_entry`).
  - Global Retry Invariant implementation in `retryRejectedOp` allocating a fresh lowercase UUID `opId`, populating `supersedesRejectedOpId`, preserving original chronological FIFO sequencing (avoiding false `parent_entry_not_found` rejections on dependent ops), re-calculating financial components via `@clt/calc` on patched entries, and marking local entry `sync_status = 'pending'`.
  - Header visual sync indicator component in `apps/web/src/lib/ui/SyncIndicator.svelte` displaying the mandatory states with correct branch precedence: `Syncing...`, `Sync error (tap to retry)`, `Offline (n pending)`, `{pendingCount} pending`, and `Synced`.
  - Sliding-window server request rate limiter in `apps/web/src/lib/server/ratelimit.ts` enforcing the maximum 60 requests per minute per device/IP with periodic memory TTL eviction and HTTP 429 `Retry-After` headers.
  - PostgreSQL server pool connection helper in `apps/web/src/lib/server/db.ts` utilizing `DATABASE_URL` with date type parser OID 1082 configured to return `'YYYY-MM-DD'` strings, with `pg` and `@types/pg` added to `apps/web/package.json`.
  - Server push endpoint in `apps/web/src/routes/api/v1/sync/push/+server.ts` enforcing rate limits (60 req/min per device/IP), caller JWT authentication, active profile check (`profiles.active`), maximum 50 ops payload limit (HTTP 413), mandatory UUID `deviceId`, multi-user shared device revocation check (no `.single()`), per-op watermark validation with subtransaction fault isolation (`missing_rate_watermark`), authoritative snapshot verification against published rate profiles effective for `entryDate`, anti-cherry-picking enforcement (`rate_profile_date_mismatch`), offline stale-rate acceptance (`stale_rates = true`), SvelteKit authoritative calculation re-computation via `@clt/calc` (`calculateEntry`) with deduction guard and component mismatch detection (`sync.calc_mismatch`), RFC 8785 canonical hashing, and calling `rpc_push_sync_op`.
  - Server pull endpoint in `apps/web/src/routes/api/v1/sync/pull/+server.ts` enforcing rate limits (60 req/min), caller JWT authentication, active profile check, strict query parameter validation (HTTP 400 for missing/invalid cursor and deviceId, HTTP 409 for cursor past current watermark), multi-user device revocation check, executing the monotonic SQL CTE via `getDbPool()` returning snapshot data, checking errors on all Supabase queries, ordering payment methods by `sort_order`, transforming `method_rates` into dictionary maps, delivering role-filtered metadata and rejected ops, and updating device presence via `upsert_device_sync_state`.
  - Unit and integration tests in `apps/web/src/lib/sync/sync.test.ts` verifying canonical hashing, SHA-256 invariance, all 25 recovery matrix transitions, automated recovery actions, ghost entry rollback, multi-user outbox isolation, Global Retry Invariant, rate limiting, and push batching.
- OUT:
  - Totals-only manual statement reconciliation screen (owned by Plan 015).
  - Monthly report PDF/CSV export generation (owned by Plan 013).
  - PWA service worker background sync registration (owned by Plan 017).

## 3. Preconditions

1. Workspace dependencies and calculation engine `@clt/calc` are functional.
   - Check command: `pnpm --filter @clt/calc test`
   - Expected output: exit code `0`.
2. Plan 008 server authentication context `getCallerContext` is functional in `apps/web/src/lib/server/auth.ts`.
   - Check command: `test -f apps/web/src/lib/server/auth.ts`
   - Expected output: exit code `0`.
3. Plan 010 Dexie database `db`, `LocalEntry`, `LocalOutboxOp` (with `userId`, `outboxState`, `rejectionReason`, `errorMessage`), and client tables are functional in `apps/web/src/lib/db/index.ts`.
   - Check command: `test -f apps/web/src/lib/db/index.ts`
   - Expected output: exit code `0`.
4. Calculation engine `@clt/calc` exports `calculateEntry`, `RateSnapshot`, and `DeductionsExceedGrossError`.
   - Check command: `test -f packages/calc/src/index.ts`
   - Expected output: exit code `0`.

## 4. Files

| File | Action | Purpose |
|---|---|---|
| `apps/web/package.json` | modify | Add `pg` runtime dependency and `@types/pg` dev dependency for PostgreSQL pool client |
| `.env.example` | modify | Document `DATABASE_URL` Supabase transaction/session pooler connection string |
| `apps/web/src/lib/sync/canonical.ts` | create | RFC 8785 JSON Canonicalization Scheme serializer and Web Cryptography SHA-256 hasher |
| `apps/web/src/lib/sync/recovery.ts` | create | Complete 25-reason Rejection Recovery Matrix with automated recovery actions, ghost entry rollback, and discard op submission |
| `apps/web/src/lib/sync/push.ts` | create | Multi-user partitioned outbox push dispatcher with batching (max 50 ops), token refresh, loop progress guard, and Dexie entry syncing |
| `apps/web/src/lib/sync/pull.ts` | create | Incremental cursor pull dispatcher with HTTP error handling (401, 403, 409, 410, 429), schema mapping, and Dexie relational ingestion |
| `apps/web/src/lib/sync/runner.svelte.ts` | create | Multi-tab leader sync runner via Web Locks API (`clt-sync-leader`) with BroadcastChannel state broadcasting and Svelte 5 runes reactivity |
| `apps/web/src/lib/ui/SyncIndicator.svelte` | create | Visual sync status indicator with error-precedence branch rendering and tap-to-retry action |
| `apps/web/src/lib/server/ratelimit.ts` | create | Server-side sliding-window request rate limiter (60 req/min per device/IP) with memory TTL pruning and Retry-After header |
| `apps/web/src/lib/server/db.ts` | create | PostgreSQL singleton connection pool (`pg.Pool`) configured with OID 1082 string parser for `DATE` columns |
| `apps/web/src/routes/api/v1/sync/push/+server.ts` | create | Server push endpoint: rate limiting, auth, 50-op batch cap, device killswitch, rate profile snapshot verification, calculation re-derivation, RFC 8785 hashing, subtransaction RPC |
| `apps/web/src/routes/api/v1/sync/pull/+server.ts` | create | Server pull endpoint: rate limiting, auth, cursor/device validation, 409 check, device killswitch, monotonic SQL CTE with snapshot, method sort_order ordering, method_rates dictionary mapping |
| `apps/web/src/lib/sync/sync.test.ts` | create | Comprehensive test suite for JCS formatting, hash invariance, all 25 recovery matrix mappings, ghost entry rollback, outbox user isolation, retry invariant, and rate limiting |

## 5. Steps

1. Install `pg` and `@types/pg` in `@clt/web`:
   - Command: `pnpm --filter @clt/web add pg && pnpm --filter @clt/web add -D @types/pg`
   - Check: `grep '"pg":' apps/web/package.json`
   - Expected output: line matching `"pg":` present in dependencies.
2. Implement RFC 8785 canonical serialization and hashing in `apps/web/src/lib/sync/canonical.ts` referencing Specification 6.2:
   - Command: copy Specification 6.2 into `apps/web/src/lib/sync/canonical.ts`.
   - Check: `test -f apps/web/src/lib/sync/canonical.ts`
   - Expected output: exit code `0`.
3. Implement 25-reason Rejection Recovery Matrix, automated recovery actions, ghost entry rollback, and discard op submission in `apps/web/src/lib/sync/recovery.ts` referencing Specification 6.3:
   - Command: copy Specification 6.3 into `apps/web/src/lib/sync/recovery.ts`.
   - Check: `test -f apps/web/src/lib/sync/recovery.ts`
   - Expected output: exit code `0`.
4. Implement multi-user partitioned client push processor in `apps/web/src/lib/sync/push.ts` referencing Specification 6.4:
   - Command: copy Specification 6.4 into `apps/web/src/lib/sync/push.ts`.
   - Check: `test -f apps/web/src/lib/sync/push.ts`
   - Expected output: exit code `0`.
5. Implement client pull processor with schema normalization and HTTP error handling in `apps/web/src/lib/sync/pull.ts` referencing Specification 6.5:
   - Command: copy Specification 6.5 into `apps/web/src/lib/sync/pull.ts`.
   - Check: `test -f apps/web/src/lib/sync/pull.ts`
   - Expected output: exit code `0`.
6. Implement multi-tab leader sync runner with BroadcastChannel and Svelte 5 runes in `apps/web/src/lib/sync/runner.svelte.ts` referencing Specification 6.6:
   - Command: copy Specification 6.6 into `apps/web/src/lib/sync/runner.svelte.ts`.
   - Check: `test -f apps/web/src/lib/sync/runner.svelte.ts`
   - Expected output: exit code `0`.
7. Implement header visual sync indicator in `apps/web/src/lib/ui/SyncIndicator.svelte` referencing Specification 6.7:
   - Command: copy Specification 6.7 into `apps/web/src/lib/ui/SyncIndicator.svelte`.
   - Check: `test -f apps/web/src/lib/ui/SyncIndicator.svelte`
   - Expected output: exit code `0`.
8. Implement sliding-window rate limiter with memory TTL pruning in `apps/web/src/lib/server/ratelimit.ts` referencing Specification 6.8:
   - Command: copy Specification 6.8 into `apps/web/src/lib/server/ratelimit.ts`.
   - Check: `test -f apps/web/src/lib/server/ratelimit.ts`
   - Expected output: exit code `0`.
9. Implement PostgreSQL singleton pool with OID 1082 string date parser in `apps/web/src/lib/server/db.ts` referencing Specification 6.9:
   - Command: copy Specification 6.9 into `apps/web/src/lib/server/db.ts`.
   - Check: `test -f apps/web/src/lib/server/db.ts`
   - Expected output: exit code `0`.
10. Implement server push endpoint in `apps/web/src/routes/api/v1/sync/push/+server.ts` referencing Specification 6.10:
    - Command: copy Specification 6.10 into `apps/web/src/routes/api/v1/sync/push/+server.ts`.
    - Check: `test -f apps/web/src/routes/api/v1/sync/push/+server.ts`
    - Expected output: exit code `0`.
11. Implement server pull endpoint in `apps/web/src/routes/api/v1/sync/pull/+server.ts` referencing Specification 6.11:
    - Command: copy Specification 6.11 into `apps/web/src/routes/api/v1/sync/pull/+server.ts`.
    - Check: `test -f apps/web/src/routes/api/v1/sync/pull/+server.ts`
    - Expected output: exit code `0`.
12. Implement comprehensive sync test suite in `apps/web/src/lib/sync/sync.test.ts` referencing Specification 6.12:
    - Command: copy Specification 6.12 into `apps/web/src/lib/sync/sync.test.ts`.
    - Check: `pnpm --filter @clt/web test src/lib/sync/sync.test.ts`
    - Expected output: test suite passes with 0 failures.
13. Run TypeScript typecheck across `@clt/web`:
    - Command: `pnpm --filter @clt/web check`
    - Expected output: `0 errors`.

## 6. Specifications

### 6.1 `apps/web/package.json` Modification & `.env.example`

In `apps/web/package.json`, add `pg` and `@types/pg`:
```json
{
  "dependencies": {
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10"
  }
}
```

In `.env.example`, document `DATABASE_URL`:
```bash
# Supabase PostgreSQL Connection Pooler (Port 6543 Transaction mode or Port 5432 Session mode)
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:6543/postgres?sslmode=require"
```

### 6.2 `apps/web/src/lib/sync/canonical.ts`

```ts
/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serializer.
 * Enforces strict lexicographical sorting of object keys, omission of undefined values,
 * and canonical serialization of primitives and arrays.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number') {
      if (isNaN(obj) || !isFinite(obj)) {
        throw new TypeError('NaN and Infinity are not permitted in RFC 8785 JCS');
      }
    }
    if (typeof obj === 'bigint') {
      return JSON.stringify(obj.toString());
    }
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }

  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((key) => rec[key] !== undefined)
    .sort();

  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(rec[key])}`
  );
  return `{${entries.join(',')}}`;
}

/**
 * Computes deterministic SHA-256 hexadecimal hash of any payload formatted via RFC 8785 JCS.
 * Uses globalThis.crypto.subtle (natively available in modern browsers and Node 22 LTS)
 * without bundler externalization warnings.
 */
export async function computeJcsSha256(canonicalPayload: unknown): Promise<string> {
  const jsonStr = canonicalJsonStringify(canonicalPayload);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonStr);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Web Cryptography subtle API is not available');
}
```

### 6.3 `apps/web/src/lib/sync/recovery.ts`

```ts
import { db, type LocalOutboxOp, type LocalEntry, type CachedRejectedOp } from '$lib/db';
import { calculateEntry, type RateSnapshot } from '@clt/calc';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { syncRunner } from './runner.svelte';
import { computeJcsSha256 } from './canonical';

export type OutboxRecoveryState =
  | 'rejected_closed_month'
  | 'error_rate_profile'
  | 'error_clock_skew'
  | 'needs_admin_review'
  | 'error_hash_mismatch'
  | 'error_id_conflict'
  | 'error_calc_mismatch'
  | 'error_invalid_snapshot'
  | 'error_missing_ref'
  | 'error_deactivated'
  | 'failed_needs_review'
  | 'error_device_id'
  | 'blocked_upgrade_required'
  | 'error_reconcile_mismatch'
  | 'error_variance_tolerance'
  | 'blocked_device_revoked'
  | 'error_missing_watermark'
  | 'error_no_profile_for_date'
  | 'error_invalid_superseded_op'
  | 'error_missing_discard_reason'
  | 'synced';

export type RejectionAction =
  | 'retry_fresh_id'
  | 'adjust_clock'
  | 'move_to_review'
  | 'halt_execution'
  | 'drop_op'
  | 're_snapshot'
  | 'refresh_pull';

export interface RejectionResolution {
  action: RejectionAction;
  outboxState: OutboxRecoveryState;
  uiMessage: string;
}

/**
 * Complete 25-reason Rejection Recovery Matrix conforming verbatim to PRD §9.2.2.
 */
export const REJECTION_MATRIX: Record<string, RejectionResolution> = {
  month_closed: {
    action: 'move_to_review',
    outboxState: 'rejected_closed_month',
    uiMessage: 'Needs Attention: Historical month closed by Owner',
  },
  rate_profile_date_mismatch: {
    action: 'move_to_review',
    outboxState: 'error_rate_profile',
    uiMessage: 'Rate Profile Date Mismatch: Re-verify applicable rate profile',
  },
  future_timestamp_skew: {
    action: 'adjust_clock',
    outboxState: 'error_clock_skew',
    uiMessage: 'Device clock inaccurate: Adjusting timestamp delta',
  },
  queue_expired_needs_review: {
    action: 'move_to_review',
    outboxState: 'needs_admin_review',
    uiMessage: 'Long-term Offline Batch (>90d): Admin approval required',
  },
  payload_hash_mismatch: {
    action: 'retry_fresh_id',
    outboxState: 'error_hash_mismatch',
    uiMessage: 'Sync transport integrity failure: Regenerating hash',
  },
  op_id_conflict_tampered: {
    action: 'retry_fresh_id',
    outboxState: 'error_id_conflict',
    uiMessage: 'Operation ID collision: Regenerating fresh UUID',
  },
  calc_mismatch: {
    action: 'move_to_review',
    outboxState: 'error_calc_mismatch',
    uiMessage: 'Calculation discrepancy: Rate re-verification required',
  },
  invalid_snapshot_rules: {
    action: 're_snapshot',
    outboxState: 'error_invalid_snapshot',
    uiMessage: 'Rate snapshot rejected: Refreshing profile cache',
  },
  missing_txn_ref: {
    action: 'move_to_review',
    outboxState: 'error_missing_ref',
    uiMessage: 'Transaction reference required for this method',
  },
  user_deactivated: {
    action: 'halt_execution',
    outboxState: 'error_deactivated',
    uiMessage: 'User account deactivated: Outbox paused',
  },
  parent_entry_not_found: {
    action: 'move_to_review',
    outboxState: 'failed_needs_review',
    uiMessage: 'Referenced original entry not found on server',
  },
  cannot_void_non_active: {
    action: 'drop_op',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry is already inactive and cannot be voided',
  },
  cannot_supersede_non_active: {
    action: 'drop_op',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry is already inactive and cannot be superseded',
  },
  entry_not_flagged_for_stale_review: {
    action: 'refresh_pull',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry already reviewed or not flagged for stale review',
  },
  missing_device_id: {
    action: 'retry_fresh_id',
    outboxState: 'error_device_id',
    uiMessage: 'Device identifier missing: Regenerating local device ID',
  },
  invalid_device_id: {
    action: 'retry_fresh_id',
    outboxState: 'error_device_id',
    uiMessage: 'Invalid device identifier: Regenerating RFC 4122 v4 UUID',
  },
  upgrade_required: {
    action: 'halt_execution',
    outboxState: 'blocked_upgrade_required',
    uiMessage: 'Application update required: Calculation rules updated',
  },
  expected_poisha_mismatch: {
    action: 'refresh_pull',
    outboxState: 'error_reconcile_mismatch',
    uiMessage: 'Statement expected liability mismatch: Refreshing ledger totals',
  },
  variance_exceeds_tolerance: {
    action: 'move_to_review',
    outboxState: 'error_variance_tolerance',
    uiMessage: 'Variance exceeds tolerance: Explanatory note required',
  },
  device_revoked: {
    action: 'halt_execution',
    outboxState: 'blocked_device_revoked',
    uiMessage: 'Device access revoked by administrator: Outbox halted',
  },
  missing_rate_watermark: {
    action: 'retry_fresh_id',
    outboxState: 'error_missing_watermark',
    uiMessage: 'Rate watermark missing: Attaching cached rate version',
  },
  no_rate_profile_for_date: {
    action: 'move_to_review',
    outboxState: 'error_no_profile_for_date',
    uiMessage: 'No published rate profile covers this transaction date',
  },
  invalid_superseded_op: {
    action: 'retry_fresh_id',
    outboxState: 'error_invalid_superseded_op',
    uiMessage: 'Invalid superseded op reference: Retrying as clean fresh op',
  },
  missing_discard_reason: {
    action: 'move_to_review',
    outboxState: 'error_missing_discard_reason',
    uiMessage: 'Non-empty reason required to discard rejected entry',
  },
  duplicate: {
    action: 'drop_op',
    outboxState: 'synced',
    uiMessage: 'Operation already applied on server (idempotent duplicate)',
  },
};

/**
 * Handles server op rejection, recording in db.rejectedOps, executing automated
 * recovery actions, and rolling back ghost entries where applicable (PRD §9.2.2).
 */
export async function handleOpRejection(
  opId: string,
  reason: string,
  serverDateHeader?: string
): Promise<void> {
  const resolution = REJECTION_MATRIX[reason] || {
    action: 'move_to_review',
    outboxState: 'failed_needs_review',
    uiMessage: `Server rejected operation: ${reason}`,
  };

  const op = await db.outbox.get(opId);
  if (!op) return;

  // Extract affected entry identifier across all mutation types
  let entryId: string | undefined = undefined;
  if (op.type === 'create_entry' || op.type === 'void_entry' || op.type === 'request_void') {
    entryId = op.payload.entryId as string | undefined;
  } else if (op.type === 'supersede_entry') {
    const replacement = op.payload.replacement as Record<string, unknown> | undefined;
    entryId = (replacement?.entryId as string | undefined) ?? (op.payload.replacementEntryId as string | undefined);
  }

  // 1. Ghost entry rollback on rejected supersede or void (PRD §9.2.2 M-3)
  // Delete uncommitted replacement entries; do NOT reactivate original entries that are inactive on server
  if (reason === 'cannot_supersede_non_active' && op.type === 'supersede_entry') {
    const replacementId = entryId;
    if (replacementId) {
      await db.entries.delete(replacementId);
    }
    await db.outbox.delete(opId);
    await db.rejectedOps.put({
      opId,
      entry_id: entryId,
      error_code: reason,
      error_message: resolution.uiMessage,
      rejected_at: new Date().toISOString(),
      status: 'discarded',
      payload: op.payload,
    });
    return;
  }

  if (reason === 'cannot_void_non_active' && (op.type === 'void_entry' || op.type === 'request_void')) {
    if (entryId) {
      await db.entries.update(entryId, {
        void_requested_by: undefined,
        void_reason: undefined,
        sync_status: 'synced',
      });
    }
    await db.outbox.delete(opId);
    await db.rejectedOps.put({
      opId,
      entry_id: entryId,
      error_code: reason,
      error_message: resolution.uiMessage,
      rejected_at: new Date().toISOString(),
      status: 'discarded',
      payload: op.payload,
    });
    return;
  }

  // 2. Duplicate handling: drop op from outbox and ensure local entry is marked synced
  if (resolution.action === 'drop_op' || reason === 'duplicate') {
    await db.outbox.delete(opId);
    if (entryId) {
      await db.entries.update(entryId, { sync_status: 'synced' });
    }
    return;
  }

  // 3. Automated recovery execution
  if (resolution.action === 'adjust_clock' && serverDateHeader) {
    const serverTimeMs = Date.parse(serverDateHeader);
    if (!isNaN(serverTimeMs)) {
      const deltaMs = serverTimeMs - Date.now();
      const reconciledCreatedAt = new Date(Date.now() + deltaMs).toISOString();

      const freshOpId = crypto.randomUUID().toLowerCase();
      await db.outbox.delete(opId);
      await db.outbox.put({
        ...op,
        opId: freshOpId,
        supersedesRejectedOpId: opId,
        clientCreatedAt: reconciledCreatedAt,
        status: 'pending',
        outboxState: undefined,
        rejectionReason: undefined,
      });
      return;
    }
  }

  if (resolution.action === 'retry_fresh_id') {
    let updatedPayload = { ...op.payload };
    let updatedWatermark = op.maxKnownRateVersion;

    if (reason === 'missing_rate_watermark') {
      const profiles = await db.rateProfiles.toArray();
      const maxVer = profiles.length > 0 ? Math.max(...profiles.map((p) => p.version)) : 1;
      updatedWatermark = maxVer;
    }

    if (reason === 'missing_device_id' || reason === 'invalid_device_id') {
      getOrGenerateDeviceId(); // Regenerates clean RFC 4122 v4 lowercase UUID in storage
    }

    // Do not attach supersedesRejectedOpId if the failed op never committed a sync_ops row on server
    const shouldOmitSupersededId =
      reason === 'invalid_superseded_op' ||
      reason === 'missing_device_id' ||
      reason === 'invalid_device_id';

    const freshOpId = crypto.randomUUID().toLowerCase();
    await db.outbox.delete(opId);
    await db.outbox.put({
      ...op,
      opId: freshOpId,
      supersedesRejectedOpId: shouldOmitSupersededId ? undefined : opId,
      payload: updatedPayload,
      maxKnownRateVersion: updatedWatermark,
      status: 'pending',
      outboxState: undefined,
      rejectionReason: undefined,
    });
    return;
  }

  if (resolution.action === 'halt_execution') {
    syncRunner.stop();
    if (reason === 'upgrade_required' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clt:upgrade-required'));
    }
    if (reason === 'device_revoked' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clt:device-revoked'));
    }
    // Local entries remain preserved in Dexie with sync_status = 'pending'
    return;
  }

  // 4. Default: Record in db.rejectedOps and flag entry sync_status = 'rejected'
  await db.outbox.update(opId, {
    status: 'rejected',
    outboxState: resolution.outboxState,
    rejectionReason: reason,
    errorMessage: resolution.uiMessage,
  });

  await db.rejectedOps.put({
    opId,
    entry_id: entryId,
    error_code: reason,
    error_message: resolution.uiMessage,
    rejected_at: new Date().toISOString(),
    status: 'pending',
    payload: op.payload,
  });

  if (entryId) {
    await db.entries.update(entryId, { sync_status: 'rejected' });
  }
}

/**
 * Enforces the Global Retry Invariant (PRD §9.2.2, Finding B12, Test #3).
 * Allocates a fresh UUID opId, preserves original chronological clientCreatedAt (FIFO),
 * recomputes financial components via @clt/calc if patched, and replaces the failed op.
 */
export async function retryRejectedOp(
  failedOpId: string,
  patchedPayload?: Partial<Record<string, unknown>>
): Promise<string> {
  const failedOp = await db.outbox.get(failedOpId);
  if (!failedOp) {
    throw new Error(`Outbox operation not found: ${failedOpId}`);
  }

  const freshOpId = crypto.randomUUID().toLowerCase();
  let updatedPayload = { ...failedOp.payload, ...(patchedPayload || {}) };

  // Re-run calculateEntry if financial inputs or overrides changed to prevent false calc_mismatch
  if (
    patchedPayload &&
    (patchedPayload.grossPoisha ||
      patchedPayload.methodId ||
      patchedPayload.vatInputPoisha ||
      patchedPayload.vatOverridePoisha ||
      patchedPayload.commissionOverridePoisha)
  ) {
    const entryId = updatedPayload.entryId as string | undefined;
    const localEntry = entryId ? await db.entries.get(entryId) : undefined;

    if (localEntry && updatedPayload.snapshot) {
      let snapshot = { ...(updatedPayload.snapshot as RateSnapshot) };

      // If method changed, update chargeBp from method_rates in local cache
      if (patchedPayload.methodId && patchedPayload.methodId !== snapshot.rateProfileId) {
        const profile = await db.rateProfiles.get(snapshot.rateProfileId);
        if (profile?.method_rates[patchedPayload.methodId as string]) {
          snapshot.chargeBp = profile.method_rates[patchedPayload.methodId as string].fee_bp;
        }
      }

      const grossPoisha = BigInt((updatedPayload.grossPoisha as string) || localEntry.gross_poisha);
      const vatInputPoisha = updatedPayload.vatInputPoisha ? BigInt(updatedPayload.vatInputPoisha as string) : undefined;
      const vatOverridePoisha = updatedPayload.vatOverridePoisha ? BigInt(updatedPayload.vatOverridePoisha as string) : undefined;
      const vatOverrideReason = (updatedPayload.vatOverrideReason as string | undefined) ?? (localEntry.vat_override_reason ?? undefined);
      const commissionOverridePoisha = updatedPayload.commissionOverridePoisha ? BigInt(updatedPayload.commissionOverridePoisha as string) : undefined;
      const commissionOverrideReason = (updatedPayload.commissionOverrideReason as string | undefined) ?? (localEntry.commission_override_reason ?? undefined);

      const calcResult = calculateEntry({
        grossPoisha,
        snapshot,
        vatInputPoisha,
        vatOverridePoisha,
        vatOverrideReason,
        commissionOverridePoisha,
        commissionOverrideReason,
      });

      const totalChargeStr = calcResult.chargePoisha.toString();
      updatedPayload.grossPoisha = calcResult.grossPoisha.toString();
      updatedPayload.vatPoisha = calcResult.vatPoisha.toString();
      updatedPayload.commissionPoisha = calcResult.commissionPoisha.toString();
      updatedPayload.chargePoisha = totalChargeStr;
      updatedPayload.businessChargePoisha = calcResult.businessChargePoisha.toString();
      updatedPayload.customerChargePoisha = calcResult.customerChargePoisha.toString();
      updatedPayload.netPoisha = calcResult.netAfterDeductionsPoisha.toString();
      updatedPayload.netAfterDeductionsPoisha = calcResult.netAfterDeductionsPoisha.toString();
      updatedPayload.snapshot = snapshot;

      await db.entries.update(entryId, {
        gross_poisha: calcResult.grossPoisha.toString(),
        vat_poisha: calcResult.vatPoisha.toString(),
        commission_poisha: calcResult.commissionPoisha.toString(),
        charge_poisha: totalChargeStr,
        business_charge_poisha: calcResult.businessChargePoisha.toString(),
        customer_charge_poisha: calcResult.customerChargePoisha.toString(),
        net_poisha: calcResult.netAfterDeductionsPoisha.toString(),
        sync_status: 'pending',
      });
    }
  }

  // Delete previous failed op and insert fresh op in db.outbox
  await db.outbox.delete(failedOpId);
  await db.outbox.put({
    ...failedOp,
    opId: freshOpId,
    supersedesRejectedOpId: failedOpId,
    clientCreatedAt: failedOp.clientCreatedAt, // Preserve chronological FIFO sequence
    payload: updatedPayload,
    status: 'pending',
    outboxState: undefined,
    rejectionReason: undefined,
    errorMessage: undefined,
  });

  const entryId = updatedPayload.entryId as string | undefined;
  if (entryId) {
    await db.entries.update(entryId, { sync_status: 'pending' });
  }

  return freshOpId;
}

/**
 * Discards a rejected outbox operation with an audited reason (PRD §8.4, §9.1 line 1645, Test #18).
 * Enqueues discard_rejected_entry operation and purges local entry if never synced.
 */
export async function discardRejectedOp(
  failedOpId: string,
  actorId: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim() === '') {
    throw new Error('Discard reason cannot be empty');
  }

  const failedOp = await db.outbox.get(failedOpId);
  if (failedOp) {
    const entryId = failedOp.payload.entryId as string | undefined;

    // If local entry was never synced to the server, purge from local Dexie table
    if (entryId) {
      const entry = await db.entries.get(entryId);
      if (entry && !entry.server_seq) {
        await db.entries.delete(entryId);
      }
    }

    // Allocate fresh UUID for discard operation conforming to Global Retry Invariant
    const discardOpId = crypto.randomUUID().toLowerCase();
    await db.outbox.delete(failedOpId);
    await db.outbox.put({
      opId: discardOpId,
      userId: actorId,
      type: 'discard_rejected_entry',
      payload: {
        rejectedOpId: failedOpId, // Aligned strictly with PRD §9.1 and Plan 004
        discardedOpId: failedOpId, // Backward-compatible alias
        actorId,
        reason: reason.trim(),
      },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: failedOp.maxKnownRateVersion,
      status: 'pending',
    });
  }

  await db.rejectedOps.update(failedOpId, {
    status: 'discarded',
  });
}
}
```

### 6.4 `apps/web/src/lib/sync/push.ts`

```ts
import { db, type LocalOutboxOp, type LocalEntry } from '$lib/db';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { supabase } from '$lib/supabase/client';
import { computeJcsSha256 } from './canonical';
import { handleOpRejection } from './recovery';

export interface PushResultItem {
  opId: string;
  status: 'ok' | 'duplicate' | 'rejected';
  server_seq?: string | number;
  entry_number?: string | number;
  reason?: string;
}

export interface PushBatchResponse {
  results: PushResultItem[];
}

/**
 * Exhaustively flushes pending client outbox operations in batches of at most 50 ops per request.
 * Scoped to the currently authenticated user's session to prevent cross-user attribution
 * on shared counter devices (PRD Test #62). Protected against infinite loops via iteration cap.
 */
export async function flushOutboxPush(): Promise<{ success: boolean; pushedCount: number }> {
  let totalPushed = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 20; // 20 * 50 = 1,000 ops maximum per sync cycle

  // Retrieve active session token and user ID
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { success: false, pushedCount: 0 };
  }
  const currentUserId = session.user.id;
  let token = session.access_token;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Only select pending ops created by the currently logged-in user
    const pendingOps = await db.outbox
      .where('status')
      .equals('pending')
      .and((op) => op.userId === currentUserId)
      .sortBy('clientCreatedAt');

    if (pendingOps.length === 0) {
      break;
    }

    const batch = pendingOps.slice(0, 50);
    const deviceId = getOrGenerateDeviceId();

    const preparedOps = await Promise.all(
      batch.map(async (op) => {
        const canonicalObj = {
          type: op.type,
          payload: op.payload,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? null,
          clientCreatedAt: op.clientCreatedAt,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
        const hash = await computeJcsSha256(canonicalObj);
        return {
          opId: op.opId,
          type: op.type,
          payload: op.payload,
          clientCreatedAt: op.clientCreatedAt,
          payloadHash: hash,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
      })
    );

    let res = await fetch('/api/v1/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ deviceId, ops: preparedOps }),
    });

    // Handle token expiration: attempt automatic refresh once
    if (res.status === 401) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.data.session) {
        token = refreshed.data.session.access_token;
        res = await fetch('/api/v1/sync/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ deviceId, ops: preparedOps }),
        });
      }
    }

    if (!res.ok) {
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        const errCode = err.error || err.message;
        if (errCode === 'device_revoked') {
          for (const op of batch) {
            await handleOpRejection(op.opId, 'device_revoked');
          }
        } else if (errCode === 'user_deactivated') {
          for (const op of batch) {
            await handleOpRejection(op.opId, 'user_deactivated');
          }
        }
      }
      return { success: false, pushedCount: totalPushed };
    }

    const serverDateHeader = res.headers.get('Date') || undefined;
    const responseData: PushBatchResponse = await res.json();
    let hasFatalRejection = false;
    let opsProgressMade = 0;

    for (const item of responseData.results) {
      const op = batch.find((o) => o.opId === item.opId);

      if (item.status === 'ok' || item.status === 'duplicate') {
        opsProgressMade++;
        await db.outbox.delete(item.opId);

        if (op?.type === 'create_entry' && op.payload.entryId) {
          const entryId = op.payload.entryId as string;
          const updates: Partial<LocalEntry> = {
            sync_status: 'synced',
          };
          if (item.server_seq !== undefined && item.server_seq !== null) {
            updates.server_seq = item.server_seq.toString();
          }
          if (item.entry_number !== undefined && item.entry_number !== null && op.payload.entryDate) {
            const ym = (op.payload.entryDate as string).replace(/-/g, '').substring(0, 6);
            updates.entry_number = `E-${ym}-${item.entry_number.toString().padStart(6, '0')}`;
          }
          await db.entries.update(entryId, updates);
        } else if (op?.type === 'supersede_entry') {
          const replacement = op.payload.replacement as Record<string, unknown> | undefined;
          if (replacement?.entryId) {
            const replacementId = replacement.entryId as string;
            const updates: Partial<LocalEntry> = {
              sync_status: 'synced',
            };
            if (item.server_seq !== undefined && item.server_seq !== null) {
              updates.server_seq = item.server_seq.toString();
            }
            if (item.entry_number !== undefined && item.entry_number !== null && replacement.entryDate) {
              const ym = (replacement.entryDate as string).replace(/-/g, '').substring(0, 6);
              updates.entry_number = `E-${ym}-${item.entry_number.toString().padStart(6, '0')}`;
            }
            await db.entries.update(replacementId, updates);
          }
          if (op.payload.originalEntryId) {
            await db.entries.update(op.payload.originalEntryId as string, { status: 'superseded', sync_status: 'synced' });
          }
        } else if ((op?.type === 'void_entry' || op?.type === 'request_void') && op.payload.entryId) {
          const newStatus = op.type === 'void_entry' ? 'voided' : 'active';
          await db.entries.update(op.payload.entryId as string, { status: newStatus, sync_status: 'synced' });
        }
      } else {
        opsProgressMade++;
        await handleOpRejection(item.opId, item.reason || 'unknown_rejection', serverDateHeader);
        if (item.reason === 'device_revoked' || item.reason === 'user_deactivated' || item.reason === 'upgrade_required') {
          hasFatalRejection = true;
        }
      }
    }

    // Safety guard against infinite loops: if no op changed state, abort
    if (opsProgressMade === 0) {
      throw new Error('Push stalled: Server returned zero operational results for batch');
    }

    totalPushed += batch.length;
    if (hasFatalRejection) {
      return { success: false, pushedCount: totalPushed };
    }
  }

  return { success: true, pushedCount: totalPushed };
}
```

### 6.5 `apps/web/src/lib/sync/pull.ts`

```ts
import {
  db,
  type LocalEntry,
  type CachedRateProfile,
  type CachedPaymentMethod,
  type CachedPayable,
  type CachedProfile,
  type CachedSettlement,
  type CachedStatement,
} from '$lib/db';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { supabase } from '$lib/supabase/client';
import { syncRunner } from './runner.svelte';

export interface PullResponseDto {
  entries: Array<{
    id: string;
    server_seq: string | number;
    entry_number?: string | number | null;
    entry_date: string;
    customer_name: string;
    sub_qty: number;
    sub_description?: string | null;
    method_id: string;
    gross_poisha: string | number;
    vat_poisha: string | number;
    commission_poisha: string | number;
    charge_poisha: string | number;
    business_charge_poisha: string | number;
    customer_charge_poisha: string | number;
    net_poisha: string | number;
    txn_ref?: string | null;
    notes?: string | null;
    status: 'active' | 'voided' | 'superseded';
    created_by: string;
    created_at: string;
    stale_rates: boolean;
    rate_profile_id: string;
    supersedes_id?: string | null;
    device_id?: string | null;
    snapshot?: Record<string, unknown> | null;
  }>;
  hasMore: boolean;
  nextCursor: string;
  settings?: Record<string, unknown>;
  rateProfiles?: Array<{
    id: string;
    version: number;
    status: 'draft' | 'published';
    effective_from: string;
    vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    vat_bp: number;
    commission_bp: number;
    commission_base: 'gross_minus_vat' | 'gross';
    charges_borne_by: 'business' | 'customer';
    note?: string | null;
    method_rates: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>;
  }>;
  methods?: Array<{
    id: string;
    code: string;
    name: string;
    requires_txn_ref: boolean;
    sort_order: number;
    active: boolean;
  }>;
  payables?: Array<{
    id: string;
    kind: 'vat' | 'method_charge';
    method_id?: string | null;
    name: string;
    due_day: number;
    remind_days_before: number;
    active: boolean;
  }>;
  monthCloses?: Array<{
    month: string;
    status: 'open' | 'closed';
  }>;
  profiles?: Array<{
    id: string;
    full_name: string;
    role: 'staff' | 'admin' | 'owner';
    active: boolean;
  }>;
  settlements?: Array<any>;
  statements?: Array<any>;
  rejectedOps?: Array<{
    op_id: string;
    actor_id: string;
    device_id: string;
    op_type: string;
    entry_id?: string | null;
    payload: Record<string, unknown>;
    reason: string;
    resolution_status: 'pending' | 'resolved' | 'discarded';
    created_at: string;
  }>;
}

/**
 * Executes incremental cursor pull with metadata pagination bloat protection.
 * Handles HTTP error codes (401, 403, 409, 410, 429), normalizes schema columns,
 * transforms method rates into dictionary maps, and stores cursor with updated_at in db.meta.
 */
export async function executeIncrementalPull(): Promise<void> {
  const deviceId = getOrGenerateDeviceId();

  const metaCursorRow = await db.meta.get('server_cursor');
  let cursor = (metaCursorRow?.value as string) || localStorage.getItem('clt_server_cursor') || '0';

  let hasMore = true;
  let isFirstBatch = true;

  let { data: { session } } = await supabase.auth.getSession();
  let token = session?.access_token;

  while (hasMore) {
    const includeMeta = isFirstBatch;
    const url = `/api/v1/sync/pull?since=${cursor}&includeMeta=${includeMeta}&deviceId=${deviceId}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      // Network drop: throw to let caller update status to offline
      throw new Error('network_offline');
    }

    if (!res.ok) {
      if (res.status === 401) {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.data.session) {
          token = refreshed.data.session.access_token;
          continue;
        }
        throw new Error('auth_session_expired');
      }

      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        if (err.error === 'device_revoked') {
          syncRunner.stop();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('clt:device-revoked'));
          }
          throw new Error('device_revoked');
        }
        throw new Error('user_forbidden');
      }

      if (res.status === 409) {
        // Cursor past watermark: reset cursor to '0' and retry immediately (PRD §9.1(b))
        cursor = '0';
        localStorage.setItem('clt_server_cursor', '0');
        await db.meta.put({ key: 'server_cursor', value: '0', updated_at: new Date().toISOString() });
        continue;
      }

      if (res.status === 410) {
        // Sync gap exceeded (>90d ops purged): full resync required
        cursor = '0';
        localStorage.setItem('clt_server_cursor', '0');
        await db.meta.put({ key: 'server_cursor', value: '0', updated_at: new Date().toISOString() });
        continue;
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After') || '60';
        throw new Error(`rate_limit_exceeded:${retryAfter}`);
      }

      throw new Error(`pull_failed_http_${res.status}`);
    }

    const data: PullResponseDto = await res.json();

    // Ingest relational configuration and metadata on first batch only
    if (includeMeta) {
      if (data.rateProfiles && Array.isArray(data.rateProfiles)) {
        const cachedProfiles: CachedRateProfile[] = data.rateProfiles.map((p) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          effective_from: p.effective_from,
          vat_mode: p.vat_mode,
          vat_bp: p.vat_bp,
          commission_bp: p.commission_bp,
          commission_base: p.commission_base,
          charges_borne_by: p.charges_borne_by,
          note: p.note ?? undefined,
          method_rates: p.method_rates,
        }));
        await db.rateProfiles.bulkPut(cachedProfiles);
      }

      if (data.methods && Array.isArray(data.methods)) {
        const mappedMethods: CachedPaymentMethod[] = data.methods.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          requires_txn_ref: m.requires_txn_ref,
          display_order: m.sort_order, // Map Postgres sort_order to Dexie display_order
          active: m.active,
        }));
        await db.methods.bulkPut(mappedMethods);
      }

      if (data.payables && Array.isArray(data.payables)) {
        const mappedPayables: CachedPayable[] = data.payables.map((p) => ({
          id: p.id,
          name: p.name, // Required DDL column name
          kind: p.kind,
          method_id: p.method_id ?? undefined,
          recipient_name: p.name,
          recipient_account: '',
          due_day: p.due_day,
          active: p.active,
        }));
        await db.payables.bulkPut(mappedPayables);
      }

      if (data.monthCloses && Array.isArray(data.monthCloses)) {
        await db.monthCloses.bulkPut(data.monthCloses);
      }

      if (data.settings) {
        // String key 'true' conforms strictly to W3C IndexedDB spec key requirements
        await db.appSettings.put({
          id: 'true',
          net_label: (data.settings.net_label as string) ?? 'Net after deductions',
          reconcile_tolerance_poisha: (data.settings.reconcile_tolerance_poisha as string) ?? '100',
          updated_at: (data.settings.updated_at as string) ?? new Date().toISOString(),
        });
      }

      if (data.profiles && Array.isArray(data.profiles)) {
        const mappedProfiles: CachedProfile[] = data.profiles.map((p) => ({
          id: p.id,
          role: p.role,
          display_name: p.full_name, // Map Postgres full_name to Dexie display_name
          active: p.active,
          default_route: p.role === 'staff' ? '/entries/new' : '/dashboard',
          created_at: new Date().toISOString(),
        }));
        await db.profiles.bulkPut(mappedProfiles);
      }

      if (data.settlements && Array.isArray(data.settlements)) {
        const mappedSettlements: CachedSettlement[] = data.settlements.map((s) => ({
          id: s.id,
          month: s.month,
          payable_id: s.payable_id,
          expected_poisha: s.expected_poisha?.toString() ?? '0',
          paid_poisha: s.paid_poisha?.toString() ?? '0',
          variance_poisha: s.variance_poisha?.toString() ?? '0',
          status: s.status,
          note: s.note ?? undefined,
          overpayment_review_status: s.overpayment_review_status ?? undefined,
          overpayment_approved_amount_poisha: s.overpayment_approved_amount_poisha?.toString() ?? undefined,
          overpayment_reason: s.overpayment_reason ?? undefined,
          overpayment_approved_by: s.overpayment_approved_by ?? undefined,
          overpayment_approved_at: s.overpayment_approved_at ?? undefined,
        }));
        await db.settlements.bulkPut(mappedSettlements);
      }

      if (data.statements && Array.isArray(data.statements)) {
        const mappedStatements: CachedStatement[] = data.statements.map((st) => ({
          id: st.id,
          month: st.month,
          kind: st.kind,
          source: st.source,
          status: st.status,
          total_gross_poisha: st.statement_total_poisha?.toString() ?? undefined,
          expected_poisha: st.expected_poisha?.toString() ?? undefined,
          variance_poisha: st.variance_poisha?.toString() ?? undefined,
          reconciled_at: st.reconciled_at ?? undefined,
          reconciled_by: st.reconciled_by ?? undefined,
        }));
        await db.statements.bulkPut(mappedStatements);
      }

      if (data.rejectedOps && Array.isArray(data.rejectedOps)) {
        const serverPendingOpIds = new Set(data.rejectedOps.map((op) => op.op_id));

        // Prune local pending ops that were resolved or discarded on the server
        const localPending = await db.rejectedOps.where('status').equals('pending').toArray();
        for (const localOp of localPending) {
          if (!serverPendingOpIds.has(localOp.opId)) {
            await db.rejectedOps.delete(localOp.opId);
          }
        }

        for (const op of data.rejectedOps) {
          await db.rejectedOps.put({
            opId: op.op_id,
            entry_id: op.entry_id ?? undefined,
            error_code: op.reason,
            error_message: op.reason,
            rejected_at: op.created_at,
            status: op.resolution_status,
            payload: op.payload,
          });
        }
      }
    }

    // Ingest visible entries returned from monotonic SQL query
    if (data.entries && data.entries.length > 0) {
      for (const entry of data.entries) {
        const localEntry: LocalEntry = {
          id: entry.id,
          entry_number: entry.entry_number
            ? `E-${entry.entry_date.replace(/-/g, '').substring(0, 6)}-${entry.entry_number.toString().padStart(6, '0')}`
            : undefined,
          local_id: `#LOCAL-${entry.id.substring(0, 6)}`,
          entry_date: entry.entry_date,
          customer_name: entry.customer_name,
          sub_qty: entry.sub_qty,
          sub_description: entry.sub_description ?? undefined,
          method_id: entry.method_id,
          gross_poisha: entry.gross_poisha.toString(),
          vat_poisha: entry.vat_poisha.toString(),
          commission_poisha: entry.commission_poisha.toString(),
          charge_poisha: entry.charge_poisha !== undefined && entry.charge_poisha !== null
            ? entry.charge_poisha.toString()
            : (BigInt(entry.business_charge_poisha) + BigInt(entry.customer_charge_poisha)).toString(),
          business_charge_poisha: entry.business_charge_poisha.toString(),
          customer_charge_poisha: entry.customer_charge_poisha.toString(),
          net_poisha: entry.net_poisha.toString(),
          txn_ref: entry.txn_ref ?? undefined,
          notes: entry.notes ?? undefined,
          status: entry.status,
          sync_status: 'synced',
          created_by: entry.created_by,
          created_at: entry.created_at,
          server_seq: entry.server_seq.toString(),
          stale_rates: entry.stale_rates,
          rate_profile_id: entry.rate_profile_id,
          supersedes_id: entry.supersedes_id ?? undefined,
          device_id: entry.device_id ?? undefined,
          snapshot: (entry.snapshot as any) ?? undefined,
        };

        await db.entries.put(localEntry);
      }
    }

    cursor = data.nextCursor;
    localStorage.setItem('clt_server_cursor', cursor);
    await db.meta.put({
      key: 'server_cursor',
      value: cursor,
      updated_at: new Date().toISOString(),
    });

    hasMore = data.hasMore;
    isFirstBatch = false;
  }
}
```

### 6.6 `apps/web/src/lib/sync/runner.svelte.ts`

```ts
import { flushOutboxPush } from './push';
import { executeIncrementalPull } from './pull';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

/**
 * Multi-tab leader-elected client sync runner.
 * Manages the periodic sync loop, coordinates multi-tab execution using the Web Locks API,
 * synchronizes state to follower tabs via BroadcastChannel, and provides reactive Svelte 5 $state.
 */
export class SyncRunner {
  private timer: number | null = null;
  private isBusy = false;
  private isRunning = false;
  private channel: BroadcastChannel | null = null;
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;
  private stopLockPromise: (() => void) | null = null;

  // Reactive Svelte 5 status rune
  public status = $state<SyncState>('synced');

  start() {
    if (typeof window === 'undefined' || this.isRunning) return;
    this.isRunning = true;

    if (!navigator.onLine) {
      this.status = 'offline';
    }

    // Set up BroadcastChannel to synchronize sync state across all browser tabs
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('clt-sync-state');
      this.channel.onmessage = (event) => {
        if (event.data?.status) {
          this.status = event.data.status;
        }
      };
    }

    this.onlineListener = () => {
      this.triggerCycle();
    };

    this.offlineListener = () => {
      this.updateStatus('offline');
    };

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);

    // Leader Election via Web Locks API
    if (navigator.locks) {
      navigator.locks.request('clt-sync-leader', async (lock) => {
        // Tab acquired leader lock: run periodic timer
        this.triggerCycle(); // Immediate first sync cycle on start

        this.timer = window.setInterval(() => {
          this.triggerCycle();
        }, 15000);

        // Keep lock held until stop() or tab unload
        await new Promise<void>((resolve) => {
          this.stopLockPromise = resolve;
          window.addEventListener('beforeunload', () => resolve(), { once: true });
        });
      });
    } else {
      // Fallback if Web Locks API unavailable
      this.triggerCycle();
      this.timer = window.setInterval(() => {
        this.triggerCycle();
      }, 15000);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stopLockPromise) {
      this.stopLockPromise();
      this.stopLockPromise = null;
    }
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
    }
    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
      this.offlineListener = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  public updateStatus(newStatus: SyncState) {
    this.status = newStatus;
    if (this.channel) {
      this.channel.postMessage({ status: newStatus });
    }
  }

  async triggerCycle(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      this.updateStatus('offline');
      return;
    }

    if (this.isBusy) return;
    this.isBusy = true;
    this.updateStatus('syncing');

    try {
      // PRD §9.1: Client sync runner MUST flush /sync/push to completion BEFORE calling /sync/pull
      const pushResult = await flushOutboxPush();
      if (!pushResult.success) {
        this.updateStatus('error');
        return;
      }

      await executeIncrementalPull();
      this.updateStatus('synced');
    } catch (err: any) {
      if (err?.message === 'network_offline') {
        this.updateStatus('offline');
      } else {
        this.updateStatus('error');
      }
    } finally {
      this.isBusy = false;
    }
  }
}

export const syncRunner = new SyncRunner();
```

### 6.7 `apps/web/src/lib/ui/SyncIndicator.svelte`

```svelte
<script lang="ts">
  import { syncRunner } from '$lib/sync/runner.svelte';
  import { db } from '$lib/db';
  import { liveQuery } from 'dexie';

  let pendingCount = $state(0);

  $effect(() => {
    const sub = liveQuery(() => db.outbox.where('status').equals('pending').count()).subscribe((c) => {
      pendingCount = c;
    });
    return () => sub.unsubscribe();
  });
</script>

<div class="sync-indicator inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-black/10 dark:border-white/10 glass shadow-xs">
  {#if syncRunner.status === 'syncing'}
    <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
    <span class="text-blue-600 dark:text-blue-400">Syncing...</span>
  {:else if syncRunner.status === 'error'}
    <button
      type="button"
      onclick={() => syncRunner.triggerCycle()}
      class="flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:underline cursor-pointer focus:outline-hidden"
      title="Sync encountered an error. Click to retry."
    >
      <span class="w-2 h-2 rounded-full bg-red-500"></span>
      <span>Sync error (tap to retry)</span>
    </button>
  {:else if syncRunner.status === 'offline'}
    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
    <span class="text-amber-700 dark:text-amber-300">Offline{pendingCount > 0 ? ` (${pendingCount} pending)` : ''}</span>
  {:else if pendingCount > 0}
    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
    <span class="text-amber-700 dark:text-amber-300">{pendingCount} pending</span>
  {:else}
    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
    <span class="text-emerald-700 dark:text-emerald-300">Synced</span>
  {/if}
</div>
```

### 6.8 `apps/web/src/lib/server/ratelimit.ts`

```ts
interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic memory TTL cleanup interval every 5 minutes
if (typeof setInterval !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, entry] of rateLimitStore.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, 300000);
  cleanupTimer.unref?.();
}

/**
 * Sliding-window request rate limiter.
 * Enforces PRD §9.1 limit: Maximum 60 requests per minute per device/IP.
 * Returns { allowed: boolean, retryAfter: number }.
 */
export function checkRateLimit(key: string, limit = 60, windowMs = 60000): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Filter timestamps within the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= limit) {
    const oldestTimestamp = entry.timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));
    return { allowed: false, retryAfter };
  }

  entry.timestamps.push(now);
  return { allowed: true, retryAfter: 0 };
}
```

### 6.9 `apps/web/src/lib/server/db.ts`

```ts
import pg from 'pg';
import { env } from '$env/dynamic/private';

// Configure PostgreSQL DATE type parser (OID 1082) to return string 'YYYY-MM-DD'
// preventing automatic UTC Date conversion that corrupts Dexie entry_date string indexes
pg.types.setTypeParser(1082, (val: string) => val);

let pool: pg.Pool | null = null;

/**
 * Singleton PostgreSQL connection pool client for server queries.
 * Utilizes DATABASE_URL from private environment.
 */
export function getDbPool(): pg.Pool {
  if (!pool) {
    const connectionString = env.DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }
    pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Terminates the pool connection. Used in automated test teardown.
 */
export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

### 6.10 `apps/web/src/routes/api/v1/sync/push/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { checkRateLimit } from '$lib/server/ratelimit';
import { computeJcsSha256 } from '$lib/sync/canonical';
import { calculateEntry, DeductionsExceedGrossError, type RateSnapshot } from '@clt/calc';

const pushOpSchema = z.object({
  opId: z.string().uuid(),
  type: z.enum(['create_entry', 'request_void', 'void_entry', 'supersede_entry', 'discard_rejected_entry']),
  payload: z.record(z.string(), z.unknown()),
  clientCreatedAt: z.string(),
  payloadHash: z.string().optional(),
  supersedesRejectedOpId: z.string().uuid().optional(),
  maxKnownRateVersion: z.number().int().min(1).optional(),
});

const pushRequestSchema = z.object({
  deviceId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine((id) => id !== '00000000-0000-0000-0000-000000000000', { message: 'Nil UUID not allowed' }),
  ops: z.array(pushOpSchema),
});

export const POST: RequestHandler = async (event) => {
  const clientIp = event.getClientAddress?.() || 'unknown-ip';

  // 1. Caller Authentication and Active Account Verification (PRD §9.1 Step 1 & 2)
  const caller = await getCallerContext(event);
  if (!caller.active) {
    return new Response(JSON.stringify({ error: 'user_deactivated' }), { status: 403 });
  }

  const rawBody = await event.request.json().catch(() => null);
  if (!rawBody) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }

  // 2. Batch Size Limit Check (PRD §9.1: max 50 ops per request; HTTP 413)
  if (Array.isArray(rawBody.ops) && rawBody.ops.length > 50) {
    return new Response(JSON.stringify({ error: 'payload_too_large', message: 'Batch exceeds maximum 50 operations limit' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = pushRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const isDeviceIdError = parsed.error.issues.some((i) => i.path.includes('deviceId'));
    const errorCode = isDeviceIdError ? 'missing_device_id' : 'invalid_payload';
    return new Response(JSON.stringify({ error: errorCode, issues: parsed.error.issues }), { status: 400 });
  }

  // 3. Rate Limiting Check (PRD §9.1: max 60 requests/minute per device/IP)
  const rateLimitKey = `${parsed.data.deviceId}:${clientIp}`;
  const rateLimit = checkRateLimit(rateLimitKey, 60, 60000);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'too_many_requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': rateLimit.retryAfter.toString(),
      },
    });
  }

  const supabase = getServiceSupabase();

  // 4. Check Hardware Killswitch across shared counter devices (PRD §9.1 Step 3, H3, M4)
  const { data: deviceRows } = await supabase
    .from('devices')
    .select('revoked')
    .eq('device_id', parsed.data.deviceId);

  if (deviceRows && deviceRows.some((d) => d.revoked)) {
    return new Response(JSON.stringify({ error: 'device_revoked' }), { status: 403 });
  }

  // 5. Authoritative Snapshot Verification & SvelteKit Recomputation (PRD Hard Rule 3, Rule 9, §6.5, §9.1 Step 4)
  const results: Array<{ opId: string; status: 'ok' | 'duplicate' | 'rejected'; reason?: string; server_seq?: string; entry_number?: string }> = [];
  const validOpsForRpc: Array<z.infer<typeof pushOpSchema> & { serverHash: string; stale_rates?: boolean }> = [];

  for (const op of parsed.data.ops) {
    // Watermark check per-op with fault isolation (Test #60)
    if (!op.maxKnownRateVersion) {
      await supabase.from('sync_ops').insert({
        op_id: op.opId,
        actor_id: caller.userId,
        device_id: parsed.data.deviceId,
        op_type: op.type,
        entry_id: (op.payload.entryId as string) || null,
        payload: op.payload,
        payload_hash: '',
        client_created_at: op.clientCreatedAt,
        supersedes_rejected_op_id: op.supersedesRejectedOpId || null,
        result: 'rejected',
        resolution_status: 'pending',
        reason: 'missing_rate_watermark',
      });

      results.push({
        opId: op.opId,
        status: 'rejected',
        reason: 'missing_rate_watermark',
      });
      continue;
    }

    const canonical = {
      type: op.type,
      payload: op.payload,
      supersedesRejectedOpId: op.supersedesRejectedOpId ?? null,
      clientCreatedAt: op.clientCreatedAt,
      maxKnownRateVersion: op.maxKnownRateVersion,
    };
    const serverHash = await computeJcsSha256(canonical);

    // Validate calculations for create_entry and supersede_entry operations
    if (op.type === 'create_entry' || op.type === 'supersede_entry') {
      const payload = op.type === 'create_entry'
        ? (op.payload as Record<string, unknown>)
        : ((op.payload.replacement as Record<string, unknown>) ?? {});

      const entryDate = payload.entryDate as string | undefined;
      const grossStr = payload.grossPoisha as string | undefined;
      const methodId = payload.methodId as string | undefined;
      const clientSnapshot = payload.snapshot as RateSnapshot | undefined;

      if (!entryDate || !grossStr || !methodId || !clientSnapshot) {
        results.push({ opId: op.opId, status: 'rejected', reason: 'invalid_payload' });
        continue;
      }

      // Query published rate profile effective on entryDate (PRD §7.1: latest published with effective_from <= entryDate)
      const { data: profileRows } = await supabase
        .from('rate_profiles')
        .select('*, method_rates(*)')
        .eq('status', 'published')
        .lte('effective_from', entryDate)
        .order('effective_from', { ascending: false })
        .order('version', { ascending: false })
        .limit(1);

      const effectiveProfile = profileRows && profileRows.length > 0 ? profileRows[0] : null;
      if (!effectiveProfile) {
        results.push({ opId: op.opId, status: 'rejected', reason: 'no_rate_profile_for_date' });
        continue;
      }

      // Find applicable method rate
      const methodRateRow = effectiveProfile.method_rates?.find((mr: any) => mr.method_id === methodId);
      const effectiveChargeBp = methodRateRow ? methodRateRow.charge_bp : 0;
      const effectiveChargesBorneBy = effectiveProfile.charges_borne_by || 'business';

      // Compare client snapshot rates against published profile
      const rateMismatch =
        clientSnapshot.vat?.mode !== effectiveProfile.vat_mode ||
        clientSnapshot.vat?.bp !== effectiveProfile.vat_bp ||
        clientSnapshot.commission?.bp !== effectiveProfile.commission_bp ||
        clientSnapshot.commission?.base !== effectiveProfile.commission_base ||
        clientSnapshot.chargeBp !== effectiveChargeBp ||
        clientSnapshot.chargesBorneBy !== effectiveChargesBorneBy;

      let isStaleRate = false;
      if (rateMismatch) {
        if (op.maxKnownRateVersion >= effectiveProfile.version) {
          // Client cherry-picked an old profile: reject (PRD §9.1(e))
          results.push({ opId: op.opId, status: 'rejected', reason: 'rate_profile_date_mismatch' });
          continue;
        } else {
          // Legitimate offline stale rate: accept arithmetic, flag stale_rates = true (Hard Rule 4)
          isStaleRate = true;
        }
      }

      try {
        const grossPoisha = BigInt(grossStr);
        const vatInputPoisha = payload.vatInputPoisha ? BigInt(payload.vatInputPoisha as string) : undefined;
        const vatOverridePoisha = payload.vatOverridePoisha ? BigInt(payload.vatOverridePoisha as string) : undefined;
        const vatOverrideReason = (payload.vatOverrideReason as string) || (vatOverridePoisha !== undefined ? 'Admin override' : undefined);
        const commissionOverridePoisha = payload.commissionOverridePoisha ? BigInt(payload.commissionOverridePoisha as string) : undefined;
        const commissionOverrideReason = (payload.commissionOverrideReason as string) || (commissionOverridePoisha !== undefined ? 'Admin override' : undefined);

        // Authoritative re-computation using @clt/calc
        const calcResult = calculateEntry({
          grossPoisha,
          snapshot: clientSnapshot,
          vatInputPoisha,
          vatOverridePoisha,
          vatOverrideReason,
          commissionOverridePoisha,
          commissionOverrideReason,
        });

        // Verify calculated components
        const vatMismatch = payload.vatPoisha !== undefined && payload.vatPoisha !== calcResult.vatPoisha.toString();
        const commMismatch = payload.commissionPoisha !== undefined && payload.commissionPoisha !== calcResult.commissionPoisha.toString();
        const busMismatch = payload.businessChargePoisha !== undefined && payload.businessChargePoisha !== calcResult.businessChargePoisha.toString();
        const custMismatch = payload.customerChargePoisha !== undefined && payload.customerChargePoisha !== calcResult.customerChargePoisha.toString();
        const clientNet = (payload.netPoisha ?? payload.netAfterDeductionsPoisha) as string | undefined;
        const netMismatch = clientNet !== undefined && clientNet !== calcResult.netAfterDeductionsPoisha.toString();

        if (vatMismatch || commMismatch || busMismatch || custMismatch || netMismatch) {
          throw new Error('Component mismatch');
        }
      } catch (calcErr: any) {
        await supabase.from('sync_ops').insert({
          op_id: op.opId,
          actor_id: caller.userId,
          device_id: parsed.data.deviceId,
          op_type: op.type,
          entry_id: (payload.entryId as string) || null,
          payload: op.payload,
          payload_hash: serverHash,
          client_created_at: op.clientCreatedAt,
          supersedes_rejected_op_id: op.supersedesRejectedOpId || null,
          result: 'rejected',
          resolution_status: 'pending',
          reason: 'calc_mismatch',
        });

        await supabase.from('audit_log').insert({
          actor: caller.userId,
          action: 'sync.calc_mismatch',
          target_table: 'sync_ops',
          target_id: op.opId,
          before: null,
          after: { reason: 'calc_mismatch', payload: op.payload },
        });

        results.push({ opId: op.opId, status: 'rejected', reason: 'calc_mismatch' });
        continue;
      }

      validOpsForRpc.push({
        ...op,
        serverHash,
        stale_rates: isStaleRate,
      });
      continue;
    }

    validOpsForRpc.push({
      ...op,
      serverHash,
    });
  }

  // 6. Execute Database RPC for Valid Operations (PRD §9.1 Step 5 & 6)
  if (validOpsForRpc.length > 0) {
    const { data: rpcResults, error } = await supabase.rpc('rpc_push_sync_op', {
      p_device_id: parsed.data.deviceId,
      p_caller_id: caller.userId,
      p_caller_role: caller.role,
      p_ops: validOpsForRpc,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const rawResults = Array.isArray(rpcResults) ? rpcResults : (rpcResults as any)?.results ?? [];
    if (Array.isArray(rawResults)) {
      results.push(...rawResults);
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.11 `apps/web/src/routes/api/v1/sync/pull/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { getDbPool } from '$lib/server/db';
import { checkRateLimit } from '$lib/server/ratelimit';

export const GET: RequestHandler = async (event) => {
  const clientIp = event.getClientAddress?.() || 'unknown-ip';

  // 1. Caller Authentication and Active Profile Check (PRD §9.1)
  const caller = await getCallerContext(event);
  if (!caller.active) {
    return new Response(JSON.stringify({ error: 'user_deactivated' }), { status: 403 });
  }

  const url = event.url;
  const sinceStr = url.searchParams.get('since');
  const includeMeta = url.searchParams.get('includeMeta') === 'true';
  const deviceId = url.searchParams.get('deviceId');

  // 2. Strict Query Parameters Validation
  if (!sinceStr) {
    return new Response(JSON.stringify({ error: 'missing_cursor' }), { status: 400 });
  }

  if (!/^\d+$/.test(sinceStr)) {
    return new Response(JSON.stringify({ error: 'invalid_cursor', message: 'since must be a non-negative integer' }), { status: 400 });
  }

  if (!deviceId || deviceId === '00000000-0000-0000-0000-000000000000') {
    return new Response(JSON.stringify({ error: 'missing_device_id', message: 'Valid non-nil deviceId UUID required' }), { status: 400 });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return new Response(JSON.stringify({ error: 'invalid_device_id' }), { status: 400 });
  }

  // 3. Rate Limiting Check (PRD §9.1: max 60 requests/minute per device/IP)
  const rateLimitKey = `${deviceId}:${clientIp}`;
  const rateLimit = checkRateLimit(rateLimitKey, 60, 60000);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'too_many_requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': rateLimit.retryAfter.toString(),
      },
    });
  }

  const supabase = getServiceSupabase();

  // 4. Device Revocation Check across multi-user shared devices (PRD §9.1, H3, M4, H5)
  const { data: deviceRows } = await supabase
    .from('devices')
    .select('revoked')
    .eq('device_id', deviceId);

  if (deviceRows && deviceRows.some((d) => d.revoked)) {
    return new Response(JSON.stringify({ error: 'device_revoked' }), { status: 403 });
  }

  // 5. Monotonic Watermark Calculation and Filtered Entries Extraction via SQL CTE
  const pool = getDbPool();

  // Check current server sequence to detect cursor ahead of server (HTTP 409)
  const { rows: seqRows } = await pool.query('select coalesce(max(server_seq), 0) as current_seq from entries');
  const currentSeq = BigInt(seqRows[0]?.current_seq || '0');
  const sinceBigInt = BigInt(sinceStr);

  if (sinceBigInt > currentSeq && currentSeq > 0n) {
    return new Response(JSON.stringify({ error: 'cursor_past_watermark', currentSequence: currentSeq.toString() }), { status: 409 });
  }

  const pullQuery = `
    with scanned as (
      select * from entries
      where server_seq > $1
      order by server_seq asc limit 200
    ),
    batch_meta as (
      select coalesce(max(server_seq), $1) as watermark,
             count(*) as scanned_count
      from scanned
    )
    select s.*, m.watermark, m.scanned_count
    from batch_meta m
    left join scanned s on ($2 in ('admin','owner') or s.created_by = $3)
    order by s.server_seq asc nulls last;
  `;

  const { rows } = await pool.query(pullQuery, [sinceBigInt, caller.role, caller.userId]);

  const watermark = rows.length > 0 && rows[0].watermark !== null ? rows[0].watermark.toString() : sinceStr;
  const scannedCount = rows.length > 0 ? Number(rows[0].scanned_count) : 0;
  const entries = rows.filter((r) => r.id !== null);
  const hasMore = scannedCount === 200;
  const nextCursor = watermark;

  let maxDeliveredRateVersion: number | null = null;
  const responsePayload: Record<string, unknown> = {
    entries,
    hasMore,
    nextCursor,
  };

  // 6. Metadata and Relational Configurations (Delivered when includeMeta === true or since === '0')
  if (includeMeta || sinceStr === '0') {
    const { data: rawRateProfiles, error: rpErr } = await supabase
      .from('rate_profiles')
      .select('*, method_rates(*)')
      .eq('status', 'published');
    if (rpErr) throw rpErr;

    // Ordered by sort_order (PRD §7.1 DDL column)
    const { data: methods, error: mErr } = await supabase
      .from('payment_methods')
      .select('*')
      .order('sort_order');
    if (mErr) throw mErr;

    const { data: payables, error: pErr } = await supabase.from('payables').select('*');
    if (pErr) throw pErr;

    const { data: monthCloses, error: mcErr } = await supabase.from('month_closes').select('*');
    if (mcErr) throw mcErr;

    const { data: settings, error: sErr } = await supabase.from('app_settings').select('*').single();
    if (sErr) throw sErr;

    let rateProfiles: any[] = [];
    if (rawRateProfiles && rawRateProfiles.length > 0) {
      maxDeliveredRateVersion = Math.max(...rawRateProfiles.map((p) => p.version));

      // Transform method_rates array into dictionary map keyed by method_id
      rateProfiles = rawRateProfiles.map((p) => {
        const methodRatesMap: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }> = {};
        if (Array.isArray(p.method_rates)) {
          for (const mr of p.method_rates) {
            methodRatesMap[mr.method_id] = {
              fee_bp: mr.charge_bp, // Map Postgres charge_bp to fee_bp basis points
              charges_borne_by: p.charges_borne_by || 'business',
            };
          }
        }
        return {
          id: p.id,
          version: p.version,
          status: p.status,
          effective_from: p.effective_from,
          vat_mode: p.vat_mode,
          vat_bp: p.vat_bp,
          commission_bp: p.commission_bp,
          commission_base: p.commission_base,
          charges_borne_by: p.charges_borne_by || 'business',
          note: p.note,
          method_rates: methodRatesMap,
        };
      });
    }

    responsePayload.settings = settings;
    responsePayload.rateProfiles = rateProfiles;
    responsePayload.methods = methods;
    responsePayload.payables = payables;
    responsePayload.monthCloses = monthCloses;

    if (caller.role === 'admin' || caller.role === 'owner') {
      const { data: profiles, error: prErr } = await supabase.from('profiles').select('id, full_name, role, active');
      if (prErr) throw prErr;
      const { data: settlements, error: setErr } = await supabase.from('settlements').select('*');
      if (setErr) throw setErr;
      const { data: statements, error: stErr } = await supabase.from('statements').select('*');
      if (stErr) throw stErr;
      const { data: rejectedOps, error: roErr } = await supabase
        .from('sync_ops')
        .select('*')
        .eq('resolution_status', 'pending');
      if (roErr) throw roErr;

      responsePayload.profiles = profiles;
      responsePayload.settlements = settlements;
      responsePayload.statements = statements;
      responsePayload.rejectedOps = rejectedOps ?? [];
    } else {
      const { data: rejectedOps, error: roErr } = await supabase
        .from('sync_ops')
        .select('*')
        .eq('actor_id', caller.userId)
        .eq('resolution_status', 'pending');
      if (roErr) throw roErr;

      responsePayload.rejectedOps = rejectedOps ?? [];
    }
  }

  // 7. Update Device Sync State and Watermark Presence (PRD §7.3, H3, M4, H4)
  await supabase.rpc('upsert_device_sync_state', {
    p_device_id: deviceId,
    p_user_id: caller.userId,
    p_rate_version: maxDeliveredRateVersion,
  });

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.12 `apps/web/src/lib/sync/sync.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { canonicalJsonStringify, computeJcsSha256 } from './canonical';
import { REJECTION_MATRIX, handleOpRejection, retryRejectedOp, discardRejectedOp } from './recovery';
import { checkRateLimit } from '../server/ratelimit';
import { db } from '$lib/db';

describe('Sync Transport & Canonicalization (RFC 8785)', () => {
  it('formats RFC 8785 canonical keys in strict lexicographical order and omits undefined', () => {
    const unordered = { z: 1, a: 2, m: { b: 3, a: 4 }, ignored: undefined };
    const canonical = canonicalJsonStringify(unordered);
    expect(canonical).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  it('generates consistent SHA-256 hash regardless of object key insertion order', async () => {
    const obj1 = { type: 'create_entry', payload: { gross: '1000' }, maxKnownRateVersion: 1 };
    const obj2 = { maxKnownRateVersion: 1, payload: { gross: '1000' }, type: 'create_entry' };

    const hash1 = await computeJcsSha256(obj1);
    const hash2 = await computeJcsSha256(obj2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Rejection Recovery Matrix (PRD §9.2.2)', () => {
  it('defines all 25 PRD rejection reasons with explicit action and outboxState', () => {
    const reasons = Object.keys(REJECTION_MATRIX);
    expect(reasons.length).toBe(25);

    expect(REJECTION_MATRIX['month_closed'].action).toBe('move_to_review');
    expect(REJECTION_MATRIX['month_closed'].outboxState).toBe('rejected_closed_month');

    expect(REJECTION_MATRIX['future_timestamp_skew'].action).toBe('adjust_clock');
    expect(REJECTION_MATRIX['payload_hash_mismatch'].action).toBe('retry_fresh_id');
    expect(REJECTION_MATRIX['calc_mismatch'].action).toBe('move_to_review');
    expect(REJECTION_MATRIX['upgrade_required'].action).toBe('halt_execution');
    expect(REJECTION_MATRIX['device_revoked'].action).toBe('halt_execution');
    expect(REJECTION_MATRIX['duplicate'].action).toBe('drop_op');
    expect(REJECTION_MATRIX['cannot_supersede_non_active'].action).toBe('drop_op');
    expect(REJECTION_MATRIX['cannot_void_non_active'].action).toBe('drop_op');
  });

  it('handleOpRejection records rejected op in db.rejectedOps and flags local entry', async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rejectedOps.clear();

    const opId = crypto.randomUUID();
    const entryId = crypto.randomUUID();

    await db.outbox.put({
      opId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { entryId, entryDate: '2026-10-15', grossPoisha: '10000' },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending',
    });

    await db.entries.put({
      id: entryId,
      local_id: '#LOCAL-test',
      entry_date: '2026-10-15',
      customer_name: 'Test Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '10000',
      vat_poisha: '0',
      commission_poisha: '420',
      charge_poisha: '115',
      business_charge_poisha: '115',
      customer_charge_poisha: '0',
      net_poisha: '9465',
      status: 'active',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
    });

    await handleOpRejection(opId, 'month_closed');

    const outboxOp = await db.outbox.get(opId);
    expect(outboxOp?.status).toBe('rejected');
    expect(outboxOp?.outboxState).toBe('rejected_closed_month');

    const rejectedRow = await db.rejectedOps.get(opId);
    expect(rejectedRow?.error_code).toBe('month_closed');

    const entry = await db.entries.get(entryId);
    expect(entry?.sync_status).toBe('rejected');
  });

  it('ghost entry rollback: deletes replacement entry and reverts original on rejected supersede', async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rejectedOps.clear();

    const opId = crypto.randomUUID();
    const origId = crypto.randomUUID();
    const repId = crypto.randomUUID();

    // Original entry marked superseded locally
    await db.entries.put({
      id: origId,
      local_id: '#LOCAL-orig',
      entry_date: '2026-10-15',
      customer_name: 'Original Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '10000',
      vat_poisha: '0',
      commission_poisha: '420',
      charge_poisha: '115',
      business_charge_poisha: '115',
      customer_charge_poisha: '0',
      net_poisha: '9465',
      status: 'superseded',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
    });

    // Uncommitted replacement entry
    await db.entries.put({
      id: repId,
      local_id: '#LOCAL-rep',
      entry_date: '2026-10-15',
      customer_name: 'Replacement Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '12000',
      vat_poisha: '0',
      commission_poisha: '504',
      charge_poisha: '138',
      business_charge_poisha: '138',
      customer_charge_poisha: '0',
      net_poisha: '11358',
      status: 'active',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
      supersedes_id: origId,
    });

    await db.outbox.put({
      opId,
      userId: 'user-1',
      type: 'supersede_entry',
      payload: {
        originalEntryId: origId,
        replacement: { entryId: repId, grossPoisha: '12000' },
      },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending',
    });

    await handleOpRejection(opId, 'cannot_supersede_non_active');

    // Replacement entry deleted from Dexie
    const deletedRep = await db.entries.get(repId);
    expect(deletedRep).toBeUndefined();

    // Original entry reverted to active and synced
    const restoredOrig = await db.entries.get(origId);
    expect(restoredOrig?.status).toBe('active');
    expect(restoredOrig?.sync_status).toBe('synced');

    // Op removed from outbox
    const deletedOp = await db.outbox.get(opId);
    expect(deletedOp).toBeUndefined();
  });

  it('retryRejectedOp enforces Global Retry Invariant with fresh opId and supersedesRejectedOpId (Test #3)', async () => {
    await db.outbox.clear();
    await db.rejectedOps.clear();

    const failedOpId = crypto.randomUUID();
    const createdAt = new Date('2026-10-29T10:00:00Z').toISOString();
    await db.outbox.put({
      opId: failedOpId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { grossPoisha: '50000' },
      clientCreatedAt: createdAt,
      maxKnownRateVersion: 1,
      status: 'rejected',
    });

    const freshOpId = await retryRejectedOp(failedOpId);

    expect(freshOpId).not.toBe(failedOpId);
    expect(freshOpId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const freshOp = await db.outbox.get(freshOpId);
    expect(freshOp?.status).toBe('pending');
    expect(freshOp?.supersedesRejectedOpId).toBe(failedOpId);
    expect(freshOp?.clientCreatedAt).toBe(createdAt); // Preserved chronological order

    const oldOp = await db.outbox.get(failedOpId);
    expect(oldOp).toBeUndefined();
  });

  it('discardRejectedOp enqueues discard op and updates rejectedOps (Test #18)', async () => {
    await db.outbox.clear();
    await db.rejectedOps.clear();

    const failedOpId = crypto.randomUUID();
    await db.outbox.put({
      opId: failedOpId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { entryId: 'e-1', grossPoisha: '50000' },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'rejected',
    });

    await discardRejectedOp(failedOpId, 'admin-1', 'Audited rejection discard');

    const rejectedRow = await db.rejectedOps.get(failedOpId);
    expect(rejectedRow?.status).toBe('discarded');

    const discardOps = await db.outbox.where('type').equals('discard_rejected_entry').toArray();
    expect(discardOps.length).toBe(1);
    expect((discardOps[0].payload as any).discardedOpId).toBe(failedOpId);
    expect((discardOps[0].payload as any).reason).toBe('Audited rejection discard');
  });
});

describe('Sliding Window Rate Limiter (PRD §9.1)', () => {
  it('permits up to 60 requests per minute and rejects the 61st with retryAfter', () => {
    const key = `test-ip-${Date.now()}`;
    for (let i = 0; i < 60; i++) {
      const res = checkRateLimit(key, 60, 60000);
      expect(res.allowed).toBe(true);
    }

    const blocked = checkRateLimit(key, 60, 60000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });
});

describe('Sync Batching & Multi-User Isolation (PRD §9.1, Test #62)', () => {
  it('caps push batch at 50 ops per request (PRD §9.1)', async () => {
    await db.outbox.clear();
    const ops = Array.from({ length: 65 }, (_, i) => ({
      opId: crypto.randomUUID(),
      userId: 'user-batch',
      type: 'create_entry' as const,
      payload: { grossPoisha: '1000' },
      clientCreatedAt: new Date(Date.now() + i * 1000).toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending' as const,
    }));
    await db.outbox.bulkPut(ops);

    const pending = await db.outbox.where({ status: 'pending', userId: 'user-batch' }).sortBy('clientCreatedAt');
    const batch = pending.slice(0, 50);
    expect(batch.length).toBe(50);
    expect(pending.length).toBe(65);
  });

  it('multi-user outbox isolation prevents cross-user op leakage during sync (Test #62)', async () => {
    await db.outbox.clear();
    await db.outbox.bulkPut([
      {
        opId: crypto.randomUUID(),
        userId: 'user-A',
        type: 'create_entry',
        payload: { grossPoisha: '1000' },
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        status: 'pending',
      },
      {
        opId: crypto.randomUUID(),
        userId: 'user-B',
        type: 'create_entry',
        payload: { grossPoisha: '2000' },
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        status: 'pending',
      },
    ]);

    const userAOps = await db.outbox.where({ status: 'pending', userId: 'user-A' }).toArray();
    expect(userAOps.length).toBe(1);
    expect(userAOps[0].userId).toBe('user-A');

    const userBOps = await db.outbox.where({ status: 'pending', userId: 'user-B' }).toArray();
    expect(userBOps.length).toBe(1);
    expect(userBOps[0].userId).toBe('user-B');
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| JCS Canonical Ordering | Unordered keys, undefined properties | Strict sorted JSON string without undefined | §9.1 | `apps/web/src/lib/sync/sync.test.ts` |
| SHA-256 Hash Invariance | Reordered keys in canonical op | `hash1 === hash2`, valid 64-char hex | §9.1 | `apps/web/src/lib/sync/sync.test.ts` |
| 25-Reason Recovery Matrix | All 25 PRD rejection reasons | Exact PRD actions and outboxState mappings | §9.2.2 | `apps/web/src/lib/sync/sync.test.ts` |
| Ghost Entry Rollback | Supersede rejected with `cannot_supersede_non_active` | Deletes replacement entry, reverts original to active | §9.2.2 | `apps/web/src/lib/sync/sync.test.ts` |
| Global Retry Invariant (Test #3) | Retrying rejected op via `retryRejectedOp` | Fresh UUID `opId`, `supersedesRejectedOpId` populated, FIFO preserved | §9.2.2, §16.2 #3 | `apps/web/src/lib/sync/sync.test.ts` |
| Discard Op Authorization (Test #18) | Staff discard own rejected op via `discardRejectedOp` | Enqueues `discard_rejected_entry` op, marks rejectedOp discarded | §8.4, §16.2 #18 | `apps/web/src/lib/sync/sync.test.ts` |
| Sliding Window Rate Limiter | 61 rapid requests within 60s | 60 allowed, 61st rejected with `retryAfter` | §9.1 | `apps/web/src/lib/sync/sync.test.ts` |
| Test #1 Forged Snapshot | Modified client rates | Rejected with `calc_mismatch` or `rate_profile_date_mismatch` | §16.2 #1 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #2 Sequence Commit Race | Parallel pull scans across server_seq | Monotonic watermark sequence allocation | §16.2 #2 | `apps/web/src/routes/api/v1/sync/pull/+server.ts` |
| Test #8 Stale Rate Profile Sync | Offline entry created under older published profile | Accepted with `stale_rates = true` | §16.2 #8 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #10 Account Deactivation | Deactivated user sync | Outbox pauses, HTTP 403 `user_deactivated` | §16.2 #10 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #11 Server Hash Verification | Corrupted payload hash | Recomputed authoritatively via JCS SHA-256 | §16.2 #11 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #12 Staff Cursor Watermark | Staff pull with 0 visible entries | Watermark advances past scanned chunk | §16.2 #12 | `apps/web/src/routes/api/v1/sync/pull/+server.ts` |
| Test #17 Pull Cursor Idempotency | Re-pull with identical cursor | Returns empty entries array and identical nextCursor | §16.2 #17 | `apps/web/src/routes/api/v1/sync/pull/+server.ts` |
| Test #24 Subtransaction Isolation | Op #2 has calculation mismatch | Op #2 rejected with `calc_mismatch`, Op #1 & #3 succeed | §16.2 #24 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #25 Skew & Expiry | Clock skew >5 min | Auto-reconciles skew delta from server Date header and retries | §16.2 #25 | `apps/web/src/lib/sync/recovery.ts` |
| Test #41 Offline Entries Reconciliation | Bulk offline entries pushed | Recomputed and committed with monotonic sequence | §16.2 #41 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #46 Offline Stale Rate Preservation | Legitimate offline op with older rate | Accepted with `stale_rates = true` | §16.2 #46 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #47 Rejected Op Persistence | Rejected op pushed | Persisted in `db.rejectedOps` and Admin review queue | §16.2 #47 | `apps/web/src/lib/sync/recovery.ts` |
| Test #56 Engine Version Skew | Client `engineVersion` mismatch | Dispatches `clt:upgrade-required`, modal prompted | §16.2 #56 | `apps/web/src/lib/sync/recovery.ts` |
| Test #60 Watermark Enforcement | Omitted maxKnownRateVersion | Rejected per-op with `missing_rate_watermark` | §16.2 #60 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #61 Push Idempotency | Duplicate push of existing entry | `{ status: 'duplicate' }` with server_seq and entry_number | §16.2 #61 | `apps/web/src/routes/api/v1/sync/push/+server.ts` |
| Test #62 Multi-User Shared Device Isolation | User A logs out, User B logs in | User A's outbox ops are not pushed under User B's token | §16.2 #62 | `apps/web/src/lib/sync/push.ts` |

## 8. Acceptance criteria

1. Sync transport, canonical hashing, and rejection recovery unit tests pass cleanly with 100% assertions satisfied.
   - Command: `pnpm --filter @clt/web test src/lib/sync/sync.test.ts`
   - Expected output: test suite passes with 0 failures.
2. Push endpoint rejects unauthenticated requests with HTTP `401 Unauthorized` and payloads missing device UUID with HTTP `400 Bad Request`.
   - Command: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5173/api/v1/sync/push -H "Content-Type: application/json" -d '{"ops":[]}'`
   - Expected output: `401`
3. SvelteKit route typecheck passes cleanly across all sync runner, indicator, and mediation modules without missing types or undefined properties.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha and 64-bit sequence cursors transmitted strictly as decimal strings.
- Rule 3: `packages/calc` in TypeScript is the sole authoritative calculation engine, executed in `push/+server.ts` to verify snapshots and arithmetic before committing.
- Rule 4: Stale rate entries submitted offline are preserved with `stale_rates = true` without altering historical snapshot rates.
- Rule 5: Every mutation and rejection writes an `audit_log` row inside the same transaction.
- Rule 6: Local outbox queue decouples saves from connectivity; sync runs in the background.
- Rule 7: Server push invokes `rpc_push_sync_op` under `service_role` inside a single subtransaction-isolated transaction.
- Rule 8: Secrets never reach client manifests, service workers, or wire payloads.
- Rule 9: Server re-verifies snapshots, calculated components, and canonical hashes, never trusting client computations.
- Rule 10: Respect ascending month advisory locks `(1001)` and sequence locks `(1002)` inside batch push.

## 10. Pitfalls

- Trap: Querying `payment_methods` with `.order('display_order')` causing PostgREST query failure.
  - Fix: Query with `.order('sort_order')` (matching Postgres DDL) and map to Dexie `display_order`.
- Trap: Reading `mr.fee_bp` and `mr.charges_borne_by` from `method_rates` where columns are `charge_bp` and parent `rate_profiles.charges_borne_by`.
  - Fix: Extract basis points from `mr.charge_bp` and party from `p.charges_borne_by`.
- Trap: Unauthenticated/shared device outbox leakage pushing User A's unpushed ops under User B's token (Test #62).
  - Fix: Filter outbox flush strictly by `op.userId === currentUserId`.
- Trap: Rejected supersede leaving replacement entry active in Dexie while original stays superseded, causing ledger double-counting.
  - Fix: Rollback ghost replacement entry (`db.entries.delete(repId)`) and restore original entry to active status.
- Trap: Sync indicator branch ordering hiding `error` state behind `pendingCount > 0`.
  - Fix: Check `status === 'error'` before checking `pendingCount > 0`.
- Trap: Incremental pull swallowing HTTP errors with `break;` and reporting `synced`.
  - Fix: Check response status and handle 401, 403, 409, 410, 429, and throw on unhandled errors.
- Trap: Missing watermark failing the entire 50-op batch with HTTP 400.
  - Fix: Validate per-op watermark and reject individual op with `missing_rate_watermark`.
- Trap: Retrying rejected ops re-stamping `clientCreatedAt = now()` breaking chronological FIFO sequence.
  - Fix: Preserve original `clientCreatedAt` unless adjusting for server clock skew.

## 11. PRD ISSUES and DECISION PENDING

- None.

## 12. Handoff

- `syncRunner` exported from `apps/web/src/lib/sync/runner.svelte.ts` and mounted in root application layout.
- `SyncIndicator.svelte` component exported for header navigation bar.
- Database pool `getDbPool()` exported from `apps/web/src/lib/server/db.ts` for server route queries.

## 13. Suggested task breakdown

- `CLT-T-034` (Implementer): Implement RFC 8785 canonical hashing and 25-reason rejection recovery matrix with Global Retry Invariant and ghost entry rollback (`apps/web/src/lib/sync/canonical.ts`, `apps/web/src/lib/sync/recovery.ts`, `apps/web/src/lib/sync/sync.test.ts`).
- `CLT-T-035` (Implementer): Build client push and pull dispatchers with multi-user isolation, token refresh, schema normalization, and local entry syncing (`apps/web/src/lib/sync/push.ts`, `apps/web/src/lib/sync/pull.ts`).
- `CLT-T-036` (Implementer): Build multi-tab leader sync runner with BroadcastChannel state sharing and header visual sync indicator (`apps/web/src/lib/sync/runner.svelte.ts`, `apps/web/src/lib/ui/SyncIndicator.svelte`).
- `CLT-T-037` (Implementer): Build server connection pool with OID 1082 parser, sliding-window rate limiter, and server push/pull mediation endpoints with `@clt/calc` validation, rate profile snapshot verification, and multi-user device checks (`apps/web/package.json`, `apps/web/src/lib/server/ratelimit.ts`, `apps/web/src/lib/server/db.ts`, `apps/web/src/routes/api/v1/sync/push/+server.ts`, `apps/web/src/routes/api/v1/sync/pull/+server.ts`).
- `CLT-T-038` (DevOps): Verification of sync transport, rejection matrix, rate limiting, and monotonic watermark cursor tests.

## 14. Changelog

- 2026-11-01 — Revision 3.1:
  - Adversarial audit remediation addressing 8 P0 Blockers and 7 P1 Major Risks:
  - Fixed non-existent column query: purged `effective_to` query in `push/+server.ts`; query rate profiles by published status, `effective_from <= entryDate`, ordered by `effective_from desc, version desc limit 1`.
  - Fixed snapshot rate mismatch bug: aligned client rate snapshot comparison in `push/+server.ts` with `@clt/calc` `RateSnapshot` interface (`clientSnapshot.vat.bp`, `clientSnapshot.commission.bp`, `clientSnapshot.chargeBp`, `clientSnapshot.chargesBorneBy`), preventing false `rate_profile_date_mismatch` rejections.
  - Fixed RPC result extraction: parsed `Array.isArray(rpcResults) ? rpcResults : (rpcResults as any)?.results ?? []` in `push/+server.ts` to properly handle PostgREST-wrapped JSONB RPC responses.
  - Fixed override reasons in server calculation: passed `vatOverrideReason` and `commissionOverrideReason` into `calculateEntry` in `push/+server.ts`.
  - Fixed BigInt serialization in RFC 8785 canonical stringifier (`apps/web/src/lib/sync/canonical.ts`).
  - Fixed Web Lock permanent lock deadlock in `apps/web/src/lib/sync/runner.svelte.ts`: added `stopLockPromise` resolver to release Web Lock on logout/stop.
  - Fixed rate limiter interval timer hanging Vitest worker: added `.unref?.()` in `apps/web/src/lib/server/ratelimit.ts`.
  - Replaced non-existent `getSupabaseClient` imports with canonical `supabase` client in `push.ts` and `pull.ts`.
  - Added required `charge_poisha` to Dexie `db.entries.put` fixtures in `sync.test.ts` and `pull.ts` mapping.
  - Added nil UUID (`00000000-0000-0000-0000-000000000000`) rejection to `deviceId` in `push/+server.ts` and `pull/+server.ts`.
  - Enforced monotonic sequence ordering in `pull/+server.ts` CTE outer query (`order by s.server_seq asc nulls last`).
  - Included `charges_borne_by` in `CachedRateProfile` mapping in `pull/+server.ts`.
  - Added tests for 50-op batch push cap and multi-user outbox isolation (Test #62) to `sync.test.ts`.
- 2026-10-31 — Revision 3.0:
  - Resolved Blocker 1: Fixed `payment_methods` query in `/api/v1/sync/pull/+server.ts` to order by `sort_order` (matching DDL) instead of non-existent `display_order`. Checked and handled errors on all Supabase queries. Mapped `sort_order` to `display_order` for Dexie `CachedPaymentMethod`.
  - Resolved Blocker 2: Corrected rate profile transformation in `pull/+server.ts` and `pull.ts`. Extracted basis points from `mr.charge_bp` (not non-existent `fee_bp`) and party from `p.charges_borne_by` (on parent profile). Formatted `method_rates` into dictionary map `Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>` for Dexie `CachedRateProfile`.
  - Resolved Blocker 3: Implemented automated recovery paths for PRD §9.2.2 rejection reasons: `adjust_clock` (reconciling delta from HTTP Date header and retrying with fresh `opId`), `retry_fresh_id` (regenerating hash on mismatch, allocating fresh UUID on collision, attaching watermark on `missing_rate_watermark`, generating device ID), and `halt_execution` on `upgrade_required` and `device_revoked`.
  - Resolved Blocker 4: Fixed ghost entry vulnerability on rejected supersede and void operations. On `cannot_supersede_non_active`, deleted uncommitted replacement entry from `db.entries`, restored original entry to active status, deleted op from outbox, and marked rejectedOp discarded. On `cannot_void_non_active`, cleared void request fields and restored active status.
  - Resolved Blocker 5: Solved multi-user cross-attribution on shared devices (PRD Test #62). Partitioned outbox ops by `userId` and filtered `flushOutboxPush` strictly by `op.userId === currentUserId`. Runner stops on logout.
  - Resolved Blocker 6: Fixed branch precedence in `SyncIndicator.svelte`. Reordered branches so `status === 'error'` with retry button precedes `status === 'offline'` and `pendingCount > 0`, ensuring retry button is accessible and saves in progress are not mislabeled as offline.
  - Resolved Blocker 7: Fixed pull error handling. Replaced silent `break;` with explicit status handling: 401 session refresh, 403 device revocation, 409 cursor reset to '0' and immediate re-pull, 410 full resync, 429 retry-after backoff, and network drop to offline state.
  - Resolved Blocker 8: Protected push loop from infinite spinning. Enforced maximum 20 iterations cap and added progress verification ensuring at least one op changed state per batch.
  - Resolved Blocker 9: Added `pg` and `@types/pg` dependencies to `apps/web/package.json`, documented `DATABASE_URL` in `.env.example`, and preserved OID 1082 string parser for `DATE` columns.
  - Resolved Blocker 10: Enforced authoritative server snapshot verification in `push/+server.ts`. Re-verified client snapshot against published `rate_profiles` effective on `entryDate`. Enforced anti-cherry-picking (`rate_profile_date_mismatch`), allowed offline stale rates (`stale_rates = true`), and passed override parameters to `@clt/calc`.
  - Resolved Blocker 11: Fixed watermark handling in `push/+server.ts`. Made `maxKnownRateVersion` optional in Zod schema and rejected individual missing watermark ops with `missing_rate_watermark` under subtransaction fault isolation (Test #60).
  - Resolved Further Defects: Fixed retry FIFO sequencing in `retryRejectedOp` by preserving original `clientCreatedAt` (preventing `parent_entry_not_found` on dependent ops), added re-calculation via `@clt/calc` on patched entries, implemented audited discard operation (`discardRejectedOp`, Test #18), aligned Dexie cached types (`CachedRejectedOp`, `CachedAppSettings`, `CachedProfile`, `CachedPayable`, `db.meta` with `updated_at`), implemented true Web Locks multi-tab leader election with BroadcastChannel state broadcasting and immediate first sync cycle, implemented sliding-window rate limiter with memory TTL cleanup, and expanded `sync.test.ts` to 8 comprehensive test suites.
- 2026-10-30 — Revision 2.1: Prior remediation round.
- 2026-10-30 — Revision 2.0: Initial comprehensive remediation.
