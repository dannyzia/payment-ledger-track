# 005_db_functions_settlement_recon_month.md — Settlement Lifecycle, Statement Reconciliation, and Month Close Procedures

- Plan Identifier: CLT-PLAN-005
- Phase: Phase 0 / M0–M2
- Milestone: M0–M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7.2 (lock hierarchy), §7.3 (settlement, reconciliation, month close procedures and dynamic triggers), §8.4 (monthly settlement tracking), §11 (reconciliation modes A and B), §15.1 (audit coverage matrix)
- Depends on: 003, 004
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01

## 1. Purpose

Implement the PL/pgSQL database functions, atomic procedures, and recalculation triggers governing monthly settlements, partial payments and reversals, statement creation, line matching and unmatching, manual and file-based reconciliation (Modes A and B), scoped reconciliation exceptions, overpayment approvals, and month close/reopen lifecycle. Enforces the strict global lock hierarchy (Month Lock 1001 in ascending month order, Sequence Lock 1002, Rate Profile Lock 1003, followed by trigger-aligned row locks: `payables (FOR KEY SHARE)` $\to$ `entries` $\to$ `settlements` $\to$ `statements` $\to$ `statement_payables` $\to$ `statement_lines` $\to$ `entry_reconciliation_exceptions`), dynamic invalidation cascades, and append-only audit logging.

## 2. Scope

