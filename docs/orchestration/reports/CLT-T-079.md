# Task Report: CLT-T-079 — Offline Stale Config Pruning & Supersede/Watermark Hardening (`CLT-R-026`)

- **Task ID:** CLT-T-079 (`CLT-F-031` / `CLT-R-026`)
- **Implementer:** External builder (initial pass) → `A-IMP-2` (remediation)
- **Auditor:** `A-AUD-1` (Independent Zero-Trust Audit)
- **Verdict:** `PASS` (0 Blockers, 0 Majors; 1 non-blocking Minor retained)

## Scope & Implemented Behavior
1. **`apps/web/src/lib/db/prune.ts`**: Added protected-ID resolution (`collectProtectedConfigIds`) preserving `method_id`/`rate_profile_id`/`entryId` still referenced by unresolved `outbox`, `rejectedOps`, or `'pending'`/`'rejected'` `entries` (including `supersede_entry` `payload.replacement`); added `pruneStaleRows`, per-table pruning (`pruneReplacedMethods`, `pruneReplacedRateProfiles`, `pruneReplacedPayables`, `pruneReplacedMonthCloses`, `pruneReplacedProfiles`, `pruneReplacedSettlements`, `pruneReplacedStatements`), `clearSyncedEntries`, and `clearSuperCenterCache` with optional `database` targeting for multi-center `KumonLedger_<centerId>` testing.
2. **`apps/web/src/lib/sync/pull.ts` & `apps/web/src/routes/api/v1/sync/pull/+server.ts`**: Removed `&& currentSeq > 0n` on cursor watermark check (`if (sinceBigInt > currentSeq)` returns HTTP `409 cursor_past_watermark` even on empty re-bootstrapped DBs); `pull.ts` clears synced entries and forces `isFirstBatch = true` on `409`/`410`, prunes only delivered arrays on `includeMeta === true` (so omitted `staff` admin stores are never wiped), and exposes `invalidateInFlightPull()` + `resetSuperCenterCache()`.
3. **`apps/web/src/routes/(app)/entries/new/+page.svelte` & `apps/web/src/lib/sync/recovery.ts`**: Filtered chip list to active methods in `activeProfile.method_rates`, prevented silent `$effect` fallback to `available[0]` in `?supersede=<id>` when the original method is inactive or unconfigured (`requireExplicitMethodSelection`, `role="alert"` banner, `#btn-save` disabled until chosen), and fixed `retryRejectedOp` (`recovery.ts:390`) comparing `methodId !== localEntry.method_id`.

## Audit Findings
- **Resolved:** Initial `FAIL` findings (silent supersede method fallback, empty-DB `409` skip, outbox-unaware pruning, `recovery.ts` comparison, unpruned non-method stores).
- **Non-blocking Minor:** Direct hypothetical callers of `executeIncrementalPull()` outside `syncRunner` do not re-check `pullEpoch` between intermediate `await` points inside `includeMeta`; all app UI paths serialize via `syncRunner.syncNow()`.

## Independent Verification (Post-Final Edit)
- `pnpm --filter @clt/web test`: **20 passed (20) files, 242 passed (242) tests** (`src/lib/db/prune.test.ts` 12/12).
- `pnpm test`: **9 passed | 1 skipped (10) files** (`bootstrap.test.ts` opted out), **104 passed | 10 skipped (114)**.
- `pnpm typecheck` (`exit 0`), `pnpm lint` (`0` errors, `103` repo warnings; `0/0` across scope files), `pnpm exec prettier --check .` (`exit 0`).
- `CLT-R-026` moved to `MITIGATING` (hardware APK re-check remains owed under `CLT-R-002`).

