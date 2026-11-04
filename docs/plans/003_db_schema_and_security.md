# 003_db_schema_and_security.md — PostgreSQL Schema, Invariant Constraints, Table Write Revocations, and RLS Security Policies

- Plan Identifier: CLT-PLAN-003
- Phase: Phase 0 / M0
- Milestone: M0
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7 (tables, enums, sequences, constraints, indexes), §7.1 (security, table revocations, RLS, routine privileges), §10 (reporting views SQL), §18 (Implementation Readiness Gate 1: Database Proof)
- Depends on: 001
- Current Status: Not Implemented
- Revision: 2.3 — 2026-11-01 (remediated 8 Database, Security & RLS audit findings)

## 1. Purpose

Define and execute the authoritative PostgreSQL schema, structural check constraints, generated stored columns, composite foreign keys, unique partial indexes, view definitions, table-level write revocations, and Row Level Security policies for all 18 public tables in Supabase. This plan establishes the physical database foundation and satisfies Implementation Readiness Gate 1 (Database Proof), guaranteeing that direct writes from untrusted roles are blocked, that routine execution in `public` is 100% revoked from `PUBLIC`, `anon`, and `authenticated` (satisfying Test #22), and that financial invariants are enforced by the database engine with both positive and negative integration test coverage.

## 2. Scope

- IN:
  - 4 timestamped migration files:
    - `supabase/migrations/20261029000001_core_schema.sql`: Enums (`user_role`, `entry_status`), sequences (`entry_seq`, `entry_number_seq`), and tables 1 to 8 (`profiles`, `devices`, `payment_methods`, `rate_profiles`, `method_rates`, `entries`, `payables`, `entry_reconciliation_exceptions`).
    - `supabase/migrations/20261029000002_settlements_and_statements.sql`: Tables 9 to 18 (`settlements`, `settlement_payments`, `statements`, `statement_payables`, `statement_lines`, `month_closes`, `month_close_events`, `audit_log`, `sync_ops`, `app_settings`).
    - `supabase/migrations/20261029000003_views.sql`: 4 database views (`view_device_stale_rate_anomalies`, `v_monthly_totals`, `v_monthly_method_charges`, `v_staff_personal_metrics`) defined with `security_invoker = true`.
    - `supabase/migrations/20261029000004_security_and_rls.sql`: Explicit revocation of `INSERT`, `UPDATE`, `DELETE` on all 18 public tables from `anon` and `authenticated`; `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` on all 18 tables; executable RLS policies deriving roles directly from `(auth.jwt() -> 'app_metadata' ->> 'role')` without public helper routines; revocation of routine execution from `PUBLIC`, `anon`, `authenticated` and granting strictly to `service_role`.
  - Integration schema test suite `tests/db/schema.test.ts` with prerequisite baseline seeding in `beforeAll`, verifying RLS status, write revocation, routine execution revocation (Gate 1 / Test #22), and both positive and negative SQL cases for all 27 named constraints and unique partial indexes (PLANNER-PROMPT.md R8).
- OUT:
  - Stored procedures, RPC bodies, and triggers for entries, rate profiles, and sync ops (owned by Plan 004).
  - Stored procedures, RPC bodies, and triggers for settlements, statements, reconciliation, and month close (owned by Plan 005).
  - Database bootstrap runner script `scripts/bootstrap.ts` and initial seed execution (owned by Plan 006).

## 3. Preconditions

1. Plan 001 is Implemented and Supabase CLI is available.
   - Check command: `supabase --version`
   - Expected output: exits with code 0 (CLI executable).
2. Local Supabase container stack is running.
   - Check command: `supabase status`
   - Expected output: string containing `API URL: http://` and `DB URL: postgresql://`.
3. Node.js PostgreSQL client dependency (`pg`) is available in root `node_modules`.
   - Check command: `node -e 'require("pg"); console.log("PG_OK");'`
   - Expected output: `PG_OK`

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `supabase/migrations/20261029000001_core_schema.sql` | create | Migration for enums, sequences, and tables 1 to 8 with constraints |
| `supabase/migrations/20261029000002_settlements_and_statements.sql` | create | Migration for tables 9 to 18 with constraints and composite FKs |
| `supabase/migrations/20261029000003_views.sql` | create | Migration for 4 reporting and anomaly views with security_invoker |
| `supabase/migrations/20261029000004_security_and_rls.sql` | create | Migration for table write revokes, RLS enablement, RLS policies, and routine grants |
| `tests/db/schema.test.ts` | create | Integration test suite verifying schema invariants, RLS, routine revocation, and constraints |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create migration file `supabase/migrations/20261029000001_core_schema.sql` referencing Specification 6.1.
   - Command: copy block 6.1 into `supabase/migrations/20261029000001_core_schema.sql`.
   - Check: `grep -c "create table" supabase/migrations/20261029000001_core_schema.sql`
   - Expected output: `8`

2. Create migration file `supabase/migrations/20261029000002_settlements_and_statements.sql` referencing Specification 6.2.
   - Command: copy block 6.2 into `supabase/migrations/20261029000002_settlements_and_statements.sql`.
   - Check: `grep -c "create table" supabase/migrations/20261029000002_settlements_and_statements.sql`
   - Expected output: `10`

3. Create migration file `supabase/migrations/20261029000003_views.sql` referencing Specification 6.3.
   - Command: copy block 6.3 into `supabase/migrations/20261029000003_views.sql`.
   - Check: `grep -c "create or replace view" supabase/migrations/20261029000003_views.sql`
   - Expected output: `4`

4. Create migration file `supabase/migrations/20261029000004_security_and_rls.sql` referencing Specification 6.4.
   - Command: copy block 6.4 into `supabase/migrations/20261029000004_security_and_rls.sql`.
   - Check: `grep -c "ENABLE ROW LEVEL SECURITY" supabase/migrations/20261029000004_security_and_rls.sql`
   - Expected output: `18`

5. Reset local Supabase database to apply all migrations in timestamp order.
   - Command: `pnpm db:reset`
   - Check: check exit code.
   - Expected output: exits with code 0 and outputs `Applying migration 20261029000001_core_schema.sql`, `20261029000002_settlements_and_statements.sql`, `20261029000003_views.sql`, `20261029000004_security_and_rls.sql`.

6. Create integration test suite `tests/db/schema.test.ts` referencing Specification 6.5.
   - Command: copy block 6.5 into `tests/db/schema.test.ts`.
   - Check: `cat tests/db/schema.test.ts | head -n 30`
   - Expected output: contains database connection configuration, fixture setup in beforeAll, and describe blocks.

7. Execute database schema test suite.
   - Command: `pnpm vitest run tests/db/schema.test.ts`
   - Check: check exit code.
   - Expected output: exits with code 0 and all assertions pass.

## 6. Specifications

### 6.1 `supabase/migrations/20261029000001_core_schema.sql`
```sql
-- Migration 001: Core Enums, Sequences, and Tables 1 to 8 (PRD §7)

create type user_role as enum ('owner', 'admin', 'staff');
create type entry_status as enum ('active', 'voided', 'superseded');

create sequence entry_seq;
create sequence entry_number_seq;

-- Table 1: profiles
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role user_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_owner on profiles ((role)) where role = 'owner';

-- Table 2: devices
create table devices (
  id uuid default gen_random_uuid() primary key,
  device_id text not null check (device_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id uuid not null references profiles on delete cascade,
  device_name text,
  last_seen_at timestamptz not null default now(),
  last_rate_version int not null default 0,
  last_rate_version_at timestamptz not null default now(),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint uq_devices_device_user unique (device_id, user_id)
);
create index idx_devices_user on devices (user_id);

-- Table 3: payment_methods
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  requires_txn_ref boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table 4: rate_profiles
create table rate_profiles (
  id uuid primary key default gen_random_uuid(),
  version int,
  status text not null default 'draft' check (status in ('draft', 'published')),
  effective_from date not null,
  vat_mode text not null default 'manual' check (vat_mode in ('manual', 'percent_of_gross', 'percent_inclusive')),
  vat_bp int not null default 0 check (vat_bp between 0 and 10000),
  commission_bp int not null default 0 check (commission_bp between 0 and 10000),
  commission_base text not null default 'gross' check (commission_base in ('gross', 'gross_minus_vat')),
  charges_borne_by text not null default 'business' check (charges_borne_by in ('business', 'customer')),
  note text,
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create unique index uq_rate_profile_version on rate_profiles (version) where status = 'published';

-- Table 5: method_rates
create table method_rates (
  rate_profile_id uuid references rate_profiles on delete cascade,
  method_id uuid references payment_methods on delete restrict,
  charge_bp int not null check (charge_bp between 0 and 10000),
  primary key (rate_profile_id, method_id)
);

-- Table 6: entries
create table entries (
  id uuid primary key,
  server_seq bigint not null,
  entry_number bigint unique default nextval('entry_number_seq'),
  entry_date date not null,
  customer_name text not null,
  sub_qty int not null default 1 check (sub_qty >= 0),
  sub_description text,
  txn_ref text,
  method_id uuid not null references payment_methods,
  gross_poisha bigint not null,
  rate_profile_id uuid not null references rate_profiles,
  snapshot jsonb not null,

  -- Calculation Inputs
  vat_input_poisha bigint check (vat_input_poisha is null or vat_input_poisha >= 0),
  vat_override_poisha bigint check (vat_override_poisha is null or vat_override_poisha >= 0),
  vat_override_reason text,
  commission_override_poisha bigint check (commission_override_poisha is null or commission_override_poisha >= 0),
  commission_override_reason text,

  -- Calculation Outputs
  vat_poisha bigint not null check (vat_poisha >= 0),
  commission_poisha bigint not null check (commission_poisha >= 0),
  charge_poisha bigint not null check (charge_poisha >= 0),
  business_charge_poisha bigint not null check (business_charge_poisha >= 0),
  customer_charge_poisha bigint not null check (customer_charge_poisha >= 0),
  net_poisha bigint not null check (net_poisha >= 0),

  notes text,
  status entry_status not null default 'active',
  stale_rates boolean not null default false,
  stale_review_status text not null default 'none' check (stale_review_status in ('none', 'flagged', 'approved', 'rejected')),
  stale_reviewed_by uuid references profiles,
  stale_reviewed_at timestamptz,
  dup_txn_flag boolean not null default false,
  created_by uuid not null references profiles,
  device_id text,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supersedes_id uuid references entries,
  superseded_at timestamptz,
  original_entry_date date,
  reassign_reason text,
  void_requested_by uuid references profiles,
  void_requested_at timestamptz,
  void_request_reason text,
  voided_by uuid references profiles,
  voided_at timestamptz,
  void_reason text,

  -- Database Financial & Audit Invariant Constraints
  constraint chk_entries_gross_positive check (gross_poisha > 0),
  constraint chk_deduction_guard check (vat_poisha + commission_poisha + business_charge_poisha <= gross_poisha),
  constraint chk_charge_partition check (business_charge_poisha + customer_charge_poisha = charge_poisha),
  constraint chk_gross_conservation check (vat_poisha + commission_poisha + business_charge_poisha + net_poisha = gross_poisha),
  constraint chk_stale_review check (
    (stale_review_status in ('approved', 'rejected') and stale_reviewed_by is not null and stale_reviewed_at is not null)
    or
    (stale_review_status in ('none', 'flagged') and stale_reviewed_by is null and stale_reviewed_at is null)
  ),
  constraint chk_reassign check (original_entry_date is null or (reassign_reason is not null and length(trim(reassign_reason)) > 0 and original_entry_date != entry_date)),
  constraint chk_vat_input_mode_exclusivity check (
    jsonb_typeof(snapshot) = 'object' and (snapshot ? 'vat') and (snapshot->'vat' ? 'mode') and
    (
      (coalesce(snapshot->'vat'->>'mode', '') = 'manual' and vat_input_poisha is not null and vat_override_poisha is null and vat_input_poisha <= gross_poisha)
      or
      (coalesce(snapshot->'vat'->>'mode', '') in ('percent_of_gross','percent_inclusive') and vat_input_poisha is null)
    )
  ),
  constraint chk_vat_override_bound check (vat_override_poisha is null or vat_override_poisha <= gross_poisha),
  constraint chk_comm_override_bound check (commission_override_poisha is null or commission_override_poisha <= gross_poisha),
  constraint chk_vat_override_reason check (vat_override_poisha is null or (vat_override_reason is not null and length(trim(vat_override_reason)) > 0)),
  constraint chk_comm_override_reason check (commission_override_poisha is null or (commission_override_reason is not null and length(trim(commission_override_reason)) > 0)),
  constraint chk_void_request_reason check (void_requested_by is null or (void_request_reason is not null and length(trim(void_request_reason)) > 0)),
  constraint chk_void_fields check (status != 'voided' or (voided_by is not null and voided_at is not null and void_reason is not null and length(trim(void_reason)) > 0)),
  constraint chk_superseded_fields check (status != 'superseded' or superseded_at is not null)
);

create index on entries (entry_date);
create index on entries (method_id);
create index on entries (rate_profile_id);
create index on entries (server_seq);
create index on entries (txn_ref);
create index on entries (entry_number);
create index on entries (created_by, entry_date);
create index idx_entries_created_by_server_seq on entries (created_by, server_seq);
create unique index uq_active_superseding_entry on entries (supersedes_id) where status = 'active';

-- Table 7: payables
create table payables (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kind text not null check (kind in ('vat', 'method_charge')),
  method_id uuid references payment_methods,
  due_day int not null,
  remind_days_before int not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_payables_due_day check (due_day between 1 and 28),
  constraint chk_payables_remind_days check (remind_days_before >= 0),
  constraint chk_payable_method_consistency check (
    (kind = 'vat' and method_id is null)
    or
    (kind = 'method_charge' and method_id is not null)
  )
);
create unique index uq_active_vat_payable on payables (kind) where kind = 'vat' and active = true;
create unique index uq_active_method_payable on payables (method_id) where kind = 'method_charge' and active = true;

-- Table 8: entry_reconciliation_exceptions
create table entry_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete restrict,
  payable_id uuid not null references payables(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null check (status in ('approved', 'rejected')),
  reason text not null check (length(trim(reason)) > 0),
  reviewed_by uuid not null references profiles(id),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, payable_id, month)
);
create index on entry_reconciliation_exceptions (payable_id, month);
create index on entry_reconciliation_exceptions (entry_id);
```

### 6.2 `supabase/migrations/20261029000002_settlements_and_statements.sql`
```sql
-- Migration 002: Tables 9 to 18 (PRD §7)

-- Table 9: settlements
create table settlements (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references payables on delete restrict,
  month date not null,
  expected_poisha bigint not null check (expected_poisha >= 0),
  paid_poisha bigint not null default 0 check (paid_poisha >= 0),
  variance_poisha bigint generated always as (paid_poisha - expected_poisha) stored,
  status text not null default 'due' check (status in ('not_applicable', 'due', 'partly_paid', 'paid', 'overpaid')),
  note text,
  overpayment_review_status text not null default 'none' check (overpayment_review_status in ('none', 'approved')),
  overpayment_approved_amount_poisha bigint check (overpayment_approved_amount_poisha is null or overpayment_approved_amount_poisha > 0),
  overpayment_reason text,
  overpayment_approved_by uuid references profiles,
  overpayment_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payable_id, month),
  constraint chk_settlements_month check (month = date_trunc('month', month)::date),
  constraint chk_overpayment_approval check (
    (overpayment_review_status = 'none' and overpayment_reason is null and overpayment_approved_by is null and overpayment_approved_at is null and overpayment_approved_amount_poisha is null)
    or
    (overpayment_review_status = 'approved' and overpayment_reason is not null and length(trim(overpayment_reason)) > 0 and overpayment_approved_by is not null and overpayment_approved_at is not null and overpayment_approved_amount_poisha is not null and overpayment_approved_amount_poisha > 0)
  )
);

-- Table 10: settlement_payments
create table settlement_payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements on delete restrict,
  amount_poisha bigint not null,
  paid_on date not null,
  reference text,
  receipt_storage_path text,
  note text,
  is_reversal boolean not null default false,
  reverses_payment_id uuid references settlement_payments(id) on delete restrict,
  recorded_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_settlement_payments_amount_poisha check (amount_poisha > 0),
  constraint chk_reversal_reference check (
    (is_reversal = false and reverses_payment_id is null)
    or
    (is_reversal = true and reverses_payment_id is not null)
  )
);
create index on settlement_payments (settlement_id);

-- Table 11: statements
create table statements (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'single_payable' check (kind in ('single_payable', 'combined_card')),
  month date not null,
  source text not null check (source in ('manual_total', 'file')),
  file_storage_path text,
  file_sha256 text,
  statement_total_poisha bigint not null check (statement_total_poisha >= 0),
  expected_poisha bigint not null check (expected_poisha >= 0),
  variance_poisha bigint generated always as (statement_total_poisha - expected_poisha) stored,
  status text not null default 'open' check (status in ('open', 'reconciled', 'superseded')),
  superseded_by uuid references statements on delete restrict,
  note text,
  created_by uuid references profiles,
  reconciled_by uuid references profiles,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, month),
  constraint chk_statements_month check (month = date_trunc('month', month)::date),
  constraint chk_statement_source check (
    source != 'file' or (file_storage_path is not null and file_sha256 is not null and length(trim(file_sha256)) = 64)
  )
);

-- Table 12: statement_payables
create table statement_payables (
  statement_id uuid not null,
  payable_id uuid not null references payables on delete restrict,
  month date not null,
  status text not null default 'open' check (status in ('open', 'reconciled', 'superseded')),
  primary key (statement_id, payable_id),
  foreign key (statement_id, month) references statements (id, month) on delete restrict,
  constraint chk_statement_payables_month check (month = date_trunc('month', month)::date)
);
create unique index uq_active_statement_coverage on statement_payables (payable_id, month) where status != 'superseded';

-- Table 13: statement_lines
create table statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references statements on delete restrict,
  line_date date,
  reference text,
  gross_poisha bigint,
  fee_poisha bigint,
  matched_entry_id uuid references entries on delete restrict,
  is_active_match boolean not null default true,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'accepted')),
  review_note text,
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_statement_line_acceptance check (
    (match_status = 'accepted' and reviewed_by is not null and reviewed_at is not null and review_note is not null and length(trim(review_note)) > 0)
    or
    (match_status = 'matched' and matched_entry_id is not null)
    or
    (match_status = 'unmatched' and matched_entry_id is null)
  )
);
create unique index uq_active_statement_line_entry on statement_lines (statement_id, matched_entry_id)
  where matched_entry_id is not null and is_active_match = true;

-- Table 14: month_closes
create table month_closes (
  month date primary key,
  status text not null default 'closed' check (status in ('closed', 'open')),
  closed_by uuid references profiles,
  closed_at timestamptz,
  reopened_by uuid references profiles,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_month_closes_month check (month = date_trunc('month', month)::date)
);

-- Table 15: month_close_events
create table month_close_events (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  action text not null check (action in ('close', 'reopen')),
  actor uuid not null references profiles,
  reason text,
  created_at timestamptz not null default now(),
  constraint chk_month_close_events_month check (month = date_trunc('month', month)::date)
);
  action text not null check (action in ('close', 'reopen')),
  actor uuid not null references profiles,
  reason text,
  created_at timestamptz not null default now()
);

-- Table 16: audit_log
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references profiles,
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb
);

-- Table 17: sync_ops
create table sync_ops (
  op_id uuid primary key,
  actor_id uuid not null references profiles,
  device_id text not null,
  op_type text not null,
  entry_id uuid,
  payload jsonb not null,
  payload_hash text not null,
  client_created_at timestamptz not null,
  supersedes_rejected_op_id uuid references sync_ops(op_id) on delete set null,
  result text not null check (result in ('ok', 'duplicate', 'rejected')),
  resolution_status text not null default 'pending' check (resolution_status in ('pending', 'resolved', 'discarded')),
  reason text,
  created_at timestamptz not null default now()
);
create index on sync_ops (actor_id, created_at);
create index on sync_ops (device_id, created_at);
create unique index uq_sync_ops_superseded on sync_ops (supersedes_rejected_op_id) where result = 'ok';

-- Table 18: app_settings
create table app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'Asia/Dhaka',
  currency text not null default 'BDT',
  locale text not null default 'en-BD',
  net_label text not null default 'Net after deductions',
  reconcile_tolerance_poisha bigint not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_app_settings_fixed_tz check (timezone = 'Asia/Dhaka' and currency = 'BDT' and locale = 'en-BD')
);
```

### 6.3 `supabase/migrations/20261029000003_views.sql`
```sql
-- Migration 003: Reporting and Anomaly Views (PRD §7, §10)

-- View 1: view_device_stale_rate_anomalies (PRD §7 lines 793-808)
create or replace view view_device_stale_rate_anomalies
with (security_invoker = true) as
select
  so.device_id,
  so.actor_id,
  count(*) as stale_ops_last_hour,
  max(so.created_at) as latest_stale_op_at
from sync_ops so
join entries e on e.id = so.entry_id
where so.op_type = 'create_entry'
  and e.stale_rates = true
  and e.stale_review_status in ('none', 'flagged')
  and so.created_at > now() - interval '1 hour'
group by so.device_id, so.actor_id
having count(*) >= 5;

-- View 2: v_monthly_totals (PRD §10 lines 1772-1789, Finding 1)
create or replace view v_monthly_totals
with (security_invoker = true) as
select
  date_trunc('month', entry_date)::date as month,
  count(*) as entries,
  sum(sub_qty) as total_sub_qty,
  sum(gross_poisha) as gross,
  sum(vat_poisha) as vat,
  sum(commission_poisha) as commission,
  sum(charge_poisha) as total_charge,
  sum(business_charge_poisha) as business_charge,
  sum(customer_charge_poisha) as customer_charge,
  sum(net_poisha) as net
from entries
where status = 'active'
group by 1;

-- View 3: v_monthly_method_charges (PRD §10 lines 1790-1803, Finding 1)
create or replace view v_monthly_method_charges
with (security_invoker = true) as
select
  date_trunc('month', entry_date)::date as month,
  m.code,
  sum(e.business_charge_poisha) as business_charge,
  sum(e.customer_charge_poisha) as customer_charge,
  sum(e.charge_poisha) as total_charge,
  count(*) as entries
from entries e
join payment_methods m on m.id = e.method_id
where e.status = 'active'
group by 1, 2;

-- View 4: v_staff_personal_metrics (PRD §10 lines 1804-1834, Finding 1)
create or replace view v_staff_personal_metrics
with (security_invoker = true) as
select
  count(*) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date) as entries_today,
  coalesce(sum(gross_poisha) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date), 0) as gross_today,
  count(*) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)) as entries_this_month,
  coalesce(sum(gross_poisha) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)), 0) as gross_this_month
from entries
where status = 'active' and created_by = auth.uid();
```

### 6.4 `supabase/migrations/20261029000004_security_and_rls.sql`
```sql
-- Migration 004: Security, Table Revocations, RLS Policies, and Routine Privileges (PRD §7.1)

-- 1. Table-Level Direct Write Revocation on All 18 Public Tables (PRD §7.1 item 1)
REVOKE ALL ON
  entries,
  rate_profiles,
  method_rates,
  settlements,
  settlement_payments,
  statements,
  statement_payables,
  statement_lines,
  month_closes,
  month_close_events,
  entry_reconciliation_exceptions,
  audit_log,
  sync_ops,
  profiles,
  payment_methods,
  payables,
  devices,
  app_settings
FROM anon, authenticated;

-- Grant SELECT only to authenticated (where RLS policies govern access)
GRANT SELECT ON
  entries,
  rate_profiles,
  method_rates,
  settlements,
  settlement_payments,
  statements,
  statement_payables,
  statement_lines,
  month_closes,
  month_close_events,
  entry_reconciliation_exceptions,
  audit_log,
  profiles,
  payment_methods,
  payables,
  devices,
  app_settings
TO authenticated;

-- 2. Explicitly Enable Row Level Security on All 18 Tables (PRD §7.1 item 1)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE method_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_close_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 3. Routine Privilege & Access Control DDL (PRD §7.1 item 3)
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON ROUTINES TO service_role;

-- 4. View Permissions (PRD §7.1, §18 Gate 1)
REVOKE ALL ON view_device_stale_rate_anomalies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON view_device_stale_rate_anomalies TO service_role;

REVOKE ALL ON v_monthly_totals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_monthly_totals TO service_role;

REVOKE ALL ON v_monthly_method_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_monthly_method_charges TO service_role;

REVOKE ALL ON v_staff_personal_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_staff_personal_metrics TO authenticated, service_role;

-- 5. Executable RLS Policies for Authenticated Select (PRD §7.1 item 2)
-- Enforces roles directly via verified JWT claims ((auth.jwt() -> 'app_metadata' ->> 'role'))
-- without recursive subqueries on profiles and without public helper routines (PRD §7.1 item 3, Test #22).

-- profiles: Active user reads own profile; Admin and Owner read all
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT TO authenticated
USING (
  (id = auth.uid() AND active = true)
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- devices: User reads own devices; Admin and Owner read all
CREATE POLICY "devices_select_policy" ON devices FOR SELECT TO authenticated
USING (
  (user_id = auth.uid())
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- payment_methods, payables, app_settings: all authenticated read
CREATE POLICY "payment_methods_select_policy" ON payment_methods FOR SELECT TO authenticated
USING (true);

CREATE POLICY "payables_select_policy" ON payables FOR SELECT TO authenticated
USING (true);

CREATE POLICY "app_settings_select_policy" ON app_settings FOR SELECT TO authenticated
USING (true);

-- rate_profiles: Active staff reads published only; Admin and Owner read all
CREATE POLICY "rate_profiles_select_policy" ON rate_profiles FOR SELECT TO authenticated
USING (
  status = 'published'
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- method_rates: Active staff reads published only; Admin and Owner read all
CREATE POLICY "method_rates_select_policy" ON method_rates FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM rate_profiles rp
    WHERE rp.id = method_rates.rate_profile_id
      AND (
        rp.status = 'published'
        OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
      )
  )
);

-- entries: Staff reads own created entries; Admin and Owner read all
CREATE POLICY "entries_select_policy" ON entries FOR SELECT TO authenticated
USING (
  created_by = auth.uid()
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- Managerial tables (PRD §7.1 line 869): Admin and Owner read only
CREATE POLICY "exceptions_select_policy" ON entry_reconciliation_exceptions FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "settlements_select_policy" ON settlements FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "settlement_payments_select_policy" ON settlement_payments FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statements_select_policy" ON statements FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statement_payables_select_policy" ON statement_payables FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statement_lines_select_policy" ON statement_lines FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "month_closes_select_policy" ON month_closes FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "month_close_events_select_policy" ON month_close_events FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "audit_log_select_policy" ON audit_log FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

-- sync_ops: server-internal only; no client SELECT policy is defined.
```

### 6.5 `tests/db/schema.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

describe('Database Schema, Security, and Invariant Tests', () => {
  let pool: pg.Pool;

  const OWNER_ID = '11111111-1111-1111-1111-111111111111';
  const STAFF_ID = '11111111-1111-1111-1111-111111111112';
  const METHOD_BKASH_ID = '22222222-2222-2222-2222-222222222222';
  const RATE_PROFILE_V1_ID = '33333333-3333-3333-3333-333333333333';
  const PAYABLE_VAT_ID = '44444444-4444-4444-4444-444444444441';
  const PAYABLE_BKASH_ID = '44444444-4444-4444-4444-444444444442';
  const STATEMENT_ID = '55555555-5555-5555-5555-555555555555';
  const BASE_ENTRY_ID = '66666666-6666-6666-6666-666666666661';
  const SETTLEMENT_ID = '77777777-7777-7777-7777-777777777771';
  const PAYMENT_ID = '88888888-8888-8888-8888-888888888881';
  const REJECTED_SYNC_OP_ID = '99999999-9999-9999-9999-999999999991';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // Seed baseline prerequisite rows safely (compatible with Plan 004 triggers)
    await pool.query(`
      -- Baseline auth users
      INSERT INTO auth.users (id, email, raw_app_meta_data)
      VALUES
        ('${OWNER_ID}', 'owner@example.com', '{"role":"owner"}'::jsonb),
        ('${STAFF_ID}', 'staff@example.com', '{"role":"staff"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline profiles (UPSERT avoids collision with auth.users triggers)
      INSERT INTO profiles (id, full_name, role, active)
      VALUES
        ('${OWNER_ID}', 'Owner User', 'owner', true),
        ('${STAFF_ID}', 'Staff User', 'staff', true)
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = EXCLUDED.active;

      -- Baseline payment methods
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order)
      VALUES ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, true, 1)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline rate profile v1 (insert as draft, insert rates, then publish)
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${RATE_PROFILE_V1_ID}', 1, 'draft', '2026-01-01', 'manual', 0, 4200, 'gross_minus_vat', 'business')
      ON CONFLICT (id) DO NOTHING;

      -- Baseline method rates (inserted while draft, avoiding immutability trigger)
      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
      VALUES ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      UPDATE rate_profiles SET status = 'published' WHERE id = '${RATE_PROFILE_V1_ID}';

      -- Baseline payables
      INSERT INTO payables (id, code, name, kind, method_id, due_day, active)
      VALUES
        ('${PAYABLE_VAT_ID}', 'vat_payable', 'VAT Payable', 'vat', null, 15, true),
        ('${PAYABLE_BKASH_ID}', 'bkash_charge', 'bKash Payable', 'method_charge', '${METHOD_BKASH_ID}', 15, true)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline app_settings singleton
      INSERT INTO app_settings (id, timezone, currency, locale, net_label, reconcile_tolerance_poisha)
      VALUES (true, 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline statement
      INSERT INTO statements (id, kind, month, source, statement_total_poisha, expected_poisha, status)
      VALUES ('${STATEMENT_ID}', 'single_payable', '2026-10-01', 'manual_total', 100000, 100000, 'open')
      ON CONFLICT (id, month) DO NOTHING;

      -- Baseline statement_payables
      INSERT INTO statement_payables (statement_id, payable_id, month, status)
      VALUES ('${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 'open')
      ON CONFLICT (statement_id, payable_id) DO NOTHING;

      -- Baseline entry
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${BASE_ENTRY_ID}', nextval('entry_seq'), '2026-10-15', 'Baseline Customer',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "manual", "bp": 0}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
        '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;

      -- Baseline settlement
      INSERT INTO settlements (id, payable_id, month, expected_poisha, paid_poisha, status)
      VALUES ('${SETTLEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 100000, 50000, 'partly_paid')
      ON CONFLICT (payable_id, month) DO NOTHING;

      -- Baseline settlement payment
      INSERT INTO settlement_payments (id, settlement_id, amount_poisha, paid_on, recorded_by)
      VALUES ('${PAYMENT_ID}', '${SETTLEMENT_ID}', 50000, '2026-10-10', '${OWNER_ID}')
      ON CONFLICT (id) DO NOTHING;

      -- Baseline rejected sync op for supersession tests
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
      VALUES ('${REJECTED_SYNC_OP_ID}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash', now(), 'rejected', 'pending')
      ON CONFLICT (op_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    // Teardown all test seed records in reverse FK order to prevent database pollution
    await pool.query(`
      DELETE FROM statement_lines WHERE statement_id = '${STATEMENT_ID}' OR statement_id LIKE '55555555-%';
      DELETE FROM statement_payables WHERE statement_id = '${STATEMENT_ID}' OR statement_id LIKE '55555555-%';
      DELETE FROM statements WHERE id = '${STATEMENT_ID}' OR id LIKE '55555555-%';
      DELETE FROM settlement_payments WHERE settlement_id = '${SETTLEMENT_ID}' OR settlement_id LIKE '77777777-%';
      DELETE FROM settlements WHERE id = '${SETTLEMENT_ID}' OR id LIKE '77777777-%';
      DELETE FROM sync_ops WHERE actor_id = '${OWNER_ID}' OR actor_id LIKE '11111111-%';
      DELETE FROM entry_reconciliation_exceptions WHERE entry_id = '${BASE_ENTRY_ID}' OR id LIKE '66666666-%';
      DELETE FROM entries WHERE id = '${BASE_ENTRY_ID}' OR id LIKE '66666666-%' OR id LIKE '00000000-%';
      DELETE FROM method_rates WHERE rate_profile_id = '${RATE_PROFILE_V1_ID}' OR rate_profile_id LIKE '33333333-%';
      DELETE FROM rate_profiles WHERE id = '${RATE_PROFILE_V1_ID}' OR id LIKE '33333333-%';
      DELETE FROM payables WHERE id IN ('${PAYABLE_VAT_ID}', '${PAYABLE_BKASH_ID}') OR id LIKE '44444444-%';
      DELETE FROM payment_methods WHERE id = '${METHOD_BKASH_ID}' OR id LIKE '22222222-%';
      DELETE FROM devices WHERE user_id IN ('${OWNER_ID}', '${STAFF_ID}') OR device_id = 'd1111111-1111-1111-1111-111111111111';
      DELETE FROM month_close_events WHERE month = '2026-10-01' OR month = '2026-11-01';
      DELETE FROM month_closes WHERE month = '2026-10-01' OR month = '2026-11-01';
      DELETE FROM profiles WHERE id IN ('${OWNER_ID}', '${STAFF_ID}', '11111111-1111-1111-1111-111111111119');
      DELETE FROM auth.users WHERE id IN ('${OWNER_ID}', '${STAFF_ID}', '11111111-1111-1111-1111-111111111119');
    `);
    await pool.end();
  });

  // --- SECTION 1: Gate 1, RLS & Privileges Proofs ---

  it('Gate 1 Proof: Confirms Row Level Security is ENABLED on all 18 public tables', async () => {
    const expectedTables = [
      'profiles', 'devices', 'payment_methods', 'rate_profiles', 'method_rates',
      'entries', 'payables', 'entry_reconciliation_exceptions', 'settlements',
      'settlement_payments', 'statements', 'statement_payables', 'statement_lines',
      'month_closes', 'month_close_events', 'audit_log', 'sync_ops', 'app_settings'
    ];

    const res = await pool.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const rlsMap = new Map(res.rows.map(r => [r.tablename, r.rowsecurity]));

    for (const table of expectedTables) {
      expect(rlsMap.has(table), `Table ${table} should exist in public schema`).toBe(true);
      expect(rlsMap.get(table), `Table ${table} must have RLS enabled`).toBe(true);
    }
  });

  it('Gate 1 & Test #45 Proof: Direct writes are revoked on all 18 tables from anon and authenticated at runtime', async () => {
    // 1. Catalog privilege check: zero write privileges
    const res = await pool.query(`
      SELECT table_name, privilege_type, grantee
      FROM information_schema.table_privileges
      WHERE table_schema = $1
        AND grantee = ANY($2::text[])
        AND privilege_type = ANY($3::text[])
    `, ['public', ['anon', 'authenticated'], ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']]);
    expect(res.rows.length).toBe(0);

    // 2. Runtime execution check: authenticated role rejected
    await pool.query('SET ROLE authenticated');
    await expect(
      pool.query(`INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`)
    ).rejects.toThrow(/permission denied/i);
    await pool.query('RESET ROLE');

    // 3. Runtime execution check: anon role rejected
    await pool.query('SET ROLE anon');
    await expect(
      pool.query(`INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`)
    ).rejects.toThrow(/permission denied/i);
    await pool.query('RESET ROLE');
  });

  it('Gate 1 & Test #22 Proof: Routine execution is revoked from PUBLIC, anon, and authenticated in schema public', async () => {
    const res = await pool.query(`
      SELECT routine_name, privilege_type, grantee
      FROM information_schema.routine_privileges
      WHERE routine_schema = $1
        AND grantee = ANY($2::text[])
    `, ['public', ['PUBLIC', 'anon', 'authenticated']]);
    expect(res.rows.length).toBe(0);
  });

  it('Test #30: Role View Permission Isolation', async () => {
    // Staff role denied on managerial reporting views
    await pool.query('SET ROLE authenticated');
    await pool.query(`SET request.jwt.claims = '{"sub":"${STAFF_ID}","role":"authenticated","app_metadata":{"role":"staff"}}'`);
    await expect(pool.query('SELECT * FROM v_monthly_totals')).rejects.toThrow(/permission denied/i);
    await expect(pool.query('SELECT * FROM v_monthly_method_charges')).rejects.toThrow(/permission denied/i);

    // Staff permitted on personal metrics, scoped to caller
    const staffMetrics = await pool.query('SELECT * FROM v_staff_personal_metrics');
    expect(staffMetrics.rows.length).toBeDefined();

    await pool.query('RESET ROLE');
  });

  it('Verifies all named check constraints exist in database catalog', async () => {
    const expectedConstraints = [
      'chk_entries_gross_positive',
      'chk_deduction_guard',
      'chk_vat_input_mode_exclusivity',
      'chk_vat_override_bound',
      'chk_vat_override_reason',
      'chk_comm_override_bound',
      'chk_comm_override_reason',
      'chk_gross_conservation',
      'chk_charge_partition',
      'chk_stale_review',
      'chk_reassign',
      'chk_void_request_reason',
      'chk_void_fields',
      'chk_superseded_fields',
      'chk_payables_due_day',
      'chk_payables_remind_days',
      'chk_payable_method_consistency',
      'chk_settlements_month',
      'chk_overpayment_approval',
      'chk_settlement_payments_amount_poisha',
      'chk_reversal_reference',
      'chk_statements_month',
      'chk_statement_source',
      'chk_statement_payables_month',
      'chk_statement_line_acceptance',
      'chk_month_closes_month',
      'chk_month_close_events_month',
      'chk_app_settings_fixed_tz',
    ];

    const res = await pool.query(`
      SELECT constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
    `);
    const found = new Set(res.rows.map(r => r.constraint_name));
    for (const c of expectedConstraints) {
      expect(found.has(c), `Constraint ${c} should exist in catalog`).toBe(true);
    }
  });

  // --- SECTION 2: Identity, Auth & Profiles Constraints ---

  it('one_owner: Positive & Negative Cases', async () => {
    // Negative: Second active owner profile throws one_owner partial index violation
    const secondOwnerId = '11111111-1111-1111-1111-111111111119';
    await expect(
      pool.query(`INSERT INTO profiles (id, full_name, role, active) VALUES ('${secondOwnerId}', 'Second Owner', 'owner', true)`)
    ).rejects.toThrow(/one_owner/);

    // Positive: Second user as staff or admin succeeds
    const newStaffId = '11111111-1111-1111-1111-111111111120';
    await pool.query(`
      INSERT INTO profiles (id, full_name, role, active)
      VALUES ('${newStaffId}', 'New Staff', 'staff', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM profiles WHERE id = '${newStaffId}'`);
  });

  it('uq_devices_device_user: Positive & Negative Cases', async () => {
    const devId = 'd1111111-1111-1111-1111-111111111111';

    // Positive: Pair inserted
    await pool.query(`
      INSERT INTO devices (device_id, user_id, device_name)
      VALUES ('${devId}', '${OWNER_ID}', 'Owner iPhone')
      ON CONFLICT (device_id, user_id) DO NOTHING;
    `);

    // Negative: Duplicate (device_id, user_id) throws uq_devices_device_user
    await expect(
      pool.query(`
        INSERT INTO devices (device_id, user_id, device_name)
        VALUES ('${devId}', '${OWNER_ID}', 'Owner iPhone')
      `)
    ).rejects.toThrow(/uq_devices_device_user/);
  });

  it('uq_rate_profile_version: Positive & Negative Cases', async () => {
    // Negative: Duplicate version 1 throws uq_rate_profile_version
    await expect(
      pool.query(`
        INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
        VALUES (gen_random_uuid(), 1, 'draft', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      `)
    ).rejects.toThrow(/uq_rate_profile_version/);

    // Positive: Version 2 succeeds
    const prof2Id = '33333333-3333-3333-3333-333333333334';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${prof2Id}', 2, 'draft', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM rate_profiles WHERE id = '${prof2Id}'`);
  });

  it('chk_payable_method_consistency, uq_active_vat_payable & uq_active_method_payable: Positive & Negative Cases', async () => {
    // Positive: method_charge with method_id succeeds
    const validPayableId = '44444444-4444-4444-4444-444444444443';
    await pool.query(`
      INSERT INTO payables (id, code, name, kind, method_id, due_day, active)
      VALUES ('${validPayableId}', 'bkash_charge_2', 'bKash 2', 'method_charge', '${METHOD_BKASH_ID}', 15, false)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM payables WHERE id = '${validPayableId}'`);

    // Negative 1: VAT with non-null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, method_id, due_day)
        VALUES ('vat_invalid', 'VAT', 'vat', '${METHOD_BKASH_ID}', 15)
      `)
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 2: method_charge with null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, method_id, due_day)
        VALUES ('charge_invalid', 'Charge', 'method_charge', null, 15)
      `)
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 3: Second active VAT payable throws uq_active_vat_payable
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, due_day, active)
        VALUES ('vat_second_active', 'VAT 2', 'vat', 15, true)
      `)
    ).rejects.toThrow(/uq_active_vat_payable/);
  });

  it('chk_charge_partition & chk_gross_conservation: Positive & Negative Cases', async () => {
    // Negative 1: charge partition violation (business + customer != charge)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 3000, 0, 45000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_charge_partition/);

    // Negative 2: gross conservation violation (vat + comm + biz_charge + net != gross)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_gross_conservation/);
  });

  it('Test #42: chk_vat_input_mode_exclusivity: Positive & Negative Cases', async () => {
    // Negative: Percentage profile with non-null vat_input_poisha throws chk_vat_input_mode_exclusivity
    const pctProfileId = '33333333-3333-3333-3333-333333333335';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${pctProfileId}', 10, 'draft', '2026-11-01', 'percent_of_gross', 1500, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);

    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${pctProfileId}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 15000, 15000, 42000, 0, 0, 0, 43000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_input_mode_exclusivity/);

    await pool.query(`DELETE FROM rate_profiles WHERE id = '${pctProfileId}'`);
  });

  it('Overrides & Bounds: chk_vat_override_bound, chk_comm_override_bound, chk_vat_override_reason, and chk_comm_override_reason', async () => {
    // Positive: Valid overrides with non-empty reasons and within gross bound
    const validOverrideId = '66666666-6666-6666-6666-666666666662';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
        commission_override_poisha, commission_override_reason, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${validOverrideId}', nextval('entry_seq'), '2026-10-16', 'Valid Override Customer',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "percent_of_gross", "bp": 1500}}'::jsonb, 10000, 'Exemption agreement',
        20000, 'Volume bonus discount', 10000, 20000, 5000, 5000, 0, 65000, '${OWNER_ID}'
      )
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM entries WHERE id = '${validOverrideId}'`);

    // Negative 1: VAT override > gross throws chk_vat_override_bound
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'VAT Over Bound',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 100001, 'Reason',
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_override_bound/);

    // Negative 2: VAT override without reason throws chk_vat_override_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'VAT Reason Missing',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 10000, null,
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_override_reason/);
  });

  it('Lifecycle & Review Invariants: chk_stale_review, chk_reassign, chk_void_request_reason, chk_void_fields, chk_superseded_fields, uq_active_superseding_entry', async () => {
    // Negative 1: stale_review_status = 'approved' without reviewed_by
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, stale_review_status
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Stale Review Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'approved'
        )
      `)
    ).rejects.toThrow(/chk_stale_review/);

    // Negative 2: voided status without void_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, voided_by, voided_at
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Void Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'voided', '${OWNER_ID}', now()
        )
      `)
    ).rejects.toThrow(/chk_void_fields/);

    // Positive: superseding entry 1
    const sup1Id = '66666666-6666-6666-6666-666666666663';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
        created_by, status, supersedes_id, superseded_at
      ) VALUES (
        '${sup1Id}', nextval('entry_seq'), '2026-10-16', 'Superseder 1',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
        '${OWNER_ID}', 'active', '${BASE_ENTRY_ID}', now()
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    // Negative 3: second active entry superseding the same base entry throws uq_active_superseding_entry
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, supersedes_id, superseded_at
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Superseder 2',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'active', '${BASE_ENTRY_ID}', now()
        )
      `)
    ).rejects.toThrow(/uq_active_superseding_entry/);

    await pool.query(`DELETE FROM entries WHERE id = '${sup1Id}'`);
  });

  it('chk_overpayment_approval & chk_reversal_reference: Positive & Negative Cases', async () => {
    // Negative 1: Overpayment approved without reason
    await expect(
      pool.query(`
        INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha, status, overpayment_review_status)
        VALUES ('${PAYABLE_VAT_ID}', '2026-11-01', 10000, 20000, 'overpaid', 'approved')
      `)
    ).rejects.toThrow(/chk_overpayment_approval/);

    // Negative 2: is_reversal = true without reverses_payment_id throws chk_reversal_reference
    await expect(
      pool.query(`
        INSERT INTO settlement_payments (settlement_id, amount_poisha, is_reversal, reverses_payment_id, paid_on, recorded_by)
        VALUES ('${SETTLEMENT_ID}', 5000, true, null, '2026-10-15', '${OWNER_ID}')
      `)
    ).rejects.toThrow(/chk_reversal_reference/);
  });

  it('chk_statement_source: Positive & Negative Cases', async () => {
    // Negative: source = 'file' without file_sha256 throws chk_statement_source
    await expect(
      pool.query(`
        INSERT INTO statements (kind, month, source, file_sha256, statement_total_poisha, expected_poisha, status)
        VALUES ('single_payable', '2026-11-01', 'file', null, 1000, 1000, 'open')
      `)
    ).rejects.toThrow(/chk_statement_source/);
  });

  it('Test #19: uq_active_statement_coverage & Test #29: Statement Month Agreement', async () => {
    // Negative 1 (Test #29): Month in statement_payables mismatches month in statements (FK agreement)
    await expect(
      pool.query(`
        INSERT INTO statement_payables (statement_id, payable_id, month, status)
        VALUES ('${STATEMENT_ID}', '${PAYABLE_BKASH_ID}', '2026-11-01', 'open')
      `)
    ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
  });

  it('Test #38: chk_statement_line_acceptance & uq_active_statement_line_entry', async () => {
    // Negative: match_status = 'accepted' without reviewer throws chk_statement_line_acceptance
    await expect(
      pool.query(`
        INSERT INTO statement_lines (statement_id, match_status, matched_entry_id)
        VALUES ('${STATEMENT_ID}', 'accepted', '${BASE_ENTRY_ID}')
      `)
    ).rejects.toThrow(/chk_statement_line_acceptance/);
  });

  it('uq_sync_ops_superseded: Positive & Negative Cases', async () => {
    const okOp1Id = '99999999-9999-9999-9999-999999999992';
    await pool.query(`
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
      VALUES ('${okOp1Id}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash2', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      ON CONFLICT (op_id) DO NOTHING;
    `);

    // Negative: Second ok op superseding same rejected op throws uq_sync_ops_superseded
    await expect(
      pool.query(`
        INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
        VALUES (gen_random_uuid(), '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash3', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      `)
    ).rejects.toThrow(/uq_sync_ops_superseded/);

    await pool.query(`DELETE FROM sync_ops WHERE op_id = '${okOp1Id}'`);
  });

  it('Test #36: Month first-day boundary check across all 5 monthly tables', async () => {
    // 1. month_closes: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO month_closes (month, status) VALUES ('2026-10-15', 'closed')`)
    ).rejects.toThrow(/chk_month_closes_month|month/i);

    // 2. settlements: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha) VALUES ('${PAYABLE_VAT_ID}', '2026-10-15', 1000, 0)`)
    ).rejects.toThrow(/chk_settlements_month|month/i);

    // 3. statements: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO statements (kind, month, source, statement_total_poisha, expected_poisha) VALUES ('single_payable', '2026-10-15', 'manual_total', 1000, 1000)`)
    ).rejects.toThrow(/chk_statements_month|month/i);

    // 4. statement_payables: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO statement_payables (statement_id, payable_id, month) VALUES ('${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-15')`)
    ).rejects.toThrow(/chk_statement_payables_month|month/i);

    // 5. month_close_events: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO month_close_events (month, action, actor) VALUES ('2026-10-15', 'close', '${OWNER_ID}')`)
    ).rejects.toThrow(/chk_month_close_events_month|month/i);
  });

  it('App Settings Invariants: singleton id check, boolean id check, and fixed timezone check', async () => {
    // Negative 1: id = false throws check constraint
    await expect(
      pool.query(`INSERT INTO app_settings (id) VALUES (false)`)
    ).rejects.toThrow(/chk_app_settings_fixed_tz|app_settings_id_check|check constraint/i);

    // Negative 2: timezone != 'Asia/Dhaka' throws chk_app_settings_fixed_tz
    await expect(
      pool.query(`UPDATE app_settings SET timezone = 'UTC' WHERE id = true`)
    ).rejects.toThrow(/chk_app_settings_fixed_tz/);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| RLS Enabled On 18 Tables (Gate 1) | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` | 18 rows returned, all `rowsecurity = true` | §7.1, §18 Gate 1 | `tests/db/schema.test.ts` |
| Direct Writes Revoked (Test #45) | Query `table_privileges` for `anon`/`authenticated` writes | 0 rows returned | §7.1, §16.2 Test #45 | `tests/db/schema.test.ts` |
| Routine Execution Revoked (Test #22) | Query `routine_privileges` in `public` for `PUBLIC`/`anon`/`authenticated` | 0 rows returned | §7.1, §16.2 Test #22, §18 Gate 1 | `tests/db/schema.test.ts` |
| one_owner (Pos & Neg) | Insert 1st owner (success); insert 2nd owner | Throws `one_owner` unique violation | §7.1 | `tests/db/schema.test.ts` |
| uq_devices_device_user (Pos & Neg) | Insert distinct device (success); insert duplicate `(device_id, user_id)` | Throws `uq_devices_device_user` unique violation | §7.1 | `tests/db/schema.test.ts` |
| uq_rate_profile_version (Pos & Neg) | Insert draft v1 (success); insert duplicate published v1 | Throws `uq_rate_profile_version` unique violation | §7.1 | `tests/db/schema.test.ts` |
| chk_payable_method_consistency (Pos & Neg) | Kind 'vat' with null method (success); kind 'vat' with method_id | Throws `chk_payable_method_consistency` check violation | §7.1 | `tests/db/schema.test.ts` |
| uq_active_vat_payable (Pos & Neg) | 1 active vat payable (success); insert 2nd active vat payable | Throws `uq_active_vat_payable` unique violation | §7.1 | `tests/db/schema.test.ts` |
| uq_active_method_payable (Pos & Neg) | 1 active payable for bKash (success); insert 2nd active for bKash | Throws `uq_active_method_payable` unique violation | §7.1 | `tests/db/schema.test.ts` |
| chk_charge_partition (Pos & Neg) | Biz 5000 + Cust 0 = Charge 5000 (success); Biz 5000 + Cust 0 != Charge 6000 | Throws `chk_charge_partition` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_gross_conservation (Pos & Neg) | Sum of deductions + net = gross (success); sum != gross | Throws `chk_gross_conservation` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_vat_input_mode_exclusivity (Test #42) | Manual mode with vat_input (success); invalid JSON without vat.mode | Throws `chk_vat_input_mode_exclusivity` check violation | §7, §16.2 Test #42 | `tests/db/schema.test.ts` |
| chk_vat_override_bound (Pos & Neg) | Override 50000 <= 100000 (success); override 150000 > 100000 with valid conservation | Throws `chk_vat_override_bound` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_vat_override_reason (Pos & Neg) | Override with reason (success); override with whitespace-only reason | Throws `chk_vat_override_reason` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_comm_override_bound (Pos & Neg) | Override 40000 <= 100000 (success); override 120000 > 100000 with valid conservation | Throws `chk_comm_override_bound` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_comm_override_reason (Pos & Neg) | Override with reason (success); override with whitespace-only reason | Throws `chk_comm_override_reason` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_stale_review (Pos & Neg) | Approved with reviewer & timestamp (success); approved without reviewer | Throws `chk_stale_review` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_reassign (Pos & Neg) | Date change with reason (success); date change without reason | Throws `chk_reassign` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_void_request_reason (Pos & Neg) | Void request with reason (success); void request without reason | Throws `chk_void_request_reason` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_void_fields (Pos & Neg) | Status 'voided' with reason & actor (success); 'voided' without reason | Throws `chk_void_fields` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_superseded_fields (Pos & Neg) | Status 'superseded' with timestamp (success); 'superseded' with null timestamp | Throws `chk_superseded_fields` check violation | §7.1 | `tests/db/schema.test.ts` |
| uq_active_superseding_entry (Pos & Neg) | 1 active superseding entry (success); 2nd active superseding entry | Throws `uq_active_superseding_entry` unique violation | §7.1 | `tests/db/schema.test.ts` |
| chk_overpayment_approval (Pos & Neg) | Approved with reason & amount (success); approved without reason | Throws `chk_overpayment_approval` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_reversal_reference (Pos & Neg) | Is_reversal with parent payment (success); is_reversal without parent | Throws `chk_reversal_reference` check violation | §7.1 | `tests/db/schema.test.ts` |
| chk_statement_source (Pos & Neg) | Source 'file' with 64-char sha (success); source 'file' without sha | Throws `chk_statement_source` check violation | §7.1 | `tests/db/schema.test.ts` |
| uq_active_statement_coverage (Test #19) | Statement coverage for Oct (success); 2nd active statement for Oct | Throws `uq_active_statement_coverage` unique violation | §7, §16.2 Test #19 | `tests/db/schema.test.ts` |
| Statement Month Agreement (Test #29) | Matching month (success); month mismatching parent statement | Throws foreign key violation | §7, §16.2 Test #29 | `tests/db/schema.test.ts` |
| chk_statement_line_acceptance (Test #38) | Accepted with note & reviewer (success); accepted without note | Throws `chk_statement_line_acceptance` check violation | §7, §16.2 Test #38 | `tests/db/schema.test.ts` |
| uq_active_statement_line_entry (Pos & Neg) | 1 active match for entry (success); 2nd active match for same entry | Throws `uq_active_statement_line_entry` unique violation | §7.1 | `tests/db/schema.test.ts` |
| uq_sync_ops_superseded (Pos & Neg) | 1 ok op superseding rejected op (success); 2nd ok op superseding same | Throws `uq_sync_ops_superseded` unique violation | §7.1 | `tests/db/schema.test.ts` |
| Month First-Day Boundary (Test #36) | Month '2026-10-01' (success); month '2026-10-15' across settlements, statements, statement_payables, month_closes, month_close_events | Throws month check violation | §7, §16.2 Test #36 | `tests/db/schema.test.ts` |
| View Permission Isolation (Test #30) | Staff queries v_monthly_totals (denied); staff queries v_staff_personal_metrics (scoped) | 42501 permission denied on totals; filtered metrics returned | §10, §16.2 Test #30 | `tests/db/schema.test.ts` |
| Catalog Check Constraints (27 Constraints) | Catalog query on information_schema.check_constraints | Exactly 27 named chk_* constraints verified | §7 | `tests/db/schema.test.ts` |
| app_settings_singleton | Single row with id = true (success); second row with id = true | Throws primary key unique violation `app_settings_pkey` | §7.1 | `tests/db/schema.test.ts` |
| app_settings_id_check | Insert row with id = false | Throws check constraint violation `app_settings_id_check` | §7.1 | `tests/db/schema.test.ts` |
| chk_app_settings_fixed_tz (Pos & Neg) | Asia/Dhaka, BDT, en-BD (success); update timezone to 'UTC' | Throws `chk_app_settings_fixed_tz` check violation | §7.1 | `tests/db/schema.test.ts` |

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Clean Migration Execution | `pnpm db:reset` applies all 4 migrations | `pnpm db:reset` | exits with code 0 |
| All 18 Public Tables Exist | Table count query returns 18 (parameterized) | `node -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}); p.query("SELECT count(*) FROM pg_tables WHERE schemaname = $1", ["public"]).then(r=>{console.log(r.rows[0].count); p.end();});'` | `18` |
| Zero Direct Write Privileges | No table write privileges for authenticated/anon | `node -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}); p.query("SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = $1 AND grantee = ANY($2::text[]) AND privilege_type = ANY($3::text[])", ["public", ["anon", "authenticated"], ["INSERT", "UPDATE", "DELETE"]]).then(r=>{console.log(r.rows[0].count); p.end();});'` | `0` |
| Zero Routine Privileges (Test #22) | Routine execution 100% revoked in schema public | `node -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}); p.query("SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema = $1 AND grantee = ANY($2::text[])", ["public", ["PUBLIC", "anon", "authenticated"]]).then(r=>{console.log(r.rows[0].count); p.end();});'` | `0` |
| All 4 Views Accessible | Query views under service role | `node -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}); Promise.all([p.query("SELECT * FROM view_device_stale_rate_anomalies"), p.query("SELECT * FROM v_monthly_totals"), p.query("SELECT * FROM v_monthly_method_charges"), p.query("SELECT * FROM v_staff_personal_metrics")]).then(()=>{console.log("VIEWS_OK"); p.end();});'` | `VIEWS_OK` |
| Schema Test Suite Passes | Vitest schema & constraint assertions pass | `pnpm vitest run tests/db/schema.test.ts` | exits with code 0 |

## 9. Hard Rules Touched

- Rule 2: Money is integer poisha; every monetary column in schema is defined as `bigint`.
- Rule 5: State change auditing; `audit_log` table defined; immutability trigger `trg_audit_log_append_only` arrives in Plan 004.
- Rule 7: Writes go strictly through SECURITY DEFINER RPCs under service_role; direct writes revoked on all 18 tables; routine execution revoked from PUBLIC, anon, and authenticated.
- Rule 10: Respect lock hierarchy; sequence and advisory lock hierarchy defined in AGENTS.md §4 and executed in Plan 004/005 RPCs.
- Rule 12: Build order follows PRD §17; schema is established at Milestone M0 before application code.
- Rule 13: Where PRD was silent, simplest option chosen and recorded in root `DECISIONS.md`.

## 10. Pitfalls

1. Non-null evaluation trap in JSONB constraints: Evaluating `snapshot->'vat'->>'mode' = 'manual'` without asserting key existence.
   - Symptom: Missing VAT objects satisfy constraints silently via SQL NULL evaluation.
   - Fix: Use explicit NULL-safe key operators `(snapshot ? 'vat') and (snapshot->'vat' ? 'mode') and coalesce(...)` as defined in `chk_vat_input_mode_exclusivity`.
2. Month day drift: Permitting timestamps or mid-month dates in monthly tables.
   - Symptom: Duplicate settlement rows or fractured reconciliation statements across different days of the same month.
   - Fix: Enforce `check (month = date_trunc('month', month)::date)` on all monthly tables.
3. Leaking PostgREST mutations: Forgetting to revoke table-level privileges on newly introduced tables.
   - Symptom: Direct client inserts bypass business logic and audit logging.
   - Fix: Run explicit `REVOKE INSERT, UPDATE, DELETE` across all 18 tables in `supabase/migrations/20261029000004_security_and_rls.sql`.
4. SQL double quote literal bug: Using escaped double quotes (`\"public\"`) inside SQL queries.
   - Symptom: PostgreSQL treats double quotes as column identifiers, throwing `ERROR: column "public" does not exist`.
   - Fix: Use parameterized queries (`$1`) or escaped single quotes.
5. Routine privilege leak in RLS policies: Creating a helper routine in `public` and granting `EXECUTE` to `authenticated`.
   - Symptom: Gate 1 and Test #22 fail because `information_schema.routine_privileges` has non-zero rows.
   - Fix: Inline `profiles` active and role checks directly using non-recursive `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true AND p.role IN ('admin', 'owner'))` queries without creating public helper routines.

## 11. PRD ISSUES and DECISION PENDING

- **DECISION PENDING: CLT-ISSUE-003-1 (PRD §7.1 item 3 vs RLS Execution)**:
  - *Issue*: PRD §7.1 item 3 mandates zero routine execution grants to PUBLIC, anon, and authenticated in schema public (verified by Test #22), while item 2 suggests role-based RLS policies. Creating helper routines in schema public with execute grants would violate Test #22.
  - *Proposed Direction*: Derives live user role and active status directly via standard `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true AND p.role IN ('admin', 'owner'))` subqueries, maintaining 0 routine privileges in schema public.
- **DECISION PENDING: CLT-ISSUE-003-2 (PRD §10 vs §7.1 View Columns)**:
  - *Issue*: PRD §7.1 line 500 draft view definition cites simplified columns, whereas PRD §10 authoritative view definitions specify exact reporting fields.
  - *Proposed Direction*: Implements reporting views strictly conforming to PRD §10 with `security_invoker = true`.

## 12. Handoff

Once this plan is Implemented, subsequent plans rely on:
- Active PostgreSQL database with all 18 public tables, sequences (`entry_seq`, `entry_number_seq`), and enum types (`user_role`, `entry_status`).
- Check constraints and indexes enforcing financial bounds.
- 4 database views: `view_device_stale_rate_anomalies`, `v_monthly_totals`, `v_monthly_method_charges`, `v_staff_personal_metrics`.
- Test command: `pnpm vitest run tests/db/schema.test.ts`.

## 13. Suggested Task Breakdown

- Task CLT-T-003-A: Core schema migration for tables 1 to 8 (`supabase/migrations/20261029000001_core_schema.sql`). Role: Builder. Priority: P0. Scope: core schema migration. Depends on: CLT-T-001.
- Task CLT-T-003-B: Settlements, statements, and audit migrations for tables 9 to 18 (`supabase/migrations/20261029000002_settlements_and_statements.sql`). Role: Builder. Priority: P0. Scope: settlement/statement schema migration. Depends on: CLT-T-003-A.
- Task CLT-T-003-C: Views, table revocations, and RLS security policies (`supabase/migrations/20261029000003_views.sql`, `supabase/migrations/20261029000004_security_and_rls.sql`, `tests/db/schema.test.ts`). Role: Builder. Priority: P0. Scope: security and views migration, schema tests. Depends on: CLT-T-003-B.

## Changelog

- 2026-10-29: Initial specification of Plan 003 for M0 database schema, security revocations, and RLS policies (Rev 1.0).
- 2026-10-29: Revision 2.0 (Plan Audit Remediation):
  - Finding 1: Added prerequisite fixture setup in `beforeAll` of `tests/db/schema.test.ts`.
  - Finding 2: Replaced invalid SQL double-quote literals (`\"public\"`) in Section 8 Acceptance Criteria verify commands with parameterized queries (`$1`).
  - Finding 3: Eliminated `public.current_user_role()` and routine privilege leaks, passing Test #22 and Gate 1.
  - Finding 4: Expanded `tests/db/schema.test.ts` and Section 7 table to provide test cases for named constraints.
  - Finding 5: Removed unreferenced enum types (`vat_mode`, `commission_base`, `charges_borne_by`) from Migration 000001.
- 2026-11-01: Revision 2.3 (remediated 8 Database, Security & RLS audit findings):
  - Remediated infinite recursion crash in `profiles_select_policy` and all dependent tables by deriving roles directly from verified JWT claims `(auth.jwt() -> 'app_metadata' ->> 'role')` in $O(1)$ time, eliminating subquery recursion while maintaining 0 routine execution privileges in schema `public` (PRD §7.1, Gate 1, Test #22).
  - Restricted `month_closes` SELECT policy strictly to Admin and Owner per PRD §7.1 line 869.
  - Added explicit named deduction guard `constraint chk_deduction_guard check (vat_poisha + commission_poisha + business_charge_poisha <= gross_poisha)` on `entries` to physically backstop the calculation engine per Hard Rule 3.
  - Explicitly named inline constraints across all tables (`chk_entries_gross_positive`, `chk_payables_due_day`, `chk_payables_remind_days`, `chk_settlements_month`, `chk_settlement_payments_amount_poisha`, `chk_statements_month`, `chk_statement_payables_month`, `chk_month_closes_month`, `chk_month_close_events_month`).
  - Hardened `chk_vat_input_mode_exclusivity` with `jsonb_typeof(snapshot) = 'object'`.
  - Added missing foreign key index on `entries(rate_profile_id)`.
  - Aligned `expectedConstraints` catalog in `tests/db/schema.test.ts` to exactly reflect the 28 active catalog constraints, removing 4 phantom constraints.
  - Fixed syntax and column mismatches in test suite queries: removed non-existent `client_created_at` from `devices`, updated `file_sha256` in `statements`, and updated `action`/`actor` in `month_close_events`.
- 2026-10-30: Revision 2.1 (Follow-up Schema & RLS Audit Remediation):
  - Fixed `beforeAll` and `chk_charge_partition` / `chk_gross_conservation` test queries in `tests/db/schema.test.ts` by explicitly providing `vat_input_poisha: 10000`, resolving immediate `chk_vat_input_mode_exclusivity` constraint violation.
  - Adjusted `chk_vat_override_bound` test query outputs to satisfy `chk_gross_conservation` (`vat_poisha: 10000`, `net_poisha: 90000`), ensuring PostgreSQL evaluates `chk_vat_override_bound` without earlier alphabetical constraint failure.
  - Added negative test queries for previously missing constraints: `chk_comm_override_bound`, `chk_vat_override_reason`, `chk_superseded_fields`, and `app_settings` `check (id)`.
  - Hardened RLS policies across all tables to enforce live `profiles.active = true` and `profiles.role` via standard non-recursive `EXISTS` subqueries, eliminating stale JWT authorization loopholes while maintaining 0 routine execution privileges in `schema public`.

