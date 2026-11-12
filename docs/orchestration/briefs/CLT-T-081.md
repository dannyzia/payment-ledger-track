# Task Brief: CLT-T-081 — Sync Client IP Blocker, Live Super-Admin Center Switching & Multi-Center E2E (`CLT-T-074/075/076`)

| Field | Value |
|---|---|
| Task ID | CLT-T-081 |
| Feature | CLT-F-035 / Multi-Center Hardening |
| Assigned Agent | A-IMP-2 (Implementer) |
| Audit Status | Initial external builder patch `FAIL` (remediation required) |
| Rules | Hard Rules 5, 8, 9, 11, 18 |

## Context
An initial external builder implementation added `apps/web/tests/e2e/multi_center.spec.ts` and extended `scripts/e2e/create-staff.ts` / `scripts/e2e/isolated-stack.ts` for RMP staff fixtures. Independent Zero-Trust audit (`A-AUD-1`) returned `FAIL` on one cross-cutting server Blocker (`getClientAddress` throwing unhandled HTTP 500s) and one Major bug where `super_admin` center switching leaves cross-center cached rows in `CosmoLedgerTrackDB` and forces tests to use `page.reload()`.

## Scope Files
- `apps/web/src/lib/server/ratelimit.ts` (shared helper for safe IP extraction)
- `apps/web/src/routes/api/v1/sync/pull/+server.ts`
- `apps/web/src/routes/api/v1/sync/push/+server.ts`
- `apps/web/src/routes/(app)/+layout.svelte`
- `apps/web/src/lib/sync/pull.ts` (if cache-reset helper lives in sync/db layer)
- `apps/web/src/lib/sync/push.ts` (centerless `super_admin` push `centerId` / `400 missing_tenant_context` handling)
- `apps/web/src/lib/sync/runner.svelte.ts` (`syncNow()` / serialized in-flight cycle coordination for live center switch)
- `apps/web/tests/e2e/multi_center.spec.ts`
- `scripts/e2e/create-staff.ts`

## Required Changes
1. **Fix `getClientAddress` unhandled HTTP 500 Blocker:**
   - Extract one shared helper (e.g., `getSafeClientIp(event: RequestEvent): string` in `apps/web/src/lib/server/ratelimit.ts`) using `try { return event.getClientAddress?.() || 'unknown-ip'; } catch { return 'unknown-ip'; }`.
   - Use it in both `apps/web/src/routes/api/v1/sync/pull/+server.ts:8` and `apps/web/src/routes/api/v1/sync/push/+server.ts:37`.
2. **Fix live `super_admin` center switching, cross-center cache contamination & push-edge deadlock:**
   - Update `handleCenterSwitch` in `apps/web/src/routes/(app)/+layout.svelte` (calling a clean exported helper rather than duplicating Dexie calls in Svelte) so switching `clt_super_center`:
     a) clears center-scoped cached stores in `CosmoLedgerTrackDB` (`entries`, `methods`, `rateProfiles`, `payables`, `monthCloses`, `profiles`, `settlements`, `statements`) and resets `server_cursor` to `'0'` (preserving any unsynced `outbox`/`rejectedOps` if present), and
     b) immediately triggers `syncRunner.syncNow()` without races so active pages update without requiring `page.reload()`.
   - Also fix `apps/web/src/lib/sync/push.ts` for centerless `super_admin` accounts: resolve push `centerId` from `session.user.centerId ?? batchOpCenterId ?? activeSuperCenter` when valid, and handle HTTP `400` `missing_tenant_context` by routing orphaned null-center ops through `handleOpRejection(op.opId, 'missing_tenant_context')` (mirroring `device_revoked`/`user_deactivated`) instead of returning `{ success: false }` forever and starving `executeIncrementalPull()`.
   - Also inspect `executeIncrementalPull` (`pull.ts`) to confirm changing back from `'MHK'` to `'all'` repulls all centers cleanly without stale entries/payables/settlements surviving across switches.
3. **Update `multi_center.spec.ts` & `create-staff.ts`:**
   - Remove the `await page.reload({ waitUntil: 'load' })` workarounds in `apps/web/tests/e2e/multi_center.spec.ts` (`CLT-T-074 center context narrows the pull`, lines 391 & 411) so the test proves **live** center switching triggers the scoped pull and updates the cache without a reload.
   - Strengthen `CLT-T-075 per-center IndexedDB isolation` to verify not just `count > 0`, but that `mhkDatabase` contains Mohakhali's method IDs and zero Rampura method IDs (and vice versa).
   - Fix `scripts/e2e/create-staff.ts:46` center tie-break: `.order('center_number', { ascending: true }).order('id', { ascending: true }).limit(1)` instead of `.order('created_at')` (since `bootstrap.ts` inserts MHK and RMP in a single transaction with identical `now()` timestamps), and change `console.log` to `console.info`.

## Acceptance Criteria
- `pull/+server.ts` and `push/+server.ts` never throw HTTP 500 when `getClientAddress()` throws.
- `multi_center.spec.ts` passes cleanly on the isolated stack without `page.reload()` workarounds.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, and unit tests pass cleanly.

