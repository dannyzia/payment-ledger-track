-- 023_super_admin_panel — steps 3 and 4 (CLT-PLAN-023)
--
-- Step 3 (suspension enforcement): fn_center_writable / fn_center_write_block_reason,
--   and a guard inside rpc_push_sync_op so a suspended or archived center accepts no
--   writes from any caller, including service_role routes. That function is no longer
--   re-created in this file: this migration sorts after 20261029000009, so a copy here
--   would replace the seat-aware body 0009 installed. It lives in
--   20261116000010_push_rpc_seat_authoritative.sql, which sorts after both.
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
