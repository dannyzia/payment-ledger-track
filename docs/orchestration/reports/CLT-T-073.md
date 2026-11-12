# CLT-T-073 Report — Multi-Center Server Mediation & Auth Layer (API Routes Alignment)

Date: 2026-11-09
Agent: A-IMP-1 (Implementer)
Status: DONE
Verified by: Orchestrator (Independent skeptic audit: `pnpm --filter @clt/web check` 0 errors / 0 warnings; all 23 RPC call sites in `apps/web/src` audited for `p_center_id`; tenant IDOR defense in `/sync/push` verified; database queries checked for `center_id` isolation)

=== TASK REPORT ===
TASK ID:         CLT-T-073
AGENT ID:        A-IMP-1
STATUS:          DONE
SUMMARY:         All API routes now resolve a verified caller.centerId from the JWT /
                 profile and pass it to every RPC as p_center_id, with every push,
                 pull and metadata query tenant-scoped. database.types.ts regenerated
                 against the local multi-tenant schema; svelte-check is 0 errors,
                 0 warnings.
FILES CHANGED:
  apps/web/src/lib/database.types.ts                         regenerate  supabase gen types --local: centers, center_counters, center_id on all tables, p_center_id args, super_admin enum (+1855/-1486)
  apps/web/src/lib/server/auth.ts                            modify  UserRole from @clt/shared; CallerContext.centerId (null only for super_admin); tenant resolution + 403 when unassigned; requireRole(UserRole[]); assertCallerInCenter; isSuperAdmin
  apps/web/src/routes/api/v1/sync/push/+server.ts            modify  effectiveCenterId (caller or body) + 400 missing_tenant_context; per-op payload centerId IDOR check (403); center-scoped rate-profile preflight, sync_ops/audit_log inserts, devices killswitch; p_center_id to rpc_push_sync_op
  apps/web/src/routes/api/v1/sync/pull/+server.ts            modify  effectiveCenterId from JWT or ?centerId= (400 missing_center_id / invalid_center_id); tenant-scoped watermark + pull CTE ($4) incl. super_admin in role list; center-scoped rate_profiles/payment_methods/payables/month_closes/app_settings/profiles/settlements/statements/statement_payables/sync_ops; p_center_id to upsert_device_sync_state
  apps/web/src/routes/api/v1/settlements/payments/+server.ts  modify  p_center_id to record_settlement_payment; GET/POST read-back queries scoped by center_id
  apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts modify  p_center_id to approve_settlement_overpayment
  apps/web/src/routes/api/v1/months/close/+server.ts         modify  p_center_id to close_month
  apps/web/src/routes/api/v1/months/reopen/+server.ts        modify  p_center_id to reopen_month
  apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts modify  p_center_id to supersede_statement
  apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts modify  p_center_id to reconcile_statement
  apps/web/src/routes/api/v1/reconcile/statements/+server.ts modify  p_center_id to create_statement
  apps/web/src/routes/api/v1/reconcile/match-line/+server.ts modify  p_center_id to match_statement_line
  apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts modify  p_center_id to unmatch_statement_line
  apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts modify  p_center_id to accept_statement_line
  apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts modify  p_center_id to create_reconciliation_exception
  apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts modify  p_center_id to transfer_ownership
  apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts modify  p_center_id to admin_review_stale_entry
  apps/web/src/routes/api/v1/admin/audit/+server.ts          modify  scoped to caller.centerId for regular users, optional ?centerId= for super_admin
  apps/web/src/hooks.server.ts                               modify  x-request-id correlation header + API timing log
  apps/web/src/routes/api/v1/admin/settings/+server.ts       modify  p_center_id to admin_update_settings; scoped app_settings read to center_id
  apps/web/src/routes/api/v1/admin/devices/+server.ts        modify  p_center_id to admin_manage_device
  apps/web/src/routes/api/v1/admin/methods/+server.ts        modify  p_center_id to admin_manage_payment_method
  apps/web/src/routes/api/v1/admin/payables/+server.ts       modify  p_center_id to admin_manage_payable
  apps/web/src/routes/api/v1/admin/rates/draft/+server.ts    modify  p_center_id to create_or_update_draft_rate_profile
  apps/web/src/routes/api/v1/admin/rates/publish/+server.ts  modify  p_center_id to publish_rate_profile
  apps/web/src/routes/api/v1/admin/users/+server.ts          modify  p_center_id to admin_manage_user
  apps/web/src/routes/api/v1/admin/users/invite/+server.ts   modify  p_center_id to admin_invite_user
ACCEPTANCE:
  A1 PASS — pnpm --filter @clt/web check: 0 errors, 0 warnings across all 672 files.
  A2 PASS — npx supabase gen types typescript --local generated fresh multi-tenant database.types.ts with centers, center_counters, center_id on all tables, and p_center_id on all RPCs.
  A3 PASS — apps/web/src/lib/server/auth.ts resolves caller.centerId from JWT claims or profile; enforces active profile and center assignment (or super_admin).
  A4 PASS — apps/web/src/routes/api/v1/sync/push/+server.ts enforces tenant IDOR checks across all ops; re-derives calculations using center-specific rate profile; passes p_center_id to rpc_push_sync_op.
  A5 PASS — apps/web/src/routes/api/v1/sync/pull/+server.ts restricts pull sequence watermark, entries CTE, and all relational metadata to effectiveCenterId; passes p_center_id to upsert_device_sync_state.
  A6 PASS — All operational and admin RPC call sites pass p_center_id.
  A7 PASS — hooks.server.ts sets x-request-id and logs API response duration.
=== END REPORT ===

