# Payment Ledger App (`payment-ledger-track`)

Offline-first payment ledger and settlement tracking application designed to replace paper payment notebooks for retail and service businesses.

## Key Features

- **Single Gross Entry & Instant Split**: Enter one gross amount and payment method; automatically splits into VAT, business commission, and payment method charges (bKash, Visa, Mastercard, AMEX, Cash) with real-time live preview.
- **Integer-Poisha Math Engine**: Exact integer poisha arithmetic ($1\text{ BDT} = 100\text{ poisha}$) across all client, server, and database layers with zero floating-point drift.
- **Local-First & Offline Resilience**: Instant local saving via IndexedDB (Dexie.js), outbox queuing, and background synchronization via Supabase. Never blocks user saves on network connectivity.
- **Settlement & Dual Reconciliation**:
  - *Mode A (Manual Totals-Only)*: Quick reconciliation of merchant statements against ledger totals.
  - *Mode B (Line-Item Matching)*: One-to-one statement line item reconciliation and exception gating.
- **Financial Integrity & Auditability**:
  - Table-level direct writes revoked; all mutations guarded by `SECURITY DEFINER` RPCs.
  - Immutable entry snapshots with audit logging and collision-free advisory lock serialization.
  - Strict 5-state settlement lifecycle (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`) with Owner overpayment approval gating.
- **Premium Frosted Design**: Custom design system featuring subtle pearl grain, frosted glass sheets, and WCAG AA ($\ge 4.5:1$) contrast-verified color tokens.

## Architecture & Tech Stack

- **Frontend**: SvelteKit, TypeScript, Vanilla CSS design tokens.
- **Offline Storage**: Dexie.js (IndexedDB).
- **Backend & Database**: Supabase / PostgreSQL 15+ with PostGIS and custom PL/pgSQL RPC procedures.
- **Mobile Target**: Capacitor packaging (PWA and Android).

## Documentation

- Full Specification: [docs/plans/PRD-payment-ledger-app.md](docs/plans/PRD-payment-ledger-app.md) (Version 1.7)
- Implementation Roadmap: Milestones M0 through M5.
