-- Center suspension enforcement (PLAN 023 §6.3, CLT-T-083): a suspended or archived center
-- accepts no business writes, from any path.
--
-- `centers.status` used to be written by PATCH /api/v1/admin/super/centers/[id] and read by
-- nothing. The app now refuses a suspended center's requests when it builds the caller
-- context (403 center_suspended), and `rpc_push_sync_op` refuses a push before parsing any
-- op. That leaves every other write: settlement payments, reconciliation, month close and
-- reopen, rate publishing, payables and settings — all reached through other RPCs or, for a
-- few admin actions, straight from a route under service_role. Adding a check to each of
-- those call sites is the change that rots: a new RPC or a new route quietly skips it.
--
-- So the refusal lives on the tables. A trigger fires before the row is validated, which
-- means a write is refused even if it would also have failed a constraint, and it covers
-- callers that never pass through a route (service_role SQL, a future migration, a manual
-- fix). The message matches the push guard, so a route that maps `center_suspended` keeps
-- working whichever layer refused.
--
-- INSERT and UPDATE only. Deletion is not business activity: nothing a user does removes a
-- row (entries are immutable, a payment correction is a reversal row, a superseded
-- statement keeps its row), and the only deletion paths are platform maintenance
-- (`maintenance_purge_entries`, fixture cleanup). Guarding DELETE would break those while
-- protecting nothing a withheld center's user could reach.
--
-- Deliberately NOT guarded, and why:
--   centers        — the status column itself; reactivation must be possible.
--   audit_log      — Hard Rule 5 requires the audit row in the same transaction. Blocking it
--                    would turn every allowed action (e.g. deactivating a user) into a
--                    failure, and would make a withheld center unauditable.
--   sync_ops       — bookkeeping for pushes that are already refused before this point, and
--                    the retention sweep writes it while the clock is paused.
--   profiles       — the platform seat must still manage people on a withheld center.
--   devices        — likewise, revocation is killswitch state and must work at any time.

create or replace function fn_center_write_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_center_id uuid;
  v_status text;
begin
  v_center_id := new.center_id;

  select status::text into v_status from centers where id = v_center_id;

  -- A center that does not exist is left to the foreign key: it already refuses the row,
  -- and its error is the one the schema's assertions pin.
  if v_status is null then
    return new;
  end if;

  if v_status <> 'active' then
    raise exception '403 %',
      case v_status
        when 'suspended' then 'center_suspended'
        when 'archived' then 'center_archived'
        else 'center_not_writable'
      end;
  end if;

  return new;
end;
$$;

revoke all on function fn_center_write_guard() from public, anon, authenticated;
grant execute on function fn_center_write_guard() to service_role;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'app_settings',
    'center_counters',
    'entries',
    'entry_reconciliation_exceptions',
    'method_rates',
    'month_close_events',
    'month_closes',
    'payables',
    'payment_methods',
    'rate_profiles',
    'settlement_payments',
    'settlements',
    'statement_lines',
    'statement_payables',
    'statements'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop trigger if exists trg_%s_center_writable on %I', v_table, v_table);
    execute format(
      'create trigger trg_%s_center_writable
         before insert or update on %I
         for each row execute function fn_center_write_guard()',
      v_table,
      v_table
    );
  end loop;
end;
$$;

comment on function fn_center_write_guard() is
  'Refuses inserts and updates to a suspended or archived center (PLAN 023 §6.3, CLT-T-083). Raises 403 center_suspended / 403 center_archived.';
