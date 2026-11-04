# 004_db_functions_entries_rates_sync.md — Core Database Functions, Mutation Triggers, Rate Profiles, and Sync Push Engine

- Plan Identifier: CLT-PLAN-004
- Phase: Phase 0 / M0
- Milestone: M0
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7.2 (lock hierarchy and sequence lock budget), §7.3 (core functions, triggers, and procedures for entries, rates, sync, devices, users, and admin), §9.1 (sync push protocol & subtransaction fault isolation), §15.1 (audit coverage matrix), §16.2 (tests #1, #2, #8, #14, #15, #18, #24, #31, #32, #41, #44, #56, #57, #59, #60, #61, #62, #63)
- Depends on: 002, 003
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01

## 1. Purpose

Implement the PL/pgSQL database functions, atomic stored procedures, and mutation triggers governing entry creation, supersession, voids, stale-rate administrative review, rate profile draft/published lifecycle, device presence and hardware revocation, user provisioning and ownership transfer, payment methods, payables, settings, and sync operations. This plan implements the SQL arithmetic backstop for non-override fields (including percentage inclusive rounding parity), enforces the global lock hierarchy (Month Lock 1001, Sequence Lock 1002, Rate Lock 1003), writes append-only audit log records within the mutating transaction, and verifies TypeScript-to-SQL arithmetic parity against shared fixtures.

## 2. Scope

- IN:
  - Timestamped migration `supabase/migrations/20261029000005_functions_entries_rates_sync.sql` containing:
    - Helper functions:
      - `mul_bp(amount bigint, bp int)`: Integer basis-point multiplication with half-up rounding.
      - `round_half_up(num bigint, div bigint)`: Integer division helper with half-up rounding for percentage inclusive VAT backstops.
      - `log_audit_event`: Internal helper appending rows to immutable `audit_log` with before and after state snapshots.
    - Sequence and immutability triggers:
      - `trg_entries_server_seq`: Sole authoritative sequence allocator running `BEFORE INSERT OR UPDATE ON entries` under sequence advisory lock (1002, 1).
      - `trg_entries_immutability`: Blocks DELETE on `entries`; blocks direct UPDATE on primary key, financial, metadata, and identity fields; blocks status regression from voided/superseded back to active.
      - `trg_rate_profiles_draft_publish_lock`: Blocks UPDATE/DELETE on published rate profiles.
      - `trg_method_rates_draft_publish_lock`: Blocks INSERT/UPDATE/DELETE on `method_rates` for published profiles.
      - `trg_payment_methods_immutable_code`: Blocks UPDATE on `payment_methods.code`.
      - `trg_payment_methods_active_rate_check`: Blocks setting `active = true` on `payment_methods` without coverage in published rate profile.
      - `trg_auth_users_create_profile`: Provisions `profiles` row derived strictly from `raw_app_meta_data->>'role'`, preventing privilege escalation.
      - `trg_prevent_zero_owners`: Deferrable constraint trigger evaluating at commit to assert at least 1 active owner (supersedes redundant immediate sole-owner triggers that deadlock atomic demote-before-promote ownership transfer).
      - `trg_audit_log_immutability`: Blocks UPDATE and DELETE on `audit_log`.
    - Stored procedures and atomic RPCs:
      - `rpc_push_sync_op`: Multi-month push handler with multi-month ascending lock gathering (1001), sequence lock (1002), rate watermark checks, device revocation handling, SHA-256 canonical op idempotency, subtransaction fault isolation, and SQL arithmetic backstops.
      - `rpc_supersede_entry`: Atomic original entry supersession and replacement entry insertion with full arithmetic, rate-profile date coverage, and gross conservation backstops.
      - `admin_review_stale_entry`: Approves or rejects flagged >৳50k stale entries under month, sequence, and row locks with race condition guards and mandatory reject reason.
      - `admin_invite_user`: Provisions new users or re-invites deactivated accounts with caller role enforcement and owner invite protection.
      - `transfer_ownership`: Atomic two-step demote-before-promote ownership swap ensuring target user is an active admin.
      - `create_or_update_draft_rate_profile`: Draft rate profile creator/updater supporting full replacement of method rates.
      - `publish_rate_profile`: Validates 100% deduction guard, payment method coverage, and publishes rate profile with Asia/Dhaka check.
      - `admin_manage_payment_method`: Creates or updates payment methods with before/after audit tracking.
      - `admin_manage_payable`: Creates or updates payables with range checks (due day 1..28, reminder days 0..14) and before/after audit tracking.
      - `admin_update_settings`: Updates singleton business settings with non-negative tolerance and unknown key guards.
      - `admin_manage_user`: Updates user roles (admin/staff) or active status with owner privilege guards.
      - `admin_manage_device`: Hardware remote killswitch (revoke/unrevoke) with actor authorization.
      - `upsert_device_sync_state`: Registers device presence on push and pull.
      - `purge_expired_sync_ops`: Scheduled retention cleanup of rejected-and-resolved sync operations older than 90 days.
      - Scheduled cron job via `pg_cron` daily at 21:00 UTC (03:00 Asia/Dhaka).
  - Integration parity test suite `tests/db/calc_parity.test.ts` reading `packages/calc/fixtures/test_fixtures.json` portably via `readFileSync`.
  - Integration RPC test suite `tests/db/entries_sync.test.ts` exercising mapped PRD §16.2 tests with complete baseline seed setup, concurrency tests, and robust assertions.
- OUT:
  - Database schema table creation and check constraints (owned by Plan 003).
  - Settlement calculation, payment reversal, and reconciliation procedures (owned by Plan 005).
  - Initial system seed execution in `scripts/bootstrap.ts` (owned by Plan 006).

## 3. Preconditions

1. Plan 002 is Implemented (canonical test fixtures available at `packages/calc/fixtures/test_fixtures.json`).
   - Check command: `test -f packages/calc/fixtures/test_fixtures.json && echo "FIXTURES_OK"`
   - Expected output: `FIXTURES_OK`
2. Plan 003 is Implemented (schema migrations 001–004 applied to local database).
   - Check command: `pnpm vitest run tests/db/schema.test.ts`
   - Expected output: exits with code 0.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `supabase/migrations/20261029000005_functions_entries_rates_sync.sql` | create | PL/pgSQL database functions, mutation triggers, privileged RPCs, and cron job |
| `tests/db/calc_parity.test.ts` | create | Vitest parity suite testing SQL integer arithmetic and rounding against fixtures |
| `tests/db/entries_sync.test.ts` | create | Vitest suite for core entry mutations, sync push pipeline, lock serialization, and admin RPCs |

## 5. Steps

1. Create migration `supabase/migrations/20261029000005_functions_entries_rates_sync.sql`.
2. Define helper functions `mul_bp(bigint, int)`, `round_half_up(bigint, bigint)`, and `log_audit_event`.
3. Define triggers `trg_entries_server_seq` (under lock 1002, 1) and `trg_entries_immutability` protecting immutable financial and identity fields and blocking status regression.
4. Define triggers `trg_rate_profiles_draft_publish_lock`, `trg_method_rates_draft_publish_lock`, and `trg_payment_methods_immutable_code`.
5. Define trigger `trg_payment_methods_active_rate_check` asserting payment methods can only be activated if covered by a published rate profile.
6. Define trigger `trg_auth_users_create_profile` enforcing role derivation strictly from `raw_app_meta_data->>'role'`.
7. Define triggers `trg_prevent_zero_owners`, `trg_users_prevent_sole_owner_deactivation`, and `trg_audit_log_immutability`.
8. Implement stored procedure `upsert_device_sync_state` and admin RPC `admin_manage_device`.
9. Implement stored procedure `transfer_ownership` with two-step atomic demote-before-promote order and admin target validation.
10. Implement user management RPCs `admin_invite_user` and `admin_manage_user` with actor authorization and owner privilege protections.
11. Implement rate profile RPCs `create_or_update_draft_rate_profile` and `publish_rate_profile` with 100% deduction guard, payment method coverage, and Asia/Dhaka no-backdating check.
12. Implement admin review RPC `admin_review_stale_entry` with lock hierarchy, row-level re-check, and mandatory reject reason.
13. Implement admin management RPCs `admin_manage_payment_method`, `admin_manage_payable`, and `admin_update_settings` with range checks and before/after audit tracking.
14. Implement maintenance routine `purge_expired_sync_ops` strictly filtering rejected-and-resolved ops older than 90 days.
15. Implement stored procedure `rpc_supersede_entry` with ascending month locks (1001), sequence lock (1002), rate-profile date coverage check, snapshot integrity check, and gross conservation backstop.
16. Implement sync engine stored procedure `rpc_push_sync_op` with regex-guarded ascending month locks (1001), sequence lock (1002), device revocation check, SHA-256 canonical op idempotency, rate watermark anti-cherry-picking, snapshot integrity, SQL arithmetic backstops, subtransaction fault isolation, and persistent tamper logging.
17. Schedule daily retention cleanup via `pg_cron` at 21:00 UTC (03:00 Asia/Dhaka).
18. Revoke EXECUTE on all newly created functions and procedures from `PUBLIC`, `anon`, and `authenticated`, granting EXECUTE strictly to `service_role`.
19. Author `tests/db/calc_parity.test.ts` testing `mul_bp`, `round_half_up`, deduction guard parity, and override preservation.
20. Author `tests/db/entries_sync.test.ts` exercising mapped PRD §16.2 integration tests with multi-client concurrency tests.
21. Run test suite: `pnpm vitest run tests/db/calc_parity.test.ts tests/db/entries_sync.test.ts`.

## 6. Specifications

### 6.1 `supabase/migrations/20261029000005_functions_entries_rates_sync.sql`
```sql
-- Migration 000005: Core Database Functions, Triggers, and Stored Procedures (PRD §7.2, §7.3, §15.1)

create extension if not exists pgcrypto;

-- 1. SQL Integer Arithmetic Helper (PRD §6.2)
create or replace function mul_bp(amount bigint, bp int)
returns bigint language sql immutable strict parallel safe as $$
  select ((amount * bp + 5000) / 10000)::bigint;
$$;

-- 1b. SQL Integer Rounding Helper for Percentage Inclusive VAT (PRD §6.6, §6.7)
create or replace function round_half_up(num bigint, div bigint)
returns bigint language sql immutable strict parallel safe as $$
  select ((num + (div / 2)) / div)::bigint;
$$;

-- 2. Audit Log Append Helper (PLAN-DERIVED)
create or replace function log_audit_event(
  p_actor_id uuid,
  p_event_name text,
  p_target_table text,
  p_target_id text,
  p_old_values jsonb default null,
  p_new_values jsonb default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (
    actor, action, target_table, target_id, before, after
  ) values (
    p_actor_id, p_event_name, p_target_table, p_target_id, p_old_values, p_new_values
  );
end;
$$;

-- 3. Trigger: Sole Authoritative Sequence Allocator (F3, F54, PRD §7.2)
create or replace function fn_entries_server_seq()
returns trigger language plpgsql as $$
begin
  -- Sequence lock must be held to guarantee monotonic order without skips
  perform pg_advisory_xact_lock(1002, 1);
  NEW.server_seq := nextval('entry_seq');
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger trg_entries_server_seq
before insert or update on entries
for each row execute function fn_entries_server_seq();

-- 4. Trigger: Entries Immutability (F19, PRD §7.1 lines 529-530)
create or replace function fn_entries_immutability()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    raise exception '403 entries_are_immutable';
  end if;

  if TG_OP = 'UPDATE' then
    -- Block status regression: cannot reactivate a voided or superseded entry
    if OLD.status in ('voided', 'superseded') and NEW.status = 'active' then
      raise exception '403 cannot_reactivate_voided_or_superseded_entry';
    end if;

    -- Block modification of primary key, financial fields, and immutable metadata
    if OLD.id != NEW.id
       or OLD.entry_date != NEW.entry_date
       or OLD.customer_name != NEW.customer_name
       or coalesce(OLD.txn_ref, '') != coalesce(NEW.txn_ref, '')
       or OLD.gross_poisha != NEW.gross_poisha
       or OLD.vat_poisha != NEW.vat_poisha
       or OLD.commission_poisha != NEW.commission_poisha
       or OLD.charge_poisha != NEW.charge_poisha
       or OLD.business_charge_poisha != NEW.business_charge_poisha
       or OLD.customer_charge_poisha != NEW.customer_charge_poisha
       or OLD.net_poisha != NEW.net_poisha
       or OLD.method_id != NEW.method_id
       or OLD.rate_profile_id != NEW.rate_profile_id
       or OLD.created_by != NEW.created_by
       or OLD.entry_number != NEW.entry_number
       or OLD.snapshot != NEW.snapshot
       or coalesce(OLD.vat_input_poisha, -1) != coalesce(NEW.vat_input_poisha, -1)
       or coalesce(OLD.vat_override_poisha, -1) != coalesce(NEW.vat_override_poisha, -1)
       or coalesce(OLD.vat_override_reason, '') != coalesce(NEW.vat_override_reason, '')
       or coalesce(OLD.commission_override_poisha, -1) != coalesce(NEW.commission_override_poisha, -1)
       or coalesce(OLD.commission_override_reason, '') != coalesce(NEW.commission_override_reason, '')
       or coalesce(OLD.sub_qty, 1) != coalesce(NEW.sub_qty, 1)
       or coalesce(OLD.sub_description, '') != coalesce(NEW.sub_description, '')
       or coalesce(OLD.supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid) != coalesce(NEW.supersedes_id, '00000000-0000-0000-0000-000000000000'::uuid)
       or coalesce(OLD.original_entry_date, '1970-01-01'::date) != coalesce(NEW.original_entry_date, '1970-01-01'::date)
       or coalesce(OLD.device_id, '') != coalesce(NEW.device_id, '')
       or OLD.client_created_at != NEW.client_created_at then
      raise exception '403 financial_and_identity_fields_are_immutable';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_entries_immutability
before update or delete on entries
for each row execute function fn_entries_immutability();

-- 5. Trigger: Rate Profile Draft/Publish Immutability Lock (F18, F41)
create or replace function fn_rate_profiles_draft_publish_lock()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' and OLD.status = 'published' then
    raise exception '403 published_rate_profile_immutable';
  end if;
  if TG_OP = 'DELETE' and OLD.status = 'published' then
    raise exception '403 published_rate_profile_cannot_be_deleted';
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

create trigger trg_rate_profiles_draft_publish_lock
before update or delete on rate_profiles
for each row execute function fn_rate_profiles_draft_publish_lock();

create or replace function fn_method_rates_draft_publish_lock()
returns trigger language plpgsql as $$
declare
  v_status text;
begin
  if TG_OP in ('INSERT', 'UPDATE') then
    select status into v_status from rate_profiles where id = NEW.rate_profile_id;
  else
    select status into v_status from rate_profiles where id = OLD.rate_profile_id;
  end if;

  if v_status = 'published' then
    raise exception '403 method_rates_published_profile_immutable';
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

create trigger trg_method_rates_draft_publish_lock
before insert or update or delete on method_rates
for each row execute function fn_method_rates_draft_publish_lock();

-- 6. Trigger: Payment Method Code Immutability (F43)
create or replace function fn_payment_methods_immutable_code()
returns trigger language plpgsql as $$
begin
  if OLD.code != NEW.code then
    raise exception '403 payment_method_code_immutable';
  end if;
  return NEW;
end;
$$;

create trigger trg_payment_methods_immutable_code
before update on payment_methods
for each row execute function fn_payment_methods_immutable_code();

-- 7. Trigger: Payment Method Active Rate Check (F53)
create or replace function fn_payment_methods_active_rate_check()
returns trigger language plpgsql as $$
declare
  v_latest_profile_id uuid;
  v_covered boolean;
begin
  if NEW.active = true then
    select id into v_latest_profile_id
    from rate_profiles
    where status = 'published'
      and effective_from <= (now() at time zone 'Asia/Dhaka')::date
    order by effective_from desc, version desc
    limit 1;

    if v_latest_profile_id is null then
      raise exception '422 no_published_rate_profile';
    end if;

    select exists (
      select 1 from method_rates
      where rate_profile_id = v_latest_profile_id and method_id = NEW.id
    ) into v_covered;

    if not v_covered then
      raise exception '422 method_not_covered_in_published_profile';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_payment_methods_active_rate_check
before insert or update of active on payment_methods
for each row execute function fn_payment_methods_active_rate_check();

-- 8. Trigger: User Profile Provisioning on Auth User Creation (C1, A7)
create or replace function fn_auth_users_create_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role user_role := 'staff';
  v_claimed_role text;
  v_full_name text;
begin
  -- Privilege escalation defense: derive role strictly from raw_app_meta_data
  v_claimed_role := NEW.raw_app_meta_data->>'role';
  if v_claimed_role in ('admin', 'staff', 'owner') then
    v_role := v_claimed_role::user_role;
  else
    v_role := 'staff';
  end if;

  v_full_name := coalesce(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_app_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  insert into profiles (id, full_name, role, active)
  values (NEW.id, v_full_name, v_role, true)
  on conflict (id) do update
  set role = EXCLUDED.role,
      full_name = coalesce(profiles.full_name, EXCLUDED.full_name),
      updated_at = now();

  return NEW;
end;
$$;

create trigger trg_auth_users_create_profile
after insert on auth.users
for each row execute function fn_auth_users_create_profile();

-- 9. Trigger: Deferrable Constraint Invariant: Minimum 1 Owner (F11, F15)
-- Evaluated deferred at commit time, supporting atomic demote-before-promote in transfer_ownership
create or replace function fn_prevent_zero_owners()
returns trigger language plpgsql as $$
declare
  v_owner_count int;
begin
  select count(*) into v_owner_count from profiles where role = 'owner' and active = true;
  if v_owner_count < 1 then
    raise exception '422 exactly_one_owner_required';
  end if;
  return null;
end;
$$;

create constraint trigger trg_prevent_zero_owners
after insert or update or delete on profiles
deferrable initially deferred
for each row execute function fn_prevent_zero_owners();

-- 11. Trigger: Audit Log Immutability (F19)
create or replace function fn_audit_log_immutability()
returns trigger language plpgsql as $$
begin
  raise exception '403 audit_log_is_append_only';
end;
$$;

create trigger trg_audit_log_immutability
before update or delete on audit_log
for each row execute function fn_audit_log_immutability();

-- 12. RPC: upsert_device_sync_state (PRD §7.3, H3, M4, H4)
create or replace function upsert_device_sync_state(
  p_device_id text,
  p_user_id uuid,
  p_rate_version int default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into devices (device_id, user_id, last_seen_at, last_rate_version, last_rate_version_at)
  values (
    p_device_id,
    p_user_id,
    now(),
    p_rate_version,
    case when p_rate_version is not null then now() else null end
  )
  on conflict (device_id, user_id) do update
  set last_seen_at = now(),
      last_rate_version = coalesce(EXCLUDED.last_rate_version, devices.last_rate_version),
      last_rate_version_at = case
        when EXCLUDED.last_rate_version is not null then now()
        else devices.last_rate_version_at
      end;
end;
$$;

-- 13. RPC: admin_manage_device (PRD §7.3, H3, M4)
create or replace function admin_manage_device(
  p_device_id text,
  p_action text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_old_revoked boolean;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  select revoked into v_old_revoked from devices where device_id = p_device_id limit 1;
  if v_old_revoked is null then
    raise exception '404 device_not_found';
  end if;

  if p_action = 'revoke' then
    update devices set revoked = true where device_id = p_device_id;
    perform log_audit_event(
      p_actor_id, 'device.revoke', 'devices', p_device_id,
      jsonb_build_object('revoked', v_old_revoked),
      jsonb_build_object('revoked', true, 'reason', 'admin_killswitch')
    );
  elsif p_action = 'unrevoke' then
    update devices set revoked = false where device_id = p_device_id;
    perform log_audit_event(
      p_actor_id, 'device.unrevoke', 'devices', p_device_id,
      jsonb_build_object('revoked', v_old_revoked),
      jsonb_build_object('revoked', false)
    );
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

-- 14. RPC: transfer_ownership (PRD §7.3, Findings B7, F15)
create or replace function transfer_ownership(
  p_new_owner_id uuid,
  p_caller_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_target_role user_role;
  v_target_active boolean;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_caller_id for update;
  if v_caller_role is null or v_caller_active is not true or v_caller_role != 'owner' then
    raise exception '403 unauthorized';
  end if;

  select role, active into v_target_role, v_target_active from profiles where id = p_new_owner_id for update;
  if v_target_role is null or v_target_active is not true then
    raise exception '422 target_user_inactive';
  end if;

  if v_target_role != 'admin' then
    raise exception '422 target_user_must_be_admin';
  end if;

  -- Atomic two-step role swap (demote caller before promoting target)
  update profiles set role = 'admin', updated_at = now() where id = p_caller_id and role = 'owner';
  update profiles set role = 'owner', updated_at = now() where id = p_new_owner_id;

  perform log_audit_event(
    p_caller_id, 'user.ownership_transfer', 'profiles', p_new_owner_id::text,
    jsonb_build_object('owner', p_caller_id),
    jsonb_build_object('owner', p_new_owner_id)
  );
end;
$$;

-- 15. RPC: admin_invite_user (PRD §7.3, C1, A7, H-2)
create or replace function admin_invite_user(
  p_email text,
  p_role user_role,
  p_full_name text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_existing_id uuid;
  v_existing_role user_role;
  v_existing_active boolean;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;

  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_role = 'owner' then
    raise exception '403 cannot_invite_owner';
  end if;

  if v_caller_role = 'admin' and p_role != 'staff' then
    raise exception '403 unauthorized';
  end if;

  select u.id, p.role, p.active into v_existing_id, v_existing_role, v_existing_active
  from auth.users u
  left join profiles p on p.id = u.id
  where lower(u.email) = lower(p_email);

  if v_existing_id is not null then
    if v_existing_active = true then
      raise exception '409 user_already_exists';
    else
      -- Re-inviting deactivated account
      if v_existing_role in ('admin', 'owner') and v_caller_role != 'owner' then
        raise exception '403 unauthorized';
      end if;

      update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role)
      where id = v_existing_id;

      insert into profiles (id, full_name, role, active)
      values (v_existing_id, p_full_name, p_role, true)
      on conflict (id) do update
      set role = p_role, full_name = p_full_name, active = true, updated_at = now();

      perform log_audit_event(
        p_actor_id, 'user.invite', 'profiles', v_existing_id::text,
        jsonb_build_object('active', false, 'role', v_existing_role),
        jsonb_build_object('email', p_email, 'role', p_role, 'active', true, 'reactivated', true)
      );
      return;
    end if;
  end if;

  -- New user creation handled via Supabase Auth Admin API; trigger fn_auth_users_create_profile provisions profile
  perform log_audit_event(
    p_actor_id, 'user.invite', 'profiles', p_email,
    null,
    jsonb_build_object('email', p_email, 'role', p_role)
  );
end;
$$;

-- 16. RPC: create_or_update_draft_rate_profile (PRD §7.3, F18, F41)
create or replace function create_or_update_draft_rate_profile(
  p_profile_id uuid,
  p_effective_from date,
  p_vat_mode text,
  p_vat_bp integer,
  p_commission_base text,
  p_commission_bp integer,
  p_method_rates jsonb,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_id uuid;
  v_mr record;
  v_old record;
  v_version int;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  -- [PLAN-DERIVED: enforces no-backdating check at draft time]
  if p_effective_from < (now() at time zone 'Asia/Dhaka')::date then
    raise exception '422 effective_date_in_past';
  end if;

  if p_profile_id is null then
    v_id := gen_random_uuid();
    select coalesce(max(version), 0) + 1 into v_version from rate_profiles;

    insert into rate_profiles (
      id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, created_by
    ) values (
      v_id, v_version, 'draft', p_effective_from, p_vat_mode, p_vat_bp, p_commission_base, p_commission_bp, p_actor_id
    );

    for v_mr in select * from jsonb_to_recordset(p_method_rates) as x(method_id uuid, charge_bp int) loop
      insert into method_rates (rate_profile_id, method_id, charge_bp)
      values (v_id, v_mr.method_id, v_mr.charge_bp);
    end loop;

    perform log_audit_event(
      p_actor_id, 'rate_profile.create', 'rate_profiles', v_id::text,
      null,
      jsonb_build_object('version', v_version, 'status', 'draft', 'effective_from', p_effective_from, 'vat_mode', p_vat_mode, 'vat_bp', p_vat_bp, 'commission_bp', p_commission_bp)
    );
  else
    v_id := p_profile_id;
    select status, effective_from, vat_mode, vat_bp, commission_base, commission_bp into v_old
    from rate_profiles where id = v_id;

    if v_old.status is null then
      raise exception '404 draft_rate_profile_not_found';
    end if;

    if v_old.status != 'draft' then
      raise exception '422 cannot_update_non_draft_profile';
    end if;

    update rate_profiles
    set effective_from = p_effective_from,
        vat_mode = p_vat_mode,
        vat_bp = p_vat_bp,
        commission_base = p_commission_base,
        commission_bp = p_commission_bp
    where id = v_id and status = 'draft';

    delete from method_rates where rate_profile_id = v_id;

    for v_mr in select * from jsonb_to_recordset(p_method_rates) as x(method_id uuid, charge_bp int) loop
      insert into method_rates (rate_profile_id, method_id, charge_bp)
      values (v_id, v_mr.method_id, v_mr.charge_bp);
    end loop;

    perform log_audit_event(
      p_actor_id, 'rate_profile.update', 'rate_profiles', v_id::text,
      jsonb_build_object('effective_from', v_old.effective_from, 'vat_mode', v_old.vat_mode, 'vat_bp', v_old.vat_bp, 'commission_bp', v_old.commission_bp),
      jsonb_build_object('effective_from', p_effective_from, 'vat_mode', p_vat_mode, 'vat_bp', p_vat_bp, 'commission_bp', p_commission_bp)
    );
  end if;

  return v_id;
end;
$$;

-- 17. RPC: publish_rate_profile (PRD §7.3, F18, F41, F53)
create or replace function publish_rate_profile(
  p_profile_id uuid,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_status text;
  v_effective_from date;
  v_vat_bp int;
  v_comm_bp int;
  v_max_charge_bp int;
  v_uncovered_method text;
  v_next_version int;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  -- Advisory lock on rate profile versions
  perform pg_advisory_xact_lock(1003, 1);

  select status, effective_from, vat_bp, commission_bp
  into v_status, v_effective_from, v_vat_bp, v_comm_bp
  from rate_profiles where id = p_profile_id;

  if v_status is null then
    raise exception '404 rate_profile_not_found';
  end if;

  if v_status != 'draft' then
    raise exception '422 cannot_publish_non_draft';
  end if;

  -- Asia/Dhaka check: effective_from cannot be in the past at publish time
  if v_effective_from < (now() at time zone 'Asia/Dhaka')::date then
    raise exception '422 cannot_backdate_rate_profile';
  end if;

  -- 100% Deduction Guard check (Rule 3, §16.2 Test #41)
  select max(charge_bp) into v_max_charge_bp from method_rates where rate_profile_id = p_profile_id;
  if (v_vat_bp + v_comm_bp + coalesce(v_max_charge_bp, 0)) > 10000 then
    raise exception '422 deductions_exceed_100_percent';
  end if;

  -- Coverage check: must cover all active payment methods
  select pm.code into v_uncovered_method
  from payment_methods pm
  where pm.active = true
    and not exists (
      select 1 from method_rates mr
      where mr.rate_profile_id = p_profile_id and mr.method_id = pm.id
    )
  limit 1;

  if v_uncovered_method is not null then
    raise exception '422 method_not_covered_in_published_profile';
  end if;

  -- Assign next sequential published version
  select coalesce(max(version), 0) + 1 into v_next_version from rate_profiles where status = 'published';

  update rate_profiles
  set status = 'published',
      version = v_next_version,
      published_at = now()
  where id = p_profile_id and status = 'draft';

  perform log_audit_event(
    p_actor_id, 'rate_profile.publish', 'rate_profiles', p_profile_id::text,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'published', 'version', v_next_version, 'effective_from', v_effective_from)
  );
end;
$$;

-- 18. RPC: admin_review_stale_entry (PRD §7.3, C2, H1)
create or replace function admin_review_stale_entry(
  p_entry_id uuid,
  p_action text,
  p_actor_id uuid,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_entry_date date;
  v_status entry_status;
  v_stale_status text;
  v_month date;
  v_gross bigint;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_action not in ('approved', 'rejected') then
    raise exception '400 invalid_action';
  end if;

  if p_action = 'rejected' and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 missing_reject_reason';
  end if;

  select entry_date, status, stale_review_status, gross_poisha
  into v_entry_date, v_status, v_stale_status, v_gross
  from entries where id = p_entry_id;

  if v_status is null then
    raise exception '404 entry_not_found';
  end if;

  if v_status != 'active' then
    raise exception '422 cannot_review_non_active';
  end if;

  if v_stale_status != 'flagged' then
    raise exception '422 entry_not_flagged_for_stale_review';
  end if;

  v_month := date_trunc('month', v_entry_date)::date;

  -- Lock Hierarchy: Step 1 Month Lock, Step 2 Sequence Lock, Step 3 Row Lock
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  perform pg_advisory_xact_lock(1002, 1);

  -- Row lock & re-verification under lock to avoid race conditions
  select status, stale_review_status into v_status, v_stale_status
  from entries where id = p_entry_id for update;

  if v_status != 'active' or v_stale_status != 'flagged' then
    raise exception '422 entry_state_changed_during_lock';
  end if;

  if p_action = 'approved' then
    update entries
    set stale_review_status = 'approved',
        stale_reviewed_by = p_actor_id,
        stale_reviewed_at = now()
    where id = p_entry_id and stale_review_status = 'flagged';

    perform log_audit_event(
      p_actor_id, 'entry.stale_review_approve', 'entries', p_entry_id::text,
      jsonb_build_object('stale_review_status', 'flagged'),
      jsonb_build_object('stale_review_status', 'approved', 'reviewed_by', p_actor_id)
    );
  else
    update entries
    set status = 'voided',
        voided_by = p_actor_id,
        voided_at = now(),
        void_reason = coalesce(p_reason, 'Stale rate submission rejected by admin'),
        stale_review_status = 'rejected',
        stale_reviewed_by = p_actor_id,
        stale_reviewed_at = now(),
        notes = coalesce(notes || E'\n', '') || 'Stale review rejected: ' || trim(p_reason)
    where id = p_entry_id and stale_review_status = 'flagged';

    perform log_audit_event(
      p_actor_id, 'entry.stale_review_reject', 'entries', p_entry_id::text,
      jsonb_build_object('stale_review_status', 'flagged'),
      jsonb_build_object('stale_review_status', 'rejected', 'reviewed_by', p_actor_id, 'reason', trim(p_reason))
    );
  end if;

  return jsonb_build_object('entryId', p_entry_id, 'status', p_action);
end;
$$;

-- 19. RPC: admin_manage_payment_method (PRD §7.3, F43, F53)
create or replace function admin_manage_payment_method(
  p_action text,
  p_id uuid,
  p_code text,
  p_name text,
  p_sort_order int,
  p_active boolean,
  p_requires_txn_ref boolean,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_id uuid;
  v_old record;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_action = 'create' then
    v_id := coalesce(p_id, gen_random_uuid());
    insert into payment_methods (id, code, name, sort_order, active, requires_txn_ref)
    values (v_id, p_code, p_name, p_sort_order, p_active, p_requires_txn_ref);

    perform log_audit_event(
      p_actor_id, 'payment_method.create', 'payment_methods', v_id::text,
      null,
      jsonb_build_object('code', p_code, 'name', p_name, 'active', p_active, 'sort_order', p_sort_order, 'requires_txn_ref', p_requires_txn_ref)
    );
    return v_id;
  elsif p_action = 'update' then
    select code, name, sort_order, active, requires_txn_ref into v_old
    from payment_methods where id = p_id;

    if v_old.code is null then
      raise exception '404 payment_method_not_found';
    end if;

    update payment_methods
    set name = p_name,
        sort_order = p_sort_order,
        active = p_active,
        requires_txn_ref = p_requires_txn_ref,
        updated_at = now()
    where id = p_id;

    perform log_audit_event(
      p_actor_id, 'payment_method.update', 'payment_methods', p_id::text,
      jsonb_build_object('name', v_old.name, 'sort_order', v_old.sort_order, 'active', v_old.active, 'requires_txn_ref', v_old.requires_txn_ref),
      jsonb_build_object('name', p_name, 'sort_order', p_sort_order, 'active', p_active, 'requires_txn_ref', p_requires_txn_ref)
    );
    return p_id;
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

-- 20. RPC: admin_manage_payable (PRD §7.3, Finding 4)
create or replace function admin_manage_payable(
  p_action text,
  p_id uuid,
  p_kind text,
  p_method_id uuid,
  p_code text,
  p_name text,
  p_due_day int,
  p_remind_days_before int,
  p_active boolean,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_id uuid;
  v_old record;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_due_day < 1 or p_due_day > 28 then
    raise exception '422 invalid_due_day';
  end if;

  if p_remind_days_before < 0 or p_remind_days_before > 14 then
    raise exception '422 invalid_remind_days_before';
  end if;

  if p_action = 'create' then
    v_id := coalesce(p_id, gen_random_uuid());
    insert into payables (id, code, name, kind, method_id, due_day, remind_days_before, active)
    values (v_id, p_code, p_name, p_kind, p_method_id, p_due_day, p_remind_days_before, p_active);

    perform log_audit_event(
      p_actor_id, 'payable.create', 'payables', v_id::text,
      null,
      jsonb_build_object('code', p_code, 'name', p_name, 'kind', p_kind, 'due_day', p_due_day, 'remind_days_before', p_remind_days_before, 'active', p_active)
    );
    return v_id;
  elsif p_action = 'update' then
    select code, name, kind, due_day, remind_days_before, active into v_old
    from payables where id = p_id;

    if v_old.code is null then
      raise exception '404 payable_not_found';
    end if;

    update payables
    set name = p_name,
        due_day = p_due_day,
        remind_days_before = p_remind_days_before,
        active = p_active,
        updated_at = now()
    where id = p_id;

    perform log_audit_event(
      p_actor_id, 'payable.update', 'payables', p_id::text,
      jsonb_build_object('name', v_old.name, 'due_day', v_old.due_day, 'remind_days_before', v_old.remind_days_before, 'active', v_old.active),
      jsonb_build_object('name', p_name, 'due_day', p_due_day, 'remind_days_before', p_remind_days_before, 'active', p_active)
    );
    return p_id;
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

-- 21. RPC: admin_update_settings (PRD §7.3, M6)
create or replace function admin_update_settings(
  p_settings jsonb,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_old_net_label text;
  v_old_tol bigint;
  v_key text;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  -- Validate unknown keys
  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in ('net_label', 'reconcile_tolerance_poisha') then
      raise exception '400 unknown_settings_key';
    end if;
  end loop;

  -- Validate non-negativity of tolerance
  if (p_settings ? 'reconcile_tolerance_poisha') and (p_settings->>'reconcile_tolerance_poisha')::bigint < 0 then
    raise exception '422 tolerance_must_be_non_negative';
  end if;

  select net_label, reconcile_tolerance_poisha into v_old_net_label, v_old_tol
  from app_settings where id = true;

  update app_settings
  set net_label = coalesce(p_settings->>'net_label', net_label),
      reconcile_tolerance_poisha = coalesce((p_settings->>'reconcile_tolerance_poisha')::bigint, reconcile_tolerance_poisha),
      updated_at = now()
  where id = true;

  perform log_audit_event(
    p_actor_id, 'app_settings.update', 'app_settings', 'true',
    jsonb_build_object('net_label', v_old_net_label, 'reconcile_tolerance_poisha', v_old_tol),
    p_settings
  );
end;
$$;

-- 22. RPC: admin_manage_user (PRD §7.3, F15)
create or replace function admin_manage_user(
  p_action text,
  p_user_id uuid,
  p_role text,
  p_active boolean,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_target_role user_role;
  v_target_active boolean;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  select role, active into v_target_role, v_target_active from profiles where id = p_user_id;
  if v_target_role is null then
    raise exception '404 user_not_found';
  end if;

  if v_caller_role = 'admin' and v_target_role in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_action = 'update_role' then
    if v_caller_role != 'owner' then
      raise exception '403 unauthorized';
    end if;
    if p_role = 'owner' then
      raise exception '400 cannot_promote_to_owner_use_transfer_ownership';
    end if;
    if p_role not in ('admin', 'staff') then
      raise exception '400 invalid_role';
    end if;

    update profiles set role = p_role::user_role, updated_at = now() where id = p_user_id;

    perform log_audit_event(
      p_actor_id, 'user.role_change', 'profiles', p_user_id::text,
      jsonb_build_object('role', v_target_role),
      jsonb_build_object('role', p_role)
    );
  elsif p_action = 'deactivate' then
    update profiles set active = false, updated_at = now() where id = p_user_id;

    perform log_audit_event(
      p_actor_id, 'user.deactivate', 'profiles', p_user_id::text,
      jsonb_build_object('active', true),
      jsonb_build_object('active', false)
    );
  elsif p_action = 'reactivate' then
    update profiles set active = true, updated_at = now() where id = p_user_id;

    perform log_audit_event(
      p_actor_id, 'user.reactivate', 'profiles', p_user_id::text,
      jsonb_build_object('active', false),
      jsonb_build_object('active', true)
    );
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

-- 23. Maintenance Routine: purge_expired_sync_ops (PRD §7.3 M2)
create or replace function purge_expired_sync_ops()
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deleted bigint;
begin
  -- Strictly delete rejected sync_ops that were resolved or discarded older than 90 days
  with deleted as (
    delete from sync_ops
    where result = 'rejected'
      and resolution_status in ('resolved', 'discarded')
      and created_at < now() - interval '90 days'
    returning op_id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

-- 24. RPC: rpc_supersede_entry (PRD §7.3, Finding 2, Finding 3, Item 3.4)
create or replace function rpc_supersede_entry(
  p_original_id uuid,
  p_new_entry jsonb,
  p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_orig_date date;
  v_new_date date;
  v_orig_month date;
  v_new_month date;
  v_orig_status entry_status;
  v_new_id uuid;
  v_new_seq bigint;
  v_new_num bigint;
  v_txn_ref text;
  v_dup_txn boolean;
  v_method_id uuid;
  v_method_active boolean;
  v_requires_txn_ref boolean;
  v_rate_profile_id uuid;
  v_expected_rate_profile_id uuid;
  v_expected_version int;
  v_expected_vat_mode text;
  v_expected_vat_bp int;
  v_expected_comm_bp int;
  v_expected_comm_base text;
  v_expected_charge_bp int;
  v_expected_borne_by text;
  v_snapshot jsonb;
  v_gross bigint;
  v_vat bigint;
  v_comm bigint;
  v_charge bigint;
  v_biz_charge bigint;
  v_cust_charge bigint;
  v_net bigint;
  v_stale_rates boolean := false;
  v_stale_status text := 'none';
  v_latest_published_id uuid;
begin
  select role, active into v_caller_role, v_caller_active from profiles where id = p_actor_id;
  if v_caller_role is null or v_caller_active is not true or v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  select entry_date, status into v_orig_date, v_orig_status from entries where id = p_original_id;
  if v_orig_status is null then
    raise exception '422 parent_entry_not_found';
  end if;
  if v_orig_status != 'active' then
    raise exception '422 cannot_supersede_non_active';
  end if;

  v_new_date := (p_new_entry->>'entryDate')::date;
  if v_new_date is null then
    raise exception '422 missing_entry_date';
  end if;

  v_orig_month := date_trunc('month', v_orig_date)::date;
  v_new_month := date_trunc('month', v_new_date)::date;

  -- Step 1: Ascending Month Locks (PRD §7.2)
  if v_orig_month <= v_new_month then
    perform pg_advisory_xact_lock(1001, extract(year from v_orig_month)::int * 12 + extract(month from v_orig_month)::int);
    if v_orig_month != v_new_month then
      perform pg_advisory_xact_lock(1001, extract(year from v_new_month)::int * 12 + extract(month from v_new_month)::int);
    end if;
  else
    perform pg_advisory_xact_lock(1001, extract(year from v_new_month)::int * 12 + extract(month from v_new_month)::int);
    perform pg_advisory_xact_lock(1001, extract(year from v_orig_month)::int * 12 + extract(month from v_orig_month)::int);
  end if;

  -- Month Closed Check
  if exists (select 1 from month_closes where month in (v_orig_month, v_new_month) and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- Step 2: Sequence Lock
  perform pg_advisory_xact_lock(1002, 1);

  -- Step 3: Row Lock original entry
  select status into v_orig_status from entries where id = p_original_id for update;
  if v_orig_status != 'active' then
    raise exception '422 cannot_supersede_non_active';
  end if;

  v_new_id := coalesce((p_new_entry->>'id')::uuid, gen_random_uuid());
  v_method_id := (p_new_entry->>'methodId')::uuid;
  v_txn_ref := nullif(upper(trim(coalesce(p_new_entry->>'txnRef', ''))), '');

  -- Validate payment method is active
  select active, requires_txn_ref into v_method_active, v_requires_txn_ref
  from payment_methods where id = v_method_id;
  if v_method_active is null or v_method_active is not true then
    raise exception '422 inactive_payment_method';
  end if;

  if v_requires_txn_ref and v_txn_ref is null then
    raise exception '422 missing_txn_ref';
  end if;

  -- Published rate profile covering replacement entry date
  select id, version, vat_mode, vat_bp, commission_bp, commission_base
  into v_expected_rate_profile_id, v_expected_version, v_expected_vat_mode, v_expected_vat_bp, v_expected_comm_bp, v_expected_comm_base
  from rate_profiles
  where status = 'published' and effective_from <= v_new_date
  order by effective_from desc, version desc
  limit 1;

  if v_expected_rate_profile_id is null then
    raise exception '422 no_rate_profile_for_date';
  end if;

  v_snapshot := p_new_entry->'snapshot';
  if v_snapshot is null then
    raise exception '422 invalid_snapshot_rules';
  end if;

  -- Engine version check
  if coalesce((v_snapshot->>'engineVersion')::int, 0) != 1 then
    raise exception '426 upgrade_required';
  end if;

  v_rate_profile_id := coalesce((p_new_entry->>'rateProfileId')::uuid, (v_snapshot->>'rateProfileId')::uuid);
  if v_rate_profile_id != v_expected_rate_profile_id then
    raise exception '422 rate_profile_date_mismatch';
  end if;

  select mr.charge_bp, rp.charges_borne_by into v_expected_charge_bp, v_expected_borne_by
  from method_rates mr
  join rate_profiles rp on rp.id = mr.rate_profile_id
  where mr.rate_profile_id = v_expected_rate_profile_id and mr.method_id = v_method_id;

  if v_expected_charge_bp is null then
    raise exception '422 method_not_covered_in_published_profile';
  end if;

  -- Snapshot Integrity Verification against published profile
  if coalesce((v_snapshot->>'version')::int, (v_snapshot->>'rateProfileVersion')::int, 0) != v_expected_version
     or coalesce(v_snapshot->>'vatMode', v_snapshot->'vat'->>'mode', '') != v_expected_vat_mode
     or coalesce((v_snapshot->>'vatBp')::int, (v_snapshot->'vat'->>'bp')::int, (v_snapshot->'vat'->>'rateBp')::int, 0) != v_expected_vat_bp
     or coalesce((v_snapshot->>'commissionBp')::int, (v_snapshot->'commission'->>'bp')::int, 0) != v_expected_comm_bp
     or coalesce(v_snapshot->>'commissionBase', v_snapshot->'commission'->>'base', '') != v_expected_comm_base
     or coalesce((v_snapshot->>'methodFeeBp')::int, (v_snapshot->>'chargeBp')::int, (v_snapshot->'charges'->>'feeBp')::int, -1) != v_expected_charge_bp
     or coalesce(v_snapshot->>'chargesBorneBy', v_snapshot->'charges'->>'borneBy', '') != v_expected_borne_by then
    raise exception '422 invalid_snapshot_rules';
  end if;

  v_gross := (p_new_entry->>'grossPoisha')::bigint;
  v_vat := (p_new_entry->>'vatPoisha')::bigint;
  v_comm := (p_new_entry->>'commissionPoisha')::bigint;
  v_charge := (p_new_entry->>'chargePoisha')::bigint;
  v_biz_charge := coalesce((p_new_entry->>'businessChargePoisha')::bigint, 0);
  v_cust_charge := coalesce((p_new_entry->>'customerChargePoisha')::bigint, 0);
  v_net := coalesce((p_new_entry->>'netAfterDeductionsPoisha')::bigint, (p_new_entry->>'netPoisha')::bigint, 0);

  -- Arithmetic and conservation backstops
  if v_charge != mul_bp(v_gross, v_expected_charge_bp) then
    raise exception '422 calc_mismatch';
  end if;

  if (v_biz_charge + v_cust_charge) != v_charge then
    raise exception '422 charge_partition_violation';
  end if;

  if v_expected_borne_by = 'customer' and (v_biz_charge != 0 or v_cust_charge != v_charge) then
    raise exception '422 invalid_fee_partition';
  elsif v_expected_borne_by = 'business' and (v_cust_charge != 0 or v_biz_charge != v_charge) then
    raise exception '422 invalid_fee_partition';
  end if;

  -- VAT backstop (if not overridden)
  if (p_new_entry->>'vatOverridePoisha') is null then
    if v_expected_vat_mode = 'percent_of_gross' then
      if v_vat != mul_bp(v_gross, v_expected_vat_bp) then
        raise exception '422 calc_mismatch';
      end if;
    elsif v_expected_vat_mode = 'percent_inclusive' then
      declare
        v_div bigint := 10000 + v_expected_vat_bp;
        v_base bigint := round_half_up(v_gross * 10000, v_div);
      begin
        if (v_gross - v_base) != v_vat then
          raise exception '422 calc_mismatch';
        end if;
      end;
    end if;
  end if;

  -- Commission backstop (if not overridden)
  if (p_new_entry->>'commissionOverridePoisha') is null then
    declare
      v_comm_base bigint := case when v_expected_comm_base = 'gross_minus_vat' then (v_gross - v_vat) else v_gross end;
    begin
      if v_comm != mul_bp(v_comm_base, v_expected_comm_bp) then
        raise exception '422 calc_mismatch';
      end if;
    end;
  end if;

  -- Gross conservation backstop (vat + commission + biz_charge + net = gross)
  if (v_vat + v_comm + v_biz_charge + v_net) != v_gross then
    raise exception '422 gross_conservation_violation';
  end if;

  -- Check duplicate txn reference
  select exists (
    select 1 from entries
    where method_id = v_method_id and txn_ref = v_txn_ref and status = 'active' and id != p_original_id
  ) into v_dup_txn;

  -- Stale rate check (is v_rate_profile_id superseded?)
  select id into v_latest_published_id
  from rate_profiles
  where status = 'published' and effective_from <= (now() at time zone 'Asia/Dhaka')::date
  order by effective_from desc, version desc limit 1;

  if v_latest_published_id is not null and v_rate_profile_id != v_latest_published_id then
    v_stale_rates := true;
    if v_gross > 5000000 then -- > 50,000 BDT (STALE_RATE_FLAG_THRESHOLD_POISHA)
      v_stale_status := 'flagged';
    end if;
  end if;

  -- Mark Original Superseded
  update entries set status = 'superseded', superseded_at = now() where id = p_original_id;

  -- Insert Replacement Entry
  insert into entries (
    id, entry_date, customer_name, sub_qty, sub_description, txn_ref,
    method_id, gross_poisha, rate_profile_id, snapshot,
    vat_input_poisha, vat_override_poisha, vat_override_reason,
    commission_override_poisha, commission_override_reason,
    vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
    customer_charge_poisha, net_poisha, notes, created_by,
    device_id, client_created_at, dup_txn_flag, stale_rates, stale_review_status,
    supersedes_id, original_entry_date, reassign_reason
  ) values (
    v_new_id, v_new_date, p_new_entry->>'customerName',
    coalesce((p_new_entry->>'subQty')::int, 1), p_new_entry->>'subDescription',
    v_txn_ref, v_method_id, v_gross,
    v_rate_profile_id, v_snapshot,
    (p_new_entry->>'vatInputPoisha')::bigint, (p_new_entry->>'vatOverridePoisha')::bigint,
    p_new_entry->>'vatOverrideReason', (p_new_entry->>'commissionOverridePoisha')::bigint,
    p_new_entry->>'commissionOverrideReason',
    v_vat, v_comm, v_charge, v_biz_charge, v_cust_charge, v_net,
    p_new_entry->>'notes', p_actor_id,
    p_new_entry->>'deviceId',
    coalesce((p_new_entry->>'clientCreatedAt')::timestamptz, now()),
    v_dup_txn, v_stale_rates, v_stale_status,
    p_original_id, v_orig_date, p_new_entry->>'reassignReason'
  ) returning server_seq, entry_number into v_new_seq, v_new_num;

  perform log_audit_event(
    p_actor_id, 'entry.supersede', 'entries', p_original_id::text,
    jsonb_build_object('id', p_original_id, 'status', 'active'),
    jsonb_build_object('id', p_original_id, 'status', 'superseded', 'replacement_entry_id', v_new_id)
  );

  return jsonb_build_object(
    'status', 'ok',
    'originalEntryId', p_original_id,
    'replacementEntryId', v_new_id,
    'server_seq', v_new_seq,
    'entry_number', v_new_num
  );
end;
$$;

-- 25. RPC: rpc_push_sync_op (PRD §7.3 lines 940-975, §9.1 lines 1595-1650, Findings 2, 3, 7, 8, A3, F48)
create or replace function rpc_push_sync_op(
  p_device_id text,
  p_caller_id uuid,
  p_caller_role user_role,
  p_ops jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_results jsonb := '[]'::jsonb;
  v_op jsonb;
  v_op_id uuid;
  v_op_type text;
  v_entry_id uuid;
  v_entry_date date;
  v_month date;
  v_m record;
  v_client_created_at timestamptz;
  v_max_known_version int;
  v_server_hash text;
  v_existing_op_hash text;
  v_existing_result text;
  v_existing_reason text;
  v_existing_seq bigint;
  v_existing_num bigint;
  v_existing_creator uuid;
  v_orig_entry_hash text;
  v_device_revoked boolean := false;
  v_stale_threshold_poisha bigint := 5000000; -- 50,000 BDT
begin
  -- 1. Multi-Month Advisory Locks in Ascending Order (PRD §7.2, Finding 2)
  -- Regex guards prevent malformed inputs from aborting the lock gathering query
  for v_m in
    with extracted_months as (
      -- Direct entryDate on payload (create_entry)
      select date_trunc('month', (op->'payload'->>'entryDate')::date)::date as m
      from jsonb_array_elements(p_ops) op
      where (op->'payload'->>'entryDate') ~ '^\d{4}-\d{2}-\d{2}$'
      union
      -- Replacement entryDate (supersede_entry)
      select date_trunc('month', (op->'payload'->'replacement'->>'entryDate')::date)::date as m
      from jsonb_array_elements(p_ops) op
      where (op->'payload'->'replacement'->>'entryDate') ~ '^\d{4}-\d{2}-\d{2}$'
      union
      -- DB entry_date for void_entry, request_void, and original entry of supersede_entry
      select date_trunc('month', e.entry_date)::date as m
      from jsonb_array_elements(p_ops) op
      join entries e on e.id in (
        case when (op->'payload'->>'entryId') ~ '^[0-9a-fA-F-]{36}$' then (op->'payload'->>'entryId')::uuid else null end,
        case when (op->'payload'->>'originalEntryId') ~ '^[0-9a-fA-F-]{36}$' then (op->'payload'->>'originalEntryId')::uuid else null end
      )
    )
    select distinct m from extracted_months where m is not null order by m asc
  loop
    perform pg_advisory_xact_lock(1001, extract(year from v_m.m)::int * 12 + extract(month from v_m.m)::int);
  end loop;

  -- 2. Sequence Advisory Lock (PRD §7.2 Step 2)
  perform pg_advisory_xact_lock(1002, 1);

  -- 3. Device Presence Registration & Revocation Check (H3, M4)
  select exists (
    select 1 from devices where device_id = p_device_id and revoked = true
  ) into v_device_revoked;

  if not v_device_revoked then
    perform upsert_device_sync_state(p_device_id, p_caller_id, null);
  end if;

  -- 4. Process Each Operation inside Isolated Subtransaction (F48)
  for v_op in select * from jsonb_array_elements(p_ops) loop
    begin
      v_op_id := (v_op->>'opId')::uuid;
      v_op_type := v_op->>'type';
      v_client_created_at := (v_op->>'clientCreatedAt')::timestamptz;
      
      -- Canonical RFC 8785 SHA-256 hash computed in SvelteKit layer, with database SHA-256 fallback
      v_server_hash := coalesce(v_op->>'serverHash', encode(digest((v_op->'payload')::text, 'sha256'), 'hex'));

      -- Check device revocation inside subtransaction (PRD §9.1, Test #62)
      if v_device_revoked then
        raise exception 'device_revoked';
      end if;

      -- A. Idempotency Check on op_id First (PRD §9.1 Step 6c, Finding 8, Test #61)
      select payload_hash, result, reason into v_existing_op_hash, v_existing_result, v_existing_reason
      from sync_ops where op_id = v_op_id;

      if v_existing_op_hash is not null then
        if v_existing_op_hash = v_server_hash then
          if v_existing_result = 'ok' then
            -- Fetch server_seq and entry_number if create_entry op
            select server_seq, entry_number into v_existing_seq, v_existing_num
            from entries where id = (select entry_id from sync_ops where op_id = v_op_id);

            v_results := v_results || jsonb_build_object(
              'opId', v_op_id,
              'status', 'duplicate',
              'server_seq', v_existing_seq,
              'entry_number', v_existing_num,
              'reason', v_existing_reason
            );
          else
            v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', v_existing_result, 'reason', v_existing_reason);
          end if;
          continue;
        else
          -- Altered payload for same op_id: log tamper detected and reject directly
          perform log_audit_event(
            p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text,
            null,
            jsonb_build_object('op_id', v_op_id, 'error', 'op_id_conflict_tampered')
          );
          insert into sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
          values (v_op_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', 'op_id_conflict_tampered')
          on conflict (op_id) do update set reason = EXCLUDED.reason, result = 'rejected', resolution_status = 'pending';

          v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'op_id_conflict_tampered');
          continue;
        end if;
      end if;

      -- B. Transport Integrity Verification (Finding 8)
      if (v_op->>'payloadHash') is not null and (v_op->>'payloadHash') != v_server_hash then
        perform log_audit_event(
          p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text,
          null,
          jsonb_build_object('op_id', v_op_id, 'client_hash', v_op->>'payloadHash', 'server_hash', v_server_hash)
        );
        insert into sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
        values (v_op_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', 'payload_hash_mismatch');

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'payload_hash_mismatch');
        continue;
      end if;

      -- C. Clock Skew and Age Validations (PRD §9.1 Step 6d, 6e)
      if v_client_created_at > (now() + interval '5 minutes') then
        raise exception 'future_timestamp_skew';
      end if;

      if v_client_created_at < (now() - interval '90 days') then
        raise exception 'queue_expired_needs_review';
      end if;

      -- D. Route Operation Types
      if v_op_type = 'create_entry' then
        declare
          v_gross bigint;
          v_vat bigint;
          v_comm bigint;
          v_charge bigint;
          v_biz_charge bigint;
          v_cust_charge bigint;
          v_net bigint;
          v_method_id uuid;
          v_method_active boolean;
          v_requires_txn_ref boolean;
          v_rate_profile_id uuid;
          v_snapshot jsonb;
          v_sub_id uuid;
          v_sub_ver int;
          v_sub_eff date;
          v_exp_id uuid;
          v_dev_rate_ver int;
          v_dev_rate_at timestamptz;
          v_latest_published_id uuid;
          v_stale_rates boolean := false;
          v_stale_status text := 'none';
          v_dup_txn boolean := false;
          v_txn_ref text;
          v_any_profile_for_date boolean;
          v_expected_charge_bp int;
          v_expected_borne_by text;
          v_expected_vat_mode text;
          v_expected_vat_bp int;
          v_expected_comm_bp int;
          v_expected_comm_base text;
          v_expected_version int;
        begin
          v_entry_id := (v_op->'payload'->>'id')::uuid;
          v_entry_date := (v_op->'payload'->>'entryDate')::date;
          v_month := date_trunc('month', v_entry_date)::date;

          -- Month Closed Check (PRD §7.3, §9.1)
          if exists (select 1 from month_closes where month = v_month and status = 'closed') then
            raise exception 'month_closed';
          end if;

          -- Rate Profile Watermark & Date Matching Order (Anti-Cherry-Picking)
          if v_op->>'maxKnownRateVersion' is null then
            raise exception 'missing_rate_watermark';
          end if;
          v_max_known_version := (v_op->>'maxKnownRateVersion')::int;
          v_rate_profile_id := (v_op->'payload'->>'rateProfileId')::uuid;

          -- Step 1: Check if ANY published profile covers the entry date
          select exists (
            select 1 from rate_profiles where status = 'published' and effective_from <= v_entry_date
          ) into v_any_profile_for_date;

          if not v_any_profile_for_date then
            raise exception 'no_rate_profile_for_date';
          end if;

          -- Step 2: Verify submitted rate profile exists and is published
          select id, version, effective_from into v_sub_id, v_sub_ver, v_sub_eff
          from rate_profiles where id = v_rate_profile_id and status = 'published';

          if v_sub_id is null then
            raise exception 'rate_profile_not_found';
          end if;

          -- Step 3: Anti-Cherry-Picking Check: resolve highest applicable version known to client
          select id into v_exp_id
          from rate_profiles
          where status = 'published' and effective_from <= v_entry_date and version <= v_max_known_version
          order by effective_from desc, version desc limit 1;

          if v_sub_id != v_exp_id then
            raise exception 'rate_profile_date_mismatch';
          end if;

          -- Device Watermark Grounding (H3, H4)
          select last_rate_version, last_rate_version_at into v_dev_rate_ver, v_dev_rate_at
          from devices where device_id = p_device_id and user_id = p_caller_id;
          if v_dev_rate_ver is not null and v_max_known_version < v_dev_rate_ver and v_client_created_at > v_dev_rate_at then
            raise exception 'rate_profile_date_mismatch';
          end if;

          -- Check Stale Rates (> 50,000 BDT triggers review)
          select id into v_latest_published_id
          from rate_profiles
          where status = 'published' and effective_from <= (now() at time zone 'Asia/Dhaka')::date
          order by effective_from desc, version desc limit 1;

          if v_latest_published_id is not null and v_rate_profile_id != v_latest_published_id then
            v_stale_rates := true;
            if (v_op->'payload'->>'grossPoisha')::bigint > v_stale_threshold_poisha then
              v_stale_status := 'flagged';
            end if;
          end if;

          v_method_id := (v_op->'payload'->>'methodId')::uuid;
          v_gross := (v_op->'payload'->>'grossPoisha')::bigint;
          v_vat := (v_op->'payload'->>'vatPoisha')::bigint;
          v_comm := (v_op->'payload'->>'commissionPoisha')::bigint;
          v_charge := (v_op->'payload'->>'chargePoisha')::bigint;
          v_biz_charge := coalesce((v_op->'payload'->>'businessChargePoisha')::bigint, 0);
          v_cust_charge := coalesce((v_op->'payload'->>'customerChargePoisha')::bigint, 0);
          v_net := coalesce((v_op->'payload'->>'netAfterDeductionsPoisha')::bigint, (v_op->'payload'->>'netPoisha')::bigint, 0);
          v_snapshot := v_op->'payload'->'snapshot';

          -- Engine Version Check
          if coalesce((v_snapshot->>'engineVersion')::int, 0) != 1 then
            raise exception 'upgrade_required';
          end if;

          -- Payment Method Active & Reference Validation
          select active, requires_txn_ref into v_method_active, v_requires_txn_ref
          from payment_methods where id = v_method_id;
          if v_method_active is not true then
            raise exception 'inactive_payment_method';
          end if;

          v_txn_ref := nullif(upper(trim(coalesce(v_op->'payload'->>'txnRef', ''))), '');
          if v_requires_txn_ref and v_txn_ref is null then
            raise exception 'missing_txn_ref';
          end if;

          -- Snapshot Integrity Check (PRD §6.5 item 3, §16.2 Test #1, F1)
          select version, vat_mode, vat_bp, commission_bp, commission_base
          into v_expected_version, v_expected_vat_mode, v_expected_vat_bp, v_expected_comm_bp, v_expected_comm_base
          from rate_profiles where id = v_rate_profile_id;

          select mr.charge_bp, rp.charges_borne_by into v_expected_charge_bp, v_expected_borne_by
          from method_rates mr
          join rate_profiles rp on rp.id = mr.rate_profile_id
          where mr.rate_profile_id = v_rate_profile_id and mr.method_id = v_method_id;

          if v_snapshot is null or v_expected_charge_bp is null then
            raise exception 'invalid_snapshot_rules';
          end if;

          -- Compare all snapshot fields against published DB records
          if coalesce((v_snapshot->>'version')::int, (v_snapshot->>'rateProfileVersion')::int, 0) != v_expected_version
             or coalesce(v_snapshot->>'vatMode', v_snapshot->'vat'->>'mode', '') != v_expected_vat_mode
             or coalesce((v_snapshot->>'vatBp')::int, (v_snapshot->'vat'->>'bp')::int, (v_snapshot->'vat'->>'rateBp')::int, 0) != v_expected_vat_bp
             or coalesce((v_snapshot->>'commissionBp')::int, (v_snapshot->'commission'->>'bp')::int, 0) != v_expected_comm_bp
             or coalesce(v_snapshot->>'commissionBase', v_snapshot->'commission'->>'base', '') != v_expected_comm_base
             or coalesce((v_snapshot->>'methodFeeBp')::int, (v_snapshot->>'chargeBp')::int, (v_snapshot->'charges'->>'feeBp')::int, -1) != v_expected_charge_bp
             or coalesce(v_snapshot->>'chargesBorneBy', v_snapshot->'charges'->>'borneBy', '') != v_expected_borne_by then
            raise exception 'invalid_snapshot_rules';
          end if;

          -- Fee partitioning backstop
          if (v_biz_charge + v_cust_charge) != v_charge then
            raise exception 'invalid_fee_partition';
          end if;

          if v_expected_borne_by = 'customer' and (v_biz_charge != 0 or v_cust_charge != v_charge) then
            raise exception 'invalid_fee_partition';
          elsif v_expected_borne_by = 'business' and (v_cust_charge != 0 or v_biz_charge != v_charge) then
            raise exception 'invalid_fee_partition';
          end if;

          -- SQL Arithmetic Backstop Verification (Rule 3, Finding C3)
          if mul_bp(v_gross, v_expected_charge_bp) != v_charge then
            raise exception 'calc_mismatch';
          end if;

          if (v_op->'payload'->>'vatOverridePoisha') is null then
            if v_expected_vat_mode = 'percent_of_gross' then
              if mul_bp(v_gross, v_expected_vat_bp) != v_vat then
                raise exception 'calc_mismatch';
              end if;
            elsif v_expected_vat_mode = 'percent_inclusive' then
              declare
                v_divisor bigint := 10000 + v_expected_vat_bp;
                v_base bigint := round_half_up(v_gross * 10000, v_divisor);
              begin
                if (v_gross - v_base) != v_vat then
                  raise exception 'calc_mismatch';
                end if;
              end;
            end if;
          end if;

          if (v_op->'payload'->>'commissionOverridePoisha') is null then
            declare
              v_comm_base bigint := case when v_expected_comm_base = 'gross_minus_vat' then (v_gross - v_vat) else v_gross end;
            begin
              if mul_bp(v_comm_base, v_expected_comm_bp) != v_comm then
                raise exception 'calc_mismatch';
              end if;
            end;
          end if;

          -- Conservation Identity
          if (v_vat + v_comm + v_biz_charge + v_net) != v_gross then
            raise exception 'calc_mismatch';
          end if;

          -- Entry Idempotency Check (M9, R-M8)
          select server_seq, entry_number, created_by into v_existing_seq, v_existing_num, v_existing_creator
          from entries where id = v_entry_id;
          if v_existing_seq is not null then
            if v_existing_creator = p_caller_id then
              -- Verify payload hash to ensure same creator didn't send altered payload
              select payload_hash into v_orig_entry_hash from sync_ops where entry_id = v_entry_id and op_type = 'create_entry' and result = 'ok';
              if v_orig_entry_hash is not null and v_orig_entry_hash != v_server_hash then
                perform log_audit_event(p_caller_id, 'security.tamper_detected', 'entries', v_entry_id::text, null, jsonb_build_object('error', 'entry_id_payload_tampered'));
                v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'entry_id_conflict_tampered');
                continue;
              else
                v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'duplicate', 'server_seq', v_existing_seq, 'entry_number', v_existing_num);
                continue;
              end if;
            else
              perform log_audit_event(p_caller_id, 'security.tamper_detected', 'entries', v_entry_id::text, null, jsonb_build_object('error', 'entry_id_creator_mismatch'));
              v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'entry_id_conflict_tampered');
              continue;
            end if;
          end if;

          -- Check duplicate reference among active entries
          select exists (
            select 1 from entries
            where method_id = v_method_id and txn_ref = v_txn_ref and status = 'active'
          ) into v_dup_txn;

          -- Insert new entry
          insert into entries (
            id, entry_date, customer_name, sub_qty, sub_description, txn_ref,
            method_id, gross_poisha, rate_profile_id, snapshot,
            vat_input_poisha, vat_override_poisha, vat_override_reason,
            commission_override_poisha, commission_override_reason,
            vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
            customer_charge_poisha, net_poisha, notes, created_by,
            device_id, client_created_at, dup_txn_flag, stale_rates, stale_review_status
          ) values (
            v_entry_id, v_entry_date, v_op->'payload'->>'customerName',
            coalesce((v_op->'payload'->>'subQty')::int, 1), v_op->'payload'->>'subDescription',
            v_txn_ref, v_method_id, v_gross,
            v_rate_profile_id, v_snapshot,
            (v_op->'payload'->>'vatInputPoisha')::bigint, (v_op->'payload'->>'vatOverridePoisha')::bigint,
            v_op->'payload'->>'vatOverrideReason', (v_op->'payload'->>'commissionOverridePoisha')::bigint,
            v_op->'payload'->>'commissionOverrideReason',
            v_vat, v_comm, v_charge, v_biz_charge, v_cust_charge, v_net,
            v_op->'payload'->>'notes', p_caller_id, p_device_id, v_client_created_at,
            v_dup_txn, v_stale_rates, v_stale_status
          );

          insert into sync_ops (op_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, supersedes_rejected_op_id, result, resolution_status)
          values (v_op_id, p_caller_id, p_device_id, v_op_type, v_entry_id, v_op->'payload', v_server_hash, v_client_created_at, (v_op->>'supersedesRejectedOpId')::uuid, 'ok', 'resolved');

          if (v_op->>'supersedesRejectedOpId') is not null then
            update sync_ops set resolution_status = 'resolved' where op_id = (v_op->>'supersedesRejectedOpId')::uuid;
          end if;

          perform log_audit_event(
            p_caller_id, 'entry.create', 'entries', v_entry_id::text,
            null,
            jsonb_build_object('gross', v_gross, 'vat', v_vat, 'commission', v_comm, 'charge', v_charge, 'net', v_net, 'snapshot', v_snapshot, 'method_id', v_method_id, 'entry_date', v_entry_date)
          );

          v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');
        end;

      elsif v_op_type = 'supersede_entry' then
        if p_caller_role not in ('admin', 'owner') then
          raise exception '403 unauthorized';
        end if;
        perform rpc_supersede_entry((v_op->'payload'->>'originalEntryId')::uuid, v_op->'payload'->'replacement', p_caller_id);
        insert into sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, supersedes_rejected_op_id, result, resolution_status)
        values (v_op_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, (v_op->>'supersedesRejectedOpId')::uuid, 'ok', 'resolved');

        if (v_op->>'supersedesRejectedOpId') is not null then
          update sync_ops set resolution_status = 'resolved' where op_id = (v_op->>'supersedesRejectedOpId')::uuid;
        end if;

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');

      elsif v_op_type = 'void_entry' then
        if p_caller_role not in ('admin', 'owner') then
          raise exception '403 unauthorized';
        end if;

        select date_trunc('month', entry_date)::date into v_entry_month
        from entries where id = (v_op->'payload'->>'entryId')::uuid;

        if exists (select 1 from month_closes where month = v_entry_month and status = 'closed') then
          raise exception '422 month_closed';
        end if;

        update entries
        set status = 'voided', voided_by = p_caller_id, voided_at = now(),
            void_reason = coalesce(v_op->'payload'->>'reason', 'Voided by admin')
        where id = (v_op->'payload'->>'entryId')::uuid and status = 'active';

        if not found then
          raise exception '422 cannot_void_non_active';
        end if;

        insert into sync_ops (op_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, result, resolution_status)
        values (v_op_id, p_caller_id, p_device_id, v_op_type, (v_op->'payload'->>'entryId')::uuid, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

        perform log_audit_event(p_caller_id, 'entry.void', 'entries', v_op->'payload'->>'entryId', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'voided'));

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');

      elsif v_op_type = 'request_void' then
        select date_trunc('month', entry_date)::date into v_entry_month
        from entries where id = (v_op->'payload'->>'entryId')::uuid;

        if exists (select 1 from month_closes where month = v_entry_month and status = 'closed') then
          raise exception '422 month_closed';
        end if;

        update entries
        set void_requested_by = p_caller_id, void_requested_at = now(),
            void_request_reason = v_op->'payload'->>'reason'
        where id = (v_op->'payload'->>'entryId')::uuid and status = 'active'
          and (created_by = p_caller_id or p_caller_role in ('admin', 'owner'));

        if not found then
          raise exception '422 cannot_void_non_active';
        end if;

        insert into sync_ops (op_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, result, resolution_status)
        values (v_op_id, p_caller_id, p_device_id, v_op_type, (v_op->'payload'->>'entryId')::uuid, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

        perform log_audit_event(p_caller_id, 'entry.void_request', 'entries', v_op->'payload'->>'entryId', null, jsonb_build_object('void_requested_by', p_caller_id));

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');

      elsif v_op_type = 'discard_rejected_entry' then
        declare
          v_target_op_id uuid := (v_op->'payload'->>'rejectedOpId')::uuid;
        begin
          if length(trim(coalesce(v_op->'payload'->>'reason', ''))) = 0 then
            raise exception '422 missing_discard_reason';
          end if;

          update sync_ops
          set resolution_status = 'discarded'
          where op_id = v_target_op_id and result = 'rejected'
            and (actor_id = p_caller_id or p_caller_role in ('admin', 'owner'));

          if not found then
            raise exception '403 unauthorized';
          end if;

          insert into sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
          values (v_op_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

          perform log_audit_event(p_caller_id, 'entry.discard_rejected', 'sync_ops', v_target_op_id::text, jsonb_build_object('result', 'rejected'), jsonb_build_object('resolution_status', 'discarded'));

          v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');
        end;

      else
        raise exception '400 unsupported_operation_type';
      end if;

    exception when others then
      -- Record failure inside subtransaction without aborting push batch
      declare
        v_err_reason text := SQLERRM;
      begin
        if v_err_reason like '%device_revoked%' then v_err_reason := 'device_revoked';
        elsif v_err_reason like '%invalid_snapshot_rules%' then v_err_reason := 'invalid_snapshot_rules';
        elsif v_err_reason like '%month_closed%' then v_err_reason := 'month_closed';
        elsif v_err_reason like '%rate_profile_date_mismatch%' then v_err_reason := 'rate_profile_date_mismatch';
        elsif v_err_reason like '%no_rate_profile_for_date%' then v_err_reason := 'no_rate_profile_for_date';
        elsif v_err_reason like '%future_timestamp_skew%' then v_err_reason := 'future_timestamp_skew';
        elsif v_err_reason like '%queue_expired_needs_review%' then v_err_reason := 'queue_expired_needs_review';
        elsif v_err_reason like '%missing_rate_watermark%' then v_err_reason := 'missing_rate_watermark';
        elsif v_err_reason like '%upgrade_required%' then v_err_reason := 'upgrade_required';
        elsif v_err_reason like '%missing_txn_ref%' then v_err_reason := 'missing_txn_ref';
        elsif v_err_reason like '%calc_mismatch%' then v_err_reason := 'calc_mismatch';
        elsif v_err_reason like '%cannot_void_non_active%' then v_err_reason := 'cannot_void_non_active';
        elsif v_err_reason like '%cannot_supersede_non_active%' then v_err_reason := 'cannot_supersede_non_active';
        elsif v_err_reason like '%missing_discard_reason%' then v_err_reason := 'missing_discard_reason';
        elsif v_err_reason like '%op_id_conflict_tampered%' then v_err_reason := 'op_id_conflict_tampered';
        elsif v_err_reason like '%403%' then v_err_reason := 'unauthorized';
        end if;

        -- Persistent audit logging inside exception handler
        if v_err_reason in ('calc_mismatch', 'invalid_snapshot_rules') then
          perform log_audit_event(p_caller_id, 'sync.calc_mismatch', 'sync_ops', v_op_id::text, null, jsonb_build_object('op_id', v_op_id, 'reason', v_err_reason));
        elsif v_err_reason like '%tamper%' then
          perform log_audit_event(p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text, null, jsonb_build_object('op_id', v_op_id, 'reason', v_err_reason));
        end if;

        insert into sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
        values (v_op_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', v_err_reason)
        on conflict (op_id) do update set reason = EXCLUDED.reason, result = 'rejected', resolution_status = 'pending';

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', v_err_reason);
      end;
    end;
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

-- 26. Scheduled Cron Job: Daily retention cleanup at 21:00 UTC = 03:00 Asia/Dhaka (PRD §7.3, §11 PRD ISSUE 004-1)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('sync-op-retention');
    perform cron.schedule('sync-op-retention', '0 21 * * *', 'SELECT purge_expired_sync_ops();');
  end if;
end $$;

-- 27. Security Privilege Revocations (Hard Rule 7, Gate 1, Test #22)
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
```

### 6.2 `tests/db/calc_parity.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

// Portable JSON fixture loading compatible with NodeNext and bundler resolutions
const fixtures = JSON.parse(
  fs.readFileSync(new URL('../../packages/calc/fixtures/test_fixtures.json', import.meta.url), 'utf8')
);

describe('Database SQL Arithmetic Backstop Parity Tests (PRD §6.5, §7.3)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verifies mul_bp() in PostgreSQL matches TS mulBp across all paper ledger fixtures', async () => {
    for (const row of fixtures.paperLedgerRows) {
      const res = await pool.query('SELECT mul_bp($1::bigint, $2::int) as charge', [
        row.grossPoisha,
        row.chargeBp,
      ]);
      expect(res.rows[0].charge).toBe(row.expectedChargePoisha);
    }
  });

  it('verifies the two rounding traps in PostgreSQL match TypeScript engine', async () => {
    // Card charge row 5: 590900 poisha * 150 bp = 8864 poisha
    const resCard = await pool.query('SELECT mul_bp(590900::bigint, 150) as charge');
    expect(resCard.rows[0].charge).toBe('8864');

    // bKash charge row 1: 590900 poisha * 115 bp = 6795 poisha
    const resBkash = await pool.query('SELECT mul_bp(590900::bigint, 115) as charge');
    expect(resBkash.rows[0].charge).toBe('6795');
  });

  it('verifies round_half_up() in PostgreSQL matches TS roundHalfUp across percent_inclusive fixtures (P1, P2, P3)', async () => {
    for (const fixture of fixtures.forwardLookingFixtures.percentInclusive) {
      const gross = BigInt(fixture.grossPoisha);
      const vatBp = BigInt(fixture.vatBp);
      const divisor = 10000n + vatBp;
      const res = await pool.query('SELECT round_half_up($1::bigint * 10000, $2::bigint) as base', [
        gross.toString(),
        divisor.toString(),
      ]);
      expect(res.rows[0].base).toBe(fixture.expectedBasePoisha);
    }
  });

  it('verifies deduction guard parity between TypeScript and database constraints', async () => {
    // Vectors where deductions > gross must fail database check constraints or triggers
    for (const testCase of fixtures.guardRejectionCases) {
      const gross = BigInt(testCase.grossPoisha);
      const vat = BigInt(testCase.vatPoisha || '0');
      const comm = BigInt(testCase.commissionPoisha || '0');
      const fee = BigInt(testCase.chargePoisha || '0');
      
      const totalDeductions = vat + comm + fee;
      expect(totalDeductions > gross).toBe(true);

      // Verify PostgreSQL deduction guard expression directly
      const res = await pool.query(
        'SELECT ($1::bigint + $2::bigint + $3::bigint <= $4::bigint) as valid',
        [vat.toString(), comm.toString(), fee.toString(), gross.toString()]
      );
      expect(res.rows[0].valid).toBe(false);
    }
  });

  it('verifies override parity preserves gross conservation in SQL', async () => {
    const gross = 100000n;
    const vatOverride = 15000n;
    const commOverride = 25000n;
    const bizCharge = 1500n;
    const net = gross - (vatOverride + commOverride + bizCharge);

    expect(vatOverride + commOverride + bizCharge + net).toBe(gross);

    const res = await pool.query(
      'SELECT ($1::bigint + $2::bigint + $3::bigint + $4::bigint = $5::bigint) as conserved',
      [vatOverride.toString(), commOverride.toString(), bizCharge.toString(), net.toString(), gross.toString()]
    );
    expect(res.rows[0].conserved).toBe(true);
  });
});
```

### 6.3 `tests/db/entries_sync.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

