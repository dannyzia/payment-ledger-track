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

## CLT-D-009: Auth-trigger provisioning vs GoTrue's metadata timing; zero-owner guard narrowed; auth-trigger EXECUTE grant; Kong restart after db:reset (2026-11-04, Plan 006)

**Found while running** `pnpm db:bootstrap` (Plan 006) against local Supabase. GoTrue creates an auth user in one transaction whose `raw_app_meta_data` is empty at row-insert time (metadata is applied in a separate later UPDATE). This breaks three assumptions the migrations made:

1. **`fn_auth_users_create_profile`** (insert trigger) provisioned the profile with role `'staff'` even for the bootstrap owner payload, because the role key was not yet present at insert time.
2. **`fn_prevent_zero_owners`** (deferred constraint trigger) counted owners on the INSERT path at commit; on day zero (empty DB, first signup) that trips `422 exactly_one_owner_required` and breaks createUser. The guard's actual invariant is "no mutation may REMOVE the last active owner", and only UPDATE-demote/DELETE can do that (a second owner is blocked by the `one_owner` partial index anyway).
3. The GoTrue DB role (`supabase_auth_admin`) had no `search_path` visibility or EXECUTE grants for these trigger functions; its session reported `relation "profiles" does not exist` at commit.

**Chosen (migration 000005 amended):**
1. `fn_prevent_zero_owners` now enforces only removal operations: raises `422 exactly_one_owner_required` when an UPDATE demotes/deactivates the last active owner or a DELETE removes an owner leaving none. Pure INSERTs skip the check (inserts cannot remove owners; day-zero provisioning is legitimate). The demote-before-promote atomicity guarantee is preserved because deferred constraint triggers evaluate after the whole transaction's changes are applied.
2. New `fn_auth_users_sync_profile_role()` + `trg_auth_users_sync_profile_role` (after update of `raw_app_meta_data`/`raw_user_meta_data` on auth.users): re-derives `profiles.role` strictly from `raw_app_meta_data->>'role'` (admin-managed JSON; never user-modifiable). Absence/invalidity of the role key must NOT demote (GoTrue writes provider-only metadata on OAuth flows).
3. `fn_auth_users_create_profile` qualified `public.profiles` explicitly and both auth-trigger functions are `SECURITY DEFINER set search_path = public, pg_temp` with EXECUTE granted to `supabase_auth_admin` (the only direct grants to that role; keeps anon/authenticated/public revocations intact).
4. `db:reset` restarts the Kong container after `supabase db reset`: Kong caches the GoTrue upstream IP, which is recreated by the reset and then returns "Connection refused"/502 until Kong re-resolves (local dev operational fixup).

**Effect:** bootstrap creates the owner via Supabase Auth Admin API with `app_metadata: {role:'owner'}`; the profile is provisioned 'staff' by the insert trigger and set to 'owner' by the metadata-update trigger before the transaction commits. Bootstrap verified twice; SSL/registration privilege model unchanged.

## CLT-D-010: Plan 007 lint suppressions for attribute forwarding and the floating-menu a11y hit (2026-11-04)

**Found:** root `pnpm lint` (eslint-plugin-svelte) fails on the verbatim Plan 007 spec code. The plugin compiles every `.svelte` file a second time as a custom element, which emits `custom_element_props_identifier` for Button/Card/Chip — a rest-props note relevant only to custom-element compilation, which this app never uses (the plan's own P2.1 feature is generic attribute forwarding via rest props; svelte-check's normal single compile is clean). Separately, the FloatingMenu's `role="region"` + `tabindex="0"` + keydown container triggers the plugin's static a11y rules; the region is deliberately draggable and keyboard-operable per the plan's Step 4 (arrow navigation, Escape collapse).

**Chosen:**
1. FloatingMenu: two `svelte-ignore a11y_*` comments directly above the element with an inline justification comment; svelte-check now reports 0 warnings.
2. Button, Card, Chip: per-file `/* eslint-disable svelte/valid-compile */` inside the `<script>` with justification; the normal-compile `svelte-check` gate remains authoritative for compile health and reports 0 errors/0 warnings.

**Effect:** `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @clt/web check` all pass; no component behavior changes; both unit suites (tokens contrast ratios, draggable collision/snap/pinned) pass.

## CLT-D-012: Plan 008 typing and host-runtime accommodations (2026-11-04)

**Found while verifying** the verbatim Plan 008 spec blocks against the actual toolchain:

