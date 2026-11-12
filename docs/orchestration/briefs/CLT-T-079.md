# Task Brief: CLT-T-079 — Offline Stale Config Pruning & Supersede/Watermark Hardening (`CLT-R-026`)

| Field | Value |
|---|---|
| Task ID | CLT-T-079 |
| Feature | CLT-F-031 / CLT-R-026 |
| Assigned Agent | A-IMP-2 (Implementer) |
| Audit Status | Initial external builder patch `FAIL` (remediation required) |
| Rules | Hard Rules 1, 2, 3, 4, 6, 9, 11 |

## Context
An initial external builder implementation added `apps/web/src/lib/db/prune.ts`, `apps/web/src/lib/db/prune.test.ts`, changes to `apps/web/src/lib/sync/pull.ts`, and `selectableMethods` in `apps/web/src/routes/(app)/entries/new/+page.svelte`. Independent Zero-Trust audit (`A-AUD-1`) returned `FAIL` due to four Major findings and unit test coverage gaps.

## Scope Files
- `apps/web/src/routes/(app)/entries/new/+page.svelte`
- `apps/web/src/routes/api/v1/sync/pull/+server.ts` (cursor watermark line + metadata inspection)
- `apps/web/src/lib/db/prune.ts`
- `apps/web/src/lib/sync/pull.ts`
- `apps/web/src/lib/sync/recovery.ts` (line 390 `methodId` vs `rateProfileId` comparison bug)
- `apps/web/src/lib/db/prune.test.ts`

## Required Changes
1. **`?supersede=<id>` handling (`apps/web/src/routes/(app)/entries/new/+page.svelte`):**
   - When loading an entry in `?supersede=<id>` mode whose original `orig.method_id` is inactive (`active === false`) or absent from `activeProfile.method_rates`, do **not** let `$effect` silently reassign `selectedMethodId` to `available[0].id` (e.g., `Cash`).
   - Clear `selectedMethodId` (`''`) so `#btn-save` stays disabled until the user explicitly chooses an active method, and display an explicit warning message naming the unavailable original method (from `allMethods`) and instructing the user to pick an active replacement.
2. **Empty re-bootstrapped DB watermark reset (`apps/web/src/routes/api/v1/sync/pull/+server.ts:96`):**
   - Change `if (sinceBigInt > currentSeq && currentSeq > 0n)` to `if (sinceBigInt > currentSeq)` so a client holding `cursor > 0` against a freshly reset empty server DB (`currentSeq === 0n`) receives `409 cursor_past_watermark`, resets `cursor` to `'0'`, and re-syncs cleanly. (Also verify `since = '0'` still succeeds when `currentSeq === 0n`.)
3. **Outbox/rejected-op-safe pruning & `recovery.ts` fix (`prune.ts`, `pull.ts`, `recovery.ts`):**
   - Preserve any `rate_profile_id` or `method_id` still referenced by pending `db.outbox` or unresolved `db.rejectedOps` during incremental pruning (unless resetting cache on `super_admin` center switch in `CLT-T-081`).
   - Fix `apps/web/src/lib/sync/recovery.ts:390`: compare `patchedPayload.methodId !== localEntry.method_id` instead of `patchedPayload.methodId !== snapshot.rateProfileId`.
   - Inspect `apps/web/src/routes/api/v1/sync/pull/+server.ts` for which tables (`payables`, `profiles`, `monthCloses`, `settlements`, `statements`) are returned authoritatively on `includeMeta` per role/scope; prune non-delivered rows for any table guaranteed to return a complete snapshot for that pull (never clearing admin-only stores when a `staff` user receives omitted/empty arrays).
   - Also check `409`/`410` handling in `pull.ts` when re-bootstrapping: ensure stale cached rows don't linger when `cursor` resets to `'0'`.
4. **Expand `prune.test.ts`:**
   - Test empty `deliveredIds` handling, preservation of IDs referenced by `outbox`/`rejectedOps`, center-scoped pruning through `getCenterDb` / `setActiveCenterDb` (`KumonLedger_<centerId>` isolation), and `pull.ts` batch 1 (`includeMeta=true`) vs batch 2 (`includeMeta=false`) behavior.

## Acceptance Criteria
- All 4 items above implemented cleanly without duplicating logic (`<code_quality>`).
- Focused Vitest suite (`src/lib/db/prune.test.ts`, `src/lib/db/dexie.test.ts`) and `@clt/web` unit tests pass cleanly.

