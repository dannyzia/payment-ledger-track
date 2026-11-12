-- Migration 002: Multi-Center Tables 9 to 20 (PRD §7)
-- Every operational row carries center_id; child tables use composite foreign
-- keys so a row in one center can never reference a parent in another.

-- Table 9: settlements
create table settlements (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  payable_id uuid not null,
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
  unique (center_id, id),
  unique (center_id, payable_id, month),
  constraint fk_settlements_payable foreign key (center_id, payable_id)
    references payables(center_id, id) on delete restrict,
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
  center_id uuid not null references centers(id),
  settlement_id uuid not null,
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
  unique (center_id, id),
  constraint fk_settlement_payments_settlement foreign key (center_id, settlement_id)
    references settlements(center_id, id) on delete restrict,
  constraint chk_settlement_payments_amount_poisha check (amount_poisha > 0),
  constraint chk_reversal_reference check (
    (is_reversal = false and reverses_payment_id is null)
    or
    (is_reversal = true and reverses_payment_id is not null)
  )
);
create index idx_settlement_payments_settlement on settlement_payments (center_id, settlement_id);

-- Table 11: statements
create table statements (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  kind text not null default 'single_payable' check (kind in ('single_payable', 'combined_card')),
  month date not null,
  source text not null check (source in ('manual_total', 'file')),
  file_storage_path text,
  file_sha256 text,
  statement_total_poisha bigint not null check (statement_total_poisha >= 0),
  expected_poisha bigint not null check (expected_poisha >= 0),
  variance_poisha bigint generated always as (statement_total_poisha - expected_poisha) stored,
  status text not null default 'open' check (status in ('open', 'reconciled', 'superseded')),
  superseded_by uuid,
  note text,
  created_by uuid references profiles,
  reconciled_by uuid references profiles,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, id),
  unique (center_id, id, month),
  constraint fk_statements_superseded_by foreign key (center_id, superseded_by)
    references statements(center_id, id) on delete restrict,
  constraint chk_statements_month check (month = date_trunc('month', month)::date),
  constraint chk_statement_source check (
    source != 'file' or (file_storage_path is not null and file_sha256 is not null and length(trim(file_sha256)) = 64)
  )
);

-- Table 12: statement_payables
create table statement_payables (
  center_id uuid not null references centers(id),
  statement_id uuid not null,
  payable_id uuid not null,
  month date not null,
  status text not null default 'open' check (status in ('open', 'reconciled', 'superseded')),
  primary key (statement_id, payable_id),
  constraint fk_statement_payables_statement foreign key (center_id, statement_id, month)
    references statements(center_id, id, month) on delete restrict,
  constraint fk_statement_payables_payable foreign key (center_id, payable_id)
    references payables(center_id, id) on delete restrict,
  constraint chk_statement_payables_month check (month = date_trunc('month', month)::date)
);
create unique index uq_active_statement_coverage on statement_payables (center_id, payable_id, month) where status != 'superseded';

-- Table 13: statement_lines
create table statement_lines (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  statement_id uuid not null,
  line_date date,
  reference text,
  gross_poisha bigint,
  fee_poisha bigint,
  matched_entry_id uuid,
  is_active_match boolean not null default true,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'accepted')),
  review_note text,
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, id),
  constraint fk_statement_lines_statement foreign key (center_id, statement_id)
    references statements(center_id, id) on delete restrict,
  constraint fk_statement_lines_entry foreign key (center_id, matched_entry_id)
    references entries(center_id, id) on delete restrict,
  constraint chk_statement_line_acceptance check (
    (match_status = 'accepted' and reviewed_by is not null and reviewed_at is not null and review_note is not null and length(trim(review_note)) > 0)
    or
    (match_status = 'matched' and matched_entry_id is not null)
    or
    (match_status = 'unmatched' and matched_entry_id is null)
  )
);
create unique index uq_active_statement_line_entry on statement_lines (center_id, statement_id, matched_entry_id)
  where matched_entry_id is not null and is_active_match = true;

-- Table 14: month_closes
create table month_closes (
  center_id uuid not null references centers(id),
  month date not null,
  status text not null default 'closed' check (status in ('closed', 'open')),
  closed_by uuid references profiles,
  closed_at timestamptz,
  reopened_by uuid references profiles,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (center_id, month),
  constraint chk_month_closes_month check (month = date_trunc('month', month)::date)
);

-- Table 15: month_close_events
create table month_close_events (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references centers(id),
  month date not null,
  action text not null check (action in ('close', 'reopen')),
  actor uuid not null references profiles,
  reason text,
  created_at timestamptz not null default now(),
  constraint fk_month_close_events_close foreign key (center_id, month)
    references month_closes(center_id, month) on delete restrict,
  constraint chk_month_close_events_month check (month = date_trunc('month', month)::date)
);

-- Table 16: audit_log (append-only, NOT partitioned; at is the time column)
create table audit_log (
  id bigint generated always as identity primary key,
  center_id uuid references centers(id),
  at timestamptz not null default now(),
  actor uuid references profiles,
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb
);
create index idx_audit_log_center_at on audit_log (center_id, at desc);

-- Table 17: sync_ops
create table sync_ops (
  op_id uuid primary key,
  center_id uuid not null references centers(id),
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
  created_at timestamptz not null default now(),
  unique (center_id, op_id)
);
create index idx_sync_ops_center_actor on sync_ops (center_id, actor_id, created_at);
create index idx_sync_ops_center_device on sync_ops (center_id, device_id, created_at);
create unique index uq_sync_ops_superseded on sync_ops (center_id, supersedes_rejected_op_id) where result = 'ok';

-- Table 18: app_settings (one row per center)
create table app_settings (
  center_id uuid primary key references centers(id) on delete cascade,
  timezone text not null default 'Asia/Dhaka',
  currency text not null default 'BDT',
  locale text not null default 'en-BD',
  net_label text not null default 'Net after deductions',
  reconcile_tolerance_poisha bigint not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_app_settings_fixed_tz check (timezone = 'Asia/Dhaka' and currency = 'BDT' and locale = 'en-BD')
);
