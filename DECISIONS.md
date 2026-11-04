# DECISIONS.md — Cosmo Ledger Track

Implementation choices and architectural decisions made where the PRD was silent or provided design options (PRD Rule #5 and AGENTS.md §3).

---

## Decisions Log

### CLT-D-001: Device Presence Registration on Push (Option a)
- **Date**: 2026-10-29
- **Scope**: Sync Protocol / `rpc_push_sync_op` / `devices` table
- **Context**: In PRD v1.18 (M-2), a mandatory device session check required a `(device_id, user_id)` presence row. If device presence was only created during pull (`upsert_device_sync_state`), a client that logged in, went offline before its initial pull, recorded transactions offline, and reconnected would face a deadlock because the Client Sync Execution Order mandates **push before pull**.
- **Decision**: Adopt Option (a): `rpc_push_sync_op` automatically registers/upserts device presence (`PERFORM upsert_device_sync_state(p_device_id, p_caller_id, NULL);` updating `last_seen_at = now()`) for authenticated callers on push before processing operations.
- **Consequences**: Eliminates chicken-and-egg deadlocks on first sync cycles, guarantees offline-first reliability, supports multi-user shared counter hardware, and preserves strict push-before-pull ordering.

### CLT-D-002: Baseline Rate Profile Operational Defaults Seeded at M0
- **Date**: 2026-10-29
- **Scope**: Rate Profiles / Database Bootstrap Seed
- **Context**: Rate profile operational defaults (42% commission, 115 bp bKash fee, 150 bp card fee, 15% manual VAT) from fixtures are seeded in `scripts/bootstrap.ts` for Profile v1 (`effective_from = '2026-01-01'`).
- **Decision**: Formally accepted as operational defaults for development and staging environments pending business owner confirmation per PRD §4 Production Release Precondition and AGENTS.md Rule 20.
- **Consequences**: Allows M0 migrations, bootstrap scripts, and end-to-end integration tests to execute cleanly without hardcoded business rules in application code.

### CLT-D-003: `generate_monthly_settlements` Procedure Boundary
- **Date**: 2026-10-29
- **Scope**: Settlements / API Surface / Database RPC
- **Context**: Settlement expected liabilities are continuously recalculated in real time by database trigger `trg_entries_recalc_settlements`. A phantom API route `/settlements/generate` created confusion with the single trust boundary model.
- **Decision**: `generate_monthly_settlements` is designated strictly as an internal-only database procedure, invoked exclusively by `close_month()` and by the initial migration bootstrap script under `service_role`. No public API endpoint is exposed.
- **Consequences**: Preserves exact 27-route API surface in PRD §13, prevents redundant RPC calls, and protects database trigger integrity.

### CLT-D-004: Preflight Recomputation Failure Idempotency
- **Date**: 2026-10-29
- **Scope**: Sync Protocol / SvelteKit `/sync/push` Preflight / `sync_ops`
- **Context**: In PRD v1.18 (M-1), SvelteKit authoritative recomputation filters out `calc_mismatch` operations and logs them to `sync_ops` before calling `rpc_push_sync_op`. If network failure drops the HTTP response, client retry of the same `op_id` would trigger a PK `23505 unique_violation`.
- **Decision**: Preflight writes to `sync_ops` use `INSERT INTO sync_ops (...) VALUES (...) ON CONFLICT (op_id) DO NOTHING;` and return the cached rejection status.
- **Consequences**: Restores complete idempotency for transport-dropped sync requests without risking database transaction aborts.

### CLT-D-005: Statement File Signed-URL Retrieval Contract
- **Date**: 2026-10-29
- **Scope**: Reconciliation / Statement Storage / API Surface
- **Context**: Operators uploading reconciliation statements need to view previously uploaded statements from the private storage bucket (`statements/<month>/<sha256>`).
- **Decision**: Added `GET /api/v1/reconcile/statements/signed-url?path=<path>` restricted to Admin and Owner roles with 15-minute (900 seconds) signed URL TTL, mirroring the settlement receipts viewing contract (`/settlements/receipts/signed-url`).
- **Consequences**: Restores complete symmetry between settlement receipts and statement files, maintaining private bucket security without direct public access.

### CLT-D-006: Monorepo Compiler Module Resolution
- **Date**: 2026-11-04
- **Scope**: Toolchain / `tsconfig.base.json` (Plan 001)
- **Context**: Vite, SvelteKit 2, tsx, and Vitest operate with modern ESM bundler semantics. Using `moduleResolution: "NodeNext"` enforces relative `.js` import extensions in TypeScript files (TS2835).
- **Decision**: Configured `module: "ESNext"` and `moduleResolution: "bundler"` in `tsconfig.base.json`. Enables seamless cross-workspace type resolution without relative `.js` import extension traps.
- **Consequences**: Root `pnpm typecheck` compiles `packages/calc` and `packages/shared` with composite project references; `apps/web` is checked by `svelte-check` instead, per Plan 001 rev 2.1.
## CLT-D-007 — Snapshot VAT-mode shape + nullable device rate version + digests/schema (Plan 004 vs 002/003 conflicts)
Date: 2026-11-04. Status: implementer decision (Rule 13), pending owner confirmation at gates.

While implementing Plan 004, three spec-block conflicts surfaced between plans 002/003/004 and were resolved as follows:

1. **chk_vat_input_mode_exclusivity shape.** Plan 003's constraint required a nested `snapshot->'vat'->>'mode'`, but the Plan 002 engine emits the flat `snapshot.vatMode` key, and the Plan 004 snapshot verifier accepts both. Chosen: canonical shape is the engine's flat `vatMode`; the nested form is still accepted. Migration 000001 was amended (same constraint name and semantics).
2. **devices.last_rate_version NOT NULL vs upsert.** Plan 004 `upsert_device_sync_state` inserts explicit NULL for `last_rate_version`, which is `int NOT NULL DEFAULT 0` in Plan 003. Chosen: the upsert coalesces an explicit NULL to the column default `0` (presence without rate-version grounding); no schema change.
3. **digest() resolution.** Supabase installs pgcrypto into the `extensions` schema; the RPCs pin `search_path = public, pg_temp`, so the unqualified `digest()` raises 42883 inside `rpc_push_sync_op` (masked into `calc_mismatch`-style rejections via v_err_reason). Chosen: schema-qualify as `extensions.digest(...)` (Supabase standard schema name, no privilege weakening).
4. **cron.unschedule on fresh DB.** `cron.unschedule('sync-op-retention')` errors when no schedule exists. Chosen: unschedule only when `cron.job` has the row; then schedule. Migration 000005 amended.


## CLT-D-008: Overpayment-invalidation audit actor comes from `clt.audit_actor` GUC, not `auth.uid()` (2026-11-04, Plan 005)

**Found:** PRD §15.1 / Plan 005's `fn_settlements_recalc_status_and_overpayment` probe used `auth.uid()` as the audit actor, coalescing to the zero UUID. Under every local and service-side execution path that reaches this trigger — `SECURITY DEFINER` RPCs (`SET LOCAL search_path`, no JWT), direct dev/test SQL running as `postgres`, and the shared-DB regression suites — `auth.uid()` is NULL, and the zero-UUID fallback violates `audit_log.actor → profiles` FK (23503), aborting legitimate settlement payment flows.

**Chosen:**
1. Every actor-carrying Plan 005 RPC (`record_settlement_payment`, `approve_settlement_overpayment`, `create_statement`, `supersede_statement`, match/unmatch/accept line, `review_entry_reconciliation_exception`, `reconcile_statement`, `close_month`, `reopen_month`) sets the transaction-local setting `clt.audit_actor` at body start; the trigger resolves the actor from that GUC first.
2. Fallback: the settlement's most recent non-reversal payment's `recorded_by` (the actor who caused the balance change); zero-UUID removed from this trigger.
3. Migration 000005's `rpc_push_sync_op` and `rpc_supersede_entry` (which mutate entries and can trigger the same recalc) also set the GUC. The orchestrator/owner-facing audit trail remains: cause events (`payment`, `void`, `supersede`) already carry the real actor; the invalidation row now carries the same actor instead of a forged zero UUID when the direct trigger path fires.

**Effect:** no schema change; no grant change; `audit_log` stays append-only with a real FK-satisfying actor on every recalc-triggered invalidation. Regression suites cover FK-valid audit writes after overpay→approve→recalc cascades (Tests #35/#40/#48/#49).
