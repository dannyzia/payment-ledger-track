# G0 Intake — Readiness Checklist

Prepared: 2026-11-06. Approver: **Zia** (ORCHESTRATOR.md §6). This is a record for
Zia's sign-off, not an approval. Nothing below is marked closed without evidence.

## 0. What G0 requires

ORCHESTRATOR.md §6, Gate G0 (Intake), exit criteria, verbatim:

> Goal, scope, constraints, roster, and project context file confirmed; ledger created.

ORCHESTRATOR.md §13 requires these records under `docs/orchestration/`:
`LEDGER.md` (features and tasks), `DECISIONS.md` (orchestrator/owner decisions),
`RISKS.md` (ID, description, severity, owner, mitigation, status), plus
`briefs/<TASK ID>.md` and `reports/<TASK ID>.md`.

## 1. Status summary (verified against the repo on 2026-11-06)

| # | Criterion | Current state | Evidence | What closes it |
|---|---|---|---|---|
| 1 | Goal confirmed | **CONTENT READY — not signed** | AGENTS.md §1 "Goal" (entry < 20 s on a phone, accurate monthly totals, settlement tracking, reconciliation, offline-first sync, roles) | Zia writes the G0 line in `docs/orchestration/DECISIONS.md` (template in §4 below) |
| 2 | Scope confirmed | **CONTENT READY — not signed** | AGENTS.md §1 "Non-goals (v1)"; PRD §4 Q7–Q15 defaults; PRD §17 milestones M0–M5 | Same G0 line |
| 3 | Constraints confirmed | **CONTENT READY — not signed** | AGENTS.md §5 Hard Rules 1–20; §4 architecture decisions; PRD §12 NFRs | Same G0 line |
| 4 | Roster confirmed | **OPEN — table empty** | ORCHESTRATOR.md §5 roster rows are `<fill>` placeholders | Zia fills App/IDE, Model, strengths, limits for at least `A-PLN-1`, `A-IMP-1`, `A-AUD-1`, `A-TST-1`, `A-OPS-1` |
| 5 | Project context file confirmed | **CONTENT READY — not signed** | `AGENTS.md` exists, rev 8, last updated 2026-10-29 (its own header) | Same G0 line, naming AGENTS.md rev 8 |
| 6 | Ledger created | **MET — files created 2026-11-06** | `LEDGER.md`, `DECISIONS.md` and `RISKS.md` now exist alongside `briefs/` and `reports/`; only the G0 signature in §4 is outstanding | Nothing further; `CLT-D-026` signs §4 |

## 2. Honest record: the gate is retrospective

Implementation has already reached Plan 021 (TOC changelog 3.33) while G0 is
formally open: no ledger, an empty roster, and no Zia G0 line exist. This is
recorded rather than glossed: the gate review is being performed after the fact,
which means it cannot prevent scope drift — it can only document what was built
and what still needs the Owner's word. ORCHESTRATOR.md §14 rule 5 forbids
fabricating approvals, so this file marks G0 **not passed** until Zia signs §4.

## 3. Records to create (orchestrator-owned; skeletons only)

Create `docs/orchestration/LEDGER.md` with the §13 row format:

```
| Task ID | Feature | Title | Agent | Depends on | Scope files | Status | Evidence | Updated |
|---|---|---|---|---|---|---|---|---|
```

Create `docs/orchestration/DECISIONS.md` — an entry per decision with ID, date,
who decided, options, outcome, reason. Existing plan-work deviation records stay
in the root `DECISIONS.md` (implementer choices); the two files are separate on
purpose (AGENTS.md §3).

Create `docs/orchestration/RISKS.md` with columns
`ID | Description | Severity | Owner | Mitigation | Status`. Seed candidates
already documented elsewhere, so nothing is invented here:

| ID (suggested) | Description | Source |
|---|---|---|
| CLT-R-001 | Q1–Q4 business policies unconfirmed before production (Rule 20) | AGENTS.md §8, Rule 20 |
| CLT-R-002 | Gate 5 physical-Android protocol not run; JDK/ANDROID_HOME unverified | CLT-D-023 |
| CLT-R-003 | Reconciliation Mode B blocked on real statement samples (Q14) | TOC row 018 |
| CLT-R-004 | CI absent; verification is manual re-runs on the dev machine | AGENTS.md §2 |
| CLT-R-005 | Backups/restore drill unproven (no AWS CLI, no bucket, no approval) | CLT-D-025 item 9 |
| CLT-R-006 | Rhizome hub not created; brief/report transport is still manual | AGENTS.md §10 |
| CLT-R-007 | FloatingMenu keyboard/pointer activation defect open | CLT-D-024 item 7, CLT-T-050 |

## 4. The G0 line for `docs/orchestration/DECISIONS.md`

Numbered `CLT-D-026`: the `CLT-D-001`…`CLT-D-025` range is already used by the
root implementer `DECISIONS.md`, and decision IDs are never reused (AGENTS.md
§6). Paste once, filling the two `<…>` fields:

```
## CLT-D-026 — G0 Intake accepted
Date: <YYYY-MM-DD>
Decided by: Zia
Options: accept G0 as recorded in docs/orchestration/G0_READINESS_CHECKLIST.md; or hold G0 open
Outcome: ACCEPTED
Scope: goal, non-goals, constraints (AGENTS.md rev 8), roster (ORCHESTRATOR.md §5), records above
Reason: <one sentence in Zia's words>
```

## 5. Verification (run after signing; paste output)

```bash
cd "/home/zia/Documents/My Projects/Cosmo_Ledger_Track"
ls -1 docs/orchestration/                 # expect LEDGER.md DECISIONS.md RISKS.md briefs reports
grep -c "G0 Intake accepted" docs/orchestration/DECISIONS.md   # expect 1
grep -c "<fill>" ORCHESTRATOR.md          # expect 0 (roster filled)
```

## 6. What G0 does not cover

G0 is an intake gate. It does not approve deployment (Rule 19), does not confirm
the business policies Q1–Q4 (Rule 20 — separate packet:
`docs/orchestration/OWNER_DECISION_PACKET_Q1_Q4.md`), and does not close Gate 5.
