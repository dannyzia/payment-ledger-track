-- Migration: 20261029000006_functions_settlement_recon_month.sql
-- Description: Settlement lifecycle, statement reconciliation, and month close procedures

-- 1. Pure Calculation Function: calc_settlement_status (PRD §7.3 lines 601-610, F50)
create or replace function calc_settlement_status(
  p_expected bigint,
  p_paid bigint
) returns text language sql immutable as $$
  select case
    when coalesce(p_expected, 0) = 0 and coalesce(p_paid, 0) = 0 then 'not_applicable'
    when coalesce(p_expected, 0) > 0 and coalesce(p_paid, 0) = 0 then 'due'
    when coalesce(p_paid, 0) > 0 and coalesce(p_paid, 0) < coalesce(p_expected, 0) then 'partly_paid'
    when coalesce(p_expected, 0) > 0 and coalesce(p_paid, 0) = coalesce(p_expected, 0) then 'paid'
    when coalesce(p_paid, 0) > coalesce(p_expected, 0) then 'overpaid'
    else 'due'
  end;
$$;

-- 2. Trigger Function: fn_settlements_recalc_status_and_overpayment (PRD §7.3 lines 1358-1359, §15.1)
create or replace function fn_settlements_recalc_status_and_overpayment()
returns trigger language plpgsql as $$
begin
  NEW.status := calc_settlement_status(NEW.expected_poisha, NEW.paid_poisha);

  -- Overpayment Invalidation Rule:
  -- If settlement was approved, but balance changed such that status != 'overpaid'
  -- OR current surplus differs from approved amount, reset all 5 approval columns to satisfy chk_overpayment_approval
  -- and append settlement.overpayment_invalidated to audit_log (Hard Rule 5)
  if OLD.overpayment_review_status = 'approved' then
    if NEW.status != 'overpaid' or (NEW.paid_poisha - NEW.expected_poisha) != coalesce(OLD.overpayment_approved_amount_poisha, 0) then
      NEW.overpayment_review_status := 'none';
      NEW.overpayment_approved_amount_poisha := null;
      NEW.overpayment_reason := null;
      NEW.overpayment_approved_by := null;
      NEW.overpayment_approved_at := null;

      perform log_audit_event(
        coalesce(
          nullif(current_setting('clt.audit_actor', true), '')::uuid,
          (select sp.recorded_by from settlement_payments sp
           where sp.settlement_id = NEW.id and sp.is_reversal = false
           order by sp.paid_on desc, sp.created_at desc limit 1),
          '00000000-0000-0000-0000-000000000000'::uuid),
        'settlement.overpayment_invalidated',
        'settlements',
        NEW.id::text,
        jsonb_build_object('overpayment_review_status', 'approved', 'overpayment_approved_amount_poisha', OLD.overpayment_approved_amount_poisha),
        jsonb_build_object('overpayment_review_status', 'none', 'current_surplus', NEW.paid_poisha - NEW.expected_poisha, 'reason', 'balance_changed')
      );
    end if;
  end if;

  return NEW;
end;
$$;

create trigger trg_settlements_recalc_status_and_overpayment
before update of expected_poisha, paid_poisha on settlements
for each row execute function fn_settlements_recalc_status_and_overpayment();

