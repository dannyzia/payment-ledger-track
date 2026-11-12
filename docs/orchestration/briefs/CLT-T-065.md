# CLT-T-065 — Multi-Center Row-Level Multi-Tenancy Baseline DDL, Functions, RLS, and Day-Zero Center Provisioning

Scheduled: 2026-11-08. Origin: Owner Decision `CLT-D-030` and approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md`.

Belongs to: **Phase 1 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-065
TITLE:           Rewrite migrations 001-007 for multi-center row-level multi-tenancy baseline
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      none
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§1–§5, §2.A File Inventory), docs/plans/PRD-payment-ledger-app.md (§7, §15), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030)
OS / SHELL:      Ubuntu 24.04 / bash (Node 22 LTS, corepack pnpm)

You are A-IMP-1, role Implementer, working on the project "Kumon Ledger Track" at /home/zia/Documents/My Projects/Cosmo_Ledger_Track.
You have no memory of earlier work. Everything you need is in this brief and the files it lists.
1. Read the project context file (AGENTS.md) before anything else. Its hard rules
   override this brief. If they conflict with this brief, stop and report BLOCKED.
2. Do exactly what this brief says. Do no extra work. Do not refactor, rename, or reformat
   anything not listed under SCOPE.
3. Touch only the files listed under SCOPE. If you need another file, stop and report BLOCKED.
4. Do not invent facts, numbers, prices, terms, or laws. If you do not know, write UNKNOWN
   and say exactly what is needed.
5. Run every step under VERIFICATION and paste the real output. Never write "should work"
   or "tests pass" without pasted output.
6. Never print, store, or request secrets, credentials, or personal data.
7. If anything is ambiguous, stop and put exactly one question under QUESTIONS in your
   report. Do not guess.
8. If you cannot complete a step, report BLOCKED with the reason. Do not improvise a
   workaround.
9. Finish by writing the TASK REPORT in the exact format given at the end of this brief.

CONTEXT
Cosmo / Kumon Ledger Track is transitioning to serve multiple independent Kumon franchise learning centers (Mohakhali, Rampura, Iqbal Road, etc.) in a single shared PostgreSQL database. Each center is an autonomous business with independent bank and bKash merchant accounts, localized staff, and dedicated rates.
Per approved technical design specification `docs/designs/multi_center_row_level_multitenancy.md` and owner decision `CLT-D-030`, we execute a clean declarative rewrite of baseline database migrations (001–006) for V1 rather than accumulating schema debt through additive pre-production patches.
Legacy hotfix files `supabase/migrations/20261107000001_fix_supersede_reassign.sql` and `supabase/migrations/20261108000001_maintenance_purge_entries.sql` are deleted and folded directly into the clean baseline routines with center scoping.

OBJECTIVE
Rewrite database migrations 001–007 to establish the multi-center schema, composite foreign keys, 64-bit injective advisory locks, RLS policies, center-scoped functions/triggers, and the atomic center provisioning procedure `rpc_create_center`.

SCOPE (the ONLY files you may create or modify)
- supabase/migrations/20261029000001_core_schema.sql — modify (rewrite)
- supabase/migrations/20261029000002_settlements_and_statements.sql — modify (rewrite)
- supabase/migrations/20261029000003_views.sql — modify (rewrite)
- supabase/migrations/20261029000004_security_and_rls.sql — modify (rewrite)
- supabase/migrations/20261029000005_functions_entries_rates_sync.sql — modify (rewrite)
- supabase/migrations/20261029000006_functions_settlement_recon_month.sql — modify (rewrite)
- supabase/migrations/20261029000007_center_provisioning.sql — create
- supabase/migrations/20261107000001_fix_supersede_reassign.sql — delete (folded into 000005)
- supabase/migrations/20261108000001_maintenance_purge_entries.sql — delete (folded into 000005)
- tests/db/helpers/test-db.ts — modify
- tests/db/schema.test.ts — modify

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc, packages/shared, or any file under apps/web/.
- Do not modify scripts/bootstrap.ts (handled in Phase 6).
- Do not invent new rate fixtures or alter integer poisha arithmetic.

INPUTS (read these first)
- docs/designs/multi_center_row_level_multitenancy.md (whole file, technical plan and schema tables)
- AGENTS.md (Hard Rules 1–20)
- supabase/migrations/20261029000001_core_schema.sql through 20261029000006_functions_settlement_recon_month.sql

REQUIREMENTS (numbered; each is testable)
R1. In `20261029000001_core_schema.sql`, create root `centers` table:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `center_number INT GENERATED ALWAYS AS IDENTITY UNIQUE`
    - `code VARCHAR(8) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,8}$')`
    - `name TEXT NOT NULL`
    - `legal_entity_name TEXT NOT NULL`
    - `bin_number VARCHAR(16)`
    - `trade_license_number VARCHAR(32)`
    - `vat_circle TEXT`
    - `address TEXT NOT NULL`
    - `phone VARCHAR(20) NOT NULL`
    - `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived'))`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - Add trigger `trg_centers_immutable_code` raising an exception if `NEW.code <> OLD.code`.
