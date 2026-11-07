# Full end-to-end sweep — every screen, control and entry

- Date: 2026-11-07
- Authorised in chat by Zia ("do a complete e2e test. all the screen, all the button, all the entry."), not by a written brief.
- Task ID: `CLT-T-056` (assigned to the sweep and its fixes).
- Environment: local dev server on `127.0.0.1:5199` (Supabase cloud project from `.env.local`), Chromium via Playwright, Pixel 5 viewport (393×851) unless a step says desktop.
- Account: the bootstrap Owner. Credentials read from `.env.local` and never printed (Rule 8).

## 1. Verdict

**75 of 75 checks pass** across six sections, run in one sequence against a fresh seed.

| Section | Scope | Result |
|---|---|---|
| A | Boot, sign-in, shell, navigation, every route renders | 23/23 |
| B | Entry capture, calculation identity, offline save, sync, void, supersede | 11/11 |
| C | Reports, exports, ledger filters, dashboard figures | 7/7 |
| D | Settlements, reconciliation screens, all nine admin screens, command palette | 13/13 |
| E | Mode A reconciliation, tolerance gate, supersede, month close, close lock, reopen | 9/9 |
| F | Admin CRUD forms, rate/VAT switching, settings persistence, audit filter, menu navigation, sign-out | 12/12 |

Repository suites on the same tree: `svelte-check` **0 errors, 0 warnings**; `vitest run` **219/219** (19 files); `playwright test` **9/9** (17.1 s).

## 2. Defects found and fixed

Each one was invisible to the existing suites and only appeared when the screen was actually driven.

1. **Mode A reconciliation page rendered blank.** `reconcile/manual` assigned to a `$state` inside a `$derived`, which Svelte 5 rejects with `state_unsafe_mutation`; the component threw on first render and the page body was empty. The validation flags are now derived from the parsed total. Commit `cd1abd6`.
2. **Ledger search never filtered.** The debounce read the query inside its `setTimeout`, so the `$effect` owned no dependency on it and never re-ran. The value is captured synchronously. Verified: searching `E2E Visa` left one unit, gross ৳3,000.00. Commit `cd1abd6`.
3. **`payables.code` was dropped by pull.** The client cache held payables without codes, code-based resolution found nothing, and the settlement screen showed an expected liability of ৳0.00 with Save permanently disabled. Commit `0369a18`.
4. **Statement→payable rows were never pulled.** `statement_payables` did not travel in the pull payload, so the month-close gate could not see a single-payable reconciliation and refused to close a month it should have accepted. Commit `0369a18`.
5. **Duplicate DOM ids.** Month close rendered two `#btn-save` buttons (close and reopen-confirm) and the reconciliation hub rendered two more (reconcile and supersede modals). Both are invalid HTML and both broke element resolution. Renamed to `#btn-confirm-reopen`, `#btn-reconcile-statement`, `#btn-confirm-supersede`. Commits `0e50f0c` (year-month) included.
6. **Dead mobile settings link.** The floating menu pointed at `/settings`, a route the PRD does not define, and did so outside the admin gate. Now `/admin/settings`, inside the gate. Commit `0e50f0c`.
7. **Stale e2e case.** `floating_menu.spec.ts` case "g" asserted that a moving press navigates to New Entry, which `CLT-R-013` deliberately changed to drag the pill. Rewritten to assert the drag and the absence of navigation. Commit `fd65e72`.

## 3. Behaviour confirmed, not changed

