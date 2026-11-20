-- 023_super_admin_panel — step 18 (CLT-T-093) SA-CTR-08
--
-- Provisioning a centre copies a template of rates. `rpc_create_center` publishes its
-- day-zero baseline profile in the same transaction, so that v1 row is immutable the
-- moment provisioning returns: `trg_rate_profiles_draft_publish_lock` raises
-- `403 published_rate_profile_immutable` on any UPDATE of it and
-- `trg_method_rates_draft_publish_lock` raises `403 method_rates_published_profile_immutable`
-- for its method rates. `create_or_update_draft_rate_profile` is the sanctioned draft path
-- but resolves the actor through `profiles.center_id = p_center_id`, which the platform
-- seat (center_id NULL) can never satisfy.
--
-- Cloning therefore appends a version instead of rewriting one: it copies the source
-- centre's latest published parameters onto a new draft for the target, copies one rate
-- per active target method, and publishes that draft through `publish_rate_profile` —
-- the routine `20261116000012_platform_actor_overrides.sql` already admitted the seat to.
-- The target's v1 stays published and untouched; the clone becomes v2 from today.
--
-- service_role only; the calling actor must be a platform super_admin.

create or replace function rpc_clone_center_rates(
  p_actor_id uuid,
  p_target_center_id uuid,
  p_source_center_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role user_role;
  v_target_center_number int;
  v_source_profile_id uuid;
  v_source_vat_mode text;
  v_source_vat_bp int;
  v_source_commission_base text;
  v_source_commission_bp int;
  v_source_charges_borne_by text;
  v_version int;
  v_draft_id uuid;
  v_method record;
  v_source_method_id uuid;
  v_charge_bp int;
begin
  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  perform set_config('clt.current_center_id', p_target_center_id::text, true);

  -- 1. Only the platform seat may clone. A centre profile still wins when the actor
  -- holds one, exactly as the step-13 overrides resolve their actor.
  select role into v_actor_role
  from profiles
  where id = p_actor_id
    and (center_id = p_target_center_id or center_id is null)
    and active = true
  order by center_id nulls last
  limit 1;

  if v_actor_role is distinct from 'super_admin' then
    raise exception '403 unauthorized';
  end if;

  -- 2. Both centres must exist.
  select center_number into v_target_center_number from centers where id = p_target_center_id;
  if v_target_center_number is null then
    raise exception '422 center_not_found';
  end if;

  if not exists (select 1 from centers where id = p_source_center_id) then
    raise exception '422 center_not_found';
  end if;

  -- 3. The source centre's latest published profile is the template.
  select id, vat_mode, vat_bp, commission_base, commission_bp, charges_borne_by
  into v_source_profile_id, v_source_vat_mode, v_source_vat_bp,
       v_source_commission_base, v_source_commission_bp, v_source_charges_borne_by
  from rate_profiles
  where center_id = p_source_center_id and status = 'published'
  order by version desc
  limit 1;

  if v_source_profile_id is null then
    raise exception '422 source_rate_profile_not_found';
  end if;

  -- 4. Rate-version lock on the target (Class 1003), the same key publish_rate_profile
  -- takes on this centre.
  perform pg_advisory_xact_lock((1003 << 16) | (v_target_center_number & 65535), 1);

  -- 5. The new draft. Effective today in Asia/Dhaka: publish_rate_profile refuses a
  -- backdated profile, and the clone is meant to apply from the day it is made.
  select coalesce(max(version), 0) + 1 into v_version
  from rate_profiles where center_id = p_target_center_id;

  insert into rate_profiles (
    center_id, version, status, effective_from, vat_mode, vat_bp,
    commission_base, commission_bp, charges_borne_by, note, created_by
  ) values (
    p_target_center_id, v_version, 'draft', (now() at time zone 'Asia/Dhaka')::date,
    v_source_vat_mode, v_source_vat_bp, v_source_commission_base,
    v_source_commission_bp, v_source_charges_borne_by,
    'Cloned from center ' || p_source_center_id::text, p_actor_id
  )
  returning id into v_draft_id;

  -- 6. One rate per active target method, matched to the source by code. A method the
  -- target has and the source does not is written at 0 bp, so publish_rate_profile's
  -- coverage check is satisfied by the target's own method list.
  for v_method in
    select id, code
    from payment_methods
    where center_id = p_target_center_id and active = true
    order by sort_order, id
  loop
    v_source_method_id := null;
    v_charge_bp := 0;

    select pm.id into v_source_method_id
    from payment_methods pm
    where pm.center_id = p_source_center_id and pm.code = v_method.code;

    if v_source_method_id is not null then
      select mr.charge_bp into v_charge_bp
      from method_rates mr
      where mr.center_id = p_source_center_id
        and mr.rate_profile_id = v_source_profile_id
        and mr.method_id = v_source_method_id;
      v_charge_bp := coalesce(v_charge_bp, 0);
    end if;

    insert into method_rates (center_id, rate_profile_id, method_id, charge_bp)
    values (p_target_center_id, v_draft_id, v_method.id, v_charge_bp);
  end loop;

  -- 7. Publish the draft atomically; the seat is already admitted to this routine.
  perform publish_rate_profile(p_target_center_id, v_draft_id, p_actor_id);

  perform log_audit_event(
    p_target_center_id, p_actor_id, 'rate_profile.clone', 'rate_profiles', v_draft_id::text,
    null,
    jsonb_build_object(
      'source_center_id', p_source_center_id,
      'source_profile_id', v_source_profile_id,
      'cloned_profile_id', v_draft_id
    )
  );

  return v_draft_id;
end;
$$;

revoke all on function rpc_clone_center_rates(uuid, uuid, uuid) from public;
revoke all on function rpc_clone_center_rates(uuid, uuid, uuid) from anon;
revoke all on function rpc_clone_center_rates(uuid, uuid, uuid) from authenticated;
grant execute on function rpc_clone_center_rates(uuid, uuid, uuid) to service_role;

comment on function rpc_clone_center_rates(uuid, uuid, uuid) is
  'Clones one centre''s latest published rate profile onto a new centre: a fresh draft version with the source parameters and one rate per active target payment method, published atomically through publish_rate_profile and audited as rate_profile.clone. Requires a super_admin actor. service_role only.';
