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
  -- CLT-D-007: canonical snapshot shape is the engine's flat vatMode key
  -- (packages/calc); nested snapshot->'vat'->>'mode' also accepted for tolerance.
  constraint chk_vat_input_mode_exclusivity check (
    jsonb_typeof(snapshot) = 'object' and
    (
      (coalesce(snapshot->>'vatMode', snapshot->'vat'->>'mode', '') = 'manual' and vat_input_poisha is not null and vat_override_poisha is null and vat_input_poisha <= gross_poisha)
      or
      (coalesce(snapshot->>'vatMode', snapshot->'vat'->>'mode', '') in ('percent_of_gross','percent_inclusive') and vat_input_poisha is null)
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
