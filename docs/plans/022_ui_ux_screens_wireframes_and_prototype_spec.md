# 022_ui_ux_screens_wireframes_and_prototype_spec.md — Complete UI/UX Plan, Screen Specs & Stitch Handoff

- Plan Identifier: CLT-PLAN-022 (overlay plan — not in build order; consumed by Plans 007–018)
- Parent Document: `docs/plans/PRD-payment-ledger-app.md` (v1.19)
- Companion File: `docs/plans/022_stitch_prompts.md` (Google Stitch visual handoff prompts)
- Consumed by: 007 (tokens/UI kit), 008 (shell), 009 (admin), 010 (entry), 012 (ledger), 013 (reports), 014 (settlements), 015 (reconcile A & close), 016 (dashboards), 018 (reconcile B)
- Revision: 2.2 — 2026-11-02
- Author role: UI/UX Architect (AI)
- Purpose: Eliminate every degree of freedom the coding model could drift on. Every screen, region, component, state, copy rule, route path, and number format is pinned here. Where this file and the PRD disagree, the PRD wins; where the PRD is silent, this file wins and the choice is recorded in `DECISIONS.md`.

---

## 0. Blunt conclusions

1. **There are 30 buildable screens, sub-routes, and modal workflows (S01–S27 plus S13b, S15b, S26b) mapped directly to the SvelteKit route hierarchy.** The PRD outlines the functional areas; the real work is the state matrix (offline, pending-sync, closed-month, overpaid, stale-rate, rejected-op). SvelteKit route paths must strictly match downstream plans (including sub-routes under `/admin/*`, `/settlements` and `/settlements/[id]`, `/reconcile`, `/reconcile/manual`, `/reconcile/upload`, and `/months/close`). Section 3 gives the unified inventory.
2. **The four highest drift risks, in order:**
   - (a) Money display (South Asian grouping `1,23,456.00`, 2-decimal poisha, `tabular-nums`, bigint string → BDT via shared `formatPoishaToBdt`, never hand-formatted).
   - (b) The always-visible sync indicator (4 states per PRD §9.2).
   - (c) Glass surfaces leaking onto long lists or headers (performance bug + spec violation, PRD §14.3; backdrop blur is restricted to floating menu, modals, buttons, and desktop sidebar).
   - (d) Role-conditional chrome and route guards (Staff vs Admin/Owner navigation and server route gating, PRD §3).
3. **Google Stitch is a visual-pattern generator, not a product designer.** It cannot express offline logic, state matrices, or the floating menu's collision avoidance. Use Stitch for exactly one thing: a static visual pass on the 6 hero screens to validate look-and-feel before the coding model starts. The Stitch prompts are in Section 9 and the companion file `022_stitch_prompts.md`. Do NOT feed Stitch's output to the coding model as markup — only as image references.
4. **Plan 007's tokens are final.** The coding model does not pick colors, radii, fonts, or category colors. Any new color/radius/font must be added to `tokens.ts` + `tokens.test.ts` first.
5. **Every screen must be specified as: layout regions → components → data fields → states → copy catalog keys.** Section 4 gives the global chrome wireframes; sections 5–7 apply it per route group.

---

## 1. Non-negotiable global rules (numbered, testable)

| # | Rule | Source | Enforcement |
|---|---|---|---|
| R1 | UI copy strings adhere to message catalog key namespace `screens.<id>.<element>` (or `common.<element>`). Defined in `apps/web/src/lib/i18n/messages.ts` with English string dictionaries for v1, prepared for multi-lingual localization in Phase 6. | PRD §12, §14 | grep CI check |
| R2 | All money amounts render via the shared package formatter `formatPoishaToBdt(poisha: bigint): string` (exported by `@clt/shared`; aliased as `formatBdt`) → South Asian grouping `1,23,456.00`, always 2 decimals, `৳` prefix, `font-variant-numeric: tabular-nums`. Never hand-format or truncate poisha (`/ 100n` without 2 decimals). **Note: The formatter returns the string WITH the `৳` symbol. Do NOT prepend `৳` in templates (`৳{formatPoishaToBdt(...)}` produces an invalid double `৳৳` prefix).** | PRD §12, Q12 | unit test on formatter |
| R3 | Wire/Dexie amounts are decimal strings; parsing to `bigint` only at I/O boundary. UI never does float math. | PRD §9.1 | typecheck |
| R4 | Backdrop blur ONLY on: floating menu, modal/sheet, buttons, desktop sidebar. NEVER on header, list rows, tables, or cards containing long lists (solid `--surface` with 1px `var(--pearl-border)` for 60fps scrolling performance). `Card.svelte` defaults to `variant="solid"` (non-glass container with solid `--surface` and pearl border); `variant="glass"` is used only on floating overlays. UI primitives for data rows must use native `div` or solid `Card` to prevent glass leakage. | PRD §14.3 | code review + lint |
| R5 | Touch targets ≥ 44×44px (`min-h-[44px] min-w-[44px]`). Applies to all interactive buttons, inputs, selects, segmented controls, tabs, and category radio chips. | PRD §14 (plan 007) | tokens test |
| R6 | Category colors used ONLY via `categoryColors` map + `Chip` variants `commission/vat/bkash/visa/mastercard`. Meaning never carried by color alone (always paired with text/label). | PRD §14.6 | grep for hex in components |
| R7 | Dark mode is a first-class requirement, not a toggle decoration. Every screen specified below ships both themes. | PRD §2 G7 | visual test §16.3 #5 |
| R8 | `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more` must render correctly on every screen. | PRD §14.6 | Playwright |
| R9 | The sync indicator is visible on EVERY authenticated screen, in the header, same position, 4 states: `Synced` (green dot), `Syncing...` (spinner), `Offline (n pending)` (amber dot + count), `Error (tap to retry)` (red). | PRD §9.2 | e2e |
| R10 | Staff sees: New Entry, Dashboard, Ledger. Admin/Owner add: Reports, Settlements, Reconcile, Admin. Staff blocked from `/reports`, `/settlements`, `/reconcile`, `/months/close`, and `/admin/*` at route guard level (`guard.ts`), not merely hidden. Admin blocked from Owner-only `/months/close`. | PRD §3 | route guard test |
| R11 | Save under 100 ms: entry form save writes Dexie + outbox, shows toast + "Pending sync" badge, never a blocking network call. | PRD §8.1, NFR | e2e offline |
| R12 | All business dates Asia/Dhaka; date pickers default to today (Dhaka); month pickers navigate prev/next. | PRD §12 | calc fixture test |
| R13 | Every destructive/admin action is confirmed in `Modal` with mandatory reason field where the PRD says mandatory (void, discard, reopen month, ownership transfer). | PRD §8.2/8.4/8.6 | e2e |
| R14 | Number inputs accept max 2 decimal places; >2 rejected with "Maximum 2 decimal digits allowed". | PRD §9.1 | unit test |
| R15 | `txn_ref` input auto-normalizes `upper(trim())` live; display uppercase. | PRD §8.1 | unit test |
| R16 | Primary page-level and modal submit/action buttons carry `id="btn-save"` or `id="btn-submit"` to trigger mobile `FloatingMenu` collision avoidance. | PRD §14.5 | DOM selector check |

