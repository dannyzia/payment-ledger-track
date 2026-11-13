# Orchestration & Owner Decisions — Cosmo Ledger Track

Created: 2026-11-06, per `ORCHESTRATOR.md` §13 and Gate G0 of
`G0_READINESS_CHECKLIST.md` §3.

**This file records orchestrator and Owner (Zia) decisions only.** Implementer
choices where the PRD was silent stay in the root `DECISIONS.md`; the two logs
are separate on purpose (AGENTS.md §3). Do not merge them.

## 0. ID space — read before adding an entry

Decision IDs are `CLT-D-nnn` and **never reused** (AGENTS.md §6). The two logs
share that space:

- Root `DECISIONS.md` already owns `CLT-D-001` … `CLT-D-025`, `CLT-D-030` … `CLT-D-032`,
  `CLT-D-035`, plus the `CLT-POLICY-Q1` … `CLT-POLICY-Q4` policy headings.
- **The next free decision ID is `CLT-D-036`.**

`G0_READINESS_CHECKLIST.md` §4 originally proposed `CLT-D-001` for the G0 line;
that number was already taken, so it now points here. Numbers are assigned when
an entry is written, never reserved in advance.

## 1. Status words

`CONFIRMED` — decided by Zia, quoted or dated.
`PENDING` — awaiting Zia; the question and options are ready.
`SUPERSEDED` — replaced by a later entry, which is named.

## 2. Open — awaiting Zia

### CLT-D-026 — G0 Intake accepted

```
Status: PENDING
Date: <YYYY-MM-DD>
Decided by: Zia
Options: accept G0 as recorded in docs/orchestration/G0_READINESS_CHECKLIST.md;
         or hold G0 open
Outcome: ACCEPTED | HELD
Scope: goal, non-goals, constraints (AGENTS.md rev 8), roster (ORCHESTRATOR.md §5),
       records in docs/orchestration/
Reason: <one sentence in Zia's words>
```

Still open before this can be answered: the roster table in `ORCHESTRATOR.md`
§5 is `<fill>` for every role. `LEDGER.md`, `RISKS.md` and this file now exist,
so the "ledger created" criterion is met.

### CLT-D-035 — Governance Boundary: Owner Business Decisions vs Agent Technical Autonomy

```
Status: CONFIRMED
Date: 2026-11-13
Decided by: Zia (Owner)
Options: Require Owner approval on technical/architectural choices;
         or establish clear boundary: Owner owns business decisions exclusively,
         agents hold full autonomy and responsibility for technical execution.
Outcome: Strict division of responsibility: Owner owns business decisions exclusively;
         technical execution, correctness, architecture, and verification belong
         autonomously to agents and do not require Owner approval.
Scope: Repository-wide governance, architecture, technical execution, and approvals
Reason: Zia (chat, 2026-11-13): "ZIA-APPROVED. You may write in your decision.md that ZIA only
        take business decision. And Zia took it while replying to your answer. The technical
        part is yours, I do not know that the technical things that u had done is correct
        or not. and actually dones not require my approval on those."
```

Consequences:
1. Business scope, commercial terms, rate policy defaults (Q1–Q4), franchise rules, and release authorizations belong exclusively to Zia.
2. Technical implementation, database migrations, test harnesses, code design, refactorings, and gate verification are owned autonomously by the agent team. Technical correctness is verified by automated test suites and readiness gates, not by owner inspection.

### CLT-D-033 — Multi-Tenant Migration, Bootstrap & Test Harness Remediation (Post-076 Drift)

```
Status: CONFIRMED
Date: 2026-11-11
Decided by: Orchestrator (technical remediation; no business-policy change)
Options: Keep Nov 10 bolt-on patches (008_center_provisioning_v2.sql, session-wide
         row_security=off in 006, current_user='postgres' clauses in 004, dummy
         auth.users insert in bootstrap.ts);
         or fold canonical PRD §7.4 methods/payables cleanly into 007, remove 008 and
         RLS workarounds, remove dummy SQL auth inserts from bootstrap.ts, and fix
         schema/bootstrap/view_parity test harnesses cleanly
Outcome: Fold canonical 5-method / 4-payable seed cleanly into 007; remove 008, RLS
         workarounds, and bootstrap dummy auth SQL insert; fix schema, bootstrap, and
         view_parity test harnesses and verify on clean throwaway/isolated stacks
Scope: supabase/migrations/2026102900000{4,6,7}_*.sql, deletion of 008 and
       scripts/clt-bootstrap-verify.ts, scripts/bootstrap.ts, tests/db/{schema,bootstrap}.test.ts,
       apps/web/tests/reports/view_parity.test.ts
Reason: 1) Migration 007's single `card_charge` payable (linked to visa only) left
       mastercard un-payable in generate_monthly_settlements and broke combined_card code
       matching in tolerance.ts; folding PRD §7.4's 5 methods (cash, bkash, visa,
       mastercard, bank_transfer) and 4 payables (vat_payable, bkash_charge_payable,
       visa_charge_payable, mastercard_charge_payable) into uncommitted baseline 007 honors
       CLT-D-030's clean declarative baseline without bolt-on 008 patch debt.
       2) postgres holds rolbypassrls = true in Postgres/Supabase, making session-level
       set_config('row_security', 'off', false) in 006 (connection-pool poisoning) and
       `OR current_user = 'postgres'` clauses on TO authenticated policies in 004 unnecessary.
       3) scripts/bootstrap.ts must rely strictly on Supabase Auth Admin API without dummy
       auth.users SQL inserts; bootstrap.test.ts verifies real Auth+DB cleanly against an
       empty/isolated Supabase stack with 2-center assertions.
       4) view_parity.test.ts uses role 'staff' instead of 'owner' so running against any
       center with an existing active owner never violates uq_one_owner.
```

