# Orchestration & Owner Decisions — Cosmo Ledger Track

Created: 2026-11-06, per `ORCHESTRATOR.md` §13 and Gate G0 of
`G0_READINESS_CHECKLIST.md` §3.

**This file records orchestrator and Owner (Zia) decisions only.** Implementer
choices where the PRD was silent stay in the root `DECISIONS.md`; the two logs
are separate on purpose (AGENTS.md §3). Do not merge them.

## 0. ID space — read before adding an entry

Decision IDs are `CLT-D-nnn` and **never reused** (AGENTS.md §6). The two logs
share that space:

- Root `DECISIONS.md` already owns `CLT-D-001` … `CLT-D-025`, plus the
  `CLT-POLICY-Q1` … `CLT-POLICY-Q4` policy headings.
- **The next free orchestration ID is `CLT-D-026`.**

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
| Q1 VAT rule, Q2 net/"Final" definition, Q3 commission structure, Q4 charge bearer | root `DECISIONS.md`, blocks `CLT-POLICY-Q1`…`Q4`; packet `OWNER_DECISION_PACKET_Q1_Q4.md` | — | **PENDING** (Rule 20) |
| Implementer deviations: `CLT-D-001`…`CLT-D-025` (plan-level choices where the PRD was silent) | root `DECISIONS.md` | to 2026-11-06 | CONFIRMED as recorded |

The Q1–Q4 marker lines must be written in **root** `DECISIONS.md`, not here:
`scripts/build-android.sh` greps `Qn.*Status: CONFIRMED` in the root file before
an `.aab` store build (CLT-D-022).

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
| 3 | 2026-11-08 | `CLT-D-029` recorded: the app's display name is **Kumon Ledger Track**, matching the KUMON artwork. Applied to Capacitor, the PWA manifest (`short_name` "Kumon Ledger"), titles, brand strings and the Android `app_name`; package id and Dexie database name deliberately untouched. |
| 1 | 2026-11-06 | File created. `CLT-D-026` (G0) opened as PENDING; decisions recorded in AGENTS.md and root `DECISIONS.md` indexed in §3; three decision requests listed in §4. No approval is fabricated: nothing here is marked accepted. |
| 2 | 2026-11-08 | `CLT-D-028` recorded: on Zia's chat decision, the unrelated `origin/main` history (six commits, root `a4cc8ae`) was replaced by this clone's `main` (`83b3764`) with `--force-with-lease`, after pinning the discarded tip as `backup/origin-main-20261108`. The ID space note is unchanged: the record states what was done and why, it does not create a task. |
