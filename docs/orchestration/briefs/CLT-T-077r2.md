# Task Brief: CLT-T-077r2

**Assigned to:** `A-IMP-2` (Implementer)
**Date:** 2026-11-11
**Decision authority:** `CLT-D-033`, `CLT-D-034`
**Supersedes:** `CLT-T-077` (`CHANGES REQUESTED` by Independent Auditor `A-AUD-1`: 2 Blockers, 4 Majors)

## Objective

Remediate the 2 Blockers, 4 Majors, and targeted code-hygiene Minors identified by `A-AUD-1` in `004`, `006`, `database.types.ts`, `tests/db/settlement_recon.test.ts`, and `tests/db/schema.test.ts`, restoring full parity with PRD §3 / §7.1 / §7.3, `HEAD` invariants, and existing `/api/v1/*` handlers while preserving all multi-center `p_center_id` scoping and `CLT-T-077` cleanups.

## Allowed SCOPE (edit ONLY these files)

- `supabase/migrations/20261029000004_security_and_rls.sql`
- `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`
- `apps/web/src/lib/database.types.ts`
- `tests/db/settlement_recon.test.ts`
- `tests/db/schema.test.ts`

Do NOT modify API routes (`/api/v1/*`), UI components, `scripts/bootstrap.ts`, `005`, `007`, or any other file outside this list. Do NOT wipe or reset Zia's local dev DB on port `54322`.

## Requirements

### R1 — `supabase/migrations/20261029000004_security_and_rls.sql`

1. **`audit_log_select_policy` (Major 4, PRD §3 line 72, §7.1 line 869):**
   Restrict `SELECT` on `audit_log` for `TO authenticated` to `admin`/`owner` in the current center plus `super_admin`:
   ```sql
   -- audit_log: admin/owner in the center; super_admin sees all
   CREATE POLICY "audit_log_select_policy" ON audit_log FOR SELECT TO authenticated
   USING (
     (
       center_id = COALESCE(
         NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
         (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
       )
       AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
     )
     OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
   );
   ```
2. **`devices_select_policy` (Minor 1):**
   Wrap the `(center_id = COALESCE(...) AND (...))` predicate in outer parentheses before `OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'`.
3. Keep `OR current_user = 'postgres'` completely absent (`0` matches).

### R2 — `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`

Compare `HEAD:supabase/migrations/20261029000006_functions_settlement_recon_month.sql` carefully for every restored guard while keeping `p_center_id` scoping, `(1001 << 16) | (v_center_number & 65535)` / `(1002 << 16) | (v_center_number & 65535)` advisory locks, and `set_config(..., true)` (and keeping `row_security` completely absent):

1. **`record_settlement_payment` (Minor 2):**
   Add `and center_id = p_center_id` to both reversal queries on `settlement_payments` (`where id = p_reverses_id and center_id = p_center_id for update` and `where center_id = p_center_id and reverses_payment_id = p_reverses_id and is_reversal = true`).
2. **`review_entry_reconciliation_exception` (Blocker 2, PRD §7.3 lines 1001–1016, matches `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts`):**
   - Restore the exact 6-parameter signature returning `void`:
     ```sql
     create or replace function review_entry_reconciliation_exception(
       p_center_id uuid,
       p_entry_id uuid,
       p_payable_id uuid,
       p_action text,
       p_reason text,
       p_actor_id uuid
     ) returns void language plpgsql security definer set search_path = public, pg_temp as $$
     ```
   - Verify `centers`, caller `role in ('admin', 'owner')` (`403 unauthorized`).
   - Validate `p_action in ('approved', 'rejected')` (`422 invalid_action`) and `length(trim(coalesce(p_reason, ''))) > 0` (`422 reason_required`). Do NOT invent placeholder text for blank reasons.
   - Derive `v_month := date_trunc('month', entry_date)::date` from `entries where id = p_entry_id and center_id = p_center_id` (`422 entry_not_found`).
   - Acquire Class `1001` month lock, verify month not closed (`422 month_closed`), acquire Class `1002` sequence lock.
   - Lock `payables` (`select kind, method_id ... where id = p_payable_id and center_id = p_center_id for key share`, raising `422 payable_not_found` if null).
   - Lock `entries` (`select status, method_id ... where id = p_entry_id and center_id = p_center_id for update`), assert `v_entry_status = 'active'` (raise `'422 cannot_except_non_active_entry'`), and assert payable applicability:
     `(v_payable_kind = 'vat') or (v_payable_kind = 'method_charge' and v_payable_method_id = v_entry_method_id)` (else raise `'422 payable_not_applicable_to_entry'`).
   - Upsert into `entry_reconciliation_exceptions (center_id, entry_id, payable_id, month, status, reason, reviewed_by, reviewed_at, updated_at)` on conflict `(center_id, entry_id, payable_id, month)` returning `id into v_exception_id`.
   - Note: `trg_entry_exceptions_invalidate_reconciliation` handles cascading `statements` / `statement_payables` from `'approved'` -> `'rejected'`; if needed check lock safety since Class `1001` is already held and trigger updates `statements`/`statement_payables` cleanly after row upsert.
   - Log `audit_log` event `'entry.reconciliation_exception'` (matching `HEAD`).
