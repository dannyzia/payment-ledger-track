# CLT-T-077 Report — Multi-Tenant Baseline Cleanup, Bootstrap Hygiene & Test Harness Alignment

Date: 2026-11-11
Agent: A-IMP-2 (Implementer)
Status: DONE (pending independent Auditor review & full M2/E2E verification)

```
=== TASK REPORT ===
TASK ID:         CLT-T-077
AGENT ID:        A-IMP-2
STATUS:          DONE
SUMMARY:         Cleaned multi-tenant baseline migrations 004, 006, and 007 and deleted patch migration 008 and scratch script scripts/clt-bootstrap-verify.ts per CLT-D-033. Removed the dummy auth.users SQL insert from scripts/bootstrap.ts, fixed schema.test.ts pooling/syntax/reset bugs (including RESET ROLE + RESET ALL in Test #30 since PostgreSQL RESET ALL skips role), rewrote bootstrap.test.ts for clean-DB 2-center (MHK/RMP) verification, and changed view_parity.test.ts seed role from owner to staff. All 103 active tests in pnpm test (including all 22 tests in schema.test.ts on throwaway clt_test), pnpm typecheck, and Prettier/ESLint checks on all modified TypeScript files pass; full-repo pnpm format exits 1 solely due to 17 pre-existing out-of-scope files.
FILES CHANGED:
  supabase/migrations/20261029000004_security_and_rls.sql          modify  Removed all 18 `OR current_user = 'postgres'` clauses from RLS policies (including duplicate line on centers_select_policy).
  supabase/migrations/20261029000006_functions_settlement_recon_month.sql  modify  Removed all 12 occurrences of `perform set_config('row_security', 'off', false);`.
  supabase/migrations/20261029000007_center_provisioning.sql       modify  Folded PRD §7.4 canonical 5 payment methods (cash, bkash, visa, mastercard, bank_transfer), 4 payables (vat_payable, bkash_charge_payable, visa_charge_payable, mastercard_charge_payable), and 5 method_rates into rpc_create_center and updated comments.
  supabase/migrations/20261029000008_center_provisioning_v2.sql    delete  Removed superseded bolt-on provisioning patch migration.
  scripts/bootstrap.ts                                             modify  Removed dummy `insert into auth.users ... 'bootstrap-verify-dummy'` block and comment.
  scripts/clt-bootstrap-verify.ts                                  delete  Removed untracked scratch verification script.
  tests/db/schema.test.ts                                          modify  Removed duplicate finally block, multipleStatements option, SET row_security = off debug block, and duplicate payment_methods delete; wrapped seed in BEGIN/COMMIT/ROLLBACK; updated Test #30 finally to RESET ROLE + RESET ALL.
  tests/db/bootstrap.test.ts                                       modify  Removed ensureTestDatabase and wipeSeededData; added dotenv ({ override: false }); fail loudly if centers count > 0; updated all 10 tests for 20 tables and MHK/RMP multi-center assertions.
  apps/web/tests/reports/view_parity.test.ts                       modify  Changed TEST_USER_ID seeded profile role from 'owner' to 'staff' to avoid uq_one_owner collisions.
COMMANDS RUN:
1. grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql || echo "CLEAN_004"
CLEAN_004

2. grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql || echo "CLEAN_006"
CLEAN_006

3. ls -la supabase/migrations/20261029000008_center_provisioning_v2.sql scripts/clt-bootstrap-verify.ts 2>&1 || true
ls: cannot access 'supabase/migrations/20261029000008_center_provisioning_v2.sql': No such file or directory
ls: cannot access 'scripts/clt-bootstrap-verify.ts': No such file or directory

4. pnpm test (exit code 0)
 ✓ |@clt/calc| test/fixtures.test.ts (8)
 ✓ |@clt/calc| test/properties.test.ts (6) 14873ms
 ✓ |@clt/shared| test/wire.test.ts (12)
 ✓ |root-tests| tests/sanity.test.ts (1)
 ↓ |root-tests| tests/db/bootstrap.test.ts (10) [skipped]
 ✓ |root-tests| tests/db/calc_parity.test.ts (5)
 ✓ |root-tests| tests/db/entries_sync.test.ts (17) 1086ms
 ✓ |root-tests| tests/db/schema.test.ts (22) 1598ms
 ✓ |root-tests| tests/db/settlement_recon.test.ts (27) 2547ms
 ✓ |root-tests| tests/ops/deploy-check.test.ts (5)

 Test Files  9 passed | 1 skipped (10)
      Tests  103 passed | 10 skipped (113)
   Start at  09:13:38
   Duration  27.88s (transform 746ms, setup 0ms, collect 1.71s, tests 20.43s, environment 6ms, prepare 1.84s)

(Supplemental runtime verification in throwaway clt_test inside rolled-back transaction: `SELECT rpc_create_center(...)` created 5 active methods [cash, bkash, visa, mastercard, bank_transfer], 4 payables [vat_payable due 15, bkash_charge_payable due 10, visa_charge_payable due 15, mastercard_charge_payable due 15], published v1 rate_profile, and 5 method_rates [0, 115, 150, 150, 0].)

5. pnpm typecheck (exit code 0)
$ tsc --build packages/calc packages/shared && pnpm --filter @clt/web check

$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
Loading svelte-check in workspace: /home/zia/Documents/My Projects/Cosmo_Ledger_Track/apps/web
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings

6. pnpm format (exit code 1 — 17 pre-existing out-of-scope files only; all 4 scoped TS files clean)
$ prettier --check .
Checking formatting...
...
[warn] apps/web/src/lib/auth/session.svelte.ts
[warn] apps/web/src/lib/database.types.ts
[warn] apps/web/src/lib/db/index.ts
[warn] apps/web/src/lib/server/auth.ts
[warn] apps/web/src/routes/(app)/admin/super/centers/+page.svelte
[warn] apps/web/src/routes/(app)/admin/super/search/+page.svelte
[warn] apps/web/src/routes/api/v1/admin/settings/+server.ts
[warn] apps/web/src/routes/api/v1/admin/super/centers/[id]/+server.ts
[warn] apps/web/src/routes/api/v1/admin/super/centers/+server.ts
[warn] apps/web/src/routes/api/v1/admin/super/search/+server.ts
[warn] apps/web/src/routes/api/v1/sync/push/+server.ts
[warn] apps/web/tests/e2e/ledger_role_split.spec.ts
[warn] apps/web/tests/e2e/offline_sync.spec.ts
[warn] apps/web/tests/regression/suite.test.ts
[warn] scripts/e2e/test-device-journey.ts
[warn] tests/db/entries_sync.test.ts
[warn] tests/db/settlement_recon.test.ts
[warn] Code style issues found in 17 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.

Scoped Prettier check:
pnpm exec prettier --check scripts/bootstrap.ts tests/db/schema.test.ts tests/db/bootstrap.test.ts apps/web/tests/reports/view_parity.test.ts (exit code 0)
Checking formatting...
scripts/bootstrap.tstests/db/schema.test.tstests/db/bootstrap.test.tsapps/web/tests/reports/view_parity.test.tsAll matched files use Prettier code style!

Scoped ESLint check:
pnpm exec eslint scripts/bootstrap.ts tests/db/schema.test.ts tests/db/bootstrap.test.ts apps/web/tests/reports/view_parity.test.ts (exit code 0, no output)

ACCEPTANCE:
R1: PASS — `grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql` returned zero matches (`CLEAN_004`); super_admin clauses, 20 FORCE RLS statements, grants, and views preserved.
R2: PASS — `grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql` returned zero matches (`CLEAN_006`); all 12 `set_config('row_security', 'off', false)` lines removed while `clt.current_center_id` and logic remain intact.
R3: PASS — `008_center_provisioning_v2.sql` deleted; `007_center_provisioning.sql` folds in all 5 methods, 4 payables, 5 method_rates, and updated header/function comments; verified by `clt_test` migration rebuild and rolled-back `rpc_create_center` execution.
R4: PASS — Dummy `auth.users` SQL insert removed from `scripts/bootstrap.ts`; `scripts/clt-bootstrap-verify.ts` deleted.
R5: PASS — `tests/db/schema.test.ts` syntax/duplicate `finally` fixed, `multipleStatements` and `SET row_security = off` removed, duplicate `DELETE FROM payment_methods` removed, seeding wrapped in `BEGIN`/`COMMIT`/`ROLLBACK`, Test #30 `finally` resets both `RESET ROLE` and `RESET ALL` (required in Postgres because `RESET ALL` leaves `role` unchanged); all 22 schema tests pass.
R6: PASS — `tests/db/bootstrap.test.ts` removes `ensureTestDatabase`/`wipeSeededData`, loads `.env.local`/`.env` with `override: false`, checks `centers` count and throws if non-empty, and updates all 10 multi-center (`MHK`/`RMP`) test titles and assertions (opt-in suite skipped under default `pnpm test`).
R7: PASS — `apps/web/tests/reports/view_parity.test.ts` seeds `TEST_USER_ID` with `role = 'staff'`; passes `pnpm typecheck`, Prettier, and ESLint.
R8: PASS (scoped) — All 4 modified TypeScript files pass `prettier --check` (exit 0); repo-wide `pnpm format` fails only on 17 pre-existing out-of-scope files untouched due to strict SCOPE rules.
=== END REPORT ===
```

