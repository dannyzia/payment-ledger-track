-- Migration 004: Security, Table Revocations, RLS Policies, and Routine Privileges (PRD §7.1)

-- 1. Table-Level Direct Write Revocation on All 18 Public Tables (PRD §7.1 item 1)
REVOKE ALL ON
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

-- Grant SELECT only to authenticated (where RLS policies govern access)
GRANT SELECT ON
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

-- 2. Explicitly Enable Row Level Security on All 18 Tables (PRD §7.1 item 1)
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
-- Enforces roles directly via verified JWT claims ((auth.jwt() -> 'app_metadata' ->> 'role'))
-- without recursive subqueries on profiles and without public helper routines (PRD §7.1 item 3, Test #22).

-- profiles: Active user reads own profile; Admin and Owner read all
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT TO authenticated
USING (
  (id = auth.uid() AND active = true)
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- devices: User reads own devices; Admin and Owner read all
CREATE POLICY "devices_select_policy" ON devices FOR SELECT TO authenticated
USING (
  (user_id = auth.uid())
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- payment_methods, payables, app_settings: all authenticated read
CREATE POLICY "payment_methods_select_policy" ON payment_methods FOR SELECT TO authenticated
USING (true);

CREATE POLICY "payables_select_policy" ON payables FOR SELECT TO authenticated
USING (true);

CREATE POLICY "app_settings_select_policy" ON app_settings FOR SELECT TO authenticated
USING (true);

-- rate_profiles: Active staff reads published only; Admin and Owner read all
CREATE POLICY "rate_profiles_select_policy" ON rate_profiles FOR SELECT TO authenticated
USING (
  status = 'published'
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- method_rates: Active staff reads published only; Admin and Owner read all
CREATE POLICY "method_rates_select_policy" ON method_rates FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM rate_profiles rp
    WHERE rp.id = method_rates.rate_profile_id
      AND (
        rp.status = 'published'
        OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
      )
  )
);

-- entries: Staff reads own created entries; Admin and Owner read all
CREATE POLICY "entries_select_policy" ON entries FOR SELECT TO authenticated
USING (
  created_by = auth.uid()
  OR ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'))
);

-- Managerial tables (PRD §7.1 line 869): Admin and Owner read only
CREATE POLICY "exceptions_select_policy" ON entry_reconciliation_exceptions FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "settlements_select_policy" ON settlements FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "settlement_payments_select_policy" ON settlement_payments FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statements_select_policy" ON statements FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statement_payables_select_policy" ON statement_payables FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "statement_lines_select_policy" ON statement_lines FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "month_closes_select_policy" ON month_closes FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "month_close_events_select_policy" ON month_close_events FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

CREATE POLICY "audit_log_select_policy" ON audit_log FOR SELECT TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner'));

-- sync_ops: server-internal only; no client SELECT policy is defined.
