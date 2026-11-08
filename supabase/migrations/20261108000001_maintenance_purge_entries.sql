-- Maintenance: audited purge of named entries (CLT-R-029 cleanup, 2026-11-08)
--
-- Playwright seeds real rows through the normal sync path, and entries are
-- immutable by design (PRD §7.1), so test rows cannot be removed with an
-- ordinary DELETE or by voiding (void keeps the row). This routine is the
-- narrow exception, and it is deliberately hard to use:
--
--   * refuses an empty list or a reason shorter than 10 characters;
--   * refuses any month that is closed, because the close is a financial
--     assertion that deleting rows would silently contradict;
--   * refuses an entry referenced by reconciliation (statement lines or
--     exceptions), because removing it would change a reconciled total without
--     the audit trail of a reversal;
--   * takes the month lock(s) first and the sequence lock before any row lock,
--     matching the hierarchy in PRD §7.2 / AGENTS.md §4;
--   * writes one audit_log row per entry, with the full pre-delete snapshot,
--     before the row disappears — audit_log is append-only, so the evidence
--     outlives the entry;
--   * deletes the entry's sync_ops bookkeeping rows so no operation points at
--     a row that no longer exists;
--   * disables trg_entries_immutability for the delete statements only and
--     re-enables it before returning, asserting it is back on (a failure
--     anywhere else rolls back the whole transaction, including the disable);
--   * recomputes settlements for every affected month, because the
--     recalculation trigger does not fire on DELETE (CLT-R-027).
--
-- Execution is service_role only. No client route calls this; anon and
-- authenticated are revoked explicitly, matching hard rule 7.

create or replace function maintenance_purge_entries(
  p_entry_ids uuid[],
  p_reason text,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_entry entries%rowtype;
  v_month date;
  v_months date[];
  v_deleted int := 0;
  v_sync_ops int := 0;
  v_purged jsonb := '[]'::jsonb;
  v_ops int;
  v_expected_charge bigint;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    raise exception '422 empty_entry_list';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception '422 reason_required';
  end if;

  if p_actor is not null and not exists (select 1 from profiles where id = p_actor) then
    raise exception '422 unknown_actor';
  end if;

  -- Refuse the whole batch if any id is unknown: a partial purge is worse than
  -- a failed one, because the caller cannot tell which rows went.
  select count(*) into v_ops from entries where id = any(p_entry_ids);
  if v_ops <> cardinality(p_entry_ids) then
    raise exception '404 entry_not_found';
  end if;

  if exists (
    select 1 from entry_reconciliation_exceptions where entry_id = any(p_entry_ids)
    union all
    select 1 from statement_lines where matched_entry_id = any(p_entry_ids)
  ) then
    raise exception '409 entry_is_reconciled';
  end if;

  -- Step 1: month locks, ascending.
  select array_agg(distinct date_trunc('month', e.entry_date)::date
                   order by date_trunc('month', e.entry_date)::date)
    into v_months
    from entries e
   where e.id = any(p_entry_ids);

  foreach v_month in array v_months loop
    perform pg_advisory_xact_lock(
      1001,
      extract(year from v_month)::int * 12 + extract(month from v_month)::int
    );
  end loop;

  if exists (select 1 from month_closes where month = any(v_months) and status = 'closed') then
    raise exception '422 month_closed';
  end if;

  -- Step 2: sequence lock, before any row lock.
  perform pg_advisory_xact_lock(1002, 1);

  -- Step 3: row locks, then the only place in the system that deletes entries.
  foreach v_id in array p_entry_ids loop
    select * into v_entry from entries where id = v_id for update;

    delete from sync_ops where entry_id = v_id;
    get diagnostics v_ops = row_count;
    v_sync_ops := v_sync_ops + v_ops;

    perform log_audit_event(
      p_actor,
      'entry.maintenance_purge',
      'entries',
      v_id::text,
      to_jsonb(v_entry),
      jsonb_build_object(
        'reason', btrim(p_reason),
        'sync_ops_deleted', v_ops,
        'purged_at', now()
      )
    );

    alter table entries disable trigger trg_entries_immutability;
    delete from entries where id = v_id;
    get diagnostics v_ops = row_count;
    alter table entries enable trigger trg_entries_immutability;

    v_deleted := v_deleted + v_ops;
    v_purged := v_purged || jsonb_build_object(
      'entry_number', v_entry.entry_number,
      'entry_date', v_entry.entry_date,
      'gross_poisha', v_entry.gross_poisha,
      'customer_name', v_entry.customer_name,
      'sync_ops_deleted', v_ops
    );
  end loop;

  if (select tgenabled from pg_trigger where tgname = 'trg_entries_immutability') is distinct from 'O' then
    raise exception '500 immutability_trigger_not_restored';
  end if;

  -- Step 4: settlements, because DELETE does not fire the recalc trigger.
  foreach v_month in array v_months loop
    perform generate_monthly_settlements(v_month);
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted,
    'sync_ops_deleted', v_sync_ops,
    'months', to_jsonb(v_months),
    'entries', v_purged
  );
end;
$$;

revoke all on function maintenance_purge_entries(uuid[], text, uuid) from public;
revoke all on function maintenance_purge_entries(uuid[], text, uuid) from anon;
revoke all on function maintenance_purge_entries(uuid[], text, uuid) from authenticated;
grant execute on function maintenance_purge_entries(uuid[], text, uuid) to service_role;

comment on function maintenance_purge_entries(uuid[], text, uuid) is
  'Owner-authorised, audited deletion of named entries. Refuses closed months and reconciled entries; writes one audit_log row per entry; recomputes the affected months. service_role only.';