3. **`reconcile_statement` (Major 2, PRD §7.3 lines 1056–1077, matches `/api/v1/reconcile/statements/reconcile/+server.ts` & `lib/sync/recovery.ts`):**
   - Lock hierarchy: read `v_month` without lock (`422 statement_not_found`), acquire Class `1001` month lock, assert not `'closed'` (`422 month_closed`), lock covered `payables` (`order by p.id asc for key share`), then lock `statements` (`for update`).
   - Assert `v_stmt.status = 'open'` -> else raise `'422 cannot_reconcile_non_open_statement'`.
   - Load `v_tol := coalesce((select reconcile_tolerance_poisha from app_settings where center_id = p_center_id), 100)`.
   - Compute `v_live_expected` across covered `statement_payables` (`center_id = p_center_id`, `entries.center_id = p_center_id`, `status = 'active'`).
   - If `v_stmt.source = 'manual_total'` (Mode A):
     - Assert 0 `statement_lines` for this statement (`422 manual_total_has_lines`).
     - Assert `v_stmt.expected_poisha = v_live_expected` (`422 expected_poisha_mismatch`).
   - Else (Mode B, `source = 'file'`):
     - Remove the broken `e.created_at > v_stmt.created_at` (`snapshot_mismatch_new_entries`) check and instead restore ALL three `HEAD`/PRD assertions scoped with `center_id = p_center_id`:
       - **Assertion 1 (`422 invalid_matched_entry`):** no matched `statement_lines` row references a non-active, wrong-center, wrong-month, or non-applicable entry for this statement's covered payables.
       - **Assertion 2 (`422 unmatched_statement_lines_remain`):** zero `statement_lines` with `match_status = 'unmatched'` remain for `(statement_id, center_id)`.
       - **Assertion 3 (`422 unmatched_entries_without_approved_exceptions`):** every active entry in `p_center_id` and `v_month` generating non-zero liability (`(p.kind = 'vat' and e.vat_poisha > 0)` or `(p.kind = 'method_charge' and p.method_id = e.method_id and e.business_charge_poisha > 0)`) for this statement's payables is either matched to an active line in THIS statement (`sl.center_id = p_center_id and sl.statement_id = p_statement_id and sl.matched_entry_id = e.id and sl.is_active_match = true`) or has an `'approved'` row in `entry_reconciliation_exceptions` (`ere.center_id = p_center_id and ere.entry_id = e.id and ere.payable_id = p.id and ere.month = v_month and ere.status = 'approved'`).
   - **Variance clearance for BOTH Mode A and Mode B:**
     `if abs(v_stmt.statement_total_poisha - v_live_expected) > v_tol and length(trim(coalesce(p_note, ''))) = 0 then raise exception '422 variance_exceeds_tolerance'; end if;`
   - Update `statements` (`status = 'reconciled', expected_poisha = v_live_expected, note = coalesce(nullif(p_note, ''), note), reconciled_by = p_actor_id, reconciled_at = now(), updated_at = now()`) and update `statement_payables` (`status = 'reconciled'` where `statement_id = p_statement_id and center_id = p_center_id`) + `log_audit_event`.
