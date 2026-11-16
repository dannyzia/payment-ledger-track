-- 023_super_admin_panel — steps 3 and 4 (CLT-PLAN-023)
--
-- Step 3 (suspension enforcement): fn_center_writable / fn_center_write_block_reason,
--   and a guard inside rpc_push_sync_op so a suspended or archived center accepts no
--   writes from any caller, including service_role routes.
-- Step 4 (retention pause): a suspended center's sync-op retention clock stops. The
--   clock restarts at reactivation, which is what keeps queued work from expiring
--   into a review queue the center's own admins cannot open (Goldfish blocker 4).
--
-- Deliberately NOT here: any purge of queued rows. Suspension preserves them.


-- 1. Suspension bookkeeping on centers.
alter table centers add column if not exists suspended_at timestamptz;
alter table centers add column if not exists retention_offset interval not null default '0';

comment on column centers.suspended_at is
  'When the center entered suspended or archived status; NULL while active.';
comment on column centers.retention_offset is
  'Total time spent withheld. Added to a sync op created_at so the 90-day retention clock pauses while the center is suspended (CLT-PLAN-023 step 4).';

create or replace function fn_centers_track_suspension()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'active' then
      if old.suspended_at is not null then
        new.retention_offset := old.retention_offset + (now() - old.suspended_at);
        new.suspended_at := null;
      end if;
    elsif old.suspended_at is null then
      new.suspended_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_centers_track_suspension on centers;
create trigger trg_centers_track_suspension
before update of status on centers
for each row execute function fn_centers_track_suspension();

-- Trigger functions are executable by default; Test #22 requires every routine in
-- schema public to be closed to PUBLIC, anon and authenticated.
revoke all on function fn_centers_track_suspension() from public, anon, authenticated;

-- 2. Write-path helpers.
create or replace function fn_center_writable(p_center_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.status = 'active' from centers c where c.id = p_center_id), false);
$$;

create or replace function fn_center_write_block_reason(p_center_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when c.id is null then 'center_not_found'
    when c.status = 'suspended' then 'center_suspended'
    when c.status = 'archived' then 'center_archived'
  end
  from centers c where c.id = p_center_id;
$$;

create or replace function fn_center_retention_offset(p_center_id uuid)
returns interval language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.retention_offset from centers c where c.id = p_center_id), interval '0');
$$;

revoke all on function fn_center_writable(uuid) from public, anon, authenticated;
revoke all on function fn_center_write_block_reason(uuid) from public, anon, authenticated;
revoke all on function fn_center_retention_offset(uuid) from public, anon, authenticated;
grant execute on function fn_center_writable(uuid) to service_role;
grant execute on function fn_center_write_block_reason(uuid) to service_role;
grant execute on function fn_center_retention_offset(uuid) to service_role;

