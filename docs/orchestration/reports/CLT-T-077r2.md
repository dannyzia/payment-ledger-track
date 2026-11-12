=== TASK REPORT ===
Task: CLT-T-077r2
Agent: A-IMP-2
Status: DONE

## Summary of Changes (Strictly within 5-file Allowed SCOPE)

1. `supabase/migrations/20261029000004_security_and_rls.sql` (R1)
   - Updated `audit_log_select_policy` (`TO authenticated`) to require `AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')` on the center-scoped branch alongside `OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'`.
   - Wrapped `devices_select_policy` center+user/role predicate in outer parentheses before `OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'`.
   - Preserved `0` occurrences of `current_user`.

2. `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` (R2)
   - `record_settlement_payment`: added `and center_id = p_center_id` to both reversal queries on `settlement_payments`.
   - `review_entry_reconciliation_exception`: restored 6-arg signature `(p_center_id uuid, p_entry_id uuid, p_payable_id uuid, p_action text, p_reason text, p_actor_id uuid) returns void`; enforced `422 center_not_found`, `403 unauthorized` (`admin`/`owner` with `v_caller_role is null` guard), `422 invalid_action`, `422 reason_required` (no synthetic reason fallback), `422 entry_not_found` (`entries` scoped to `p_center_id`), Class `1001` month lock, `422 month_closed`, Class `1002` lock, `payables for key share` (`422 payable_not_found`), `entries for update` (`422 cannot_except_non_active_entry`), payable applicability check (`422 payable_not_applicable_to_entry`), upsert into `entry_reconciliation_exceptions`, and `log_audit_event(..., 'entry.reconciliation_exception', ...)`.
   - `reconcile_statement`: restored lock hierarchy (read `v_month` without lock -> `422 statement_not_found` -> Class `1001` month lock -> `422 month_closed` -> covered `payables order by p.id asc for key share` -> `statements for update`), `422 cannot_reconcile_non_open_statement`, center-scoped tolerance `v_tol`, live expected computation `v_live_expected` across active center entries, Mode A guards (`422 manual_total_has_lines`, `422 expected_poisha_mismatch`), Mode B guards (removed broken `e.created_at > v_stmt.created_at` / `snapshot_mismatch_new_entries`; restored center-scoped Assertions 1–3: `422 invalid_matched_entry`, `422 unmatched_statement_lines_remain`, `422 unmatched_entries_without_approved_exceptions`), shared Mode A+B tolerance check (`422 variance_exceeds_tolerance`), `statements` update (`expected_poisha = v_live_expected`, `note = coalesce(nullif(p_note, ''), note)`), `statement_payables` update (`status = 'reconciled'`), and `log_audit_event`.
   - `close_month`: Owner-only guard (`v_caller_role is distinct from 'owner'`), Class `1001` lock first, restored early idempotent return when already `'closed'`, moved `payables order by id asc for key share` lock before `generate_monthly_settlements(p_center_id, v_month)` and settlement due-date updates, kept Gates 1–2, updated Gate 3 error to `'422 unapproved_overpaid_settlement'`, removed dead Gate 4 (`pending_reconciliation_exceptions`) and unused local variables (`v_settings`, `v_unapproved`, `v_unreconciled`, `v_pending_exceptions`).
   - `reopen_month`: Owner-only guard (`v_caller_role is distinct from 'owner'`), `422 reason_required`, Class `1001` lock, single `422 month_not_closed` check (removed separate `month_already_open` branch and unused `v_prev`), updated `month_closes`, restored statement invalidation cascade setting `statements` (`status = 'open', updated_at = now()`) and `statement_payables` (`status = 'open'`) where `center_id = p_center_id and month = v_month and status = 'reconciled'`, and logged `month_close_events` + `audit_log`.
   - Cleaned all 11 `;begin` formatting typos across functions 8, 9, 11–19 and unused `v_sum_total` in `reconcile_statement`, keeping `0` occurrences of `row_security`.

3. `apps/web/src/lib/database.types.ts` (R3)
   - Updated `Database['public']['Functions']['review_entry_reconciliation_exception']` to `Args: { p_center_id: string; p_entry_id: string; p_payable_id: string; p_action: string; p_reason: string; p_actor_id: string }` and `Returns: undefined`.
   - Verified all 33 non-trigger public functions in `005`/`006`/`007` match `database.types.ts` in name, argument order/names/types, and return type.

4. `tests/db/settlement_recon.test.ts` (R4)
   - Updated Gate 3 overpayment tests (`Test #6` and `Test #34`) to expect `'422 unapproved_overpaid_settlement'` (and restored `Test #6` Mode A statement total `0` matching live expected `0`).
   - Updated `Test #7` to verify `reopen_month` cascades reconciled `statements` & `statement_payables` back to `'open'` and rejects `ADMIN_ID`/`STAFF_ID` with `'403 unauthorized'`.
   - Updated `review_entry_reconciliation_exception` calls in `Test #37` and `Test #54` to the 6-arg signature, restored `Test #37`'s negative assertion `'422 unmatched_entries_without_approved_exceptions'`, and added negative assertions `'422 payable_not_applicable_to_entry'` and `'422 cannot_except_non_active_entry'`.
   - Updated `Test #39` to verify `month_close_events` has exactly `1` `'close'` row after two `close_month` calls.
   - Updated `Test #40` to expect `'422 variance_exceeds_tolerance'` and added a Mode A `'422 expected_poisha_mismatch'` check.
   - Updated `Test Role Gates` to verify `ADMIN_ID` & `STAFF_ID` are rejected with `'403 unauthorized'` on both `close_month` and `reopen_month` and fixed the comment (`only owner can close`).

