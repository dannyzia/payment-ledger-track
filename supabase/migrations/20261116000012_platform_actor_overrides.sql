-- 023_super_admin_panel — step 13 (CLT-PLAN-023)
--
-- The seat performs owner-level actions on a centre's behalf: reopening a closed month,
-- approving an overpayment, reviewing a reconciliation exception, and publishing a rate
-- profile. Each routine already existed and each resolved the actor through a *centre*
-- profile row (`profiles.center_id = p_center_id`); the platform seat holds
-- `center_id IS NULL`, so it could never satisfy that lookup and every call answered
-- `403 unauthorized` before it reached the work.
--
-- The only change in each body is the actor lookup and the role list it feeds. A centre
-- profile still wins when the actor has one; the platform row is the fallback, and the
-- role list gains `super_admin`. Nothing else moved: same locks, same audit events, same
-- arithmetic. The bodies are copied verbatim from
-- 20261029000006_functions_settlement_recon_month.sql and
-- 20261029000005_functions_entries_rates_sync.sql.
--
-- Re-issuing a function is how the seat's void was lost before (20261114000008
-- re-created rpc_push_sync_op and dropped the allowances 0009 added), so
-- tests/db/migration_redefinitions.test.ts registers these four and asserts the
-- surviving body keeps the seat.