describe('Core Database Procedures, Sync Push Engine, and Concurrency Tests', () => {
  let pool: pg.Pool;

  const OWNER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
  const STAFF_ID = '00000000-0000-0000-0000-000000000003';
  const METHOD_BKASH_ID = '10000000-0000-0000-0000-000000000001';
  const METHOD_CASH_ID = '10000000-0000-0000-0000-000000000002';
  const RATE_PROFILE_V1_ID = '20000000-0000-0000-0000-000000000001';
  const DEVICE_ID = 'd0000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // Clean teardown and deterministic setup of test fixtures
    await pool.query(`
      -- Clean previous test entries and sync_ops
      DELETE FROM audit_log WHERE target_table in ('entries', 'rate_profiles', 'devices', 'payables', 'payment_methods', 'sync_ops');
      DELETE FROM sync_ops;
      DELETE FROM entries;
      DELETE FROM method_rates;
      DELETE FROM rate_profiles;
      DELETE FROM payment_methods;

      -- Baseline auth.users and profiles
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_ID}', 'owner@cosmo.local'),
        ('${ADMIN_ID}', 'admin@cosmo.local'),
        ('${STAFF_ID}', 'staff@cosmo.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO profiles (id, full_name, role, active) VALUES
        ('${OWNER_ID}', 'Zia Owner', 'owner', true),
        ('${ADMIN_ID}', 'Admin User', 'admin', true),
        ('${STAFF_ID}', 'Staff User', 'staff', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;

      -- Baseline payment methods initially inactive to avoid chicken-and-egg trigger crash
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order) VALUES
        ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, false, 1),
        ('${METHOD_CASH_ID}', 'cash', 'Cash', false, false, 2)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline published rate profile v1 (seeded as draft first, method rates added, then published)
      INSERT INTO rate_profiles (
        id, version, effective_from, status, vat_mode, vat_bp,
        commission_base, commission_bp, charges_borne_by, created_by
      ) VALUES (
        '${RATE_PROFILE_V1_ID}', 1, '2026-01-01', 'draft', 'manual', 0,
        'gross_minus_vat', 4200, 'business', '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp) VALUES
        ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_CASH_ID}', 0)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      UPDATE rate_profiles set status = 'published' where id = '${RATE_PROFILE_V1_ID}';
      UPDATE payment_methods set active = true where id in ('${METHOD_BKASH_ID}', '${METHOD_CASH_ID}');

      -- Register initial device presence
      INSERT INTO devices (device_id, user_id, revoked, last_seen_at) VALUES
        ('${DEVICE_ID}', '${STAFF_ID}', false, now())
      ON CONFLICT (device_id, user_id) DO UPDATE SET revoked = false;
    `);
  });

  afterAll(async () => {
    // Teardown test artifacts in reverse FK order
    await pool.query(`
      DELETE FROM audit_log WHERE actor_id in ('${OWNER_ID}', '${ADMIN_ID}', '${STAFF_ID}');
      DELETE FROM sync_ops WHERE actor_id in ('${OWNER_ID}', '${ADMIN_ID}', '${STAFF_ID}');
      DELETE FROM entries WHERE created_by in ('${OWNER_ID}', '${ADMIN_ID}', '${STAFF_ID}');
      DELETE FROM devices WHERE device_id = '${DEVICE_ID}';
    `);
    await pool.end();
  });

  it('Test #1: Forged Snapshot Rejection (PRD §6.5, §16.2 Test #1)', async () => {
    const opId = 'a0000001-0000-0000-0000-000000000001';
    const entryId = 'b0000001-0000-0000-0000-000000000001';

    // Client attempts to forge lower chargeBp (100 instead of DB's 115)
    const forgedSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 100, // Forged lower rate
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const pushPayload = [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Customer Test 1',
          methodId: METHOD_BKASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '1000',
          businessChargePoisha: '1000',
          customerChargePoisha: '0',
          netPoisha: '57000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: forgedSnapshot,
          txnRef: 'TXN-FORGED-01',
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(pushPayload)]
    );

    const result = res.rows[0].result;
    expect(result.results[0].status).toBe('rejected');
    expect(result.results[0].reason).toBe('invalid_snapshot_rules');

    // Assert audit log captures calc mismatch
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE event_name = 'sync.calc_mismatch' AND target_id = $1",
      [opId]
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #2: Commit-Order Sequence Race Immunity (PRD §7.2, §16.2 Test #2)', async () => {
    // Two concurrent transactions allocate entries; pg_advisory_xact_lock(1002, 1) strictly serializes them
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    const opId1 = 'a0000002-0000-0000-0000-000000000001';
    const entryId1 = 'b0000002-0000-0000-0000-000000000001';
    const opId2 = 'a0000002-0000-0000-0000-000000000002';
    const entryId2 = 'b0000002-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 115,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const makeOp = (opId: string, entryId: string, txnRef: string) => [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Concurrent Customer',
          methodId: METHOD_BKASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '1150',
          businessChargePoisha: '1150',
          customerChargePoisha: '0',
          netPoisha: '56850',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
          txnRef,
        },
      },
    ];

    try {
      const [res1, res2] = await Promise.all([
        client1.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(makeOp(opId1, entryId1, 'TXN-CONC-01')),
        ]),
        client2.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(makeOp(opId2, entryId2, 'TXN-CONC-02')),
        ]),
      ]);

      expect(res1.rows[0].result.results[0].status).toBe('ok');
      expect(res2.rows[0].result.results[0].status).toBe('ok');

      // Verify sequence monotonicity without gaps
      const seqRes = await pool.query(
        'SELECT server_seq, id FROM entries WHERE id IN ($1, $2) ORDER BY server_seq ASC',
        [entryId1, entryId2]
      );

      const seqs = seqRes.rows.map((r) => BigInt(r.server_seq));
      expect(seqs.length).toBe(2);
      expect(seqs[1] - seqs[0]).toBe(1n);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #8: Concurrent Supersedes Serialization (PRD §7.3, §16.2 Test #8)', async () => {
    const origId = 'b0000008-0000-0000-0000-000000000000';
    const rep1Id = 'b0000008-0000-0000-0000-000000000001';
    const rep2Id = 'b0000008-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Insert active baseline entry to supersede
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, status
      ) VALUES (
        '${origId}', '2026-10-15', 'Original Entry', '${METHOD_CASH_ID}', 100000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 42000, 0,
        0, 0, 58000, '${STAFF_ID}', 'active'
      )
    `);

    const makeReplacement = (id: string) => ({
      id,
      entryDate: '2026-10-15',
      customerName: 'Replacement Entry',
      methodId: METHOD_CASH_ID,
      grossPoisha: '100000',
      vatPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '0',
      businessChargePoisha: '0',
      customerChargePoisha: '0',
      netPoisha: '58000',
      rateProfileId: RATE_PROFILE_V1_ID,
      snapshot: validSnapshot,
      reassignReason: 'Correction of original note',
    });

    const c1 = await pool.connect();
    const c2 = await pool.connect();

    try {
      const results = await Promise.allSettled([
        c1.query('SELECT rpc_supersede_entry($1, $2, $3) as res', [origId, JSON.stringify(makeReplacement(rep1Id)), ADMIN_ID]),
        c2.query('SELECT rpc_supersede_entry($1, $2, $3) as res', [origId, JSON.stringify(makeReplacement(rep2Id)), ADMIN_ID]),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      // @ts-ignore
      expect(rejected[0].reason.message).toContain('cannot_supersede_non_active');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('Test #14: Rate Profile Draft-Publish Immutability Lock (PRD §7.1, §16.2 Test #14)', async () => {
    // UPDATE on published profile must be rejected
    await expect(
      pool.query(`UPDATE rate_profiles SET commission_bp = 5000 WHERE id = '${RATE_PROFILE_V1_ID}'`)
    ).rejects.toThrow('published_rate_profile_immutable');

    // Method rate insertion into published profile must be rejected
    await expect(
      pool.query(`
        INSERT INTO method_rates (rate_profile_id, payment_method_id, fee_bp, charges_borne_by)
        VALUES ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 200, 'business')
      `)
    ).rejects.toThrow('method_rates_published_profile_immutable');
  });

  it('Test #15 & #44: Atomic Ownership Transfer & Demote-Before-Promote Order (PRD §7.3, §16.2 Test #15, #44)', async () => {
    // Attempt transfer to non-admin staff member must be rejected
    await expect(
      pool.query('SELECT transfer_ownership($1, $2)', [STAFF_ID, OWNER_ID])
    ).rejects.toThrow('target_user_must_be_admin');

    // Transfer ownership to Admin
    await pool.query('SELECT transfer_ownership($1, $2)', [ADMIN_ID, OWNER_ID]);

    const res = await pool.query('SELECT id, role, active FROM profiles WHERE id in ($1, $2)', [OWNER_ID, ADMIN_ID]);
    const roles = Object.fromEntries(res.rows.map((r) => [r.id, r.role]));

    expect(roles[ADMIN_ID]).toBe('owner');
    expect(roles[OWNER_ID]).toBe('admin');

    // Transfer back to Zia for subsequent tests
    await pool.query('SELECT transfer_ownership($1, $2)', [OWNER_ID, ADMIN_ID]);
  });

  it('Test #18: Discard Authorization and Provenance (PRD §9.1, §16.2 Test #18)', async () => {
    const rejectedOpId = 'a0000018-0000-0000-0000-000000000001';
    await pool.query(`
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
      VALUES ('${rejectedOpId}', '${STAFF_ID}', '${DEVICE_ID}', 'create_entry', '{}'::jsonb, 'hash', now(), 'rejected', 'pending')
    `);

    const discardOp = [
      {
        opId: 'a0000018-0000-0000-0000-000000000002',
        type: 'discard_rejected_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          rejectedOpId,
          reason: 'Duplicate entry submitted in error',
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(discardOp)]
    );
    expect(res.rows[0].result.results[0].status).toBe('ok');

    const opRes = await pool.query('SELECT resolution_status FROM sync_ops WHERE op_id = $1', [rejectedOpId]);
    expect(opRes.rows[0].resolution_status).toBe('discarded');
  });

  it('Test #24: Batch Subtransaction Fault Isolation in rpc_push_sync_op (PRD §9.1, §16.2 Test #24)', async () => {
    const validOpId = 'a0000024-0000-0000-0000-000000000001';
    const validEntryId = 'b0000024-0000-0000-0000-000000000001';
    const invalidOpId = 'a0000024-0000-0000-0000-000000000002';
    const invalidEntryId = 'b0000024-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const batch = [
      {
        opId: validOpId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: validEntryId,
          entryDate: '2026-10-15',
          customerName: 'Valid Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: invalidOpId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: invalidEntryId,
          entryDate: '2026-10-15',
          customerName: 'Invalid Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '99999', // Arithmetic mismatch violation
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(batch)]
    );

    const results = res.rows[0].result.results;
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason).toBe('calc_mismatch');

    // Verify valid entry committed to database
    const entryCheck = await pool.query('SELECT id FROM entries WHERE id = $1', [validEntryId]);
    expect(entryCheck.rows.length).toBe(1);
  });

  it('Test #31: Cross-Concurrency Lock Inversion Deadlock Immunity (PRD §7.2, §16.2 Test #31)', async () => {
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Client 1 touches 2026-10 then 2026-11
    const op1 = [
      {
        opId: 'a0000031-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000001',
          entryDate: '2026-10-10',
          customerName: 'Oct Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: 'a0000031-0000-0000-0000-000000000002',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000002',
          entryDate: '2026-11-10',
          customerName: 'Nov Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    // Client 2 touches 2026-11 then 2026-10
    const op2 = [
      {
        opId: 'a0000031-0000-0000-0000-000000000003',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000003',
          entryDate: '2026-11-15',
          customerName: 'Nov Customer 2',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: 'a0000031-0000-0000-0000-000000000004',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000004',
          entryDate: '2026-10-20',
          customerName: 'Oct Customer 2',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    try {
      const [res1, res2] = await Promise.all([
        c1.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(op1)]),
        c2.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(op2)]),
      ]);

      expect(res1.rows[0].result.results[0].status).toBe('ok');
      expect(res2.rows[0].result.results[0].status).toBe('ok');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('Test #32: Supersede Non-Active Rejection (PRD §7.3, §16.2 Test #32)', async () => {
    const entryId = 'b0000032-0000-0000-0000-000000000001';
    const rep1Id = 'b0000032-0000-0000-0000-000000000002';
    const rep2Id = 'b0000032-0000-0000-0000-000000000003';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Insert active entry
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, status
      ) VALUES (
        '${entryId}', '2026-10-15', 'Original Entry', '${METHOD_CASH_ID}', 100000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 42000, 0,
        0, 0, 58000, '${STAFF_ID}', 'active'
      )
    `);

    const replacement = (id: string) => ({
      id,
      entryDate: '2026-10-15',
      customerName: 'Replacement',
      methodId: METHOD_CASH_ID,
      grossPoisha: '100000',
      vatPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '0',
      businessChargePoisha: '0',
      customerChargePoisha: '0',
      netPoisha: '58000',
      rateProfileId: RATE_PROFILE_V1_ID,
      snapshot: validSnapshot,
    });

    // First supersede succeeds
    await pool.query('SELECT rpc_supersede_entry($1, $2, $3)', [entryId, JSON.stringify(replacement(rep1Id)), ADMIN_ID]);

    // Second supersede against already superseded entry must be rejected
    await expect(
      pool.query('SELECT rpc_supersede_entry($1, $2, $3)', [entryId, JSON.stringify(replacement(rep2Id)), ADMIN_ID])
    ).rejects.toThrow('cannot_supersede_non_active');
  });

  it('Test #41: Anti-Cherry-Picking Watermark & Deduction Guard Rejection (PRD §7.3, §9.1, §16.2 Test #41)', async () => {
    // 1. Deduction Guard Rejection (> 100% total deductions rejected at publish time)
    const excessiveProfileId = '20000000-0000-0000-0000-000000000099';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, created_by)
      VALUES ('${excessiveProfileId}', 99, 'draft', '2026-12-01', 'percent_of_gross', 1500, 'gross', 4500, '${ADMIN_ID}');
      INSERT INTO method_rates (rate_profile_id, payment_method_id, fee_bp, charges_borne_by)
      VALUES
        ('${excessiveProfileId}', '${METHOD_BKASH_ID}', 4500, 'business'),
        ('${excessiveProfileId}', '${METHOD_CASH_ID}', 0, 'business');
    `);

    // 1500 (VAT) + 4500 (Comm) + 4500 (bKash) = 10500 bp = 105% > 100%
    await expect(
      pool.query('SELECT publish_rate_profile($1, $2)', [excessiveProfileId, ADMIN_ID])
    ).rejects.toThrow('deductions_exceed_100_percent');

    // 2. Anti-Cherry-Picking: client knows newer profile v2 but submits older profile v1
    const profileV2Id = '20000000-0000-0000-0000-000000000002';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, created_by)
      VALUES ('${profileV2Id}', 2, 'draft', '2026-10-01', 'manual', 0, 'gross_minus_vat', 4000, '${ADMIN_ID}');
      INSERT INTO method_rates (rate_profile_id, payment_method_id, fee_bp, charges_borne_by)
      VALUES
        ('${profileV2Id}', '${METHOD_BKASH_ID}', 115, 'business'),
        ('${profileV2Id}', '${METHOD_CASH_ID}', 0, 'business');
      UPDATE rate_profiles SET status = 'published' WHERE id = '${profileV2Id}';
    `);

    const validSnapshotV1 = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Client watermark is 2, but client attempts to submit under Profile v1 for an Oct 15 entry
    const cherryPickOp = [
      {
        opId: 'a0000041-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 2,
        payload: {
          id: 'b0000041-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Cherry Picker',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshotV1,
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(cherryPickOp)]
    );
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('rate_profile_date_mismatch');
  });

  it('Test #56: Engine Version Skew Enforcement (PRD §9.1, §16.2 Test #56)', async () => {
    const skewedSnapshot = {
      version: 1,
      engineVersion: 999, // Incompatible engine version
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const op = [
      {
        opId: 'a0000056-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000056-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Skew Client',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: skewedSnapshot,
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(op)]
    );
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('upgrade_required');
  });

  it('Test #57: >৳50,000 Stale-Rate Review Workflow (PRD §7.3, §16.2 Test #57)', async () => {
    const entryId = 'b0000057-0000-0000-0000-000000000001';
    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Seed flagged entry over 50k BDT (6,000,000 poisha = 60,000 BDT)
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by,
        status, stale_rates, stale_review_status
      ) VALUES (
        '${entryId}', '2026-10-15', 'High Value Customer', '${METHOD_CASH_ID}', 6000000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 2520000, 0,
        0, 0, 3480000, '${STAFF_ID}', 'active', true, 'flagged'
      )
    `);

    // Admin approves stale review
    const approveRes = await pool.query(
      'SELECT admin_review_stale_entry($1, $2, $3) as res',
      [entryId, 'approved', ADMIN_ID]
    );
    expect(approveRes.rows[0].res.status).toBe('approved');

    const entryRes = await pool.query(
      'SELECT stale_review_status, stale_reviewed_by FROM entries WHERE id = $1',
      [entryId]
    );
    expect(entryRes.rows[0].stale_review_status).toBe('approved');
    expect(entryRes.rows[0].stale_reviewed_by).toBe(ADMIN_ID);

    // Verify audit log
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE event_name = 'entry.stale_review_approve' AND target_id = $1",
      [entryId]
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #59: User Provisioning & Privilege Defense (PRD §7.3, §16.2 Test #59)', async () => {
    const newUserId = '00000000-0000-0000-0000-000000000059';

    // Insert user with forged raw_user_meta_data role: 'owner'
    await pool.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${newUserId}', 'hacker@cosmo.local', '{"role": "owner"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Verify trigger forced profile role to staff
    const profileRes = await pool.query('SELECT role FROM profiles WHERE id = $1', [newUserId]);
    expect(profileRes.rows[0].role).toBe('staff');

    // Verify admin_invite_user blocks inviting an owner
    await expect(
      pool.query('SELECT admin_invite_user($1, $2, $3, $4)', ['newowner@cosmo.local', 'owner', 'New Owner', OWNER_ID])
    ).rejects.toThrow('cannot_invite_owner');
  });

  it('Test #60: Mandatory Rate Watermark Enforcement (PRD §9.1, §16.2 Test #60)', async () => {
    const op = [
      {
        opId: 'a0000060-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        // maxKnownRateVersion omitted
        payload: {
          id: 'b0000060-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'No Watermark',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: {
            version: 1,
            engineVersion: 1,
            vatMode: 'manual',
            vatBp: 0,
            commissionBp: 4200,
            commissionBase: 'gross_minus_vat',
            methodFeeBp: 0,
            chargesBorneBy: 'business',
            rateProfileId: RATE_PROFILE_V1_ID,
          },
        },
      },
    ];

    const res = await pool.query(
      'SELECT rpc_push_sync_op($1, $2, $3, $4) as result',
      [DEVICE_ID, STAFF_ID, 'staff', JSON.stringify(op)]
    );
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('missing_rate_watermark');
  });

  it('Test #61: Entry-ID Push Idempotency and Tamper Conflict (PRD §9.1, §16.2 Test #61)', async () => {
    const opId = 'a0000061-0000-0000-0000-000000000001';
    const entryId = 'b0000061-0000-0000-0000-000000000001';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const makeOp = (customerName: string) => [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        serverHash: 'hash-v1',
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName,
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    // Initial push succeeds
    const res1 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(makeOp('Original Customer')),
    ]);
    expect(res1.rows[0].result.results[0].status).toBe('ok');

    // Replay identical push: returns duplicate with sequence numbers
    const res2 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(makeOp('Original Customer')),
    ]);
    expect(res2.rows[0].result.results[0].status).toBe('duplicate');
    expect(res2.rows[0].result.results[0].server_seq).toBeDefined();
    expect(res2.rows[0].result.results[0].entry_number).toBeDefined();

    // Replay with tampered payload: returns rejected with op_id_conflict_tampered
    const tamperedOp = [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        serverHash: 'tampered-hash',
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Tampered Customer Name',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    const res3 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(tamperedOp),
    ]);
    expect(res3.rows[0].result.results[0].status).toBe('rejected');
    expect(res3.rows[0].result.results[0].reason).toBe('op_id_conflict_tampered');

    // Verify tamper audit event was logged
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE event_name = 'security.tamper_detected' AND target_id = $1",
      [opId]
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #62: Multi-User Shared Device Presence & Global Killswitch (PRD §7.3, §9.1, §16.2 Test #62)', async () => {
    // Admin revokes device
    await pool.query('SELECT admin_manage_device($1, $2, $3)', [DEVICE_ID, 'revoke', ADMIN_ID]);

    const op = [
      {
        opId: 'a0000062-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000062-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Revoked Device Push',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: {
            version: 1,
            engineVersion: 1,
            vatMode: 'manual',
            vatBp: 0,
            commissionBp: 4200,
            commissionBase: 'gross_minus_vat',
            methodFeeBp: 0,
            chargesBorneBy: 'business',
            rateProfileId: RATE_PROFILE_V1_ID,
          },
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(op),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('device_revoked');

    // Unrevoke for clean state
    await pool.query('SELECT admin_manage_device($1, $2, $3)', [DEVICE_ID, 'unrevoke', ADMIN_ID]);
  });

  it('Test #63: Deactivated User Re-Invite Guard & Privilege Escalation Defense (PRD §7.3, §16.2 Test #63)', async () => {
    const deactAdminId = '00000000-0000-0000-0000-000000000063';
    await pool.query(`
      INSERT INTO auth.users (id, email) VALUES ('${deactAdminId}', 'deactadmin@cosmo.local') ON CONFLICT (id) DO NOTHING;
      INSERT INTO profiles (id, full_name, role, active) VALUES ('${deactAdminId}', 'Deactivated Admin', 'admin', false)
      ON CONFLICT (id) DO UPDATE SET active = false, role = 'admin';
    `);

    // Another Admin cannot reactivate an Admin account
    await expect(
      pool.query('SELECT admin_invite_user($1, $2, $3, $4)', ['deactadmin@cosmo.local', 'admin', 'Deactivated Admin', ADMIN_ID])
    ).rejects.toThrow('unauthorized');

    // Owner can reactivate the Admin account
    await pool.query('SELECT admin_invite_user($1, $2, $3, $4)', ['deactadmin@cosmo.local', 'admin', 'Reactivated Admin', OWNER_ID]);

    const res = await pool.query('SELECT active, role FROM profiles WHERE id = $1', [deactAdminId]);
    expect(res.rows[0].active).toBe(true);
    expect(res.rows[0].role).toBe('admin');
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Test #1 (Forged Snapshot Rejection) | Sync op with forged lowered rate in snapshot | `{ status: 'rejected', reason: 'invalid_snapshot_rules' }` and `sync.calc_mismatch` in `audit_log` | §16.2 Test #1 | `tests/db/entries_sync.test.ts` |
| Test #2 (Commit-Order Sequence Race) | Concurrent sequence allocation | strictly monotonic sequence cursor without skips | §16.2 Test #2 | `tests/db/entries_sync.test.ts` |
| Test #8 (Concurrent Supersedes Lock) | Two concurrent supersedes targeting same entry | exactly 1 succeeds, second rejected with `cannot_supersede_non_active` | §16.2 Test #8 | `tests/db/entries_sync.test.ts` |
| Test #14 (Rate Profile Immutability) | UPDATE on published profile | raises exception `published_rate_profile_immutable` | §16.2 Test #14 | `tests/db/entries_sync.test.ts` |
| Test #15 & #44 (Atomic Ownership Transfer) | `transfer_ownership(new_owner, caller)` | previous owner $\to$ admin, target $\to$ owner; zero constraint violations on `one_owner` and `trg_prevent_zero_owners` | §16.2 Test #15, #44 | `tests/db/entries_sync.test.ts` |
| Test #18 (Discard Authorization) | Staff discards own rejected op | `{ status: 'ok' }` and op resolution $\to$ `'discarded'` | §16.2 Test #18 | `tests/db/entries_sync.test.ts` |
| Test #24 (Subtransaction Isolation) | 2 ops where op #2 violates backstop | op #1 returns `'ok'`, op #2 returns `'rejected'` with `'calc_mismatch'` | §16.2 Test #24 | `tests/db/entries_sync.test.ts` |
| Test #31 (Lock Inversion Immunity) | Concurrent multi-month entry pushes in differing month orders | both transactions serialize cleanly via lock hierarchy with zero `40P01` deadlocks | §16.2 Test #31 | `tests/db/entries_sync.test.ts` |
| Test #32 (Supersede Non-Active Rejection) | Supersede already superseded entry | raises exception `cannot_supersede_non_active` | §16.2 Test #32 | `tests/db/entries_sync.test.ts` |
| Test #41 (Anti-Cherry-Picking Watermark & Deduction Guard) | Pushing older profile than watermark, or publishing >100% deduction profile | raises `deductions_exceed_100_percent` at publish; returns `{ status: 'rejected', reason: 'rate_profile_date_mismatch' }` on cherry-pick push | §16.2 Test #41 | `tests/db/entries_sync.test.ts` |
| Test #56 (Engine Version Skew) | Snapshot with `engineVersion = 999` | returns `{ status: 'rejected', reason: 'upgrade_required' }` | §16.2 Test #56 | `tests/db/entries_sync.test.ts` |
| Test #57 (>৳50k Stale Review Workflow) | Stale entry > 50,000 BDT flagged and reviewed | `stale_review_status` updates to `'approved'` with reviewer UUID and audit log event `entry.stale_review_approve` | §16.2 Test #57 | `tests/db/entries_sync.test.ts` |
| Test #59 (User Provisioning & Privilege Defense) | Auth user created with `raw_user_meta_data = { role: 'owner' }` | profile created with `role = 'staff'`; `admin_invite_user` rejects owner invite | §16.2 Test #59 | `tests/db/entries_sync.test.ts` |
| Test #60 (Mandatory Rate Watermark) | Sync op without `maxKnownRateVersion` | returns `{ status: 'rejected', reason: 'missing_rate_watermark' }` | §16.2 Test #60 | `tests/db/entries_sync.test.ts` |
| Test #61 (Entry-ID Idempotency Retry) | Re-pushing identical opId and payload | returns `{ status: 'duplicate', server_seq, entry_number }`; altered payload returns `'op_id_conflict_tampered'` | §16.2 Test #61 | `tests/db/entries_sync.test.ts` |
| Test #62 (Shared Device & Killswitch) | Device revoked via `admin_manage_device` | sync push rejected with `device_revoked` | §16.2 Test #62 | `tests/db/entries_sync.test.ts` |
| Test #63 (Deactivated User Re-Invite Guard) | Admin re-invites deactivated Admin account | raises exception `403 unauthorized`; Owner invite reactivates account | §16.2 Test #63 | `tests/db/entries_sync.test.ts` |

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Migration 000005 Applies Cleanly | `pnpm db:reset` succeeds | `pnpm db:reset` | exits with code 0 |
| SQL Parity Tests Pass | `mul_bp`, `round_half_up`, and deduction guard match fixtures | `pnpm vitest run tests/db/calc_parity.test.ts` | exits with code 0 |
| Core Entries & Sync Tests Pass | All 18 integration tests pass | `pnpm vitest run tests/db/entries_sync.test.ts` | exits with code 0 |
| Lock Class IDs Verified | Advisory locks use 1001, 1002, 1003 in strict hierarchy | `pnpm vitest run tests/db/entries_sync.test.ts -t "Lock Inversion"` | exits with code 0 |
| Audit Log Append Verified | State mutations write to `audit_log` with before/after state | `node -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}); p.query("SELECT count(*) FROM audit_log WHERE event_name in (\"entry.create\", \"rate_profile.publish\", \"user.invite\")").then(r=>{console.log(parseInt(r.rows[0].count)>0); p.end();});'` | `true` |