### CLT-D-034 — Remediation of Multi-Center Regressions Found in CLT-T-077 Audit

```
Status: CONFIRMED
Date: 2026-11-11
Decided by: Orchestrator (following A-AUD-1 CHANGES REQUESTED audit on CLT-T-077)
Options: Option A — Restore canonical HEAD / PRD / API contracts inside 004 and 006 plus
         database.types.ts and settlement_recon.test.ts / schema.test.ts before accepting
         remediation. Option B — Alter SvelteKit API routes and UI recovery map to adopt the
         mutated 006 signatures/error codes and weaken security rules.
Outcome: Option A — Restore canonical PRD, HEAD, and SvelteKit API contracts
Scope: supabase/migrations/20261029000004_security_and_rls.sql,
       supabase/migrations/20261029000006_functions_settlement_recon_month.sql,
       apps/web/src/lib/database.types.ts,
       tests/db/settlement_recon.test.ts,
       tests/db/schema.test.ts
Reason: Independent Auditor A-AUD-1 found 2 Blockers and 4 Majors left over from earlier
        multi-center rewrites and confirmed against HEAD and /api/v1/* handlers:
        1) reopen_month in 006 permitted 'admin' instead of Owner-only (PRD §3/§7.3 +
           months/reopen/+server.ts) and dropped statements/statement_payables reopening.
        2) review_entry_reconciliation_exception changed to a 7-arg signature and dropped
           active-entry and payable-applicability guards, breaking POST /api/v1/reconcile/exceptions
           at runtime (masked in TS by an `as unknown as` cast against stale database.types.ts).
        3) reconcile_statement dropped Mode A expected_poisha/lines checks and Mode B Assertion 1
           (invalid_matched_entry) & Assertion 3 (unmatched_entries_without_approved_exceptions),
           and renamed variance_exceeds_tolerance to reconciliation_tolerance_exceeded
           (breaking sync/recovery.ts and reconcile/statements/reconcile/+server.ts).
        4) close_month dropped early idempotent return, renamed unapproved_overpaid_settlement to
           409 overpayment_pending_approval (breaking months/close/+server.ts), and checked
           an unreachable status = 'pending' on entry_reconciliation_exceptions.
        5) audit_log_select_policy in 004 exposed center audit_log rows to staff (PRD §3/§7.1).
        6) tests/db/settlement_recon.test.ts had weakened assertions matching the broken 006.
```

### CLT-D-032 — Admin Routes Alignment with Multi-Center RPC Signatures

```
Status: CONFIRMED
Date: 2026-11-09
Decided by: Orchestrator (authorized scope expansion during CLT-T-073 verification)
Options: Expand CLT-T-073 scope to include 8 admin routes (settings, devices, methods,
         payables, rates/draft, rates/publish, users, users/invite) passing p_center_id;
         or revert database.types.ts and leave admin RPCs broken until Phase 4
Outcome: Expand scope to align all 8 admin endpoints with multi-center RPC signatures
Scope: apps/web/src/routes/api/v1/admin/{settings, devices, methods, payables, rates/draft,
       rates/publish, users, users/invite}/+server.ts
Reason: Regenerating database.types.ts from the local PostgreSQL schema made p_center_id
       a required argument across all database procedures. Leaving admin handlers untouched
       prevented apps/web from typechecking. All 8 endpoints now resolve caller.centerId
       and pass p_center_id, achieving 0 errors and 0 warnings on svelte-check.
```

### CLT-D-030 — Multi-Center Row-Level Multi-Tenancy Architecture (V1 Baseline)

