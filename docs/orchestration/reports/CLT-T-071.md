# CLT-T-071 Report — Multi-Center Row-Level Multi-Tenancy Baseline DDL, Functions, RLS, and Day-Zero Center Provisioning

Date: 2026-11-08
Agent: A-IMP-1 (Implementer)
Status: DONE
Verified by: Orchestrator (live SQL queries on 127.0.0.1:54322, test-db run, and Vitest schema test suite)

=== TASK REPORT ===
TASK ID:         CLT-T-071
AGENT ID:        A-IMP-1
STATUS:          DONE
SUMMARY:         Migrations 001-007 rewritten for row-level multi-tenancy (centers,
                 center_id + composite keys, 64-bit injective locks, FORCE RLS,
                 center-scoped routines, rpc_create_center). Both hotfix migrations
                 folded in and deleted. DB test harness seeds a default center; schema
                 suite extended to 20 tables and passes 22/22.
FILES CHANGED:
  supabase/migrations/20261029000001_core_schema.sql            modify  centers, center_counters, center_id + composite keys, one_owner per center, 64-bit-safe per-center counters
  supabase/migrations/20261029000002_settlements_and_statements.sql modify  center_id on all 11 operational tables, composite uniques/FKs, unpartitioned audit_log
  supabase/migrations/20261029000003_views.sql                  modify  center_id + correct GROUP BY in all four views
  supabase/migrations/20261029000004_security_and_rls.sql       modify  writes revoked + SELECT granted on 20 tables, ENABLE/FORCE RLS, tenant predicate via clt.current_center_id / app_metadata.center_id
  supabase/migrations/20261029000005_functions_entries_rates_sync.sql modify  helpers, triggers, admin/sync RPCs with p_center_id, folded maintenance_purge_entries, injected locks, cron block, routine grants
  supabase/migrations/20261029000006_functions_settlement_recon_month.sql modify  settlement/reconciliation/month routines center-scoped, all take p_center_id, routine grants
  supabase/migrations/20261029000007_center_provisioning.sql    create  atomic rpc_create_center (center, methods, payables, profile v1, method rates, settings, counter)
  supabase/migrations/20261107000001_fix_supersede_reassign.sql delete  folded into 000005 rpc_supersede_entry
  supabase/migrations/20261108000001_maintenance_purge_entries.sql delete  folded into 000005 maintenance_purge_entries
  tests/db/helpers/test-db.ts                                   modify  default center MHK + center_counters seeded after migrations; cron marker updated to section 27
  tests/db/schema.test.ts                                       modify  center_id on every seed, 20-table + FORCE RLS assertions, per-center uniqueness/composite-FK isolation test
ACCEPTANCE:
  A1 PASS — pnpm db:reset EXIT=0, all seven migrations applied, no ERROR lines.
  A2 PASS — both hotfix migration files removed from supabase/migrations/.
  A3 PASS — SELECT count(*) FROM pg_tables WHERE schemaname='public' = 20; centers and center_counters present.
  A4 PASS — entries relrowsecurity, relforcerowsecurity = t, t.
  A5 PASS — npx vitest run tests/db/schema.test.ts: 1 file passed, 22 tests passed, 0 failed.
=== END REPORT ===