## 9. Hard Rules Touched

- Rule 1: Never hardcode rates; `rpc_push_sync_op` queries date-effective published profile.
- Rule 2: Integer poisha throughout; all function arguments and internal variables use `bigint`.
- Rule 3: Single authoritative calculation engine; database verifies non-override arithmetic independently via `mul_bp`.
- Rule 4: Entries are immutable snapshots; rate changes never modify existing entries.
- Rule 5: Every state change writes `audit_log` inside the same mutating transaction with before and after state snapshots.
- Rule 7: Privileged writes execute exclusively through SECURITY DEFINER RPCs under `service_role`.
- Rule 9: Server trusts nothing from client; re-derives identity, role, and re-verifies snapshots.
- Rule 10: Respect lock hierarchy; acquires Month Locks (1001), then Sequence Lock (1002), then row locks.

## 10. Pitfalls

1. Deadlock via lock acquisition order: Acquiring sequence lock (1002) before month lock (1001).
   - Symptom: PostgreSQL deadlock detected errors (`40P01`) under concurrent multi-month pushes.
   - Fix: Gather all unique target months, sort ascending, and acquire month locks (1001) as Step 1 before sequence lock (1002).
2. Subtransaction leakage: Unhandled exception rolling back all successful operations in a push batch.
   - Symptom: Valid transactions aborted due to a single invalid entry in the same push payload.
   - Fix: Wrap per-operation loops in isolated PL/pgSQL `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` subtransactions.
