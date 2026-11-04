# 022_stitch_prompts.md — Google Stitch Handoff Prompts

Usage: paste **Block 0** into Stitch once as the shared style context (or prepend to each screen prompt), then one prompt per screen. Generate mobile (390×844) and desktop (1440×900), light and dark. Stitch output = reference imagery only; `022_ui_ux_screens_wireframes_and_prototype_spec.md` stays authoritative.

---

## Block 0 — Global style context (prepend to every screen prompt)

> Premium fintech mobile/web UI called "Cosmo Ledger Track". Calm financial clarity: pearl-white warm background (#F6F5F1) with a very subtle fine grain noise texture and soft lilac/blush gradient glows in corners. Frosted glass used ONLY on floating buttons, menus, and modals — all content cards are solid white (#FFFFFF) with 18px rounded corners, 1px pearl border (#E5E2DC), and soft shadows. Typography: Geist sans for UI, Geist Mono tabular numbers for all money amounts. One confident accent: dark jade (#0B6B59). Category colors, used only as small chips and engraved button labels: commission jade #0B6B59, VAT ochre #8C4F00, bKash magenta #B80053, Visa royal blue #1A54B8, Mastercard rust orange #9E3600. Buttons are frosted glass pills with subtle embossed engraved text, 44px touch targets.
> Dark mode color tokens: background #0E1116 (--bg), surface #161A21 (--surface), border #2A313C (--pearl-border), muted #8B949E (--muted), ink #F0F6FC (--ink), commission jade #10B981, VAT ochre #D97706, bKash magenta #EC4899, Visa royal blue #3B82F6, Mastercard rust orange #F97316. No indigo, no neon, no gradients on large surfaces, no glass on data tables, no illustrations of people, no emoji. English UI. Currency: Bangladeshi Taka ৳ with South Asian digit grouping (e.g., ৳1,23,456.00).

---

## S06 — New Entry (hero screen)

> Mobile screen "New Entry" of a payment ledger app. Single column. Top: small amber chip "#LOCAL-a3f9c2" in monospace, then a solid white rounded form card: date field showing "30 Oct 2026", customer name input, a stepper for quantity (value 1), a large prominent gross amount input "5909", a horizontal scrollable row of payment method chips (bKash in magenta, Visa in royal blue, Mastercard in rust orange, Cash, Bank Transfer) with 44px touch targets, a transaction reference input showing "BJT84920KL" in mono, a VAT amount input "509". Below the form, a signature receipt-style breakdown card with dashed separators and monospace amounts that looks like a printed receipt: "Gross ৳5,909.00", "VAT (manual) −৳509.00", "Commission (42%) −৳2,268.00", "bKash charge (1.15%) −৳67.95", dashed line, then a bold large line "NET AFTER DEDUCTIONS ৳3,064.05". Full-width frosted glass primary button "Save" at the bottom, above a floating glass pill with "+ New Entry" in jade and a hamburger handle at bottom-right. Warm pearl background, generous spacing, large readable numbers.

## S08 — Ledger

> Mobile screen "Ledger" grouped by day. Sticky search bar on top. A day group header "Today, 30 Oct 2026 — 4 entries — Net ৳9,182.10", then solid white row cards: left side monospace entry number "E-202610-000042", customer name "Rahim Uddin", small line "1 session · BJT84920KL"; right side a small magenta bKash chip, gross "৳5,909.00" and net "৳3,064.05" in tabular mono. One row shows strikethrough muted text with a grey "Voided" chip, another has an amber "Pending" chip. Solid white cards, no glass on the list, warm pearl grain background, floating glass pill bottom-right.

## S05 — Owner Dashboard (desktop)

> Desktop dashboard, bento grid of solid white 18px-radius cards on pearl background. Header row: "Dashboard" title and a jade dot "Synced". KPI cards with large tabular mono numbers: "Gross ৳4,82,350.00" with jade up-arrow "+12% vs Sep", "Commission ৳2,02,587.00", "Net ৳2,54,118.00". A "Payables due" card listing VAT, bKash charges, Visa charges, Mastercard charges with due dates and status chips: jade "Paid", Visa-blue "Partly paid", ochre "Due", magenta "Overpaid +৳500.00". A daily collections SVG bar chart in jade (#0B6B59) for the current month with guideline thresholds. An amber alert card "Needs Attention: 3 closed-month entries awaiting review". A left slim frosted glass sidebar with jade "New Entry" button and nav items Dashboard, Ledger, Reports, Settlements, Reconcile, Admin.

## S13 — Settlements (desktop)

> Desktop "Settlements" screen for Oct 2026, month selector at top. Four solid white settlement cards in a row, one per payable (VAT, bKash, Visa, Mastercard). Each card: payable name, huge tabular mono expected amount "৳12,450.00", paid amount, variance "৳0.00", a colored status chip (jade "Paid", Visa-blue "Partly paid", ochre "Due"), due date "Due 15 Nov", a thin progress bar, and a frosted glass "View Details" button linking to `/settlements/[id]`. The Visa card shows a red "Overdue" banner and the Mastercard card a magenta "Overpaid +৳500.00" badge with an "Approve Overpayment" button. Solid cards, no glass blur on cards, warm pearl background.

## S12 — Reports (desktop)

> Desktop "Reports" screen for Oct 2026 with month picker "‹ Oct 2026 ›". Top row of four KPI cards: Gross collected, Commission, Net after deductions, Sessions (16). Below, a payables summary table on solid white card with columns Payable, Expected, Paid, Variance, Status; status chips in jade/Visa-blue/ochre. Then a horizontal bar breakdown "By method" with magenta/Visa-blue/rust bars, a daily collections trend chart, and an export menu "PDF · CSV · XLSX". All amounts tabular mono with South Asian grouping. Pearl background, glass only on the header buttons and floating menus.

## S19 — Admin — Rates & Rules (desktop)

> Desktop "Admin — Rates" screen. Left: a solid white card "Published Profile v3 — effective 1 Oct 2026" summarizing VAT mode Manual, Commission 42%, bKash 1.15%, Visa 2.5%, Mastercard 2.5%, "Charges borne by: Business". Right: a draft editor form with fields VAT mode dropdown, commission percentage input, per-method charge inputs, and a live guard bar showing "Deductions 43.15% of 100%" in jade. A frosted glass "Publish Profile" button with engraved jade label, and a warning note "Publishing locks this profile permanently". Warm pearl background, glass sidebar on the left.