```
Status: CONFIRMED
Date: 2026-11-08
Decided by: Zia (chat, following EGM brainstorming and approved design specification)
Options: Multi-tenant row-level partitioning in single PostgreSQL database (V1 baseline);
         Database-per-center instance isolation;
         Defer multi-tenancy to V2 (post-launch)
Outcome: Row-level multi-tenancy in single shared PostgreSQL database for V1 launch baseline
Scope: Architectural overhaul across database schema, advisory locks, client storage, server
       mediation, Super-Admin governance, and test harnesses.
       Technical specification: docs/designs/multi_center_row_level_multitenancy.md
Key parameters:
  - Centers: Independent franchises, distinct bank and bKash merchant accounts, dedicated staff.
  - Tenancy boundary: center_id on all core tables; composite foreign keys.
  - Concurrency: 64-bit injective coordinate advisory locks using (class << 16) | center_number.
  - Numbering: E-{CENTER_CODE}-YYYYMM-XXXXXX backed by per-center atomic counters.
  - Client storage: Scoped per center (KumonLedger_{center_id}) with sync_ops preserved on logout.
  - Super-Admin: BRAC Kumon Head Office Platform Super-Admin ("God Mode") with global audit.
  - Migrations: Clean declarative baseline rewrite of migrations 001–006.
```

### CLT-D-029 — Display name is "Kumon Ledger Track"

```
Status: DECIDED
Date: 2026-11-08
Decided by: Zia (chat, asked because the code and the supplied artwork disagreed)
Options: "Kumon Ledger Track" (matches the KUMON wordmark artwork);
         "Cosmo Ledger Track" (current code and PRD naming);
         "Kumon" (wordmark only)
Outcome: "Kumon Ledger Track"
Scope: display strings only — Capacitor appName, PWA manifest name and
       short_name, HTML title, i18n brand strings, login and landing headings,
       the reports footer fallback and the install banner. The Android package
       id (com.cosmo.ledgertrack), the IndexedDB name (CosmoLedgerTrackDB), the
       repo/package name and the CLT project key are unchanged.
Why the package id stays: it is the store identity and the app's data
       namespace; renaming it would ship a different app and orphan local data.
Why the Dexie name stays: renaming the IndexedDB database would abandon every
       existing device's offline outbox.
```

### CLT-D-028 — Replace the remote's unrelated history (`origin/main`)

```
Status: DECIDED
Date: 2026-11-08
Decided by: Zia (chat, offered with three options; he chose the force-push)
Options: force-push local main over origin/main; push to a new branch and leave
         origin/main alone; merge the two unrelated histories
Outcome: force-push local main over origin/main
Scope: git history on origin/main only — no file content, no deployment,
       no other ref
```

`origin/main` held six commits with root `a4cc8ae` (PRD v1.7–v1.12 docs);
this clone held 86 with root `d0a5793` (the monorepo scaffold) and PRD v1.19.
`git merge-base` found no common ancestor, so `git push` was rejected as
non-fast-forward.

Executed as approved: the discarded tip was pinned locally as
`backup/origin-main-20261108` (`acd18d9`), then
`git push --force-with-lease origin main` moved the remote from `acd18d9` to
`83b3764`. Verified afterwards: `git ls-remote origin refs/heads/main` and
local `HEAD` both read `83b376471c119a77f755f991ef3a725916c5c1cf`.

Consequences to keep in mind:

- The six old docs commits are no longer on `origin/main`; they survive in the
  local `backup/origin-main-20261108` ref only. Delete that ref only when the
  change is no longer wanted as a rollback point.
- Any other clone made from the old remote must be re-cloned or reset; a pull
  from it would recreate the unrelated history.
- This also means the two fixes below went straight to `main`, against the
  AGENTS.md §6 branch rule (`task/CLT-T-nnn`). The owner's instruction in chat
  overrides it for this pair of commits; future tasks return to task branches.

## 3. Recorded elsewhere — index only

These decisions are binding but were not written here; the authoritative
location is named so nothing is duplicated or restated in the wrong voice.

| Subject | Where recorded | Date | Status |
|---|---|---|---|
| Project key **CLT**; IDs like `CLT-T-014` | AGENTS.md §1 | 2026-10-29 | CONFIRMED |
| Both orchestration systems in force: `ORCHESTRATOR.md` for tracking, Rhizome for agent transport | AGENTS.md §10 | 2026-10-29 | CONFIRMED |
| Admin changes rates alone (no Owner approval); single Owner; fixed monthly due date per payable; reconciliation in v1; transaction reference mandatory only where `methods.requires_txn_ref = true`; all percentages from the admin panel | AGENTS.md §4, "Decided by the owner" | undated | CONFIRMED |
| Q1 VAT rule, Q2 net/"Final" definition, Q3 commission structure, Q4 charge bearer | root `DECISIONS.md`, `CLT-POLICY-Q1`…`Q4` | 2026-11-13 | **CONFIRMED** (Rule 20 satisfied) |
| Implementer deviations: `CLT-D-001`…`CLT-D-025` (plan-level choices where the PRD was silent) | root `DECISIONS.md` | to 2026-11-06 | CONFIRMED as recorded |