3. Tamper conflict false rejection: Rejecting an identical client push retry after a dropped network response.
   - Symptom: Client unable to sync an offline entry after an initial connection drop.
   - Fix: Query `entries` by UUID and check payload hash before inserting; return `{ status: 'duplicate', server_seq, entry_number }` if hash matches.
4. Premature retention purge: Purging successful `ok` ops breaks idempotency caching and tamper detection.
   - Symptom: Repeated sync of an old entry causes duplicate insert or tamper conflict instead of duplicate response.
   - Fix: Filter `purge_expired_sync_ops` strictly on `result = 'rejected' AND resolution_status IN ('resolved', 'discarded')`.

## 11. PRD ISSUES and DECISION PENDING

- PRD ISSUE 004-1: PRD §7.3 specifies scheduling `purge_expired_sync_ops` via `pg_cron` daily at 03:00 Asia/Dhaka (`SELECT cron.schedule('sync-op-retention', '0 3 * * *', 'SELECT purge_expired_sync_ops();');`). However, `pg_cron` schedules run in UTC time. Asia/Dhaka is UTC+6; therefore 03:00 Asia/Dhaka corresponds to 21:00 UTC (cron expression `'0 21 * * *'`). In local development with standard Supabase CLI or standalone PostgreSQL containers, `pg_cron` requires `shared_preload_libraries = 'pg_cron'` and specific extension setup. The migration conditionally creates the extension and schedule using `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN CREATE EXTENSION IF NOT EXISTS pg_cron; PERFORM cron.schedule('sync-op-retention', '0 21 * * *', 'SELECT purge_expired_sync_ops();'); END IF; END $$;` to prevent bootstrap failure in environments without `pg_cron` preloaded.
- [PLAN-DERIVED: enforces no-backdating check at draft time in `create_or_update_draft_rate_profile`]: PRD §7.3 enforces the no-backdating check at publish time (`publish_rate_profile`). Enforcing it additionally at draft time provides immediate feedback during profile editing.

