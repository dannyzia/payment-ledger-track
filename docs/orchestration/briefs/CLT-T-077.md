# CLT-T-077 — Multi-Tenant Baseline Cleanup, Bootstrap Hygiene & Test Harness Alignment

Scheduled: 2026-11-11. Origin: Orchestrator audit of uncommitted `2026-11-10` edits after `CLT-T-076` and Orchestrator Decision `CLT-D-033`.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-077
TITLE:           Multi-Tenant Baseline Cleanup, Bootstrap Hygiene & Test Harness Alignment
ASSIGNED TO:     A-IMP-2 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-076
PROJECT:         Cosmo Ledger Track (Kumon Ledger Track) | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: AGENTS.md (Hard Rules 1–20), docs/plans/PRD-payment-ledger-app.md (§7.1, §7.4), docs/designs/multi_center_row_level_multitenancy.md, docs/orchestration/DECISIONS.md (CLT-D-030, CLT-D-033)
OS / SHELL:      Linux (Ubuntu) / bash (Node 22 LTS, pnpm)

You are A-IMP-2, role Implementer, working on the project at /home/zia/Documents/My Projects/Cosmo_Ledger_Track.
You have no memory of earlier work. Everything you need is in this brief and the files it lists.
1. Read AGENTS.md before anything else. Its hard rules override this brief.
2. Do exactly what this brief says. Do no extra work. Touch only the files listed under SCOPE.
3. Do NOT touch `supabase/migrations/20261029000001..003` or `005`, UI/API source files under `apps/web/src/`, `packages/`, or `docs/orchestration/`.
4. Do NOT run any destructive reset/wipe against the shared dev database (`127.0.0.1:54322/postgres`) — verify SQL/migration tests strictly against the throwaway `clt_test` DB (`pnpm test`) and formatting/typecheck commands!
5. Run every step under VERIFICATION and paste the real output.
6. Finish by outputting the TASK REPORT in the exact format at the end of this brief.