5. `tests/db/schema.test.ts` (R5)
   - Added RLS test `audit_log_select_policy blocks staff and allows admin/owner within the center` using a rollback-wrapped transaction with `SET LOCAL ROLE authenticated`, `clt.current_center_id`, and `RESET ROLE` + `RESET ALL` in `finally`.

## Verification Results (All Run After Final Edit; Dev DB Port 54322 `postgres` Untouched)

### 1. Security grep checks
Command:
`grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql; echo "GREP_004_EXIT=$?"; grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql; echo "GREP_006_EXIT=$?"`
Output:
```
GREP_004_EXIT=1
GREP_006_EXIT=1
```

### 2. Full Vitest suite (`clt_test` throwaway DB)
Command: `pnpm test` (`vitest run --passWithNoTests --no-file-parallelism`)
Verbatim summary tail:
```
 ✓ |@clt/calc| test/fixtures.test.ts (8)
 ✓ |@clt/calc| test/properties.test.ts (6) 13925ms
 ✓ |@clt/shared| test/wire.test.ts (12)
 ✓ |root-tests| tests/sanity.test.ts (1)
 ↓ |root-tests| tests/db/bootstrap.test.ts (10) [skipped]
 ✓ |root-tests| tests/db/calc_parity.test.ts (5)
 ✓ |root-tests| tests/db/entries_sync.test.ts (17) 1694ms
 ✓ |root-tests| tests/db/schema.test.ts (23) 1761ms
 ✓ |root-tests| tests/db/settlement_recon.test.ts (27) 3900ms
 ✓ |root-tests| tests/ops/deploy-check.test.ts (5)

 Test Files  9 passed | 1 skipped (10)
      Tests  104 passed | 10 skipped (114)
   Start at  19:39:36
   Duration  29.86s (transform 1.01s, setup 0ms, collect 2.33s, tests 21.57s, environment 6ms, prepare 1.97s)

TEST_EXIT=0
```
(`tests/db/bootstrap.test.ts` is opted out unless `CLT_BOOTSTRAP_DB_TEST=1`.)

### 3. Typecheck (`pnpm typecheck` -> includes `pnpm --filter @clt/web check`)
Command: `pnpm typecheck; echo "TYPECHECK_EXIT=$?"`
Output:
```
$ tsc --build packages/calc packages/shared && pnpm --filter @clt/web check

$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
Loading svelte-check in workspace: /home/zia/Documents/My Projects/Cosmo_Ledger_Track/apps/web
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
TYPECHECK_EXIT=0
```

### 4. Prettier & ESLint on SCOPE files
Command 4a (`prettier --check` on all 5 SCOPE files + `eslint` on TS SCOPE files):
```
Checking formatting...
apps/web/src/lib/database.types.ts[warn] apps/web/src/lib/database.types.ts
tests/db/settlement_recon.test.tstests/db/schema.test.tssupabase/migrations/20261029000004_security_and_rls.sql
[error] No parser could be inferred for file "/home/zia/Documents/My Projects/Cosmo_Ledger_Track/supabase/migrations/20261029000004_security_and_rls.sql".
supabase/migrations/20261029000006_functions_settlement_recon_month.sql
[error] No parser could be inferred for file "/home/zia/Documents/My Projects/Cosmo_Ledger_Track/supabase/migrations/20261029000006_functions_settlement_recon_month.sql".
Error occurred when checking code style in 2 files.
PRETTIER_5_EXIT=2

/home/zia/Documents/My Projects/Cosmo_Ledger_Track/tests/db/settlement_recon.test.ts
   79:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  140:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  143:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  148:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  155:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  317:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  319:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console
  326:5  warning  Unexpected console statement. Only these console methods are allowed: warn, error, info  no-console

✖ 8 problems (0 errors, 8 warnings)

ESLINT_EXIT=0
```
Command 4b (`pnpm exec prettier --check tests/db/settlement_recon.test.ts tests/db/schema.test.ts`):
```
Checking formatting...
tests/db/settlement_recon.test.tstests/db/schema.test.tsAll matched files use Prettier code style!
```
Note: `apps/web/src/lib/database.types.ts` uses Supabase typegen formatting (no semicolons) across the existing file and was intentionally not reformatted wholesale; the two `.sql` migration files have no Prettier parser in this repo.

### 5. Read-only SQL catalog check on `clt_test`
Verbatim output:
```
DB: clt_test
close_month(p_center_id uuid, p_month date, p_actor_id uuid) -> void
reconcile_statement(p_center_id uuid, p_statement_id uuid, p_note text, p_actor_id uuid) -> void
record_settlement_payment(p_center_id uuid, p_settlement_id uuid, p_amount_poisha bigint, p_paid_on date, p_reference text, p_receipt_path text, p_note text, p_is_reversal boolean, p_reverses_id uuid, p_actor_id uuid) -> uuid
reopen_month(p_center_id uuid, p_month date, p_reason text, p_actor_id uuid) -> void
  reopen_month contains literal admin: false
  reopen_month owner-only distinct check: true
  reopen_month invalidates statements: true
review_entry_reconciliation_exception(p_center_id uuid, p_entry_id uuid, p_payable_id uuid, p_action text, p_reason text, p_actor_id uuid) -> void
audit_log.audit_log_select_policy: (((center_id = COALESCE((NULLIF(current_setting('clt.current_center_id'::text, true), ''::text))::uuid, (((auth.jwt() -> 'app_metadata'::text) ->> 'center_id'::text))::uuid)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'owner'::text]))) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text))
devices.devices_select_policy: (((center_id = COALESCE((NULLIF(current_setting('clt.current_center_id'::text, true), ''::text))::uuid, (((auth.jwt() -> 'app_metadata'::text) ->> 'center_id'::text))::uuid)) AND ((user_id = auth.uid()) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'owner'::text])))) OR (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text))
```