The Q1–Q4 marker lines must be written in **root** `DECISIONS.md`, not here:
`scripts/build-android.sh` greps `Qn.*Status: CONFIRMED` in the root file before
an `.aab` store build (CLT-D-022). Verified 2026-11-13: `CLT-POLICY-Q1` through `CLT-POLICY-Q4` recorded in root `DECISIONS.md` with `Status: CONFIRMED`.

## 4. Decision requests to raise (unassigned IDs)

Not yet answered by Zia; listed so they are not lost. Each gets a `CLT-D-nnn`
when answered.

| # | Question | Source | Default if Zia says nothing |
|---|---|---|---|
| DR-1 | PRD §14.5 requires screens < 640 px to "dock cleanly into a bottom sheet bar"; the implementation only clamps and dodges (`snapToEdge`, `calculateAvoidance`) and no bottom-sheet bar exists anywhere in `apps/web/src` | `GATE5_PHYSICAL_DEVICE_CHECKLIST.md` GS-5 | keep dodge-only, record as accepted divergence before Gate 5 sign-off |
| DR-2 | Gate 5 needs the physical-device proof this checklist supplies; outside M2 the automated gate scores only `pnpm test:e2e` | `GATE5_PHYSICAL_DEVICE_CHECKLIST.md` GS-4, `CLT-R-008` | manual checklist remains the evidence; extend the script in a later task |
| DR-3 | Seeded `bank_transfer` has `requires_txn_ref = true`, while PRD §4 Q15 lists mandatory references only for bKash, Visa, Mastercard | `OWNER_DECISION_PACKET_Q1_Q4.md` "Adjacent observations" 1 | leave seeded value; it is an admin edit, not code |

## 5. Changelog

| Rev | Date | Change |
|---|---|---|
| 7 | 2026-11-13 | `CLT-D-035` recorded: Owner (Zia) established governance boundary — Zia exclusively takes business decisions (Q1–Q4, commercial scope, release approvals); technical execution, correctness, and architecture belong autonomously to the agent engineering team and do not require Owner approval. |
| 6 | 2026-11-13 | Q1–Q4 confirmed by Zia: recorded in root `DECISIONS.md` (`CLT-POLICY-Q1`..`Q4`). Center admins configure default VAT (% and amount with transaction override), standard Net formula confirmed, center-scoped default commission with immutable snapshot rate profiles, and center bears method charges. |
| 5 | 2026-11-11 | `CLT-D-034` recorded: restore Owner-only `reopen_month` + statement invalidation, 6-arg `review_entry_reconciliation_exception` + `database.types.ts`, full `reconcile_statement` Mode A/B guards and canonical error codes, `close_month` idempotency + `unapproved_overpaid_settlement`, and Admin/Owner/super_admin restriction on `audit_log_select_policy`. |
| 4 | 2026-11-11 | `CLT-D-033` recorded: technical remediation removing Nov 10 session RLS workarounds (`004`/`006`), folding PRD §7.4 5-method / 4-payable seed cleanly into `007` and removing `008`, removing dummy `auth.users` insert from `scripts/bootstrap.ts`, and fixing `schema.test.ts`, `bootstrap.test.ts`, and `view_parity.test.ts`. |
| 3 | 2026-11-08 | `CLT-D-029` recorded: the app's display name is **Kumon Ledger Track**, matching the KUMON artwork. Applied to Capacitor, the PWA manifest (`short_name` "Kumon Ledger"), titles, brand strings and the Android `app_name`; package id and Dexie database name deliberately untouched. |
| 1 | 2026-11-06 | File created. `CLT-D-026` (G0) opened as PENDING; decisions recorded in AGENTS.md and root `DECISIONS.md` indexed in §3; three decision requests listed in §4. No approval is fabricated: nothing here is marked accepted. |
| 2 | 2026-11-08 | `CLT-D-028` recorded: on Zia's chat decision, the unrelated `origin/main` history (six commits, root `a4cc8ae`) was replaced by this clone's `main` (`83b3764`) with `--force-with-lease`, after pinning the discarded tip as `backup/origin-main-20261108`. The ID space note is unchanged: the record states what was done and why, it does not create a task. |