1. supabase-js typed clients with no Database generic resolve `.from(...)` result rows as `never`, which breaks `svelte-check`. Generated the real `Database` types from the local schema (`supabase gen types typescript --local` → `apps/web/src/lib/database.types.ts`) and added the `<Database>` generic to both the browser client and the server-only client. Spec blocks otherwise unchanged.
2. `vi.mock('$app/navigation')` added in `auth.test.ts`: SvelteKit's `goto()` refuses to run outside the app browser runtime ("Cannot call goto(...) on the server"), so the redirect call is stubbed while the guard's `cancel()` decisions are asserted directly. Guard code unchanged.
3. Plan 011 placeholders: block 6.12's `(app)/+layout.svelte` imports `$lib/ui/SyncIndicator.svelte` and `$lib/sync/runner.svelte.ts` (Plan 011 deliverables) while 008's own acceptance demands `check` passing. Created minimal, clearly marked placeholder stubs (Pill indicator + no-op start/stop runner) that Plan 011 replaces (CLT-D-011).
4. CLI-generated RPC arg types omit the SQL `DEFAULT NULL` unions (`p_role`/`p_active` of `admin_manage_user` typed as `string`/`boolean`), so the route passes the runtime-identical null through typed locals instead of disabling types.
5. CommandPalette's `autofocus` attribute (a11y "Avoid using autofocus") replaced with an equivalent programmatic `$effect` focus on open; visual/keyboard behavior identical.

**Effect:** `pnpm --filter @clt/web check` → 0 errors/0 warnings; web suites 17/17 (auth 7, tokens 5, draggable 5); root lint/typecheck pass.

## CLT-D-013: Plan 009 endpoint supersessions, invite guard relocation, and verbatim-code lint sweep (2026-11-04)

1. **Endpoint supersession (expected by the plan):** Plan 009 blocks 6.16–6.18 replace the Plan 008 `/api/v1/admin/users/+server.ts` (now GET roster + PATCH role/deactivate via `admin_manage_user`), `/api/v1/admin/users/invite/+server.ts`, and `/api/v1/admin/transfer-ownership/+server.ts` in full. The invite route no longer contains the Plan 008 `403 cannot_invite_owner` guard: owner invites are now rejected at the Zod-schema level as `invalid_payload` (400), structurally before the RPC. Consequence flagged for later verification: **Test #59's exact expected `403 cannot_invite_owner` string is not reachable from this route as written**; when the PRD §16.2 harness (Plans 019+) exercises it, reconcile against this decision rather than silently editing the route back.
2. **Lint sweep on the verbatim spec code:** Plan 009 ships `catch (e: any)` bodies, `Record<string, any>`, `(row: any)`/`(m: any)`/`(a: any)` callbacks, a `Map<string, any>`, unused `loading` state vars, and an unused `each` index — 33 root-lint errors across 12 files. Mechanical replacements, behavior-identical: `catch (e)` + `e instanceof Error ? e.message : String(e)`; `Record<string, unknown>`; inline structural row/callback types; a typed `DeviceGroup` and a typed `ProfileRow | null | undefined` (version `number | null` per the generated types); `as unknown as { full_name?: string | null } | null` for the device-join read; `snapshot` (Json-typed) hoisted through `as unknown as { version?: string | number } | null` before the `?.version ?? 1` fallback; users page select cast `as 'staff' | 'admin'` to match `updateUserRole(userId: string, newRole: 'staff' | 'admin')`.
3. **Three unused-`loading` false positives** (admin hub, rates, settings: declared and `= false` written but seemingly unread in script — read via the svelte template) carry a one-line `eslint-disable-next-line @typescript-eslint/no-unused-vars` with justification, per the CLT-D-010 precedent; `svelte-check` (0 errors/0 warnings) remains the compile-health gate. An initial sweep pass that dropped `loading` entirely caused svelte-check "Cannot find name 'loading'" errors; reverted to a plan-doc re-extraction of the affected pages with only the intended fixes reapplied.

**Effect:** web suites 27/27 (admin 10, auth 7, tokens 5, draggable 5); `pnpm --filter @clt/web check` → 0 errors/0 warnings; root lint and typecheck clean.

## CLT-D-014: Plan 010 lint sweep on verbatim entry-form code and chip-group a11y caption (2026-11-04)

