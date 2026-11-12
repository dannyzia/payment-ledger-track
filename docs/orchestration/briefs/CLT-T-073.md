# CLT-T-073 — Multi-Center Server Mediation & Auth Layer (API Routes Alignment)

Scheduled: 2026-11-09. Origin: Approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md` (§4 Server Mediation, §2.C File Inventory) and Owner Decision `CLT-D-030`.

Belongs to: **Phase 3 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-073
TITLE:           Multi-Center Server Mediation & Auth Layer (API Routes Alignment)
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-072
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§4 Server Mediation, §2.C File Inventory), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030)
OS / SHELL:      Ubuntu 24.04 / bash (Node 22 LTS, corepack pnpm)

You are A-IMP-1, role Implementer, working on the project "Kumon Ledger Track" at /home/zia/Documents/My Projects/Cosmo_Ledger_Track.
You have no memory of earlier work. Everything you need is in this brief and the files it lists.
1. Read the project context file (AGENTS.md) before anything else. Its hard rules
   override this brief. If they conflict with this brief, stop and report BLOCKED.
2. Do exactly what this brief says. Do no extra work. Do not refactor, rename, or reformat
   anything not listed under SCOPE.
3. Touch only the files listed under SCOPE. If you need another file, stop and report BLOCKED.
4. Do not invent facts, numbers, prices, terms, or laws. If you do not know, write UNKNOWN
   and say exactly what is needed.
5. Run every step under VERIFICATION and paste the real output. Never write "should work"
   or "tests pass" without pasted output.
6. Never print, store, or request secrets, credentials, or personal data.
7. If anything is ambiguous, stop and put exactly one question under QUESTIONS in your
   report. Do not guess.
8. If you cannot complete a step, report BLOCKED with the reason. Do not improvise a
   workaround.
9. Finish by writing the TASK REPORT in the exact format given at the end of this brief.

CONTEXT
In Phase 1 (CLT-T-071), all database RPCs (`rpc_push_sync_op`, `record_settlement_payment`, `close_month`, `reopen_month`, `create_statement`, `supersede_statement`, `match_statement_line`, `unmatch_statement_line`, `accept_statement_line`, `approve_settlement_overpayment`, `transfer_ownership`, `admin_review_stale_entry`) were rewritten to accept `p_center_id UUID` as their first parameter, and all 20 tables were put under FORCE ROW LEVEL SECURITY.
In Phase 2 (CLT-T-072), `@clt/shared` added `centerId`, `CenterDto`, `super_admin` to `UserRole`, and center-prefixed ID formatting.
This task (Phase 3) aligns the SvelteKit API server routes:
1. Regenerates `apps/web/src/lib/database.types.ts` from local Supabase to give the compiler strict type definitions for the multi-tenant schema.
2. Updates `apps/web/src/lib/server/auth.ts` to extract `centerId` and `role` from Bearer JWTs and verify tenant boundaries.
3. Updates all API routes (`/sync/*`, `/settlements/*`, `/months/*`, `/reconcile/*`, `/admin/audit`) to pass verified `p_center_id` to database RPCs and scope service-role queries to `center_id = caller.centerId`.
4. Adds request correlation headers and logging in `hooks.server.ts`.

OBJECTIVE
Align all SvelteKit `api/v1/*` routes to extract `caller.centerId` and enforce tenant scoping across all RPC invocations and database queries, achieving 0 errors on `svelte-check`.

SCOPE (the ONLY files you may create or modify)
- apps/web/src/lib/database.types.ts — modify (regenerate)
- apps/web/src/lib/server/auth.ts — modify
- apps/web/src/routes/api/v1/sync/push/+server.ts — modify
- apps/web/src/routes/api/v1/sync/pull/+server.ts — modify
- apps/web/src/routes/api/v1/settlements/payments/+server.ts — modify
- apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts — modify
- apps/web/src/routes/api/v1/months/close/+server.ts — modify
- apps/web/src/routes/api/v1/months/reopen/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/statements/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/match-line/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts — modify
- apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts — modify
- apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts — modify
- apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts — modify
- apps/web/src/routes/api/v1/admin/audit/+server.ts — modify
- apps/web/src/hooks.server.ts — modify

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc or packages/shared.
- Do not modify supabase/migrations/.
- Do not modify UI components under apps/web/src/routes/(app)/ or apps/web/src/lib/ui/.
- Do not modify Dexie client schema (handled in Phase 5).

INPUTS (read these first)
- docs/designs/multi_center_row_level_multitenancy.md (§4 Server Mediation, §2.C File Inventory)
- apps/web/src/lib/server/auth.ts
- apps/web/src/routes/api/v1/sync/push/+server.ts
- apps/web/src/routes/api/v1/sync/pull/+server.ts

REQUIREMENTS (numbered; each is testable)
R1. Regenerate `apps/web/src/lib/database.types.ts`:
    Run `npx supabase gen types typescript --local > apps/web/src/lib/database.types.ts`.
    Verify that the generated types declare `centers`, `center_counters`, `center_id` on all public tables, and `p_center_id` in function arguments.

R2. In `apps/web/src/lib/server/auth.ts`:
    - Import `UserRole` from `@clt/shared`.
    - Update `CallerContext`:
      ```ts
      export interface CallerContext {
        userId: string;
        role: UserRole;
        centerId: string | null; // null strictly for super_admin
        active: boolean;
      }
      ```
    - Update `getCallerContext(event: RequestEvent)`:
      - Select `role, active, center_id` from `profiles`.
      - Resolve `centerId`: `(user.app_metadata?.center_id as string | undefined) ?? profile.center_id ?? null`.
      - If `profile.role !== 'super_admin' && !centerId`, throw `error(403, 'unauthorized: profile has no center assigned')`.
      - Return `{ userId: user.id, role: profile.role, centerId, active: profile.active }`.
    - Update `requireRole(caller: CallerContext, allowedRoles: UserRole[])`:
      Accept `super_admin` in allowed roles; throw `error(403, 'unauthorized: insufficient permissions')` if not allowed.
    - Add helper `assertCallerInCenter(caller: CallerContext, targetCenterId: string)`:
      - If `caller.role === 'super_admin'`, pass.
      - If `caller.centerId !== targetCenterId`, throw `error(403, 'forbidden_tenant_mismatch')`.
    - Add helper `isSuperAdmin(caller: CallerContext): boolean`: returns `caller.role === 'super_admin'`.

R3. In `apps/web/src/routes/api/v1/sync/push/+server.ts`:
    - Caller must have a valid center ID: `const effectiveCenterId = caller.centerId ?? (rawBody.centerId as string | undefined);`.
      If `!effectiveCenterId`, return 400 `missing_tenant_context`.
    - In rate profile preflight lookup:
      Add `.eq('center_id', effectiveCenterId)` to the query against `rate_profiles`.
    - In `rpc_push_sync_op` invocation:
      Pass `p_center_id: effectiveCenterId` as the first argument in the RPC payload:
      ```ts
      await supabase.rpc('rpc_push_sync_op', {
        p_center_id: effectiveCenterId,
        p_device_id: parsed.data.deviceId,
        p_caller_id: caller.userId,
        p_caller_role: caller.role,
        p_ops: validOpsForRpc as unknown as Json,
      });
      ```
    - Tenant IDOR protection: if any operation payload specifies a `centerId` that does not match `effectiveCenterId`, reject that operation or the request with `403 forbidden_tenant_mismatch`.

R4. In `apps/web/src/routes/api/v1/sync/pull/+server.ts`:
    - Resolve center ID: `const effectiveCenterId = caller.centerId ?? url.searchParams.get('centerId');`.
      If `!effectiveCenterId && caller.role !== 'super_admin'`, return 400 `missing_center_id`.
    - Monotonic watermark check query:
      Change to `SELECT coalesce(max(server_seq), 0) as current_seq FROM entries WHERE center_id = $1` with `[effectiveCenterId]`.
    - Pull scanned entries CTE query:
      Update query to:
      ```sql
      with scanned as (
        select * from entries
        where center_id = $4 and server_seq > $1
        order by server_seq asc limit 200
      ),
      batch_meta as (
        select coalesce(max(server_seq), $1) as watermark,
               count(*) as scanned_count
        from scanned
      )
      select s.*, m.watermark, m.scanned_count
      from batch_meta m
      left join scanned s on ($2 in ('admin','owner','super_admin') or s.created_by = $3)
      order by s.server_seq asc nulls last;
      ```
      Pass `[sinceBigInt, caller.role, caller.userId, effectiveCenterId]`.
    - Metadata queries (`includeMeta === true || sinceStr === '0'`):
      Append `.eq('center_id', effectiveCenterId)` to:
      - `rate_profiles`
      - `payment_methods`
      - `payables`
      - `month_closes`
      - `app_settings` (change from `.select('*').single()` to `.select('*').eq('center_id', effectiveCenterId).single()`).

R5. In operational mutation routes, update RPC calls to pass `p_center_id: caller.centerId`:
    - `apps/web/src/routes/api/v1/settlements/payments/+server.ts`: pass `p_center_id: caller.centerId` to `record_settlement_payment`.
    - `apps/web/src/routes/api/v1/settlements/overpayment-approval/+server.ts`: pass `p_center_id: caller.centerId` to `approve_settlement_overpayment`.
    - `apps/web/src/routes/api/v1/months/close/+server.ts`: pass `p_center_id: caller.centerId` to `close_month`.
    - `apps/web/src/routes/api/v1/months/reopen/+server.ts`: pass `p_center_id: caller.centerId` to `reopen_month`.
    - `apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts`: pass `p_center_id: caller.centerId` to `supersede_statement`.
    - `apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts`: pass `p_center_id: caller.centerId` to `reconcile_statement`.
    - `apps/web/src/routes/api/v1/reconcile/statements/+server.ts`: pass `p_center_id: caller.centerId` to `create_statement`.
    - `apps/web/src/routes/api/v1/reconcile/match-line/+server.ts`: pass `p_center_id: caller.centerId` to `match_statement_line`.
    - `apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts`: pass `p_center_id: caller.centerId` to `unmatch_statement_line`.
    - `apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts`: pass `p_center_id: caller.centerId` to `accept_statement_line`.
    - `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts`: pass `p_center_id: caller.centerId` to `review_entry_reconciliation_exception`.
    - `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`: pass `p_center_id: caller.centerId` to `transfer_ownership`.
    - `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts`: pass `p_center_id: caller.centerId` to `admin_review_stale_entry`.

R6. In `apps/web/src/routes/api/v1/admin/audit/+server.ts`:
    - Enforce tenant isolation on audit log:
      If `caller.role !== 'super_admin'`, append `.eq('center_id', caller.centerId)`.
      If `caller.role === 'super_admin'`, allow optional query filter: `const filterCenter = event.url.searchParams.get('centerId'); if (filterCenter) query = query.eq('center_id', filterCenter);`.

R7. In `apps/web/src/hooks.server.ts`:
    - Add request correlation & timing middleware:
      ```ts
      const requestId = event.request.headers.get('x-request-id') || crypto.randomUUID();
      const start = Date.now();
      const response = await resolve(event);
      const durationMs = Date.now() - start;
      response.headers.set('x-request-id', requestId);
      if (event.url.pathname.startsWith('/api/')) {
        console.log(`[API] ${requestId} ${event.request.method} ${event.url.pathname} -> ${response.status} (${durationMs}ms)`);
      }
      ```

HARD RULES THAT APPLY (AGENTS.md)
- Rule 7: Financial and config writes go through SECURITY DEFINER RPCs under service_role.
- Rule 9: Server trusts nothing from client; verify center_id against authenticated JWT.
- Rule 11: Validate with Zod on client and server.

ACCEPTANCE CRITERIA
A1. `apps/web/src/lib/database.types.ts` is regenerated and defines `centers` and `center_id`.
A2. `pnpm --filter @clt/web check` (`svelte-check`) passes with 0 errors and 0 warnings.
A3. All 13 updated mutation routes (`sync/push`, `settlements/*`, `months/*`, `reconcile/*`, `admin/*`) pass `p_center_id: caller.centerId` to their respective RPCs.
A4. `sync/pull` scopes entry query and all metadata queries by `effectiveCenterId`.
A5. `/api/v1/admin/audit` restricts queries to `center_id = caller.centerId` for non-super_admin callers.
A6. `git status` shows modifications only to files listed under SCOPE.

VERIFICATION (run in order; paste output)
1. `npx supabase gen types typescript --local > apps/web/src/lib/database.types.ts`
2. `pnpm --filter @clt/web check`
3. `git status --short apps/web/`

STOP CONDITIONS (stop and report BLOCKED if)
- `npx supabase gen types` fails to connect to local Supabase.
- `svelte-check` reports unresolvable type mismatches with `@clt/shared` or `@clt/calc`.

REPORT FORMAT: TASK REPORT (below). Return it to the Orchestrator via Zia.
=== END BRIEF ===

=== TASK REPORT ===
TASK ID:
AGENT ID:
STATUS:          DONE | PARTIAL | BLOCKED | FAILED
SUMMARY:         <max 5 lines>
FILES CHANGED:   <path — create/modify/delete — one-line reason>
COMMANDS RUN:    <each command, then the real output (trim to 40 lines; save longer logs to
                  docs/orchestration/reports/<TASK ID>.log and give the path)>
ACCEPTANCE:      A1 PASS|FAIL — evidence | A2 ... (every criterion listed)
DEVIATIONS:      <anything done differently from the brief, and why; "none" if none>
ASSUMPTIONS:     <list; "none" if none>
OPEN ISSUES:     <list; "none" if none>
QUESTIONS:       <exactly one, or "none">
=== END REPORT ===

