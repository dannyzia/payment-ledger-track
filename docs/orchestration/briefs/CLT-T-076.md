# CLT-T-076 — Bootstrap Script, Multi-Tenant Database Test Harness & Isolation Test Suites

Scheduled: 2026-11-09. Origin: Approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md` (§8 Verification & Zero Data Bleed Isolation Test Suite, §5 Center Provisioning, §2.C File Inventory) and Owner Decision `CLT-D-030`.

Belongs to: **Phase 6 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-076
TITLE:           Bootstrap Script, Multi-Tenant Database Test Harness & Isolation Test Suites
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-075
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§8, §5), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030, CLT-D-032)
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
In Phases 1–5 (`CLT-T-071`..`CLT-T-075`), the entire database schema, shared contracts, server endpoints, admin UI, and client Dexie storage were updated for row-level multi-tenancy.
This task (Phase 6) completes the transition by updating the bootstrap initialization script, fixing a latent defect in `close_month`, updating the database test fixtures with `center_id`, and authoring the mandatory Suite 6 (Tests #66–#70) for zero-bleed tenant isolation:
1. Fix `close_month` stale review status check in migration `20261029000006`: change `'pending'` to `'flagged'` to match `chk_stale_review` constraint and `tests/regression/suite.test.ts:598`.
2. Update `scripts/bootstrap.ts` to provision:
   - Platform Super-Admin (`super_admin`, center_id = NULL).
   - Day-zero franchise centers: Mohakhali `MHK` and Rampura `RMP` via `rpc_create_center`.
   - Maintain strict idempotency under advisory lock `(1004, 1)`.
3. Update `tests/db/entries_sync.test.ts` and `tests/db/settlement_recon.test.ts`:
   - Supply `DEFAULT_CENTER_ID` (`00000000-0000-0000-0000-000000000001` from `tests/db/helpers/test-db.ts`) on all fixture inserts and pass `p_center_id` to database RPC calls.
4. Update `apps/web/tests/reports/view_parity.test.ts`:
   - Supply `center_id` on seeded transaction rows and filter queries.
5. In `apps/web/tests/regression/suite.test.ts`:
   - Ensure existing tests #1–#65 pass against multi-tenant schema.
   - Author **Suite 6: Multi-Tenant Isolation & Zero Data Bleed (Tests #66 to #70)**.

OBJECTIVE
Align bootstrap, DB test fixtures, and regression suites with the multi-tenant baseline, and verify that `pnpm test` and `pnpm --filter @clt/web test` run cleanly.

SCOPE (the ONLY files you may create or modify)
- supabase/migrations/20261029000006_functions_settlement_recon_month.sql — modify
- scripts/bootstrap.ts — modify
- tests/db/entries_sync.test.ts — modify
- tests/db/settlement_recon.test.ts — modify
- apps/web/tests/reports/view_parity.test.ts — modify
- apps/web/tests/regression/suite.test.ts — modify

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc or packages/shared.
- Do not modify Dexie client code or UI routes.
- Do not drop or recreate migrations 001–005 or 007.

REQUIREMENTS (numbered; each is testable)

R1. Bug Fix in `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`:
    - At line 1693 (inside `close_month` function):
      Replace:
      ```sql
      and stale_rates = true and stale_review_status = 'pending'
      ```
      With:
      ```sql
      and stale_rates = true and stale_review_status = 'flagged'
      ```
      This aligns `close_month` with constraint `chk_stale_review` (`('none', 'flagged', 'approved', 'rejected')`) and Test #58.

R2. Multi-Tenant Bootstrap Script in `scripts/bootstrap.ts`:
    - Keep transaction and dedicated bootstrap advisory lock `pg_advisory_xact_lock(1004, 1)`.
    - Provision Platform Super-Admin:
      - Uses `BOOTSTRAP_OWNER_EMAIL` (defaulting to `owner@cosmoledger.local` in local dev).
      - Reconciles or creates user in GoTrue with `app_metadata: { role: 'super_admin' }`.
      - Upserts `profiles` row with `role: 'super_admin'`, `center_id: NULL`.
    - Provision Initial Centers via `rpc_create_center`:
      - Center 1: Mohakhali `MHK`
        - Code: `MHK`, Name: `Kumon Mohakhali Center`, Legal Entity: `Mohakhali Learning Center Ltd`, Address: `Mohakhali, Dhaka`, Phone: `01700000001`, Owner: `owner.mhk@cosmoledger.local`
      - Center 2: Rampura `RMP`
        - Code: `RMP`, Name: `Kumon Rampura Center`, Legal Entity: `Rampura Education Center Ltd`, Address: `Rampura, Dhaka`, Phone: `01700000002`, Owner: `owner.rmp@cosmoledger.local`
      - If centers already exist, skips provisioning idempotently.
    - Write `system.bootstrap` audit log entry with `center_id: NULL`.

R3. Update `tests/db/entries_sync.test.ts` & `tests/db/settlement_recon.test.ts`:
    - Import `DEFAULT_CENTER_ID` from `./helpers/test-db`.
    - In setup queries (`beforeAll`):
      - Add `center_id` to `profiles`, `payment_methods`, `payables`, `rate_profiles`, `method_rates`, and `devices`.
    - In test procedure calls:
      - Pass `p_center_id: DEFAULT_CENTER_ID` to all RPC calls (`rpc_push_sync_op`, `record_settlement_payment`, `close_month`, `reopen_month`, `create_statement`, `match_statement_line`, etc.).
    - In `afterAll` teardowns:
      - Clean up artifacts filtered by `center_id = DEFAULT_CENTER_ID`.

R4. Update `apps/web/tests/reports/view_parity.test.ts`:
    - Ensure `INSERT INTO entries` in `beforeAll` supplies `center_id` (e.g. resolved from `(SELECT id FROM centers LIMIT 1)`).
    - In `v_monthly_totals` and `v_monthly_method_charges` queries, filter by the seeded `center_id` so calculations match the client aggregator's seeded rows exactly.

R5. Author Suite 6 in `apps/web/tests/regression/suite.test.ts`:
    - Update tests #1 to #65 where schema queries reference `center_id` or `p_center_id`.
    - Append **Suite 6: Multi-Tenant Isolation & Zero Data Bleed (Tests #66 to #70)**:
      - **Test #66: Force Row Level Security on All 20 Public Tables**
        Queries `pg_class` and asserts `relrowsecurity = true` AND `relforcerowsecurity = true` for all 20 public tables (`centers`, `center_counters`, `profiles`, `payment_methods`, `payables`, `rate_profiles`, `method_rates`, `entries`, `entry_reconciliation_exceptions`, `settlements`, `settlement_payments`, `statements`, `statement_payables`, `statement_lines`, `month_closes`, `month_close_events`, `sync_ops`, `devices`, `app_settings`, `audit_log`).
      - **Test #67: Cross-Tenant Data Isolation Proof under RLS**
        Creates temporary entries in Center A and Center B. Executes queries under `SET ROLE authenticated` with `SET request.jwt.claims` for a user of Center A. Asserts that Center B rows are invisible (count = 0).
      - **Test #68: 64-Bit Injective Coordinate Advisory Lock Isolation**
        Computes `(1001::bigint << 16) | (center_number & 0xFFFF)` across different centers for the same month and asserts that the resulting lock keys are distinct integers (zero lock collision).
      - **Test #69: Center-Specific Sequential Entry Numbering Independence**
        Tests that atomic increments on `center_counters` for Center 1 and Center 2 increment independently without sequence bleed.
      - **Test #70: Super-Admin Read Bypass vs Franchise Role Scope**
        Verifies that under RLS, a user with role `super_admin` (`center_id IS NULL`) can view all centers, whereas franchise roles (`staff`, `admin`, `owner`) are strictly constrained to their own `center_id`.

VERIFICATION
1. `pnpm db:reset`
   Must apply all migrations cleanly including the patched `20261029000006`.
2. `pnpm db:bootstrap`
   Must run and report successful bootstrap of Platform Super-Admin and initial franchise centers.
3. `pnpm test`
   All unit, property, and database integration tests in `tests/db` must pass.
4. `pnpm --filter @clt/web test`
   All web tests including `view_parity.test.ts` and `apps/web/tests/regression/suite.test.ts` (all 70 tests) must pass.

TASK REPORT FORMAT
Send the report wrapped in a fenced code block with this header:
```
=== TASK REPORT ===
TASK ID:         CLT-T-076
AGENT ID:        A-IMP-1
STATUS:          DONE | BLOCKED
SUMMARY:         <2-4 sentences describing what was built>
FILES CHANGED:   <path>  <modify>  <short note>
COMMANDS RUN:    <numbered list of exact commands and their outputs>
ACCEPTANCE:      <A1-A4 pass/fail matching verification steps>
=== END REPORT ===
```

