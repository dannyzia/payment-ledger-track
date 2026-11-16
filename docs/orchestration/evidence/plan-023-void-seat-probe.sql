-- Plan 023 probe: does the platform seat's void survive a database built from
-- supabase/migrations in filename order?
--
-- The defect it pins: 20261114000008_super_admin_panel.sql used to re-create
-- rpc_push_sync_op after 20261029000009_super_admin_ledger_writes.sql added the
-- super_admin branch, so the later body won and the seat's void was refused
-- 403 unauthorized on any database built from the migrations. Since
-- 20261116000010_push_rpc_seat_authoritative.sql the last definition is the
-- seat-aware one; this probe stays as the regression check for that order.
--
-- Run against a throwaway database provisioned from the migrations:
--   CLT_TEST_DB_NAME=clt_test_void_probe pnpm exec tsx \
--     -e "import('./tests/db/helpers/test-db.ts').then(m => m.ensureTestDatabase())"
--   psql postgresql://postgres:postgres@127.0.0.1:54322/clt_test_void_probe \
--     -f docs/orchestration/evidence/plan-023-void-seat-probe.sql

\set ON_ERROR_STOP on

-- Deterministic fixtures ------------------------------------------------------

insert into auth.users (id, email)
values
  ('a1000000-0000-4000-8000-000000000001', 'seat@cosmo.local'),
  ('a1000000-0000-4000-8000-000000000002', 'owner@cosmo.local'),
  ('a1000000-0000-4000-8000-000000000003', 'staff@cosmo.local')
on conflict (id) do nothing;

insert into centers (id, code, name, legal_entity_name, address, phone)
values (
  'c1000000-0000-4000-8000-000000000001',
  'PRB', 'Probe Center', 'Probe Center Ltd', 'Dhaka', '01700000000'
)
on conflict (id) do nothing;

insert into center_counters (center_id, next_entry_number)
values ('c1000000-0000-4000-8000-000000000001', 1)
on conflict (center_id) do nothing;

-- The seat is a platform profile: center_id NULL, role super_admin.
insert into profiles (id, center_id, full_name, role, active)
values
  ('a1000000-0000-4000-8000-000000000001', null, 'Platform Seat', 'super_admin', true),
  ('a1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Center Owner', 'owner', true),
  ('a1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'Center Staff', 'staff', true)
on conflict (id) do update
set center_id = excluded.center_id, role = excluded.role, active = excluded.active;

insert into payment_methods (center_id, id, code, name, requires_txn_ref, active, sort_order)
values (
  'c1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', 'cash', 'Cash', false, false, 1
)
on conflict (id) do nothing;

insert into rate_profiles (
  center_id, id, version, effective_from, status, vat_mode, vat_bp,
  commission_base, commission_bp, charges_borne_by, created_by
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 1, '2026-01-01', 'draft', 'manual', 0,
  'gross_minus_vat', 4200, 'business', 'a1000000-0000-4000-8000-000000000002'
)
on conflict (id) do nothing;

-- Guarded, not ON CONFLICT: the draft/publish lock trigger raises before a
-- conflict can be resolved if the profile is already published.
insert into method_rates (center_id, rate_profile_id, method_id, charge_bp)
select
  'c1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', 0
where not exists (
  select 1 from method_rates
  where rate_profile_id = 'd1000000-0000-4000-8000-000000000001'
    and method_id = 'b1000000-0000-4000-8000-000000000001'
);

update rate_profiles
set status = 'published'
where id = 'd1000000-0000-4000-8000-000000000001' and status <> 'published';

update payment_methods
set active = true
where id = 'b1000000-0000-4000-8000-000000000001' and active = false;

insert into devices (center_id, device_id, user_id, device_name, last_rate_version, revoked, last_seen_at)
values (
  'c1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'Probe device', 1, false, now()
)
on conflict (center_id, device_id, user_id) do update set revoked = false;

-- One active entry per probe. Written directly: this probe exercises the void
-- branch, not the create path. gross 100000 = vat 0 + commission 42000 (42% of
-- gross-less-vat) + charge 0 + net 58000, conservation intact.
alter table entries disable trigger trg_entries_immutability;
delete from entries where id in (
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000003'
);
alter table entries enable trigger trg_entries_immutability;

insert into entries (
  id, center_id, entry_date, customer_name, sub_qty, method_id, gross_poisha,
  rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
  business_charge_poisha, customer_charge_poisha, net_poisha, created_by,
  device_id, client_created_at
)
values
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   '2026-10-05', 'Seat probe', 1, 'b1000000-0000-4000-8000-000000000001', 100000,
   'd1000000-0000-4000-8000-000000000001',
   '{"engineVersion":1,"vat":{"mode":"manual","bp":0},"commission":{"bp":4200,"base":"gross_minus_vat"},"charges":{"feeBp":0,"borneBy":"business"}}'::jsonb,
   0, 0, 42000, 0, 0, 0, 58000, 'a1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', now()),
  ('e1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
   '2026-10-06', 'Owner probe', 1, 'b1000000-0000-4000-8000-000000000001', 100000,
   'd1000000-0000-4000-8000-000000000001',
   '{"engineVersion":1,"vat":{"mode":"manual","bp":0},"commission":{"bp":4200,"base":"gross_minus_vat"},"charges":{"feeBp":0,"borneBy":"business"}}'::jsonb,
   0, 0, 42000, 0, 0, 0, 58000, 'a1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', now()),
  ('e1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001',
   '2026-10-07', 'Staff control', 1, 'b1000000-0000-4000-8000-000000000001', 100000,
   'd1000000-0000-4000-8000-000000000001',
   '{"engineVersion":1,"vat":{"mode":"manual","bp":0},"commission":{"bp":4200,"base":"gross_minus_vat"},"charges":{"feeBp":0,"borneBy":"business"}}'::jsonb,
   0, 0, 42000, 0, 0, 0, 58000, 'a1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', now());

-- Probes ----------------------------------------------------------------------

create or replace function probe_void(p_actor uuid, p_role text, p_entry uuid)
returns text language plpgsql as $$
begin
  return rpc_push_sync_op(
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000001',
    p_actor,
    p_role::user_role,
    jsonb_build_array(jsonb_build_object(
      'opId', gen_random_uuid(),
      'type', 'void_entry',
      'clientCreatedAt', now(),
      'maxKnownRateVersion', 1,
      'payload', jsonb_build_object('entryId', p_entry::text, 'reason', 'plan 023 probe')
    ))
  )::text;
exception when others then
  return 'REFUSED: ' || sqlerrm;
end;
$$;

select 'void_as_seat' as probe,
       probe_void('a1000000-0000-4000-8000-000000000001', 'super_admin',
                  'e1000000-0000-4000-8000-000000000001') as outcome;

select 'void_as_owner' as probe,
       probe_void('a1000000-0000-4000-8000-000000000002', 'owner',
                  'e1000000-0000-4000-8000-000000000002') as outcome;

select 'void_as_staff' as probe,
       probe_void('a1000000-0000-4000-8000-000000000003', 'staff',
                  'e1000000-0000-4000-8000-000000000003') as outcome;

\echo '--- entry state after the probes ---'
select right(id::text, 1) as entry, status, voided_by is not null as has_voided_by
from entries
where id in (
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000003'
)
order by id;

\echo '--- entry.void audit rows written by this probe ---'
select actor::text as actor, target_id, after->>'status' as status_after
from audit_log
where action = 'entry.void'
  and target_id in (
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000003'
  )
order by at;
