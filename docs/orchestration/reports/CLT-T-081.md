# Task Report: CLT-T-081 — Sync Client IP Blocker, Live Super-Admin Switching & Multi-Center E2E

- **Task ID:** CLT-T-081 (`CLT-F-035` / Multi-Center Hardening)
- **Implementer:** External builder (initial pass) → `A-IMP-2` (remediation)
- **Auditor:** `A-AUD-1` (Independent Zero-Trust Audit)
- **Verdict:** `PASS` (0 Blockers, 0 Majors; 2 non-blocking Minors retained)

## Scope & Implemented Behavior
1. **Shared Client IP Extraction (`apps/web/src/lib/server/ratelimit.ts`, `sync/pull/+server.ts`, `sync/push/+server.ts`):** Extracted `getSafeClientIp(event)` wrapping `event.getClientAddress?.()` in `try/catch` (`'unknown-ip'` fallback), eliminating unhandled HTTP 500s on `/api/v1/sync/pull` and `/api/v1/sync/push`.
2. **Live `super_admin` Center Switching & Push Tenant Edge (`runner.svelte.ts`, `+layout.svelte`, `pull.ts`, `push.ts`):** Added serialized `syncRunner.syncNow(beforeSync)` + `invalidateInFlightPull()` + `resetSuperCenterCache()` so `handleCenterSwitch` clears cached center-scoped stores (`entries`, `methods`, `rateProfiles`, `payables`, `monthCloses`, `profiles`, `settlements`, `statements`) cleanly after any in-flight pull finishes and triggers an immediate pull without `page.reload()`. Updated `push.ts` to pass resolved center context for `super_admin` ops and move orphaned `400 missing_tenant_context` ops to `rejectedOps` rather than deadlocking pull/prune.
3. **Deterministic Fixtures & E2E Coverage (`scripts/e2e/create-staff.ts`, `isolated-stack.ts`, `multi_center.spec.ts`):** Ordered center lookup by `.order('center_number', { ascending: true }).order('id', { ascending: true })` (breaking same-transaction `created_at` ties), added Rampura fixture account (`E2E_RMP_STAFF_EMAIL`), removed `page.reload()` workarounds from live switcher narrowing assertions, and verified disjoint MHK vs RMP method IDs across separate `KumonLedger_<centerId>` databases.

## Audit Findings
- **Resolved:** Initial `FAIL` items (`getClientAddress?.()` 500 Blocker, stale `CosmoLedgerTrackDB` / `page.reload()` switcher bug, centerless `super_admin` push deadlock, arbitrary `created_at` fixture sort).
- **Non-blocking Minors:**
  1. In `push.ts:124-127`, if `outbox` contains mixed ops (`centerA` followed by a `null`-center op) under `super_admin`, the `null`-center op can be co-batched into `centerA`'s `batchCenterId`; unit tests for `400 missing_tenant_context` and concurrent `syncNow` should also be added to `push.test.ts` / `runner.test.ts`.
  2. `handleCenterSwitch` (`+layout.svelte:64-73`) awaits `syncRunner.syncNow(...)` without a local `try/catch` guard around DOM event handling.

## Independent Verification (Post-Final Edit)
- `pnpm --filter @clt/web test`: **20/20 files, 242/242 tests** (`push.test.ts` 3/3, `runner.test.ts` 7/7, `sync.test.ts` 10/10, `dexie.test.ts` 5/5).
- `pnpm test:e2e:isolated --gate5` (`exit 0`): all 6 `multi_center.spec.ts` specs passed inside the 20 non-a11y browser E2E run (`1.7m`), dev DB (`54322`) unchanged (`5 → 5`, verified via read-only `psql`: `entries_count = 5, centers_count = 2`).
- `pnpm typecheck` (`exit 0`), `pnpm lint` (`0` errors), `pnpm exec prettier --check .` (`exit 0`).

