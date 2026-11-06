# Risk Register — Cosmo Ledger Track

Created: 2026-11-06, per `ORCHESTRATOR.md` §13 and `G0_READINESS_CHECKLIST.md` §3.
Owner of this file: the orchestrator. Severity uses AGENTS.md §6: **Blocker**,
**Major**, **Minor**. A Blocker is never closed (AGENTS.md §6); it can only be
resolved by evidence and then marked `RESOLVED` with that evidence named.

Status words: `OPEN`, `MITIGATING`, `RESOLVED`, `ACCEPTED` (Zia's written
acceptance, with the decision ID).

## 1. Register

| ID | Risk | Severity | Owner | Mitigation | Status | Source |
|---|---|---|---|---|---|---|
| CLT-R-001 | Q1–Q4 business policies (VAT rule, net definition, commission structure, charge bearer) unconfirmed before production; a wrong default silently miscalculates every entry | **Blocker** | Zia | `OWNER_DECISION_PACKET_Q1_Q4.md` gives seeded defaults, the net identity proof, and copy-paste `CLT-POLICY-Q1..Q4` blocks; `build-android.sh` refuses an `.aab` until the four `Status: CONFIRMED` markers exist | OPEN | AGENTS.md Rule 20; `DECISIONS.md` §3 |
| CLT-R-002 | Gate 5's physical-device proof is incomplete. A first hardware run happened on 2026-11-06 (Pixel 6a, Android 17): H1, H2, H9 and H16 pass, but H3–H8 fail or are blocked by `CLT-R-012`, and H10/H12–H14 fail per `CLT-R-013`. `ANDROID_HOME`/`adb` are still not on the PATH — the run exported `$HOME/android-sdk` per command | Major | Zia | `GATE5_PHYSICAL_DEVICE_CHECKLIST.md` (35 checks, evidence and sign-off fields) plus `reports/GATE5-DEVICE-RUN.md`; fix R-012/R-013/R-014, then re-run the remaining items; Gate 5 cannot be signed on partial evidence | OPEN (progress 2026-11-06) | `reports/GATE5-DEVICE-RUN.md`; checklist GS-1 |
| CLT-R-003 | Reconciliation Mode B is blocked on real bKash/card statement samples (Q14); adapters cannot be validated against formats nobody has seen | Major | Zia | obtain one real statement of each kind, redacted; until then Mode A (totals-only) remains the shipping path and Month close stays gated on it | OPEN | TOC row 018; AGENTS.md §8 |
| CLT-R-004 | No CI exists; every verification is a manual re-run on the dev machine, so a claim can be stale or unreproducible | Major | Orchestrator | record commit SHA with every result; re-run from a clean checkout for milestone sign-off; `.github/workflows/daily-backup.yml` exists but no runner or secrets are verified | OPEN | AGENTS.md §2, §10 |
| CLT-R-005 | Backups and restore are unproven: no bucket credentials, no `aws` CLI on the dev machine, no restore drill executed, no deploy to attach the workflow to | Major | Zia | `scripts/ops/backup-export.ts`, `restore-drill.ts`, runbooks; drill against a throwaway bucket once credentials exist; G5 requires a passed restore drill | OPEN | `CLT-D-025`; AGENTS.md §10 (G5) |
| CLT-R-006 | Orchestration discipline is retrospective: G0 unsigned, roster `ORCHESTRATOR.md` §5 still `<fill>`, Rhizome hub ID UNSET, CLT-T-050's brief written after the defect was found — so gates cannot prevent scope drift, only document it | Major | Zia | sign G0 (`CLT-D-026`), fill the roster, create the hub; briefs and reports now archived under `docs/orchestration/` | OPEN | `G0_READINESS_CHECKLIST.md` §2; AGENTS.md §10 |
| CLT-R-007 | FloatingMenu could not be activated by keyboard or real pointer input: the region `preventDefault()`ed bubbled Enter/Space, and the dock was computed from pre-layout fallbacks so the pill settled 45 px off-screen and swallowed taps | Major | A-IMPL-1 | fixed in `74bfcb1`: target-checked key handler, presses on controls never drag or capture, capture from the neutral press, dock re-settled after real layout; 8 e2e cases prove real click and real Enter | RESOLVED 2026-11-06 (hardware confirmation still covered by CLT-R-002) | `reports/CLT-T-050.md` |
| CLT-R-008 | The automated Gate 5 check can be mistaken for Gate 5: outside M2 `verify-gates.ts` scores Gate 5 as "`pnpm test:e2e` exited 0", which tests no device, no contrast measurement, no `prefers-contrast`, no `prefers-reduced-transparency`, no haptics, no WebView fallback | Major | Orchestrator | the device checklist supplies the missing proof and the gate report must state the limitation; extend the script in a later task (DR-2) | OPEN | `GATE5_PHYSICAL_DEVICE_CHECKLIST.md` GS-4, §9 caveat |
| CLT-R-009 | PRD §14.5 requires screens < 640 px to dock into a bottom sheet bar; the implementation only clamps and dodges, and no bottom-sheet bar exists in `apps/web/src` | Minor | Zia | decide DR-1: accept dodge-only as the behaviour and record the divergence, or schedule the bar | OPEN | `GATE5_PHYSICAL_DEVICE_CHECKLIST.md` GS-5 |
| CLT-R-010 | `README.md` drifts from the PRD: cites PRD v1.7 (actual v1.19), lists PostGIS (the PRD does not), says "Vanilla CSS" (PRD says Tailwind 4 + CSS variables) | Minor | Orchestrator | rewrite README from the PRD on Zia's word; until then the PRD and AGENTS.md win | OPEN | AGENTS.md §7 open findings 1 |
| CLT-R-012 | **The packaged Android app cannot reach its backend.** `apps/web/vite.config.ts` sets `envDir` but no `envPrefix`, so Vite exposes only `VITE_*`; the app reads `import.meta.env.PUBLIC_API_BASE` / `PUBLIC_SUPABASE_URL`, which are `undefined` at build. Measured on the Pixel 6a: `/api/v1/*` resolves to the app's own asset server and returns `index.html` with HTTP 200; no payment method hydrates; `#btn-save` stays disabled — a staff user cannot record an entry on the device | **Blocker** | Implementer | add `envPrefix: ['PUBLIC_','VITE_']` (or move to `$env/static/public`) and rebuild; then re-prove H3 and H5–H8 on hardware | OPEN (found 2026-11-06, `reports/GATE5-DEVICE-RUN.md` §4) | `reports/GATE5-DEVICE-RUN.md`; `grep -rl "127.0.0.1:5174" apps/web/build/_app/immutable` → no match |
| CLT-R-013 | **The floating menu cannot be dragged by touch.** Its neutral surface is a ~9 px strip (rows 0–8 of 64); a touch inside it is delivered to the "New Entry" anchor (`pointerdown@A`, `interactive: true`) via the browser's touch-target adjustment, so the drag guard correctly refuses. The same drag with a mouse moves the menu and persists its position | Major | Implementer | give the pill a ≥44 px grab affordance (handle or non-interactive padding band with `touch-action: none`) instead of a 9 px strip | OPEN (found 2026-11-06) | `reports/GATE5-DEVICE-RUN.md` §4; hit-map and `Network`/pointer captures quoted there |
| CLT-R-014 | **The self-hosted fonts are 31-byte stubs.** `static/fonts/*.woff2` contain a bare `wOF2` header and no glyphs, so on every platform `document.fonts` reports `Geist:error` / `Noto Sans Bengali:error`; PRD §14's Geist, tabular figures and Bengali fallback have never rendered | Major | Implementer | ship the real font files (or remove the `@font-face` blocks and record the deviation), then re-check on device | OPEN (found 2026-11-06) | `reports/GATE5-DEVICE-RUN.md` §4; console OTS errors |
| CLT-R-011 | Seeded `bank_transfer` carries `requires_txn_ref = true`, while PRD §4 Q15 lists mandatory references only for bKash, Visa and Mastercard; the seed may be stricter than intended | Minor | Zia / Admin | confirm the business rule (DR-3); the change is an admin edit to `payment_methods`, not code | OPEN (UNVERIFIED whether it is wrong) | `OWNER_DECISION_PACKET_Q1_Q4.md` §5 observation 1 |

## 2. Closed items, kept for traceability

| ID | What was risked | Resolved by |
|---|---|---|
| CLT-R-007 | Floating menu inoperable by real input | `74bfcb1`; `reports/CLT-T-050.md`; unit 209/209, e2e 9/9 |

## 3. Review rules

1. A risk is `RESOLVED` only with an artefact: a commit, a pasted command
   output, or a dated Owner decision ID.
2. Severity `Blocker` stays visible even when mitigated; mitigation lowers
   exposure, it does not remove the item (AGENTS.md Rule 16 — no absolute
   claims).
3. New risks discovered while implementing a plan are added here by the
   orchestrator, not by the implementer, except where a brief says otherwise.
4. Each milestone review re-reads every `OPEN` row and records whether it moved.

## 4. Changelog

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-11-06 | File created with `CLT-R-001`…`CLT-R-011` seeded from `G0_READINESS_CHECKLIST.md` §3 and evidence gathered this session; `CLT-R-007` recorded as resolved by `74bfcb1`; `CLT-R-008`…`CLT-R-011` added from Gate 5 and packet findings. |
