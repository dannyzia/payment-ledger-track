# CLT-T-072 — Multi-Center Shared Types, Wire DTOs, Zod Schemas & Center-Prefixed Regex

Scheduled: 2026-11-08. Origin: Approved Technical Design Specification `docs/designs/multi_center_row_level_multitenancy.md` (§2.B File Inventory) and Owner Decision `CLT-D-030`.

Belongs to: **Phase 2 of Multi-Center Architecture (V1 Baseline)**.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-072
TITLE:           Multi-Center Shared Types, Wire DTOs, Zod Schemas & Center-Prefixed Regex
ASSIGNED TO:     A-IMP-1 (Implementer)
PRIORITY:        P0
DEPENDS ON:      CLT-T-071
PROJECT:         Kumon Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: docs/designs/multi_center_row_level_multitenancy.md (§2.B File Inventory, §7 Per-Center Numbering), AGENTS.md (Hard Rules 1–20), DECISIONS.md (CLT-D-030)
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
Phase 1 (CLT-T-071) completed the clean database baseline: 20 tables with FORCE RLS, 64-bit injective advisory locks, composite foreign keys, and atomic center provisioning via rpc_create_center.
Phase 2 establishes the shared TypeScript contracts across packages and processes by updating `@clt/shared`:
1. Incorporates `centerId: string` across core DTOs and Zod wire schemas.
2. Expands `UserRole` to include `'super_admin'`.
3. Defines `CenterDto` and `centerDtoSchema`.
4. Establishes the center-prefixed human-readable Entry ID format (`E-{CODE}-YYYYMM-XXXXXX`), regex `/^E-[A-Z0-9]{2,8}-\d{6}-\d{6}$/`, formatting, and parsing utilities.

OBJECTIVE
Update `@clt/shared` types, Zod wire schemas, and test suite to support multi-center contracts and center-prefixed entry IDs without touching `packages/calc` or `apps/web`.

SCOPE (the ONLY files you may create or modify)
- packages/shared/src/types.ts — modify
- packages/shared/src/wire.ts — modify
- packages/shared/test/wire.test.ts — modify

OUT OF SCOPE (you MUST NOT do these)
- Do not modify packages/calc (must remain pure and tenant-agnostic per Hard Rule 3).
- Do not modify apps/web/ or supabase/ or scripts/ (handled in subsequent phases).
- Do not alter integer poisha arithmetic or South Asian money formatting.

INPUTS (read these first)
- docs/designs/multi_center_row_level_multitenancy.md (§2.B File Inventory, §7 Per-Center Sequential Numbering)
- packages/shared/src/types.ts (current)
- packages/shared/src/wire.ts (current)
- packages/shared/test/wire.test.ts (current)

REQUIREMENTS (numbered; each is testable)
R1. In `packages/shared/src/types.ts`:
    - Define `UserRole`:
      ```ts
      export type UserRole = 'super_admin' | 'owner' | 'admin' | 'staff';
      ```
    - Define `CenterStatus`:
      ```ts
      export type CenterStatus = 'active' | 'suspended' | 'archived';
      ```
    - Define `CenterDto`:
      ```ts
      export interface CenterDto {
        id: string;
        centerNumber: number;
        code: string;
        name: string;
        legalEntityName: string;
        binNumber?: string | null;
        tradeLicenseNumber?: string | null;
        vatCircle?: string | null;
        address: string;
        phone: string;
        status: CenterStatus;
        createdAt: string;
      }
      ```
    - Add `centerId: string;` to `EntryDto`.
    - Add `centerId: string;` to `OutboxOpDto`.
    - Define `PayableDto`:
      ```ts
      export interface PayableDto {
        id: string;
        centerId: string;
        code: string;
        name: string;
        kind: 'vat' | 'method_charge';
        methodId?: string | null;
        dueDay: number;
        remindDaysBefore: number;
        active: boolean;
      }
      ```
    - Define `SettlementDto`:
      ```ts
      export interface SettlementDto {
        id: string;
        centerId: string;
        payableId: string;
        month: string;
        expectedPoisha: string;
        paidPoisha: string;
        variancePoisha: string;
        status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
        note?: string | null;
        overpaymentReviewStatus: 'none' | 'approved';
        overpaymentApprovedAmountPoisha?: string | null;
      }
      ```
    - Define `StatementDto`:
      ```ts
      export interface StatementDto {
        id: string;
        centerId: string;
        kind: 'single_payable' | 'combined_card';
        month: string;
        source: 'manual_total' | 'file';
        fileStoragePath?: string | null;
        fileSha256?: string | null;
        statementTotalPoisha: string;
        expectedPoisha: string;
        variancePoisha: string;
        status: 'open' | 'reconciled' | 'superseded';
        note?: string | null;
      }
      ```

