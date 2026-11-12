# CLT-T-071 — Multi-Center Row-Level Multi-Tenancy Baseline DDL, Functions, RLS, and Day-Zero Center Provisioning

Scheduled: 2026-11-08. Origin: Owner Decision `CLT-D-030`, approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md`, and Orchestrator Skeptic Audit of `CLT-T-065` report. Re-issued under task ID `CLT-T-071` to resolve ledger sequence collision with pre-existing chat-authorised tasks `CLT-T-065`..`CLT-T-070`.

Audited and approved:
1. Hard Rule 18 decision granted by Zia: Local dev DB reset is authorized (`127.0.0.1:54322`).
2. Exact table count corrected to 20 tables.
3. Schema column names verified against PostgreSQL metadata: `payables.due_day`, `app_settings.reconcile_tolerance_poisha`, `rate_profiles.charges_borne_by = 'business'`.
4. `audit_log` remains an unpartitioned append-only table with `center_id UUID NULL REFERENCES centers(id)`.
5. Canonical constraint names preserved (`one_owner`, `uq_active_vat_payable`, `uq_active_method_payable`).

---

=== TASK BRIEF ===
TASK ID:         CLT-T-071
TITLE:           Rewrite migrations 001-007 for multi-center row-level multi-tenancy baseline
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      none
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§1–§5), docs/plans/PRD-payment-ledger-app.md (§7, §15), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030)
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
Zia and the Orchestrator completed the skeptic audit of your CLT-T-065 report. All findings were independently verified against PostgreSQL live metadata and confirmed. Zia has formally authorized wiping the 14 single-tenant test entries on the local development database to establish the clean multi-tenant baseline (Option A).
This re-issued brief (CLT-T-071, replacing CLT-T-065 to resolve a task ID collision) incorporates the verified column names, exact 20-table count, unpartitioned append-only audit_log, and canonical constraint names.

OBJECTIVE
Rewrite database migrations 001–007 to establish the multi-center schema, composite foreign keys, 64-bit injective advisory locks, RLS policies, center-scoped functions/triggers, and the atomic center provisioning procedure rpc_create_center.

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
- Do not alter integer poisha arithmetic or financial invariants.

INPUTS (read these first)
- docs/designs/multi_center_row_level_multitenancy.md (§1–§5)
- AGENTS.md (Hard Rules 1–20)
- Current supabase/migrations/20261029000001_core_schema.sql through 20261029000006_functions_settlement_recon_month.sql

REQUIREMENTS (numbered; each is testable)
R1. In `20261029000001_core_schema.sql`, create root `centers` table:
    ```sql
    CREATE TABLE centers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      center_number INT GENERATED ALWAYS AS IDENTITY UNIQUE,
      code VARCHAR(8) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,8}$'),
      name TEXT NOT NULL,
      legal_entity_name TEXT NOT NULL,
      bin_number VARCHAR(16),
      trade_license_number VARCHAR(32),
      vat_circle TEXT,
      address TEXT NOT NULL,
      phone VARCHAR(20) NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION fn_centers_prevent_code_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.code <> OLD.code THEN
        RAISE EXCEPTION 'centers.code is immutable once provisioned';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_centers_immutable_code
    BEFORE UPDATE ON centers
    FOR EACH ROW EXECUTE FUNCTION fn_centers_prevent_code_mutation();
    ```

R2. In `20261029000001_core_schema.sql`, create `center_counters` table:
    ```sql
    CREATE TABLE center_counters (
      center_id UUID PRIMARY KEY REFERENCES centers(id) ON DELETE CASCADE,
      next_entry_number BIGINT NOT NULL DEFAULT 1
    );
    ```

R3. In `20261029000001_core_schema.sql`, add `center_id` across core schema:
    - Extend `user_role` enum: `CREATE TYPE user_role AS ENUM ('super_admin', 'owner', 'admin', 'staff');`
    - `profiles`: `center_id UUID NULL REFERENCES centers(id)` (NULL strictly for `role = 'super_admin'`), `role user_role NOT NULL DEFAULT 'staff'`.
      Canonical unique index: `CREATE UNIQUE INDEX one_owner ON profiles (center_id) WHERE role = 'owner' AND active = true;`
      Composite unique key: `UNIQUE (center_id, id)`
    - `devices`: `center_id UUID NOT NULL REFERENCES centers(id)`, `CONSTRAINT uq_devices_device_user UNIQUE (center_id, device_id, user_id)`.
      Composite FK: `FOREIGN KEY (center_id, user_id) REFERENCES profiles(center_id, id) ON DELETE CASCADE`
    - `payment_methods`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, code)`
    - `rate_profiles`: `center_id UUID NOT NULL REFERENCES centers(id)`, `charges_borne_by TEXT NOT NULL DEFAULT 'business' CHECK (charges_borne_by IN ('business', 'customer'))`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, version) WHERE status = 'published'`, exclusion constraint on published date ranges per center:
      `EXCLUDE USING gist (center_id WITH =, daterange(effective_from, COALESCE(lead(effective_from) OVER (PARTITION BY center_id ORDER BY effective_from), 'infinity'::date), '[)') WITH &&) WHERE (status = 'published')`
    - `method_rates`: `center_id UUID NOT NULL REFERENCES centers(id)`, `PRIMARY KEY (rate_profile_id, method_id)`, composite foreign keys:
      `FOREIGN KEY (center_id, rate_profile_id) REFERENCES rate_profiles(center_id, id) ON DELETE CASCADE`
      `FOREIGN KEY (center_id, method_id) REFERENCES payment_methods(center_id, id) ON DELETE RESTRICT`
    - `entries`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, entry_number)`.
      Composite FKs:
      `FOREIGN KEY (center_id, method_id) REFERENCES payment_methods(center_id, id)`
      `FOREIGN KEY (center_id, rate_profile_id) REFERENCES rate_profiles(center_id, id)`
      `FOREIGN KEY (center_id, created_by) REFERENCES profiles(center_id, id)`
    - `payables`: `center_id UUID NOT NULL REFERENCES centers(id)`, `due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 28)`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, code)`.
      Canonical indexes:
      `CREATE UNIQUE INDEX uq_active_vat_payable ON payables (center_id, kind) WHERE kind = 'vat' AND active = true;`
      `CREATE UNIQUE INDEX uq_active_method_payable ON payables (center_id, method_id) WHERE kind = 'method_charge' AND active = true;`
    - `entry_reconciliation_exceptions`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, entry_id, payable_id, month)`.
      Composite FKs:
      `FOREIGN KEY (center_id, entry_id) REFERENCES entries(center_id, id) ON DELETE RESTRICT`
      `FOREIGN KEY (center_id, payable_id) REFERENCES payables(center_id, id) ON DELETE RESTRICT`