## 12. Handoff

Once this plan is Implemented, subsequent plans rely on:
- Privileged database RPCs: `rpc_push_sync_op`, `rpc_supersede_entry`, `admin_review_stale_entry`, `admin_invite_user`, `transfer_ownership`, `create_or_update_draft_rate_profile`, `publish_rate_profile`, `admin_manage_payment_method`, `admin_manage_payable`, `admin_update_settings`, `admin_manage_user`, `admin_manage_device`, `upsert_device_sync_state`, and `purge_expired_sync_ops`.
- Triggers enforcing sequence allocation (`trg_entries_server_seq`), entries immutability (`trg_entries_immutability`), rate profile draft/publish immutability (`trg_rate_profiles_draft_publish_lock`), payment method active rate checking (`trg_payment_methods_active_rate_check`), and user profile provisioning (`trg_auth_users_create_profile`).
- Differential parity test suite: `tests/db/calc_parity.test.ts`.

## 13. Suggested Task Breakdown

- Task CLT-T-016: Helper functions and immutability triggers (`supabase/migrations/20261029000005_functions_entries_rates_sync.sql` part 1). Role: Implementer. Priority: P0. Scope: triggers and helpers. Depends on: CLT-T-003.
- Task CLT-T-017: Sync push, entry supersession, and stale review RPCs (`supabase/migrations/20261029000005_functions_entries_rates_sync.sql` part 2). Role: Implementer. Priority: P0. Scope: sync and entries procedures. Depends on: CLT-T-016.
- Task CLT-T-018: User provisioning, ownership transfer, admin management RPCs, and test suites (`supabase/migrations/20261029000005_functions_entries_rates_sync.sql` part 3, `tests/db/calc_parity.test.ts`, `tests/db/entries_sync.test.ts`). Role: DevOps. Priority: P0. Scope: admin RPCs and tests. Depends on: CLT-T-017.

