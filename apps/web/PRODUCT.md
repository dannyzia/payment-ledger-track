# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: front-desk staff** at after-school learning centers (Kumon franchisees) in Dhaka, Bangladesh. Situation: a parent pays monthly fees at the counter; staff record the gross amount on a shared phone, sometimes with no connectivity. Job: capture the payment exactly as received in under 20 seconds and move on.
- **Center admins/owners**: configure VAT/commission/payment-method rates, review monthly reports, track settlement payables, reconcile against bKash/bank/card statements, close months, manage staff.
- **Platform super admin (Zia)**: provisions centers, manages users and devices across the tenant fleet, monitors anomalies and audit.
- Four roles — `super_admin`, `owner`, `admin`, `staff` — enforced in RLS and server routes, never by hidden UI. Exactly one active owner per center.

## Product Purpose

Replaces a handwritten payment notebook. Staff enter one gross amount per payment **already received** (the app never collects money); the app splits it into VAT, business commission, and payment-method charge (bKash, Visa, Mastercard, Cash, bank transfer, more configurable via admin), produces monthly reports, tracks monthly settlement payables against fixed due dates, and reconciles them against real statements. Success: entry in under 20 seconds on a phone, accurate monthly totals, settlements tracked and reconciled, closed months trusted as final.

## Positioning

An offline-first payment ledger purpose-built for Bangladesh after-school education centers, run as a multi-tenant platform — confirmed 2026-11-23: intended to onboard other franchisees/centers over time; the super-admin machinery is product, not internal ops tooling. A generic bookkeeping app cannot truthfully claim: exact-integer poisha math independently re-verified server-side; rate profiles frozen per entry so historical records never shift (offline entries under superseded rates are kept and flagged, never recalculated); immutable, fully audited entries where corrections are reversal rows; month close gated on reconciliation and approvals.

## Operating Context

- Kumon franchise learning centers in Dhaka (first centers: Mohakhali, Rampura). Payments arrive as cash, bKash, cards, or bank transfer, usually taken by front-desk staff on a phone.
- Monthly rhythm: reconcile collections against bKash/bank/card statements, track payables with fixed due dates, close the month.
- Deployment: installable PWA plus Android APK distributed directly through the in-app `/download` page (QR code + direct download), not an app store. Backend: Supabase Postgres 15+ (region Singapore/Mumbai).
- All business dates and month boundaries are Asia/Dhaka; amounts in BDT with South Asian digit grouping (৳1,23,456.00).
- The PRD's §6.6/§6.7 fixtures are hand-calculated values from the real historical paper ledger and are quoted exactly in tests — they are evidence, not decoration.

## Capabilities and Constraints

- Offline-first: instant local save (Dexie/IndexedDB), outbox sync; a save never blocks on connectivity.
- Entries are immutable snapshots: void/supersede only, both audited; deletions need owner-authorized purge tooling.
- Money is integer poisha (1 BDT = 100 poisha), decimal strings on the wire; rates are integer basis points from versioned admin-managed rate profiles (draft → published, immutable once published, no backdating).
- Settlement has five states; overpayment requires Owner approval bound to the exact surplus. Month close is gated on reconciliation and pending approvals.
- Reconciliation: Mode A totals-only (shipped), Mode B line-item matching against uploaded statements (bKash CSV and combined card CSV adapters — formats still UNVERIFIED against real statements; PRD §4 Q14 open).
- Server trusts nothing from the client: role, authorship, rate snapshots, and math are re-derived server-side; all financial writes go through audited SECURITY DEFINER RPCs; RLS is forced on every table.
- Whether VAT must be applied at all, and how it must appear in records, is UNVERIFIED and reserved for a qualified accountant (PRD §4 Q1 policy decided 2026-11-13; statutory applicability still open) — the product must never answer this itself.
- UI copy is English-only today; the architecture is i18n-ready (single message catalog) with Noto Sans Bengali self-hosted for rendering Bengali text such as customer names.

## Brand Commitments

- **Name: "Kumon Ledger Track"** — confirmed binding by Zia, 2026-11-23. The repo/package/docs names ("Cosmo Ledger Track", `payment-ledger-track`, key `CLT`) are internal engineering identifiers, not the user-facing brand; the Android app label, i18n catalog, `/download` page, and logo all carry the Kumon name.
- Kumon branding is a binding identity commitment; brand assets live in `docs/Images/` (logo, splash, icon variants, animation) and `apps/web/static/` (favicon, icons). The Android notification tint uses Kumon blue `#2B4C7E`.
- Voice/personality: no confirmed voice guideline exists yet — do not invent one.

## Evidence on Hand

- Hand-calculated paper-ledger fixtures (PRD §6.6/§6.7): real historical payment splits, quoted exactly in `packages/calc` tests.
- Brand assets: `docs/Images/kumon-ledger-track-logo.png`, `Kumon Ledger Track Logo.png`, splash PNG/GIF, icon PNGs, animation progression GIF; `apps/web/static/` favicon and icons.
- A documented visual system exists in `docs/design/DESIGN.md` ("Calm Financial Clarity") — incumbent authority for refinement, to be recorded properly via `/impeccable document` if wanted.
- **Absences that must not be fabricated**: no customer testimonials, press, case studies, or usage metrics exist; real bKash/card statement formats are not on hand (Mode B adapters unverified).

## Product Principles

1. **Never block a save.** Offline capture is the first promise; connectivity is a background concern, never a gate.
2. **The ledger is sacrosanct.** Entries are immutable, audited snapshots; corrections are explicit reversals, never silent edits.
3. **Exact money, always.** Integer poisha everywhere, independently re-verified server-side; history never changes when rates do.
4. **Twenty seconds at the counter.** Capture speed on a shared phone is the primary job; every flow defers to it.
5. **A closed month is final.** Reconciliation and approvals gate the close; closed months are the trust anchor for reports and settlements.

## Accessibility & Inclusion

- WCAG AA (≥ 4.5:1) in light and dark themes; 44px minimum touch targets; honors `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more`.
- Designed for shared counter devices (composite device+user registry) and low-end Android hardware; one-handed phone use is the norm, not the exception.
- No screen-reader-specific or multi-language requirement established beyond the i18n-ready message catalog.
