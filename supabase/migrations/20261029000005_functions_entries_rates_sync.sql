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
-- SECURITY DEFINER: provisioning the profile happens as postgres with a pinned
-- search_path, per this file's standard function hardening (see CLT-D-009 note).
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

  insert into public.profiles (id, full_name, role, active)
  values (NEW.id, v_full_name, v_role, true)
  on conflict (id) do update
  set role = EXCLUDED.role,
      full_name = coalesce(profiles.full_name, EXCLUDED.full_name),
      updated_at = now();

  return NEW;
end;
$$;

-- The GoTrue DB role must be able to run this provisioning trigger.
-- (Revocation policy grants EXECUTE to service_role only; supabase_auth_admin
-- additionally gets this single function — CLT-D-009.)
grant execute on function fn_auth_users_create_profile() to supabase_auth_admin;

create trigger trg_auth_users_create_profile
after insert on auth.users
for each row execute function fn_auth_users_create_profile();

-- 7b. Trigger: Role Re-derivation on App Metadata Update (C1, CLT-D-009)
-- GoTrue persists raw_app_meta_data in a later UPDATE, not at row insert, so a
-- provisioned profile starts 'staff' even for the bootstrap owner payload. Role
-- is derived strictly from raw_app_meta_data (admin-managed; users cannot modify
-- it), so re-deriving on update is the faithful model. Absence/invalidity of a
-- role key must NOT demote (GoTrue writes provider-only metadata on OAuth flows).
create or replace function fn_auth_users_sync_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claimed text;
begin
  v_claimed := NEW.raw_app_meta_data->>'role';
  if v_claimed in ('admin', 'staff', 'owner') then
    update public.profiles p
    set role = v_claimed::user_role, updated_at = now()
    where p.id = NEW.id and p.role is distinct from v_claimed::user_role;
  end if;
  return NEW;
end;
$$;

create trigger trg_auth_users_sync_profile_role
after update of raw_app_meta_data, raw_user_meta_data on auth.users
for each row execute function fn_auth_users_sync_profile_role();

-- The GoTrue DB role must be able to run both provisioning triggers.
grant execute on function fn_auth_users_sync_profile_role() to supabase_auth_admin;

-- 9. Trigger: Deferrable Constraint Invariant: Minimum 1 Owner (F11, F15)
-- Evaluated deferred at commit time, supporting atomic demote-before-promote in transfer_ownership
create or replace function fn_prevent_zero_owners()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Invariant: no mutation may REMOVE the last active owner. Pure INSERTs
  -- cannot remove anything (and GoTrue provisions an auth user's profile row
  -- as 'staff' before app metadata is applied, so an insert-time count would
  -- falsely trap day-zero provisioning); role changes on UPDATE and DELETE
  -- are the only paths that can eliminate an owner (CLT-D-009).
  declare
    v_owner_count int;
  begin
    if TG_OP = 'UPDATE' then
      if OLD.role = 'owner' and OLD.active is true
         and not (NEW.role = 'owner' and NEW.active is true) then
        select count(*) into v_owner_count
        from public.profiles where role = 'owner' and active = true;
        if v_owner_count < 1 then
          raise exception '422 exactly_one_owner_required';
        end if;
      end if;
    elsif TG_OP = 'DELETE' then
      select count(*) into v_owner_count
      from public.profiles where role = 'owner' and active = true;
      if v_owner_count < 1 then
        raise exception '422 exactly_one_owner_required';
      end if;
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
    coalesce(p_rate_version, 0), -- columns are NOT NULL DEFAULT 0; explicit null must not bypass the default
    now()
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

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
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
  v_entry_month date;
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

  perform set_config('clt.audit_actor', coalesce(p_caller_id::text, '')::text, true);
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
      -- digest() lives in Supabase's 'extensions' schema; the pinned search_path
      -- (public, pg_temp) cannot resolve the unqualified name, so qualify it.
      v_server_hash := coalesce(v_op->>'serverHash', encode(extensions.digest((v_op->'payload')::text, 'sha256'), 'hex'));

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
    -- cron.unschedule raises 'could not find valid entry for job' when the job
    -- does not exist yet (clean database). Only unschedule when present.
    if exists (select 1 from cron.job where jobname = 'sync-op-retention') then
      perform cron.unschedule('sync-op-retention');
    end if;
    perform cron.schedule('sync-op-retention', '0 21 * * *', 'SELECT purge_expired_sync_ops();');
  end if;
end $$;

-- 27. Security Privilege Revocations (Hard Rule 7, Gate 1, Test #22)
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
