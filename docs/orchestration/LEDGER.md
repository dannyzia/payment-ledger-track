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
| 11 | 2026-11-07 | `CLT-R-014` verified on hardware: rebuilt APK (4,338,449 B, SHA-256 `1dfebd4b…`) contains the three real woff2 files, and inside the WebView on the Pixel 6a all of `Geist`, `Geist Mono` and `Noto Sans Bengali` report `loaded` across six routes after a real sign-in, with no `OTS`/decode errors in the console or logcat. `adb reverse` tunnels for the API and local Supabase were used for the run and removed afterwards. |
| 12 | 2026-11-07 | Second full sweep as `CLT-T-056` (chat-authorised, no brief): 111 checks over all 21 routes in thirteen batches, 9 defects fixed (`fix(ui)`, `fix(settle)`, `fix(recon)`, `fix(admin)`, `fix(nav)`), recorded in `reports/FULL-E2E-RUN.md` §7. Re-verified after the fixes: 219/219 unit, 9/9 repository e2e, `svelte-check` 0 errors/0 warnings, `vite build` clean. `CLT-R-023` raised. Month close, owner transfer, deactivation and device killswitch were opened and cancelled, not executed. |
| 13 | 2026-11-07 | `CLT-R-022` closed: an open Mode B statement is resumable from the Reconciliation overview (`Resume Matching` → `?statement=<id>`). The workspace keeps the statement across a reload, and unmatch, match, accept and finalize were each driven on a resumed statement (`/reconcile/unmatch-line` 200, `/reconcile/match-line` 200, `/reconcile/accept-line` 200, `/reconcile/statements/reconcile` 200 → `reconciled`), with `Switch Statement` returning to step 1 and dropping the parameter. Recorded as `df825fa` after the implementation, which had been left uncommitted in the working tree, was verified and committed. 219/219 unit and 9/9 e2e still pass. |
| 14 | 2026-11-07 | `b78ed2b`: the month-close checklist lists the open statements blocking Gate 1, with Resume Matching for Mode B and Finalize for Mode A, and `/reconcile` accepts `?month=YYYY-MM`. Verified at Pixel 5 width: 2026-09 resume lands on the workspace with `Lines: 2`, 2026-11 Finalize opens the overview on that month, 2026-08 shows nothing, an invalid month falls back to the current one; 219/219 unit, build clean. |
| 15 | 2026-11-07 | The statement workspace returns to the month-close checklist that opened it (`return=close`, month carried, `#btn-back` relabelled) while overview and direct openings still go to `/reconcile`; `/months/close` accepts `?month=`. Driven 6/6 at Pixel 5 width, 219/219 unit. |
| 16 | 2026-11-07 | `a652a8d`: month-close gates show `Checking…` and Close stays disabled until the device's first pull completes (Dexie `server_cursor`), re-evaluating as sync cycles settle; a slow evaluation can no longer publish over another month. Cold-device run held checking for 2.56 s across 11 samples, settled to the true Pending verdict; warm 2026-08 shows Passed with Close enabled. Offline caveat branch not driven live. 219/219 unit. |
| 17 | 2026-11-07 | `a528b06`: dev-only service worker (`/dev-offline-sw.js`) serves a network-first, cache-fallback shell so offline reloads work locally; per-start cache stamp, `/api/*` untouched, never in a build. Verified: worker active, 126 entries cached, offline reload boots the app. |
| 18 | 2026-11-07 | `16589ac`: offline worker exposed that an unsynced device still read gates as Passed from an empty cache; gates now read `Not synced` with a caveat and Close stays disabled until a pull lands. Verified 8/8 offline and 4/4 online, including reconnect restoring the real verdict. 219/219 unit. |
| 19 | 2026-11-07 | Offline save/flush verified end to end (no code change): 99 ms offline save as `#LOCAL-a2f33a`, outbox flushed after reconnect to `E-202611-000162` / `server_seq` 193 within 1.04 s, poisha components conserve the gross, fresh device pulled the same record. Test entry voided through the UI and the void confirmed on the server. Dev-only limitation: uncached routes cannot load offline in dev (production precaches all chunks). |
| 20 | 2026-11-07 | Offline void verified end to end (no code change): `E-202611-000163` voided with the network cut (local status `voided` in 828 ms, `void_entry` op queued), flushed after reconnect in 1.03 s to `server_seq` 196, clean-cache device pulls `voided`, audit row `entry.void` records `active → voided` with the owner as actor, and `/admin/audit` lists it. Minor finding left open: ledger rows mark voided state only by opacity/line-through, with no text label (WCAG 1.4.1). |
| 21 | 2026-11-07 | Added a `Voided` text chip to voided ledger rows (`LedgerRow.svelte`) so the status is not conveyed by opacity/line-through alone. Verified: voided row reads "Voided" in the row text and accessible name, active rows unmarked; svelte-check 0/0, ledger tests 9/9. |
| 22 | 2026-11-07 | Re-verified the offline void at HEAD `44e2337` with the new Voided chip: `E-202611-000164` voided offline in 731 ms (`void_entry` queued, row reads "Voided" + "Pending Sync"), flushed after reconnect in 1.03 s to `server_seq` 198, one `entry.void` audit row `active → voided` with the owner as actor, clean device pulls `voided`. 10/10. |
| 23 | 2026-11-07 | Re-verified offline save and flush at HEAD `44e2337`: `E-202611-000165` saved offline in 77 ms ("Saved offline as #LOCAL-ea9c38 — pending background sync.", `create_entry` queued, components conserve the gross), flushed in 1.04 s to `server_seq` 199 with identical gross/net, `entry.create` audit row carries the rate snapshot. 12/12. Test-harness note recorded: a sweep waiting only for an empty outbox can sample between the entry write and the outbox write in `executeEntryVoid` and end early. |
| 24 | 2026-11-07 | Exercised the dev service worker across all 18 page routes: worker activated, 197 cache entries (172 scripts) after warming, 18/18 offline reloads rendered with the Offline badge, in-app offline navigation and cached ledger data OK. Fixed `/admin/audit`, which threw an unhandled `Failed to fetch` offline: it now shows a "needs a connection" banner and clears on reconnect. svelte-check 0/0; production build contains no dev-worker code. |
| 25 | 2026-11-07 | Fixed the statement workspace losing its origin: the reconciliation overview dropped `return=close`, so a workspace opened through it returned to the overview. The checklist now passes the origin on both hand-off links, the overview forwards it via `workspaceHref()`, and Back lands on `/months/close?month=…`. Verified origin kept through overview resume/upload and reload; no origin injected when none was given. svelte-check 0/0. "Create one in Reconciliation" branch untested (no month reaches it in current data). |
| 26 | 2026-11-07 | Re-verified resuming an open Mode B statement at HEAD `b5abd7e` (implemented earlier in `df825fa`): `?statement=` restores lines, covered entries and the finalize panel; unmatch (reason required) and re-match from the candidate list work after resume; finalize enables with criteria satisfied and disables with an unmatched line; Mode A URLs redirect with an explanation. Accept and Reconcile were not executed (they flip month-close gate 1). Fixture caveat: the 2026-09 statement has 2026-11 lines and no September entries, so its candidate list is empty — test data, not code. |
| 27 | 2026-11-07 | `CLT-R-014` re-verified on hardware from a freshly rebuilt APK (`44c1b68e…`, 4,338,449 B) after `cap sync`: the three real woff2 files are inside the APK, all faces report `loaded` across six routes, Geist Mono is truly monospaced (124.8 px `iiii`/`MMMM`, uniform 19.20 px advances), Bengali/`৳` wider than serif, 0 OTS/decode lines in logcat, fonts served locally by Capacitor. Tunnels removed after the run. `GATE5-DEVICE-RUN.md` §10. |
| 28 | 2026-11-07 | Added a `Superseded` text chip to superseded ledger rows, alongside the existing Voided chip (mutually exclusive), so neither status relies on opacity alone. Verified by flagging one cached entry in Dexie and restoring it: label present in text and accessible name, no strikethrough, opacity 0.5; restored row unlabelled. svelte-check 0/0, ledger tests 9/9. Rendering check only, not a supersede transaction. |
| 29 | 2026-11-07 | Offline supersede verified end to end after fixing two defects it exposed. `Edit / Supersede` threw `Cannot read properties of null (reading 'id')` because the drawer closed before reading the entry id, and every supersede was rejected server-side with `violates check constraint "chk_reassign"` because `rpc_supersede_entry` stored the original date unconditionally (PRD §7.3 only does that for a closed-month reassignment) — fixed in the drawer and in migration `20261107000001`. Verified 16/16: `E-202611-000174` superseded offline in 304 ms as `#LOCAL-b88e41`, flushed in 1.03 s to `E-202611-000175` / `server_seq` 217, one `entry.supersede` audit row (`active → superseded`, names the replacement, actor = owner), clean device pulls the pair. Harness incident: `pnpm test` empties the dev database before failing on `one_owner`; restored with `pnpm db:bootstrap` (`CLT-R-025`). |
| 30 | 2026-11-07 | Verified the offline path for methods that require a transaction reference (no code change). bKash shows "Transaction Reference (Mandatory)" and `required`; a blank reference writes nothing and moves focus to the field with the browser's "Please fill out this field." (native validation pre-empts the app handler); whitespace-only input is caught by the handler with the app's own banner; `txn-77ab` saved offline in 277 ms as `#LOCAL-8297a9`, normalised to `TXN-77AB`, flushed in 1.22 s to `E-202611-000176`; Cash saved and flushed with no reference. A tampered queue proved the server guard: push rejected with `missing_txn_ref`, no entry created, op discarded afterwards. Minor findings open: the channel-specific inline message is unreachable for a truly empty field, and `entry.create` audit rows omit `txn_ref`. |
| 31 | 2026-11-07 | Checked the remaining admin screens offline after the `/admin/audit` fix. No unhandled rejections existed, but eight pages surfaced a raw `Failed to fetch` and `/admin` showed nothing at all, leaving the hub reading a business of zeros; `/admin/users` and `/admin/audit` also claimed "No … found" for data they had merely failed to load. Added `$lib/api/offline.ts` (`adminFetchError`), wired all nine pages to one offline sentence, gave the hub its own banner, and suppressed empty states after a failed load. Offline: 9/9 routes show the message, 0 page errors, no false empties; online all nine still load. svelte-check 0/0, web unit 145/145. Mutation paths offline not exercised. |
| 32 | 2026-11-07 | Added `scripts/seed-recon-month.ts` (`pnpm db:seed:recon-month`) so the month-close empty-state link can be exercised, and drove it. The seed pushes one entry through `rpc_push_sync_op` into an empty month, which makes `bkash_charge_payable` due (2,875 poisha on ৳2,500.00) with zero statements; it refuses non-local databases and any occupied month and is idempotent via `SEED-YYYMM-RECON`. `/months/close?month=2026-12` now shows "No open statement covers the outstanding payables…", links to `/reconcile?month=2026-12&return=close`, and the link lands on the month with its own empty state. Statement creation from there not executed. |
| 33 | 2026-11-07 | Ran the two remaining statement writes end to end on a rebuilt 2026-07 Mode B fixture (the earlier one was lost to the `pnpm test` wipe, `CLT-R-025`). Two bKash entries (`E-202607-000181`/`000182`) plus a 3-line bKash CSV gave statement total 2,129 vs expected 2,014 (variance 115, above tolerance). Accepting the statement-only fee line wrote `statement_line.accept` with `reviewed_by` and the note; matching both ledger lines wrote two `statement.match_line` rows; finalize wrote `statement.reconcile` (`open → reconciled`, note) and set the payable's `statement_payables` row to `reconciled`. `/months/close?month=2026-07` then passes all three gates, with the settlement still `due` until paid. Minor findings open: three audit payloads are narrower than PRD §15.1 (`statement.create` key `total` and no `covered_payables`; `statement.reconcile` omits `variance`/`covered_payables`; `statement_line.accept` omits `reviewed_by`), and the entry form's default Cash chip can be overwritten by a fast method tap before the profile loads. |
| 34 | 2026-11-07 | Rebuilt the 2026-09 statement fixture so its lines are dated in its own month; the earlier fixture (row 26, `717bd561…`, lines dated 2026-11) was gone with the other statements in the `pnpm test` wipe (`CLT-R-025`). Two September bKash entries (`E-202609-000183`/`000184`) plus a 2-line bKash CSV produced statement `247f12b1…`: month 2026-09, total 2,013 = expected 2,013, variance 0, both lines auto-matched to their September entries, one `statement.create` audit row. Left `open` as the resume/finalize fixture; `/months/close?month=2026-09` lists it as the Gate 1 blocker with a working Resume link. No code change. |