R4. In `20261029000002_settlements_and_statements.sql`, add `center_id UUID NOT NULL REFERENCES centers(id)` across operational tables:
    - `settlements`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, payable_id, month)`.
      Composite FK: `FOREIGN KEY (center_id, payable_id) REFERENCES payables(center_id, id) ON DELETE RESTRICT`
    - `settlement_payments`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`.
      Composite FK: `FOREIGN KEY (center_id, settlement_id) REFERENCES settlements(center_id, id) ON DELETE RESTRICT`
    - `statements`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`, `UNIQUE (center_id, id, month)`
    - `statement_payables`: `center_id UUID NOT NULL REFERENCES centers(id)`, `PRIMARY KEY (statement_id, payable_id)`.
      Composite FKs:
      `FOREIGN KEY (center_id, statement_id, month) REFERENCES statements(center_id, id, month) ON DELETE RESTRICT`
      `FOREIGN KEY (center_id, payable_id) REFERENCES payables(center_id, id) ON DELETE RESTRICT`
    - `statement_lines`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, id)`.
      Composite FKs:
      `FOREIGN KEY (center_id, statement_id) REFERENCES statements(center_id, id) ON DELETE RESTRICT`
      `FOREIGN KEY (center_id, matched_entry_id) REFERENCES entries(center_id, id) ON DELETE RESTRICT`
    - `month_closes`: `center_id UUID NOT NULL REFERENCES centers(id)`, `PRIMARY KEY (center_id, month)`
    - `month_close_events`: `center_id UUID NOT NULL REFERENCES centers(id)`, composite FK `FOREIGN KEY (center_id, month) REFERENCES month_closes(center_id, month)`
    - `sync_ops`: `center_id UUID NOT NULL REFERENCES centers(id)`, `UNIQUE (center_id, op_id)`
    - `app_settings`: `center_id UUID PRIMARY KEY REFERENCES centers(id) ON DELETE CASCADE`, `reconcile_tolerance_poisha BIGINT NOT NULL DEFAULT 100`, `net_label TEXT NOT NULL DEFAULT 'Net after deductions'`, `timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka'`, `currency TEXT NOT NULL DEFAULT 'BDT'`, `locale TEXT NOT NULL DEFAULT 'en-BD'`.
    - `audit_log`: Keep as standard append-only table (NO range partitioning). Add `center_id UUID NULL REFERENCES centers(id)` (NULL strictly for super_admin platform events). Index: `CREATE INDEX idx_audit_log_center_at ON audit_log (center_id, at DESC);`

