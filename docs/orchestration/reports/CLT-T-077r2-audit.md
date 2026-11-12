# Independent Re-Audit Report — `CLT-T-077r2` (`A-AUD-1`)

**Overall Audit Verdict:** `CHANGES REQUESTED`
- **Targeted `CLT-T-077r2` Fixes (Checks 1–4):** **ALL RESOLVED (PASS)** — every Blocker, Major, and Minor targeted by `CLT-T-077r2` is cleanly implemented on disk and reflected in `clt_test` (`HASH_MATCH=true`).
- **Why `CHANGES REQUESTED`:**
  1. **1 Major pre-existing security defect** surfaced inside SCOPE file `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` (7 un-remediated `SECURITY DEFINER` RPCs bypass SQL `403 unauthorized` when `v_caller_role IS NULL`). Tracked to `CLT-T-077r3`.
  2. **Verification boundary:** Under read-only subagent `<Identity>` rules, A-AUD-1 did not run mutating `pnpm test` (`tests/db/*`) or mutating `pnpm typecheck` (`tsc --build` / `svelte-kit sync`). Read-only equivalents (`--dry`, `svelte-check`, `eslint`, `prettier --check`, 48/48 pure non-DB Vitest tests, and read-only `clt_test` catalog/SHA-256 queries) all succeeded; live DB suites verified directly by implementer (`A-IMP-2`) and re-verified end-to-end by Orchestrator after `CLT-T-077r3`.

---

## Check-by-Check Audit Results

### Check 1 — `supabase/migrations/20261029000004_security_and_rls.sql` — **PASS**
- `audit_log_select_policy` (`345-355`): center-scoped branch restricts reads with `AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')`, plus `OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'`. Matches live `clt_test` `pg_policies`.
- `devices_select_policy` (`151-164`): outer parentheses wrap `(center_id = COALESCE(...) AND (user_id = auth.uid() OR role IN ('admin', 'owner')))` before `OR ... = 'super_admin'`. Matches live `clt_test` `pg_policies`.
- `current_user`: `0` occurrences (`GREP_004_EXIT=1`).

### Check 2 — `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` — **PASS on all targeted `CLT-T-077r2` items; 1 pre-existing Major + 1 Minor remain**
- **Blocker 1 (`reopen_month`, `1784-1845`):** Owner-only (`if v_caller_role is distinct from 'owner'` at `1805`); `'422 reason_required'`, Class `1001` lock, single `'422 month_not_closed'` check (`1809-1821`); restores invalidation of both `statements` and `statement_payables` from `'reconciled'` -> `'open'` (`1831-1835`); records `'reopen'` event and `'month.reopen'` audit log.
- **Blocker 2 (`review_entry_reconciliation_exception`, `1362-1462`):** Restored 6-arg `returns void`, `security definer set search_path = public, pg_temp`, NULL-safe role guard (`1390`), `'422 invalid_action'`, `'422 reason_required'` (no synthetic fallback), `'422 entry_not_found'`, lock order `1001` -> `1002` -> `payables` -> `entries`, `'422 cannot_except_non_active_entry'`, `'422 payable_not_applicable_to_entry'`, `'entry.reconciliation_exception'` audit action.
- **Major 2 (`reconcile_statement`, `1465-1655`):** NULL-safe role guard (`1492`); lock order `1001` -> covered `payables order by p.id asc for key share` -> `statements for update`; Mode A `'422 manual_total_has_lines'` / `'422 expected_poisha_mismatch'`; Mode B Assertions 1–3 without `e.created_at > v_stmt.created_at`; shared `'422 variance_exceeds_tolerance'`; `coalesce(nullif(p_note, ''), note)`.
- **Major 3 (`close_month`, `1658-1781`):** Owner-only (`1682`); lock order `1001` -> early idempotent `return` -> `payables for key share` -> `generate_monthly_settlements`; Gates 1–3 with `'422 unapproved_overpaid_settlement'`; dead Gate 4 and unused locals removed.
- **Minors fixed:** `record_settlement_payment` reversal queries scoped with `center_id = p_center_id` (`518-520`, `532-534`); `0` `;begin`; `0` `row_security`.

### Check 3 — `apps/web/src/lib/database.types.ts` & API Callers — **PASS**
- All 33 non-trigger public RPCs across `005` (18), `006` (14), `007` (1) match `database.types.ts`. `svelte-check` 0 errors / 0 warnings.

### Check 4 — `tests/db/settlement_recon.test.ts` & `tests/db/schema.test.ts` — **PASS (with 1 Minor in `schema.test.ts`)**
- Strong assertions restored in `settlement_recon.test.ts`; `schema.test.ts:304-345` exercises `audit_log_select_policy` via `SET LOCAL ROLE authenticated`.

---

## Remaining Findings (Tracked to `CLT-T-077r3`)

- **Blocker:** `0`.
- **Major (`1`):**
  1. `supabase/migrations/20261029000006_functions_settlement_recon_month.sql:466, 590, 804, 956, 1104, 1221, 1303` — **SQL `NULL`-role authorization bypass in 7 `SECURITY DEFINER` RPCs.** `record_settlement_payment` (`466`), `approve_settlement_overpayment` (`590`), `create_statement` (`804`), `supersede_statement` (`956`), `match_statement_line` (`1104`), `unmatch_statement_line` (`1221`), and `accept_statement_line` (`1303`) evaluate `v_caller_role not in ('admin', 'owner')` or `v_caller_role != 'owner'` without checking `v_caller_role is null` or using `is distinct from`, allowing `NULL` roles (inactive, missing, `super_admin`, or cross-center actors) to silently bypass `'403 unauthorized'` under direct `service_role` calls (Hard Rules 7 & 9).
- **Minor (`3`):**
  1. `supabase/migrations/20261029000006_functions_settlement_recon_month.sql:294, 309` — `fn_settlement_payments_reversal_lock` omits `and center_id = NEW.center_id` on `reverses_payment_id` lookups.
  2. `tests/db/schema.test.ts:339-344` — `audit_log_select_policy` test `finally` runs `ROLLBACK` before `RESET ROLE` / `RESET ALL` without an inner `try/finally`.
  3. `tests/db/settlement_recon.test.ts` — 8 pre-existing ESLint `no-console` warnings; `database.types.ts` formatting deferred to `CLT-T-078`.

## Verbatim Read-Only Verification Summary (`clt_test` SHA-256 Match = true)
- `GREP_004_EXIT=1` (`current_user` = 0), `GREP_006_EXIT=1` (`row_security` = 0), `SEMICOLON_BEGIN_EXIT=1` (`;begin` = 0)
- `tsc --build --dry --verbose packages/calc packages/shared` -> exit 0 (up to date)
- `svelte-check --tsconfig ./tsconfig.json` -> exit 0 (0 errors, 0 warnings)
- `eslint` on TS SCOPE files -> exit 0 (0 errors, 8 pre-existing warnings)
- `prettier --check tests/db/settlement_recon.test.ts tests/db/schema.test.ts` -> exit 0
- Pure non-DB Vitest: `@clt/calc` 14/14, `@clt/shared` 12/12, root sanity/deploy 6/6, `reconcile.test.ts` 16/16 (`48/48` total)
- `clt_test` schema SHA-256: `DISK_SHA256 = DB_SHA256 = 0f153fa3eecbaf9216a82e6e9785f820a8f66c994fff00652bb0f7a38e42a87d` (`HASH_MATCH=true`).