---

## 2. Visual DNA (the "look and feel", frozen)

**Concept: calm financial clarity.** Large readable numbers, generous space, one confident accent (dark jade), no indigo. Premium-but-warm fintech, not a dashboard SaaS.

| Layer | Spec | Frozen values |
|---|---|---|
| Canvas | Pearl grain background, applied once on app root. Gradient glow blobs (lilac `--pearl-b`, blush `--pearl-c`) behind menu/buttons only. Grain is static, never animated. | PRD §14.2 |
| Surfaces | Glass on chrome only (R4). Data surfaces = solid `--surface` cards, radius 18px. | PRD §14.3 |
| Buttons | Frosted glass, engraved gradient label with solid fallback, radius 14px, press sinks 1px. Variants: `default/commission/vat/bkash/visa/mastercard`. Primary action buttons carry `id="btn-save"` or `id="btn-submit"`. | PRD §14.4 |
| Typography | Geist (UI), Geist Mono for all amounts/IDs, Noto Sans Bengali fallback, self-hosted. Headings tight tracking; amounts `tabular-nums`. Scale: 12 (caption) / 14 (body) / 16 (emphasis) / 20 (card title) / 28 (hero number) / 36 (dashboard KPI). | PRD §14.1 |
| Color accents | Commission jade `#0B6B59`, VAT ochre `#8C4F00`, bKash magenta `#B80053`, Visa royal `#1A54B8`, Mastercard rust `#9E3600` (light; dark per tokens). | tokens.ts |
| Status colors | Synced `#0B6B59` / Pending amber `#8C4F00` / Error `#B80053`-family / Info Visa-blue. Reuse category tokens; no new status palette. | tokens.ts |
| Iconography | Text-first UI. Icons only: + (new entry), ☰ (menu), ✕ (close/dismiss), search, calendar, filter, chevrons. No icon font dependency; inline SVG or unicode per plan 007. | tokens.ts |
| Motion | 120–200ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`. Count-up on report totals, receipt-line stagger on breakdown card, skeleton loaders, View Transitions between routes. All disabled under reduced-motion. | PRD §14.6 |
| Density | Mobile-first; one-hand use target. Desktop = wide tables in fixed sidebar layout. | PRD §14.6 |

---

## 3. Screen & state inventory (30 screens, sub-routes, and modal workflows)

Aligned with SvelteKit route hierarchy across Plans `008`–`018`:

| ID | Screen | Route | Roles | Owner plan | States |
|---|---|---|---|---|---|
| S01 | Login / accept invite | `/login` | all | 008 | online / offline cached-session / set-password |
| S02 | App shell + role routing | `/(app)` layout | all | 008 | staff / admin / owner chrome, sidebar, floating menu |
| S03 | Staff dashboard | `/dashboard` | staff | 016 | online / offline cached / pending sync counter |
| S04 | Admin dashboard | `/dashboard` | admin | 016 | queues populated/empty / shop collections / review badges |
| S05 | Owner dashboard | `/dashboard` | owner | 016 | prior-month deltas / SVG trend daily bar chart / unclosed-month alert |
| S06 | New entry (Hero) | `/entries/new` | all | 010 | default / chip radio row / #LOCAL-xxxx / rates warning / duplicate warning / offline / closed-month warn |
| S07 | Entry form — supersede mode | `/entries/new?supersede=<id>` | admin, owner | 010, 012 | banner + prefill + supersede action |
| S08 | Ledger | `/ledger` | staff(own) / admin / owner | 012 | loading / empty / populated / offline cached / solid cards |
| S09 | Ledger detail drawer | (drawer over S08) | role-gated | 012 | active / void-requested / voided / superseded / pending-sync |
| S10 | Request void modal | (modal over S09) | staff/admin/owner | 012 | mandatory reason textarea |
| S11 | Approve / reject void modal | (modal over S09) | admin/owner | 012 | approve (void_entry RPC) / reject (clears request locally) |
| S12 | Reports month view | `/reports` | admin, owner | 013 | month nav / daily breakdown / SVG trend chart / entry list + totals row / export menu (PDF, CSV, XLSX) |
| S13 | Settlements overview | `/settlements` | admin, owner | 014 | 5-state rows / due/overdue / progress bars / reminders |
| S13b| Settlement detail & history | `/settlements/[id]` | admin, owner | 014 | payment rows / receipt signed-URL previews / reversals / overpayment approval |
| S14 | Record payment modal | (modal over S13b) | admin, owner | 014 | payment recording / reversals / receipt upload (5MB, magic bytes) |
| S15 | Reconcile Mode A overview | `/reconcile` | admin, owner | 015 | monthly statements list / live variance / tolerance note |
| S15b| Reconcile Mode A manual entry | `/reconcile/manual` | admin, owner | 015 | manual statement total form / payable group selection |
| S16 | Closed-month recovery queue | (modal over S15) | admin, owner | 015 | reassign / reopen / discard (3-way recovery) |
| S17 | Month close / reopen | `/months/close` | owner | 015 | checklist gating UI / mandatory reopen reason |
| S18 | Reconcile Mode B file upload | `/reconcile/upload` | admin, owner | 018 | upload / header detection / 2-pass matching / accept line / combined card |
| S19 | Admin — rates & rules | `/admin/rates` | admin, owner | 009 | draft edit / publish guard / 100% deduction block |
| S20 | Admin — methods | `/admin/methods` | admin, owner | 009 | requires_txn_ref toggle / sort order / active toggle |
| S21 | Admin — payables & schedule | `/admin/payables` | admin, owner | 009 | due_day 1–28 / remind_days_before |
| S22 | Admin — settings | `/admin/settings` | admin, owner | 009 | reconcile tolerance / sync retention |
| S23 | Admin — hub overview | `/admin` | admin, owner | 009 | overview links / quick stats / pending review badges |
| S24 | Admin — users & roster | `/admin/users` | admin(staff-only), owner | 009 | user table / invite modal / role demote/promote / deactivation |
| S25 | Admin — devices | `/admin/devices` | admin, owner | 009 | device registry / hardware revocation killswitch |
| S26 | Admin — audit log | `/admin/audit` | admin, owner | 009 | chronological audit viewer / multi-field filters |
| S26b| Admin — ownership transfer | (modal on `/admin/users`) | owner | 009 | two-step modal with typed "TRANSFER OWNERSHIP" confirmation |
| S27 | Stale-rate review queue | `/admin/stale-reviews` | admin, owner | 009, 016 | approve / reject-with-void / >৳50k gate |

Plus global overlays: Toast stack, sync indicator, floating menu (mobile), sidebar (desktop).

---

## 4. Global chrome (S02) — applies to every authenticated screen

### 4.1 Desktop layout (≥768px)

```
┌──────────┬────────────────────────────────────────────┐
│          │  Header: [☰ none] [Screen title] [sync ●]  │
│ Sidebar  ├────────────────────────────────────────────┤
│ 256px    │                                            │
│ glass    │              CONTENT (A)                   │
│          │                                            │
│ [+ New   │                                            │
│  Entry]  │                                            │
│ Dashboard│                                            │
│ Ledger   │                                            │
│ Reports* │                                            │
│ Settle-  │                                            │
│ ments*   │                                            │
│ Reconcile│                                            │
│ Admin*   │                                            │
│ ─────    │                                            │
│ Settings*│                                            │
│ footer   │                                            │
└──────────┴────────────────────────────────────────────┘
```
*Admin/Owner only (R10). Sidebar per plan 007 `Sidebar.svelte`, role-filtered.
*Navigation note*: The Settings link in `Sidebar.svelte` points to `/admin/settings` and is wrapped in `{#if role === 'admin' || role === 'owner'}`. Staff users see only New Entry, Dashboard, and Ledger.
- **Desktop Command Palette (`⌘K` / `Ctrl+K`)**: The authenticated desktop layout (`+layout.svelte`, Plan 008) mounts `CommandPalette.svelte`. Pressing `⌘K` or `Ctrl+K` opens a focused modal overlay with instant fuzzy filter across role-accessible screens (New Entry, Dashboard, Ledger, Reports*, Settlements*, Reconcile*, Admin Settings*). Features keyboard arrow navigation, Enter to jump, and Escape to close (PRD §14.5).

### 4.2 Mobile layout (<768px)

```
┌──────────────────────────────┐
│ [Title]              [sync ●]│  header, sticky, 56px + env(safe-area-inset-top), solid --surface
├──────────────────────────────┤
│                              │
│          CONTENT (A)         │
│ (bottom padding ≥120px +     │
│  env(safe-area-inset-bottom))│
│                              │
│                    ┌─────────┤
│                    │ + New ░ │  floating glass pill (FloatingMenu),
│                    │   ☰     │  draggable, docked bottom-right 24/24 (+ safe area),
│                    └─────────┘  collision-avoids #btn-save/#btn-submit
└──────────────────────────────┘
```
- Floating pill contents (collapsed): `+ New Entry` (commission variant) + `☰` handle. Expanded: Dashboard, Ledger, Reports*, Settlements*, Reconcile*, Admin*, Settings*. Role-filtered. (Settings is located under `/admin/settings` and restricted to Admin/Owner; it is omitted from Staff navigation).
- Drag: pointer events; release snaps to nearest edge; double-tap resets; arrow keys move; Enter/Space expands; settings "Menu position: free/bottom/left/right" pins it. Position persisted (`localStorage` key `clt-floating-menu-pos`). Docking offset respects `env(safe-area-inset-bottom)`.
- **Collision Avoidance Contract**: Every primary page-level and modal submit button carries `id="btn-save"` or `id="btn-submit"` (Rule R16). When `#btn-save` or `#btn-submit` enters the viewport on screens <640px, `FloatingMenu` detects bounding rect overlap:
  1. If horizontal margins are clear, it dodges to the opposite margin (left margin 24px).
  2. If the colliding button is full-width (`w-full`, blocking both margins), `FloatingMenu` automatically executes **vertical dodging**, positioning itself 12px above the button top (`collidingRect.top - menuDim.height - 12px`), matching Plan 007's `calculateAvoidance()`.

### 4.3 Header (both layouts)
- Left: screen title (catalog key `screens.<id>.title`).
- Right: sync indicator — dot + one-word label, `role="status"`, tap when Error → triggers retry + opens sync status popover (pending ops count, last sync time).
- Header background: solid `--surface`, 1px bottom border `var(--pearl-border)`. Explicitly NO glass on header (perf; R4).

### 4.4 Global overlays
- **Toast stack**: top-right, max 3, glass, `role="status"`, auto-dismiss 4s, types info/success/warning/error.
- **Modal**: plan 007 `Modal.svelte`; every confirm modal has: title, body, optional mandatory-reason `textarea`, Cancel (left, default variant) + Confirm (right, category variant matching action: commission=positive confirm, bkash=destructive).
- **Empty states**: every list/table ships an empty state: illustration-free, one line of catalog copy + one primary CTA. Standard catalog keys:
  - `screens.ledger.empty`: "No entries found for this filter"
  - `screens.reports.empty`: "No entries recorded for this month"
  - `screens.settlements.empty`: "No settlements configured for this month"
  - `screens.reconcile.empty`: "No statements uploaded for this period"
  - `screens.admin_users.empty`: "No users found"
  - `screens.admin_devices.empty`: "No devices registered"
  - `screens.admin_audit.empty`: "No audit events match current criteria"
  - `screens.admin_stale_reviews.empty`: "All stale rate entries have been reviewed"
- **Skeletons**: shimmer-free (reduced-motion); use pulsing opacity blocks, 200ms cycle.

---

## 5. Screen specs — Core loop (Plans 008, 010, 012)

### S01 Login / accept invite `/login`
- **Layout A (centered card, max-w-sm):** app wordmark → email → password → [Sign in] → offline notice line.
- **States:** (1) online: normal; (2) offline with cached session: auto-bypass to `/dashboard` per PRD §9.3 — never sign out on network failure; only server `401`/`403 user_deactivated` while online signs out.
- **Invite accept:** if Supabase invite token present in URL (`/set-password` or callback), show "Set your password" card instead.
- **Copy keys:** `screens.login.title`, `screens.login.email`, `screens.login.password`, `screens.login.offlineNotice`.
- **Anti-drift:** no signup link anywhere (signup disabled, PRD §12).

### S06 New entry `/entries/new` — THE hero screen
- **Layout A (single column, max-w-md mobile / max-w-2xl desktop):**
  1. **Entry ID badge row**: `#LOCAL-xxxx` chip (amber, mono font) pre-sync; `E-YYYYMM-XXXXXX` chip (default) post-sync.
  2. **Form card** (solid surface, 18px radius):
     - Entry date (date picker, default today Dhaka).
     - Customer name (text input, required, `id="input-customer"`).
     - Sub quantity (stepper, default 1, min 0).
     - Sub description (optional text).
     - Gross amount (decimal input, BDT, 2dp max, `id="input-gross"`).
     - Payment method selection: **Category-colored chip radio row** (`<button type="button" data-method="{code}" ...>` styled with `Chip.svelte`; horizontal scroll on mobile). **Every method button MUST satisfy `min-h-[44px] min-w-[44px]` with `px-4 py-2.5` touch padding to comply with Rule R5 and WCAG AA.**
     - Transaction reference (`txn_ref`): shown/required when method has `requires_txn_ref = true`; live uppercase normalization.
     - VAT amount: shown/required only when profile has `vat_mode = 'manual'`.
     - Notes (optional textarea).
  3. **Hero breakdown card** — receipt style (signature component): dashed separators, mono amounts formatted via `formatPoishaToBdt`, lines stagger-animate on change:
     ```
     Gross                    ৳5,909.00
     VAT (manual)            -৳509.00
     Commission (42%)      -৳2,268.00
     bKash charge (1.15%)    -৳67.95
     ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
     NET AFTER DEDUCTIONS     ৳3,064.05
     ```
     When `chargesBorneBy = 'customer'`: charge line renders `৳67.95 (Customer-paid — not deducted)` with no minus, and NET excludes it.
  4. **Save button**: `id="btn-save"` (full-width on mobile, commission variant). Save = Dexie + outbox ≤ 100ms → toast "Saved — pending sync" → form resets (cursor returns to Customer name).
- **States:**
  - Historical date: load effective profile from Dexie; if rates differ from latest → amber info banner "Rates for <date> differ from current rates (v<N>)".
  - Duplicate warning (non-blocking): amber banner under form, lists matched candidate(s), "Save anyway" remains enabled.
  - Offline: normal; sync indicator shows `Offline (n pending)`.
  - Closed month selected (known from synced `monthCloses`): red warning banner "Month <M> is closed" + Save button disabled.
- **Supersede mode (S07):** same form at `/entries/new?supersede=<id>` + top banner `Editing Entry E-202610-000042 (Will supersede original)` (VAT ochre chip) + prefill all fields + Save label "Supersede & Save" (`id="btn-save"`). Admin/Owner only.
- **Anti-drift:** live calc MUST call `@clt/calc`, never reimplement formulas; amounts formatted strictly via `formatPoishaToBdt` (R2).

### S08 Ledger `/ledger`
- **Layout A:** search bar (sticky) → filter row (chips: date range, method, creator, status, flags `duplicate_txn`/`stale_rates`) → day groups (newest first):
  ```
  ▾ Today, 30 Oct 2026        ── 4 entries ──  Net ৳9,182.10
  ┌──────────────────────────────────────────────────┐
  │ E-202610-000042  Rahim Uddin   bKash  ৳5,909.00 │  row tap → S09 drawer
  │   1 session  ·  BJT84920KL      Net ৳3,064.05   │
  └──────────────────────────────────────────────────┘
  ```
- **Row anatomy (`LedgerRow.svelte`):** solid `--surface` card (strictly NO `.glass` class for 60fps scrolling per R4; use native `<div class="bg-[var(--surface)] border border-[var(--pearl-border)] rounded-[18px] p-4">`, NOT `Card.svelte`). Left = entry number (mono) + customer + sub_qty line; right = method chip + gross + net (tabular mono via `formatPoishaToBdt`). Modifiers: `[Customer Fee]` chip, `[Pending]` amber chip (#LOCAL), `[Voided]` strikethrough + muted, `[Superseded]` dimmed, `[Stale Rate]` amber chip, `[Dup Txn]` warning chip.
- **Search:** one field across entry_number (auto-strip `E-\d{6}-0*` prefix per PRD §8.2), customer, txn_ref, notes. Staff searches own entries only.
- **Footer of each day group:** subtotal row (count, gross, net) — asserts exact parity with reports.
- **States:** offline = cached entries + sync badge; empty = "No entries yet" + CTA to New Entry.
- **Anti-drift:** amounts sorted in memory after bigint parse (Dexie string-index ban, PRD §9.1).

### S09 Ledger detail drawer
- **Layout C (right drawer, 420px desktop / full-screen sheet mobile):** full breakdown (same receipt component as S06, read-only) → snapshot rates block (profile version, vat mode, bp values) → meta block (creator, device ID, Asia/Dhaka timestamps, txn_ref) → supersede chain ("Supersedes E-…" / "Superseded by E-…") → audit events list (time-ordered) → action bar.
- **Action bar by state × role:**
  - active, Staff(own): `[Request Void]` (opens S10 modal).
  - active, Staff(other): none (not visible — staff sees own only).
  - active, Admin/Owner: `[Edit / Supersede]` `[Void Entry]`.
  - void-requested, Admin/Owner: `[Approve Void]` (executes `void_entry` RPC) · `[Reject Void Request]` (clears `void_requested_by` locally with audit note, restoring active status without voiding).
  - voided/superseded: no mutations; audit chain only.
  - pending-sync (#LOCAL): offline mutations allowed — action enqueues to outbox with FIFO dependency (PRD §8.2).
- **S10 Request Void Modal / S11 Approve Void Modal:** mandatory reason textarea (blocks Confirm until non-empty), Confirm = bkash-variant (destructive).

---

## 6. Screen specs — Money & control surfaces (Plans 013, 014, 015, 018)

### S03/S04/S05 Dashboards `/dashboard` — bento grid, one per role
- **Grid:** 12-col desktop / 1-col mobile, cards radius 18px, KPI numbers 36px tabular-mono via `formatPoishaToBdt` with count-up on load.
- **Staff (S03):** [Today collected ৳X / This month ৳Y] · [My recent entries (5)] · [+ New Entry CTA] · [Pending sync counter card] · [Needs Attention card: rejected outbox operations with rejection reason, customer name, and a **[Discard]** button (PRD §8.5, Test #18) prompting confirmation (Rule R13) and executing `discard_rejected_entry`].
- **Admin (S04):** staff cards + [Entries by method (horizontal bar list with category colors)] · [Pending sync queue] · [Void requests needing approval (n)] · [Stale-rate alerts + >৳50k review queue card → S27] · [Device burst anomalies (≥5 stale ops/hr)] · [Duplicate txn flags] · [Closed-month "Needs Attention" (n) → S16] · [Settlement checklist].
- **Owner (S05):** admin cards minus operational noise, plus:
  - [Gross / Commission / Net vs last month (delta arrows and absolute values)].
  - [Payables due: list with due dates + 5-state chips].
  - [Trend chart: responsive pure SVG daily collections trend chart for the current month (`OwnerDashboard.svelte`) with daily gross bars, horizontal guideline thresholds, and hover tooltips, flattened under `prefers-reduced-motion`].
  - [Unclosed months alert → `/months/close`].
  - [Reconciliation variance alerts].
  - [Overpayment surplus approvals (Owner-only action)].
- **Offline:** all metrics render from Dexie cache; badge "Offline — cached" on each card.

### S12 Reports `/reports` (admin, owner)
- **Layout A:** month picker bar `[‹ Oct 2026 ›]` → summary cards row [Gross collected] [Commission] [Net after deductions] [Sessions Σsub_qty] → payables summary table:
  ```
  Payable        Expected     Paid      Variance   Status
  VAT            ৳12,450.00   ৳12,450.00    ৳0.00  [Paid]
  bKash charges  ৳1,358.00    ৳1,000.00  -৳358.00  [Partly paid]
  ```
  Status chips = 5-state set (`not_applicable` renders as "—"). Row tap → drill-down to S08 filtered. Separate section "Customer-paid provider fees" (informational, excluded from liabilities).
- **Below:**
  - Breakdown by method (gross turnover and business fee).
  - Daily cash reconciliation breakdown table (`dailyBreakdowns`).
  - Daily collections trend chart: hand-rolled responsive SVG bar chart rendered inline in `reports/+page.svelte`.
  - Full detailed monthly entry list with **totals row that equals summary cards exactly** (asserted in tests, PRD §8.3 and §16.3 #2).
- **Export menu:**
  - Print-ready PDF: clean `@media print` stylesheet with printable header (business name, address, VAT reg no) and universal print color resets.
  - CSV: RFC 4180 compliant with UTF-8 BOM (`﻿`), formula injection defense, full accountant columns, and sticky totals row.
  - XLSX: XML Spreadsheet 2003 `.xlsx`/`.xls` export generator.
- **Historical immutability note:** past months read snapshot values; UI never recomputes history.

### S13 Settlements `/settlements` & S13b Detail `/settlements/[id]` (admin, owner)
- **S13 Overview (`/settlements`):** month selector → settlement cards (one per payable): payable name + expected (mono, 28px via `formatPoishaToBdt`) + paid + variance `paid − expected` (always shown) + status chip + due date + progress bar (paid/expected) + [View Details] linking to `/settlements/[id]`.
- **5-state chip visuals:** `not_applicable` muted "—" · `due` VAT-ochre · `partly_paid` Visa-blue · `paid` commission-jade · `overpaid` bKash-magenta + `[Overpaid +৳…]` badge.
- **Overdue:** red banner on card after due date.
- **S13b Detail Page (`/settlements/[id]`):**
  - Settlement summary card with liability progress and due-date banner.
  - Payment history list: date, amount, reference, signed-URL receipt preview, note.
  - Reversals: displayed as negative rows `[Reversed]` (reversals are append-only rows; payments are never edited).
  - [Record Payment] button → opens S14 modal.
  - Overpayment Status Card: Owner-only [Approve Overpayment] modal with surplus amount pre-filled (exact) + mandatory reason.
- **S14 Record payment modal (`RecordPaymentModal.svelte`):**
  - Fields: date (default today Dhaka) · amount BDT 2dp · reference · receipt upload (5MB max, magic bytes validation for PNG, JPEG, WebP, PDF) · note.
  - Reversal mode: locks amount to original payment and requires mandatory reversal note.
  - Primary button: `id="btn-save"`, commission variant.

### S15 Reconcile Mode A overview `/reconcile` (admin, owner)
- **Layout A+B:** monthly statements list grouped by payable/month → selected statement summary → live variance against active entries.
- **Actions:**
  - [Enter Manual Statement] → navigates to `/reconcile/manual` (S15b).
  - [Upload Statement File] → navigates to `/reconcile/upload` (S18 Mode B).
  - [Reconcile Statement] → enabled when `abs(variance) ≤ tolerance` (or note provided), button carries `id="btn-save"`.
  - [Needs Attention Queue] → opens `ClosedMonthRecoveryModal.svelte` (S16).
- **S15b Mode A manual entry (`/reconcile/manual`):** form to input statement total (BDT), select payable (or combined cards), submit statement via `create_statement` RPC. Submit button carries `id="btn-save"`.
- **S16 Closed-month recovery queue (`ClosedMonthRecoveryModal.svelte`):**
  - Amber cards (one per rejected op): entry summary + reason `month_closed` + [Reassign to Open Month] [Request Month Reopen] [Discard].
  - Reassign modal: new date (1st of current open month), mandatory reassign reason, warning copy verbatim: "Reassigning this transaction shifts VAT and merchant liability from <Closed Month> to <Open Month>".
  - Reopen: Owner-only, mandatory audit reason. Discard: mandatory reason, purged after server confirmation.
- **S17 Month close / reopen `/months/close` (owner):**
  - Close: checklist gating UI — every payable displays reconciled/zero/approved-overpaid state; all green → [Close Month] enabled (carries `id="btn-save"`).
  - Reopen: Owner-only, mandatory reason + impact summary.
- **S18 Reconcile Mode B file upload `/reconcile/upload` (admin, owner, M4):**
  - **Upload zone:** Drag-and-drop or file selector accepting CSV/XLSX/PDF (10MB max). Primary upload button carries `id="btn-save"`.
  - **Header auto-detection:** Server adapters inspect file headers to automatically route to `bkashCsvAdapter` (bKash settlement statement) or `cardCombinedCsvAdapter` (combined Visa/Mastercard portal export).
  - **Reconciliation workspace (2-column desktop / stacked mobile):**
    - Left pane: Statement lines list (date, gross, provider fee, net, reference) with status chips (`Matched`, `Unmatched`, `Accepted`).
    - Right pane: Active ledger entries candidate matches or manual entry picker.
  - **2-pass matching (PRD §11.3):** Pass 1 executes strict two-sided 1-to-1 match on exact transaction reference (`txn_ref`); Pass 2 matches candidates within date window (±1 calendar day) and identical gross amount.
  - **Line-level exception review:** Unmatched lines display an `[Accept Line]` action button opening a review modal requiring variance input and mandatory justification note.
  - **Statement supersession:** If a statement file is defective, `[Supersede Statement]` marks the current statement `superseded` and resets matched entries to `unmatched` for replacement re-upload.
  - **Finalization:** `[Reconcile Statement]` button (carries `id="btn-save"`) enabled only when all statement lines are either `matched` or `accepted`.

---

## 7. Screen specs — Admin panel (Plan 009)

The Admin section uses a unified sub-navigation bar / tab header across `/admin/*`:
**Overview (`/admin`) · Rates (`/admin/rates`) · Methods (`/admin/methods`) · Payables (`/admin/payables`) · Settings (`/admin/settings`) · Users (`/admin/users`) · Devices (`/admin/devices`) · Audit Log (`/admin/audit`) · Stale Reviews (`/admin/stale-reviews`)**.

### S23 Admin Hub Overview (`/admin`)
- **Layout A (Cards Grid, max-w-5xl):** Quick metrics cards (Active users, Active devices, Current rate profile version, Pending reviews count).
- **Data fields:** System health indicators, offline outbox ops count, latest backup timestamp.
- **States:** Normal / Stale reviews pending badge / Sync anomaly alert.
- **Copy keys:** `screens.admin_hub.title`, `screens.admin_hub.metricsTitle`, `screens.admin_hub.pendingReviews`.

### S19 Rates & Rules (`/admin/rates`)
- **Layout A (2-column desktop / 1-column mobile):**
  - Left/Top: Published profile card (version, effective_from, VAT mode, commission bp, per-method charges, charges_borne_by).
  - Right/Bottom: Draft editor form.
- **Data fields:** VAT mode select (`manual`, `percent_of_gross`, `percent_inclusive`), commission basis points (0–10,000 bp), charge rates per active method (bp), charges borne toggle (`merchant` vs `customer`).
- **Live guard bar:** `vat_bp + commission_bp + max(charge_bp) ≤ 10000` — excess → red highlight on offending field + submit blocked with "Deductions exceed 100% by X bp".
- **Primary action:** `id="btn-save"` (Save Draft) / `[Publish]` → confirm modal (publish is irreversible; writes `audit_log`).
- **States:** Published only / Active Draft / 100% deduction violation / Publishing confirmation modal.
- **Copy keys:** `screens.admin_rates.title`, `screens.admin_rates.publishedTitle`, `screens.admin_rates.draftTitle`, `screens.admin_rates.publishConfirm`.

### S20 Methods (`/admin/methods`)
- **Layout B (Data Table, max-w-5xl):**
  - Table: Method code (mono), Display name, Charge status, `requires_txn_ref` toggle, `active` toggle, sort order handle.
  - Action header: `[Add Method]` button opens Modal.
- **Data fields:** Code (immutable after creation, e.g. `bkash`, `visa`), Name (e.g. "bKash Personal"), `requires_txn_ref` (boolean), `active` (boolean).
- **States:** Populated / Add Method modal / Reordering. Save button carries `id="btn-save"`.
- **Copy keys:** `screens.admin_methods.title`, `screens.admin_methods.addMethod`, `screens.admin_methods.tableHeaderCode`.

### S21 Payables (`/admin/payables`)
- **Layout A (Cards List, max-w-4xl):** Cards per payable: kind (`vat`, `bkash_fee`, `card_fee`, `custom`), method link, due_day (1–28 number input), remind_days_before.
- **Data fields:** Payable kind, associated method, monthly due day (1–28), reminder advance days (1–14).
- **Actions:** Edit schedule inline, save schedule (`id="btn-save"`).
- **States:** Populated / Editing / Saving.
- **Copy keys:** `screens.admin_payables.title`, `screens.admin_payables.scheduleCard`, `screens.admin_payables.dueDayLabel`.

### S22 Settings (`/admin/settings`)
- **Layout A (Form Card, max-w-2xl):**
  - Reconcile tolerance input: poisha string, default ৳1.00 (`100` poisha).
  - Sync retention days input: integer, default 90 days.
  - App brand name and receipt header metadata.
- **Actions:** Save Settings button (`id="btn-save"`).
- **States:** Clean / Modified / Saving / Error.
- **Copy keys:** `screens.admin_settings.title`, `screens.admin_settings.reconcileTolerance`, `screens.admin_settings.syncRetention`.

### S24 Users & Roster (`/admin/users`)
- **Layout B (Data Table, max-w-5xl):**
  - Table: Name, Email, Role chip (`owner` commission-jade, `admin` visa-blue, `staff` default), Active toggle, Last seen timestamp.
  - Action header: `[Invite User]` button opens invite modal.
- **Actions:**
  - Invite Modal: Email + Role selection. (Admin users see only `Staff` option; Owner sees `Admin` and `Staff`).
  - Deactivate User: Confirm modal with sole-owner/sole-admin guard prevention surfaced from server RPC.
  - Ownership Transfer: S26b modal (Owner-only).
- **States:** Populated / Invite Modal / Deactivate Confirm Modal / S26b Transfer Modal.
- **Copy keys:** `screens.admin_users.title`, `screens.admin_users.inviteBtn`, `screens.admin_users.deactivateConfirm`.

### S25 Devices (`/admin/devices`)
- **Layout B (Data Table, max-w-5xl):**
  - Table: Device UUID (short mono `00000000-...`), Registered User, Last seen, Stale-op rate (anomaly counter), Status (`active` vs `revoked`), Actions.
  - Actions: `[Revoke Device]` triggers hardware killswitch; `[Restore Device]` restores access.
- **States:** Normal / High Anomaly Warning (≥5 stale ops/hr) / Revocation Confirm Modal.
- **Copy keys:** `screens.admin_devices.title`, `screens.admin_devices.revokeBtn`, `screens.admin_devices.anomalyWarning`.

### S26 Audit Log (`/admin/audit`)
- **Layout B (Filtered Table, max-w-6xl):**
  - Filter bar: Date range (Dhaka), Actor select, Action kind select, Table select.
  - Table: Timestamp (Asia/Dhaka mono), Actor name, Action, Entity (table + ID), Payload diff drawer.
- **States:** Populated / Filtered / Empty search / Detail Payload Modal. Read-only.
- **Copy keys:** `screens.admin_audit.title`, `screens.admin_audit.filterActor`, `screens.admin_audit.empty`.

### S26b Ownership Transfer Modal (on `/admin/users`, owner-only)
- **Layout C (Centered 2-Step Modal):**
  - Step 1: Select candidate new owner from active administrators.
  - Step 2: Critical warning banner. Requires typing verbatim confirmation phrase `"TRANSFER OWNERSHIP"` (matching Plan 009 server Zod schema `z.literal('TRANSFER OWNERSHIP')`). Any mismatch (e.g. typing owner's name) is rejected with 400 `invalid_confirmation`.
  - Confirm button: `id="btn-submit"`, bkash-magenta variant. Executes `transfer_ownership` RPC.
- **Copy keys:** `screens.admin_users.transferTitle`, `screens.admin_users.transferPrompt`, `screens.admin_users.transferConfirm`.

### S27 Stale-Rate Review Queue (`/admin/stale-reviews`)
- **Layout A (Cards List, max-w-4xl):**
  - Review cards: Entry ID, Gross turnover, Creating device, Offline date, Rate profile applied vs Current profile.
  - Flag badges: `>৳50,000 Gross` (major risk badge), `Stale Rates` amber chip.
- **Actions:**
  - `[Approve Rates]`: Retains snapshot rates, marks `stale_review_status = 'approved'`, writes audit event.
  - `[Reject & Void]`: Rejects entry with mandatory audit note, voids entry, writes audit event.
- **States:** Queue Populated / Reviewing Detail Modal / Empty Queue.
- **Copy keys:** `screens.admin_stale.title`, `screens.admin_stale.approveBtn`, `screens.admin_stale.rejectBtn`, `screens.admin_stale.empty`.

---

## 8. Interaction, accessibility, i18n, and number-format contracts

**Interaction contracts**
- Every tap that writes: optimistic UI only where the PRD allows (entry save); everything else shows loading spinner on the button (plan 007 Button `loading`) and disables double-submit.
- Pull-to-refresh: none (sync runner is autonomous). Sync indicator tap = manual sync trigger.
- Multi-tab: only leader tab syncs (Web Locks); other tabs update via Dexie liveQuery — UI must reflect data changes without reload.
- Mobile FloatingMenu: primary action buttons carry `id="btn-save"` or `id="btn-submit"` (Rule R16); floating menu automatically detects and dodges them.

**Accessibility (WCAG AA)**
- Contrast: all text ≥ 4.5:1 in both light and dark themes (computed dynamically in `tokens.test.ts`).
- Focus: visible focus ring (2px, accent); drawer/modal trap focus; Escape closes.
- Screen reader: every icon-only control has `aria-label` from catalog; status changes announced via toast `role="status"`; sync indicator `aria-live="polite"`.
- Motion: all animation gated on `prefers-reduced-motion` (PRD §14.6 block).
- Transparency: `prefers-reduced-transparency` → glass falls back to solid surface colors.
- Contrast mode: `prefers-contrast: more` → glass → solid + 2px ink borders, engraved labels become solid color (PRD §14.6).

**i18n & format**
- All UI copy adheres to catalog key namespace `screens.<id>.<element>` (R1).
- Currency: BDT, South Asian grouping, Latin digits, `৳` prefix, 2 decimals via `formatPoishaToBdt(poisha: bigint): string` from `@clt/shared` (aliased as `formatBdt`) (R2). Note: do not prepend `৳` in markup templates.
- Percentages: 2dp bp display (e.g., `1.15%`). Dates: `DD MMM YYYY` (e.g., `30 Oct 2026`); months `Oct 2026`.
- Entry numbers: mono font, `E-YYYYMM-XXXXXX`, dynamic width beyond 999999; pre-sync: `#LOCAL-xxxx` amber chip.

---

## 9. Handoff

### 9.1 To the coding model (Plans 007–018) — anti-drift checklist
1. **Screen Implementation Order**: Implement screens matching the route hierarchy in Section 3; each screen ships all listed states, not just the happy path.
2. **Component Whitelist**: Shared UI primitives are strictly restricted to `Button, Card, Chip, Modal, Toast, FloatingMenu, Sidebar` + screen-local composites built from them. `Chip.svelte` is the canonical component for all badges and status chips. Any new shared primitive must be proposed in `DECISIONS.md`.
3. **Money Formatting**: Strictly `formatPoishaToBdt` (or alias `formatBdt` from `@clt/shared`); internal type `bigint`; grep CI rejects `.toFixed()` outside the formatter. The formatter includes `৳`; never write `৳{formatPoishaToBdt(x)}`.
4. **Color Discipline**: Grep CI rejects raw hex outside `tokens.ts`/`app.css`. Use semantic category tokens.
5. **No Glass on Data or Headers**: Header and data surfaces use solid `--surface` with 1px `var(--pearl-border)`. Backdrop blur is restricted strictly to floating menu, modals, buttons, and desktop sidebar (R4). `Card.svelte` defaults to `variant="solid"` (non-glass container with solid `--surface` and `--pearl-border`), preventing glass blur from leaking onto bento dashboard cards, form cards, or settlement cards. Data rows in long lists use native semantic `<div class="bg-[var(--surface)] border border-[var(--pearl-border)] rounded-[18px] p-4">` or solid `Card`.
6. **Route Guards**: Central navigation guard `handleClientGuard` in `apps/web/src/lib/auth/guard.ts` must synchronously block Staff from `/reports`, `/settlements`, `/reconcile`, `/months/close`, and `/admin/*`, redirecting immediately to `/dashboard`. Admin is blocked from Owner-only `/months/close`.
7. **Collision Avoidance ID**: Primary submit buttons across all forms and modals must carry `id="btn-save"` or `id="btn-submit"` (R16). On full-width buttons, `FloatingMenu` executes vertical dodging (12px above button top).
8. **Touch Targets**: All interactive elements (including method selection chips) must enforce `min-h-[44px] min-w-[44px]` touch targets per Rule R5 and WCAG AA.
9. **Mandatory Reasons**: Every modal requiring a reason must enforce non-empty reason validation before enabling confirm.
10. **Definition of Done per Screen**: Light + dark theme rendering, reduced-motion compliance, ≥ 4.5:1 contrast check, empty/loading/error states present.

### 9.2 To Google Stitch
- Stitch usage: generate **static visual concepts for the 6 hero screens only** — S06 New Entry, S08 Ledger, S05 Owner Dashboard, S13 Settlements, S12 Reports, S19 Rates. Mobile 390×844 + desktop 1440×900 variants, light + dark.
- Feed Stitch the global style block (Section 2 condensed) once, then one prompt per screen from companion file `022_stitch_prompts.md`.
- Stitch output = reference images only. Tokens, layout regions (A/B/C), and copy keys in THIS file are authoritative. Do not let Stitch introduce new colors/components; if it does, discard that element.
- Validation gate: Stitch screens must be checked against R4 (no glass on lists/headers), R2 (tabular numbers), R6 (category color discipline) before being shown to the coding model.

---

## Changelog

- 2026-11-02 — Revision 2.2:
  - Solid Card Component Variant: Updated Rule R4, §2, and §9.1 (#5) to specify that `Card.svelte` defaults to `variant="solid"` (rendering `<div class="bg-[var(--surface)] border border-[var(--pearl-border)] rounded-[18px] p-5 shadow-sm">`), eliminating `.glass` blur leakage onto bento dashboard cards, forms, and settlement cards per Rule R4.
  - Staff Rejected-Op Discard UI: Added specification for Staff Dashboard (S03) "Needs Attention" card surfacing rejected outbox operations with customer name, rejection reason, and `[Discard]` button with confirmation modal (Rule R13) executing `discard_rejected_entry` (PRD §8.5, Test #18).
  - Desktop Command Palette (PRD §14.5): Specified `CommandPalette.svelte` in §4.1 mounted in `apps/web/src/routes/(app)/+layout.svelte`, owned by Plan 008, providing accessible `⌘K` / `Ctrl+K` navigation overlay with role-gated screen jumps and keyboard navigation.
  - Aligned Mode B Reconciliation Specification (S18): Reconciled S18 with Plan 018 and PRD §11.3, specifying file header auto-detection (`bkashCsvAdapter` vs `cardCombinedCsvAdapter`), split-pane 2-pass matching table, line-level `[Accept Line]` exception review with variance input and mandatory justification note, statement supersession, and finalization gating.
  - Cleaned Google Stitch Prompts: Replaced stray Bengali zero `০` in S12 prompt with standard South Asian grouping, aligned S05 with pure SVG daily collections bar chart, aligned S13 with Overview vs Detail routes, and added structured Dark Mode color token block in Block 0.
- 2026-11-02 — Revision 2.1:
  - Resolved Blocker P0.1: Purged non-existent `Badge.svelte` from the component whitelist (§9.1 #2) and Rule R6; designated `Chip.svelte` as the sole canonical status/badge primitive. Removed phantom component references (`CommandPalette.svelte`, `OwnerTrendChart.svelte`, `DailyCollectionsChart.svelte`), clarifying that trend and collections charts are implemented inline within `OwnerDashboard.svelte` (Plan 016) and `reports/+page.svelte` (Plan 013).
  - Resolved Blocker P0.2: Expanded Client Navigation Route Guard contract in Rule R10 and §9.1 #6 to mandate synchronous route cancellation in `handleClientGuard` (`guard.ts`) blocking Staff from `/reports`, `/settlements`, `/reconcile`, `/months/close`, and `/admin/*` (redirecting to `/dashboard`), and blocking Admin from Owner-only `/months/close`.
  - Resolved Blocker P0.3: Enforced mobile safe area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) in mobile layout (§4.2) and defined vertical collision dodging contract for `FloatingMenu` (docking 12px above button top) when full-width primary buttons block both screen margins.
  - Resolved Risk P1.1: Clarified in §4.1 and §4.2 that shell navigation links to Settings must point to `/admin/settings` (Screen S22) and must be enclosed in `{#if role === 'admin' || role === 'owner'}` blocks, preventing 404 client navigation errors for staff.
  - Resolved Risk P1.2: Corrected undefined CSS variable `--surface-card` to `--surface` in S08 Ledger row specification (§5) and documented that `LedgerRow.svelte` must use native semantic `<div class="bg-[var(--surface)] border border-[var(--pearl-border)] rounded-[18px] p-4">` instead of `Card.svelte` to prevent `.glass` backdrop blur from leaking onto scrollable list surfaces.
  - Resolved Risk P1.3: Mandated `min-h-[44px] min-w-[44px]` with `px-4 py-2.5` touch padding on payment method radio buttons on `/entries/new` (S06) to satisfy Rule R5 and WCAG AA touch target criteria.
  - Resolved Risk P1.4: Reconciled screen inventory count in §0 and §3 from 27 to 30 distinct screens, sub-routes, and modal workflows, and expanded Section 7 with standardized layout regions (A/B/C), state matrices, and message catalog keys for all Admin screens S18–S27.
  - Resolved Minor P2.1: Added explicit warning in Rule R2 and §8 against double currency prefixing (`৳{formatPoishaToBdt(...)}`), confirming `formatPoishaToBdt` returns strings already prefixed with `৳`.
  - Resolved Minor P2.2: Aligned S05 Owner Dashboard trend chart specification with Plan 016 (pure SVG daily collections trend chart for current month).
  - Resolved Minor P2.3: Defined standard message catalog keys for empty states across all list and table views in §4.4.
- 2026-11-01 — Revision 2.0:
  - Resolved Flaw 1: Updated Rule R2 (§1), §8, and §9.1 (#3) to reference canonical shared formatter `formatPoishaToBdt(poisha: bigint): string` from `@clt/shared` (with backward-compatible alias `formatBdt`), eliminating compilation errors and ad-hoc local formatters lacking South Asian digit grouping.
  - Resolved Flaw 2: Reconciled route table in §3, §6, and §7 with actual SvelteKit route hierarchy across Plans `009`, `014`, `015`, `018` (sub-routes under `/admin/*`, `/settlements/[id]`, `/reconcile/manual`, `/reconcile/upload`, `/months/close`) and aligned Screen IDs (`S23` Hub, `S24` Users, `S25` Devices, `S26` Audit Log, `S26b` Ownership Transfer, `S27` Stale Reviews) eliminating collisions.
  - Resolved Flaw 3: Corrected Ownership Transfer confirmation rule in §7 (`S26b`) to strictly require typing the verbatim confirmation phrase `"TRANSFER OWNERSHIP"`, aligning with Plan 009's server Zod schema `z.literal('TRANSFER OWNERSHIP')`.
  - Resolved Flaw 4: Standardized Rule R1 message key namespace to `screens.<id>.<element>`; purged `"header"` from allowed glass list in Rule R4 (§1) matching §4.2, §4.3, and PRD §14.3; clarified solid `--surface` on `LedgerRow` (no glass); and approved `Badge.svelte` in component whitelist (§9.1 #2).
  - Resolved Flaw 5: Documented implementations for Desktop Command Palette (`CommandPalette.svelte`, `⌘K`), Staff void request vs Admin `[Approve Void]` / `[Reject Void Request]` workflow, pure SVG trend charts (`OwnerTrendChart.svelte` and `DailyCollectionsChart.svelte`), XML Spreadsheet 2003 (.xlsx) export, and payment method chip radio row with `#LOCAL-xxxx` chip and historical-date/closed-month banners on `/entries/new`.
  - Resolved Flaw 6: Mandated `id="btn-save"` or `id="btn-submit"` on all primary page-level and modal submit buttons across the app (Rule R16), guaranteeing mobile `FloatingMenu` collision dodge.
  - Resolved Flaw 7: Updated header and Section 9 cross-references to downstream plans `007`–`018` and companion `022_stitch_prompts.md`, and registered overlay specifications in `000_TOC.md`.
- 2026-10-30 — Revision 1.0:
  - Initial release of Plan 022 specifying screen inventory (S01–S27), ASCII wireframes, layout regions, component mapping, state matrices, 15 UI rules, and Stitch handoff prompts.
