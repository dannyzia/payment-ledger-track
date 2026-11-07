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
| CLT-T-052 | UNSET (chat-authorised) | `apps/web/vite.config.ts`: expose `PUBLIC_*` to the client bundle (`CLT-R-012`) | UNSET (roster empty) | none | `apps/web/vite.config.ts` | IN_REVIEW | `5df749d`; device re-run in `reports/GATE5-DEVICE-RUN.md` §8 | 2026-11-06 |
| CLT-T-053 | UNSET (chat-authorised) | Floating menu: touch drag (`CLT-R-013`) and the rotation clamp (`CLT-R-018`) | UNSET (roster empty) | none | `apps/web/src/lib/ui/FloatingMenu.svelte`, `apps/web/src/lib/ui/actions/draggable.ts` | IN_REVIEW | `reports/GATE5-DEVICE-RUN.md` §11–13 | 2026-11-06 |
| CLT-T-054 | UNSET (chat-authorised) | Signed-out shell (`CLT-R-015`): app-group session gate, guard, sync `no_session` path | UNSET (roster empty) | none | `apps/web/src/routes/(app)/+layout.ts`, `apps/web/src/lib/auth/**`, `apps/web/src/lib/sync/{push,runner.svelte}.*`, `apps/web/src/lib/ui/SyncIndicator.svelte` | IN_REVIEW | `reports/GATE5-DEVICE-RUN.md` §15–18 | 2026-11-06 |
| CLT-T-055 | UNSET (chat-authorised) | Offline label (`CLT-R-016`): classify push transport failures as `network_offline` | UNSET (roster empty) | none | `apps/web/src/lib/sync/push.ts`, `apps/web/src/lib/sync/push.test.ts`, `apps/web/src/lib/sync/runner.test.ts` | IN_REVIEW | `reports/GATE5-DEVICE-RUN.md` §19–21; APK re-check pending | 2026-11-07 |

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
| Gate 5 | **Not verified** — three hardware runs 2026-11-06 on the Pixel 6a. Pass: H1, H2, H3, H5–H8 (H8 without duplicates; §6.6 fixture to the poisha), H9, H10, H12–H14 (drag, haptics on drag release only, double-tap reset, position across restart and rotation), H16. Fail: H4 (`CLT-R-017`), fonts (`CLT-R-014`). H11 not re-run; H15 is `CLT-T-050`. `CLT-R-012`, `CLT-R-013`, `CLT-R-015` and `CLT-R-018` fixed; `CLT-R-016` (offline label) fixed and browser-verified, APK re-check owed | `reports/GATE5-DEVICE-RUN.md`; `GATE5_PHYSICAL_DEVICE_CHECKLIST.md`; blocker `CLT-R-002` |
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
| 3 | 2026-11-06 | `CLT-R-012` fixed (`envPrefix` in `apps/web/vite.config.ts`) and the blocked device checks re-run: H3 and H5–H8 now pass, including the PRD §6.6 fixture (50900/226800/6795/306405). Three new risks recorded: `CLT-R-015` (signed-out shell), `CLT-R-016` (offline labelled as error), `CLT-R-017` (device id cannot survive `pm clear`). |
| 4 | 2026-11-06 | `CLT-R-013` fixed: a press that starts on a menu control now becomes a drag once it moves, the release's click is swallowed, and the pill gained the PRD §14.5 44×44 handle. H10, H12, H13 and H14 pass on the device with measured numbers (24 px edge snap, 12 px clamp, one TOUCH vibration per drag release, `396 → 396` across rotation). H14 exposed `CLT-R-018` — a landscape trip overwrote the live position — fixed with an `isMeasurable()` guard. |
| 5 | 2026-11-06 | `CLT-R-015` fixed: the app group now verifies a Supabase session before its first render and redirects to `/login` when there is none, the guard treats a cached profile without a session as signed out, and the sync runner reports `signed_out` instead of a generic error. Reproduced on the device first (dashboard + "Sync error"), then re-checked for redirect, sign-in and offline restart. |
| 6 | 2026-11-07 | `CLT-R-016` fixed: `push.ts` classifies a dropped connection as `network_offline` like `pull.ts`, so the indicator reads "Offline (N pending)" rather than "Sync error". Proved with the same Playwright script against the stashed pre-fix file and the fix under `net::ERR_FAILED`; APK re-check owed because the phone was not attached |
| 7 | 2026-11-07 | Full sweep of every screen, control and entry as `CLT-T-056` (authorised in chat, no brief): 75/75 checks across six sections, plus 219/219 unit and 9/9 repository e2e. Six defects fixed in `cd1abd6`, `0369a18`, `0e50f0c`, `fd65e72` (blank Mode A page, dead ledger search, missing `payables.code`, missing statement links, duplicate modal ids, dead `/settings` link). Report: `reports/FULL-E2E-RUN.md`. Three risks raised (`CLT-R-019`–`CLT-R-021`). `CLT-R-014` still open and the device re-check still owed |
| 8 | 2026-11-07 | `CLT-R-020` closed in `c262020`: the six colliding `#btn-save` buttons on the Mode B upload page now name their action, and `Modal` derives a per-instance heading id instead of `modal-title`. Confirmed in the browser that creation returns `200`, the accept and supersede dialogs open with their new ids, and the live DOM carries no duplicate ids; 219/219 unit and 9/9 e2e on the same tree. Two of the six handlers (`unmatch`, `exception`) need matched lines and are recorded as not exercised, not as passing. `CLT-R-022` raised: an open Mode B statement cannot be reopened |\nEOF
git add docs/orchestration/LEDGER.md docs/orchestration/RISKS.md docs/orchestration/reports/FULL-E2E-RUN.md && git commit -q -m "$(cat <<'EOF'
docs(orch): record the Mode B id fix, its verification, and CLT-R-022

