-- Migration: 20261029000008_super_admin_fleet.sql
-- Plan 023 step 15 — fleet operations for the Platform Super-Admin.
--
-- `admin_manage_user` and `admin_manage_device` were written for a center caller: each
-- looks the actor up with `center_id = p_center_id`, so the seat (center_id NULL) was
-- refused with `403 unauthorized`. The cross-center screens step 15 adds would therefore
-- have offered actions the API refuses, which is the failure the panel is meant to
-- remove. Both routines now accept an active, platform-wide `super_admin` actor as an
-- additional caller class; nothing else about them changes, and the center caller's
-- rules are untouched.
--
-- The seat also gains `force_signout`, which revokes the target's refresh sessions. Like
-- every other state change here it writes its audit row in the same transaction; the
-- server route revokes the tokens themselves through the privileged pool, because GoTrue
-- sessions are not reachable from SQL-invoked app code.

-- 1. admin_manage_user — add the platform actor and the force_signout action
create or replace function admin_manage_user(
  p_center_id uuid,
  p_action text,
  p_user_id uuid,
  p_role text,
  p_active boolean,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_caller_center uuid;
  v_target_role user_role;
  v_target_active boolean;
begin
  select role, active, center_id into v_caller_role, v_caller_active, v_caller_center
  from profiles where id = p_actor_id;

  -- Two caller classes: a platform super_admin (center_id NULL) acting on any center, or
  -- an active admin/owner acting inside the center it belongs to.
  if v_caller_active is not true then
    raise exception '403 unauthorized';
  end if;
  if v_caller_role = 'super_admin' then
    if v_caller_center is not null then
      raise exception '403 unauthorized';
    end if;
  elsif v_caller_role is null or v_caller_role not in ('admin', 'owner') or v_caller_center is distinct from p_center_id then
    raise exception '403 unauthorized';
  end if;

  select role, active into v_target_role, v_target_active
  from profiles where id = p_user_id and center_id = p_center_id;
  if v_target_role is null then
    raise exception '404 user_not_found';
  end if;

  -- A center admin cannot touch another admin or the owner. The seat may, because its
  -- remit is the fleet; the one-owner index and trg_prevent_zero_owners still protect the
  -- last owner of a center.
  if v_caller_role = 'admin' and v_target_role in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_action = 'update_role' then
    if v_caller_role != 'owner' and v_caller_role != 'super_admin' then
      raise exception '403 unauthorized';
    end if;
    if p_role = 'owner' then
      raise exception '400 cannot_promote_to_owner_use_transfer_ownership';
    end if;
    if p_role not in ('admin', 'staff') then
      raise exception '400 invalid_role';
    end if;

    update profiles set role = p_role::user_role, updated_at = now()
    where id = p_user_id and center_id = p_center_id;

    perform log_audit_event(
      p_center_id, p_actor_id, 'user.role_change', 'profiles', p_user_id::text,
      jsonb_build_object('role', v_target_role, 'actor_role', v_caller_role),
      jsonb_build_object('role', p_role)
    );
  elsif p_action = 'deactivate' then
    update profiles set active = false, updated_at = now()
    where id = p_user_id and center_id = p_center_id;

    perform log_audit_event(
      p_center_id, p_actor_id, 'user.deactivate', 'profiles', p_user_id::text,
      jsonb_build_object('active', true, 'actor_role', v_caller_role),
      jsonb_build_object('active', false)
    );
  elsif p_action = 'reactivate' then
    update profiles set active = true, updated_at = now()
    where id = p_user_id and center_id = p_center_id;

    perform log_audit_event(
      p_center_id, p_actor_id, 'user.reactivate', 'profiles', p_user_id::text,
      jsonb_build_object('active', false, 'actor_role', v_caller_role),
      jsonb_build_object('active', true)
    );
  elsif p_action = 'force_signout' then
    -- The route revokes the refresh tokens; this row records who ordered it, so an
    -- operator action on a franchisee's session is auditable even if the token revoke
    -- fails afterwards.
    perform log_audit_event(
      p_center_id, p_actor_id, 'user.force_signout', 'profiles', p_user_id::text,
      jsonb_build_object('active', v_target_active, 'actor_role', v_caller_role),
      jsonb_build_object('sessions_revoked', true)
    );
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

-- 2. admin_manage_device — add the platform actor
create or replace function admin_manage_device(
  p_center_id uuid,
  p_device_id text,
  p_action text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_caller_center uuid;
  v_old_revoked boolean;
begin
  select role, active, center_id into v_caller_role, v_caller_active, v_caller_center
  from profiles where id = p_actor_id;

  if v_caller_active is not true then
    raise exception '403 unauthorized';
  end if;
  if v_caller_role = 'super_admin' then
    if v_caller_center is not null then
      raise exception '403 unauthorized';
    end if;
  elsif v_caller_role is null or v_caller_role not in ('admin', 'owner') or v_caller_center is distinct from p_center_id then
    raise exception '403 unauthorized';
  end if;

  select revoked into v_old_revoked
  from devices where center_id = p_center_id and device_id = p_device_id limit 1;
  if v_old_revoked is null then
    raise exception '404 device_not_found';
  end if;

  if p_action = 'revoke' then
    update devices set revoked = true where center_id = p_center_id and device_id = p_device_id;
    perform log_audit_event(
      p_center_id, p_actor_id, 'device.revoke', 'devices', p_device_id,
      jsonb_build_object('revoked', v_old_revoked, 'actor_role', v_caller_role),
      jsonb_build_object('revoked', true, 'reason', 'admin_killswitch')
    );
  elsif p_action = 'unrevoke' then
    update devices set revoked = false where center_id = p_center_id and device_id = p_device_id;
    perform log_audit_event(
      p_center_id, p_actor_id, 'device.unrevoke', 'devices', p_device_id,
      jsonb_build_object('revoked', v_old_revoked, 'actor_role', v_caller_role),
      jsonb_build_object('revoked', false)
    );
  else
    raise exception '400 invalid_action';
  end if;
end;
$$;

comment on function admin_manage_user(uuid, text, uuid, text, boolean, uuid) is
  'Plan 023 step 15: an active center admin/owner may manage its own center''s users; an active platform super_admin (center_id NULL) may manage any center''s users, including force_signout. service_role only.';
comment on function admin_manage_device(uuid, text, text, uuid) is
  'Plan 023 step 15: an active center admin/owner may revoke its own center''s devices; an active platform super_admin may revoke any center''s devices. service_role only.';
