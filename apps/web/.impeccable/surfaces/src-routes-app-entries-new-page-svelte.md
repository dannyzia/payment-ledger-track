---
version: 1
slug: "src-routes-app-entries-new-page-svelte"
primary_target: "src/routes/(app)/entries/new/+page.svelte"
related_targets: []
---

# Surface brief — entry flow (proves the whole-app world)

## Scope & mode

`src/routes/(app)/entries/new/+page.svelte` is the proving surface for a whole-app visual world replacement (Zia, 2026-11-23: "Whole app, one world"). Mode: **Operate**. Later surfaces (dashboard, ledger, reports, settlements, reconcile, months, admin) inherit this world; their own briefs record only surface strategy.

## Audience, job, task

Front-desk staff at Dhaka Kumon centres capture a payment already received, on a shared phone, in under 20 seconds, often offline. The screen's job: one gross figure in, exact split out, save without thinking. Owner tasks (void/supersede, approvals) read the same grammar: filed stubs get stamped, never edited.

## Proof & content

The split preview's arithmetic is the product's core proof (exact integer poisha; PRD §6.6/§6.7 fixtures are the historical evidence — quoted exactly in tests, never "fixed" here). Demo data in mocks is synthetic and labelled; real claims are uninventable.

## Constraints

- WCAG AA (≥4.5:1 body, ≥3:1 large) in light AND dark; 44px touch targets; prefers-reduced-motion / reduced-transparency honored.
- UI strings live in `src/lib/i18n/messages.ts` — no strings outside the catalog.
- Controls stay standard mobile/web controls; the world dresses type, palette, density, and its signature move only — never navigation or control anatomy (Operate rule).
- Existing behavior and tests must keep passing (`pnpm test`, `pnpm typecheck`); entries/new's semantics (outbox save, offline state, validation errors) are untouched.
- Kumon Ledger Track name and assets stay binding (PRODUCT.md).

## Chosen direction & memorable moment

**Jet-Age Coupon Wallet** (dealt challenger, chosen by Zia over the assigned Counterfoil Book). The month is a coupon wallet: one carbon stub per payment, tab-cap heads, fare-box splits, VOID stamps for reversals, tear-off perforations between action zones. Memorable moment: **STAMP & FILE** — the primary action that stamps the stub into the wallet; VOID strikes through, never deletes.

## Unresolved decisions

- Rollout order for the remaining surfaces (dashboard next is the natural second).
- Dark-theme rendition of the navy/red world (committed in tokens; may tune during rollout).
- Kumon logo placement in the coupon head (asset exists; not required on this screen).

## Direction contract

THESIS: The month is a coupon wallet — one carbon stub per payment, stamped when filed, struck when voided, never rewritten; it refuses the category-default arrangement of floating white cards on a grey SaaS ground.

OWN-WORLD: Carrier navy #0D1B3D owns whole regions (top band, bottom tab bar); jet red #D7262D owns the date flag, the primary action, and alert/void accents; coupon white #FFFFFF stubs ride a cold stock ground #F2F3F0; carbon purple #4B2E83 is the ink of every entered figure and money value; tab-cap coupon heads, hairline-ruled fare-box tables, dashed tear-off perforations between action zones; Archivo Narrow caps for tab/field labels, Archivo 700–900 for display, Spline Sans Mono tabular for all money; raised disciplines named for donors — Guide Map: colour owns regions, not accent chips; Botanical Folio: every month renders at the same plate scale so months compare honestly; Orienteering Overlay: reconciliation marks ride above filed coupons and never edit them; Data Field: money sets at true tabular density.

STORY: A staffer understands in seconds: this screen files a payment as a numbered carbon stub into the month's wallet; a voided entry is stamped VOID, never deleted; a closed month carries the seal; nothing behind a filed stub can silently change.

FIRST VIEWPORT: Phone 390×844 — navy app band ("Kumon Ledger Track" + MHK chip, red date flag NOV 23 riding the right edge); the coupon card with a notched ENTRY tab-cap head carrying serial E-MHK-202611-000042; received-from and programme fields; gross ৳ 8,500.00 as the hero figure in carbon purple mono; segmented method control with bKash selected and a TrxID fare box carrying the customer-paid tag; the hairline fare-box split (VAT ৳1,108.70 · Commission ৳3,570.00 · bKash charge ৳97.75 customer-paid · Net ৳3,723.55); a dashed tear-off perforation; the red STAMP & FILE primary action; the five-tab navy bottom bar with New active.

FORM: jet-age ticket-wallet challenger — dealt third of six in the hand, chosen over the assigned Counterfoil Book (same coupon family; the carrier styling is the rendition Zia picked, 2026-11-23). seed: e335f1c6921f8de6

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