create or replace function reopen_month(
  p_center_id uuid,
  p_month date,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_center_number int;
  v_month date := date_trunc('month', p_month)::date;
begin
  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  perform set_config('clt.current_center_id', p_center_id::text, true);

  select center_number into v_center_number from centers where id = p_center_id;
  if v_center_number is null then
    raise exception '422 center_not_found';
  end if;

  -- Plan 023 step 13: the platform seat holds no centre profile, so its role is read
  -- from the platform row. A centre profile still wins when both exist.
  select role into v_caller_role
  from profiles
  where id = p_actor_id
    and (center_id = p_center_id or center_id is null)
    and active = true
  order by center_id nulls last
  limit 1;
  if v_caller_role is null or v_caller_role not in ('owner', 'super_admin') then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if not exists (
    select 1 from month_closes
    where center_id = p_center_id and month = v_month and status = 'closed'
  ) then
    raise exception '422 month_not_closed';
  end if;

  update month_closes
  set status = 'open',
      reopened_by = p_actor_id,
      reopened_at = now(),
      reopen_reason = p_reason,
      updated_at = now()
  where center_id = p_center_id and month = v_month;

  update statements set status = 'open', updated_at = now()
  where center_id = p_center_id and month = v_month and status = 'reconciled';

  update statement_payables set status = 'open'
  where center_id = p_center_id and month = v_month and status = 'reconciled';

  insert into month_close_events (center_id, month, action, actor, reason)
  values (p_center_id, v_month, 'reopen', p_actor_id, p_reason);

  perform log_audit_event(
    p_center_id, p_actor_id, 'month.reopen', 'month_closes', v_month::text,
    jsonb_build_object('status', 'closed'), jsonb_build_object('status', 'open', 'reason', p_reason)
  );
end;
$$;

create or replace function approve_settlement_overpayment(
  p_center_id uuid,
  p_settlement_id uuid,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_center_number int;
  v_month date;
  v_payable_id uuid;
  v_settlement record;
  v_current_surplus bigint;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  perform set_config('clt.current_center_id', p_center_id::text, true);

  select center_number into v_center_number from centers where id = p_center_id;
  if v_center_number is null then
    raise exception '422 center_not_found';
  end if;


  -- Plan 023 step 13: the platform seat holds no centre profile, so its role is read
  -- from the platform row. A centre profile still wins when both exist.
  select role into v_caller_role
  from profiles
  where id = p_actor_id
    and (center_id = p_center_id or center_id is null)
    and active = true
  order by center_id nulls last
  limit 1;
  if v_caller_role is null or v_caller_role not in ('owner', 'super_admin') then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  select s.month, s.payable_id into v_month, v_payable_id
  from settlements s where s.id = p_settlement_id and s.center_id = p_center_id;

  if v_month is null then
    raise exception '422 settlement_not_found';
  end if;

  v_month := date_trunc('month', v_month)::date;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where center_id = p_center_id and month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Row Locks: payables (KEY SHARE) -> settlements (FOR UPDATE)
  perform id from payables where id = v_payable_id and center_id = p_center_id for key share;
  select * into v_settlement
  from settlements where id = p_settlement_id and center_id = p_center_id for update;

  if v_settlement.status != 'overpaid' or v_settlement.paid_poisha <= v_settlement.expected_poisha then
    raise exception '422 settlement_not_overpaid';
  end if;

  v_current_surplus := v_settlement.paid_poisha - v_settlement.expected_poisha;

  update settlements
  set overpayment_review_status = 'approved',
      overpayment_approved_amount_poisha = v_current_surplus,
      overpayment_reason = p_reason,
      overpayment_approved_by = p_actor_id,
      overpayment_approved_at = now(),
      updated_at = now()
  where id = p_settlement_id and center_id = p_center_id;

  perform log_audit_event(
    p_center_id, p_actor_id, 'settlement.overpayment_approved', 'settlements', p_settlement_id::text,
    jsonb_build_object('overpayment_status', v_settlement.overpayment_review_status),
    jsonb_build_object('overpayment_status', 'approved', 'approved_amount', v_current_surplus, 'reason', p_reason)
  );
end;
$$;

create or replace function review_entry_reconciliation_exception(
  p_center_id uuid,
  p_entry_id uuid,
  p_payable_id uuid,
  p_action text,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_center_number int;
  v_month date;
  v_entry_status entry_status;
  v_entry_method_id uuid;
  v_payable_kind text;
  v_payable_method_id uuid;
  v_exception_id uuid;
begin
  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  perform set_config('clt.current_center_id', p_center_id::text, true);

  select center_number into v_center_number from centers where id = p_center_id;
  if v_center_number is null then
    raise exception '422 center_not_found';
  end if;

  -- Plan 023 step 13: the platform seat holds no centre profile, so its role is read
  -- from the platform row. A centre profile still wins when both exist.
  select role into v_caller_role
  from profiles
  where id = p_actor_id
    and (center_id = p_center_id or center_id is null)
    and active = true
  order by center_id nulls last
  limit 1;
  if v_caller_role is null or v_caller_role not in ('admin', 'owner', 'super_admin') then
    raise exception '403 unauthorized';
  end if;

  if p_action not in ('approved', 'rejected') then
    raise exception '422 invalid_action';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  select date_trunc('month', entry_date)::date into v_month
  from entries where id = p_entry_id and center_id = p_center_id;
  if v_month is null then
    raise exception '422 entry_not_found';
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where center_id = p_center_id and month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Sequence Advisory Lock (Class 1002) before row locks
  perform pg_advisory_xact_lock((1002 << 16) | (v_center_number & 65535), 1);

  -- 3. Row Locks in Order: payables (KEY SHARE) -> entries (FOR UPDATE) -> entry_reconciliation_exceptions
  select kind, method_id into v_payable_kind, v_payable_method_id
  from payables where id = p_payable_id and center_id = p_center_id for key share;
  if v_payable_kind is null then
    raise exception '422 payable_not_found';
  end if;

  select status, method_id into v_entry_status, v_entry_method_id
  from entries where id = p_entry_id and center_id = p_center_id for update;
  if v_entry_status != 'active' then
    raise exception '422 cannot_except_non_active_entry';
  end if;

  -- Assert payable applicability
  if not (
    (v_payable_kind = 'vat')
    or (v_payable_kind = 'method_charge' and v_payable_method_id = v_entry_method_id)
  ) then
    raise exception '422 payable_not_applicable_to_entry';
  end if;

  insert into entry_reconciliation_exceptions (
    center_id, entry_id, payable_id, month, status, reason, reviewed_by, reviewed_at, updated_at
  ) values (
    p_center_id, p_entry_id, p_payable_id, v_month, p_action, p_reason, p_actor_id, now(), now()
  )
  on conflict (center_id, entry_id, payable_id, month) do update
  set status = p_action,
      reason = p_reason,
      reviewed_by = p_actor_id,
      reviewed_at = now(),
      updated_at = now()
  returning id into v_exception_id;

  perform log_audit_event(
    p_center_id, p_actor_id, 'entry.reconciliation_exception', 'entry_reconciliation_exceptions',
    v_exception_id::text,
    null,
    jsonb_build_object(
      'action', p_action, 'reason', p_reason,
      'entry_id', p_entry_id, 'payable_id', p_payable_id, 'month', v_month
    )
  );
end;
$$;

create or replace function publish_rate_profile(
  p_center_id uuid,
  p_profile_id uuid,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_caller_active boolean;
  v_center_number int;
  v_status text;
  v_effective_from date;
  v_vat_bp int;
  v_comm_bp int;
  v_max_charge_bp int;
  v_uncovered_method text;
  v_next_version int;
begin
  -- Plan 023 step 13: the platform seat holds no centre profile, so its role is read
  -- from the platform row. A centre profile still wins when both exist.
  select role, active into v_caller_role, v_caller_active
  from profiles
  where id = p_actor_id
    and (center_id = p_center_id or center_id is null)
  order by center_id nulls last
  limit 1;
  if v_caller_role is null or v_caller_active is not true
     or v_caller_role not in ('admin', 'owner', 'super_admin') then
    raise exception '403 unauthorized';
  end if;

  select center_number into v_center_number from centers where id = p_center_id;
  if v_center_number is null then
    raise exception '422 center_not_found';
  end if;

  -- Advisory lock on this center's rate profile versions
  perform pg_advisory_xact_lock((1003 << 16) | (v_center_number & 65535), 1);

  select status, effective_from, vat_bp, commission_bp
  into v_status, v_effective_from, v_vat_bp, v_comm_bp
  from rate_profiles where id = p_profile_id and center_id = p_center_id;

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
  select max(charge_bp) into v_max_charge_bp
  from method_rates where rate_profile_id = p_profile_id and center_id = p_center_id;
  if (v_vat_bp + v_comm_bp + coalesce(v_max_charge_bp, 0)) > 10000 then
    raise exception '422 deductions_exceed_100_percent';
  end if;

  -- Coverage check: must cover all active payment methods of this center
  select pm.code into v_uncovered_method
  from payment_methods pm
  where pm.center_id = p_center_id
    and pm.active = true
    and not exists (
      select 1 from method_rates mr
      where mr.rate_profile_id = p_profile_id
        and mr.center_id = p_center_id
        and mr.method_id = pm.id
    )
  limit 1;

  if v_uncovered_method is not null then
    raise exception '422 method_not_covered_in_published_profile';
  end if;

  -- Assign next sequential published version for this center
  select coalesce(max(version), 0) + 1 into v_next_version
  from rate_profiles where center_id = p_center_id and status = 'published';

  update rate_profiles
  set status = 'published',
      version = v_next_version,
      published_at = now()
  where id = p_profile_id and center_id = p_center_id and status = 'draft';

  perform log_audit_event(
    p_center_id, p_actor_id, 'rate_profile.publish', 'rate_profiles', p_profile_id::text,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'published', 'version', v_next_version, 'effective_from', v_effective_from)
  );
end;
$$;

revoke all on function reopen_month(uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function approve_settlement_overpayment(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function review_entry_reconciliation_exception(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function publish_rate_profile(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function reopen_month(uuid, date, text, uuid) to service_role;
grant execute on function approve_settlement_overpayment(uuid, uuid, text, uuid) to service_role;
grant execute on function review_entry_reconciliation_exception(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function publish_rate_profile(uuid, uuid, uuid) to service_role;