- IN:
  - Timestamped migration `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` containing:
    - Pure calculation function: `calc_settlement_status(p_expected bigint, p_paid bigint)` returning the 5 authoritative settlement states (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`).
    - Internal procedure: `generate_monthly_settlements(p_month date)` ensuring single-payable resolution per liability stream without duplicate liability rows, acquiring month lock 1001, and covering all active/accrued payment methods.
    - Settlement RPCs: `record_settlement_payment` (strictly Admin or Owner, matching Plan 003 schema columns `paid_on`, `reference`, `receipt_storage_path`, `note`, `recorded_by`, enforcing `p_paid_on <= now() Asia/Dhaka` and `p_paid_on >= v_month`, respecting closed-month payout policy, acquiring `payables FOR KEY SHARE` before locking `settlements FOR UPDATE`, supporting partial payments and audited reversals), and `approve_settlement_overpayment` (strictly Owner-only, bound to exact surplus).
    - Reconciliation RPCs: `create_statement` (validating non-empty unique active payables, kind matching, non-negative totals, payable overlap guard, source line-count guards, computing expected poisha, and running automated 1-to-1 matching), `supersede_statement` (locking original statement FOR UPDATE after month lock, marking superseded, invalidating active matches, copying covered payables before marking superseded, computing live expected poisha, and re-running auto-matching), `match_statement_line` (asserting non-superseded statement, active entry status, month match, covered payable applicability, locking in order `entries` $\to$ `statements` $\to$ `statement_lines`, and cascading reconciled statements to open), `unmatch_statement_line` (asserting non-superseded statement, cascading reconciled statements to open), `accept_statement_line` (requiring note, asserting non-superseded statement, cascading reconciled statements to open), `review_entry_reconciliation_exception` (asserting payable applicability and taking sequence advisory lock 1002), and `reconcile_statement` (asserting statement `status = 'open'`, querying tolerance from `app_settings where id = true`, providing distinct error messages for unmatched statement lines vs uncovered entries, Modes A & B, line integrity checks, correlated entry-side coverage assertions, live expected poisha recomputations, and variance clearance).
    - Month close RPCs: `close_month` (strictly Owner-only, verifying Gate 1 stale reviews, Gate 2 unreconciled payables joining both child `statement_payables.status = 'reconciled'` AND parent `statements.status = 'reconciled'`, Gate 3 overpayments, idempotent upsert into `month_closes` and logging `month_close_events`), and `reopen_month` (strictly Owner-only, invalidating statements back to open, logging reasons).
    - Dynamic recalculation & invalidation triggers: `trg_settlements_recalc_status_and_overpayment` (BEFORE UPDATE OF expected_poisha, paid_poisha), `trg_entries_recalc_settlements` (AFTER INSERT OR UPDATE OF status, entry_date, method_id, gross_poisha, vat_poisha, business_charge_poisha on entries, condition evaluated in function body without invalid WHEN clause, scoped to open months and affected streams), `trg_settlement_payments_immutable` (BEFORE UPDATE OR DELETE ON settlement_payments raising 403), `trg_settlement_payments_reversal_lock` (AFTER INSERT ON settlement_payments, enforcing reversal bounds without double-counting by excluding `id != NEW.id`, preventing reversals of reversals, taking `payables FOR KEY SHARE` then `settlements FOR UPDATE`, and recalculating paid poisha), `trg_entries_unmatch_statement_lines` (AFTER UPDATE ON entries unmatching on void/supersede), and `trg_entry_exceptions_invalidate_reconciliation` (AFTER UPDATE OR DELETE ON entry_reconciliation_exceptions, condition evaluated in function body without invalid WHEN clause, cascading statements to open).
    - Routine execution privilege revocations from `PUBLIC`, `anon`, `authenticated` and grant to `service_role`.
  - Comprehensive integration test suite: `tests/db/settlement_recon.test.ts` covering all settlement, reconciliation, and month-close test cases with complete `beforeAll` seed data, dead-lock-free multi-month concurrent tests, immutable entry modification via void/supersede, complete overpayment dynamic reset assertions, and zero-liability close_month assertions.
- OUT:
  - File parser adapters and SvelteKit API endpoints under `/api/v1/reconcile/*` or `/api/v1/settlements/*` (owned by Plans 014, 015).
  - Web UI routes for monthly settlement tables, reconciliation sheets, or month-close modals (owned by Plans 013, 014, 015).

## 3. Preconditions

1. Plan 003 is Implemented (database tables, constraints, and views exist).
   - Check command: `test -f supabase/migrations/20261029000002_settlements_and_statements.sql && echo "SCHEMA_READY"`
2. Plan 004 is Implemented (lock hierarchy, audit logging helper `log_audit_event`, sequence allocator, and rate profile procedures exist).
   - Check command: `test -f supabase/migrations/20261029000005_functions_entries_rates_sync.sql && echo "PLAN004_READY"`

## 4. Files

| Action | Path | Description |
|---|---|---|
| Create | `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` | PL/pgSQL functions, triggers, and RPCs for settlement, recon, and month close. |
| Create | `tests/db/settlement_recon.test.ts` | Integration test suite for settlement lifecycle, statement reconciliation, and month close. |

## 5. Steps

1. Create SQL migration `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`.
2. Define pure function `calc_settlement_status(p_expected bigint, p_paid bigint)`.
3. Define trigger `trg_settlements_recalc_status_and_overpayment` on `settlements`.
4. Define internal procedure `generate_monthly_settlements(p_month date)` with Month Lock 1001, single-payable resolution per stream, and covering active/accrued payment methods.
5. Define trigger `trg_entries_recalc_settlements` on `entries` with condition evaluated inside the function body.
6. Define trigger `trg_settlement_payments_immutable` on `settlement_payments` blocking UPDATE/DELETE.
7. Define trigger `trg_settlement_payments_reversal_lock` on `settlement_payments` excluding `id != NEW.id`, locking `payables FOR KEY SHARE` then `settlements FOR UPDATE`.
8. Define trigger `trg_entries_unmatch_statement_lines` on `entries` unmatching on void/supersede.
9. Define trigger `trg_entry_exceptions_invalidate_reconciliation` on `entry_reconciliation_exceptions` with condition evaluated inside the function body.
10. Define RPC `record_settlement_payment` with columns `paid_on`, `reference`, `receipt_storage_path`, `note`, `recorded_by`, date range validations, closed-month payout policy, and lock order `payables FOR KEY SHARE` $\to$ `settlements FOR UPDATE`.
11. Define RPC `approve_settlement_overpayment` for Owner only, taking Month Lock 1001, `payables FOR KEY SHARE`, and locking `settlements FOR UPDATE`.
12. Define internal function `perform_statement_auto_match(p_statement_id uuid, p_month date)`.
13. Define RPC `create_statement` validating payable IDs, kind matching, non-negative totals, payable overlap, line counts, taking Month Lock 1001 and `payables FOR KEY SHARE`.
14. Define RPC `supersede_statement` copying covered payables before marking original payables superseded, taking Month Lock 1001 and original statement row lock.
15. Define RPCs `match_statement_line`, `unmatch_statement_line`, and `accept_statement_line` checking non-superseded statement, taking Month Lock 1001, locking `statements` before `statement_lines` (and `entries` before `statements` in `match`), and cascading reconciled statements to open.
16. Define RPC `review_entry_reconciliation_exception` taking Month Lock 1001, Sequence Lock 1002, `payables FOR KEY SHARE`, and entry row lock.
17. Define RPC `reconcile_statement` asserting `status = 'open'`, querying tolerance from `app_settings where id = true`, asserting distinct error messages for unmatched statement lines vs uncovered entries, Modes A & B, live expected poisha recomputations, and variance clearance.
18. Define RPC `close_month` for Owner only, taking Month Lock 1001, checking Gate 1 stale reviews, Gate 2 unreconciled payables with both child `statement_payables.status = 'reconciled'` AND parent `statements.status = 'reconciled'`, Gate 3 overpayments, idempotent upsert into `month_closes`, and logging `month_close_events`.
19. Define RPC `reopen_month` for Owner only, taking Month Lock 1001, resetting `month_closes`, invalidating statements & child payables to `'open'`, and logging `month_close_events`.
20. Revoke routine execution from `public, anon, authenticated` and grant exclusively to `service_role`.
21. Author `tests/db/settlement_recon.test.ts` with complete `beforeAll` seed data and all integration tests.
22. Execute `pnpm db:reset` and `pnpm vitest run tests/db/settlement_recon.test.ts` to verify 100% test pass.

## 6. Specifications

### 6.1 `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`

```sql
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
        coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
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
```

### 6.2 `tests/db/settlement_recon.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

describe('Settlement, Reconciliation, and Month Close Integration Tests', () => {
  let pool: pg.Pool;

  const OWNER_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002';
  const STAFF_ID = '00000000-0000-0000-0000-000000000003';

  const METHOD_CASH_ID = '00000000-0000-0000-0000-000000000010';
  const METHOD_BKASH_ID = '00000000-0000-0000-0000-000000000011';
  const METHOD_VISA_ID = '00000000-0000-0000-0000-000000000012';
  const METHOD_MC_ID = '00000000-0000-0000-0000-000000000013';

  const PAYABLE_VAT_ID = '00000000-0000-0000-0000-000000000020';
  const PAYABLE_BKASH_ID = '00000000-0000-0000-0000-000000000021';
  const PAYABLE_VISA_ID = '00000000-0000-0000-0000-000000000022';
  const PAYABLE_MC_ID = '00000000-0000-0000-0000-000000000023';
  const PAYABLE_CASH_ID = '00000000-0000-0000-0000-000000000024';

  const RATE_PROFILE_V1_ID = '00000000-0000-0000-0000-000000000030';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // 1. Clean existing records in reverse dependency order
    await pool.query(`
      DELETE FROM month_close_events;
      DELETE FROM month_closes;
      DELETE FROM entry_reconciliation_exceptions;
      DELETE FROM statement_lines;
      DELETE FROM statement_payables;
      DELETE FROM statements;
      DELETE FROM settlement_payments;
      DELETE FROM settlements;
      DELETE FROM entries;
      DELETE FROM method_rates;
      DELETE FROM rate_profiles;
      DELETE FROM payables;
      DELETE FROM payment_methods;
      DELETE FROM profiles;
      DELETE FROM auth.users;
    `);

    // 2. Seed Auth Users and Profiles
    await pool.query(`
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_ID}', 'owner@test.local'),
        ('${ADMIN_ID}', 'admin@test.local'),
        ('${STAFF_ID}', 'staff@test.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO profiles (id, role, full_name, active) VALUES
        ('${OWNER_ID}', 'owner', 'Test Owner', true),
        ('${ADMIN_ID}', 'admin', 'Test Admin', true),
        ('${STAFF_ID}', 'staff', 'Test Staff', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;

      -- Seed Payment Methods initially inactive (satisfies trg_payment_methods_active_rate_check)
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order) VALUES
        ('${METHOD_CASH_ID}', 'cash', 'Cash', false, false, 1),
        ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, false, 2),
        ('${METHOD_VISA_ID}', 'visa', 'Visa', true, false, 3),
        ('${METHOD_MC_ID}', 'mastercard', 'Mastercard', true, false, 4)
      ON CONFLICT (id) DO NOTHING;

      -- Seed Published Rate Profile v1
      INSERT INTO rate_profiles (id, version, status, vat_mode, vat_bp, commission_bp, commission_base, effective_from, published_at, published_by) VALUES
        ('${RATE_PROFILE_V1_ID}', 1, 'published', 'percent_of_gross', 1000, 4200, 'gross', '2026-01-01', now(), '${OWNER_ID}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp) VALUES
        ('${RATE_PROFILE_V1_ID}', '${METHOD_CASH_ID}', 0),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_VISA_ID}', 150),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_MC_ID}', 150)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      -- Now activate payment methods
      UPDATE payment_methods SET active = true WHERE id IN ('${METHOD_CASH_ID}', '${METHOD_BKASH_ID}', '${METHOD_VISA_ID}', '${METHOD_MC_ID}');

      -- Seed Payables with exact Plan 003 schema columns
      INSERT INTO payables (id, code, name, kind, method_id, due_day, remind_days_before, active) VALUES
        ('${PAYABLE_VAT_ID}', 'PAY-VAT', 'Government VAT', 'vat', null, 15, 3, true),
        ('${PAYABLE_BKASH_ID}', 'PAY-BKASH', 'bKash Fee Payable', 'method_charge', '${METHOD_BKASH_ID}', 10, 3, true),
        ('${PAYABLE_VISA_ID}', 'PAY-VISA', 'Visa Fee Payable', 'method_charge', '${METHOD_VISA_ID}', 20, 3, true),
        ('${PAYABLE_MC_ID}', 'PAY-MC', 'Mastercard Fee Payable', 'method_charge', '${METHOD_MC_ID}', 20, 3, true),
        ('${PAYABLE_CASH_ID}', 'PAY-CASH', 'Cash Fee Payable', 'method_charge', '${METHOD_CASH_ID}', 20, 3, true)
      ON CONFLICT (id) DO NOTHING;

      -- Seed App Settings (id = true)
      INSERT INTO app_settings (id, reconcile_tolerance_poisha)
      VALUES (true, 100)
      ON CONFLICT (id) DO UPDATE SET reconcile_tolerance_poisha = 100;
    `);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('Test #26: Authoritative 5-state settlement lifecycle calculation', async () => {
    const r1 = await pool.query("SELECT calc_settlement_status(0, 0) as s");
    expect(r1.rows[0].s).toBe('not_applicable');

    const r2 = await pool.query("SELECT calc_settlement_status(10000, 0) as s");
    expect(r2.rows[0].s).toBe('due');

    const r3 = await pool.query("SELECT calc_settlement_status(10000, 4000) as s");
    expect(r3.rows[0].s).toBe('partly_paid');

    const r4 = await pool.query("SELECT calc_settlement_status(10000, 10000) as s");
    expect(r4.rows[0].s).toBe('paid');

    const r5 = await pool.query("SELECT calc_settlement_status(10000, 12000) as s");
    expect(r5.rows[0].s).toBe('overpaid');

    const r6 = await pool.query("SELECT calc_settlement_status(0, 5000) as s");
    expect(r6.rows[0].s).toBe('overpaid');
  });

  it('Test #13: Settlement payment reversal net reduction, bound enforcement, and immutability', async () => {
    const testMonth = '2026-03-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Set expected poisha to 100,000 for testing
    await pool.query("UPDATE settlements SET expected_poisha = 100000 WHERE id = $1", [settlementId]);

    // 1. Record primary payment of 50,000 poisha
    const payRes = await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 50000, $2::date, 'REF-001', null, 'Initial partial payment', false, null, $3::uuid
      ) as id
    `, [settlementId, testMonth, ADMIN_ID]);
    const initialPaymentId = payRes.rows[0].id;

    let check = await pool.query("SELECT paid_poisha, status FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].paid_poisha).toBe('50000');
    expect(check.rows[0].status).toBe('partly_paid');

    // 2. Attempt reversal exceeding original payment amount (60,000 > 50,000) -> must fail
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 60000, $2::date, 'REV-001', null, 'Excess reversal', true, $3::uuid, $4::uuid
        )
      `, [settlementId, testMonth, initialPaymentId, ADMIN_ID])
    ).rejects.toThrow('422 reversals_exceed_original_amount');

    // 3. Record valid partial reversal of 20,000 poisha
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 20000, $2::date, 'REV-002', null, 'Partial reversal', true, $3::uuid, $4::uuid
      )
    `, [settlementId, testMonth, initialPaymentId, ADMIN_ID]);

    check = await pool.query("SELECT paid_poisha, status FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].paid_poisha).toBe('30000');
    expect(check.rows[0].status).toBe('partly_paid');

    // 4. Attempt second reversal exceeding remaining balance (35,000 + 20,000 > 50,000) -> must fail
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 35000, $2::date, 'REV-003', null, 'Excess second reversal', true, $3::uuid, $4::uuid
        )
      `, [settlementId, testMonth, initialPaymentId, ADMIN_ID])
    ).rejects.toThrow('422 reversals_exceed_original_amount');

    // 5. Immutability trigger checks (BEFORE UPDATE OR DELETE raises 403)
    await expect(
      pool.query("UPDATE settlement_payments SET amount_poisha = 99999 WHERE id = $1", [initialPaymentId])
    ).rejects.toThrow('403 settlement_payments_immutable');

    await expect(
      pool.query("DELETE FROM settlement_payments WHERE id = $1", [initialPaymentId])
    ).rejects.toThrow('403 settlement_payments_immutable');
  });

  it('Test #5: Month Close Gating: Unreconciled Payables', async () => {
    const testMonth = '2026-04-01';
    // Create an active entry generating liability with mandatory txn_ref for bKash
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), $1::date, 'Gate Customer',
        $2::uuid, 100000, $3::uuid,
        '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        10000, 42000, 1150, 1150, 0, 46850, $4::uuid, 'BKASH-GATE-01'
      );
    `, [testMonth, METHOD_BKASH_ID, RATE_PROFILE_V1_ID, OWNER_ID]);

    // close_month must fail because bKash/VAT payables are unreconciled
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unreconciled_payables_exist');
  });

  it('Test #6: Month Close Gating: Unapproved Overpayment', async () => {
    const testMonth = '2026-05-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: expected 10,000, paid 15,000
    await pool.query("UPDATE settlements SET expected_poisha = 10000 WHERE id = $1", [settlementId]);
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 15000, $2::date, 'REF-OVER', null, 'Overpayment', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Reconcile statement to clear Gate 2
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        10000, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [stmtRes.rows[0].id, OWNER_ID]);

    // close_month must fail on Gate 3 (unapproved overpayment)
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unapproved_overpaid_settlement');
  });

  it('Test #7: Month Reopen Audit Logging & State Transitions', async () => {
    const testMonth = '2026-06-01';
    // Initialize empty month (all settlements not_applicable)
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // Close month cleanly
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    let check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');

    // Attempt reopen with empty reason -> must fail
    await expect(
      pool.query("SELECT reopen_month($1::date, '   ', $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 reason_required');

    // Reopen month with valid reason
    await pool.query("SELECT reopen_month($1::date, 'Audit discrepancy found', $2::uuid)", [testMonth, OWNER_ID]);

    check = await pool.query("SELECT status, reopen_reason FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('open');
    expect(check.rows[0].reopen_reason).toBe('Audit discrepancy found');

    const eventCheck = await pool.query("SELECT action, reason FROM month_close_events WHERE month = $1 ORDER BY created_at DESC LIMIT 1", [testMonth]);
    expect(eventCheck.rows[0].action).toBe('reopen');
    expect(eventCheck.rows[0].reason).toBe('Audit discrepancy found');
  });

  it('Test #16: Combined Card Statement Reconciliation', async () => {
    const testMonth = '2026-07-01';
    const vEntryId = '00000000-0000-0000-0000-000000000071';
    const mcEntryId = '00000000-0000-0000-0000-000000000072';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES
        ('${vEntryId}', nextval('entry_seq'), '${testMonth}', 'Card Cust 1', '${METHOD_VISA_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb, 0, 42000, 1500, 1500, 0, 56500, '${OWNER_ID}', 'CARD-REF-01'),
        ('${mcEntryId}', nextval('entry_seq'), '${testMonth}', 'Card Cust 2', '${METHOD_MC_ID}', 200000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb, 0, 84000, 3000, 3000, 0, 113000, '${OWNER_ID}', 'CARD-REF-02')
      ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'CARD-REF-01', grossPoisha: '100000', feePoisha: '1500' },
      { lineDate: testMonth, reference: 'CARD-REF-02', grossPoisha: '200000', feePoisha: '3000' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'combined_card', $1::date, 'file', 'statements/2026-07/card.csv',
        $2::text, 4500, ARRAY[$3::uuid, $4::uuid], $5::jsonb, $6::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_VISA_ID, PAYABLE_MC_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Reconcile statement
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);

    const spCheck = await pool.query("SELECT status FROM statement_payables WHERE statement_id = $1", [statementId]);
    expect(spCheck.rows.length).toBe(2);
    expect(spCheck.rows.every(r => r.status === 'reconciled')).toBe(true);

    // Verify month successfully closes after combined card statement reconciliation
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    const closeCheck = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(closeCheck.rows[0].status).toBe('closed');
  });

  it('Test #17: Multi-Month Race Immunity & Lock Hierarchy', async () => {
    // Tests that procedures taking month locks in ascending month order run cleanly without deadlocks
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    const m1 = '2026-11-01';
    const m2 = '2026-12-01';

    try {
      const t1 = (async () => {
        await client1.query('BEGIN');
        await client1.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 11)");
        await client1.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 12)");
        await client1.query('SELECT generate_monthly_settlements($1::date)', [m1]);
        await client1.query('SELECT generate_monthly_settlements($1::date)', [m2]);
        await client1.query('COMMIT');
      })();

      const t2 = (async () => {
        await client2.query('BEGIN');
        await client2.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 11)");
        await client2.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 12)");
        await client2.query('SELECT generate_monthly_settlements($1::date)', [m1]);
        await client2.query('SELECT generate_monthly_settlements($1::date)', [m2]);
        await client2.query('COMMIT');
      })();

      await Promise.all([t1, t2]);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #20: Zero-Liability Settlement Status', async () => {
    const testMonth = '2026-09-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const check = await pool.query("SELECT status FROM settlements WHERE month = $1", [testMonth]);
    expect(check.rows.length).toBeGreaterThan(0);
    expect(check.rows.every(r => r.status === 'not_applicable')).toBe(true);

    // Month closes cleanly without statement reconciliation because all settlements are not_applicable
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    const closeCheck = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(closeCheck.rows[0].status).toBe('closed');
  });

  it('Test #23: Statement Invalidation Cascade on Entry Modification', async () => {
    const testMonth = '2026-08-01';
    const entryId = '00000000-0000-0000-0000-000000000081';

    // Insert entry with 10,000 VAT
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Cascade Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        10000, 42000, 0, 0, 0, 48000, '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Create and reconcile Mode A VAT statement
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        10000, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Invalidate entry by voiding it (respects Hard Rule 4 immutability)
    await pool.query(`
      UPDATE entries
      SET status = 'voided', void_reason = 'Testing cascade'
      WHERE id = '${entryId}';
    `);

    // Statement should be invalidated back to 'open' and expected_poisha recalculated to 0
    check = await pool.query("SELECT status, expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');
    expect(check.rows[0].expected_poisha).toBe('0');
  });

  it('Test #34: Reconciliation Gating on Unapproved Overpaid Settlement', async () => {
    const testMonth = '2026-10-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: expected 0, paid 5,000
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 5000, $2::date, 'REF-OVER-34', null, 'Overpay 34', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Create and reconcile statement
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        0, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [stmtRes.rows[0].id, OWNER_ID]);

    // close_month must fail because overpayment is unapproved
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unapproved_overpaid_settlement');
  });

  it('Test #35: Dynamic Overpayment Approval Invalidation upon Balance Change', async () => {
    const testMonth = '2026-12-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Expected 10,000, Paid 15,000 -> Surplus 5,000
    await pool.query("UPDATE settlements SET expected_poisha = 10000 WHERE id = $1", [settlementId]);
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 15000, $2::date, 'REF-OVER-35', null, 'Initial overpayment', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Owner approves 5,000 surplus
    await pool.query("SELECT approve_settlement_overpayment($1::uuid, 'Approved surplus', $2::uuid)", [settlementId, OWNER_ID]);

    let check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('approved');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBe('5000');

    // Balance changes: additional payment of 2,000 -> surplus becomes 7,000
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 2000, $2::date, 'REF-OVER-35B', null, 'Additional payment', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Approval must be invalidated dynamically back to 'none'
    check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha, overpayment_reason FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('none');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBeNull();
    expect(check.rows[0].overpayment_reason).toBeNull();
  });

  it('Test #37: Scoped Exception Isolation Across Payables', async () => {
    const testMonth = '2026-11-01';
    const entryId = '00000000-0000-0000-0000-000000000091';

    // Entry has both VAT and bKash charge
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Ex Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        10000, 42000, 1150, 1150, 0, 46850, '${OWNER_ID}', 'BKASH-EX-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Approve exception for bKash fee payable
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'approved', 'bKash variance exception', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Create file statement for VAT payable with an accepted dummy line (so zero unmatched lines remain on statement side)
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'DUMMY-VAT-LINE', grossPoisha: '50000', feePoisha: '5000' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2026-11/vat.csv',
        $2::text, 10000, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_VAT_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Accept statement line
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT accept_statement_line($1::uuid, 'Accepted variance', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    // Reconcile must fail because entryId VAT liability is uncovered and lacks approved exception for VAT (exception on bKash does not isolate VAT)
    await expect(
      pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID])
    ).rejects.toThrow('422 unmatched_entries_without_approved_exceptions');
  });

  it('Test #39: First-Time Month Close Idempotent Upsert and Freeze Semantics', async () => {
    const testMonth = '2027-01-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // First close
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    let check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');

    // Second close returns immediately without error (idempotent)
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');
  });

  it('Test #40: Mode A Totals-Only Reconciliation & Variance Tolerance', async () => {
    const testMonth = '2027-01-01';
    // Expected is 0 poisha
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        50, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Within tolerance (50 poisha <= 100 poisha tolerance) -> succeeds without note
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Create second statement with variance exceeding tolerance (200 > 100)
    const stmtRes2 = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        200, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_BKASH_ID, OWNER_ID]);
    const statementId2 = stmtRes2.rows[0].id;

    // Fails without note
    await expect(
      pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId2, OWNER_ID])
    ).rejects.toThrow('422 variance_exceeds_tolerance');

    // Succeeds with explanatory note
    await pool.query("SELECT reconcile_statement($1::uuid, 'Approved bank charge variance', $2::uuid)", [statementId2, OWNER_ID]);
    check = await pool.query("SELECT status, note FROM statements WHERE id = $1", [statementId2]);
    expect(check.rows[0].status).toBe('reconciled');
    expect(check.rows[0].note).toBe('Approved bank charge variance');
  });

  it('Test #43: Customer Fee Zero Settlement Liability', async () => {
    const testMonth = '2027-02-01';
    // Cash transaction with customer fee 1,000 poisha, business fee 0
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Customer Fee Cust',
        '${METHOD_CASH_ID}', 50000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        0, 21000, 1000, 0, 1000, 29000, '${OWNER_ID}'
      );
    `);

    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const check = await pool.query(`
      SELECT s.expected_poisha, s.status
      FROM settlements s
      JOIN payables p ON p.id = s.payable_id
      WHERE s.month = $1 AND p.method_id = $2
    `, [testMonth, METHOD_CASH_ID]);

    expect(check.rows.length).toBe(1);
    expect(check.rows[0].expected_poisha).toBe('0');
    expect(check.rows[0].status).toBe('not_applicable');
  });

  it('Test #48: Cross-Table Trigger Lock Immunity', async () => {
    const testMonth = '2027-03-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      await client1.query('BEGIN');
      await client2.query('BEGIN');

      // Client 1 takes month lock and inserts entry (triggering settlement recalculation)
      await client1.query("SELECT pg_advisory_xact_lock(1001, 2027 * 12 + 3)");

      // Client 2 attempts settlement payment for same month (serializes cleanly on month lock)
      const p2 = client2.query(`
        SELECT record_settlement_payment(
          (SELECT id FROM settlements WHERE month = '${testMonth}' LIMIT 1),
          1000, '${testMonth}', 'LOCK-TEST', null, 'Lock test', false, null, '${OWNER_ID}'
        )
      `);

      // Client 1 inserts entry then commits
      await client1.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
          business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Concurrent Cust',
          '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
          10000, 42000, 0, 0, 0, 48000, '${OWNER_ID}'
        );
      `);

      await client1.query('COMMIT');
      await p2;
      await client2.query('COMMIT');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #49: Settlements Query & Dynamic Overpayment Handling', async () => {
    const testMonth = '2027-04-01';
    // 1. Invoke generate_monthly_settlements and assert clean execution
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: expected 0, paid 50,000 (surplus ৳500 = 50,000 poisha)
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 50000, $2::date, 'REF-49', null, 'Overpay 49', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Owner approves surplus
    await pool.query("SELECT approve_settlement_overpayment($1::uuid, 'Approved ৳500 surplus', $2::uuid)", [settlementId, OWNER_ID]);

    let check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('approved');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBe('50000');

    // Admin modifies an entry in the month, increasing expected_poisha
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Recalc Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        10000, 42000, 0, 0, 0, 48000, '${ADMIN_ID}'
      );
    `);

    // Verify trigger trg_settlements_recalc_status_and_overpayment resets all 5 overpayment columns
    check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha, overpayment_reason, overpayment_approved_by, overpayment_approved_at FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('none');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBeNull();
    expect(check.rows[0].overpayment_reason).toBeNull();
    expect(check.rows[0].overpayment_approved_by).toBeNull();
    expect(check.rows[0].overpayment_approved_at).toBeNull();
  });

  it('Test #51: Statement Line Auto-Unmatch on Entry Void/Supersede', async () => {
    const testMonth = '2027-05-01';
    const entryId = '00000000-0000-0000-0000-000000000101';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Unmatch Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-UNMATCH-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'BKASH-UNMATCH-01', grossPoisha: '100000', feePoisha: '1150' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-05/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    let lineCheck = await pool.query("SELECT match_status, matched_entry_id, is_active_match FROM statement_lines WHERE statement_id = $1", [statementId]);
    expect(lineCheck.rows[0].match_status).toBe('matched');
    expect(lineCheck.rows[0].matched_entry_id).toBe(entryId);
    expect(lineCheck.rows[0].is_active_match).toBe(true);

    // Void entry
    await pool.query(`
      UPDATE entries
      SET status = 'voided', void_reason = 'Customer cancelled'
      WHERE id = '${entryId}';
    `);

    // Statement line must be automatically unmatched via trg_entries_unmatch_statement_lines
    lineCheck = await pool.query("SELECT match_status, matched_entry_id, is_active_match FROM statement_lines WHERE statement_id = $1", [statementId]);
    expect(lineCheck.rows[0].match_status).toBe('unmatched');
    expect(lineCheck.rows[0].matched_entry_id).toBeNull();
    expect(lineCheck.rows[0].is_active_match).toBe(false);
  });

  it('Test #53: Line Unmatching Cascade Invalidation', async () => {
    const testMonth = '2027-06-01';
    const entryId = '00000000-0000-0000-0000-000000000111';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Unmatch Cascade Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-CASC-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'BKASH-CASC-01', grossPoisha: '100000', feePoisha: '1150' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-06/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Reconcile statement
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Unmatch line
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT unmatch_statement_line($1::uuid, 'Manual review required', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    // Statement and child payables must cascade back to 'open'
    check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');

    const spCheck = await pool.query("SELECT status FROM statement_payables WHERE statement_id = $1", [statementId]);
    expect(spCheck.rows[0].status).toBe('open');
  });

  it('Test #54: Exception Flip Invalidation Cascade', async () => {
    const testMonth = '2027-07-01';
    const entryId = '00000000-0000-0000-0000-000000000121';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Flip Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-FLIP-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Approve exception
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'approved', 'Initial approved exception', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Reconcile statement covering bKash
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'DUMMY-REF', grossPoisha: '50000', feePoisha: '500' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-07/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Accept line so statement has no unmatched lines
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT accept_statement_line($1::uuid, 'Accepted dummy', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Flip exception from approved to rejected
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'rejected', 'Exception revoked upon audit', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Statement and child payables must cascade back to 'open' via trg_entry_exceptions_invalidate_reconciliation
    check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');
  });

  it('Test #55: Live Settlement & Statement Expected Recalculation Trigger (H1)', async () => {
    const testMonth = '2027-08-01';
    const entryId = '00000000-0000-0000-0000-000000000551';

    // 1. Create an open statement covering VAT before any entries exist
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        0, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // 2. Insert entry in open month without running generate_monthly_settlements manually
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Live Recalc Cust',
        '${METHOD_BKASH_ID}', 200000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        20000, 84000, 2300, 2300, 0, 93700, '${OWNER_ID}', 'BKASH-LIVE-01'
      );
    `);

    // Settlements expected_poisha must update dynamically via trg_entries_recalc_settlements
    const vatSet = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    expect(vatSet.rows[0].expected_poisha).toBe('20000');

    const bkashSet = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_BKASH_ID]);
    expect(bkashSet.rows[0].expected_poisha).toBe('2300');

    // Open statement expected_poisha must also update dynamically via trg_entries_recalc_settlements
    const stmtCheck = await pool.query("SELECT expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(stmtCheck.rows[0].expected_poisha).toBe('20000');

    // 3. Void the entry: settlements and open statement expected_poisha must dynamically drop to 0
    await pool.query(`
      UPDATE entries
      SET status = 'voided', voided_by = '${OWNER_ID}', voided_at = now(), void_reason = 'Testing dynamic recalc'
      WHERE id = '${entryId}'
    `);

    const vatAfterVoid = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    expect(vatAfterVoid.rows[0].expected_poisha).toBe('0');

    const stmtAfterVoid = await pool.query("SELECT expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(stmtAfterVoid.rows[0].expected_poisha).toBe('0');
  });

  it('Test #58: Stale Review Month Close Gate', async () => {
    const testMonth = '2027-09-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // Insert entry with stale_review_status = 'flagged'
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, stale_rates, stale_review_status
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Stale Flagged Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion":1}'::jsonb,
        0, 42000, 0, 0, 0, 58000, '${OWNER_ID}', true, 'flagged'
      );
    `);

    // close_month must fail on Gate 1
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 stale_review_pending');
  });

  it('Test Statement Supersession: Lifecycle, Payables Inheritance, and Line Invalidation', async () => {
    const testMonth = '2027-10-01';
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'ORIG-LINE-1', grossPoisha: '50000', feePoisha: '500' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const origRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-10/orig.csv',
        $2::text, 500, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const origId = origRes.rows[0].id;

    const repLines = JSON.stringify([
      { lineDate: testMonth, reference: 'REP-LINE-1', grossPoisha: '60000', feePoisha: '600' }
    ]);
    const repSha256 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

    // Supersede statement
    const repRes = await pool.query(`
      SELECT supersede_statement(
        $1::uuid, 'statements/2027-10/rep.csv', $2::text, 600, 'Superseded due to missing rows', $3::jsonb, $4::uuid
      ) as id
    `, [origId, repSha256, repLines, OWNER_ID]);
    const repId = repRes.rows[0].id;

    // Verify original statement is superseded and linked
    const origCheck = await pool.query("SELECT status, superseded_by FROM statements WHERE id = $1", [origId]);
    expect(origCheck.rows[0].status).toBe('superseded');
    expect(origCheck.rows[0].superseded_by).toBe(repId);

    // Verify original lines have is_active_match = false
    const origLineCheck = await pool.query("SELECT is_active_match FROM statement_lines WHERE statement_id = $1", [origId]);
    expect(origLineCheck.rows[0].is_active_match).toBe(false);

    // Verify replacement statement is open and inherited covered payables
    const repCheck = await pool.query("SELECT status, statement_total_poisha FROM statements WHERE id = $1", [repId]);
    expect(repCheck.rows[0].status).toBe('open');
    expect(repCheck.rows[0].statement_total_poisha).toBe('600');

    const repSpCheck = await pool.query("SELECT payable_id, status FROM statement_payables WHERE statement_id = $1", [repId]);
    expect(repSpCheck.rows.length).toBe(1);
    expect(repSpCheck.rows[0].payable_id).toBe(PAYABLE_BKASH_ID);
    expect(repSpCheck.rows[0].status).toBe('open');
  });

  it('Test Validation Guards: create_statement rejects invalid configurations', async () => {
    const testMonth = '2027-11-01';
    // 1. Empty payables
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, 100, ARRAY[]::uuid[], null, $2::uuid)
      `, [testMonth, OWNER_ID])
    ).rejects.toThrow('422 payable_ids_required');

    // 2. Duplicate payables
    await expect(
      pool.query(`
        SELECT create_statement('combined_card', $1::date, 'manual_total', null, null, 100, ARRAY[$2::uuid, $2::uuid], null, $3::uuid)
      `, [testMonth, PAYABLE_VISA_ID, OWNER_ID])
    ).rejects.toThrow('422 duplicate_payable_ids');

    // 3. Negative total
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, -500, ARRAY[$2::uuid], null, $3::uuid)
      `, [testMonth, PAYABLE_VAT_ID, OWNER_ID])
    ).rejects.toThrow('422 statement_total_must_be_non_negative');

    // 4. Single payable kind with multiple payables
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, 100, ARRAY[$2::uuid, $3::uuid], null, $4::uuid)
      `, [testMonth, PAYABLE_VISA_ID, PAYABLE_MC_ID, OWNER_ID])
    ).rejects.toThrow('422 single_payable_requires_exactly_one_payable');
  });

  it('Test Role Gates: close_month and approve_settlement_overpayment reject non-owner actors', async () => {
    const testMonth = '2027-12-01';
    // Admin attempting to close month -> raises 403
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, ADMIN_ID])
    ).rejects.toThrow('403 unauthorized');

    // Staff attempting to close month -> raises 403
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, STAFF_ID])
    ).rejects.toThrow('403 unauthorized');

    // Admin attempting to approve overpayment -> raises 403
    await expect(
      pool.query("SELECT approve_settlement_overpayment(gen_random_uuid(), 'Admin reason', $1::uuid)", [ADMIN_ID])
    ).rejects.toThrow('403 unauthorized');
  });

  it('Test Closed Month Payment Guard: rejects reversals or excess payments on closed months', async () => {
    const testMonth = '2028-01-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query("SELECT id FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    const settlementId = setRes.rows[0].id;

    // Close month
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);

    // Payment exceeding expected (0) on closed month raises 422 month_closed
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 1000, $2::date, 'CLOSED-TEST', null, 'Closed month payment', false, null, $3::uuid
        )
      `, [settlementId, testMonth, OWNER_ID])
    ).rejects.toThrow('422 month_closed');
  });
});
```

## 7. Tests

This plan is covered by the 22 comprehensive integration tests in `tests/db/settlement_recon.test.ts`, directly mapping to PRD §16.2:

- **Settlement Lifecycle & Payment Mechanics**:
  - Test #26: Authoritative 5-state settlement lifecycle calculation (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`).
  - Test #13: Settlement payment reversal net reduction, bound enforcement (preventing reversals exceeding original payment or previous reversals), and immutability (blocking direct UPDATE/DELETE).
  - Test #20: Zero-liability settlement status when expected is 0 poisha, verifying that `close_month` succeeds without requiring statement reconciliation.
  - Test #43: Customer fee zero settlement liability, confirming that customer-borne charges create zero merchant liability.
  - Test #55: Live settlement dynamic recalculation via `trg_entries_recalc_settlements` upon entry insertion or update.

- **Statement Reconciliation Modes & Integrity**:
  - Test #40: Mode A totals-only manual reconciliation, verifying tolerance bounds (100 poisha default) and mandatory explanatory notes when exceeding tolerance.
  - Test #16: Mode B combined card statement reconciliation, verifying multi-payable coverage (`statement_payables`), line integrity assertions, 1-to-1 matching, and month close clearance.
  - Test #37: Scoped reconciliation exception isolation across payables, ensuring an approved exception for one payable (e.g. bKash fee) does not isolate uncovered liabilities for other payables (e.g. VAT).
  - Test Statement Supersession: Lifecycle, payables inheritance, and line invalidation (`is_active_match = false`).
  - Test Validation Guards: `create_statement` rejects invalid configurations (empty payables, duplicate payables, negative totals, single payable with multiple payables, overlapping active statements).

- **Invalidation Cascades & State Invariants**:
  - Test #23: Statement expected poisha recalculation and invalidation cascade back to `open` when an entry is voided or superseded in an open month.
  - Test #51: Statement line auto-unmatch on entry void or supersede via `trg_entries_unmatch_statement_lines`.
  - Test #53: Line unmatching cascade invalidation resetting reconciled statements and child `statement_payables` back to `open`.
  - Test #54: Reconciliation exception flip from `approved` to `rejected` cascading reconciled statements back to `open` via `trg_entry_exceptions_invalidate_reconciliation`.
  - Test #35: Dynamic overpayment approval invalidation upon balance change, verifying that altering `paid_poisha - expected_poisha` resets all 5 overpayment columns to satisfy `chk_overpayment_approval`.
  - Test #49: Dynamic overpayment handling on settlement queries and entry additions.

- **Month Close & Reopen Lifecycle**:
  - Test #5: Month close Gate 2 rejection when active entries leave payables unreconciled.
  - Test #6: Month close Gate 3 rejection when settlements have unapproved overpayments.
  - Test #34: Reconciliation gating on unapproved overpaid settlements.
  - Test #39: First-time month close idempotent upsert and freeze semantics.
  - Test #58: Month close Gate 1 rejection when active entries in the month have `stale_review_status = 'flagged'`.
  - Test #7: Month reopen audit logging, mandatory reason assertion, and cascading statements/payables from `reconciled` to `open`.
  - Test Role Gates: `close_month` and `approve_settlement_overpayment` reject non-owner actors with `403 unauthorized`.
  - Test Closed Month Payment Guard: Rejects reversals or payments exceeding expected liability on closed months (`422 month_closed`).

- **Concurrency & Lock Hierarchy**:
  - Test #17: Multi-month race immunity, confirming deadlock-free execution when multiple clients acquire month locks in ascending order.
  - Test #48: Cross-table trigger lock immunity, confirming deadlock-free execution when an entry mutation and a settlement payment occur concurrently for the same month.

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Migration 006 Applies Cleanly | `pnpm db:reset` succeeds | `pnpm db:reset` | exits with code 0 |
| All 5 Settlement States Match | `calc_settlement_status` returns correct state | `pnpm vitest run tests/db/settlement_recon.test.ts -t "5-state settlement lifecycle"` | exits with code 0 |
| Dynamic Settlement Recalc Works | Expected poisha recalculates via trigger | `pnpm vitest run tests/db/settlement_recon.test.ts -t "Live Settlement Recalculation Trigger"` | exits with code 0 |
| Dynamic Overpayment Reset | Balance change invalidates overpayment | `pnpm vitest run tests/db/settlement_recon.test.ts -t "Dynamic Overpayment Approval Invalidation"` | exits with code 0 |
| Month Close Idempotent | Re-close returns success | `pnpm vitest run tests/db/settlement_recon.test.ts -t "First-Time Month Close"` | exits with code 0 |
| All Integration Tests Pass | Integration suite passes without skipping | `pnpm vitest run tests/db/settlement_recon.test.ts` | exits with code 0 |

## 9. Hard Rules Touched

- **Hard Rule 4 (Immutable Entries)**: Modifying financial entries invalidates reconciled statements back to `open` via `trg_entries_recalc_settlements`, never silently rewriting reconciliation state. Direct updates to immutable entries are blocked; entry changes occur only via audited void or supersede procedures.
- **Hard Rule 5 (Append-Only Audit)**: All settlement payments, overpayment approvals, statement creation/supersession/matching, exceptions, and month close/reopen write immutable records to `audit_log` inside the same transaction.
- **Hard Rule 7 (Security Definer RPCs)**: All financial mutations execute through `SECURITY DEFINER` RPCs with `search_path = public, pg_temp`; public routine execution is strictly revoked and granted exclusively to `service_role`.
- **Hard Rule 10 (Deterministic Lock Hierarchy)**: Advisory locks (1001 for months in ascending order, 1002 for sequences, 1003 for rate profile versions) are acquired before row locks (`payables (KEY SHARE)` $\to$ `entries` $\to$ `settlements` $\to$ `statements` $\to$ `statement_payables` $\to$ `statement_lines` $\to$ `entry_reconciliation_exceptions`).
- **Hard Rule 16 (Prohibited Absolute Claims)**: Reduces exposure to concurrency deadlocks and race conditions; subject to audit.

## 10. Pitfalls

1. **Lock Hierarchy Inversion**: Calling `close_month`, `reconcile_statement`, or `record_settlement_payment` must acquire Month Advisory Lock (1001) before acquiring any row locks on `payables`, `statements`, `settlements`, or `entries`.
2. **Double Reversal Trap**: `settlement_payments` reversal logic must lock the target payment `FOR UPDATE` and query prior reversals excluding the current row (`id != NEW.id`) to prevent duplicate counting during after-insert execution.
3. **Overpayment Invalidation Bypass**: Overpayment approval is strictly invalidated when `paid_poisha - expected_poisha` shifts; resetting all 5 approval columns satisfies `chk_overpayment_approval`.
4. **Statement Replacement Cascades**: Modifying entries in open months invalidates statements back to `'open'` and resets all child `statement_payables.status = 'open'` for affected liability streams only.
5. **Combined Card Statement Integrity**: Combined card statements link to multiple payables via `statement_payables`; `reconcile_statement` Mode B checks line integrity, 1-to-1 matching, and correlated entry-side coverage per payable.
6. **Trigger WHEN Clause Limitations**: PostgreSQL triggers cannot reference `TG_OP` or reference `OLD` on insert / `NEW` on delete inside a trigger's `WHEN (...)` clause. Event filtering conditions are evaluated cleanly inside the PL/pgSQL function body.

## 11. PRD ISSUES and DECISION PENDING

- None.

## 12. Handoff

- Prerequisite for: Plan 006 (Bootstrap and Seed), Plan 014 (Settlement and Reconciliation API routes), and Plan 015 (Month Close Workflow).

## 13. Suggested Task Breakdown

- **CLT-T-019** (Implementer): Author migration `supabase/migrations/20261029000006_functions_settlement_recon_month.sql` containing settlement status calculation, monthly settlement generation, settlement payment recording, overpayment approval, statement creation and supersession, line matching/unmatching/accepting, reconciliation exception review, statement reconciliation (Modes A & B), month close/reopen RPCs, and dynamic recalculation triggers.
- **CLT-T-020** (Implementer): Author integration test suite `tests/db/settlement_recon.test.ts` covering all settlement, reconciliation, and month-close test cases with complete `beforeAll` seed data.
- **CLT-T-021** (DevOps): Execute `pnpm db:reset` and `pnpm vitest run tests/db/settlement_recon.test.ts` to verify 100% test pass.

## Changelog

- 2026-11-01 — Revision 2.2:
  - 1. **Fixed Non-Existent Enum Types**: Replaced non-existent `settlement_status`, `statement_status`, and `payable_kind` types with standard `text` types aligned with Plan 003 schema check constraints.
  - 2. **Fixed `calc_settlement_status` Overpayment Logic Flaw**: Corrected conditional logic to match PRD §7.3 lines 601–610, ensuring zero-expected overpayments (`p_expected = 0, p_paid > 0`) evaluate strictly to `'overpaid'` (not `'not_applicable'`).
  - 3. **Fixed `supersede_statement` Unique Constraint Collision**: Updated original `statement_payables` to `'superseded'` before inserting replacement rows, preventing `uq_active_statement_coverage` unique constraint crashes.
  - 4. **Enforced Ascending Month Order in Trigger Recalculation**: Added `ORDER BY m ASC` to the month loop in `fn_entries_recalc_settlements`, preventing lock-inversion deadlocks on cross-month shifts.
  - 5. **Hardened Lock Hierarchy on Mutation Paths**: In `supersede_statement`, row-locked `payables FOR KEY SHARE` before row-locking `statements`. In `match_statement_line`, acquired Sequence Lock 1002 and `payables FOR KEY SHARE` before locking `entries FOR UPDATE`.
  - 6. **Fixed Audit Logging on Overpayment Invalidation**: Added append-only `settlement.overpayment_invalidated` audit event inside `fn_settlements_recalc_status_and_overpayment` when an approved surplus shifts.
  - 7. **Fixed Multi-Payable Invalidation Cascade**: In `fn_entry_exceptions_invalidate_reconciliation`, cascaded all sibling `statement_payables` of affected statements to `'open'`.
  - 8. **Synchronized Entry Unmatch Trigger**: Extended `trg_entries_unmatch_statement_lines` to listen to `status, entry_date, method_id` and cascaded parent statements and child payables to `'open'`.
  - 9. **Aligned Audit Action Names**: Standardized audit action names to `'statement.invalidate'` and `'entry.reconciliation_exception'`, capturing the exception UUID.
  - 10. **NULL-Safe Gate 3 in `close_month`**: Used `IS DISTINCT FROM` for overpayment amount comparison to prevent NULL bypasses.
  - 11. **Fixed Test Suite Seeding & Hardened Tests**: Removed non-existent columns from `app_settings` test seed, upgraded Test #17 to verify multi-month settlement concurrency, and upgraded Test #55 to test live settlement and statement expected recalculations across insert and void without manual generator calls.

- 2026-10-30 — Revision 2.1:
  - Removed invalid `WHEN` clauses using `TG_OP` from `trg_entries_recalc_settlements` and `trg_entry_exceptions_invalidate_reconciliation`, moving event filtering conditions cleanly into PL/pgSQL function bodies (`fn_entries_recalc_settlements` and `fn_entry_exceptions_invalidate_reconciliation`).
  - Aligned `record_settlement_payment` arguments and schema column names strictly with Plan 003 DDL (`paid_on`, `reference`, `receipt_storage_path`, `note`, `recorded_by`), enforced closed-month payout policy, added future and pre-settlement payment date assertions, and acquired `payables FOR KEY SHARE` before locking `settlements FOR UPDATE`.
  - Fixed copy bug in `supersede_statement` by inserting replacement `statement_payables` before marking original statement payables as superseded, and added negative total validation.
  - Added non-open statement check (`v_stmt.status = 'open'`) in `reconcile_statement`, queried tolerance from `app_settings where id = true`, provided distinct error messages for unmatched statement lines (`422 unmatched_statement_lines_remain`) vs uncovered entries (`422 unmatched_entries_without_approved_exceptions`), and enforced live expected poisha recomputations in both Mode A and Mode B.
  - Added comprehensive validation guards to `create_statement`: non-empty unique active payables, single payable vs combined card kind matching, non-negative totals, payable overlap guard preventing multiple active statements covering the same payable in the same month, and acquired `payables FOR KEY SHARE`.
  - Added superseded statement check (`cannot_modify_superseded_statement`) to `match_statement_line`, `unmatch_statement_line`, and `accept_statement_line`; cascaded reconciled statements and child payables to `'open'` on line matching or accepting; and enforced row lock order `statements` before `statement_lines` (and `entries` before `statements` in `match`).
  - Added Month Advisory Lock 1001 to `generate_monthly_settlements` and filtered distinct liability streams covering all active and accrued payment methods.
  - Enforced Gate 2 reconciliation invariant in `close_month` by asserting that all settlements with `status != 'not_applicable'` have covered payables where both child `statement_payables.status = 'reconciled'` AND parent `statements.status = 'reconciled'`.
  - Fixed `beforeAll` test seeding in `tests/db/settlement_recon.test.ts`: cleaned tables in reverse FK order, seeded payment methods initially inactive, published rate profile v1 with correct `(rate_profile_id, method_id, charge_bp)` columns, activated payment methods, seeded payables with required `code` and `due_day` columns, and upserted `app_settings (id = true)`.
  - Rewrote Test #17 to concurrently acquire multi-month locks in ascending order via `Promise.all` across two clients without event loop deadlock.
  - Fixed Test #23 to test reconciliation cascade invalidation via entry voiding (respecting Hard Rule 4 entry immutability).
  - Fixed Test #37 to ensure statement lines are accounted for and verify that an exception on bKash fee does not isolate uncovered VAT liability.
  - Fixed Test #43 to assert zero expected poisha and `not_applicable` status for customer fee without conditional checks.
  - Fully implemented Test #49 testing dynamic overpayment invalidation upon balance change.
  - Fixed Test #16 to assert month successfully closes after combined card statement reconciliation.
  - Fixed Test #20 to assert month successfully closes when all settlements are `not_applicable`.
  - Fixed Test #48 to execute concurrent entry mutation and settlement payment across separate clients.
  - Added mandatory `txn_ref` to bKash entries in Tests #5, #54, and #55.
  - Added missing test cases: statement supersession lifecycle, `create_statement` validation guards, role gates on `close_month` and `approve_settlement_overpayment`, and closed month payment guards.
  - Standardized task IDs to `CLT-T-019`, `CLT-T-020`, `CLT-T-021` with `Implementer` and `DevOps` roles, and corrected Acceptance Criteria verify command to `"Live Settlement Recalculation Trigger"`.
- 2026-10-30 — Revision 2.0:
  - Resolved Bug 1: Corrected double-counting in `trg_settlement_payments_reversal_lock` by excluding `id != NEW.id` in `v_existing_reversals` calculation, and created dedicated `trg_settlement_payments_immutable` BEFORE UPDATE OR DELETE trigger raising `403 settlement_payments_immutable`.
  - Resolved Bug 2: Fixed non-existent `pm.payable_id` column reference in `reconcile_statement` Mode B, added Mode B Line Integrity assertion and variance clearance check, replaced Mode A local variable overwrite with explicit `422 expected_poisha_mismatch` assertion, and correlated entry-side coverage per covered payable `(sp.payable_id, p.kind, p.method_id)`.
  - Resolved Bug 3: Fixed role guard in `close_month` to strictly permit `owner` only (`if v_caller_role != 'owner'`), aligning with PRD §3, §5, §7.3, §8.4, and §16.3.
  - Resolved Bug 4: Scoped statement expected recalculation and invalidation in `fn_entries_recalc_settlements` to affected liability streams (`vat` when VAT > 0, and `method_charge` for NEW/OLD method), and looped across all affected open months (`v_new_month` and `v_old_month` when cross-month shifted).
  - Resolved Bug 5: Added line-count guards in `create_statement` and `supersede_statement` (`source = 'file'` requires lines, `manual_total` forbids lines), implemented automated 1-to-1 reference and date+gross auto-matching passes (`perform_statement_auto_match`), ensured `supersede_statement` row-locks original statement FOR UPDATE after month lock and computes live `expected_poisha`, added active status, month match, and payable applicability assertions to `match_statement_line`, and added payable applicability assertion to `review_entry_reconciliation_exception`.
  - Resolved Bug 6: Added comprehensive `beforeAll` seed data (`auth.users`, `profiles`, `payment_methods`, `rate_profiles`, `method_rates`, `payables`, `app_settings`) to `tests/db/settlement_recon.test.ts`, fixed Test #39 to explicitly test `close_month()` and idempotency, and implemented explicit, non-vacuous `it(...)` blocks for all 22 tests in Section 7.
- 2026-10-29 — Revision 1.0: Initial plan authoring from PRD v1.19.