-- 3. Procedure: generate_monthly_settlements (PRD §7.3 lines 1091-1120)
create or replace function generate_monthly_settlements(p_month date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_payable_id uuid;
  v_expected bigint;
  v_rec record;
begin
  -- 1. Month Advisory Lock (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  -- 2. Skip if month is closed
  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    return;
  end if;

  -- Stream 1: Government VAT
  select s.payable_id into v_payable_id
  from settlements s
  join payables p on p.id = s.payable_id
  where s.month = v_month and p.kind = 'vat'
  limit 1;

  if v_payable_id is null then
    select id into v_payable_id
    from payables
    where kind = 'vat'
    order by active desc, created_at desc
    limit 1;
  end if;

  if v_payable_id is not null then
    select coalesce(sum(vat_poisha), 0) into v_expected
    from entries
    where date_trunc('month', entry_date)::date = v_month and status = 'active';

    insert into settlements (payable_id, month, expected_poisha, paid_poisha, status)
    values (v_payable_id, v_month, v_expected, 0, calc_settlement_status(v_expected, 0))
    on conflict (payable_id, month) do update
    set expected_poisha = EXCLUDED.expected_poisha, updated_at = now()
    where not exists (select 1 from month_closes mc where mc.month = v_month and mc.status = 'closed');
  end if;

  -- Stream 2: Method Charges for distinct liability streams
  for v_rec in (
    select distinct id as method_id
    from payment_methods
    where active = true
       or id in (select method_id from entries where date_trunc('month', entry_date)::date = v_month and status = 'active')
       or id in (select p.method_id from settlements s join payables p on p.id = s.payable_id where s.month = v_month and p.kind = 'method_charge')
  ) loop
    v_payable_id := null;

    select s.payable_id into v_payable_id
    from settlements s
    join payables p on p.id = s.payable_id
    where s.month = v_month and p.kind = 'method_charge' and p.method_id = v_rec.method_id
    limit 1;

    if v_payable_id is null then
      select id into v_payable_id
      from payables
      where kind = 'method_charge' and method_id = v_rec.method_id
      order by active desc, created_at desc
      limit 1;
    end if;

    if v_payable_id is not null then
      select coalesce(sum(business_charge_poisha), 0) into v_expected
      from entries
      where date_trunc('month', entry_date)::date = v_month and method_id = v_rec.method_id and status = 'active';

      insert into settlements (payable_id, month, expected_poisha, paid_poisha, status)
      values (v_payable_id, v_month, v_expected, 0, calc_settlement_status(v_expected, 0))
      on conflict (payable_id, month) do update
      set expected_poisha = EXCLUDED.expected_poisha, updated_at = now()
      where not exists (select 1 from month_closes mc where mc.month = v_month and mc.status = 'closed');
    end if;
  end loop;
end;
$$;

-- 4. Trigger: Dynamic Settlement & Scoped Statement Invalidation (PRD §7.3 lines 1354-1356, Finding B4)
create or replace function fn_entries_recalc_settlements()
returns trigger language plpgsql as $$
declare
  v_new_month date;
  v_old_month date;
  v_month_item date;
begin
  -- Filter evaluated inside function body (avoids invalid TG_OP/OLD in trigger WHEN clause)
  if not (NEW.status = 'active' or (TG_OP = 'UPDATE' and OLD.status = 'active')) then
    return NEW;
  end if;

  v_new_month := date_trunc('month', NEW.entry_date)::date;
  if TG_OP = 'UPDATE' then
    v_old_month := date_trunc('month', OLD.entry_date)::date;
  end if;

  -- Iterate through affected months in ascending order (preventing lock-inversion deadlocks)
  for v_month_item in select distinct m from unnest(array[v_new_month, v_old_month]) m where m is not null order by m asc loop
    -- Process only open months
    if not exists (select 1 from month_closes where month = v_month_item and status = 'closed') then
      perform generate_monthly_settlements(v_month_item);

      -- Cascade statement expected poisha recalculation and invalidation back to 'open'
      -- Scoped strictly to statements covering affected liability streams:
      -- VAT if (NEW.vat_poisha > 0 or OLD.vat_poisha > 0)
      -- Method Charge if method matches NEW.method_id or OLD.method_id
      update statements s
      set expected_poisha = (
        select coalesce(sum(
          case
            when p.kind = 'vat' then e.vat_poisha
            when p.kind = 'method_charge' and e.method_id = p.method_id then e.business_charge_poisha
            else 0
          end
        ), 0)
        from statement_payables sp
        join payables p on p.id = sp.payable_id
        join entries e on date_trunc('month', e.entry_date)::date = v_month_item and e.status = 'active'
        where sp.statement_id = s.id
      ),
      status = 'open',
      updated_at = now()
      where s.month = v_month_item
        and s.status in ('open', 'reconciled')
        and exists (
          select 1 from statement_payables sp
          join payables p on p.id = sp.payable_id
          where sp.statement_id = s.id
            and (
              (p.kind = 'vat' and (NEW.vat_poisha > 0 or (TG_OP = 'UPDATE' and OLD.vat_poisha > 0)))
              or
              (p.kind = 'method_charge' and (p.method_id = NEW.method_id or (TG_OP = 'UPDATE' and p.method_id = OLD.method_id)))
            )
        );

      update statement_payables sp
      set status = 'open'
      where sp.month = v_month_item
        and sp.status = 'reconciled'
        and exists (
          select 1 from statements s
          where s.id = sp.statement_id and s.status = 'open'
        );
    end if;
  end loop;

  return NEW;
end;
$$;

create trigger trg_entries_recalc_settlements
after insert or update of status, entry_date, method_id, gross_poisha, vat_poisha, business_charge_poisha on entries
for each row execute function fn_entries_recalc_settlements();

-- 5a. Trigger: Settlement Payments Immutability (PRD §7, §7.3 lines 639-656, §18 Gate 1)
create or replace function fn_settlement_payments_immutable()
returns trigger language plpgsql as $$
begin
  raise exception '403 settlement_payments_immutable';
end;
$$;

create trigger trg_settlement_payments_immutable
before update or delete on settlement_payments
for each row execute function fn_settlement_payments_immutable();

-- 5b. Trigger: Settlement Payments Reversal Lock & Aggregate Reduction (PRD §7.3 lines 639-656, 1360)
create or replace function fn_settlement_payments_reversal_lock()
returns trigger language plpgsql as $$
declare
  v_payable_id uuid;
  v_target_amount bigint;
  v_target_settlement_id uuid;
  v_target_is_reversal boolean;
  v_existing_reversals bigint;
  v_new_paid bigint;
begin
  -- Lock hierarchy: payables (FOR KEY SHARE) -> settlements (FOR UPDATE)
  select payable_id into v_payable_id from settlements where id = NEW.settlement_id;
  if v_payable_id is not null then
    perform id from payables where id = v_payable_id for key share;
  end if;
  perform id from settlements where id = NEW.settlement_id for update;

  if NEW.is_reversal then
    select amount_poisha, settlement_id, is_reversal
    into v_target_amount, v_target_settlement_id, v_target_is_reversal
    from settlement_payments where id = NEW.reverses_payment_id for update;

    if v_target_amount is null then
      raise exception '422 payment_not_found';
    end if;
    if v_target_is_reversal then
      raise exception '422 cannot_reverse_reversal';
    end if;
    if v_target_settlement_id != NEW.settlement_id then
      raise exception '422 settlement_id_mismatch';
    end if;

    -- Query prior existing reversals excluding the current newly-inserted row (prevents double counting)
    select coalesce(sum(amount_poisha), 0) into v_existing_reversals
    from settlement_payments
    where reverses_payment_id = NEW.reverses_payment_id and is_reversal = true
      and id != NEW.id;

    if (v_existing_reversals + NEW.amount_poisha) > v_target_amount then
      raise exception '422 reversals_exceed_original_amount';
    end if;
  end if;

  -- Recalculate net paid poisha on parent settlement
  select coalesce(sum(amount_poisha * (case when is_reversal then -1 else 1 end)), 0)
  into v_new_paid
  from settlement_payments
  where settlement_id = NEW.settlement_id;

  update settlements set paid_poisha = v_new_paid, updated_at = now()
  where id = NEW.settlement_id;

  return NEW;
end;
$$;

create trigger trg_settlement_payments_reversal_lock
after insert on settlement_payments
for each row execute function fn_settlement_payments_reversal_lock();

-- 6. Trigger: Statement Line Auto-Unmatch on Entry Void/Supersede/Shift (PRD §7.3 lines 1351-1355, Test #51)
create or replace function fn_entries_unmatch_statement_lines()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'active' and (
    NEW.status in ('voided', 'superseded')
    or date_trunc('month', NEW.entry_date)::date != date_trunc('month', OLD.entry_date)::date
    or NEW.method_id != OLD.method_id
  ) then
    -- Cascade parent statements from reconciled to open
    update statements s
    set status = 'open', updated_at = now()
    where s.status = 'reconciled'
      and exists (
        select 1 from statement_lines sl
        where sl.statement_id = s.id and sl.matched_entry_id = NEW.id and sl.is_active_match = true
      );

    -- Cascade covered statement_payables from reconciled to open
    update statement_payables sp
    set status = 'open'
    from statements s
    where sp.statement_id = s.id and s.status = 'open' and sp.status = 'reconciled'
      and exists (
        select 1 from statement_lines sl
        where sl.statement_id = s.id and sl.matched_entry_id = NEW.id and sl.is_active_match = true
      );

    update statement_lines
    set match_status = 'unmatched', matched_entry_id = null, is_active_match = false, updated_at = now()
    where matched_entry_id = NEW.id and is_active_match = true;
  end if;

  return NEW;
end;
$$;

create trigger trg_entries_unmatch_statement_lines
after update of status, entry_date, method_id on entries
for each row execute function fn_entries_unmatch_statement_lines();

-- 7. Trigger: Reconciliation Exception Invalidation Cascade (PRD §7.3 lines 1015, 1353, TOC)
create or replace function fn_entry_exceptions_invalidate_reconciliation()
returns trigger language plpgsql as $$
declare
  v_entry_id uuid;
  v_payable_id uuid;
  v_month date;
begin
  -- Filter evaluated inside function body (avoids invalid TG_OP/OLD in trigger WHEN clause)
  if not (OLD.status = 'approved' and (TG_OP = 'DELETE' or NEW.status != 'approved')) then
    return coalesce(NEW, OLD);
  end if;

  v_entry_id := OLD.entry_id;
  v_payable_id := OLD.payable_id;
  v_month := OLD.month;

  update statements s
  set status = 'open', updated_at = now()
  where s.month = v_month
    and s.status = 'reconciled'
    and exists (
      select 1 from statement_payables sp
      where sp.statement_id = s.id
        and sp.payable_id = v_payable_id
    );

  -- Cascade all child statement_payables for affected statements (including combined card siblings)
  update statement_payables sp
  set status = 'open'
  from statements s
  where sp.statement_id = s.id and s.month = v_month
    and sp.status = 'reconciled'
    and exists (
      select 1 from statement_payables sp2
      where sp2.statement_id = s.id and sp2.payable_id = v_payable_id
    );

  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_entry_exceptions_invalidate_reconciliation
after update or delete on entry_reconciliation_exceptions
for each row execute function fn_entry_exceptions_invalidate_reconciliation();

-- 8. RPC: record_settlement_payment (PRD §7.3 lines 1121-1144)
create or replace function record_settlement_payment(
  p_settlement_id uuid,
  p_amount_poisha bigint,
  p_paid_on date,
  p_reference text,
  p_receipt_path text,
  p_note text,
  p_is_reversal boolean,
  p_reverses_id uuid,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_payable_id uuid;
  v_expected bigint;
  v_current_paid bigint;
  v_settlement_id uuid;
  v_payment_id uuid;
  v_target_amount bigint;
  v_target_settlement_id uuid;
  v_target_is_reversal boolean;
  v_existing_reversals bigint;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_amount_poisha <= 0 then
    raise exception '422 amount_must_be_positive';
  end if;

  select s.month, s.payable_id, s.expected_poisha, s.paid_poisha
  into v_month, v_payable_id, v_expected, v_current_paid
  from settlements s where s.id = p_settlement_id;

  if v_month is null then
    raise exception '422 settlement_not_found';
  end if;

  v_month := date_trunc('month', v_month)::date;

  if p_paid_on > (now() at time zone 'Asia/Dhaka')::date then
    raise exception '422 future_payment_date';
  end if;

  if p_paid_on < v_month then
    raise exception '422 payment_predates_settlement_month';
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  -- 2. Row Locks in Trigger-Aligned Order: payables (KEY SHARE) -> settlements (FOR UPDATE)
  perform id from payables where id = v_payable_id for key share;
  select id, expected_poisha, paid_poisha
  into v_settlement_id, v_expected, v_current_paid
  from settlements where id = p_settlement_id for update;

  -- Closed-Month Payout Policy (PRD §7.3 lines 1126-1131, Item 3)
  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    if coalesce(p_is_reversal, false) then
      raise exception '422 month_closed';
    end if;
    if (coalesce(v_current_paid, 0) + p_amount_poisha) > v_expected then
      raise exception '422 month_closed';
    end if;
  end if;

  if coalesce(p_is_reversal, false) then
    if p_reverses_id is null then
      raise exception '422 reversal_id_required';
    end if;

    select amount_poisha, settlement_id, is_reversal
    into v_target_amount, v_target_settlement_id, v_target_is_reversal
    from settlement_payments where id = p_reverses_id for update;

    if v_target_amount is null then
      raise exception '422 payment_not_found';
    end if;
    if v_target_is_reversal then
      raise exception '422 cannot_reverse_reversal';
    end if;
    if v_target_settlement_id != p_settlement_id then
      raise exception '422 settlement_id_mismatch';
    end if;

    select coalesce(sum(amount_poisha), 0) into v_existing_reversals
    from settlement_payments
    where reverses_payment_id = p_reverses_id and is_reversal = true;

    if (v_existing_reversals + p_amount_poisha) > v_target_amount then
      raise exception '422 reversals_exceed_original_amount';
    end if;
  end if;

  v_payment_id := gen_random_uuid();
  insert into settlement_payments (
    id, settlement_id, amount_poisha, paid_on, reference, receipt_storage_path,
    note, is_reversal, reverses_payment_id, recorded_by
  ) values (
    v_payment_id, p_settlement_id, p_amount_poisha, p_paid_on, p_reference,
    p_receipt_path, p_note, coalesce(p_is_reversal, false), p_reverses_id, p_actor_id
  );

  perform log_audit_event(
    p_actor_id, 'settlement.payment', 'settlement_payments', v_payment_id::text, null,
    jsonb_build_object(
      'settlement_id', p_settlement_id, 'amount', p_amount_poisha,
      'paid_on', p_paid_on, 'is_reversal', coalesce(p_is_reversal, false),
      'reverses_id', p_reverses_id
    )
  );

  return v_payment_id;
end;
$$;

-- 9. RPC: approve_settlement_overpayment (PRD §7.3 lines 1145-1161)
create or replace function approve_settlement_overpayment(
  p_settlement_id uuid,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_payable_id uuid;
  v_settlement record;
  v_current_surplus bigint;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role != 'owner' then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  select s.month, s.payable_id into v_month, v_payable_id
  from settlements s where s.id = p_settlement_id;

  if v_month is null then
    raise exception '422 settlement_not_found';
  end if;

  v_month := date_trunc('month', v_month)::date;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Row Locks: payables (KEY SHARE) -> settlements (FOR UPDATE)
  perform id from payables where id = v_payable_id for key share;
  select * into v_settlement from settlements where id = p_settlement_id for update;

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
  where id = p_settlement_id;

  perform log_audit_event(
    p_actor_id, 'settlement.overpayment_approved', 'settlements', p_settlement_id::text,
    jsonb_build_object('overpayment_status', v_settlement.overpayment_review_status),
    jsonb_build_object('overpayment_status', 'approved', 'approved_amount', v_current_surplus, 'reason', p_reason)
  );
end;
$$;

-- 10. Internal Matching Procedure: perform_statement_auto_match (Finding B5, Items 1 & 2)
create or replace function perform_statement_auto_match(
  p_statement_id uuid,
  p_month date
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rec record;
begin
  -- Primary Pass: Exact Reference Equality with 1-to-1 Uniqueness
  for v_rec in (
    with candidate_entries as (
      select e.id, upper(trim(e.txn_ref)) as norm_ref
      from entries e
      where date_trunc('month', e.entry_date)::date = p_month
        and e.status = 'active'
        and e.txn_ref is not null
        and length(trim(e.txn_ref)) > 0
        and exists (
          select 1 from statement_payables sp
          join payables p on p.id = sp.payable_id
          where sp.statement_id = p_statement_id
            and (
              (p.kind = 'vat' and e.vat_poisha > 0)
              or (p.kind = 'method_charge' and p.method_id = e.method_id and e.business_charge_poisha > 0)
            )
        )
        and not exists (
          select 1 from statement_lines sl2
          where sl2.statement_id = p_statement_id
            and sl2.matched_entry_id = e.id
            and sl2.is_active_match = true
        )
    ),
    unique_entries as (
      select id, norm_ref
      from candidate_entries
      where norm_ref in (
        select norm_ref from candidate_entries group by norm_ref having count(*) = 1
      )
    ),
    unmatched_lines as (
      select id, upper(trim(reference)) as norm_ref
      from statement_lines
      where statement_id = p_statement_id
        and match_status = 'unmatched'
        and reference is not null
        and length(trim(reference)) > 0
    ),
    unique_lines as (
      select id, norm_ref
      from unmatched_lines
      where norm_ref in (
        select norm_ref from unmatched_lines group by norm_ref having count(*) = 1
      )
    )
    select ul.id as line_id, ue.id as entry_id
    from unique_lines ul
    join unique_entries ue on ue.norm_ref = ul.norm_ref
  ) loop
    update statement_lines
    set matched_entry_id = v_rec.entry_id, match_status = 'matched', is_active_match = true, updated_at = now()
    where id = v_rec.line_id and match_status = 'unmatched';
  end loop;

  -- Fallback Pass: Unique Date + Gross matching with 1-to-1 Uniqueness
  for v_rec in (
    with candidate_entries as (
      select e.id, e.entry_date, e.gross_poisha
      from entries e
      where date_trunc('month', e.entry_date)::date = p_month
        and e.status = 'active'
        and exists (
          select 1 from statement_payables sp
          join payables p on p.id = sp.payable_id
          where sp.statement_id = p_statement_id
            and (
              (p.kind = 'vat' and e.vat_poisha > 0)
              or (p.kind = 'method_charge' and p.method_id = e.method_id and e.business_charge_poisha > 0)
            )
        )
        and not exists (
          select 1 from statement_lines sl2
          where sl2.statement_id = p_statement_id
            and sl2.matched_entry_id = e.id
            and sl2.is_active_match = true
        )
    ),
    unique_entries as (
      select id, entry_date, gross_poisha
      from candidate_entries
      where (entry_date, gross_poisha) in (
        select entry_date, gross_poisha from candidate_entries group by entry_date, gross_poisha having count(*) = 1
      )
    ),
    unmatched_lines as (
      select id, line_date, gross_poisha
      from statement_lines
      where statement_id = p_statement_id
        and match_status = 'unmatched'
        and line_date is not null
        and gross_poisha is not null
    ),
    unique_lines as (
      select id, line_date, gross_poisha
      from unmatched_lines
      where (line_date, gross_poisha) in (
        select line_date, gross_poisha from unmatched_lines group by line_date, gross_poisha having count(*) = 1
      )
    )
    select ul.id as line_id, ue.id as entry_id
    from unique_lines ul
    join unique_entries ue on ue.entry_date = ul.line_date and ue.gross_poisha = ul.gross_poisha
  ) loop
    update statement_lines
    set matched_entry_id = v_rec.entry_id, match_status = 'matched', is_active_match = true, updated_at = now()
    where id = v_rec.line_id and match_status = 'unmatched';
  end loop;
end;
$$;

-- 11. RPC: create_statement (PRD §7.3 lines 1162-1177)
create or replace function create_statement(
  p_kind text,
  p_month date,
  p_source text,
  p_file_storage_path text,
  p_file_sha256 text,
  p_statement_total_poisha bigint,
  p_payable_ids uuid[],
  p_lines jsonb,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date := date_trunc('month', p_month)::date;
  v_statement_id uuid;
  v_expected bigint := 0;
  v_payable_id uuid;
  v_line jsonb;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_kind not in ('single_payable', 'combined_card') then
    raise exception '400 invalid_kind';
  end if;
  if p_source not in ('manual_total', 'file') then
    raise exception '400 invalid_source';
  end if;

  if p_statement_total_poisha < 0 then
    raise exception '422 statement_total_must_be_non_negative';
  end if;

  if p_payable_ids is null or coalesce(array_length(p_payable_ids, 1), 0) = 0 then
    raise exception '422 payable_ids_required';
  end if;

  if (select count(distinct pid) from unnest(p_payable_ids) pid) != array_length(p_payable_ids, 1) then
    raise exception '422 duplicate_payable_ids';
  end if;

  if (select count(*) from payables where id = any(p_payable_ids) and active = true) != array_length(p_payable_ids, 1) then
    raise exception '422 invalid_or_inactive_payable';
  end if;

  if p_kind = 'single_payable' and array_length(p_payable_ids, 1) != 1 then
    raise exception '422 single_payable_requires_exactly_one_payable';
  end if;

  if p_kind = 'combined_card' and array_length(p_payable_ids, 1) < 1 then
    raise exception '422 combined_card_requires_payables';
  end if;

  -- Line count and storage guards
  if p_source = 'file' then
    if p_lines is null or jsonb_array_length(p_lines) = 0 then
      raise exception '422 file_source_requires_lines';
    end if;
    if p_file_storage_path is null or p_file_sha256 is null or length(trim(p_file_sha256)) != 64 then
      raise exception '422 invalid_file_metadata';
    end if;
  else
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      raise exception '422 manual_total_forbids_lines';
    end if;
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Lock Hierarchy: payables FOR KEY SHARE
  perform id from payables where id = any(p_payable_ids) for key share;

  -- Overlap Check: Assert no payable is already covered by an active (open/reconciled) statement for this month
  if exists (
    select 1 from statement_payables sp
    join statements s on s.id = sp.statement_id
    where sp.payable_id = any(p_payable_ids)
      and sp.month = v_month
      and s.status in ('open', 'reconciled')
  ) then
    raise exception '422 payable_already_covered_by_active_statement';
  end if;

  -- Calculate expected poisha across covered payables
  select coalesce(sum(
    case
      when p.kind = 'vat' then e.vat_poisha
      when p.kind = 'method_charge' and e.method_id = p.method_id then e.business_charge_poisha
      else 0
    end
  ), 0) into v_expected
  from unnest(p_payable_ids) pid
  join payables p on p.id = pid
  join entries e on date_trunc('month', e.entry_date)::date = v_month and e.status = 'active';

  v_statement_id := gen_random_uuid();
  insert into statements (
    id, kind, month, source, file_storage_path, file_sha256,
    statement_total_poisha, expected_poisha, status, created_by
  ) values (
    v_statement_id, p_kind, v_month, p_source, p_file_storage_path, p_file_sha256,
    p_statement_total_poisha, v_expected, 'open', p_actor_id
  );

  foreach v_payable_id in array p_payable_ids loop
    insert into statement_payables (statement_id, payable_id, month, status)
    values (v_statement_id, v_payable_id, v_month, 'open');
  end loop;

  if p_source = 'file' and p_lines is not null and jsonb_array_length(p_lines) > 0 then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      insert into statement_lines (
        statement_id, line_date, reference, gross_poisha, fee_poisha, raw, match_status, is_active_match
      ) values (
        v_statement_id, (v_line->>'lineDate')::date, nullif(upper(trim(v_line->>'reference')), ''),
        (v_line->>'grossPoisha')::bigint, (v_line->>'feePoisha')::bigint, v_line, 'unmatched', true
      );
    end loop;

    -- Execute automated 1-to-1 matching passes
    perform perform_statement_auto_match(v_statement_id, v_month);
  end if;

  perform log_audit_event(
    p_actor_id, 'statement.create', 'statements', v_statement_id::text, null,
    jsonb_build_object('kind', p_kind, 'month', v_month, 'source', p_source, 'total', p_statement_total_poisha)
  );

  return v_statement_id;
end;
$$;

-- 12. RPC: supersede_statement (PRD §7.3 lines 1178-1192)
create or replace function supersede_statement(
  p_original_statement_id uuid,
  p_file_storage_path text,
  p_file_sha256 text,
  p_statement_total_poisha bigint,
  p_note text,
  p_lines jsonb,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_orig record;
  v_new_id uuid;
  v_line jsonb;
  v_expected bigint;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_statement_total_poisha < 0 then
    raise exception '422 statement_total_must_be_non_negative';
  end if;

  -- 1. Read month without lock
  select month into v_month from statements where id = p_original_statement_id;
  if v_month is null then
    raise exception '422 statement_not_found';
  end if;

  v_month := date_trunc('month', v_month)::date;

  -- 2. Advisory Month Lock First
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2b. Row lock payables in trigger-aligned order FOR KEY SHARE
  perform p.id
  from statement_payables sp
  join payables p on p.id = sp.payable_id
  where sp.statement_id = p_original_statement_id
  order by p.id asc
  for key share;

  -- 3. Row lock original statement AFTER month lock and payables lock
  select * into v_orig from statements where id = p_original_statement_id for update;
  if v_orig.status = 'superseded' then
    raise exception '422 cannot_supersede_already_superseded';
  end if;

  -- Line count and storage guards
  if v_orig.source = 'file' then
    if p_lines is null or jsonb_array_length(p_lines) = 0 then
      raise exception '422 file_source_requires_lines';
    end if;
    if p_file_storage_path is null or p_file_sha256 is null or length(trim(p_file_sha256)) != 64 then
      raise exception '422 invalid_file_metadata';
    end if;
  else
    if p_lines is not null and jsonb_array_length(p_lines) > 0 then
      raise exception '422 manual_total_forbids_lines';
    end if;
  end if;

  -- Compute live expected_poisha from active entries across covered payables
  select coalesce(sum(
    case
      when p.kind = 'vat' then e.vat_poisha
      when p.kind = 'method_charge' and e.method_id = p.method_id then e.business_charge_poisha
      else 0
    end
  ), 0) into v_expected
  from statement_payables sp
  join payables p on p.id = sp.payable_id
  join entries e on date_trunc('month', e.entry_date)::date = v_month and e.status = 'active'
  where sp.statement_id = p_original_statement_id;

  v_new_id := gen_random_uuid();

  -- Insert replacement statement row first
  insert into statements (
    id, kind, month, source, file_storage_path, file_sha256,
    statement_total_poisha, expected_poisha, status, note, created_by
  ) values (
    v_new_id, v_orig.kind, v_month, v_orig.source, p_file_storage_path, p_file_sha256,
    p_statement_total_poisha, v_expected, 'open', p_note, p_actor_id
  );

  -- Mark original statement_payables superseded first to satisfy uq_active_statement_coverage
  update statement_payables set status = 'superseded' where statement_id = p_original_statement_id;

  -- Copy covered payables to replacement statement
  insert into statement_payables (statement_id, payable_id, month, status)
  select v_new_id, payable_id, month, 'open'
  from statement_payables where statement_id = p_original_statement_id;

  update statements
  set status = 'superseded', superseded_by = v_new_id, updated_at = now()
  where id = p_original_statement_id;

  update statement_lines set is_active_match = false where statement_id = p_original_statement_id;

  if v_orig.source = 'file' and p_lines is not null and jsonb_array_length(p_lines) > 0 then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      insert into statement_lines (
        statement_id, line_date, reference, gross_poisha, fee_poisha, raw, match_status, is_active_match
      ) values (
        v_new_id, (v_line->>'lineDate')::date, nullif(upper(trim(v_line->>'reference')), ''),
        (v_line->>'grossPoisha')::bigint, (v_line->>'feePoisha')::bigint, v_line, 'unmatched', true
      );
    end loop;

    -- Execute automated 1-to-1 matching passes
    perform perform_statement_auto_match(v_new_id, v_month);
  end if;

  perform log_audit_event(
    p_actor_id, 'statement.supersede', 'statements', p_original_statement_id::text,
    jsonb_build_object('status', v_orig.status), jsonb_build_object('status', 'superseded', 'superseded_by', v_new_id)
  );

  return v_new_id;
end;
$$;

-- 13. RPC: match_statement_line (PRD §7.3 lines 1193-1213)
create or replace function match_statement_line(
  p_line_id uuid,
  p_entry_id uuid,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_statement_id uuid;
  v_stmt_status text;
  v_entry_month date;
  v_entry_status entry_status;
  v_entry_method_id uuid;
  v_entry_vat bigint;
  v_entry_charge bigint;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  select s.month, s.status, sl.statement_id into v_month, v_stmt_status, v_statement_id
  from statement_lines sl
  join statements s on s.id = sl.statement_id
  where sl.id = p_line_id;

  if v_month is null then
    raise exception '422 line_not_found';
  end if;

  if v_stmt_status = 'superseded' then
    raise exception '422 cannot_modify_superseded_statement';
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Sequence Advisory Lock (Class 1002) before acquiring entry row lock
  perform pg_advisory_xact_lock(1002, 1);

  -- 3. Row Locks in Trigger-Aligned Order: payables (KEY SHARE) -> entries (FOR UPDATE) -> statements (FOR UPDATE) -> statement_lines (FOR UPDATE)
  perform p.id
  from statement_payables sp
  join payables p on p.id = sp.payable_id
  where sp.statement_id = v_statement_id
  order by p.id asc
  for key share;

  select date_trunc('month', entry_date)::date, status, method_id, vat_poisha, business_charge_poisha
  into v_entry_month, v_entry_status, v_entry_method_id, v_entry_vat, v_entry_charge
  from entries where id = p_entry_id for update;

  if v_entry_status is null then
    raise exception '422 entry_not_found';
  end if;
  if v_entry_status != 'active' then
    raise exception '422 cannot_match_non_active_entry';
  end if;
  if v_entry_month != v_month then
    raise exception '422 entry_month_mismatch';
  end if;

  perform id from statements where id = v_statement_id for update;
  perform id from statement_lines where id = p_line_id for update;

  if not exists (
    select 1 from statement_payables sp
    join payables p on p.id = sp.payable_id
    where sp.statement_id = v_statement_id
      and (
        (p.kind = 'vat' and v_entry_vat > 0)
        or (p.kind = 'method_charge' and p.method_id = v_entry_method_id and v_entry_charge > 0)
      )
  ) then
    raise exception '422 entry_payable_not_covered';
  end if;

  update statement_lines
  set matched_entry_id = p_entry_id, match_status = 'matched', is_active_match = true, updated_at = now()
  where id = p_line_id and match_status = 'unmatched';

  if not found then
    raise exception '422 line_already_matched';
  end if;

  -- Invalidation cascade if statement was reconciled
  if v_stmt_status = 'reconciled' then
    update statements set status = 'open', updated_at = now() where id = v_statement_id;
    update statement_payables set status = 'open' where statement_id = v_statement_id and status = 'reconciled';
    perform log_audit_event(
      p_actor_id, 'statement.invalidate', 'statements', v_statement_id::text,
      jsonb_build_object('status', 'reconciled'), jsonb_build_object('status', 'open', 'reason', 'statement_line_modified')
    );
  end if;

  perform log_audit_event(
    p_actor_id, 'statement.match_line', 'statement_lines', p_line_id::text,
    jsonb_build_object('match_status', 'unmatched'),
    jsonb_build_object('match_status', 'matched', 'matched_entry_id', p_entry_id)
  );
end;
$$;

-- 14. RPC: unmatch_statement_line (PRD §7.3 lines 1214-1226, H4)
create or replace function unmatch_statement_line(
  p_line_id uuid,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_statement_id uuid;
  v_stmt_status text;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  select s.month, s.status, sl.statement_id into v_month, v_stmt_status, v_statement_id
  from statement_lines sl
  join statements s on s.id = sl.statement_id
  where sl.id = p_line_id;

  if v_month is null then
    raise exception '422 line_not_found';
  end if;

  if v_stmt_status = 'superseded' then
    raise exception '422 cannot_modify_superseded_statement';
  end if;

  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  perform id from statements where id = v_statement_id for update;
  perform id from statement_lines where id = p_line_id for update;

  update statement_lines
  set match_status = 'unmatched', matched_entry_id = null, is_active_match = false, updated_at = now()
  where id = p_line_id and match_status = 'matched';

  if not found then
    raise exception '422 line_not_matched';
  end if;

  -- Cascading invalidation to 'open'
  if v_stmt_status = 'reconciled' then
    update statements set status = 'open', updated_at = now() where id = v_statement_id;
    update statement_payables set status = 'open' where statement_id = v_statement_id and status = 'reconciled';
    perform log_audit_event(
      p_actor_id, 'statement.invalidate', 'statements', v_statement_id::text,
      jsonb_build_object('status', 'reconciled'), jsonb_build_object('status', 'open', 'reason', 'statement_line_unmatched')
    );
  end if;

  perform log_audit_event(
    p_actor_id, 'statement.unmatch_line', 'statement_lines', p_line_id::text,
    jsonb_build_object('match_status', 'matched'), jsonb_build_object('match_status', 'unmatched', 'reason', p_reason)
  );
end;
$$;

-- 15. RPC: accept_statement_line (PRD §7.3 lines 1026-1034)
create or replace function accept_statement_line(
  p_line_id uuid,
  p_review_note text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_statement_id uuid;
  v_stmt_status text;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_review_note, ''))) = 0 then
    raise exception '422 review_note_required';
  end if;

  select s.month, s.status, sl.statement_id into v_month, v_stmt_status, v_statement_id
  from statements s
  join statement_lines sl on sl.statement_id = s.id
  where sl.id = p_line_id;

  if v_month is null then
    raise exception '422 line_not_found';
  end if;

  if v_stmt_status = 'superseded' then
    raise exception '422 cannot_modify_superseded_statement';
  end if;

  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  perform id from statements where id = v_statement_id for update;
  perform id from statement_lines where id = p_line_id for update;

  update statement_lines
  set match_status = 'accepted', review_note = p_review_note,
      reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
  where id = p_line_id and match_status = 'unmatched' and matched_entry_id is null;

  if not found then
    raise exception '422 cannot_accept_line';
  end if;

  if v_stmt_status = 'reconciled' then
    update statements set status = 'open', updated_at = now() where id = v_statement_id;
    update statement_payables set status = 'open' where statement_id = v_statement_id and status = 'reconciled';
    perform log_audit_event(
      p_actor_id, 'statement.invalidate', 'statements', v_statement_id::text,
      jsonb_build_object('status', 'reconciled'), jsonb_build_object('status', 'open', 'reason', 'statement_line_accepted')
    );
  end if;

  perform log_audit_event(
    p_actor_id, 'statement_line.accept', 'statement_lines', p_line_id::text,
    jsonb_build_object('match_status', 'unmatched'),
    jsonb_build_object('match_status', 'accepted', 'review_note', p_review_note)
  );
end;
$$;

-- 16. RPC: review_entry_reconciliation_exception (PRD §7.3 lines 1001-1016)
create or replace function review_entry_reconciliation_exception(
  p_entry_id uuid,
  p_payable_id uuid,
  p_action text,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date;
  v_entry_status entry_status;
  v_entry_method_id uuid;
  v_payable_kind text;
  v_payable_method_id uuid;
  v_exception_id uuid;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  if p_action not in ('approved', 'rejected') then
    raise exception '422 invalid_action';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  select date_trunc('month', entry_date)::date into v_month from entries where id = p_entry_id;
  if v_month is null then
    raise exception '422 entry_not_found';
  end if;

  -- 1. Advisory Month Lock First (Class 1001)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 2. Sequence Advisory Lock (Class 1002)
  perform pg_advisory_xact_lock(1002, 1);

  -- 3. Row Locks in Order: payables (KEY SHARE) -> entries (FOR UPDATE)
  select kind, method_id into v_payable_kind, v_payable_method_id
  from payables where id = p_payable_id for key share;

  if v_payable_kind is null then
    raise exception '422 payable_not_found';
  end if;

  select status, method_id into v_entry_status, v_entry_method_id
  from entries where id = p_entry_id for update;

  if v_entry_status != 'active' then
    raise exception '422 cannot_except_non_active_entry';
  end if;

  -- Assert payable applicability
  if not (
    (v_payable_kind = 'vat')
    or
    (v_payable_kind = 'method_charge' and v_payable_method_id = v_entry_method_id)
  ) then
    raise exception '422 payable_not_applicable_to_entry';
  end if;

  insert into entry_reconciliation_exceptions (
    entry_id, payable_id, month, status, reason, reviewed_by, reviewed_at, updated_at
  ) values (
    p_entry_id, p_payable_id, v_month, p_action, p_reason, p_actor_id, now(), now()
  ) on conflict (entry_id, payable_id, month) do update
  set status = p_action, reason = p_reason, reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
  returning id into v_exception_id;

  perform log_audit_event(
    p_actor_id, 'entry.reconciliation_exception', 'entry_reconciliation_exceptions',
    v_exception_id::text,
    null,
    jsonb_build_object('action', p_action, 'reason', p_reason, 'entry_id', p_entry_id, 'payable_id', p_payable_id, 'month', v_month)
  );
end;
$$;

-- 17. RPC: reconcile_statement (PRD §7.3 lines 1056-1077, Finding A1, Blocker B7)
create or replace function reconcile_statement(
  p_statement_id uuid,
  p_note text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_stmt record;
  v_month date;
  v_tol bigint;
  v_live_expected bigint;
  v_invalid_lines int;
  v_unmatched_count int;
  v_uncovered_entries int;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role not in ('admin', 'owner') then
    raise exception '403 unauthorized';
  end if;

  -- 1. Read month without row lock to respect global lock hierarchy
  select month into v_month from statements where id = p_statement_id;
  if v_month is null then
    raise exception '422 statement_not_found';
  end if;

  v_month := date_trunc('month', v_month)::date;

  -- 2. Advisory Month Lock First (Lock Hierarchy Step 1)
  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- 3. Row lock statement after advisory lock
  select * into v_stmt from statements where id = p_statement_id for update;

  if v_stmt.status != 'open' then
    raise exception '422 cannot_reconcile_non_open_statement';
  end if;

  select coalesce(reconcile_tolerance_poisha, 100) into v_tol from app_settings where id = true;
  if v_tol is null then
    v_tol := 100;
  end if;

  -- Compute live expected_poisha from active entries across covered payables
  select coalesce(sum(
    case
      when p.kind = 'vat' then e.vat_poisha
      when p.kind = 'method_charge' and e.method_id = p.method_id then e.business_charge_poisha
      else 0
    end
  ), 0) into v_live_expected
  from statement_payables sp
  join payables p on p.id = sp.payable_id
  join entries e on date_trunc('month', e.entry_date)::date = v_month and e.status = 'active'
  where sp.statement_id = p_statement_id;

  if v_stmt.source = 'manual_total' then
    -- Mode A: Totals-only
    if (select count(*) from statement_lines where statement_id = p_statement_id) > 0 then
      raise exception '422 manual_total_has_lines';
    end if;

    if v_stmt.expected_poisha != v_live_expected then
      raise exception '422 expected_poisha_mismatch';
    end if;
  else
    -- Mode B: File-based line matching (PRD §7.3 lines 1069-1076, Blocker B7)
    -- Assertion 1: Line Integrity: Every matched line references an active entry in v_month
    -- that satisfies covered payable applicability for this statement
    select count(*) into v_invalid_lines
    from statement_lines sl
    join entries e on e.id = sl.matched_entry_id
    where sl.statement_id = p_statement_id
      and sl.match_status = 'matched'
      and (
        e.status != 'active'
        or date_trunc('month', e.entry_date)::date != v_month
        or not exists (
          select 1 from statement_payables sp
          join payables p on p.id = sp.payable_id
          where sp.statement_id = p_statement_id
            and (
              (p.kind = 'vat' and e.vat_poisha > 0)
              or (p.kind = 'method_charge' and p.method_id = e.method_id and e.business_charge_poisha > 0)
            )
        )
      );

    if v_invalid_lines > 0 then
      raise exception '422 invalid_matched_entry';
    end if;

    -- Assertion 2: Statement-side: Check no unmatched statement lines remain
    select count(*) into v_unmatched_count
    from statement_lines
    where statement_id = p_statement_id
      and match_status = 'unmatched';

    if v_unmatched_count > 0 then
      raise exception '422 unmatched_statement_lines_remain';
    end if;

    -- Assertion 3: Entry-side coverage assertion (PRD §7.3 lines 1069-1076)
    -- Every active entry in v_month generating liability for this statement's payables
    -- must be either matched to an active line in THIS statement OR have an approved row in entry_reconciliation_exceptions
    select count(*) into v_uncovered_entries
    from statement_payables sp
    join payables p on p.id = sp.payable_id
    join entries e on date_trunc('month', e.entry_date)::date = v_month and e.status = 'active'
    where sp.statement_id = p_statement_id
      and (
        (p.kind = 'vat' and e.vat_poisha > 0)
        or (p.kind = 'method_charge' and p.method_id = e.method_id and e.business_charge_poisha > 0)
      )
      and not exists (
        select 1 from statement_lines sl
        where sl.statement_id = p_statement_id
          and sl.matched_entry_id = e.id
          and sl.is_active_match = true
      )
      and not exists (
        select 1 from entry_reconciliation_exceptions ere
        where ere.entry_id = e.id
          and ere.payable_id = p.id
          and ere.month = v_month
          and ere.status = 'approved'
      );

    if v_uncovered_entries > 0 then
      raise exception '422 unmatched_entries_without_approved_exceptions';
    end if;
  end if;

  -- Variance Clearance check applies to BOTH Mode A and Mode B
  if abs(v_stmt.statement_total_poisha - v_live_expected) > v_tol and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception '422 variance_exceeds_tolerance';
  end if;

  update statements
  set status = 'reconciled', expected_poisha = v_live_expected, note = coalesce(p_note, note),
      reconciled_by = p_actor_id, reconciled_at = now(), updated_at = now()
  where id = p_statement_id;

  update statement_payables set status = 'reconciled' where statement_id = p_statement_id;

  perform log_audit_event(
    p_actor_id, 'statement.reconcile', 'statements', p_statement_id::text,
    jsonb_build_object('status', v_stmt.status), jsonb_build_object('status', 'reconciled', 'note', p_note)
  );
end;
$$;

-- 18. RPC: close_month (PRD §3, §5, §7.3 lines 1035-1047, §8.4, §16.3)
create or replace function close_month(
  p_month date,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date := date_trunc('month', p_month)::date;
  v_unreconciled_count int;
  v_unapproved_overpaid int;
  v_flagged_stale int;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role != 'owner' then
    raise exception '403 unauthorized';
  end if;

  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  -- Idempotent return if already closed
  if exists (select 1 from month_closes where month = v_month and status = 'closed') then
    return;
  end if;

  -- Generate monthly settlements guarantee
  perform generate_monthly_settlements(v_month);

  -- Gate 1: Check pending stale review entries (>50k flagged)
  select count(*) into v_flagged_stale
  from entries
  where date_trunc('month', entry_date)::date = v_month
    and status = 'active'
    and stale_review_status = 'flagged';

  if v_flagged_stale > 0 then
    raise exception '422 stale_review_pending';
  end if;

  -- Gate 2: Check all payables are reconciled or not_applicable
  -- Invariant: Both child statement_payables AND parent statements must be reconciled
  select count(*) into v_unreconciled_count
  from settlements s
  where s.month = v_month
    and s.status != 'not_applicable'
    and not exists (
      select 1 from statement_payables sp
      join statements st on st.id = sp.statement_id
      where sp.payable_id = s.payable_id
        and sp.month = v_month
        and sp.status = 'reconciled'
        and st.status = 'reconciled'
    );

  if v_unreconciled_count > 0 then
    raise exception '422 unreconciled_payables_exist';
  end if;

  -- Gate 3: Check unapproved overpaid settlements
  select count(*) into v_unapproved_overpaid
  from settlements s
  where s.month = v_month
    and s.status = 'overpaid'
    and (s.overpayment_review_status != 'approved' or s.overpayment_approved_amount_poisha is distinct from (s.paid_poisha - s.expected_poisha));

  if v_unapproved_overpaid > 0 then
    raise exception '422 unapproved_overpaid_settlement';
  end if;

  insert into month_closes (month, status, closed_by, closed_at, created_at, updated_at)
  values (v_month, 'closed', p_actor_id, now(), now(), now())
  on conflict (month) do update
  set status = 'closed', closed_by = p_actor_id, closed_at = now(), reopen_reason = null, updated_at = now();

  insert into month_close_events (month, action, actor)
  values (v_month, 'close', p_actor_id);

  perform log_audit_event(
    p_actor_id, 'month.close', 'month_closes', v_month::text,
    jsonb_build_object('status', 'open'), jsonb_build_object('status', 'closed')
  );
end;
$$;

-- 19. RPC: reopen_month (PRD §7.3 lines 1048-1055)
create or replace function reopen_month(
  p_month date,
  p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller_role user_role;
  v_month date := date_trunc('month', p_month)::date;
begin

  perform set_config('clt.audit_actor', coalesce(p_actor_id::text, '')::text, true);
  select role into v_caller_role from profiles where id = p_actor_id and active = true;
  if v_caller_role != 'owner' then
    raise exception '403 unauthorized';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception '422 reason_required';
  end if;

  perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);

  if not exists (select 1 from month_closes where month = v_month and status = 'closed') then
    raise exception '422 month_not_closed';
  end if;

  update month_closes
  set status = 'open', reopened_by = p_actor_id, reopened_at = now(), reopen_reason = p_reason, updated_at = now()
  where month = v_month;

  update statements set status = 'open', updated_at = now() where month = v_month and status = 'reconciled';
  update statement_payables set status = 'open' where month = v_month and status = 'reconciled';

  insert into month_close_events (month, action, actor, reason)
  values (v_month, 'reopen', p_actor_id, p_reason);

  perform log_audit_event(
    p_actor_id, 'month.reopen', 'month_closes', v_month::text,
    jsonb_build_object('status', 'closed'), jsonb_build_object('status', 'open', 'reason', p_reason)
  );
end;
$$;

-- Revoke routine execution from public/anon/authenticated and grant exclusively to service_role
revoke execute on all routines in schema public from public, anon, authenticated;
grant execute on all routines in schema public to service_role;