CONTEXT
An uncoordinated `2026-11-10` daytime session introduced defects across the uncommitted multi-tenant files:
1. `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` has `perform set_config('row_security', 'off', false);` in 12 routines, poisoning connection pools at session scope (already removed once in `CLT-T-076`). `postgres` has `rolbypassrls = true`, and every routine already sets transaction-local `clt.current_center_id`.
2. `supabase/migrations/20261029000004_security_and_rls.sql` has dead `OR current_user = 'postgres'` clauses on all `FOR SELECT TO authenticated` policies (duplicated twice on `centers_select_policy`).
3. `supabase/migrations/20261029000008_center_provisioning_v2.sql` was added as a patch over uncommitted `007_center_provisioning.sql` because `007`'s 3-payable model (`vat`, `bkash_charge`, `card_charge`) omitted a payable for Mastercard and broke `generate_monthly_settlements` + `combined_card` matching in `tolerance.ts`. Per `CLT-D-030` (clean declarative baseline) and `CLT-D-033`, fold the PRD §7.4 canonical 5-method / 4-payable seed cleanly into `007` and delete `008`.
4. `scripts/bootstrap.ts` has a raw SQL `insert into auth.users ... 'bootstrap-verify-dummy'` hack (lines 98–110), plus an untracked scratch script `scripts/clt-bootstrap-verify.ts`.
5. `tests/db/schema.test.ts` fails syntax parsing due to a duplicate `} finally { await seedClient.release(); }` block (lines 87–92), leaks `SET row_security = off` onto a pooled client, and doesn't `RESET ALL` in `Test #30`.
6. `tests/db/bootstrap.test.ts` mixes `ensureTestDatabase()` (`clt_test`) with `process.env.DATABASE_URL` (`postgres`), deletes `payment_methods`/`payables` while leaving `centers` intact (causing `bootstrap()`'s `provisionCenterIfMissing` to skip!), and asserts single-center row counts (`5`, `4`, `1`, `5`, `1`) despite `bootstrap()` provisioning TWO centers (`MHK` and `RMP`).
7. `apps/web/tests/reports/view_parity.test.ts` inserts `TEST_USER_ID` with `role = 'owner'` into `centers` `LIMIT 1`, colliding with `uq_one_owner` whenever that center already has an active owner.

SCOPE (the ONLY files you may modify or delete)
- supabase/migrations/20261029000004_security_and_rls.sql — modify
- supabase/migrations/20261029000006_functions_settlement_recon_month.sql — modify
- supabase/migrations/20261029000007_center_provisioning.sql — modify
- supabase/migrations/20261029000008_center_provisioning_v2.sql — DELETE
- scripts/bootstrap.ts — modify
- scripts/clt-bootstrap-verify.ts — DELETE
- tests/db/schema.test.ts — modify
- tests/db/bootstrap.test.ts — modify
- apps/web/tests/reports/view_parity.test.ts — modify

REQUIREMENTS (numbered; each is testable)

R1. Clean `supabase/migrations/20261029000004_security_and_rls.sql`:
    - Remove every ` OR current_user = 'postgres'` clause from all RLS policies (including the duplicate line on `centers_select_policy`).
    - Keep `OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'`, all 20 `FORCE ROW LEVEL SECURITY` statements, grants, and view permissions unchanged.
    - Verify `grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql` returns zero matches.

R2. Clean `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`:
    - Remove all 12 occurrences of `perform set_config('row_security', 'off', false);`.
    - Keep `perform set_config('clt.current_center_id', p_center_id::text, true);` and all logic intact.
    - Verify `grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql` returns zero matches.

R3. Fold PRD §7.4 canonical provisioning into `007` and delete `008`:
    - Delete `supabase/migrations/20261029000008_center_provisioning_v2.sql`.
    - In `supabase/migrations/20261029000007_center_provisioning.sql`, update `rpc_create_center` to seed:
      - 5 payment methods (starting `active = false`, activated after profile v1 publish):
        - `('cash', 'Cash', false, 10, false)`
        - `('bkash', 'bKash', true, 20, false)`
        - `('visa', 'Visa', true, 30, false)`
        - `('mastercard', 'Mastercard', true, 40, false)`
        - `('bank_transfer', 'Bank Transfer', false, 50, false)`
      - 4 canonical payables (PRD §7.4 + compatible with `generate_monthly_settlements` and `tolerance.ts` `combined_card`):
        - `('Government VAT', 'vat_payable', 'vat', null, 15)`
        - `('bKash Merchant Charges', 'bkash_charge_payable', 'method_charge', v_bkash_id, 10)`
        - `('Visa Card Processing Charges', 'visa_charge_payable', 'method_charge', v_visa_id, 15)`
        - `('Mastercard Card Processing Charges', 'mastercard_charge_payable', 'method_charge', v_master_id, 15)`
      - 5 method rates in rate profile v1 (`effective_from = date '2026-01-01'`, `vat_mode = 'manual'`, `vat_bp = 0`, `commission_bp = 4200`, `commission_base = 'gross'`, `charges_borne_by = 'business'`):
        - `cash = 0`, `bkash = 115`, `visa = 150`, `mastercard = 150`, `bank_transfer = 0`.
      - Update header/function `comment on function rpc_create_center` to match.

R4. Remove dummy SQL auth insert from `scripts/bootstrap.ts` and delete scratch script:
    - In `scripts/bootstrap.ts`, remove lines 98–110 (`insert into auth.users ... 'bootstrap-verify-dummy'` and its comment).
    - Delete `scripts/clt-bootstrap-verify.ts`.

R5. Fix `tests/db/schema.test.ts`:
    - Remove the duplicate `} finally { await seedClient.release(); }` block and syntax bug in `beforeAll`.
    - Remove `multipleStatements: true` from `new Pool(...)` and remove the `SET row_security = off` / `console.error('SET row_security failed:...')` debug block from `seedClient`; wrap seeding cleanly in `BEGIN` ... `COMMIT` with `ROLLBACK` on catch and `seedClient.release()` in a single `finally`, and remove the duplicate `DELETE FROM payment_methods;` line.
    - In `Test #30`, change `await client.query('RESET ROLE')` in `finally` to `await client.query('RESET ALL')` (so `request.jwt.claims` and `clt.current_center_id` do not leak onto pooled connections).

R6. Fix `tests/db/bootstrap.test.ts`:
    - Remove the `ensureTestDatabase` import and call (no `clt_test` mixing when driving real Supabase Auth Admin API).
    - Load `.env.local` and `.env` at module top via `dotenv` with `{ override: false }` so local auth env vars are available cleanly if not passed explicitly.
    - In `beforeAll`: query `centers` first; if `centers` already has rows AND `process.env.CLT_BOOTSTRAP_ALLOW_NONEMPTY !== '1'`, throw a clear error telling the runner that `bootstrap.test.ts` requires a clean/freshly reset database matching `SUPABASE_URL` (e.g. isolated stack `54341`/`54342`) rather than touching a populated shared DB. (Keep `wipeSeededData` only if needed when `CLT_BOOTSTRAP_ALLOW_NONEMPTY === '1'`, OR if centers = 0 just run `await bootstrap()` directly; note if `CLT_BOOTSTRAP_ALLOW_NONEMPTY === '1'`, wiping config/methods without centers wouldn't re-seed them anyway, so require empty `centers`!). Actually keep it super simple and clear: check `SELECT count(*)::int AS n FROM centers`; if `n > 0`, fail loudly explaining `bootstrap.test.ts requires a clean empty Supabase database (e.g. isolated e2e stack via supabase db reset)` rather than half-wiping data! Remove dead `wipeSeededData` helper if unused, or fail clearly before `bootstrap()` when `n > 0`.
    - Update all test descriptions and assertions for multi-center (`MHK` and `RMP`):
      1. Title `'verifies all 20 public tables exist in database'`.
      2. `'verifies platform super_admin profile exists'` -> `1` row, `role = 'super_admin'`, `active = true`, `full_name = 'Platform Super Admin'`, `center_id = null`.
      3. `'verifies both franchise centers provisioned'` -> `2` rows ordered by `code`: `['MHK', 'RMP']`.
      4. `'verifies 5 canonical payment methods seeded and active per center'` -> verify total active = `10`, and for each of `MHK` and `RMP`, 5 active methods sorted by `sort_order` have codes `['cash', 'bkash', 'visa', 'mastercard', 'bank_transfer']`.
      5. `'verifies 4 canonical payables seeded per center'` -> verify total = `8`, and for each of `MHK` and `RMP`, 4 payables sorted by `code` have codes `['bkash_charge_payable', 'mastercard_charge_payable', 'vat_payable', 'visa_charge_payable']`.
      6. `'verifies Rate Profile v1 is published and backdated to 2026-01-01 per center'` -> `2` rows (`1` per center `MHK`/`RMP`), `status = 'published'`, `eff = '2026-01-01'`, `vat_mode = 'manual'`, `commission_bp = 4200`.
      7. `'verifies method rates for Profile v1 match operational defaults across all 5 methods per center'` -> `10` rows total (`5` per center `MHK`/`RMP`), and per center `bkash = 115`, `visa = 150`, `mastercard = 150`, `cash = 0`, `bank_transfer = 0`.
      8. `'verifies app_settings rows initialized per center'` -> `2` rows (`1` per center), each with `timezone = 'Asia/Dhaka'`, `currency = 'BDT'`, `locale = 'en-BD'`, `reconcile_tolerance_poisha = '100'`.
      9. `'verifies system.bootstrap event recorded in audit_log'` -> `>= 1`, `center_id` null, `action = 'system.bootstrap'`, `target_table = 'system'`, `target_id = 'bootstrap'`, `after.status = 'completed'`.
      10. `'verifies bootstrap script executes idempotently twice without error'` -> runs `bootstrap()` twice, asserts `super_admin = 1`, `centers = 2`, active `payment_methods = 10`, `payables = 8`, published v1 `rate_profiles = 2`, `app_settings = 2`.

R7. Fix `apps/web/tests/reports/view_parity.test.ts`:
    - Change `TEST_USER_ID` profile seed (lines 71–73) from `role = 'owner'` to `role = 'staff'` (`ON CONFLICT (id) DO UPDATE SET center_id = '${centerId}', role = 'staff', active = true`) so it never collides with `uq_one_owner` on centers that already have an active owner.
    - Keep all SQL view parity assertions and `ROLLBACK` cleanup unchanged.

R8. Formatting:
    - Ensure Prettier passes on all modified TypeScript files (`pnpm exec prettier --write` / `--check` on `scripts/bootstrap.ts`, `tests/db/schema.test.ts`, `tests/db/bootstrap.test.ts`, `apps/web/tests/reports/view_parity.test.ts`).

VERIFICATION (run ALL of these and paste exact outputs)
1. `grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql || echo "CLEAN_004"`
2. `grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql || echo "CLEAN_006"`
3. `ls -la supabase/migrations/20261029000008_center_provisioning_v2.sql scripts/clt-bootstrap-verify.ts 2>&1 || true` (confirm both deleted)
4. `pnpm test` (rebuilds throwaway `clt_test` from `supabase/migrations`, runs schema, entries_sync, settlement_recon, calc_parity; skips bootstrap.test.ts unless opted in)
5. `pnpm typecheck`
6. `pnpm format`

TASK REPORT FORMAT
Wrap in a fenced code block:
```
=== TASK REPORT ===
TASK ID:         CLT-T-077
AGENT ID:        A-IMP-2
STATUS:          DONE | BLOCKED
SUMMARY:         <2-4 sentences>
FILES CHANGED:   <path>  <modify|delete>  <short note>
COMMANDS RUN:    <numbered commands and verbatim outputs>
ACCEPTANCE:      <R1-R8 pass/fail matching verification steps>
=== END REPORT ===
```

