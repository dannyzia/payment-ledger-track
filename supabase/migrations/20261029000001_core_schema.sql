-- Migration 001: Multi-Center Core Enums, Roots, and Tables 1 to 8 (PRD §7)
-- Multi-center baseline (CLT-D-030): every tenant table carries center_id with
-- composite (center_id, id) keys so a cross-center reference cannot be written.

create type user_role as enum ('super_admin', 'owner', 'admin', 'staff');
create type entry_status as enum ('active', 'voided', 'superseded');

create sequence entry_seq;

-- Table 0a: centers (tenant root)
create table centers (
  id uuid primary key default gen_random_uuid(),
  center_number int generated always as identity unique,
  code varchar(8) not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  name text not null,
  legal_entity_name text not null,
  bin_number varchar(16),
  trade_license_number varchar(32),
  vat_circle text,
  address text not null,
  phone varchar(20) not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now()
);

create or replace function fn_centers_prevent_code_mutation()
returns trigger language plpgsql as $$
begin
  if NEW.code <> OLD.code then
    raise exception '409 centers_code_immutable';
  end if;
  if NEW.center_number <> OLD.center_number then
    raise exception '409 centers_center_number_immutable';
  end if;
  return NEW;
end;
$$;

create trigger trg_centers_immutable_code
before update on centers
for each row execute function fn_centers_prevent_code_mutation();

-- Table 0b: center_counters (per-center sequential entry numbers)
create table center_counters (
  center_id uuid primary key references centers(id) on delete cascade,
  next_entry_number bigint not null default 1 check (next_entry_number > 0)
);

-- Table 1: profiles
-- center_id is NULL only for role = super_admin (platform tier).
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  center_id uuid references centers(id),
  full_name text not null,
  role user_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, id)
  -- A super_admin is always platform-wide (center_id NULL). A tenant role must
  -- be assigned a center, but GoTrue creates the profile row before it applies
  -- raw_app_meta_data, so the center may be filled in a moment later by
  -- fn_auth_users_sync_profile_role. No constraint here, therefore; the RPCs
  -- reject a tenant actor whose center_id is null.
);
create unique index one_owner on profiles (center_id) where role = 'owner' and active = true;

-- Table 2: devices
create table devices (
  id uuid default gen_random_uuid() primary key,
  center_id uuid not null references centers(id),
  device_id text not null check (device_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id uuid not null,
  device_name text,
  last_seen_at timestamptz not null default now(),
  last_rate_version int not null default 0,
  last_rate_version_at timestamptz not null default now(),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint uq_devices_device_user unique (center_id, device_id, user_id),
  constraint fk_devices_center_user foreign key (center_id, user_id)
    references profiles(center_id, id) on delete cascade
);
create index idx_devices_user on devices (center_id, user_id);

-- Table 3: payment_methods
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  code text not null,
  name text not null,
  requires_txn_ref boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, id),
  unique (center_id, code)
);

-- Table 4: rate_profiles
create table rate_profiles (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
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
  published_at timestamptz,
  unique (center_id, id)
);
create unique index uq_rate_profile_version on rate_profiles (center_id, version) where status = 'published';
-- Published profiles are open-ended from effective_from until the next published
-- profile of the same center, so the only possible overlap is an equal start
-- date. A partial unique index enforces exactly that (a window-function EXCLUDE
-- expression is not valid in a table constraint).
create unique index uq_rate_profile_effective_from on rate_profiles (center_id, effective_from) where status = 'published';

-- Table 5: method_rates
create table method_rates (
  center_id uuid not null references centers(id),
  rate_profile_id uuid not null,
  method_id uuid not null,
  charge_bp int not null check (charge_bp between 0 and 10000),
  primary key (rate_profile_id, method_id),
  constraint fk_method_rates_profile foreign key (center_id, rate_profile_id)
    references rate_profiles(center_id, id) on delete cascade,
  constraint fk_method_rates_method foreign key (center_id, method_id)
    references payment_methods(center_id, id) on delete restrict
);

-- Table 6: entries
create table entries (
  id uuid primary key,
  center_id uuid not null references centers(id),
  server_seq bigint not null,
  entry_number bigint,
  entry_date date not null,
  customer_name text not null,
  sub_qty int not null default 1 check (sub_qty >= 0),
  sub_description text,
  txn_ref text,
  method_id uuid not null,
  gross_poisha bigint not null,
  rate_profile_id uuid not null,
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
  created_by uuid not null,
  device_id text,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supersedes_id uuid,
  superseded_at timestamptz,
  original_entry_date date,
  reassign_reason text,
  void_requested_by uuid references profiles,
  void_requested_at timestamptz,
  void_request_reason text,
  voided_by uuid references profiles,
  voided_at timestamptz,
  void_reason text,

  unique (center_id, id),
  unique (center_id, entry_number),
  constraint fk_entries_method foreign key (center_id, method_id)
    references payment_methods(center_id, id),
  constraint fk_entries_rate_profile foreign key (center_id, rate_profile_id)
    references rate_profiles(center_id, id),
  constraint fk_entries_creator foreign key (center_id, created_by)
    references profiles(center_id, id),
  constraint fk_entries_supersedes foreign key (center_id, supersedes_id)
    references entries(center_id, id),

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

create index idx_entries_center_date on entries (center_id, entry_date);
create index idx_entries_center_method on entries (center_id, method_id);
create index idx_entries_center_rate_profile on entries (center_id, rate_profile_id);
create index on entries (server_seq);
create index idx_entries_txn_ref on entries (center_id, txn_ref);
create index idx_entries_entry_number on entries (center_id, entry_number);
create index idx_entries_created_by_date on entries (center_id, created_by, entry_date);
create index idx_entries_created_by_server_seq on entries (center_id, created_by, server_seq);
create unique index uq_active_superseding_entry on entries (center_id, supersedes_id) where status = 'active';

-- Table 7: payables
create table payables (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('vat', 'method_charge')),
  method_id uuid,
  due_day int not null,
  remind_days_before int not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, id),
  unique (center_id, code),
  constraint fk_payables_method foreign key (center_id, method_id)
    references payment_methods(center_id, id),
  constraint chk_payables_due_day check (due_day between 1 and 28),
  constraint chk_payables_remind_days check (remind_days_before >= 0),
  constraint chk_payable_method_consistency check (
    (kind = 'vat' and method_id is null)
    or
    (kind = 'method_charge' and method_id is not null)
  )
);
create unique index uq_active_vat_payable on payables (center_id, kind) where kind = 'vat' and active = true;
create unique index uq_active_method_payable on payables (center_id, method_id) where kind = 'method_charge' and active = true;

-- Table 8: entry_reconciliation_exceptions
create table entry_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  entry_id uuid not null,
  payable_id uuid not null,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null check (status in ('approved', 'rejected')),
  reason text not null check (length(trim(reason)) > 0),
  reviewed_by uuid not null references profiles(id),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, entry_id, payable_id, month),
  constraint fk_exceptions_entry foreign key (center_id, entry_id)
    references entries(center_id, id) on delete restrict,
  constraint fk_exceptions_payable foreign key (center_id, payable_id)
    references payables(center_id, id) on delete restrict
);
create index idx_exceptions_payable_month on entry_reconciliation_exceptions (center_id, payable_id, month);
create index idx_exceptions_entry on entry_reconciliation_exceptions (center_id, entry_id);
