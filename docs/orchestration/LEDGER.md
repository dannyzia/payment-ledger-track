# Orchestration Ledger — Cosmo Ledger Track

Created: 2026-11-06, per `ORCHESTRATOR.md` §13 and Gate G0 of
`G0_READINESS_CHECKLIST.md` §3. Owner of this file: the orchestrator.
Zia's word overrides it.

Status words are the AGENTS.md §6 set: `QUEUED`, `IN_PROGRESS`, `IN_REVIEW`,
`CHANGES_REQUESTED`, `DONE`, `BLOCKED`, `CANCELLED`.

## 1. Tasks

| Task ID | Feature | Title | Agent | Depends on | Scope files | Status | Evidence | Updated |
|---|---|---|---|---|---|---|---|---|
| CLT-T-050 | UNSET (Plan 007 owns the files) | Fix FloatingMenu keyboard and pointer activation of children | A-IMPL-1 (Implementer) | none | `apps/web/src/lib/ui/FloatingMenu.svelte`, `apps/web/src/lib/ui/actions/draggable.ts`, `apps/web/tests/e2e/floating_menu.spec.ts`, `apps/web/tests/e2e/offline_sync.spec.ts` | DONE | commit `74bfcb1`; `docs/orchestration/reports/CLT-T-050.md`; unit 209/209, e2e 9/9, check 0/0 | 2026-11-06 |
| CLT-T-051 | UNSET (readiness records) | Readiness records: M2 gate evidence refresh, G0 checklist, Q1–Q4 owner packet, Gate 5 device checklist, and these orchestration files | UNSET (roster empty) | none | `docs/orchestration/**`, `scripts/verify-gates.ts` output only | IN_REVIEW | commits `8b4f7ee`, `de66202`, `1a85769`; G0 not signed, roster unfilled | 2026-11-06 |

Neither task had a brief written by the orchestrator before work started;
CLT-T-050's brief exists (`docs/orchestration/briefs/CLT-T-050.md`) but is
recorded as scheduled against Plan 007 after the defect was already found.
That is a Gate/roster gap (see RISKS `CLT-R-006`), not a defect in the work.

## 2. Plan coverage

Status is copied from `docs/plans/000_TOC.md`; that file remains the register.
Only the orchestrator may change a plan's status, after independent
verification.

| Plan | Title | Milestone | Status | Note |
|---|---|---|---|---|
| 001 | Repo foundation and tooling | M0 | Implemented | — |
| 002 | Calc engine | M0 | Implemented | — |
| 003 | DB schema and security | M0 | Implemented | — |
| 004 | DB functions: entries, rates, sync | M0 | Implemented | — |
| 005 | DB functions: settlement, recon, month | M0–M2 | Implemented | — |
| 006 | Bootstrap and seed | M0 | Implemented | — |
| 007 | Design system and UI kit | M0–M1 | Implemented | re-opened by CLT-T-050 (floating menu), now fixed |
| 008 | Auth, roles, app shell | M1 | Implemented | — |
| 009 | Admin panel | M1 | Implemented | — |
| 010 | Entry form, local-first save | M1 | Implemented | — |
| 011 | Sync engine | M1–M2 | Implemented | — |
| 012 | Ledger and entry lifecycle | M2 | Implemented | — |
| 013 | Reports and exports | M2 | Implemented | — |
| 014 | Settlements | M2 | Implemented | — |
| 015 | Reconciliation Mode A, month close | M2 | Implemented | — |
| 016 | Role dashboards | M1–M2 | Implemented | — |
| 017 | PWA offline hardening | M3 | Implemented | — |
| 018 | Reconciliation Mode B adapters | M4 | Partially Implemented | blocked on real statement samples (Q14); see `CLT-R-003` |
| 019 | Capacitor Android release | M5 | Partially Implemented | web-side artifacts present; no Android SDK/adb on the dev machine, no device run; store build gated on Q1–Q4 (Rule 20) |
| 020 | Test suites and readiness gates | cross-cutting | Implemented | 65/65 regression, M2 gates green |
| 021 | Deployment and ops runbooks | Phase 6 / G5–G6 | Partially Implemented | code and runbooks present; no deploy (Rule 19), no bucket, no restore drill — see `CLT-D-025` |
| 022 | UI/UX screens and prototype spec | overlay | Implemented (Specification) | specification artifact, nothing to build |

## 3. Gate position

| Gate | State | Evidence |
|---|---|---|
| G0 Intake | **Open** — records now exist, roster still `<fill>`, no Zia line | `G0_READINESS_CHECKLIST.md`; `DECISIONS.md` `CLT-D-026` pending |
| Gates 1–4 at M2 | **Pass** | `corepack pnpm test:gates --milestone M2` → "All Implementation Readiness Gates passed for Milestone M2."; `docs/orchestration/reports/GATE_EVIDENCE.json` (commit `8b4f7ee`) |
| Gate 5 | **Not verified** — first hardware run 2026-11-06 on the Pixel 6a: H1, H2, H9, H16 pass; H3–H8 blocked by `CLT-R-012`; H10/H12–H14 fail per `CLT-R-013`; fonts broken (`CLT-R-014`) | `reports/GATE5-DEVICE-RUN.md`; `GATE5_PHYSICAL_DEVICE_CHECKLIST.md`; blocker `CLT-R-002` |
| Release (Rule 19) | Not requested | no `ZIA-APPROVED:` line exists |

## 4. Maintenance rules

1. One row per task ID. A re-issued task gets `r<n>` (`CLT-T-052r2`), never a
   reused number.
2. Evidence is a commit SHA, a report path, or pasted command output — never
   "tests pass".
3. A task moves to `DONE` only after the repo, CI-substitute and live-surface
   checks in AGENTS.md §10 have been attempted and recorded, including the
   ones that could not run.
4. Briefs and reports are archived beside this file under `briefs/` and
   `reports/` exactly as sent and received.

## 5. Changelog

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-11-06 | File created from `G0_READINESS_CHECKLIST.md` §3. Tasks CLT-T-050 and CLT-T-051 recorded from commits `74bfcb1`, `8b4f7ee`, `de66202`, `1a85769`. Plan statuses copied from the TOC; gate position recorded from the current tree. |
| 2 | 2026-11-06 | Gate 5 row updated after the first physical-device run on the Pixel 6a (`reports/GATE5-DEVICE-RUN.md`): four items pass, the rest fail or are blocked by `CLT-R-012`–`CLT-R-014`. No task ID assigned to the run itself — it was authorised in chat, not by brief. |