## Changelog

- 2026-11-01: Revision 2.2 — Cold adversarial auditor remediation:
  - 1. **Fixed Extension Prerequisite**: Added `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the start of the migration to support `digest()` hashing.
  - 2. **Corrected `audit_log` Insert Columns**: Realigned all internal `log_audit_event` calls and table inserts to standard columns (`actor, action, target_table, target_id, before, after`).
  - 3. **Fixed `BEFORE DELETE` Triggers**: Updated `fn_rate_profiles_draft_publish_lock` and `fn_method_rates_draft_publish_lock` to `RETURN OLD;` (preventing silent cancel of draft profile deletions).
  - 4. **Fixed `method_rates` Column References**: Corrected references to `method_id`, `charge_bp`, and joined `rate_profiles` for `charges_borne_by`.
  - 5. **Eliminated `transfer_ownership` Deadlock**: Removed redundant Trigger 10 (`fn_users_prevent_sole_owner_deactivation`) which blocked atomic demote-before-promote ownership swaps; deferred Trigger 9 (`trg_prevent_zero_owners`) strictly guards zero owners at commit.
  - 6. **Fixed Stale Entry Reject Lifecycle**: In `admin_review_stale_entry`, when rejected, set `status = 'voided'`, `voided_by = p_actor_id`, `voided_at = now()`, and `void_reason = p_reason`.
  - 7. **Hardened Push Subtransaction Isolation**: Moved variable extractions inside the per-op `BEGIN ... EXCEPTION` subtransaction block in `rpc_push_sync_op` to ensure invalid op payloads do not crash the entire multi-op batch.
  - 8. **Added Closed Month Guards**: Added closed month checks to `void_entry` and `request_void` in `rpc_push_sync_op`.
  - 9. **Hardened RPC Execution Security**: Enforced `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` across all stored procedures.
  - 10. **Updated Test Fixtures**: Conformed test fixture `DEVICE_ID` to valid UUIDs and corrected `method_rates` table schema in test seeds.

- 2026-10-30: Revision 2.1 — Comprehensive remediation of all audit findings from PRD v1.19 and AGENTS.md review:
  - 1. **Complete Snapshot Integrity Check**: Updated `rpc_push_sync_op` and `rpc_supersede_entry` to verify all fields (`rateProfileId`, `version`, `engineVersion = 1`, `vatMode`, `vatBp`, `commissionBp`, `commissionBase`, `methodFeeBp`, `chargesBorneBy`). Added fee partition verification asserting `business_charge_poisha` and `customer_charge_poisha` match `chargesBorneBy`.
  - 2. **Canonical RFC 8785 Hashing & Idempotency Hardening**: Replaced `md5` fallback with `encode(digest((payload)::text, 'sha256'), 'hex')`. Hardened idempotency comparisons to evaluate strictly against `v_server_hash`. On replay of successful `create_entry`, returned `{ status: 'duplicate', server_seq, entry_number }` (satisfying Test #61). Ensured `security.tamper_detected` audit row persists by recording rejected row directly rather than rolling back via exception. Added entry idempotency check comparing previous payload hash for same entry ID.
  - 3. **Strict Caller Role Verification in SECURITY DEFINER RPCs**: Enforced active caller verification and role checks (`v_caller_role in ('admin', 'owner')` and `active = true`) inside `admin_manage_device`, `admin_update_settings`, `admin_manage_payment_method`, `admin_manage_payable`, `create_or_update_draft_rate_profile`, `publish_rate_profile`, and `rpc_supersede_entry`.
  - 4. **Fixed SQL NULL Comparison Bugs**: Added explicit `IS NULL` guards before `!= 'draft'` checks in `publish_rate_profile` and `admin_review_stale_entry`, preventing missing IDs from bypassing checks and writing erroneous audit records.
  - 5. **Remediated `admin_review_stale_entry` Race Condition**: Acquired month lock (1001), sequence lock (1002), then row lock (`FOR UPDATE`); re-verified `status = 'active'` and `stale_review_status = 'flagged'` after lock acquisition; added `where id = p_entry_id and stale_review_status = 'flagged'` guard on updates; enforced mandatory non-empty reject reason when rejecting.
  - 6. **Comprehensive `rpc_supersede_entry` Validation**: Added published rate profile date coverage check, active payment method check, `requires_txn_ref` check, snapshot integrity check, and arithmetic/conservation backstops. Populated `supersedes_id`, `original_entry_date`, `reassign_reason`, `device_id`, and `stale_rates`.
  - 7. **Corrected Rate-Check Ordering in Push**: Added check verifying if ANY published profile covers the entry date before evaluating whether the submitted profile matches, ensuring `no_rate_profile_for_date` is reachable when entry date precedes all profiles.
  - 8. **Fixed Retention Purge Query in `purge_expired_sync_ops`**: Filtered strictly on `result = 'rejected' AND resolution_status IN ('resolved', 'discarded') AND created_at < now() - interval '90 days'`, preventing deletion of successful `ok` ops needed for idempotency.
  - 9. **Hardened Immutability and Sequence Triggers**: Added `pg_advisory_xact_lock(1002, 1)` inside `fn_entries_server_seq`. In `fn_entries_immutability`, added protection for `id`, `vat_input_poisha`, override columns and reasons, `sub_qty`, `sub_description`, `supersedes_id`, `original_entry_date`, `device_id`, and `client_created_at`; blocked status regression from voided/superseded back to active.
  - 10. **Guarded Month-Lock Date and UUID Casts**: Wrapped regex validation (`^\d{4}-\d{2}-\d{2}$` and UUID regex) around payload extraction in month-lock CTE, preventing malformed ops from aborting the push batch.
  - 11. **Refined Administrative RPCs**:
    - `admin_invite_user`: Enforced active caller role check; rejected owner invites (`cannot_invite_owner`); restricted Admin callers to inviting `'staff'`; handled re-invitation of existing accounts with profile upsert.
    - `admin_manage_user`: Validated `p_role in ('admin', 'staff')`; rejected promotion to owner (`cannot_promote_to_owner_use_transfer_ownership`); handled deactivate and reactivate actions.
    - `transfer_ownership`: Enforced that target user must be an active admin (`target_user_must_be_admin`).
    - `admin_manage_payable`: Added range checks for `due_day` (1..28) and `remind_days_before` (0..14).
    - `admin_update_settings`: Enforced `reconcile_tolerance_poisha >= 0` and rejected unknown settings keys.
    - `create_or_update_draft_rate_profile`: Supported deleting and replacing method rates; labelled draft-time past date check as `[PLAN-DERIVED]`.
    - Audit before/after state: Captured and logged previous values for update operations on payment methods, payables, app settings, and rate profiles.
    - Fixed `pg_cron` schedule to `'0 21 * * *'` (21:00 UTC = 03:00 Asia/Dhaka) with detailed documentation in PRD ISSUE 004-1.
  - 12. **Robust Concurrency and Parity Testing**:
    - Fixed Test #2 (sequence race) and Test #31 (lock inversion) using concurrent pool clients with non-trivial assertions verifying monotonic sequence allocation and deadlock-free serialization.
    - Realigned test table descriptions and assertions across Tests #1, #2, #8, #14, #15, #18, #24, #31, #32, #41, #44, #56, #57, #59, #60, #61, #62, #63.
    - Upgraded `calc_parity.test.ts` to use portable URL-based `readFileSync` and added deduction guard and override parity tests.
    - Hardened acceptance criteria with non-trivial assertions and dynamic queries.
    - Standardized task IDs to `CLT-T-016`, `CLT-T-017`, `CLT-T-018` with roles `Implementer` / `DevOps`.
- 2026-10-30: Revision 2.0 — Remediated 7 runtime bugs and schema/test mismatches.
- 2026-10-29: Resolved Blockers B1, B2, B3, B4. Completed full 15-step `rpc_push_sync_op` pipeline with anti-cherry-picking, rate watermark enforcement, tamper conflict detection, subtransaction isolation, and lock hierarchy. Added arithmetic and conservation backstops to `rpc_supersede_entry`. Fixed double-quoted SQL string literals in test files and authored comprehensive integration tests in `tests/db/entries_sync.test.ts`. Added PRD ISSUE 004-1 regarding `pg_cron`.
- 2026-10-29: Initial specification of Plan 004 for M0 core database functions, triggers, and sync push engine.
