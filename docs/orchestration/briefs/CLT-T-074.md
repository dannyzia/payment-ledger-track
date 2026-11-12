# CLT-T-074 — Platform Super-Admin Endpoints & Center Onboarding UI

Scheduled: 2026-11-09. Origin: Approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md` (§4.3 Platform Super-Admin Governance, §5 Provisioning, §2.C File Inventory) and Owner Decision `CLT-D-030`.

Belongs to: **Phase 4 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-074
TITLE:           Platform Super-Admin Endpoints & Center Onboarding UI
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-073
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§4.3, §5, §6), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030, CLT-D-032)
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
In Phase 1 (`CLT-T-071`), the multi-tenant schema and `rpc_create_center` were implemented in migrations 001–007.
In Phase 2 (`CLT-T-072`), `@clt/shared` added `super_admin` to `UserRole`, `CenterDto`, `CenterStatus`, and center ID schemas.
In Phase 3 (`CLT-T-073`), SvelteKit API routes were aligned with tenant scoping and `CallerContext.centerId`.
This task (Phase 4) builds the Platform Super-Admin (BRAC Kumon Head Office) governance endpoints and user interface:
1. Endpoints for listing, provisioning, updating status, and searching franchise learning centers.
2. Updating `apps/web/src/routes/api/v1/auth/session/+server.ts` and `session.svelte.ts` to return and hold `centerId` and `centerCode`.
3. Updating navigation components (`Sidebar.svelte`, `FloatingMenu.svelte`, `+layout.svelte`) to support `super_admin` and display the active center badge / center switcher.
4. Authoring the Center Onboarding & Management page (`/admin/super/centers`) and Global Cross-Center Search (`/admin/super/search`).

OBJECTIVE
Implement the Super-Admin API endpoints and front-end management screens to allow BRAC Kumon Head Office to provision and monitor independent franchise learning centers with strict role gating (`requireRole(caller, ['super_admin'])`), achieving 0 errors on `svelte-check`.

SCOPE (the ONLY files you may create or modify)
- apps/web/src/routes/api/v1/admin/super/centers/+server.ts — create
- apps/web/src/routes/api/v1/admin/super/centers/[id]/+server.ts — create
- apps/web/src/routes/api/v1/admin/super/search/+server.ts — create
- apps/web/src/routes/api/v1/auth/session/+server.ts — modify
- apps/web/src/lib/auth/session.svelte.ts — modify
- apps/web/src/lib/ui/Sidebar.svelte — modify
- apps/web/src/lib/ui/FloatingMenu.svelte — modify
- apps/web/src/lib/ui/CommandPalette.svelte — modify (widen role prop to UserRole)
- apps/web/src/lib/ui/EntryDetailDrawer.svelte — modify (widen role prop to UserRole)
- apps/web/src/lib/reconcile/tolerance.ts — modify (widen callerRole to UserRole in MonthCloseGatesInput)
- apps/web/src/routes/(app)/+layout.svelte — modify
- apps/web/src/routes/(app)/admin/super/centers/+page.svelte — create
- apps/web/src/routes/(app)/admin/super/search/+page.svelte — create

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc or packages/shared.
- Do not modify supabase/migrations/.
- Do not modify Dexie offline schema or entry capture forms (handled in Phase 5).
- Do not modify bootstrap script or test suites (handled in Phase 6).

REQUIREMENTS (numbered; each is testable)

R1. API: `GET /api/v1/admin/super/centers`:
    - Requires role `super_admin` (`requireRole(caller, ['super_admin'])`); returns 403 otherwise.
    - Queries `centers` table ordered by `center_number ASC`.
    - Supports optional query param `?status=active|suspended|archived`.
    - Returns JSON `{ centers: CenterRow[] }`.

R2. API: `POST /api/v1/admin/super/centers`:
    - Requires role `super_admin` (`requireRole(caller, ['super_admin'])`); returns 403 otherwise.
    - Validates request body with Zod schema:
      ```ts
      const createCenterSchema = z.object({
        code: z.string().regex(/^[A-Z0-9]{2,8}$/, 'Code must be 2-8 uppercase alphanumeric characters'),
        name: z.string().min(1, 'Center name is required'),
        legalEntityName: z.string().min(1, 'Legal entity name is required'),
        binNumber: z.string().max(16).optional().nullable(),
        tradeLicense: z.string().max(32).optional().nullable(),
        address: z.string().min(1, 'Address is required'),
        phone: z.string().min(1, 'Phone number is required'),
        ownerEmail: z.string().email('Valid owner email is required'),
        ownerName: z.string().min(1, 'Owner name is required'),
      });
      ```
    - Invokes `supabase.rpc('rpc_create_center', { ... })` with `p_actor_id: caller.userId`.
    - If `ownerEmail` is provided:
      - Checks if user exists in Supabase Auth via `supabase.auth.admin.listUsers()`.
      - If user does not exist, invites via `supabase.auth.admin.inviteUserByEmail(ownerEmail, { data: { full_name: ownerName }, app_metadata: { role: 'owner', center_id: centerId } })`.
      - If user exists, updates app_metadata via `supabase.auth.admin.updateUserById(existingUser.id, { app_metadata: { role: 'owner', center_id: centerId } })`.
    - Returns status 201 with `{ success: true, center: result }`. If code already exists, handles `center_code_taken` with HTTP 409.

R3. API: `PATCH /api/v1/admin/super/centers/[id]`:
    - Requires role `super_admin` (`requireRole(caller, ['super_admin'])`); returns 403 otherwise.
    - Validates `[id]` parameter is a valid UUID.
    - Accepts partial body: `status` ('active' | 'suspended' | 'archived'), `name`, `legalEntityName`, `address`, `phone`, `binNumber`, `tradeLicense`.
    - Note: `code` is immutable per `trg_centers_immutable_code`; reject or omit `code` updates.
    - Logs state change in `audit_log` with `action: 'center.update'`, `target_table: 'centers'`, `target_id: id`.
    - Returns `{ success: true, center: updatedCenter }`.

R4. API: `GET /api/v1/admin/super/search`:
    - Requires role `super_admin` (`requireRole(caller, ['super_admin'])`); returns 403 otherwise.
    - Query parameters:
      - `q`: string (searches entry number, customer name, transaction reference, amount)
      - `centerId`: optional UUID to filter by center
      - `limit`: number (default 50, max 100)
    - Returns JSON `{ entries: SearchEntryResult[] }` including center code and name.

R5. Update `apps/web/src/routes/api/v1/auth/session/+server.ts`:
    - Return `centerId: caller.centerId`.
    - If `caller.centerId` is present, fetch `centerCode: centers.code` and `centerName: centers.name` from `centers` table.
    - If `caller.role === 'super_admin'`, set `defaultRoute: '/admin/super/centers'`.
    - Include `centerId, centerCode, centerName` in JSON response.

R6. Update `apps/web/src/lib/auth/session.svelte.ts`:
    - Import `UserRole` from `@clt/shared`.
    - Update `UserSessionProfile`:
      ```ts
      export interface UserSessionProfile {
        id: string;
        email: string;
        role: UserRole;
        active: boolean;
        centerId?: string | null;
        centerCode?: string | null;
        centerName?: string | null;
        fullName?: string | undefined;
      }
      ```
    - Update `syncFromSupabaseSession` and `revalidateActiveProfile` to populate and persist `centerId`, `centerCode`, `centerName`.

R7. Update Navigation Components:
    - In `Sidebar.svelte`:
      - Accept `role?: UserRole`.
      - When `role === 'super_admin'`, render super-admin links:
        - "Franchise Centers" -> `/admin/super/centers`
        - "Global Search" -> `/admin/super/search`
        - "Audit Trail" -> `/admin/audit`
    - In `FloatingMenu.svelte`:
      - Accept `role?: UserRole`.
      - Render super-admin navigation options on mobile when `role === 'super_admin'`.
    - In `+layout.svelte`:
      - Display Center Badge in header:
        - For franchise staff/admin/owner: badge showing `{session.user?.centerCode} - {session.user?.centerName}`.
        - For `super_admin`: badge showing `PLATFORM SUPER-ADMIN`.
      - If `super_admin`, provide a Center Switcher select/dropdown that allows filtering the current session context to a specific center or "All Centers (Global)".

R8. Front-End Pages:
    - Create `apps/web/src/routes/(app)/admin/super/centers/+page.svelte`:
      - Shows list/cards of all franchise learning centers with code, name, phone, address, status, and creation date.
      - "Provision New Center" modal containing input fields for Code, Center Name, Legal Entity Name, BIN, Trade License, Address, Phone, Initial Owner Name, Initial Owner Email.
      - Status control buttons on each center row to toggle `active` / `suspended` / `archived`.
      - Guard: if user is not `super_admin`, display access denied / redirect to `/dashboard`.
    - Create `apps/web/src/routes/(app)/admin/super/search/+page.svelte`:
      - Search bar with instant or Enter-triggered search against `/api/v1/admin/super/search`.
      - Center filter dropdown (All Centers vs individual center).
      - Table of results showing Center Code, Entry ID, Date, Gross, Net, Method, Customer, Reference.

VERIFICATION
1. `pnpm --filter @clt/web check`
   Must output: `svelte-check found 0 errors and 0 warnings`.
2. Inspect route files and ensure all endpoints import `getCallerContext` and enforce `requireRole(caller, ['super_admin'])`.
3. Check `git status --short` to confirm only the specified SCOPE files were touched.

TASK REPORT FORMAT
Send the report wrapped in a fenced code block with this header:
```
=== TASK REPORT ===
TASK ID:         CLT-T-074
AGENT ID:        A-IMP-1
STATUS:          DONE | BLOCKED
SUMMARY:         <2-4 sentences describing what was built>
FILES CHANGED:   <path>  <create|modify>  <short note>
COMMANDS RUN:    <numbered list of exact commands and their outputs>
ACCEPTANCE:      <A1-A3 pass/fail matching verification steps>
=== END REPORT ===
```