R5. In `20261029000003_views.sql`, update views to include `center_id`:
    - `v_monthly_totals`: add `center_id`, group by `center_id, 1`.
    - `v_monthly_method_charges`: add `center_id`, group by `center_id, 1, 2`.
    - `v_staff_personal_metrics`: add `center_id`, group by `center_id, created_by`.
    - `view_device_stale_rate_anomalies`: add `center_id`, group by `so.center_id, so.device_id, so.actor_id`.

R6. In `20261029000004_security_and_rls.sql`:
    - Revoke write privileges on ALL 20 public tables from `anon, authenticated`:
      `centers, center_counters, profiles, devices, payment_methods, rate_profiles, method_rates, entries, payables, entry_reconciliation_exceptions, settlements, settlement_payments, statements, statement_payables, statement_lines, month_closes, month_close_events, audit_log, sync_ops, app_settings`.
    - Execute `ALTER TABLE <tablename> FORCE ROW LEVEL SECURITY;` on all 20 tables.
    - Multi-tenant policy predicate:
      ```sql
      center_id = COALESCE(
        NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
      )
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
      ```
    - `centers` policy: users can SELECT their own center (`id = COALESCE(...)`); `super_admin` can SELECT all.
    - `profiles` policy: users can SELECT profiles matching their `center_id` OR `id = auth.uid()`; `super_admin` can SELECT all.
    - `audit_log` policy: users can SELECT rows matching their `center_id`; `super_admin` can SELECT all.

R7. In `20261029000005_functions_entries_rates_sync.sql` & `000006`, implement 64-bit injective advisory locks:
    - Month lock: `PERFORM pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), (v_year * 12 + v_month));`
    - Sequence lock: `PERFORM pg_advisory_xact_lock((1002 << 16) | (v_center_number & 65535), 1);`
    - Rate version lock: `PERFORM pg_advisory_xact_lock((1003 << 16) | (v_center_number & 65535), 1);`

R8. In `20261029000005_functions_entries_rates_sync.sql`:
    - `rpc_push_sync_op` accepts `p_center_id UUID`. Sets `PERFORM set_config('clt.current_center_id', p_center_id::text, true);`.
    - Sequence generation: Under sequence lock `(1002, center_number)`, updates `center_counters.next_entry_number` for `p_center_id`, and formats human-readable ID `E-{CENTER_CODE}-YYYYMM-XXXXXX` (where center code is queried from `centers.code`).
    - Rate validation: Looks up active rate profile matching `center_id = p_center_id`.
    - Fold `rpc_supersede_entry` from `20261107000001_fix_supersede_reassign.sql` with `p_center_id` parameter and validation.
    - Fold `maintenance_purge_entries` from `20261108000001_maintenance_purge_entries.sql` with `p_center_id` parameter and validation.
    - Delete `20261107000001_fix_supersede_reassign.sql` and `20261108000001_maintenance_purge_entries.sql`.

R9. In `20261029000006_functions_settlement_recon_month.sql`:
    - Trigger `fn_entries_recalc_settlements` strictly scoped: `WHERE center_id = NEW.center_id`.
    - `generate_monthly_settlements(p_center_id UUID, p_month DATE)`.
    - `record_settlement_payment(..., p_center_id UUID)`.
    - `close_month(p_center_id UUID, p_month DATE, p_actor UUID)` and `reopen_month(...)` take 64-bit injective month lock for `(center_number, year, month)`.
    - Mode B statement line auto-matching scoped to `center_id`.