R2. In `packages/shared/src/wire.ts`:
    - Add `centerDtoSchema`:
      ```ts
      export const centerDtoSchema = z.object({
        id: z.string().uuid(),
        centerNumber: z.number().int().positive(),
        code: z.string().regex(/^[A-Z0-9]{2,8}$/, {
          message: 'Center code must be 2-8 uppercase alphanumeric characters',
        }),
        name: z.string().min(1),
        legalEntityName: z.string().min(1),
        binNumber: z.string().nullable().optional(),
        tradeLicenseNumber: z.string().nullable().optional(),
        vatCircle: z.string().nullable().optional(),
        address: z.string().min(1),
        phone: z.string().min(1),
        status: z.enum(['active', 'suspended', 'archived']),
        createdAt: z.string().datetime({ offset: true }),
      });
      ```
    - Add `centerId: z.string().uuid()` to `outboxOpSchema`.
    - Add `centerId: z.string().uuid()` to `entryDtoSchema`.
    - Add `centerId: z.string().uuid()` to `rateProfileSchema`.
    - Add `ENTRY_ID_REGEX`:
      ```ts
      export const ENTRY_ID_REGEX = /^E-[A-Z0-9]{2,8}-\d{6}-\d{6}$/;
      export const entryIdSchema = z.string().regex(ENTRY_ID_REGEX, {
        message: 'Entry ID must match format E-{CENTER_CODE}-YYYYMM-XXXXXX',
      });
      ```
    - Add entry ID helper functions:
      ```ts
      export function formatEntryId(
        centerCode: string,
        entryDate: string | Date,
        seq: bigint | number,
      ): string {
        const code = centerCode.toUpperCase();
        if (!/^[A-Z0-9]{2,8}$/.test(code)) {
          throw new TypeError(`Invalid center code: "${centerCode}"`);
        }
        let ym: string;
        if (typeof entryDate === 'string') {
          // Expect YYYY-MM-DD or YYYY-MM
          const match = entryDate.match(/^(\d{4})-(\d{2})/);
          if (!match) throw new TypeError(`Invalid entry date format: "${entryDate}"`);
          ym = `${match[1]}${match[2]}`;
        } else {
          const y = entryDate.getUTCFullYear();
          const m = String(entryDate.getUTCMonth() + 1).padStart(2, '0');
          ym = `${y}${m}`;
        }
        const s = BigInt(seq);
        if (s <= 0n) {
          throw new RangeError(`Entry sequence must be positive: ${seq}`);
        }
        return `E-${code}-${ym}-${s.toString().padStart(6, '0')}`;
      }

      export function parseEntryId(
        id: string,
      ): { centerCode: string; yearMonth: string; seq: bigint } | null {
        const match = id.match(/^E-([A-Z0-9]{2,8})-(\d{6})-(\d{6})$/);
        if (!match) return null;
        return {
          centerCode: match[1],
          yearMonth: match[2],
          seq: BigInt(match[3]),
        };
      }
      ```

R3. In `packages/shared/test/wire.test.ts`:
    - Add test cases verifying `centerDtoSchema` (positive and negative: lowercase codes, invalid length, invalid UUID).
    - Add test cases verifying `outboxOpSchema` and `entryDtoSchema` require valid `centerId` UUIDs.
    - Add test cases verifying `formatEntryId`:
      - Positive: `formatEntryId('MHK', '2026-11-08', 42)` -> `'E-MHK-202611-000042'`.
      - Positive: with 64-bit bigint seq `formatEntryId('RMP', new Date('2026-12-01T00:00:00Z'), 100000n)` -> `'E-RMP-202612-100000'`.
      - Negative: invalid center codes (`'mhk'`, `'A'`, `'TOOLONGCODE'`).
      - Negative: invalid sequences (`0`, `-1`).
    - Add test cases verifying `parseEntryId`:
      - Positive: `'E-MHK-202611-000042'` -> `{ centerCode: 'MHK', yearMonth: '202611', seq: 42n }`.
      - Negative: legacy format `'E-202611-000042'` returns `null`.
      - Negative: malformed strings return `null`.
    - Verify all existing 8 wire tests still pass with the updated schemas.

HARD RULES THAT APPLY (AGENTS.md)
- Rule 2: Money is integer poisha. No floats anywhere in money paths.
- Rule 3: packages/calc remains pure, mathematical, and tenant-agnostic.
- Rule 11: Validate with Zod on client and server.

ACCEPTANCE CRITERIA
A1. `pnpm --filter @clt/shared build` compiles cleanly with exit 0 (`tsc --build`).
A2. `npx vitest run packages/shared/test/wire.test.ts` executes and passes 100% of test cases.
A3. `formatEntryId('MHK', '2026-11-08', 42)` returns exactly `'E-MHK-202611-000042'`.
A4. `parseEntryId('E-202611-000042')` returns `null` (legacy single-tenant format rejected).
A5. `git status` shows modifications only to `packages/shared/`.

VERIFICATION (run in order; paste output)
1. `pnpm --filter @clt/shared build`
2. `npx vitest run packages/shared/test/wire.test.ts`
3. `git status --short packages/`

STOP CONDITIONS (stop and report BLOCKED if)
- TypeScript build fails on `@clt/shared`.
- Zod schema types conflict with `@clt/calc` exports.

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