-- 3. Retention sweep: never touch a withheld center's rows, and measure age with the
--    paused clock. The sweep's own job (global, p_center_id NULL) is respected.
create or replace function purge_expired_sync_ops(p_center_id uuid default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deleted bigint;
begin
  with deleted as (
    delete from sync_ops s
    where s.result = 'rejected'
      and s.resolution_status in ('resolved', 'discarded')
      and (p_center_id is null or s.center_id = p_center_id)
      and exists (select 1 from centers c where c.id = s.center_id and c.status = 'active')
      and s.created_at + fn_center_retention_offset(s.center_id) < now() - interval '90 days'
    returning s.op_id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

-- 4. rpc_push_sync_op, re-issued with the write guard and the paused retention clock.
--    Body otherwise identical to 20261029000005 (create or replace keeps its grants).
create or replace function rpc_push_sync_op(
  p_center_id uuid,
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
  v_existing_center uuid;
  v_existing_op_hash text;
  v_existing_result text;
  v_existing_reason text;
  v_existing_seq bigint;
  v_existing_num bigint;
  v_existing_creator uuid;
  v_orig_entry_hash text;
  v_device_revoked boolean := false;
  v_stale_threshold_poisha bigint := 5000000; -- 50,000 BDT
  v_center_number int;
  v_center_code text;
begin

  perform set_config('clt.audit_actor', coalesce(p_caller_id::text, '')::text, true);
  perform set_config('clt.current_center_id', p_center_id::text, true);

  select center_number, code into v_center_number, v_center_code
  from centers where id = p_center_id;
  if v_center_number is null then
    raise exception '422 center_not_found';
  end if;

  -- 023 §6.3: a suspended or archived center accepts no writes from anyone,
  -- the platform's own callers included. Checked before any lock is taken.
  if not fn_center_writable(p_center_id) then
    raise exception '403 %', fn_center_write_block_reason(p_center_id);
  end if;

  -- The caller must be an active member of the center it pushes into.
  if not exists (
    select 1 from profiles
    where id = p_caller_id and center_id = p_center_id and active = true
  ) then
    raise exception '403 unauthorized';
  end if;

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
      where e.center_id = p_center_id
    )
    select distinct m from extracted_months where m is not null order by m asc
  loop
    perform pg_advisory_xact_lock((1001 << 16) | (v_center_number & 65535), extract(year from v_m.m)::int * 12 + extract(month from v_m.m)::int);
  end loop;

  -- 2. Sequence Advisory Lock (PRD §7.2 Step 2)
  perform pg_advisory_xact_lock((1002 << 16) | (v_center_number & 65535), 1);

  -- 3. Device Presence Registration & Revocation Check (H3, M4)
  select exists (
    select 1 from devices where center_id = p_center_id and device_id = p_device_id and revoked = true
  ) into v_device_revoked;

  if not v_device_revoked then
    perform upsert_device_sync_state(p_center_id, p_device_id, p_caller_id, null);
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
      -- op_id is globally unique; a different center's op_id is rejected without
      -- reading or overwriting its row.
      select center_id, payload_hash, result, reason
      into v_existing_center, v_existing_op_hash, v_existing_result, v_existing_reason
      from sync_ops where op_id = v_op_id;

      if v_existing_center is not null and v_existing_center <> p_center_id then
        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'op_id_conflict_foreign_center');
        continue;
      end if;

      if v_existing_op_hash is not null then
        if v_existing_op_hash = v_server_hash then
          if v_existing_result = 'ok' then
            -- Fetch server_seq and entry_number if create_entry op
            select server_seq, entry_number into v_existing_seq, v_existing_num
            from entries
            where id = (select entry_id from sync_ops where op_id = v_op_id and center_id = p_center_id)
              and center_id = p_center_id;

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
            p_center_id, p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text,
            null,
            jsonb_build_object('op_id', v_op_id, 'error', 'op_id_conflict_tampered')
          );
          insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
          values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', 'op_id_conflict_tampered')
          on conflict (op_id) do update set reason = EXCLUDED.reason, result = 'rejected', resolution_status = 'pending';

          v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'op_id_conflict_tampered');
          continue;
        end if;
      end if;

      -- B. Transport Integrity Verification (Finding 8)
      if (v_op->>'payloadHash') is not null and (v_op->>'payloadHash') != v_server_hash then
        perform log_audit_event(
          p_center_id, p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text,
          null,
          jsonb_build_object('op_id', v_op_id, 'client_hash', v_op->>'payloadHash', 'server_hash', v_server_hash)
        );
        insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
        values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', 'payload_hash_mismatch');

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'payload_hash_mismatch');
        continue;
      end if;

      -- C. Clock Skew and Age Validations (PRD §9.1 Step 6d, 6e)
      if v_client_created_at > (now() + interval '5 minutes') then
        raise exception 'future_timestamp_skew';
      end if;

      if v_client_created_at + fn_center_retention_offset(p_center_id) < (now() - interval '90 days') then
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
          if exists (select 1 from month_closes where center_id = p_center_id and month = v_month and status = 'closed') then
            raise exception 'month_closed';
          end if;

          -- Rate Profile Watermark & Date Matching Order (Anti-Cherry-Picking)
          if v_op->>'maxKnownRateVersion' is null then
            raise exception 'missing_rate_watermark';
          end if;
          v_max_known_version := (v_op->>'maxKnownRateVersion')::int;
          v_rate_profile_id := (v_op->'payload'->>'rateProfileId')::uuid;

          -- Step 1: Check if ANY published profile covers the entry date in this center
          select exists (
            select 1 from rate_profiles
            where center_id = p_center_id and status = 'published' and effective_from <= v_entry_date
          ) into v_any_profile_for_date;

          if not v_any_profile_for_date then
            raise exception 'no_rate_profile_for_date';
          end if;

          -- Step 2: Verify submitted rate profile exists, is published, and is this center's
          select id, version, effective_from into v_sub_id, v_sub_ver, v_sub_eff
          from rate_profiles
          where id = v_rate_profile_id and center_id = p_center_id and status = 'published';

          if v_sub_id is null then
            raise exception 'rate_profile_not_found';
          end if;

          -- Step 3: Anti-Cherry-Picking Check: resolve highest applicable version known to client
          select id into v_exp_id
          from rate_profiles
          where center_id = p_center_id
            and status = 'published' and effective_from <= v_entry_date and version <= v_max_known_version
          order by effective_from desc, version desc limit 1;

          if v_sub_id != v_exp_id then
            raise exception 'rate_profile_date_mismatch';
          end if;

          -- Device Watermark Grounding (H3, H4)
          select last_rate_version, last_rate_version_at into v_dev_rate_ver, v_dev_rate_at
          from devices where center_id = p_center_id and device_id = p_device_id and user_id = p_caller_id;
          if v_dev_rate_ver is not null and v_max_known_version < v_dev_rate_ver and v_client_created_at > v_dev_rate_at then
            raise exception 'rate_profile_date_mismatch';
          end if;

          -- Check Stale Rates (> 50,000 BDT triggers review)
          select id into v_latest_published_id
          from rate_profiles
          where center_id = p_center_id
            and status = 'published' and effective_from <= (now() at time zone 'Asia/Dhaka')::date
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

          -- Payment Method Active & Reference Validation (scoped to the center)
          select active, requires_txn_ref into v_method_active, v_requires_txn_ref
          from payment_methods where id = v_method_id and center_id = p_center_id;
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
          from rate_profiles where id = v_rate_profile_id and center_id = p_center_id;

          select mr.charge_bp, rp.charges_borne_by into v_expected_charge_bp, v_expected_borne_by
          from method_rates mr
          join rate_profiles rp on rp.id = mr.rate_profile_id and rp.center_id = mr.center_id
          where mr.center_id = p_center_id
            and mr.rate_profile_id = v_rate_profile_id and mr.method_id = v_method_id;

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
          from entries where id = v_entry_id and center_id = p_center_id;
          if v_existing_seq is not null then
            if v_existing_creator = p_caller_id then
              -- Verify payload hash to ensure same creator didn't send altered payload
              select payload_hash into v_orig_entry_hash
              from sync_ops
              where entry_id = v_entry_id and center_id = p_center_id and op_type = 'create_entry' and result = 'ok';
              if v_orig_entry_hash is not null and v_orig_entry_hash != v_server_hash then
                perform log_audit_event(p_center_id, p_caller_id, 'security.tamper_detected', 'entries', v_entry_id::text, null, jsonb_build_object('error', 'entry_id_payload_tampered'));
                v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'entry_id_conflict_tampered');
                continue;
              else
                v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'duplicate', 'server_seq', v_existing_seq, 'entry_number', v_existing_num);
                continue;
              end if;
            else
              perform log_audit_event(p_center_id, p_caller_id, 'security.tamper_detected', 'entries', v_entry_id::text, null, jsonb_build_object('error', 'entry_id_creator_mismatch'));
              v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'entry_id_conflict_tampered');
              continue;
            end if;
          end if;

          -- Check duplicate reference among active entries of this center
          select exists (
            select 1 from entries
            where center_id = p_center_id
              and method_id = v_method_id and txn_ref = v_txn_ref and status = 'active'
          ) into v_dup_txn;

          -- Insert new entry
          insert into entries (
            id, center_id, entry_date, customer_name, sub_qty, sub_description, txn_ref,
            method_id, gross_poisha, rate_profile_id, snapshot,
            vat_input_poisha, vat_override_poisha, vat_override_reason,
            commission_override_poisha, commission_override_reason,
            vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
            customer_charge_poisha, net_poisha, notes, created_by,
            device_id, client_created_at, dup_txn_flag, stale_rates, stale_review_status
          ) values (
            v_entry_id, p_center_id, v_entry_date, v_op->'payload'->>'customerName',
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

          insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, supersedes_rejected_op_id, result, resolution_status)
          values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_entry_id, v_op->'payload', v_server_hash, v_client_created_at, (v_op->>'supersedesRejectedOpId')::uuid, 'ok', 'resolved');

          if (v_op->>'supersedesRejectedOpId') is not null then
            update sync_ops set resolution_status = 'resolved'
            where op_id = (v_op->>'supersedesRejectedOpId')::uuid and center_id = p_center_id;
          end if;

          perform log_audit_event(
            p_center_id, p_caller_id, 'entry.create', 'entries', v_entry_id::text,
            null,
            -- Design §6.7: record the actor's role at the write boundary instead of
            -- inventing a second audit action name for a platform write.
            jsonb_build_object('gross', v_gross, 'vat', v_vat, 'commission', v_comm, 'charge', v_charge, 'net', v_net, 'snapshot', v_snapshot, 'method_id', v_method_id, 'entry_date', v_entry_date, 'actor_role', p_caller_role)
          );

          v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');
        end;

      elsif v_op_type = 'supersede_entry' then
        if p_caller_role is null or p_caller_role not in ('admin', 'owner') then
          raise exception '403 unauthorized';
        end if;
        perform rpc_supersede_entry(
          p_center_id,
          (v_op->'payload'->>'originalEntryId')::uuid,
          v_op->'payload'->'replacement',
          p_caller_id
        );
        insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, supersedes_rejected_op_id, result, resolution_status)
        values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, (v_op->>'supersedesRejectedOpId')::uuid, 'ok', 'resolved');

        if (v_op->>'supersedesRejectedOpId') is not null then
          update sync_ops set resolution_status = 'resolved'
          where op_id = (v_op->>'supersedesRejectedOpId')::uuid and center_id = p_center_id;
        end if;

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');

      elsif v_op_type = 'void_entry' then
        if p_caller_role is null or p_caller_role not in ('admin', 'owner') then
          raise exception '403 unauthorized';
        end if;

        select date_trunc('month', entry_date)::date into v_entry_month
        from entries where id = (v_op->'payload'->>'entryId')::uuid and center_id = p_center_id;

        if exists (select 1 from month_closes where center_id = p_center_id and month = v_entry_month and status = 'closed') then
          raise exception '422 month_closed';
        end if;

        update entries
        set status = 'voided', voided_by = p_caller_id, voided_at = now(),
            void_reason = coalesce(v_op->'payload'->>'reason', 'Voided by admin')
        where id = (v_op->'payload'->>'entryId')::uuid and center_id = p_center_id and status = 'active';

        if not found then
          raise exception '422 cannot_void_non_active';
        end if;

        insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, result, resolution_status)
        values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, (v_op->'payload'->>'entryId')::uuid, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

        perform log_audit_event(p_center_id, p_caller_id, 'entry.void', 'entries', v_op->'payload'->>'entryId', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'voided'));

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'ok');

      elsif v_op_type = 'request_void' then
        select date_trunc('month', entry_date)::date into v_entry_month
        from entries where id = (v_op->'payload'->>'entryId')::uuid and center_id = p_center_id;

        if exists (select 1 from month_closes where center_id = p_center_id and month = v_entry_month and status = 'closed') then
          raise exception '422 month_closed';
        end if;

        update entries
        set void_requested_by = p_caller_id, void_requested_at = now(),
            void_request_reason = v_op->'payload'->>'reason'
        where id = (v_op->'payload'->>'entryId')::uuid and center_id = p_center_id and status = 'active'
          and (created_by = p_caller_id or p_caller_role in ('admin', 'owner'));

        if not found then
          raise exception '422 cannot_void_non_active';
        end if;

        insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, result, resolution_status)
        values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, (v_op->'payload'->>'entryId')::uuid, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

        perform log_audit_event(p_center_id, p_caller_id, 'entry.void_request', 'entries', v_op->'payload'->>'entryId', null, jsonb_build_object('void_requested_by', p_caller_id));

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
          where op_id = v_target_op_id and center_id = p_center_id and result = 'rejected'
            and (actor_id = p_caller_id or p_caller_role in ('admin', 'owner'));

          if not found then
            raise exception '403 unauthorized';
          end if;

          insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
          values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'ok', 'resolved');

          perform log_audit_event(p_center_id, p_caller_id, 'entry.discard_rejected', 'sync_ops', v_target_op_id::text, jsonb_build_object('result', 'rejected'), jsonb_build_object('resolution_status', 'discarded'));

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
          perform log_audit_event(p_center_id, p_caller_id, 'sync.calc_mismatch', 'sync_ops', v_op_id::text, null, jsonb_build_object('op_id', v_op_id, 'reason', v_err_reason));
        elsif v_err_reason like '%tamper%' then
          perform log_audit_event(p_center_id, p_caller_id, 'security.tamper_detected', 'sync_ops', v_op_id::text, null, jsonb_build_object('op_id', v_op_id, 'reason', v_err_reason));
        end if;

        insert into sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status, reason)
        values (v_op_id, p_center_id, p_caller_id, p_device_id, v_op_type, v_op->'payload', v_server_hash, v_client_created_at, 'rejected', 'pending', v_err_reason)
        on conflict (op_id) do update set reason = EXCLUDED.reason, result = 'rejected', resolution_status = 'pending';

        v_results := v_results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', v_err_reason);
      end;
    end;
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;
