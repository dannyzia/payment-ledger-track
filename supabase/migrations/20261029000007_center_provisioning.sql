-- Migration: 20261029000007_center_provisioning.sql
-- Description: Atomic day-zero provisioning of a new center (design §5, PRD §7.4).
-- Creates the center, canonical 5 payment methods (cash, bkash, visa, mastercard,
-- bank_transfer), canonical 4 payables (vat_payable, bkash_charge_payable,
-- visa_charge_payable, mastercard_charge_payable), published rate profile v1,
-- method rates, settings, and entry counter in one transaction.
-- service_role only; the calling actor must be a platform super_admin.

create or replace function rpc_create_center(
  p_actor_id uuid,
  p_code varchar(8),
  p_name text,
  p_legal_entity_name text,
  p_bin_number varchar(16),
  p_trade_license varchar(32),
  p_address text,
  p_phone varchar(20),
  p_owner_email text,
  p_owner_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role user_role;
  v_center_id uuid;
  v_center_code varchar(8);
  v_cash_id uuid;
  v_bkash_id uuid;
  v_visa_id uuid;
  v_master_id uuid;
  v_bank_transfer_id uuid;
  v_rate_profile_id uuid;
begin
  -- 1. Only a platform super_admin (center_id IS NULL) may provision a center.
  select role into v_actor_role
  from profiles
  where id = p_actor_id and center_id is null and active = true;

  if v_actor_role is distinct from 'super_admin' then
    raise exception '403 unauthorized';
  end if;

  if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9]{2,8}$' then
    raise exception '422 invalid_center_code';
  end if;

  if p_name is null or length(btrim(p_name)) = 0
     or p_legal_entity_name is null or length(btrim(p_legal_entity_name)) = 0
     or p_address is null or length(btrim(p_address)) = 0
     or p_phone is null or length(btrim(p_phone)) = 0 then
    raise exception '422 missing_center_profile_fields';
  end if;

  if exists (select 1 from centers where code = upper(btrim(p_code))) then
    raise exception '409 center_code_taken';
  end if;

  v_center_code := upper(btrim(p_code));

  -- 2. Center record.
  insert into centers (code, name, legal_entity_name, bin_number, trade_license_number, address, phone)
  values (v_center_code, btrim(p_name), btrim(p_legal_entity_name), p_bin_number, p_trade_license, btrim(p_address), btrim(p_phone))
  returning id into v_center_id;

  -- 3. Default payment methods. They start inactive: the active-rate trigger
  -- requires a published profile covering the method, and the profile does not
  -- exist yet. They are activated after step 5.
  insert into payment_methods (center_id, code, name, requires_txn_ref, sort_order, active)
  values (v_center_id, 'cash', 'Cash', false, 10, false)
  returning id into v_cash_id;

  insert into payment_methods (center_id, code, name, requires_txn_ref, sort_order, active)
  values (v_center_id, 'bkash', 'bKash', true, 20, false)
  returning id into v_bkash_id;

  insert into payment_methods (center_id, code, name, requires_txn_ref, sort_order, active)
  values (v_center_id, 'visa', 'Visa', true, 30, false)
  returning id into v_visa_id;

  insert into payment_methods (center_id, code, name, requires_txn_ref, sort_order, active)
  values (v_center_id, 'mastercard', 'Mastercard', true, 40, false)
  returning id into v_master_id;

  insert into payment_methods (center_id, code, name, requires_txn_ref, sort_order, active)
  values (v_center_id, 'bank_transfer', 'Bank Transfer', false, 50, false)
  returning id into v_bank_transfer_id;

  -- 4. Canonical payables with fixed monthly due days (PRD §7.4).
  -- Visa and Mastercard each have their own method_charge payable for
  -- generate_monthly_settlements and tolerance.ts combined_card matching.
  insert into payables (center_id, name, code, kind, method_id, due_day)
  values (v_center_id, 'Government VAT', 'vat_payable', 'vat', null, 15);

  insert into payables (center_id, name, code, kind, method_id, due_day)
  values (v_center_id, 'bKash Merchant Charges', 'bkash_charge_payable', 'method_charge', v_bkash_id, 10);

  insert into payables (center_id, name, code, kind, method_id, due_day)
  values (v_center_id, 'Visa Card Processing Charges', 'visa_charge_payable', 'method_charge', v_visa_id, 15);

  insert into payables (center_id, name, code, kind, method_id, due_day)
  values (v_center_id, 'Mastercard Card Processing Charges', 'mastercard_charge_payable', 'method_charge', v_master_id, 15);

  -- 5. Baseline rate profile v1: manual VAT, 42% commission on gross.
  -- Inserted as a draft because method_rates may not be written once a profile
  -- is published (trg_method_rates_draft_publish_lock); it is published below.
  insert into rate_profiles (
    center_id, version, status, effective_from, vat_mode, vat_bp,
    commission_bp, commission_base, charges_borne_by, note, created_by
  ) values (
    v_center_id, 1, 'draft', date '2026-01-01', 'manual', 0,
    4200, 'gross', 'business', 'Day-zero baseline profile (CLT-T-071)', p_actor_id
  )
  returning id into v_rate_profile_id;

  insert into method_rates (center_id, rate_profile_id, method_id, charge_bp)
  values
    (v_center_id, v_rate_profile_id, v_cash_id, 0),
    (v_center_id, v_rate_profile_id, v_bkash_id, 115),
    (v_center_id, v_rate_profile_id, v_visa_id, 150),
    (v_center_id, v_rate_profile_id, v_master_id, 150),
    (v_center_id, v_rate_profile_id, v_bank_transfer_id, 0);

  update rate_profiles
  set status = 'published', published_at = now()
  where id = v_rate_profile_id and center_id = v_center_id;

  -- Activate the methods now that a published profile covers them.
  update payment_methods set active = true where center_id = v_center_id;

  -- 6. Center settings.
  insert into app_settings (center_id, reconcile_tolerance_poisha, net_label)
  values (v_center_id, 100, 'Net after deductions');

  -- 7. Entry counter.
  insert into center_counters (center_id, next_entry_number)
  values (v_center_id, 1);

  perform log_audit_event(
    v_center_id, p_actor_id, 'center.create', 'centers', v_center_id::text, null,
    jsonb_build_object(
      'code', v_center_code,
      'name', btrim(p_name),
      'owner_email', p_owner_email,
      'owner_name', p_owner_name,
      'rate_profile_id', v_rate_profile_id
    )
  );

  return jsonb_build_object(
    'center_id', v_center_id,
    'code', v_center_code,
    'center_number', (select center_number from centers where id = v_center_id),
    'rate_profile_id', v_rate_profile_id,
    'owner_email', p_owner_email
  );
end;
$$;

revoke all on function rpc_create_center(uuid, varchar, text, text, varchar, varchar, text, varchar, text, text) from public;
revoke all on function rpc_create_center(uuid, varchar, text, text, varchar, varchar, text, varchar, text, text) from anon;
revoke all on function rpc_create_center(uuid, varchar, text, text, varchar, varchar, text, varchar, text, text) from authenticated;
grant execute on function rpc_create_center(uuid, varchar, text, text, varchar, varchar, text, varchar, text, text) to service_role;

comment on function rpc_create_center(uuid, varchar, text, text, varchar, varchar, text, varchar, text, text) is
  'Atomic day-zero center provisioning: center row, canonical payment methods (cash, bkash, visa, mastercard, bank_transfer), canonical payables (vat_payable, bkash_charge_payable, visa_charge_payable, mastercard_charge_payable), published rate profile v1, method rates, settings and entry counter. Requires a super_admin actor. service_role only.';