4. **`close_month` (Major 3, PRD §7.3 lines 1035–1047, matches `months/close/+server.ts` & Test #39):**
   - Caller role strictly `'owner'` (`403 unauthorized`).
   - Acquire Class `1001` month lock FIRST.
   - Restore early idempotent return immediately after acquiring the lock (before `generate_monthly_settlements`, `month_close_events`, and `audit_log`):
     ```sql
     if exists (select 1 from month_closes where center_id = p_center_id and month = v_month and status = 'closed') then
       return;
     end if;
     ```
   - Keep `generate_monthly_settlements(p_center_id, v_month)` and due_day update cleanly aligned with lock order (`perform id from payables where center_id = p_center_id order by id asc for key share` BEFORE `generate_monthly_settlements` / `update settlements`).
   - Keep Gate 1 (`422 stale_review_pending`) and Gate 2 (`422 unreconciled_payables_exist`).
   - In Gate 3 (unapproved overpaid settlements): raise **`'422 unapproved_overpaid_settlement'`** (NOT `'409 overpayment_pending_approval'`), matching `months/close/+server.ts:65` and PRD §7.3 line 1045.
   - Remove the dead Gate 4 query (`entry_reconciliation_exceptions ... status = 'pending'`) and unused local variables.
   - Keep `month_closes` upsert, `month_close_events` insert, and `log_audit_event`.
5. **`reopen_month` (Blocker 1 & Major 1, PRD §3 line 64, §7.3 lines 1048–1055, matches `months/reopen/+server.ts`):**
   - Caller role **Owner only**:
     ```sql
     if v_caller_role is distinct from 'owner' then
       raise exception '403 unauthorized';
     end if;
     ```
   - Assert non-empty `p_reason` (`422 reason_required`).
   - Acquire Class `1001` month lock.
   - Assert `exists (select 1 from month_closes where center_id = p_center_id and month = v_month and status = 'closed')` -> else raise **`'422 month_not_closed'`** (covers both non-existent and already-`'open'` rows cleanly per PRD §7.3 line 1052 & `reopen/+server.ts:61`).
   - Update `month_closes` (`status = 'open'`).
   - **Restore statement invalidation cascade:**
     ```sql
     update statements set status = 'open', updated_at = now()
     where center_id = p_center_id and month = v_month and status = 'reconciled';

     update statement_payables set status = 'open'
     where center_id = p_center_id and month = v_month and status = 'reconciled';
     ```
   - Insert `month_close_events` (`'reopen'`) and `log_audit_event` (`'month.reopen'`).
6. Clean `;begin` typos and unused local variables across `006` (Minor 4).

### R3 — `apps/web/src/lib/database.types.ts`

Update `review_entry_reconciliation_exception` under `Database['public']['Functions']` to match the restored SQL RPC exactly:
```ts
review_entry_reconciliation_exception: {
  Args: {
    p_center_id: string
    p_entry_id: string
    p_payable_id: string
    p_action: string
    p_reason: string
    p_actor_id: string
  }
  Returns: undefined
}
```
Verify no other function signatures in `database.types.ts` disagree with `005` / `006` / `007`.

### R4 — `tests/db/settlement_recon.test.ts`

Restore the weakened/mutated assertions and strengthen test coverage:
1. Overpayment Gate 3 tests (lines ~340 and ~570): update expected error from `'409 overpayment_pending_approval'` back to `'422 unapproved_overpaid_settlement'`.
2. **`Test #7` / statement invalidation:** verify that calling `reopen_month` cascades any `'reconciled'` `statements` and `statement_payables` in that center+month back to `'open'`, and rejects `ADMIN_ID` and `STAFF_ID` with `'403 unauthorized'`.
3. **`Test #37: Scoped Exception Isolation Across Payables` (lines ~631–689):**
   - Update both `review_entry_reconciliation_exception` call sites in the file (`Test #37` and the approved->rejected cascade test around lines ~1036 & ~1082) to the 6-arg signature `(p_center_id, p_entry_id, p_payable_id, p_action, p_reason, p_actor_id)`.
   - Restore the true PRD/HEAD negative assertion in `Test #37`: reconciling the VAT statement when `entryId`'s VAT liability is uncovered (exception was only approved for bKash) MUST fail with `'422 unmatched_entries_without_approved_exceptions'`.
   - Also cover `'422 cannot_except_non_active_entry'` and `'422 payable_not_applicable_to_entry'`.
4. **`Test #39` idempotency:** verify calling `close_month` twice leaves `month_closes.status = 'closed'` AND writes only `1` `'close'` event in `month_close_events`.
5. **`Test #40`:** update expected error from `'422 reconciliation_tolerance_exceeded'` back to `'422 variance_exceeds_tolerance'`. Add coverage verifying Mode A `'422 expected_poisha_mismatch'` (e.g., if a live active entry changes expected liability after statement creation without note/recreation).
6. **`Test Role Gates` (lines ~1291–1313):** restore `ADMIN_ID` rejection check (`'403 unauthorized'`) on `close_month` alongside `STAFF_ID`, and add `ADMIN_ID` and `STAFF_ID` rejection checks (`'403 unauthorized'`) on `reopen_month` (fixing the inaccurate comment `(only admin/owner can close)` -> Owner only).

### R5 — `tests/db/schema.test.ts`

Add a focused RLS check under `authenticated` verifying `audit_log_select_policy` blocks `staff` in the center (`0` rows returned when JWT `app_metadata.role = 'staff'`, wrapped cleanly in transaction/reset just like `Test #30`) while allowing `admin`/`owner` in the center (and keeping `Test #30` reset semantics clean).

## Verification Required Before Reporting DONE

Run and paste verbatim output (never touch port `54322`):
1. `grep -n "current_user" supabase/migrations/20261029000004_security_and_rls.sql` (exit 1 / 0 matches) and `grep -n "row_security" supabase/migrations/20261029000006_functions_settlement_recon_month.sql` (exit 1 / 0 matches)
2. `pnpm test` (`clt_test` throwaway DB — all test files except opted-out `bootstrap.test.ts` pass)
3. `pnpm typecheck` (`0` errors)
4. `pnpm exec prettier --check` & `pnpm exec eslint` on all 5 SCOPE files
5. Run a read-only SQL check against `clt_test` verifying `review_entry_reconciliation_exception` has 6 args `(uuid, uuid, uuid, text, text, uuid)` returning `void` and `reopen_month` has no `'admin'`.

