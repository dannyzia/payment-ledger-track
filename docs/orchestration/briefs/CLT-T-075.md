# CLT-T-075 — Client Storage Multi-Center Isolation & Entry Capture Alignment

Scheduled: 2026-11-09. Origin: Approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md` (§6 Client Storage & Shift-Handover Outbox Protection, §7 Sequential Numbering, §2.C File Inventory) and Owner Decision `CLT-D-030`.

Belongs to: **Phase 5 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-075
TITLE:           Client Storage Multi-Center Isolation & Entry Capture Alignment
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-074
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§6, §7), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030, CLT-D-032)
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
In Phase 1–3 (`CLT-T-071`..`CLT-T-073`), the database baseline, shared DTOs, and API routes were updated for row-level multi-tenancy.
In Phase 4 (`CLT-T-074`), Platform Super-Admin center onboarding endpoints and UI were delivered.
This task (Phase 5) aligns client-side IndexedDB storage (`Dexie`), entry creation, void actions, and shift handover:
1. Dynamic center-scoped Dexie databases: `KumonLedger_${center_id}` per franchise center, preventing multi-tenant cache contamination on shared tablets.
2. Transparent backward compatibility: `db` export is maintained as a Proxy forwarding table queries to the active center database so existing UI components continue functioning without refactoring.
3. Shift-Handover Outbox Protection: `session.signOut()` warns if pending offline ops exist and never wipes `db.outbox` from disk. When the evening shift logs in, pending sync ops are preserved.
4. Entry Capture: `saveLocalEntry` accepts `centerId`, stamps `center_id` on local entries, and passes `centerId` in wire payloads so push sync IDOR checks succeed.
5. Entry Preview: displays `E-{CENTER_CODE}-...` when center context is available.

OBJECTIVE
Implement multi-center Dexie storage isolation, shift-safe outbox protection on sign-out, and tenant-scoped entry capture, achieving 0 errors on `svelte-check` and passing Dexie unit tests.

SCOPE (the ONLY files you may create or modify)
- apps/web/src/lib/db/index.ts — modify
- apps/web/src/lib/db/entries.ts — modify
- apps/web/src/lib/db/outbox.ts — modify
- apps/web/src/lib/ledger/void.ts — modify
- apps/web/src/lib/sync/push.ts — modify
- apps/web/src/lib/sync/pull.ts — modify
- apps/web/src/lib/auth/session.svelte.ts — modify
- apps/web/src/routes/(app)/entries/new/+page.svelte — modify
- apps/web/src/lib/db/dexie.test.ts — modify

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc or packages/shared.
- Do not modify supabase/migrations/.
- Do not modify server route handlers (`apps/web/src/routes/api/**`).
- Do not modify bootstrap script or test harness outside apps/web (handled in Phase 6).

REQUIREMENTS (numbered; each is testable)

R1. Dynamic Dexie Database Scoping in `apps/web/src/lib/db/index.ts`:
    - `CosmoDatabase` constructor accepts `databaseName: string = 'CosmoLedgerTrackDB'`.
    - Implement `getCenterDb(centerId?: string | null): CosmoDatabase`:
      - If `centerId` is provided: database name is `KumonLedger_${centerId}`.
      - If `centerId` is null, undefined, or empty: database name is `'CosmoLedgerTrackDB'`.
      - Caches instantiated database instances in a module-level `Map<string, CosmoDatabase>`.
    - Export `db` as a Proxy wrapping `CosmoDatabase`:
      - Dynamically resolves target instance via `getCenterDb(session.user?.centerId)`.
      - Binds methods to target instance and delegates table/property accesses.
    - Update interfaces:
      - `LocalEntry`: add `center_id?: string | undefined`.
      - `LocalOutboxOp`: add `centerId?: string | undefined`.
      - `CachedAppSettings`, `CachedRateProfile`, `CachedPaymentMethod`, `CachedPayable`, `CachedSettlement`, `CachedStatement`: add `center_id?: string | undefined`.

R2. Entry Capture & Storage Alignment in `apps/web/src/lib/db/entries.ts` & `outbox.ts`:
    - In `apps/web/src/lib/db/entries.ts`:
      - `SaveEntryInput` adds `centerId?: string | undefined`.
      - `saveLocalEntry`: sets `center_id: input.centerId` on `LocalEntry`.
      - Sets `centerId: input.centerId ?? null` in `wirePayload` (and inside `replacement` for supersede mode).
      - Passes `centerId: input.centerId` to outbox enqueue helpers.
      - `checkDuplicate`: filter active entries by `center_id === input.centerId` when `centerId` is provided.
    - In `apps/web/src/lib/db/outbox.ts`:
      - Update `enqueueCreateEntry` and `enqueueSupersedeEntry` to accept `centerId?: string | undefined` and store it in `LocalOutboxOp`.

R3. Void Workflow Alignment in `apps/web/src/lib/ledger/void.ts`:
    - In `requestEntryVoid` and `executeEntryVoid`:
      - Include `centerId: entry.center_id ?? null` in the outbox op `payload` object.

R4. Shift-Safe Outbox Flush in `apps/web/src/lib/sync/push.ts` & `pull.ts`:
    - In `apps/web/src/lib/sync/push.ts`:
      - In `flushOutboxPush`:
        - Include `centerId: session.user?.centerId ?? null` in the `postPush` JSON body.
        - Ensure every pushed op payload carries `centerId`.
        - For shift-handover: query pending ops from `db.outbox` regardless of previous user ID if they belong to the current center or device (while still setting `actor_id` appropriately).
    - In `apps/web/src/lib/sync/pull.ts`:
      - When `session.user?.role === 'super_admin'`, if a specific center is active in session storage (`clt_super_center`), append `&centerId=${activeCenter}` to `/api/v1/sync/pull`.

R5. Entry Form UI in `apps/web/src/routes/(app)/entries/new/+page.svelte`:
    - In `handleSave`: pass `centerId: session.user?.centerId` into `saveLocalEntry`.
    - Header badge: if `session.user?.centerCode` is present, render `Chip` with `E-{session.user.centerCode}-...` preview, maintaining `#LOCAL-xxxx` fallback.

R6. Shift-Handover Sign-Out Protection in `apps/web/src/lib/auth/session.svelte.ts`:
    - Update `signOut(force: boolean = false): Promise<boolean>`:
      - Query `db.outbox.where('status').equals('pending').count()`.
      - If `pendingCount > 0 && !force`:
        - If `typeof window !== 'undefined'` and `window.confirm`:
          - Prompt: `"${pendingCount} payments pending sync. Keep tablet connected to finish upload before signing out. Sign out anyway?"`
          - If cashier cancels: return `false` without signing out.
      - Never delete IndexedDB tables or clear `db.outbox` on sign out (`clearLocalSession` only clears memory state and `clt_cached_profile` localStorage).
      - Return `true` on successful sign-out.

R7. Unit Tests in `apps/web/src/lib/db/dexie.test.ts`:
    - Keep all 4 existing tests passing.
    - Add test #5: "maintains isolated databases per franchise center via getCenterDb":
      - Seeds entries in `getCenterDb('center-aaa')` and `getCenterDb('center-bbb')`.
      - Asserts that queries in `center-aaa` do not leak into `center-bbb`.

VERIFICATION
1. `pnpm --filter @clt/web test src/lib/db/dexie.test.ts`
   Must pass all tests (5/5).
2. `pnpm --filter @clt/web check`
   Must output: `svelte-check found 0 errors and 0 warnings`.
3. Check `git status --short` to confirm only the specified SCOPE files were touched.

TASK REPORT FORMAT
Send the report wrapped in a fenced code block with this header:
```
=== TASK REPORT ===
TASK ID:         CLT-T-075
AGENT ID:        A-IMP-1
STATUS:          DONE | BLOCKED
SUMMARY:         <2-4 sentences describing what was built>
FILES CHANGED:   <path>  <modify>  <short note>
COMMANDS RUN:    <numbered list of exact commands and their outputs>
ACCEPTANCE:      <A1-A3 pass/fail matching verification steps>
=== END REPORT ===
```

