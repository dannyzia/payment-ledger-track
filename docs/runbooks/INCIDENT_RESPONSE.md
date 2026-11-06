# Incident Response Runbook — Cosmo Ledger Track

Plan 021 §6.8. Applies to production and staging. The orchestrator/DevOps role
leads; Zia (Owner) decides on business, money, and legal questions.

## 1. Severity Levels

Aligned with AGENTS.md §6 audit severity taxonomy:

| Severity | AGENTS.md Equivalent | Definition | Target Response Time | Actions |
|---|---|---|---|---|
| **SEV-1** | Blocker | Financial data corruption, calculation mismatch in production, unauthorized privilege escalation, ledger write freeze. | 15 minutes | Immediate rollback or lock, alert Zia directly, assemble incident team. |
| **SEV-2** | Major | Sync engine failure for multiple devices, Vercel function outage, Supabase latency > 2,000 milliseconds. | 1 hour | Identify failing route, restart service pool, investigate lock contention. |
| **SEV-3** | Minor | Single-user device sync conflict, UI layout defect on specific mobile model. | 4 hours | Queue for next maintenance cycle, review logs. |

## 2. Escalation Protocol

1. **Lead Role**: Orchestrator / DevOps.
2. **Immediate Contact**: Zia (Project Owner).
3. **Communication Rule**: State facts only. Quote exact error messages, affected device IDs, and affected entry sequence ranges. Never make absolute claims.

## 3. Containment Actions

If unauthorized write activity or calculation discrepancy is detected:
1. Revoke compromised device immediately via `POST /api/v1/admin/devices` with action `'revoke'`.
2. If widespread corruption is suspected, activate a targeted RPC write freeze. Use the signatures actually deployed (probed from the live schema; the plan's `void_entry` does not exist — entry voiding is trigger-mediated through `rpc_push_sync_op` ops):
   ```sql
   -- Target write RPCs to halt new mutations while preserving read-only visibility
   REVOKE EXECUTE ON FUNCTION rpc_push_sync_op(text, uuid, user_role, jsonb) FROM service_role;
   REVOKE EXECUTE ON FUNCTION rpc_supersede_entry(uuid, jsonb, uuid) FROM service_role;
   REVOKE EXECUTE ON FUNCTION record_settlement_payment(uuid, bigint, date, text, text, text, boolean, uuid, uuid) FROM service_role;
   REVOKE EXECUTE ON FUNCTION close_month(date, uuid) FROM service_role;
   ```
3. To re-grant execution permissions post-incident containment:
   ```sql
   GRANT EXECUTE ON FUNCTION rpc_push_sync_op(text, uuid, user_role, jsonb) TO service_role;
   GRANT EXECUTE ON FUNCTION rpc_supersede_entry(uuid, jsonb, uuid) TO service_role;
   GRANT EXECUTE ON FUNCTION record_settlement_payment(uuid, bigint, date, text, text, text, boolean, uuid, uuid) TO service_role;
   GRANT EXECUTE ON FUNCTION close_month(date, uuid) TO service_role;
   ```
4. Preserve audit log evidence (append-only table; read it, never modify it):
   ```sql
   SELECT * FROM audit_log ORDER BY id DESC LIMIT 100;
   ```

## 4. Bottom Line

Revocation freezes writes without deleting anything; re-grant restores service
after the cause is understood. Every action in this runbook is recorded in the
incident record and, where it touches financial state, in `audit_log` by the
RPCs themselves.
