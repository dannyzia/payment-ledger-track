# Task Brief: CLT-T-082 — Device Role-Gate Verification & Gate 5 Device Check Remediation

| Field | Value |
|---|---|
| Task ID | CLT-T-082 |
| Feature | CLT-F-034 / CLT-R-031 / GS-4 |
| Assigned Agent | A-IMP-2 (Implementer) |
| Audit Status | Initial PR #1 (`9aabde5`) `REQUEST_CHANGES` (1 Blocker resolved via rebase onto `main` `ec05742`; 3 code Majors + 6 Minors to remediate) |
| Dependencies | `CLT-T-071`–`CLT-T-081` (landed on `main` `ec05742`) |
| Rules | Hard Rules 8, 12, 16, 18; PRD §18 |

## Context
An initial builder commit (`9aabde5`, PR `#1`) added `pnpm test:e2e:device` (`verify-device-fixtures.ts`, `verify-owner-screens.ts`), `set-fixture-password.ts`, multi-center updates to `test-device-journey.ts`, `scripts/gate-device-check.ts`, and `Gate 5 (Physical Device)` wiring in `scripts/verify-gates.ts`.

The base-branch dependency Blocker has been resolved by landing `CLT-T-069`–`CLT-T-081` to `main` (`ec05742`) and rebasing `task/CLT-T-082` onto `main` (`fca4bdb`). Remediate the remaining code/doc findings from `A-AUD-1`'s Zero-Trust audit before re-audit and PR `#1` merge.

## Scope Files
- `scripts/verify-gates.ts`
- `scripts/gate-device-check.ts`
- `scripts/e2e/set-fixture-password.ts`
- `scripts/e2e/test-device-journey.ts`
- `scripts/e2e/verify-device-fixtures.ts`
- `scripts/e2e/verify-owner-screens.ts`
- `scripts/e2e/device-sign-in.ts`
- `scripts/e2e/device-sign-in-flow.ts`
- `docs/runbooks/DEVICE_JOURNEY.md`
- `docs/orchestration/GATE5_PHYSICAL_DEVICE_CHECKLIST.md`
- `tests/scripts/*.test.ts`

## Required Changes

### Majors
1. **Fix false-green `allSatisfied` and non-M5 milestone bypass in `scripts/verify-gates.ts` (Rule 16):**
   - Compute `const allSatisfied = Object.values(gates).every((g) => g.satisfied);` so `GATE_EVIDENCE.json` / `GATE5_EVIDENCE.json` NEVER reports `"allSatisfied": true` when `Gate 5 (Physical Device)` has `satisfied: false` (`not_run_no_environment` / `not_run_no_fixtures`).
   - Use a separate `const blockingChecksPassed = Object.values(gates).every((g) => g.satisfied || isNonBlockingDeviceStatus(g.status));` ONLY for deciding `process.exit(1)` vs `0` when a missing handset/fixture is non-blocking. Keep/align the stderr warnings and completion `console.info` phrasing cleanly.
   - Change `if (gate5Only || milestoneArg.toUpperCase() === 'M5')` to `if (gate5Only || milestoneArg.toUpperCase() !== 'M2')` (matching `evaluateGate5()`'s deferral rule) so `scripts/ops/deploy-check.ts --milestone staging|production` never bypasses `Gate 5 (Physical Device)`.
   - Add/update unit tests in `tests/scripts/gate-device-check.test.ts` (extract a pure report-summary helper if clean) proving `allSatisfied` stays `false` under `not_run_*` while `blockingChecksPassed` stays `true`, and `failed` sets both to `false`.
   - Check `docs/orchestration/GATE5_PHYSICAL_DEVICE_CHECKLIST.md` §9.1 wording on GS-4 so it accurately describes `allSatisfied: false` when `not_run_*` is recorded.
2. **Add local-environment guard in `scripts/e2e/set-fixture-password.ts` (Rule 18):**
   - Verify `SUPABASE_URL` targets a local host (`127.0.0.1`, `localhost`, or `::1`) before calling `admin.auth.admin.updateUserById(...)`, refusing non-local targets unless an explicit `--allow-remote` flag is passed. Add/extend a unit test in `tests/scripts/` covering this guard.
3. **Fix 3 strict TypeScript errors in `scripts/e2e/test-device-journey.ts`:**
   - Update `resolveCenter` return type from `Promise<Omit<JourneyTarget, 'accountEmail'>>` to `Promise<Omit<JourneyTarget, 'accountEmail' | 'accountSource'>>`.
   - Fix `breakdownEl.innerText` (`Element` vs `HTMLElement`) by reading `(breakdownEl as HTMLElement).innerText ?? breakdownEl.textContent ?? ''` (or `breakdownEl.textContent ?? ''`), removing both `TS2339` and the cascading `TS7006` implicit `any` on `.filter((l) => ...)`.

### Minors
4. **Zero `no-console` ESLint warnings in PR scope:** Replace `console.log` with `console.info` across `device-sign-in-flow.ts`, `device-sign-in.ts`, `test-device-journey.ts`, `verify-device-fixtures.ts`, and `verify-owner-screens.ts`.
5. **Fix cleanup doc drift in `docs/runbooks/DEVICE_JOURNEY.md`:** Update `pnpm db:purge-entry` example to `--id <uuid>` (or `--entry <entry_number>`) and `--allow-remote` (remove non-existent `--allow-local`).
6. **Fix `test-device-journey.ts` entry ID & center lookup:** Select `entry_number` alongside `id` in Step 6 and check `row.entry_number?.startsWith(\`E-${target.centerCode}-\`)` instead of `row.id.startsWith(...)`; match `centers.code` case-insensitively (`UPPER(code) = UPPER($1)`) like `verify-device-fixtures.ts`.
7. **Avoid 30 s staff-redirect wait in `scripts/e2e/verify-owner-screens.ts`:** In the staff branch (`STAFF_GUARDED_ROUTES`), finish waiting as soon as either `'Access Restricted'` renders OR `location.pathname` leaves the guarded route (e.g. redirects to `/dashboard` or `/login`).
8. **Harden multi-stage preflight classification in `scripts/gate-device-check.ts`:** If earlier stage output (e.g. `PASS` / `===` fixture/owner summary) already ran before a subsequent stage emitted `PREFLIGHT FAILED`, classify as `failed` (`DEVICE_CHECK_STATUS.failed`) rather than `not_run_no_environment`, and test it in `tests/scripts/gate-device-check.test.ts`.

## Acceptance Criteria
- `pnpm format` exits `0`.
- `pnpm typecheck` exits `0` (`svelte-check` 0/0).
- Strict TypeScript check on all PR #1 `.ts` files exits `0` (`pnpm exec tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --strict --esModuleInterop --skipLibCheck ...`).
- `pnpm exec eslint` across all modified/added `.ts` files reports `0` errors and `0` warnings.
- `pnpm exec vitest run tests/scripts` passes 100% of unit tests.
- No secrets committed, logged, or returned (Rule 8).
- Do not commit, push, or touch `main`; leave changes cleanly ready on `task/CLT-T-082` for `A-AUD-1` re-audit.

