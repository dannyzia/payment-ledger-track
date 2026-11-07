-- Fix: same-month supersede always failed with chk_reassign.
--
-- rpc_supersede_entry wrote the original entry's date into original_entry_date
-- unconditionally, while chk_reassign requires a non-empty reassign_reason and a
-- date different from entry_date whenever that column is set. Every supersede
-- that kept the original date (the normal correction path) therefore aborted with
-- `violates check constraint "chk_reassign"`. PRD §7.3 only stores the original
-- date when the client sends one for a closed-month reassignment.
--
-- PRD: §7.3, §7.1 chk_reassign
-- Task: CLT-T-058

-- rpc_supersede_entry, same body as migration 05 with the reassignment fix below.
-- PRD §7.3, Finding 2, Finding 3, Item 3.4, Finding #8 (chk_reassign).
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
  v_orig_entry_date date;
  v_reassign_reason text;
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

  -- A plain supersede is a correction, not a closed-month reassignment: chk_reassign
  -- demands a reason and a different date whenever original_entry_date is set, so
  -- only a reassignment (PRD §7.3 / Finding #8) carries the original date.
  v_reassign_reason := nullif(trim(coalesce(p_new_entry->>'reassignReason', '')), '');
  if v_reassign_reason is not null then
    v_orig_entry_date := coalesce((p_new_entry->>'originalEntryDate')::date, v_orig_date);
    if v_orig_entry_date = v_new_date then
      raise exception '422 invalid_reassign_date';
    end if;
  else
    v_orig_entry_date := null;
  end if;

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
    p_original_id, v_orig_entry_date, v_reassign_reason
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