R2. In `20261029000001_core_schema.sql`, create `center_counters` table:
    - `center_id UUID PRIMARY KEY REFERENCES centers(id) ON DELETE CASCADE`
    - `next_entry_number BIGINT NOT NULL DEFAULT 1`
R3. In `20261029000001_core_schema.sql`, add `center_id` across core schema:
    - `profiles`: `center_id UUID NULL REFERENCES centers(id)` (NULL strictly for role `super_admin`), `role TEXT CHECK (role IN ('super_admin', 'owner', 'admin', 'staff'))`, unique constraint `CREATE UNIQUE INDEX uq_one_owner ON profiles (center_id) WHERE role = 'owner' AND active = true;`.
    - `payment_methods`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE(center_id, id)`, `UNIQUE(center_id, code)`.
    - `payables`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE(center_id, id)`, `UNIQUE(center_id, code)`, `CREATE UNIQUE INDEX uq_one_vat_payable ON payables (center_id) WHERE kind = 'vat' AND active = true;`.
    - `rate_profiles`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE(center_id, id)`, `UNIQUE(center_id, version) WHERE status = 'published'`, exclusion constraint `EXCLUDE USING gist (center_id WITH =, ...)` for published date ranges.
    - `method_rates`: `center_id UUID NOT NULL REFERENCES centers(id)`, `PRIMARY KEY (rate_profile_id, method_id)`, composite foreign keys `FOREIGN KEY (center_id, rate_profile_id) REFERENCES rate_profiles(center_id, id)`, `FOREIGN KEY (center_id, method_id) REFERENCES payment_methods(center_id, id)`.
R4. In `20261029000002_settlements_and_statements.sql`, add `center_id UUID NOT NULL REFERENCES centers(id)` across all operational tables:
    - `entries`: `UNIQUE(center_id, id)`, `UNIQUE(center_id, entry_number)`. Composite FKs to `payment_methods(center_id, method_id)`, `profiles(center_id, created_by)`, `rate_profiles(center_id, rate_profile_id)`.
    - `entry_reconciliation_exceptions`: `PRIMARY KEY (center_id, entry_id, payable_id)`, composite FKs to `entries(center_id, entry_id)` and `payables(center_id, payable_id)`.
    - `settlements`: `UNIQUE(center_id, id)`, `UNIQUE(center_id, payable_id, month)`, composite FK to `payables(center_id, payable_id)`.
    - `settlement_payments`: `UNIQUE(center_id, id)`, composite FK to `settlements(center_id, settlement_id)`.
    - `statements`: `UNIQUE(center_id, id)`.
    - `statement_payables`: `PRIMARY KEY (statement_id, payable_id)`, composite FKs to `statements(center_id, statement_id)` and `payables(center_id, payable_id)`.
    - `statement_lines`: `UNIQUE(center_id, id)`, `UNIQUE(statement_id, line_index)`, composite FKs to `statements(center_id, statement_id)` and `entries(center_id, matched_entry_id)`.
    - `month_closes`: `PRIMARY KEY (center_id, month)`.
    - `month_close_events`: composite FK to `month_closes(center_id, month)`.
    - `sync_ops`: `UNIQUE(center_id, op_id)`.
    - `devices`: `UNIQUE(center_id, device_id, user_id)`, composite FK to `profiles(center_id, user_id)`.
    - `app_settings`: `PRIMARY KEY (center_id)`.
    - `audit_log`: Range-partitioned by month, with `center_id UUID NULL REFERENCES centers(id)` (NULL strictly for platform events).
R5. In `20261029000003_views.sql`, update views:
    - Include `center_id` in `view_device_stale_rate_anomalies`, `v_monthly_totals`, `v_monthly_method_charges`, `v_staff_personal_metrics`.
    - `v_monthly_totals`: `GROUP BY center_id, 1`.
    - `v_monthly_method_charges`: `GROUP BY center_id, 1, 2`.
    - `v_staff_personal_metrics`: `GROUP BY center_id, created_by`.
R6. In `20261029000004_security_and_rls.sql`:
    - Revoke direct write access on ALL tables from `anon, authenticated`.
    - Execute `ALTER TABLE ... FORCE ROW LEVEL SECURITY` across all 19 tables (`centers`, `center_counters`, `profiles`, `payment_methods`, `payables`, `rate_profiles`, `method_rates`, `entries`, `entry_reconciliation_exceptions`, `settlements`, `settlement_payments`, `statements`, `statement_payables`, `statement_lines`, `month_closes`, `month_close_events`, `sync_ops`, `devices`, `app_settings`).
    - Define tenant isolation policy predicate:
      ```sql
      center_id = COALESCE(
        NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
      )
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
      ```
    - RLS on `centers`: users can SELECT their own assigned center; `super_admin` can SELECT all centers.
    - RLS on `profiles`: users can SELECT profiles in their center; user can SELECT self; `super_admin` can SELECT all.
    - RLS on `audit_log`: users can SELECT logs for their center; `super_admin` can SELECT all.
R7. In `20261029000005_functions_entries_rates_sync.sql` & `000006`, implement 64-bit injective coordinate advisory locks:
    - Month lock: `PERFORM pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), (v_year * 12 + v_month));`
    - Sequence lock: `PERFORM pg_advisory_xact_lock((1002 << 16) | (v_center_number & 65535), 1);`
    - Rate version lock: `PERFORM pg_advisory_xact_lock((1003 << 16) | (v_center_number & 65535), 1);`
R8. In `20261029000005_functions_entries_rates_sync.sql`:
    - `rpc_push_sync_op` accepts `p_center_id UUID`. Sets session config `SET LOCAL clt.current_center_id = p_center_id::text;`.
    - Sequence generation: Acquires injective sequence lock, increments `center_counters.next_entry_number` for `p_center_id`, and formats human-readable ID `E-{CENTER_CODE}-YYYYMM-XXXXXX` (where center code is queried from `centers.code`).
    - Rate validation: Looks up active rate profile strictly matching `center_id = p_center_id`.
    - Fold `rpc_supersede_entry` from `20261107000001_fix_supersede_reassign.sql` with `center_id` validation.
    - Fold `maintenance_purge_entries` from `20261108000001_maintenance_purge_entries.sql` with `center_id` scoping and delete both hotfix files.
R9. In `20261029000006_functions_settlement_recon_month.sql`:
    - Trigger `fn_entries_recalc_settlements` strictly scoped: `WHERE center_id = NEW.center_id`.
    - `generate_monthly_settlements(p_center_id UUID, p_month DATE)`.
    - `record_settlement_payment(..., p_center_id UUID)`.
    - `close_month(p_center_id UUID, p_month DATE, p_actor UUID)` and `reopen_month(...)` take 64-bit injective month lock for `(center_number, year, month)`.
    - Mode B statement line auto-matching scoped to `center_id`.
R10. Create `20261029000007_center_provisioning.sql`:
    - Author `rpc_create_center(...)` per `docs/designs/multi_center_row_level_multitenancy.md` §5.
    - Atomically creates: `centers` row, default payment methods (`cash`, `bkash`, `visa`, `mastercard`), default payables (`vat`, `bkash_charge`, `card_charge`), published Rate Profile v1 (`vat_mode = 'manual'`, `vat_bp = 0`, `commission_bp = 4200`, `commission_base = 'gross'`), default method rates (0 bp cash, 115 bp bkash, 150 bp cards), `app_settings` (100 poisha tolerance, default due day 15), and initializes `center_counters` (`next_entry_number = 1`).
R11. Update `tests/db/helpers/test-db.ts`:
    - In `PRELUDE_SQL` or initial seed, insert a default test center:
      `id: '00000000-0000-0000-0000-000000000001', code: 'MHK', name: 'Mohakhali Center', legal_entity_name: 'Mohakhali Learning Center Ltd', address: 'Mohakhali, Dhaka', phone: '01700000000'`.
      Initialize `center_counters` with `next_entry_number = 1`.
R12. Update `tests/db/schema.test.ts`:
    - Include `center_id: '00000000-0000-0000-0000-000000000001'` in all prerequisite and invariant test seeds (`payment_methods`, `payables`, `rate_profiles`, `method_rates`, `entries`, `settlements`, `devices`, etc.).
    - Assert that multi-tenant unique constraints (`uq_one_owner`, `code` uniqueness per center, composite FKs) enforce isolation.

HARD RULES THAT APPLY (AGENTS.md)
- Rule 1: Never hardcode rates; fetch from published rate_profiles effective on entry_date.
- Rule 2: Money is integer poisha. No floats anywhere in money paths.
- Rule 3: packages/calc remains pure and tenant-agnostic.
- Rule 4: Entries are immutable.
- Rule 5: Every state change writes an audit_log row inside the same transaction.
- Rule 7: Security Definer RPCs under service_role; FORCE RLS on all 19 tables.
- Rule 10: Respect lock hierarchy: (1001) Month Lock -> (1002) Sequence Lock -> (1003) Rate Lock -> Row locks.
- Rule 18: No destructive commands unless exact target approved.

ACCEPTANCE CRITERIA
A1. `pnpm db:reset` succeeds with exit 0, applying migrations 001–007 cleanly with zero errors.
A2. Hotfix migrations `20261107000001_fix_supersede_reassign.sql` and `20261108000001_maintenance_purge_entries.sql` are removed from `supabase/migrations/`.
A3. `SELECT tablename FROM pg_tables WHERE schemaname = 'public'` contains `centers` and `center_counters`.
A4. `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'entries'` returns `t, t`.
A5. `npx vitest run tests/db/schema.test.ts` executes and passes 100% of tests.

VERIFICATION (run in order; paste output)
1. `rm -f supabase/migrations/20261107000001_fix_supersede_reassign.sql supabase/migrations/20261108000001_maintenance_purge_entries.sql`
2. `pnpm db:reset`
3. `npx vitest run tests/db/schema.test.ts`
4. `git status`

STOP CONDITIONS (stop and report BLOCKED if)
- PostgreSQL reports syntax errors or dependency cycle errors when running migrations.
- `pnpm db:reset` fails to connect or fails migration execution.

REPORT FORMAT: TASK REPORT (below). Return it to the Orchestrator via Zia.
=== END BRIEF ===

=== TASK REPORT ===
TASK ID:
AGENT ID:
STATUS:          DONE | PARTIAL | BLOCKED | FAILED
SUMMARY:         <max 5 lines>
FILES CHANGED:   <path — create/modify/delete — one-line reason>
COMMANDS RUN:    <each command, then the real output (trim to 40 lines; save longer logs to
                  docs/orchestration/reports/<TASK ID>.log and give the path)>
ACCEPTANCE:      A1 PASS|FAIL — evidence | A2 ... (every criterion listed)
DEVIATIONS:      <anything done differently from the brief, and why; "none" if none>
ASSUMPTIONS:     <list; "none" if none>
OPEN ISSUES:     <list; "none" if none>
QUESTIONS:       <exactly one, or "none">
=== END REPORT ===