CLT-R-020 is closed with the browser evidence from c262020, and the sweep report
gains a section on what was driven and what could not be (the unmatch and
exception dialogs need matched lines). CLT-R-022 records the larger gap the pass
surfaced: leaving the upload page strands an open Mode B statement with no route
back to it.

Task: CLT-T-056
PRD: §11.3
| 8 | 2026-11-07 | `CLT-R-020` closed in `c262020`: the six colliding `#btn-save` buttons on the Mode B upload page now name their action, and `Modal` derives a per-instance heading id instead of `modal-title`. All six dialogs and both statement paths were then driven in the browser (upload 200, create 200, supersede path, accept/unmatch/exception dialogs, finalize 200 with status RECONCILED) and the live DOM carries no duplicate ids. That pass found a second defect, fixed in `5f4705f`: finalize always sent `note: null`, which the route's `z.string().optional()` rejected with `400 invalid_payload`, so no statement could be finalized without a typed note. `CLT-R-022` raised: an open Mode B statement cannot be reopened |
| 9 | 2026-11-07 | `CLT-R-019` closed in `2548214`: the expanded mobile navigation panel ends with a 44 px Sign Out button wired to the same `session.signOut()` the sidebar uses. Driven at Pixel 5 width in Chromium: the desktop control is not visible at that width, the panel button is, a real pointer click lands on `/login` with the form rendered, and navigating back to `/dashboard` bounces to `/login` with no `sb-*` keys left in storage. `svelte-check` 0 errors, 219/219 unit, 9/9 e2e |
| 10 | 2026-11-07 | `CLT-R-014` closed in `b2d8bd3`: the three 31-byte font stubs were replaced with the real variable fonts (Geist and Geist Mono latin subsets, Noto Sans Bengali bengali subset, all SIL OFL). Chromium at Pixel 5 width: every face reports `loaded`, each request `200` with the expected bytes, Geist Mono is genuinely monospaced (96px for `iiii` and `MMMM`), Bengali text and the `৳` sign render from Noto (110px vs 80px serif), and no font console error appears on login, dashboard, ledger, reports or the Mode B upload page. `reports/GATE5-DEVICE-RUN.md`'s OTS finding is only device-verified after a re-run |
