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

## 5. How it was run

`/tmp/clt-g5/e2e-full.mjs <section>` — a Playwright driver outside the repo (not committed; it drives the running dev server and needs `G5_EMAIL`/`G5_PASSWORD` in the environment). Screenshots from the pass before the fixes are in `/tmp/clt-g5/full/shots/`, including `_reconcile_manual.png` taken before fix 1 and `ledger-search.png` after fix 2. The script is scratch tooling; the durable regression coverage is the repository suites named in §1.