R10. Create `20261029000007_center_provisioning.sql`:
    - Author `rpc_create_center(...)` per `docs/designs/multi_center_row_level_multitenancy.md` §5 with verified column names:
      1. Insert into `centers (code, name, legal_entity_name, bin_number, trade_license_number, address, phone)`
      2. Insert into `payment_methods (center_id, name, code, requires_txn_ref)`: Cash (false), bKash (true), Visa (true), Mastercard (true).
      3. Insert into `payables (center_id, name, code, kind, method_id, due_day)`:
         - Government VAT (`kind = 'vat'`, `method_id = NULL`, `due_day = 15`)
         - bKash Merchant Charges (`kind = 'method_charge'`, `method_id = v_bkash_id`, `due_day = 10`)
         - Card Processing Charges (`kind = 'method_charge'`, `method_id = v_visa_id`, `due_day = 10`)
      4. Insert into `rate_profiles (center_id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)`:
         `version = 1, status = 'published', effective_from = '2026-01-01', vat_mode = 'manual', vat_bp = 0, commission_bp = 4200, commission_base = 'gross', charges_borne_by = 'business'`.
      5. Insert into `method_rates (center_id, rate_profile_id, method_id, charge_bp)`:
         Cash (0 bp), bKash (115 bp), Visa (150 bp), Mastercard (150 bp).
      6. Insert into `app_settings (center_id, reconcile_tolerance_poisha, net_label)`: `100, 'Net after deductions'`.
      7. Insert into `center_counters (center_id, next_entry_number) VALUES (v_center_id, 1);`.

R11. Update `tests/db/helpers/test-db.ts`:
    - In `PRELUDE_SQL` or initial seed, insert a default test center:
      `id: '00000000-0000-0000-0000-000000000001', code: 'MHK', name: 'Mohakhali Center', legal_entity_name: 'Mohakhali Learning Center Ltd', address: 'Mohakhali, Dhaka', phone: '01700000000'`.
      Initialize `center_counters (center_id, next_entry_number) VALUES ('00000000-0000-0000-0000-000000000001', 1)`.

R12. Update `tests/db/schema.test.ts`:
    - Include `center_id: '00000000-0000-0000-0000-000000000001'` in all prerequisite and invariant test seeds (`payment_methods`, `payables`, `rate_profiles`, `method_rates`, `entries`, `settlements`, `devices`, etc.).
    - Assert that multi-tenant constraints (`one_owner`, `uq_active_vat_payable`, `code` uniqueness per center, composite FKs) enforce isolation.

HARD RULES THAT APPLY (AGENTS.md)
- Rule 1: Never hardcode rates; fetch from published rate_profiles effective on entry_date.
- Rule 2: Money is integer poisha. No floats anywhere in money paths.
- Rule 3: packages/calc remains pure and tenant-agnostic.
- Rule 4: Entries are immutable.
- Rule 5: Every state change writes an audit_log row inside the same transaction.
- Rule 7: Security Definer RPCs under service_role; FORCE RLS on all 20 tables.
- Rule 10: Respect lock hierarchy: (1001) Month Lock -> (1002) Sequence Lock -> (1003) Rate Lock -> Row locks.
- Rule 18: Reset of local dev DB (127.0.0.1:54322) is AUTHORIZED by Zia.

ACCEPTANCE CRITERIA
A1. `pnpm db:reset` succeeds with exit 0 on `127.0.0.1:54322`, applying migrations 001–007 cleanly with zero errors.
A2. Hotfix migrations `20261107000001_fix_supersede_reassign.sql` and `20261108000001_maintenance_purge_entries.sql` are removed from `supabase/migrations/`.
A3. `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'` returns exactly 20 tables, including `centers` and `center_counters`.
A4. `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'entries'` returns `t, t`.
A5. `npx vitest run tests/db/schema.test.ts` executes and passes 100% of tests.

VERIFICATION (run in order; paste output)
1. `rm -f supabase/migrations/20261107000001_fix_supersede_reassign.sql supabase/migrations/20261108000001_maintenance_purge_entries.sql`
2. `pnpm db:reset`
3. `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"`
4. `npx vitest run tests/db/schema.test.ts`
5. `git status`

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