1. **Mechanical lint sweep** (same CLT-D-013 pattern, applied at extraction): the verbatim Plan 010 blocks shipped `catch (err: any) { saveErrorMessage = \`Save error: ${err.message}\`; }` and five `as Record<string, any>` test casts. Replaced with `catch (err: unknown)` + the standard `err instanceof Error ? err.message : String(err)` narrowing, and `as unknown as Record<string, string>` in `dexie.test.ts` (and `catch (e)` narrowing in `new/+page.svelte`). Behavior identical; all suites pass unchanged.
2. **`e.name === 'DeductionsExceedGrossError'` removed:** the verbatim catch checked `e instanceof DeductionsExceedGrossError || e.name === 'DeductionsExceedGrossError'`. The `e.name` probe on `unknown` fails strict TS; the `instanceof` check is the operative one (the plan itself says the only thrower with that message is `DeductionsExceedGrossError`), so the redundant string check was dropped and the catch narrowed via `instanceof` + `e instanceof Error` fallback. Message text per branch unchanged.
3. **"Payment Method" chip-group label:** svelte a11y `a11y_label_has_associated_control` fires on the verbatim label because it captions a chip group of `<button>`s with no single form control to associate. Added an inline justification comment plus `svelte-ignore`, per the CLT-D-010 precedent; `svelte-check` reports 0 errors/0 warnings.

**Effect:** `dexie.test.ts` 4/4 (save latency < 100 ms, decimal-string storage, customer-borne isolation, local supersede status); web suites 31/31; root suite 99/99; svelte-check 0/0; root lint and typecheck clean.

## CLT-D-015: Plan 011 functional alignment fixes and lint sweep on verbatim sync code (2026-11-04)

1. **Stray brace in verbatim block 6.3:** the plan's `recovery.ts` block ends with an extra unbalanced `}` (spec typo). Removed; file compiles.
2. **`cannot_supersede_non_active` contradiction resolved toward the plan's own scope text and tests:** the plan's handler only deleted the ghost replacement and commented "do NOT reactivate original entries", but the same plan's §2 Scope ("deleting uncommitted replacement entries and reverting original entries to active") and its own sync.test.ts expect the original reverted to `status: 'active'`, `sync_status: 'synced'`. Implemented the revert (local-only supersede never committed server-side). PRD §9.2.2's ghost-rollback intent governs; server-side statement of truth is unaffected.
3. **`discardRejectedOp` upsert:** the verbatim handler only `update`s an existing `db.rejectedOps` row, but the plan's own Test #18 path expects a `discarded` row even when no local rejection row was recorded. When the row is absent, upsert it with `error_code: 'discarded_by_user'`, the discard reason, and the failed op's payload; existing rows keep the plain `update`.
4. **Outbox pending queries in sync.test.ts use `.and()` filtering:** `where({ status, userId })` requires a compound `[status+userId]` index absent from the verbatim Plan 010 schema (the plan's own `push.ts` uses `.where('status').equals(...).and(...)`). Tests rewritten to the `.and()` form instead of changing the Dexie schema.
5. **Mechanical lint sweep (CLT-D-013/014 pattern, applied at extraction):** `catch (err/calcErr)` narrowing (one removed entirely as unused); typed DTOs replacing `Array<any>` (`settlements`/`statements` inline row types in `pull.ts`, `RawRateProfile`/`MappedRateProfile` in the pull `+server.ts`, typed method-rate find in the push `+server.ts`); `Record<string, unknown>` payloads cast `as unknown as Json` against the generated Supabase Database types on `sync_ops. insert`, `audit_log.after`, and `p_ops`; `(cleanupTimer as unknown as { unref?: () => void }).unref?.()` because DOM `setInterval` returns `number`; prefer-const (sessions, `updatedPayload`, `snapshot`); unused imports removed (`LocalOutboxOp`, `CachedRejectedOp`, `computeJcsSha256`, `DeductionsExceedGrossError`, `beforeEach`); unused Web-Lock `lock` parameter dropped; null guards `effectiveProfile.version ?? 0` and `p_rate_version ?? undefined`; `overpayment_review_status` narrowed to the `Column 'none' | 'approved'` domain.
6. **`LocalEntry` override-reason reads:** Plan 010's schema lacks `vat_override_reason`/`commission_override_reason`; `retryRejectedOp` reads them through typed local casts rather than widening the entry schema.
7. **Port note:** a stale `vite preview` of an old static build serves 5173 (no API routes — Plan 011 acceptance ran against a fresh `vite dev` on 5174, then the dev server was stopped).

**Effect:** sync.test.ts 10/10; web suites 41/41; root suite 99/99; svelte-check 0 errors/0 warnings; lint and typecheck clean; unauthenticated `POST /api/v1/sync/push` and `GET /api/v1/sync/pull` return HTTP 401 (curl on the dev server).
6. ESLint `@typescript-eslint/no-explicit-any` fired on the verbatim spec code (`syncFromSupabaseSession(sbSession: any)`, `app_metadata` cast, three `catch (err: any)`), plus an unused `session` import in the root layout. Replaced with the supabase-js `Session` type, a `UserSessionProfile['role']` cast, and `err: unknown` narrowing (`err instanceof Error ? err.message : fallback`) — behavior-identical; guard/redirect tests unchanged and passing.