- **A statement is refused after new entries move its liability.** `POST /api/v1/reconcile/statements/reconcile` answers `422 expected_poisha_mismatch` ("Expected liability has shifted; statement must be reviewed"). This is correct: the reconciliation no longer matches the ledger. The hub's Supersede path is the documented way out — supersede at the current figure, then reconcile the replacement at zero variance. The sweep now proves that whole path (2 statements in the first pass, 3 in the second).
- **Month close gates.** With an unreconciled liable payable the screen reads `Cannot Close Month: All payables must be reconciled or marked not_applicable` and the confirm button is disabled; once every payable is clear, close succeeds, the month locks (entry capture's Save is disabled), and an Owner reopen restores capture.
- **Mode A tolerance.** A variance beyond the 100-poisha tolerance disables Save until a note is entered; an exact total is accepted or points at the covering statement with `payable_already_covered_by_active_statement`.
- **Calculation identity** on every entry the sweep created, against the published profile (42% commission on gross-minus-VAT, 115 bp bKash, 150 bp cards): gross ৳1,000–5,000 gave commission 42000/84000/126000/168000/210000 poisha and net 58000/113700/169500/226000/290000, with `vat + commission + businessCharge + net === gross` in every case. Live check: bKash ৳1,234.56 → commission ৳518.52, fee ৳14.20, net ৳701.84.

## 4. Findings left open

1. **No sign-out control at phone width.** Sign-out exists only in the desktop sidebar; at 393 px the Owner has no way to end a session. Not fixed: the PRD defines no such control and inventing one is out of scope. Needs an Owner decision on where it belongs (menu panel is the natural place). Proposed `CLT-R-019`.
2. **The upload reconciliation page repeats the duplicate-id defect.** `reconcile/upload/+page.svelte` has five separate `#btn-save` ids (lines 915, 1184, 1277, 1313, 1351, 1388). Its flows were not exercised because Mode B needs a real statement file (`CLT-R-010`). Proposed `CLT-R-020`.
3. **The local seed was empty.** Business data was `0` rows in `payment_methods`, `payables`, `rate_profiles` and no entries, which is why an early sweep could not complete. `corepack pnpm db:bootstrap` restored it (documented as idempotent and non-destructive). Whether a developer should have to run it after a bare `db:reset` is a runbook question. Proposed `CLT-R-021`.
4. **Fonts are still 31-byte stubs** (`CLT-R-014`): every page logs `Failed to decode downloaded font` / OTS errors. Unchanged by this sweep.
5. **Not verified on a device.** The Pixel 6a was not attached, so nothing here covers `CLT-R-016`'s offline label on hardware; the web checks used a Pixel 5 viewport in desktop Chromium. `CLT-R-014` and `CLT-R-016` remain owed on device.

## 5. Follow-up verification: Mode B modal ids (2026-11-07)

`reconcile/upload/+page.svelte` had six `#btn-save` buttons (confirm creation, finalize, unmatch, accept, exception, supersede) and `Modal.svelte` gave every mounted dialog `id="modal-title"`. Fixed in `c262020`: each button names its action (`#btn-confirm-upload-statement`, `#btn-finalize-reconcile`, `#btn-confirm-unmatch`, `#btn-confirm-accept`, `#btn-confirm-exception`, `#btn-confirm-supersede`) and the dialog heading uses `$props.id()`.

Driven in Chromium at a Pixel 5 viewport against the local dev server, seeding one entry per month where a covered entry was needed so the statement had something to match:

| Step | Observed |
|---|---|
| `POST /api/v1/reconcile/statements/upload` | `200`, lines parsed, preview card shown |
| `#btn-confirm-upload-statement` | enabled; `POST /api/v1/reconcile/statements` → `200` with a `statementId` |
| `#btn-supersede` / `#btn-confirm-supersede` | existing-statement path replaces the confirm button; dialog opens, confirm disabled until a reason is typed, no request sent until then |
| auto-match | a seeded entry auto-matched its statement line (`Matched: 1`), which made the row's Unmatch action available |
| `#btn-confirm-unmatch` | dialog opens, confirm disabled until a reason is typed |
| `#btn-confirm-accept` | dialog opens on an unmatched line, confirm disabled until a note is typed |
| `#btn-confirm-exception` | dialog opens from an unmatched covered entry, confirm disabled until a reason is typed |
| `#btn-finalize-reconcile` | disabled while any line is unmatched; with every line matched it submits |
| `POST /api/v1/reconcile/statements/reconcile` | `200 {"success":true}`, statement status `RECONCILED` |
| Duplicate ids in the live DOM, each step | none |

**Defect found and fixed on the finalize path (`5f4705f`).** With the note field blank the page sent `note: null`, and the route's schema is `z.string().optional()`, so finalize answered `400 invalid_payload` at path `["note"]` and never reached the RPC. The key is now omitted when blank. Reproduced first (400), then re-driven on a fresh month: upload `200`, create `200`, finalize `200`, status `RECONCILED`.

Two observations from this pass: the floating New Entry pill sits over the bottom-right primary buttons at phone width and intercepted every real click until the click was dispatched directly (it is draggable, so this is an annoyance, not a dead end); and leaving the page strands an open Mode B statement, because nothing routes back to it (`CLT-R-022`).

Test data left in the local dev database by this pass: an open bKash statement for 2026-05, 2026-06, 2026-07, 2026-09 and 2026-10, a reconciled one for 2026-04, and the probe entries in those months (`CLTEXC01`–`CLTEXC06`). The open statements block their months' close until superseded.

## 6. How it was run

`/tmp/clt-g5/e2e-full.mjs <section>` — a Playwright driver outside the repo (not committed; it drives the running dev server and needs `G5_EMAIL`/`G5_PASSWORD` in the environment). Screenshots from the pass before the fixes are in `/tmp/clt-g5/full/shots/`, including `_reconcile_manual.png` taken before fix 1 and `ledger-search.png` after fix 2. The script is scratch tooling; the durable regression coverage is the repository suites named in §1.

## 7. Second full sweep: every screen, control and flow (2026-11-07)

A second pass over all 21 routes with the same instruction ("every screen, every button, every text, every form"), run against the local dev server at a Pixel 5 viewport in desktop Chromium, in thirteen batches. 111 checks were driven; 9 defects were found and fixed in the working tree.

### 7.1 What was driven, and with what result

| Batch | Screen / flow | Result |
|---|---|---|
| Inventory | all 21 routes | 21/21 `200`, no duplicate ids, no horizontal overflow, no console errors |
| Links | 21 internal hrefs | 20 resolve, 1 broken (`/settings` → 404; **defect 1**) |
| 1 | auth: guards, login, sign-out (desktop + mobile), callback, session reload | 11/11 |
| 2 | `entries/new`: save gating, five methods, `requires_txn_ref` rules, live breakdown, VAT > gross guard, real save + sync, ledger presence | 12/12 |
| 3 | `ledger`: search, miss state, clear, filter drawer, voided filter, reset, Escape, keyboard detail, void with mandatory reason | 8/8 |
| 4 | `reports`: month switching against DB totals, CSV, Excel, `window.print`, View Entries deep link, method cards | 7/7 |
| 5 | `settlements`: four cards, month nav, detail, record-payment modal, payment written | 6/7 — **defects 3 and 5** |
| 6a | `reconcile/manual` (Mode A): payable list, empty/invalid amounts, out-of-tolerance note, submit, cancel | 6/6 |
| 6d | `reconcile`: reconcile and supersede modals, note gating, execution | 6/6 |
| 7b/8 | `reconcile/upload` (Mode B): preview, create, accept, finalize | 6/6 after **defect 7** |
| 9 | `dashboard` (sections, 16 links, disabled actions) and `months/close` readiness | 5/6 — the failure was the check's own assumption (2026-01 and 2026-04 legitimately pass all three gates); 2026-11 is correctly blocked by "Pending Reconciliation" |
| 10 | `admin` hub (10 destinations), `admin/settings` save + reload + restore, `admin/audit` filter/reset, `admin/methods` add/edit, `admin/payables` add | 14/14 |
| 11 | `admin/rates`, `admin/devices`, `admin/stale-reviews`, `admin/users` (invite validation, transfer guard) | 10/11 — the failure was the check's assumption that the rate draft is a dialog; it is an inline form |
| 11b | `admin/rates` validation: over-100%, empty commission, future effective date | 4/4 after **defect 9**; a future effective date is accepted by design (the RPC only rejects past dates) |
| 12 | `settlements/[id]`: payment, then partial reversal, then overpayment and Owner surplus approval | 13/13 after **defects 3, 4 and 5**; the approval button is enabled by default but its submit validates the mandatory reason |
| 13 | Mode B upload against a month already carrying a Mode A manual statement | blocked with a readable explanation and a disabled action after **defect 8** |

### 7.2 Defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 1 | The sidebar Settings link pointed at `/settings`, which 404s, and was shown to every role | `Sidebar.svelte`: `/admin/settings`, moved inside the admin/owner block |
| 2 | Payment-method buttons on the entry form exposed no selected state to assistive tech | `aria-pressed={selectedMethodId === m.id}` |
| 3 | The payment and reversal modals are both mounted on `settlements/[id]`, so `#pay-amount`, `#pay-date`, `#pay-ref`, `#pay-file`, `#pay-note` and `#btn-submit` existed twice; labels bound to the wrong field | `RecordPaymentModal.svelte` prefixes every id with `reversal-` when `isReversal` |
| 4 | `OverpaymentApprovalModal` reused `#btn-submit`, colliding with the payment modal | renamed `#btn-approve-overpayment` |
| 5 | Recording a payment threw Svelte `each_key_duplicate`: the new payment was prepended to a list that the cache reload had already added it to | both `onsuccess` handlers dedupe by id |
| 6 | Mode A reconciliation surfaced the raw server code `payable_already_covered_by_active_statement` | mapped to a sentence naming the month and the covering option |
| 7 | The floating New Entry pill covered the bottom-right primary buttons on the Mode B supersede dialog, so real clicks landed on the pill | `draggable.ts` now avoids the primary-action rects at rest as well as during a drag, and re-settles on a debounced `MutationObserver`; both observers and timers are disposed |
| 8 | A month holding a Mode A `manual_total` statement made Mode B a dead end: the supersede request always failed with `422 manual_total_forbids_lines` | the upload page's existing-statement check no longer filters to file statements; for a manual statement it explains why a file cannot replace it, offers no supersede action, and shows a disabled blocked button after parsing |
| 9 | An empty commission field on `admin/rates` left Save Draft and Publish enabled (`NaN` comparisons are always false), so the form posted and failed server-side | basis points are validated as whole numbers in 0–10000 for VAT, commission and method rates; Save, Publish and the publish dialog are disabled and an inline message is shown; `NaN%` no longer renders |

The server-side Zod schema already rejected the bad rate payload, and the RPC already rejected backdating and cross-mode supersede, so defects 8 and 9 were usability and feedback gaps, not money-path openings.

### 7.3 Not exercised, and why

- **Closing or reopening a real month.** Both are irreversible state changes on business data, so only the readiness evaluation and the disabled state were driven.
- **Owner transfer, user deactivation, device killswitch.** Each dialog was opened and its guard checked, then cancelled; the execution itself was not run.
- **Rates draft save and publication.** Only validation was driven; no new profile version was created.
- **Print output.** `window.print` is called and intercepted; the printed page itself was not inspected.
- **Device re-checks.** The Pixel 6a was not attached for this pass.

### 7.4 Test data left behind

An overpaid 2026-11 mastercard settlement (৳186.50 against ৳180.00, surplus ৳6.50 approved), its ৳1.00 payments and ৳0.50 reversal; Mode B statements for 2026-02, 2026-03 (line accepted, not finalized) and 2026-08 (open, ৳100.00), plus a finalized 2026-02 statement. The open statements block those months' close until superseded or finalized.

## 8. Resuming an open Mode B statement (`CLT-R-022`, 2026-11-07)

The page now accepts `?statement=<id>` and the Reconciliation overview offers **Resume Matching** on every open file statement (`#btn-resume-<id>`), which is the route back that was missing. Driven at Pixel 5 width against the local dev server:

| Step | Observed |
|---|---|
| Overview, month 2026-03 | `#btn-resume-fa48ce6e…` present, enabled |
| Click it | `/reconcile/upload?statement=fa48ce6e…`, workspace rendered, `Lines: 1 Matched: 0 Accepted: 1 Unmatched: 0` |
| Reload | same statement, same counts |
| Statement 2026-06, Unmatch then Match | `/reconcile/unmatch-line` `200` (Matched 1 → Unmatched 1), Match dialog lists the candidate entry, `/reconcile/match-line` `200` (Unmatched 1 → Matched 1) |
| Statement 2026-09, Accept a line | `/reconcile/accept-line` `200`, `Accepted: 0 → 1`, "Statement line accepted into audit log" |
| Reconcile with variance over tolerance | button disabled with "Variance exceeds tolerance (৳1.00)" until `#reconcile-note` holds text |
| `POST /reconcile/statements/reconcile` | `200`, status `reconciled` |
| Back on the overview | Resume button gone, row reads Reconciled |
| `Switch Statement` | returns to step 1 and drops `?statement=` |

Bad identifiers are handled without a dead end: an unknown id, a Mode A id and a non-open id each produce a plain sentence and clear the parameter.

Effect on the local data: the 2026-03 statement is now `reconciled` (note "SWEEP-RESUME…"), one line of the 2026-09 statement is `accepted`, and the 2026-06 line was unmatched and re-matched to the same entry. No month was closed.

### 8.1 Reaching those statements from the month-close checklist (`b78ed2b`)

`/months/close` used to show only "Pending Reconciliation" with no way through. Gate 1 now lists the open statements that block the selected month: Mode B rows carry **Resume Matching** (`#btn-blocking-resume-<id>`) straight to the statement workspace, Mode A rows carry **Finalize** to `/reconcile?month=<month>`, and a month whose outstanding payables have no open statement says so with a link to create one.

Observed at Pixel 5 width:

| Month | Checklist row | Action |
|---|---|---|
| 2026-09 | `bKash Merchant Charge · Mode B`, `#btn-blocking-resume-717bd561…` | click → `/reconcile/upload?statement=717bd561…`, workspace `Lines: 2 Matched: 0 Accepted: 1 Unmatched: 1` |
| 2026-10 | `bKash Merchant Charge · Mode B` | button present |
| 2026-11 | three Mode A statements, `#btn-blocking-reconcile-…` | click → `/reconcile?month=2026-11`, month input `2026-11` |
| 2026-08 (Gate 1 passed) | block absent | — |
| `/reconcile?month=banana` | — | falls back to the current Asia/Dhaka month |

`svelte-check` 0 errors / 0 warnings, `vitest` 219/219, `vite build` clean.

### 8.2 Back from the workspace to the checklist (`feat` follow-up)

The checklist link now carries `return=close` and the month, so the workspace's `#btn-back` reads **Back to Month Close** and returns to `/months/close?month=<the statement's month>`. Openings from the overview and direct visits still read **Back to Overview**.

| Check | Observed |
|---|---|
| `/months/close?month=2026-09` | month input `2026-09` (new `?month=` support, invalid values fall back) |
| Resume from the checklist | `#btn-back` text `← Back to Month Close` |
| Click Back | `/months/close?month=2026-09`, month input `2026-09`, statement still listed under "Open statements waiting on matching" |
| Resume from the overview (2026-10) | `#btn-back` text `← Back to Overview`, returns to `/reconcile` |
| Direct `/reconcile/upload` | `← Back to Overview` |

The checklist reads the local cache; a fresh device used to show Gate 1 as passed before its first pull. That is fixed in §8.3.

`svelte-check` 0 errors / 0 warnings, `vitest` 219/219.


### 8.3 Gate loading state on a device that has never synced (`a652a8d`)

`/months/close` judged the gates against Dexie, which is empty until the first pull completes, so a fresh device reported Gate 1 as **Passed** on a month with open statements and enabled the Close button. Local `server_cursor` in Dexie meta is now the readiness signal: without it the three gates read **Checking…**, a "Checking the local ledger cache…" banner (`#gates-loading`) explains why, and Close stays disabled. The checklist re-evaluates whenever a sync cycle settles, and an evaluation publishes only if its month is still the one on screen.

| Check | Observed |
|---|---|
| Cold device (IndexedDB and cursor wiped), pull delayed 2.5 s | 11 consecutive samples, ~2.56 s, all showing `Checking…` and a disabled Close |
| Same run, after the pull | Gate 1 `Pending Reconciliation`, blocking statement `bKash Merchant Charge · Mode B` listed |
| Any sample before the pull | no `Passed` verdict |
| Warm synced device, 2026-08 | Gate 1 `Passed`, Close enabled, no `#gates-unsynced` caveat |
| Offline / error | no longer shows a verdict at all (see §8.4) |

`svelte-check` 0 errors / 0 warnings, `vitest` 219/219.


### 8.4 Dev offline worker, and the offline gate state it exposed (`a528b06`, `16589ac`)

Adding a dev-only service worker (`/dev-offline-sw.js`, served by a `serve`-only Vite plugin, network-first with a cached shell, cache stamped per dev-server start, `/api/*` never intercepted) made an offline reload possible for the first time. It immediately showed a defect §8.3 had only described in theory: with no completed pull the offline fallback printed Gate 1 as **Passed** from an empty cache and left Close enabled.

A device that has never pulled now reads **Not synced** on all three gates, shows a caveat ("the gates cannot be checked here and month close stays disabled"), hides the blocking-statement list and the cannot-close reasons (both would be guesses), and keeps Close disabled until a pull lands.

| Check | Observed |
|---|---|
| Dev worker registration | active at scope `/`, cache `clt-dev-offline-<stamp>` |
| Warm shell | 126 cache entries, shell `/` present, 29 Svelte modules |
| Offline reload at `/months/close?month=2026-09` | viewport rendered the app ("Offline" indicator, Month Close), no hang |
| Gates offline, never synced | `Not synced`, caveat `#gates-unsynced` present, Close disabled |
| Reconnect + reload | caveat gone, Gate 1 back to `Pending Reconciliation` |
| Synced device, 2026-08 | `Passed`, Close enabled, no caveat |
| Cold device online, pull delayed 2.5 s | 10 samples over 2.37 s of `Checking…`, never `Passed`, settles to Pending |
| Production build | `vite build` clean; no `dev-offline-sw` string in the output, so the dev worker never ships |

`svelte-check` 0 errors / 0 warnings, `tsc --noEmit` 0, `vitest` 219/219.


### 8.5 Offline entry save and flush (verification only, no code change)

Exercised the offline-first path now that §8.4 makes an offline reload possible: Pixel 5 viewport, route warmed online, network cut, entry saved, network restored.

| Check | Observed |
|---|---|
| Offline route render | `/entries/new` reloaded from the dev cache with the "Offline" indicator |
| Save latency offline | 99 ms, accepted with no network (Hard Rule 6) |
| Local record | `#LOCAL-a2f33a`, `gross_poisha` `123456`, status `active` |
| Outbox | one pending operation |
| Flush after reconnect | entry number `E-202611-000162`, `server_seq` `193`, outbox drained in 1.04 s |
| Fresh device pull | same entry number and components returned from the server |
| Poisha conservation | `vat 0 + commission 51852 + businessCharge 0 + net 71604 === gross 123456` (profile commission 42%, manual VAT, no method charge on this method) |
| Test data cleanup | entry voided through the ledger UI with a reason, flushed, and confirmed `voided` from a clean-cache device |

Two notes. A dev-only worker caches what the server has already served, so a route never opened online cannot load offline in dev; production precaches every chunk, so this is not a shipped limitation. And a sweep assertion on the confirmation text read the shortest matching node ("Offline #LOCAL-xxxx") instead of the full sentence; the save itself was verified from the stored record and the flush, not from that string.


### 8.6 Offline void and its audit trail (verification only, no code change)

Entry `E-202611-000163` was created online, then voided with the network cut and the device reloaded offline from the dev cache.

| Check | Observed |
|---|---|
| Ledger offline | target entry renderable from cache while offline |
| Void offline | status `voided` in Dexie 828 ms after confirming, reason stored word for word, `navigator.onLine` false |
| Outbox | one op, type `void_entry`, status `pending` |
| Offline UI | ledger shows the voided state with no network |
| Flush after reconnect | outbox empty in 1.03 s; `server_seq` advanced to 196 |
| Server truth | clean-cache device pulls `voided` for the same entry number |
| Audit row | `entry.void` on `entries` / entry id, `before {"status":"active"}` → `after {"status":"voided"}`, actor = the signed-in owner, exactly one event for the entry |
| Admin viewer | `/admin/audit` filtered to `entries` + `void` lists the event as `entries:e37d5512...` with actor and `{"status":"voided"}` |

**Finding, fixed in §8.7:** in the ledger list a voided row was marked only by `opacity-40` and `line-through`, with no text, so the state was conveyed by styling alone (WCAG 1.4.1).


### 8.7 Voided label in the ledger list

`LedgerRow.svelte` now renders a `Voided` chip next to the customer name when `entry.status === 'voided'`, matching the existing `Pending Sync` / `Stale Rate` badge style. The row keeps its `opacity-40` and `line-through` treatment; the chip itself is undecorated (`text-decoration-line: none`), so it stays readable.

Verified in the browser: voided row `E-202611-000163` reads "… 1794058031238 **Voided** Units: 1 …" and the word is part of the row's accessible name; an active row (`E-202611-000125`) carries no label, no strikethrough and full opacity. `svelte-check` 0 errors / 0 warnings; `vitest src/lib/ledger` 9/9.


**Re-run at HEAD `44e2337` (2026-11-07), after the Voided chip landed:** entry `E-202611-000164` created online (`server_seq` 197), voided offline in 731 ms with the reason stored verbatim and `void_entry` queued, ledger row showing "Voided" **and** "Pending Sync" side by side while still offline; after reconnect the outbox drained in 1.03 s (`server_seq` 198), one audit row `entry.void` recorded `active → voided` with the owner as actor, and a clean-cache device pulled `voided`. 10/10 checks passed.


**Re-run at HEAD `44e2337` (2026-11-07):** entry `E-202611-000165` saved with the network cut in **77 ms**, confirmation read "Saved offline as #LOCAL-ea9c38 — pending background sync.", local record `sync_status: pending` with `create_entry` queued, and the offline components already conserving the gross (`0 + 98 518 + 0 + 136 049 = 234 567`). After reconnect the op flushed in **1.04 s** to `E-202611-000165` / `server_seq` 199 with the same gross and net, and the `entry.create` audit row carries the rate snapshot (version 1, commission 4200 bp, manual VAT). 12/12 checks passed.

One test-harness caveat worth repeating in future runs: `executeEntryVoid` writes the entry row and then the outbox row, so a sampler that polls between the two sees `voided` with an empty outbox and can end the run before the push. That is what happened on the first cleanup attempt here — the entry stayed active server-side until a second pass that waited for `sync_status !== 'pending'` as well. The application behaviour is correct; the wait condition in a sweep must include the sync status, not only the item count.


### 8.8 Offline reloads across the route set (dev service worker)

The dev-only worker from §8.4 was exercised over every page route, not just one. The build has no production impact (`apply: 'serve'`; after `vite build` neither `dev-offline-sw` nor `clt-dev-offline` appears anywhere in `build/` or `.svelte-kit/output/`).

| Check | Observed |
|---|---|
| Worker registration | active at scope `http://127.0.0.1:5199/`, `activated` |
| Cache after visiting all 18 routes online | one `clt-dev-offline-*` cache, 197 entries, 172 of them scripts/modules |
| Offline reload of each route | 18/18 rendered their own content (page heading present) with the **Offline** badge, no crash page and no page errors |
| Offline in-app navigation | dashboard → ledger via a real in-app link, 34 cached entries rendered, no network |
| Uncached route | a route never opened online still cannot load offline in dev, because the worker caches what the server has already served (production precaches every chunk) |

**Fixed during this run:** `/admin/audit` was the one route that failed offline, throwing an unhandled `Failed to fetch` because `loadAuditLog` used `try/finally` with no `catch`; the page rendered its header and then nothing. It now catches, clears the table and shows a red banner ("The audit log is server-side only and needs a connection…"), matching the error banner pattern already used on `/admin/devices`. Verified: online loads 50 rows with no banner; offline reload shows the banner and logs no unhandled error; reconnecting clears the banner and reloads 50 rows. `svelte-check` 0 errors / 0 warnings; route sweep 18/18 after the fix.


### 8.9 Statement workspace returns to the month-close checklist

The checklist's own "Resume Matching" button already passed `return=close&month=…`, but the reconciliation overview dropped it: `#btn-resume-<id>` and the Mode B upload button built `/reconcile/upload?statement=…` with no origin, so a workspace entered through the overview said "Back to Overview" and returned to `/reconcile`.

Now `months/close` hands off with `return=close` on both of its reconciliation links ("Create one in Reconciliation" and "Finalize"), the overview carries that origin via one `workspaceHref()` helper, and the workspace's existing unmatched behaviour is unchanged.

Verified in the browser: checklist → overview → Resume Matching opens `/reconcile/upload?statement=…&return=close&month=2026-09` labelled "Back to Month Close", and Back lands on `/months/close?month=2026-09`; the overview's Upload button likewise carries the origin and its Back returns to the checklist; a workspace reload keeps the origin; and an overview opened *without* `return=close` still routes Back to `/reconcile` with no origin injected. `svelte-check` 0 errors / 0 warnings.

Not exercised: the "Create one in Reconciliation" empty-state link. No month in the current data set reaches that branch (every month either has an open statement or passes gate 1), so that edit is verified only by reading the rendered source, not by a click.


### 8.10 Resuming an open Mode B statement (verification, re-confirms `df825fa`)

Already implemented: `?statement=<id>` reopens an open file-sourced statement (from the overview's Resume Matching, the month-close blocking list, or a pasted URL), with `Load Active Statement` restoring its lines, covered entries, payable association and the finalize panel. Verified again at HEAD `b5abd7e` in a fresh browser context, i.e. a later session after the page was left.

| Check | Observed |
|---|---|
| Resume by URL, 2026-07 statement | "Success: Resumed the open statement for 2026-07-01", `Lines: 1 Matched: 1 Accepted: 0 Unmatched: 0` |
| Match after resume | Unmatch (reason mandatory) → `Lines: 1 Matched: 0 Unmatched: 1`; Match dialog lists the covered entry; Select → back to `1/1/0/0` |
| Finalize after resume | button enabled, "All completion criteria satisfied", variance ৳0.00 within tolerance; with the line unmatched it is disabled and reads "1 statement lines still unmatched" |
| Accept path | dialogue opens with its mandatory review-note field and the audit explanation; not submitted |
| Mode A statement URL | redirected with "…entered as a Mode A total, so it has no lines to match. Supersede it from the Reconciliation overview instead." and `?statement=` dropped |

Not executed: Accept and Reconcile Statement, which write audit rows and flip month-close gate 1 for 2026-07. Their guards, enabled states and criteria were checked; the writes were left for a run Zia authorises.

Fixture caveat found: the 2026-09 statement (`717bd561…`) carries lines dated 2026-11 while September has no entries in the data set, so resuming it shows an empty candidate list. That is leftover test data, not a code path — matching there cannot succeed for any entry. The 2026-07 statement is the usable Mode B fixture.


### 8.11 Superseded label in the ledger list

Same defect as §8.7, for the other styling-only state: a superseded row was marked only by `opacity-50`. `LedgerRow.svelte` now renders a `Superseded` chip beside the customer name (`{:else if isSuperseded}` after the Voided branch, so the two never stack — a row is one or the other).

No superseded entry exists in the data set (`counts: {active: 29, voided: 5}`), so the render was proven by marking one cached test entry `superseded` in Dexie, checking the row, then restoring it. The server row was never touched: `E-202611-000125` read "… Playwright Test Customer **Superseded** Units: 1 …" with `opacity: 0.5`, no strikethrough, chip `text-decoration-line: none`, and the label inside the row's accessible text; after restoring to `active` the row showed no chip and full opacity. `svelte-check` 0 errors / 0 warnings; `vitest src/lib/ledger` 9/9.

Caveat: that is a rendering check against a synthetic cache state, not a supersede transaction. It proves the component's presentation, not the supersede flow.
### 8.12 Offline supersede to the server, with its audit trail

Requested check: a supersede made with the network cut must reach the server and leave the same audit trail as an online one. Driving it found the path was broken twice over.

| Defect | Evidence | Fix |
|---|---|---|
| `Edit / Supersede` in the entry drawer threw `TypeError: Cannot read properties of null (reading 'id')` and never navigated (`EntryDetailDrawer.svelte` `handleSupersedeClick` called `onclose()` — which clears the parent's selection — before reading `entry.id`) | clicking the button left the URL at `/ledger` with that page error on the console | read the id before closing; `svelte-check` 0/0, navigation then lands on `/entries/new?supersede=<id>` |
| Every supersede was rejected by the server: `new row for relation "entries" violates check constraint "chk_reassign"` | captured `POST /api/v1/sync/push` → `{status:"rejected", reason:"new row for relation \"entries\" violates check constraint \"chk_reassign\""}` | `rpc_supersede_entry` wrote the original date into `original_entry_date` unconditionally, while `chk_reassign` demands a non-empty `reassign_reason` and a different date whenever that column is set — so the normal same-date correction could never pass. PRD §7.3 only stores the date a closed-month reassignment sends. Migration `20261107000001_fix_supersede_reassign.sql` normalises the reason and leaves the original date null unless one is sent |

Run after both fixes, Pixel 5 viewport, local Supabase, dev server `127.0.0.1:5199` (16/16):

| Step | Observed |
|---|---|
| Original entry | `E-202611-000174`, active, synced, `server_seq` 215, gross 90000 |
| Open from the ledger | `?supersede=561d2216…`, banner "Superseding Entry", gross prefilled `900.00` |
| Form reloads offline | banner kept, `navigator.onLine` false, gross still `900.00` |
| Save offline | 304 ms, "Saved offline as #LOCAL-b88e41 — pending background sync." |
| Local state | original `superseded` immediately; replacement `#LOCAL-b88e41`, gross 95000; outbox holds one `supersede_entry`, pending |
| Flush after reconnect | 1.03 s → replacement `E-202611-000175`, `server_seq` 217, outbox empty, nothing pending |
| Audit | exactly one `entry.supersede` on the original: `before {status: active}` → `after {status: superseded, replacement_entry_id: b88e4185…}`, `actor` = the signed-in owner; the replacement adds no second creation row, which is what PRD §15.1 defines (the pair shares one event) |
| Reassignment fields | replacement has `original_entry_date` null and `reassign_reason` null (no phantom reassignment) |
| Clean device | fresh profile pulls the pair: original `superseded`, replacement `E-202611-000175` gross 95000 |
| Cleanup | replacement voided through the UI (`E-202611-000175` → `voided`) |

Also observed, not fixed: the audit `after` key is `replacement_entry_id` while PRD §15.1 names it `superseding_id`. Cosmetic contract drift, left for a decision since the audit UI prints the raw object.

Harness incident: `pnpm test` executes `tests/db/*.test.ts`, whose `beforeAll` deletes `statement_lines`, `statements`, `settlements`, `payables`, `entries`, `rate_profiles`, `payment_methods` and `devices` before seeding, and then aborts on `duplicate key value violates unique constraint "one_owner"` against a database that already has the bootstrap owner. Three suites fail and the dev database is left empty (entries 0, rate profiles 0, methods 0). `pnpm db:bootstrap` restored the baseline (5 methods, 5 method rates, 1 published profile, 4 payables) and the run above was made on that restored database; `audit_log` was never touched (181 rows kept). This is recorded as `CLT-R-025`.
