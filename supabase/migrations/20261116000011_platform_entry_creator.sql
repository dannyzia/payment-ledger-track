-- Plan 023 §6.7: a platform-created entry records the super-admin seat as `created_by`.
--
-- `fk_entries_creator` was `(center_id, created_by) -> profiles (center_id, id)`. A
-- super_admin has `profiles.center_id` NULL, so no pair `(<center>, <seat>)` can ever
-- exist: `rpc_push_sync_op` and `rpc_supersede_entry` both admit the seat at their role
-- gate, then the insert is refused by the foreign key. The constraint contradicted the
-- approved design, and it is what made the seat's push and supersede unusable even
-- after the push RPC was given its seat-aware body in
-- 20261116000010_push_rpc_seat_authoritative.sql.
--
-- The creator reference now points at `profiles (id)`, which admits a platform profile,
-- and a trigger carries the tenant rule the composite key used to enforce: a creator
-- that belongs to a center must belong to *this* entry's center. Only the platform seat
-- has no center, and it reaches these writes through SECURITY DEFINER RPCs whose role
-- gates admit it. Nothing else about the column changes.
--
-- Decision: CLT-D-039 (DECISIONS.md).

alter table entries drop constraint if exists fk_entries_creator;

-- Same constraint name, so the FK error a centre caller sees keeps its old name.
alter table entries
  add constraint fk_entries_creator foreign key (created_by) references profiles (id);

comment on constraint fk_entries_creator on entries is
  'Creator profile. Center-scoped creators must belong to the entry''s center; the platform seat (center_id NULL) is the only creator without one (trg_entries_creator_center).';

create or replace function fn_entries_creator_center_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_creator_center uuid;
begin
  select center_id into v_creator_center from profiles where id = new.created_by;
  if not found then
    raise exception '422 entry_creator_not_found';
  end if;

  -- NULL is the platform seat. Anything else must be scoped to this entry's center,
  -- which is the rule the old composite foreign key encoded.
  if v_creator_center is not null and v_creator_center <> new.center_id then
    raise exception '409 entry_creator_center_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_entries_creator_center on entries;
create trigger trg_entries_creator_center
  before insert or update of created_by, center_id on entries
  for each row execute function fn_entries_creator_center_guard();

-- Hard Rule 7: no routine is callable by PUBLIC, anon or authenticated. A trigger
-- function does not need EXECUTE for the trigger to fire, so this only closes the
-- default grant `create function` hands out.
revoke all on function fn_entries_creator_center_guard() from public;
revoke all on function fn_entries_creator_center_guard() from anon;
revoke all on function fn_entries_creator_center_guard() from authenticated;
