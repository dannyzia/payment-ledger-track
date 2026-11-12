-- Migration 004: Security, Table Revocations, RLS Policies, and Routine Privileges (PRD §7.1)
-- Multi-center: every policy requires the tenant predicate below, and RLS is
-- forced so even the table owner is subject to policies (service_role bypasses).

-- 1. Table-Level Direct Write Revocation on All 20 Public Tables (PRD §7.1 item 1)
-- Allow authenticated roles to call auth.uid() and read auth.jwt() in RLS policies
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;

REVOKE ALL ON
  centers,
  center_counters,
  entries,
  rate_profiles,
  method_rates,
  settlements,
  settlement_payments,
  statements,
  statement_payables,
  statement_lines,
  month_closes,
  month_close_events,
  entry_reconciliation_exceptions,
  audit_log,
  sync_ops,
  profiles,
  payment_methods,
  payables,
  devices,
  app_settings
FROM anon, authenticated;

-- Grant SELECT only to authenticated (where RLS policies govern access).
-- center_counters and sync_ops stay server-only.
GRANT SELECT ON
  centers,
  entries,
  rate_profiles,
  method_rates,
  settlements,
  settlement_payments,
  statements,
  statement_payables,
  statement_lines,
  month_closes,
  month_close_events,
  entry_reconciliation_exceptions,
  audit_log,
  profiles,
  payment_methods,
  payables,
  devices,
  app_settings
TO authenticated;

-- 2. Enable and FORCE Row Level Security on All 20 Tables (PRD §7.1 item 1)
ALTER TABLE centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE method_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_close_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE centers FORCE ROW LEVEL SECURITY;
ALTER TABLE center_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE method_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
ALTER TABLE payables FORCE ROW LEVEL SECURITY;
ALTER TABLE entry_reconciliation_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE ROW LEVEL SECURITY;
ALTER TABLE settlement_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE statements FORCE ROW LEVEL SECURITY;
ALTER TABLE statement_payables FORCE ROW LEVEL SECURITY;
ALTER TABLE statement_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE month_closes FORCE ROW LEVEL SECURITY;
ALTER TABLE month_close_events FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_ops FORCE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;

-- 3. Routine Privilege & Access Control DDL (PRD §7.1 item 3)
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON ROUTINES TO service_role;

-- 4. View Permissions (PRD §7.1, §18 Gate 1)
REVOKE ALL ON view_device_stale_rate_anomalies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON view_device_stale_rate_anomalies TO service_role;

REVOKE ALL ON v_monthly_totals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_monthly_totals TO service_role;

REVOKE ALL ON v_monthly_method_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_monthly_method_charges TO service_role;

REVOKE ALL ON v_staff_personal_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_staff_personal_metrics TO authenticated, service_role;

-- 5. Executable RLS Policies for Authenticated Select (PRD §7.1 item 2)
-- Tenant predicate: the center injected by the server RPC
-- (clt.current_center_id) or, for direct reads, the JWT app_metadata claim.
-- Platform super_admin bypasses the tenant boundary.
-- Roles remain enforced directly from verified JWT claims, without recursive
-- subqueries on profiles and without public helper routines (PRD §7.1 item 3, Test #22).

-- centers: a user sees only their own center; super_admin sees all
CREATE POLICY "centers_select_policy" ON centers FOR SELECT TO authenticated
USING (
  id = COALESCE(
    NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
    (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- profiles: same center, self, or super_admin
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND active = true
  )
  OR id = auth.uid()
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- devices: own devices, or admin/owner within the center
CREATE POLICY "devices_select_policy" ON devices FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (
      user_id = auth.uid()
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
    )
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- payment_methods, payables, app_settings: all authenticated users in the center
CREATE POLICY "payment_methods_select_policy" ON payment_methods FOR SELECT TO authenticated
USING (
  center_id = COALESCE(
    NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
    (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "payables_select_policy" ON payables FOR SELECT TO authenticated
USING (
  center_id = COALESCE(
    NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
    (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "app_settings_select_policy" ON app_settings FOR SELECT TO authenticated
USING (
  center_id = COALESCE(
    NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
    (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- rate_profiles: published profiles for staff; all for admin/owner; all for super_admin
CREATE POLICY "rate_profiles_select_policy" ON rate_profiles FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (
      status = 'published'
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
    )
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- method_rates: published profiles for staff; all for admin/owner; all for super_admin
CREATE POLICY "method_rates_select_policy" ON method_rates FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND EXISTS (
      SELECT 1 FROM rate_profiles rp
      WHERE rp.id = method_rates.rate_profile_id
        AND rp.center_id = method_rates.center_id
        AND (
          rp.status = 'published'
          OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
        )
    )
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- entries: staff read their own rows; admin/owner read the center; super_admin all
CREATE POLICY "entries_select_policy" ON entries FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (
      created_by = auth.uid()
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
    )
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- Managerial tables (PRD §7.1 line 869): Admin and Owner within the center
CREATE POLICY "exceptions_select_policy" ON entry_reconciliation_exceptions FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "settlements_select_policy" ON settlements FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "settlement_payments_select_policy" ON settlement_payments FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "statements_select_policy" ON statements FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "statement_payables_select_policy" ON statement_payables FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "statement_lines_select_policy" ON statement_lines FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "month_closes_select_policy" ON month_closes FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

CREATE POLICY "month_close_events_select_policy" ON month_close_events FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- audit_log: admin/owner in the center; super_admin sees all
CREATE POLICY "audit_log_select_policy" ON audit_log FOR SELECT TO authenticated
USING (
  (
    center_id = COALESCE(
      NULLIF(current_setting('clt.current_center_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'center_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
  )
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin'
);

-- sync_ops and center_counters: server-internal only; no client SELECT policy is defined.
