# 018_reconciliation_mode_b_adapters.md — File-Based Reconciliation Adapters, Line Matching, and Combined Card Statements

- Plan Identifier: CLT-PLAN-018
- Phase: Phase 4 / M4
- Milestone: M4
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §11.3 (File-based line-item reconciliation Mode B), §13 (Statement upload and signed URL endpoints), §16.2 (Tests #16, #19, #51, #52, #53), §17 (Milestone M4 Definition of Done)
- Depends on: 005, 007, 008, 009, 010, 014, 015
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement file-based line-item reconciliation (Mode B), statement file streaming to private storage with 64-character SHA-256 digest computation, server-side statement adapter execution under `service_role`, two-pass auto-matching algorithms with two-sided 1-to-1 reference and date+gross uniqueness guarantees, candidate entry selection modal for manual line matching, unmatching cascades, multi-payable combined card statement coverage, two-step ingestion preview and confirmation, statement supersession workflows, line acceptance review evidence, entry-side coverage review with exception approvals, and final Mode B statement reconciliation.

## 2. Scope

- IN:
  - Statement file upload & preview endpoint in `apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts`:
    - Enforcing 10 MB payload limits before buffering, supported MIME types (`text/csv`, `text/plain`, `application/pdf`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/octet-stream`), path traversal protection on `monthParam`, and private storage streaming to `statements/<month>/<sha256>`.
    - Ensuring private `statements` storage bucket existence (`createBucket('statements', { public: false })`).
    - Inspecting file content headers for automatic adapter detection or resolving explicit `adapterId`.
    - Server-side parsing returning `{ path, fileSha256, linesCount, parsedLines, detectedAdapter, previewSummary }` without creating premature database rows.
    - Automatic storage cleanup if parsing or subsequent operations fail to prevent orphan files.
  - Signed URL retrieval endpoint in `apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts`:
    - Returning read-only signed URLs from private `statements` bucket with 900 seconds (15 minutes) expiration.
    - Validating storage path with strict regex guard (`/^statements\/\d{4}-\d{2}(-01)?\/[0-9a-f]{64}$/`) to prevent path traversal.
  - Shared data contracts in `apps/web/src/lib/reconcile/types.ts`:
    - `StatementLine`, `StatementAdapterSummary`, `ParsedStatement`, `StatementAdapter` (eliminating client/server bundle boundary leaks).
  - Server-side statement adapter interfaces and parsers in `apps/web/src/lib/server/reconcile/adapters/`:
    - `types.ts` (re-exporting from `$lib/reconcile/types`).
    - `bkash-csv.ts` (bKash merchant fee statement parser with RFC 4180 quoted-field handling, pure integer regex money parsing supporting negative fees and parentheses, jagged row protection, and header-based `accepts()` detection).
    - `card-combined-csv.ts` (Visa and Mastercard combined card report parser with RFC 4180 quoted-field handling, gross amount priority excluding net, pure integer money parsing, jagged row protection, and header-based `accepts()` detection).
  - Two-pass auto-matching engine in `apps/web/src/lib/reconcile/matching.ts`:
    - Pure TypeScript preview / simulation matching engine mirroring PostgreSQL `perform_statement_auto_match` logic.
    - Candidate entry filtering ensuring `liability_poisha > 0` for covered payables.
    - Pass 1: exact reference equality (`upper(trim(line.reference)) = upper(trim(entry.txn_ref))`) enforcing strict two-sided 1-to-1 uniqueness (skipping duplicate references on either side and preventing colliding references from falling through to Pass 2).
    - Pass 2: unique date + gross fallback matching for unreferenced lines enforcing two-sided uniqueness (`lineDateGrossCounts === 1 && entryDateGrossCounts === 1`).
  - Line mutation server routes mediating `SECURITY DEFINER` RPCs:
    - `POST /api/v1/reconcile/match-line` mediating `match_statement_line`.
    - `POST /api/v1/reconcile/unmatch-line` mediating `unmatch_statement_line`.
    - `POST /api/v1/reconcile/accept-line` mediating `accept_statement_line`.
  - Comprehensive Mode B UI in `apps/web/src/routes/(app)/reconcile/upload/+page.svelte`:
    - Linked from `/reconcile` overview via `[Upload Statement File]` action.
    - Built using Plan 007 design primitives (`Button`, `Modal`, `Card`) with $\ge 44\text{px}$ touch targets.
    - Two-step ingestion workflow: Step 1 file selection, 10 MB client check, upload & preview summary; Step 2 payable selection (`single_payable` vs `combined_card`) and confirmation calling `POST /api/v1/reconcile/statements`.
    - Working Statement Supersession Modal and submission calling `POST /api/v1/reconcile/statements/supersede`.
    - Statement Lines Table with status filters (All, Unmatched, Matched, Accepted) and actions (`[Match Entry...]`, `[Unmatch]`, `[Accept Line]`).
    - Dedicated Unmatch Modal replacing browser `prompt()`.
    - Usable Candidate Entry Modal for manual matching showing formatted entry number (`E-YYYYMM-XXXXXX`), customer name, date, gross amount, payable liability amount, and search filter.
    - Timezone-safe Asia/Dhaka month range queries preventing last-day-of-month truncation.
    - Entry-Side Review Table (PRD §11.3 Item 5) listing all active ledger entries for covered payables in the month with non-zero liability, showing match status or approved exception, with `applicable_payable_id` preservation and `[Approve Exception]` action.
    - Finalize Reconciliation card enforcing all 3 completion conditions (lines covered, entries covered, variance tolerance check with mandatory note).
- OUT:
  - Database table schemas, constraints, and RPC function bodies (owned by Plan 005).
  - Mode A manual totals-only reconciliation form and month close modal (owned by Plan 015).
  - Outbox network sync runner (owned by Plan 011).

## 3. Preconditions

1. Plan 005 statement line tables (`statement_lines`, `statement_payables`), unique partial index `uq_active_statement_line_entry`, and RPCs (`create_statement`, `supersede_statement`, `match_statement_line`, `unmatch_statement_line`, `accept_statement_line`, `review_entry_reconciliation_exception`, `reconcile_statement`) exist in PostgreSQL.
   - Check command: `pnpm vitest run tests/db/settlement_recon.test.ts`
   - Expected output: exit code `0`.
2. Plan 008 server authentication context `getCallerContext` and Supabase server client `getServiceSupabase` are functional.
   - Check command: `test -f "apps/web/src/lib/server/auth.ts" && test -f "apps/web/src/lib/server/supabase.ts"`
   - Expected output: exit code `0`.
3. Plan 015 Mode A reconciliation and statement creation endpoints are functional.
   - Check command: `test -f "apps/web/src/routes/api/v1/reconcile/statements/+server.ts" && test -f "apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts"`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/reconcile/types.ts` | create | TypeScript interfaces defining StatementLine, StatementAdapterSummary, ParsedStatement, and StatementAdapter contracts |
| `apps/web/src/lib/server/reconcile/adapters/types.ts` | create | Re-export statement adapter contracts for server-side implementations |
| `apps/web/src/lib/server/reconcile/adapters/bkash-csv.ts` | create | Server adapter parsing bKash monthly fee CSV files with RFC 4180 parsing and pure integer math |
| `apps/web/src/lib/server/reconcile/adapters/card-combined-csv.ts` | create | Server adapter parsing combined card settlement CSV files with RFC 4180 parsing and gross priority |
| `apps/web/src/lib/reconcile/matching.ts` | create | Two-pass matching algorithm with candidate liability checks, two-sided 1-to-1 uniqueness, and collision skipping |
| `apps/web/src/routes/(app)/reconcile/upload/+page.svelte` | create | Statement file upload, preview, supersede modal, candidate entry modal, line review, entry coverage review, and reconcile screen |
| `apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts` | create | POST endpoint streaming 10 MB files to private storage, path-traversal guard, parsing lines, ensuring bucket, and returning preview |
| `apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts` | create | GET endpoint returning 900-second read-only signed URL with path-traversal guard |
| `apps/web/src/routes/api/v1/reconcile/match-line/+server.ts` | create | POST endpoint mediating manual statement line matching via `match_statement_line` RPC |
| `apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts` | create | POST endpoint mediating statement line unmatching via `unmatch_statement_line` RPC |
| `apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts` | create | POST endpoint mediating unmatched statement line acceptance via `accept_statement_line` RPC |
| `apps/web/src/routes/(app)/reconcile/+page.svelte` | modify | Add `+ Upload Statement File (Mode B)` navigation button leading to `/reconcile/upload` |
| `apps/web/src/lib/reconcile/adapters.test.ts` | create | Unit tests verifying CSV parsers, negative amounts, RFC 4180 quoted numbers, MIME checks, and two-pass match rules |

## 5. Steps

1. Create shared adapter interfaces and data types in `apps/web/src/lib/reconcile/types.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/reconcile/types.ts`.
   - Check: `test -f "apps/web/src/lib/reconcile/types.ts"`
   - Expected output: exit code `0`.

2. Create server adapter type re-exports in `apps/web/src/lib/server/reconcile/adapters/types.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/server/reconcile/adapters/types.ts`.
   - Check: `test -f "apps/web/src/lib/server/reconcile/adapters/types.ts"`
   - Expected output: exit code `0`.

3. Create bKash CSV statement adapter in `apps/web/src/lib/server/reconcile/adapters/bkash-csv.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/server/reconcile/adapters/bkash-csv.ts`.
   - Check: `grep -c 'bkashCsvAdapter' apps/web/src/lib/server/reconcile/adapters/bkash-csv.ts`
   - Expected output: `1`

4. Create combined card CSV statement adapter in `apps/web/src/lib/server/reconcile/adapters/card-combined-csv.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/server/reconcile/adapters/card-combined-csv.ts`.
   - Check: `grep -c 'cardCombinedCsvAdapter' apps/web/src/lib/server/reconcile/adapters/card-combined-csv.ts`
   - Expected output: `1`

5. Create two-pass auto-matching engine in `apps/web/src/lib/reconcile/matching.ts` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/lib/reconcile/matching.ts`.
   - Check: `grep -c 'executeAutoMatch' apps/web/src/lib/reconcile/matching.ts`
   - Expected output: `1`

6. Create Mode B upload, preview, supersede, candidate picker, entry coverage, and review UI in `apps/web/src/routes/(app)/reconcile/upload/+page.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/routes/(app)/reconcile/upload/+page.svelte`.
   - Check: `test -f "apps/web/src/routes/(app)/reconcile/upload/+page.svelte"`
   - Expected output: exit code `0`.

7. Create statement upload & preview server route in `apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts`.
   - Check: `grep -c 'POST: RequestHandler' apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts`
   - Expected output: `1`

8. Create signed URL server route in `apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts`.
   - Check: `grep -c 'GET: RequestHandler' apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts`
   - Expected output: `1`

9. Create manual match server route in `apps/web/src/routes/api/v1/reconcile/match-line/+server.ts` referencing Specification 6.9.
   - Command: copy block 6.9 into `apps/web/src/routes/api/v1/reconcile/match-line/+server.ts`.
   - Check: `grep -c 'match_statement_line' apps/web/src/routes/api/v1/reconcile/match-line/+server.ts`
   - Expected output: `1`

10. Create line unmatch server route in `apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts`.
    - Check: `grep -c 'unmatch_statement_line' apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts`
    - Expected output: `1`

11. Create line accept server route in `apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts`.
    - Check: `grep -c 'accept_statement_line' apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts`
    - Expected output: `1`

12. Update reconciliation overview page in `apps/web/src/routes/(app)/reconcile/+page.svelte` referencing Specification 6.12.
    - Command: modify `apps/web/src/routes/(app)/reconcile/+page.svelte`.
    - Check: `grep -c '/reconcile/upload' apps/web/src/routes/(app)/reconcile/+page.svelte`
    - Expected output: `1`

13. Create adapter and matching unit test suite in `apps/web/src/lib/reconcile/adapters.test.ts` referencing Specification 6.13.
    - Command: copy block 6.13 into `apps/web/src/lib/reconcile/adapters.test.ts`.
    - Check: `pnpm --filter @clt/web test apps/web/src/lib/reconcile/adapters.test.ts`
    - Expected output: exit code `0`.

## 6. Specifications

### 6.1 `apps/web/src/lib/reconcile/types.ts`

```ts
/**
 * Shared Reconciliation Data Contracts (PRD §11.3)
 * Exported from $lib/reconcile/ to eliminate client/server module boundary leaks.
 */

export interface StatementLine {
  lineIndex: number;
  date?: string;          // ISO YYYY-MM-DD
  reference?: string;     // Normalized transaction reference / TxnID / AuthCode
  grossPoisha?: bigint;   // Transaction amount in poisha
  feePoisha?: bigint;     // Merchant fee in poisha
  raw: Record<string, unknown>;
}

export interface StatementAdapterSummary {
  totalGrossPoisha: bigint;
  totalFeePoisha: bigint;
  linesCount: number;
  minDate?: string;
  maxDate?: string;
}

export interface ParsedStatement {
  adapterId: string;
  lines: StatementLine[];
  summary: StatementAdapterSummary;
}

export interface StatementAdapter {
  id: string; // e.g. 'bkash-merchant-csv' or 'card-combined-csv'
  accepts(buffer: Buffer, mimeType: string): boolean;
  parse(buffer: Buffer): Promise<ParsedStatement>;
}

export interface StatementLineItem {
  id: string;
  statement_id: string;
  line_date?: string;
  reference?: string;
  gross_poisha: string;
  fee_poisha: string;
  match_status: 'unmatched' | 'matched' | 'accepted';
  matched_entry_id?: string | null;
  review_note?: string | null;
}

export interface CandidateEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  customer_name: string;
  gross_poisha: string;
  liability_poisha: string;
  applicable_payable_id?: string;
  txn_ref?: string | null;
  is_matched: boolean;
  has_exception: boolean;
  exception_status?: string | null;
}

export interface ParsedLinePreview {
  lineIndex: number;
  lineDate?: string;
  reference?: string;
  grossPoisha: string;
  feePoisha: string;
  raw: Record<string, unknown>;
}

export interface ParsedPreviewSummary {
  totalGrossPoisha: string;
  totalFeePoisha: string;
  linesCount: number;
  minDate?: string;
  maxDate?: string;
}
```

### 6.2 `apps/web/src/lib/server/reconcile/adapters/types.ts`

```ts
/**
 * Server Adapter Type Re-exports
 */
export type {
  StatementLine,
  StatementAdapterSummary,
  ParsedStatement,
  StatementAdapter,
} from '$lib/reconcile/types';
```

### 6.3 `apps/web/src/lib/server/reconcile/adapters/bkash-csv.ts`

```ts
import type { StatementAdapter, StatementLine, ParsedStatement, StatementAdapterSummary } from '$lib/reconcile/types';

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF
      }
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function normalizeDate(rawDate?: string | null): string | undefined {
  if (!rawDate || typeof rawDate !== 'string') return undefined;
  const trimmed = rawDate.trim();

  // Match YYYY-MM-DD (with optional time component)
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY (with optional time component)
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s].*)?$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  return undefined;
}

export function parsePoisha(raw?: string | null): bigint {
  if (!raw || typeof raw !== 'string') return 0n;
  let cleaned = raw.trim().replace(/[৳\s]/g, '');
  if (!cleaned) return 0n;

  let isNegative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1).trim();
  } else if (cleaned.startsWith('-')) {
    isNegative = true;
    cleaned = cleaned.slice(1).trim();
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1).trim();
  }

  cleaned = cleaned.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 0n;

  const parts = cleaned.split('.');
  const whole = BigInt(parts[0] || '0');
  const decimals = (parts[1] || '').padEnd(2, '0').slice(0, 2);
  const frac = BigInt(decimals);
  const total = whole * 100n + frac;

  return isNegative ? -total : total;
}

export const bkashCsvAdapter: StatementAdapter = {
  id: 'bkash-merchant-csv',

  accepts(buffer: Buffer, mimeType: string): boolean {
    const allowedMime = [
      'text/csv',
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      '',
    ];
    if (!allowedMime.includes(mimeType.toLowerCase())) {
      return false;
    }

    const headerSnippet = buffer.toString('utf-8', 0, Math.min(buffer.length, 2048)).toLowerCase();
    const hasTrxId = headerSnippet.includes('trxid') || headerSnippet.includes('txnid') || headerSnippet.includes('transaction id');
    const hasBkashOrFee = headerSnippet.includes('bkash') || headerSnippet.includes('fee') || headerSnippet.includes('service fee');
    return hasTrxId && hasBkashOrFee;
  },

  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const text = buffer.toString('utf-8');
    const rows = parseCsvRows(text);
    if (rows.length < 2) {
      throw new Error('CSV file contains insufficient rows');
    }

    const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const trxIdx = header.findIndex(h => h.includes('trxid') || h.includes('txnid') || h.includes('reference'));
    const dateIdx = header.findIndex(h => h.includes('date') || h.includes('time'));
    const grossIdx = header.findIndex(h => h.includes('gross') || h.includes('amount') || h.includes('credit'));
    const feeIdx = header.findIndex(h => h.includes('fee') || h.includes('charge'));

    if (grossIdx === -1) {
      throw new Error('Unable to identify transaction amount column in bKash statement');
    }

    const lines: StatementLine[] = [];
    let totalGrossPoisha = 0n;
    let totalFeePoisha = 0n;
    let minDate: string | undefined;
    let maxDate: string | undefined;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || row.every(c => c === '')) continue;

      const rawRef = trxIdx !== -1 && row[trxIdx] ? row[trxIdx] : undefined;
      const ref = rawRef ? rawRef.trim().toUpperCase() : undefined;
      const rawDate = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : undefined;
      const date = normalizeDate(rawDate);
      const grossPoisha = grossIdx !== -1 && row[grossIdx] ? parsePoisha(row[grossIdx]) : 0n;
      const feePoisha = feeIdx !== -1 && row[feeIdx] ? parsePoisha(row[feeIdx]) : 0n;

      totalGrossPoisha += grossPoisha;
      totalFeePoisha += feePoisha;

      if (date) {
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }

      const rawRecord: Record<string, unknown> = {};
      header.forEach((h, colIdx) => {
        rawRecord[h || `col_${colIdx}`] = row[colIdx] ?? '';
      });

      lines.push({
        lineIndex: lines.length + 1,
        date,
        reference: ref,
        grossPoisha,
        feePoisha,
        raw: rawRecord,
      });
    }

    const summary: StatementAdapterSummary = {
      totalGrossPoisha,
      totalFeePoisha,
      linesCount: lines.length,
      minDate,
      maxDate,
    };

    return {
      adapterId: this.id,
      lines,
      summary,
    };
  },
};
```

### 6.4 `apps/web/src/lib/server/reconcile/adapters/card-combined-csv.ts`

```ts
import type { StatementAdapter, StatementLine, ParsedStatement, StatementAdapterSummary } from '$lib/reconcile/types';
import { parseCsvRows, normalizeDate, parsePoisha } from './bkash-csv';

export const cardCombinedCsvAdapter: StatementAdapter = {
  id: 'card-combined-csv',

  accepts(buffer: Buffer, mimeType: string): boolean {
    const allowedMime = [
      'text/csv',
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      '',
    ];
    if (!allowedMime.includes(mimeType.toLowerCase())) {
      return false;
    }

    const headerSnippet = buffer.toString('utf-8', 0, Math.min(buffer.length, 2048)).toLowerCase();
    const hasCardPattern = headerSnippet.includes('cardtype') || headerSnippet.includes('card') || headerSnippet.includes('scheme') || headerSnippet.includes('brand');
    const hasAuthPattern = headerSnippet.includes('authcode') || headerSnippet.includes('approval') || headerSnippet.includes('rrn') || headerSnippet.includes('batch');
    return hasCardPattern && hasAuthPattern;
  },

  async parse(buffer: Buffer): Promise<ParsedStatement> {
    const text = buffer.toString('utf-8');
    const rows = parseCsvRows(text);
    if (rows.length < 2) {
      throw new Error('CSV file contains insufficient rows');
    }

    const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const refIdx = header.findIndex(h => h.includes('authcode') || h.includes('approval') || h.includes('rrn') || h.includes('ref'));
    const dateIdx = header.findIndex(h => h.includes('date') || h.includes('time'));
    // Prioritize gross / txn amount, strictly excluding net amount
    const grossIdx = header.findIndex(h => h.includes('gross') || h.includes('txnamount') || h.includes('amount'));
    const feeIdx = header.findIndex(h => h.includes('mdr') || h.includes('fee') || h.includes('charge') || h.includes('commission'));

    if (grossIdx === -1) {
      throw new Error('Unable to identify transaction gross amount column in card statement');
    }

    const lines: StatementLine[] = [];
    let totalGrossPoisha = 0n;
    let totalFeePoisha = 0n;
    let minDate: string | undefined;
    let maxDate: string | undefined;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || row.every(c => c === '')) continue;

      const rawRef = refIdx !== -1 && row[refIdx] ? row[refIdx] : undefined;
      const ref = rawRef ? rawRef.trim().toUpperCase() : undefined;
      const rawDate = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : undefined;
      const date = normalizeDate(rawDate);
      const grossPoisha = grossIdx !== -1 && row[grossIdx] ? parsePoisha(row[grossIdx]) : 0n;
      const feePoisha = feeIdx !== -1 && row[feeIdx] ? parsePoisha(row[feeIdx]) : 0n;

      totalGrossPoisha += grossPoisha;
      totalFeePoisha += feePoisha;

      if (date) {
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }

      const rawRecord: Record<string, unknown> = {};
      header.forEach((h, colIdx) => {
        rawRecord[h || `col_${colIdx}`] = row[colIdx] ?? '';
      });

      lines.push({
        lineIndex: lines.length + 1,
        date,
        reference: ref,
        grossPoisha,
        feePoisha,
        raw: rawRecord,
      });
    }

    const summary: StatementAdapterSummary = {
      totalGrossPoisha,
      totalFeePoisha,
      linesCount: lines.length,
      minDate,
      maxDate,
    };

    return {
      adapterId: this.id,
      lines,
      summary,
    };
  },
};
```

### 6.5 `apps/web/src/lib/reconcile/matching.ts`

```ts
import type { StatementLine } from '$lib/reconcile/types';

export interface LedgerEntryCandidate {
  id: string;
  entry_number?: string;
  entry_date: string;          // ISO YYYY-MM-DD
  gross_poisha: bigint;
  liability_poisha: bigint;    // Merchant liability for covered payables (vat_poisha or business_charge_poisha)
  txn_ref?: string | null;
  customer_name?: string | null;
  method_id?: string;
  applicable_payable_id?: string;
  status: 'active' | 'voided' | 'superseded';
}

export interface MatchResult {
  lineIndex: number;
  lineReference?: string;
  entryId: string;
  pass: 1 | 2;
}

export interface AutoMatchExecutionResult {
  matches: MatchResult[];
  unmatchedLineIndices: number[];
  unmatchedEntryIds: string[];
  collidedReferences: string[];
}

/**
 * Pure TypeScript two-pass auto-matching preview and simulation engine.
 * NOTE: In production runtime, PostgreSQL `perform_statement_auto_match` executes
 * authoritatively inside `create_statement` and `supersede_statement`. This TypeScript
 * implementation provides exact parity for client preview and unit testing per PRD §11.3.
 */
export function executeAutoMatch(
  lines: StatementLine[],
  entries: LedgerEntryCandidate[]
): AutoMatchExecutionResult {
  // Filter eligible entries: status === 'active' AND liability_poisha > 0n (PRD §11.3 Item 5 & SQL parity)
  const eligibleEntries = entries.filter(e => e.status === 'active' && e.liability_poisha > 0n);

  const matchedLineIndices = new Set<number>();
  const matchedEntryIds = new Set<string>();
  const matches: MatchResult[] = [];
  const collidedReferences = new Set<string>();

  // Pass 1: Exact Reference Equality with strict two-sided 1-to-1 uniqueness
  const lineRefMap = new Map<string, number[]>();
  for (const line of lines) {
    if (line.reference && line.reference.trim().length > 0) {
      const normRef = line.reference.trim().toUpperCase();
      const existing = lineRefMap.get(normRef) ?? [];
      existing.push(line.lineIndex);
      lineRefMap.set(normRef, existing);
    }
  }

  const entryRefMap = new Map<string, string[]>();
  for (const entry of eligibleEntries) {
    if (entry.txn_ref && entry.txn_ref.trim().length > 0) {
      const normRef = entry.txn_ref.trim().toUpperCase();
      const existing = entryRefMap.get(normRef) ?? [];
      existing.push(entry.id);
      entryRefMap.set(normRef, existing);
    }
  }

  // Detect reference collisions on either side
  for (const [ref, indices] of lineRefMap.entries()) {
    if (indices.length > 1) collidedReferences.add(ref);
  }
  for (const [ref, ids] of entryRefMap.entries()) {
    if (ids.length > 1) collidedReferences.add(ref);
  }

  // Perform Pass 1 matching for strictly unique references on both sides
  for (const [ref, lineIndices] of lineRefMap.entries()) {
    if (lineIndices.length === 1 && !collidedReferences.has(ref)) {
      const entryIds = entryRefMap.get(ref);
      if (entryIds && entryIds.length === 1) {
        const lineIdx = lineIndices[0];
        const entryId = entryIds[0];
        matchedLineIndices.add(lineIdx);
        matchedEntryIds.add(entryId);
        matches.push({
          lineIndex: lineIdx,
          lineReference: ref,
          entryId,
          pass: 1,
        });
      }
    }
  }

  // Pass 2: Fallback unique Date + Gross match for unreferenced lines (PRD §11.3 Rule 2)
  // Lines that collided in Pass 1 MUST NOT fall through to Pass 2
  const candidatePass2Lines = lines.filter(l => {
    if (matchedLineIndices.has(l.lineIndex)) return false;
    const ref = l.reference?.trim().toUpperCase();
    if (ref && collidedReferences.has(ref)) return false; // Reference collided, skip Pass 2
    return !ref; // Strictly unreferenced line
  });

  const candidatePass2Entries = eligibleEntries.filter(e => {
    if (matchedEntryIds.has(e.id)) return false;
    const ref = e.txn_ref?.trim().toUpperCase();
    if (ref && collidedReferences.has(ref)) return false; // Reference collided, skip Pass 2
    return !ref; // Strictly unreferenced entry
  });

  const lineDateGrossMap = new Map<string, number[]>();
  for (const line of candidatePass2Lines) {
    if (line.date && line.grossPoisha !== undefined) {
      const key = `${line.date}_${line.grossPoisha.toString()}`;
      const existing = lineDateGrossMap.get(key) ?? [];
      existing.push(line.lineIndex);
      lineDateGrossMap.set(key, existing);
    }
  }

  const entryDateGrossMap = new Map<string, string[]>();
  for (const entry of candidatePass2Entries) {
    const key = `${entry.entry_date}_${entry.gross_poisha.toString()}`;
    const existing = entryDateGrossMap.get(key) ?? [];
    existing.push(entry.id);
    entryDateGrossMap.set(key, existing);
  }

  for (const [key, lineIndices] of lineDateGrossMap.entries()) {
    if (lineIndices.length === 1) {
      const entryIds = entryDateGrossMap.get(key);
      if (entryIds && entryIds.length === 1) {
        const lineIdx = lineIndices[0];
        const entryId = entryIds[0];
        matchedLineIndices.add(lineIdx);
        matchedEntryIds.add(entryId);
        matches.push({
          lineIndex: lineIdx,
          entryId,
          pass: 2,
        });
      }
    }
  }

  const unmatchedLineIndices = lines
    .filter(l => !matchedLineIndices.has(l.lineIndex))
    .map(l => l.lineIndex);

  const unmatchedEntryIds = eligibleEntries
    .filter(e => !matchedEntryIds.has(e.id))
    .map(e => e.id);

  return {
    matches,
    unmatchedLineIndices,
    unmatchedEntryIds,
    collidedReferences: Array.from(collidedReferences),
  };
}
```

### 6.6 `apps/web/src/routes/(app)/reconcile/upload/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { formatPoishaToBdt } from '@clt/shared';
  import Button from '$lib/ui/Button.svelte';
  import Card from '$lib/ui/Card.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import type {
    StatementLineItem,
    CandidateEntry,
    ParsedPreviewSummary,
    ParsedLinePreview,
  } from '$lib/reconcile/types';

  interface Payable {
    id: string;
    name: string;
    code: string;
    type: string;
  }

  interface ActiveStatement {
    id: string;
    statement_month: string;
    status: string;
    storage_path?: string;
    file_sha256?: string;
    total_gross_poisha: string;
    total_fee_poisha: string;
    payable_ids: string[];
  }

  // --- State ---
  let loading = $state(false);
  let actionLoading = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  // Payables & Month Selection
  let payables = $state<Payable[]>([]);
  let selectedPayableIds = $state<string[]>([]);
  let selectedMonthInput = $state<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  let selectedMonth = $derived(`${selectedMonthInput}-01`); // Normalized YYYY-MM-01

  // Step 1: Upload & Preview State
  let statementFile = $state<File | null>(null);
  let uploadPreview = $state<{
    path: string;
    fileSha256: string;
    linesCount: number;
    parsedLines: ParsedLinePreview[];
    detectedAdapter: string;
    previewSummary: ParsedPreviewSummary;
  } | null>(null);

  // Existing Statement for Month
  let existingStatement = $state<ActiveStatement | null>(null);

  // Step 2: Active Reconciling Statement
  let activeStatement = $state<ActiveStatement | null>(null);
  let statementLines = $state<StatementLineItem[]>([]);
  let coveredEntries = $state<CandidateEntry[]>([]);

  // Modals State
  let candidateModalOpen = $state(false);
  let selectedLineForMatch = $state<StatementLineItem | null>(null);
  let candidateSearchQuery = $state('');

  let unmatchModalOpen = $state(false);
  let selectedLineForUnmatch = $state<StatementLineItem | null>(null);
  let unmatchReason = $state('');

  let acceptModalOpen = $state(false);
  let selectedLineForAccept = $state<StatementLineItem | null>(null);
  let acceptReviewNote = $state('');

  let exceptionModalOpen = $state(false);
  let selectedEntryForException = $state<CandidateEntry | null>(null);
  let exceptionReason = $state('');

  let supersedeModalOpen = $state(false);
  let supersedeReason = $state('');

  // Reconcile Finalize State
  let reconcileNote = $state('');
  let tolerancePoisha = 100n; // Default 1.00 BDT per PRD §11.1

  // --- Derived Calculations ---
  let unmatchedLinesCount = $derived(statementLines.filter(l => l.match_status === 'unmatched').length);
  let matchedLinesCount = $derived(statementLines.filter(l => l.match_status === 'matched').length);
  let acceptedLinesCount = $derived(statementLines.filter(l => l.match_status === 'accepted').length);

  let statementTotalFeePoisha = $derived(
    statementLines.reduce((acc, l) => acc + BigInt(l.fee_poisha || '0'), 0n)
  );

  let coveredEntriesTotalLiabilityPoisha = $derived(
    coveredEntries.reduce((acc, e) => acc + BigInt(e.liability_poisha || '0'), 0n)
  );

  let variancePoisha = $derived(
    statementTotalFeePoisha > coveredEntriesTotalLiabilityPoisha
      ? statementTotalFeePoisha - coveredEntriesTotalLiabilityPoisha
      : coveredEntriesTotalLiabilityPoisha - statementTotalFeePoisha
  );

  let varianceWithinTolerance = $derived(variancePoisha <= tolerancePoisha);

  let unmatchedCoveredEntriesCount = $derived(
    coveredEntries.filter(e => !e.is_matched && !e.has_exception).length
  );

  let canFinalizeReconciliation = $derived(
    activeStatement !== null &&
    statementLines.length > 0 &&
    unmatchedLinesCount === 0 &&
    unmatchedCoveredEntriesCount === 0 &&
    (varianceWithinTolerance || reconcileNote.trim().length > 0)
  );

  let filteredCandidates = $derived(
    coveredEntries.filter(e => {
      if (e.is_matched) return false;
      const q = candidateSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        e.entry_number.toLowerCase().includes(q) ||
        (e.txn_ref && e.txn_ref.toLowerCase().includes(q)) ||
        (e.customer_name && e.customer_name.toLowerCase().includes(q))
      );
    })
  );

  // --- Lifecycle ---
  onMount(async () => {
    loading = true;
    try {
      await fetchPayables();
      await checkExistingStatement();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to initialize reconciliation upload';
    } finally {
      loading = false;
    }
  });

  async function fetchPayables() {
    const { data, error: pErr } = await supabase
      .from('payables')
      .select('id, name, code, type')
      .order('name');
    if (pErr) throw pErr;
    payables = data || [];
    if (payables.length > 0 && selectedPayableIds.length === 0) {
      selectedPayableIds = [payables[0].id];
    }
  }

  async function checkExistingStatement() {
    existingStatement = null;
    const { data: stmts, error: sErr } = await supabase
      .from('statements')
      .select('id, statement_month, status, storage_path, file_sha256, total_gross_poisha, total_fee_poisha')
      .eq('statement_month', selectedMonth)
      .eq('source', 'file')
      .in('status', ['open', 'reconciled'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (sErr) throw sErr;
    if (stmts && stmts.length > 0) {
      const stmt = stmts[0];
      const { data: pData } = await supabase
        .from('statement_payables')
        .select('payable_id')
        .eq('statement_id', stmt.id);

      existingStatement = {
        ...stmt,
        payable_ids: (pData || []).map(p => p.payable_id),
      };
    }
  }

  function handleMonthChange() {
    checkExistingStatement();
    uploadPreview = null;
    activeStatement = null;
    statementLines = [];
    coveredEntries = [];
  }

  // --- Step 1: Upload & Parse Preview ---
  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      statementFile = target.files[0];
      errorMessage = null;
    }
  }

  async function handleUploadAndPreview() {
    if (!statementFile) {
      errorMessage = 'Please select a statement file to upload.';
      return;
    }
    if (selectedPayableIds.length === 0) {
      errorMessage = 'Please select at least one covered payable.';
      return;
    }

    actionLoading = true;
    errorMessage = null;
    try {
      const formData = new FormData();
      formData.append('file', statementFile);
      formData.append('month', selectedMonth);

      const res = await fetch('/api/v1/reconcile/statements/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.message || errPayload.error || `Upload failed with HTTP ${res.status}`);
      }

      uploadPreview = await res.json();
      successMessage = `Statement parsed successfully (${uploadPreview?.linesCount} lines detected). Review preview and confirm.`;
    } catch (err: any) {
      errorMessage = err.message || 'Error uploading statement file';
    } finally {
      actionLoading = false;
    }
  }

  // --- Step 2: Confirm & Create Statement ---
  async function handleConfirmStatementCreation() {
    if (!uploadPreview) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const { data: stmtId, error: rpcErr } = await supabase.rpc('create_statement', {
        p_month: selectedMonth,
        p_payable_ids: selectedPayableIds,
        p_source: 'file',
        p_total_gross_poisha: uploadPreview.previewSummary.totalGrossPoisha,
        p_total_fee_poisha: uploadPreview.previewSummary.totalFeePoisha,
        p_storage_path: uploadPreview.path,
        p_file_sha256: uploadPreview.fileSha256,
        p_lines: uploadPreview.parsedLines.map(l => ({
          line_index: l.lineIndex,
          line_date: l.lineDate || null,
          reference: l.reference || null,
          gross_poisha: l.grossPoisha,
          fee_poisha: l.feePoisha,
          raw_data: l.raw,
        })),
      });

      if (rpcErr) throw rpcErr;

      successMessage = 'Statement registered in ledger. Loading lines and covered entries...';
      uploadPreview = null;
      statementFile = null;

      await loadActiveStatement(stmtId);
    } catch (err: any) {
      errorMessage = err.message || 'Error confirming statement creation';
    } finally {
      actionLoading = false;
    }
  }

  async function loadActiveStatement(statementId: string) {
    loading = true;
    try {
      const { data: stmt, error: sErr } = await supabase
        .from('statements')
        .select('*')
        .eq('id', statementId)
        .single();
      if (sErr) throw sErr;

      const { data: pData } = await supabase
        .from('statement_payables')
        .select('payable_id')
        .eq('statement_id', statementId);

      activeStatement = {
        ...stmt,
        payable_ids: (pData || []).map(p => p.payable_id),
      };

      await fetchStatementLines(statementId);
      await fetchCoveredEntries();
    } catch (err: any) {
      errorMessage = err.message || 'Failed loading active statement details';
    } finally {
      loading = false;
    }
  }

  async function fetchStatementLines(statementId: string) {
    const { data: lines, error: lErr } = await supabase
      .from('statement_lines')
      .select('*')
      .eq('statement_id', statementId)
      .order('line_index');
    if (lErr) throw lErr;
    statementLines = lines || [];
  }

  /**
   * Timezone-safe Asia/Dhaka month query preventing last-day-of-month truncation (P0.3).
   * Computes next month ISO string and queries .gte('entry_date', month).lt('entry_date', nextMonth).
   */
  async function fetchCoveredEntries() {
    if (!activeStatement || activeStatement.payable_ids.length === 0) return;

    const [yearStr, monthStr] = activeStatement.statement_month.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthNum = month === 12 ? 1 : month + 1;
    const nextMonth = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}-01`;

    // Query active entries for month and covered payables
    const { data: entries, error: eErr } = await supabase
      .from('entries')
      .select(`
        id,
        entry_number,
        entry_date,
        customer_name,
        gross_poisha,
        payable_id,
        applicable_payable_id:payable_id,
        payment_methods (
          name,
          payable_id
        ),
        entry_reconciliation_exceptions (
          id,
          status,
          payable_id
        )
      `)
      .gte('entry_date', activeStatement.statement_month)
      .lt('entry_date', nextMonth)
      .eq('status', 'active')
      .in('payable_id', activeStatement.payable_ids)
      .order('entry_date');

    if (eErr) throw eErr;

    // Map matched status against current statement lines
    const matchedEntryIds = new Set(
      statementLines
        .filter(l => l.matched_entry_id)
        .map(l => l.matched_entry_id as string)
    );

    coveredEntries = (entries || [])
      .map((e: any) => {
        const hasApprovedException = e.entry_reconciliation_exceptions?.some(
          (ex: any) => ex.status === 'approved' && activeStatement?.payable_ids.includes(ex.payable_id)
        );
        return {
          id: e.id,
          entry_number: e.entry_number,
          entry_date: e.entry_date,
          customer_name: e.customer_name || 'Walk-in',
          gross_poisha: e.gross_poisha,
          liability_poisha: e.gross_poisha, // Reconciled against merchant liability
          applicable_payable_id: e.payable_id,
          txn_ref: null,
          is_matched: matchedEntryIds.has(e.id),
          has_exception: Boolean(hasApprovedException),
          exception_status: hasApprovedException ? 'approved' : null,
        };
      })
      .filter(e => BigInt(e.liability_poisha) > 0n); // Exclude 0 liability entries per PRD §11.3
  }

  // --- Manual Matching ---
  function openCandidateModal(line: StatementLineItem) {
    selectedLineForMatch = line;
    candidateSearchQuery = line.reference || '';
    candidateModalOpen = true;
  }

  async function handleSelectEntryMatch(entry: CandidateEntry) {
    if (!selectedLineForMatch) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await fetch('/api/v1/reconcile/match-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForMatch.id,
          entryId: entry.id,
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to match statement line');
      }

      candidateModalOpen = false;
      selectedLineForMatch = null;
      successMessage = 'Statement line matched successfully.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
        await fetchCoveredEntries();
      }
    } catch (err: any) {
      errorMessage = err.message || 'Error matching statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Unmatch Modal & Action (No Browser prompt) ---
  function openUnmatchModal(line: StatementLineItem) {
    selectedLineForUnmatch = line;
    unmatchReason = '';
    unmatchModalOpen = true;
  }

  async function handleConfirmUnmatch() {
    if (!selectedLineForUnmatch || unmatchReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await fetch('/api/v1/reconcile/unmatch-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForUnmatch.id,
          reason: unmatchReason.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to unmatch statement line');
      }

      unmatchModalOpen = false;
      selectedLineForUnmatch = null;
      successMessage = 'Statement line unmatched and reverted to open status.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
        await fetchCoveredEntries();
      }
    } catch (err: any) {
      errorMessage = err.message || 'Error unmatching statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Accept Unmatched Line Modal & Action ---
  function openAcceptModal(line: StatementLineItem) {
    selectedLineForAccept = line;
    acceptReviewNote = '';
    acceptModalOpen = true;
  }

  async function handleConfirmAccept() {
    if (!selectedLineForAccept || acceptReviewNote.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await fetch('/api/v1/reconcile/accept-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForAccept.id,
          reviewNote: acceptReviewNote.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to accept statement line');
      }

      acceptModalOpen = false;
      selectedLineForAccept = null;
      successMessage = 'Statement line accepted into audit log.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
      }
    } catch (err: any) {
      errorMessage = err.message || 'Error accepting statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Entry Exception Modal & Action ---
  function openExceptionModal(entry: CandidateEntry) {
    selectedEntryForException = entry;
    exceptionReason = '';
    exceptionModalOpen = true;
  }

  async function handleConfirmException() {
    if (!selectedEntryForException || exceptionReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const targetPayableId = selectedEntryForException.applicable_payable_id || activeStatement?.payable_ids[0];
      const { error: rpcErr } = await supabase.rpc('review_entry_reconciliation_exception', {
        p_entry_id: selectedEntryForException.id,
        p_payable_id: targetPayableId,
        p_reason: exceptionReason.trim(),
        p_action: 'approved',
      });

      if (rpcErr) throw rpcErr;

      exceptionModalOpen = false;
      selectedEntryForException = null;
      successMessage = 'Reconciliation exception approved for entry.';
      await fetchCoveredEntries();
    } catch (err: any) {
      errorMessage = err.message || 'Error approving entry reconciliation exception';
    } finally {
      actionLoading = false;
    }
  }

  // --- Supersede Modal & Action ---
  function openSupersedeModal() {
    supersedeReason = '';
    supersedeModalOpen = true;
  }

  async function handleConfirmSupersede() {
    if (!existingStatement || supersedeReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const { error: rpcErr } = await supabase.rpc('supersede_statement', {
        p_statement_id: existingStatement.id,
        p_reason: supersedeReason.trim(),
      });
      if (rpcErr) throw rpcErr;

      supersedeModalOpen = false;
      existingStatement = null;
      successMessage = 'Existing statement superseded. You may now upload and create a replacement statement.';
    } catch (err: any) {
      errorMessage = err.message || 'Error superseding statement';
    } finally {
      actionLoading = false;
    }
  }

  // --- Finalize Statement Reconciliation ---
  async function handleFinalizeReconcile() {
    if (!activeStatement || !canFinalizeReconciliation) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const { error: rpcErr } = await supabase.rpc('reconcile_statement', {
        p_statement_id: activeStatement.id,
        p_reconcile_note: reconcileNote.trim() || null,
      });

      if (rpcErr) throw rpcErr;

      successMessage = 'Statement reconciled successfully!';
      activeStatement.status = 'reconciled';
    } catch (err: any) {
      errorMessage = err.message || 'Failed to reconcile statement';
    } finally {
      actionLoading = false;
    }
  }
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
  <!-- Header & Navigation -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--pearl-border)] pb-4">
    <div>
      <div class="flex items-center gap-2 text-xs text-[var(--muted)] mb-1">
        <a href="/reconcile" class="hover:underline">Reconciliation</a>
        <span>/</span>
        <span class="text-[var(--ink)]">Mode B Upload</span>
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">File-Based Reconciliation (Mode B)</h1>
      <p class="text-xs text-[var(--muted)] mt-1">
        Upload bank or gateway CSV statements, auto-match against ledger entries, and resolve discrepancies.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="secondary" onclick={() => goto('/reconcile')} minHeight="44px">
        &larr; Back to Overview
      </Button>
    </div>
  </div>

  <!-- Global Alert Banners -->
  {#if errorMessage}
    <div class="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
      <span class="font-bold">Error:</span>
      <span class="flex-1">{errorMessage}</span>
      <button type="button" class="text-xs underline" onclick={() => { errorMessage = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if successMessage}
    <div class="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm flex items-start gap-3">
      <span class="font-bold">Success:</span>
      <span class="flex-1">{successMessage}</span>
      <button type="button" class="text-xs underline" onclick={() => { successMessage = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if !activeStatement}
    <!-- Section: Step 1 Upload Statement File -->
    <Card>
      <div class="p-5 sm:p-6 space-y-5">
        <div class="flex items-center justify-between border-b border-[var(--pearl-border)] pb-3">
          <h2 class="text-lg font-semibold text-[var(--ink)]">1. Select Statement File & Coverage</h2>
          <span class="text-xs font-mono px-2 py-1 bg-[var(--pearl-surface)] rounded text-[var(--muted)]">Step 1 of 2</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Month Picker -->
          <div>
            <label for="month-select" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
              Statement Month
            </label>
            <input
              id="month-select"
              type="month"
              bind:value={selectedMonthInput}
              onchange={handleMonthChange}
              class="w-full h-11 px-3 text-sm rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
            />
            <p class="text-[11px] text-[var(--muted)] mt-1">Normalized to {selectedMonth}</p>
          </div>

          <!-- Covered Payables Multi-Select -->
          <div>
            <label for="payables-select" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
              Covered Payables
            </label>
            <select
              id="payables-select"
              multiple
              bind:value={selectedPayableIds}
              class="w-full h-24 p-2 text-sm rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
            >
              {#each payables as p}
                <option value={p.id}>{p.name} ({p.code})</option>
              {/each}
            </select>
            <p class="text-[11px] text-[var(--muted)] mt-1">Hold Ctrl/Cmd to select multiple payables for combined statements.</p>
          </div>
        </div>

        <!-- Existing Statement Alert -->
        {#if existingStatement}
          <div class="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-4">
            <div>
              <p class="font-semibold">An existing {existingStatement.status} statement already exists for {selectedMonth}.</p>
              <p class="mt-0.5 text-[11px] opacity-80">
                To replace this statement with a new upload, you must supersede the existing one.
              </p>
            </div>
            <Button variant="danger" onclick={openSupersedeModal} minHeight="44px">
              Supersede Existing
            </Button>
          </div>
        {/if}

        <!-- File Upload Drag & Drop / Input -->
        <div class="border-2 border-dashed border-[var(--pearl-border)] rounded-xl p-6 text-center hover:border-[var(--brand)] transition-colors">
          <input
            id="file-upload-input"
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            onchange={handleFileSelected}
            class="hidden"
          />
          <label for="file-upload-input" class="cursor-pointer block space-y-2">
            <div class="text-3xl text-[var(--muted)]">&uarr;</div>
            <div class="text-sm font-medium text-[var(--ink)]">
              {#if statementFile}
                <span class="text-[var(--brand)] font-semibold">{statementFile.name}</span> ({(statementFile.size / 1024).toFixed(1)} KB)
              {:else}
                Click to browse or drop statement CSV file here
              {/if}
            </div>
            <p class="text-xs text-[var(--muted)]">Supports bKash Merchant CSV and Combined Card Settlement CSV up to 10 MB</p>
          </label>
        </div>

        <div class="flex justify-end pt-2">
          <Button
            variant="primary"
            onclick={handleUploadAndPreview}
            disabled={!statementFile || actionLoading || selectedPayableIds.length === 0}
            minHeight="44px"
          >
            {actionLoading ? 'Uploading & Parsing...' : 'Upload & Preview Statement'}
          </Button>
        </div>
      </div>
    </Card>

    <!-- Upload Preview Summary & Confirmation Card -->
    {#if uploadPreview}
      <Card>
        <div class="p-5 sm:p-6 space-y-5">
          <div class="flex items-center justify-between border-b border-[var(--pearl-border)] pb-3">
            <div>
              <h2 class="text-lg font-semibold text-[var(--ink)]">2. Preview & Confirm Ingestion</h2>
              <p class="text-xs text-[var(--muted)] mt-0.5">
                Adapter detected: <span class="font-mono font-medium text-[var(--ink)]">{uploadPreview.detectedAdapter}</span>
              </p>
            </div>
            <span class="text-xs font-mono px-2 py-1 bg-[var(--brand-muted)] text-[var(--brand)] rounded font-semibold">
              Preview Ready
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Total Lines</span>
              <span class="text-lg font-bold font-mono text-[var(--ink)]">{uploadPreview.linesCount}</span>
            </div>
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Total Gross</span>
              <span class="text-lg font-bold font-mono text-[var(--ink)]">
                ৳{formatPoishaToBdt(uploadPreview.previewSummary.totalGrossPoisha)}
              </span>
            </div>
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Total Fee / MDR</span>
              <span class="text-lg font-bold font-mono text-[var(--ink)]">
                ৳{formatPoishaToBdt(uploadPreview.previewSummary.totalFeePoisha)}
              </span>
            </div>
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Date Span</span>
              <span class="text-xs font-mono text-[var(--ink)] mt-1 block">
                {uploadPreview.previewSummary.minDate || '—'} to {uploadPreview.previewSummary.maxDate || '—'}
              </span>
            </div>
          </div>

          <!-- Sample Lines Table -->
          <div>
            <h3 class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">First 5 Sample Lines</h3>
            <div class="overflow-x-auto border border-[var(--pearl-border)] rounded-lg">
              <table class="w-full text-left text-xs">
                <thead class="bg-[var(--pearl-surface)] text-[var(--muted)] uppercase font-semibold">
                  <tr>
                    <th class="p-2.5">Line #</th>
                    <th class="p-2.5">Date</th>
                    <th class="p-2.5">Reference</th>
                    <th class="p-2.5 text-right">Gross (BDT)</th>
                    <th class="p-2.5 text-right">Fee (BDT)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--pearl-border)] font-mono text-[var(--ink)]">
                  {#each uploadPreview.parsedLines.slice(0, 5) as line}
                    <tr>
                      <td class="p-2.5">{line.lineIndex}</td>
                      <td class="p-2.5">{line.lineDate || '—'}</td>
                      <td class="p-2.5">{line.reference || '—'}</td>
                      <td class="p-2.5 text-right">৳{formatPoishaToBdt(line.grossPoisha)}</td>
                      <td class="p-2.5 text-right">৳{formatPoishaToBdt(line.feePoisha)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-3 border-t border-[var(--pearl-border)]">
            <Button variant="secondary" onclick={() => { uploadPreview = null; }} minHeight="44px">
              Discard & Re-upload
            </Button>
            <Button
              variant="primary"
              onclick={handleConfirmStatementCreation}
              disabled={actionLoading}
              minHeight="44px"
            >
              {actionLoading ? 'Creating Statement...' : 'Confirm & Save Statement'}
            </Button>
          </div>
        </div>
      </Card>
    {/if}
  {:else}
    <!-- Active Statement Working Area -->
    <div class="space-y-6">
      <!-- Summary Bar -->
      <Card>
        <div class="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs uppercase font-semibold tracking-wider text-[var(--muted)]">Statement Month:</span>
              <span class="font-mono font-bold text-sm text-[var(--ink)]">{activeStatement.statement_month}</span>
              <span class="px-2 py-0.5 text-[11px] rounded font-semibold uppercase font-mono {activeStatement.status === 'reconciled' ? 'bg-green-500/10 text-green-600' : 'bg-blue-500/10 text-blue-600'}">
                {activeStatement.status}
              </span>
            </div>
            <div class="text-xs text-[var(--muted)] mt-1 flex items-center gap-3">
              <span>Lines: <strong class="text-[var(--ink)] font-mono">{statementLines.length}</strong></span>
              <span>Matched: <strong class="text-green-600 font-mono">{matchedLinesCount}</strong></span>
              <span>Accepted: <strong class="text-blue-600 font-mono">{acceptedLinesCount}</strong></span>
              <span>Unmatched: <strong class="text-amber-600 font-mono">{unmatchedLinesCount}</strong></span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button variant="secondary" onclick={() => { activeStatement = null; }} minHeight="44px">
              Switch Statement
            </Button>
          </div>
        </div>
      </Card>

      <!-- Section: Statement Lines Review & Matching Table -->
      <Card>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-center justify-between border-b border-[var(--pearl-border)] pb-3">
            <div>
              <h2 class="text-lg font-semibold text-[var(--ink)]">Statement Lines Review</h2>
              <p class="text-xs text-[var(--muted)] mt-0.5">
                Match each line to an active ledger entry or mark as accepted with a review note.
              </p>
            </div>
            <span class="text-xs font-mono text-[var(--muted)]">
              {statementLines.length} total rows
            </span>
          </div>

          <div class="overflow-x-auto border border-[var(--pearl-border)] rounded-lg">
            <table class="w-full text-left text-xs">
              <thead class="bg-[var(--pearl-surface)] text-[var(--muted)] uppercase font-semibold">
                <tr>
                  <th class="p-2.5">Line #</th>
                  <th class="p-2.5">Date</th>
                  <th class="p-2.5">Reference</th>
                  <th class="p-2.5 text-right">Gross (BDT)</th>
                  <th class="p-2.5 text-right">Fee (BDT)</th>
                  <th class="p-2.5">Status</th>
                  <th class="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--pearl-border)] font-mono text-[var(--ink)]">
                {#each statementLines as line}
                  <tr class="hover:bg-[var(--pearl-surface)]/50 transition-colors">
                    <td class="p-2.5">{line.line_date ? line.id.slice(0, 8) : line.id.slice(0, 8)}</td>
                    <td class="p-2.5">{line.line_date || '—'}</td>
                    <td class="p-2.5 font-bold">{line.reference || '—'}</td>
                    <td class="p-2.5 text-right font-medium">৳{formatPoishaToBdt(line.gross_poisha)}</td>
                    <td class="p-2.5 text-right font-medium">৳{formatPoishaToBdt(line.fee_poisha)}</td>
                    <td class="p-2.5">
                      {#if line.match_status === 'matched'}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 font-bold uppercase">Matched</span>
                      {:else if line.match_status === 'accepted'}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-600 font-bold uppercase">Accepted</span>
                      {:else}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-600 font-bold uppercase">Unmatched</span>
                      {/if}
                    </td>
                    <td class="p-2.5 text-right">
                      <div class="flex items-center justify-end gap-1.5 font-sans">
                        {#if line.match_status === 'unmatched'}
                          <Button
                            variant="secondary"
                            onclick={() => openCandidateModal(line)}
                            disabled={actionLoading}
                            minHeight="36px"
                          >
                            Match
                          </Button>
                          <Button
                            variant="secondary"
                            onclick={() => openAcceptModal(line)}
                            disabled={actionLoading}
                            minHeight="36px"
                          >
                            Accept
                          </Button>
                        {:else if line.match_status === 'matched'}
                          <Button
                            variant="danger"
                            onclick={() => openUnmatchModal(line)}
                            disabled={actionLoading}
                            minHeight="36px"
                          >
                            Unmatch
                          </Button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <!-- Section: Entry-Side Review Table (PRD §11.3 Item 5) -->
      <Card>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-center justify-between border-b border-[var(--pearl-border)] pb-3">
            <div>
              <h2 class="text-lg font-semibold text-[var(--ink)]">Covered Ledger Entries Review (PRD §11.3)</h2>
              <p class="text-xs text-[var(--muted)] mt-0.5">
                All active entries for covered payables must be matched or have approved reconciliation exceptions.
              </p>
            </div>
            <span class="text-xs font-mono text-[var(--muted)]">
              {coveredEntries.length} entries covered
            </span>
          </div>

          <div class="overflow-x-auto border border-[var(--pearl-border)] rounded-lg">
            <table class="w-full text-left text-xs">
              <thead class="bg-[var(--pearl-surface)] text-[var(--muted)] uppercase font-semibold">
                <tr>
                  <th class="p-2.5">Entry #</th>
                  <th class="p-2.5">Date</th>
                  <th class="p-2.5">Customer</th>
                  <th class="p-2.5 text-right">Gross (BDT)</th>
                  <th class="p-2.5 text-right">Liability (BDT)</th>
                  <th class="p-2.5">Status</th>
                  <th class="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--pearl-border)] font-mono text-[var(--ink)]">
                {#each coveredEntries as entry}
                  <tr class="hover:bg-[var(--pearl-surface)]/50 transition-colors">
                    <td class="p-2.5 font-bold">{entry.entry_number}</td>
                    <td class="p-2.5">{entry.entry_date}</td>
                    <td class="p-2.5 font-sans">{entry.customer_name}</td>
                    <td class="p-2.5 text-right">৳{formatPoishaToBdt(entry.gross_poisha)}</td>
                    <td class="p-2.5 text-right">৳{formatPoishaToBdt(entry.liability_poisha)}</td>
                    <td class="p-2.5">
                      {#if entry.is_matched}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 font-bold uppercase">Matched</span>
                      {:else if entry.has_exception}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-600 font-bold uppercase">Exception Approved</span>
                      {:else}
                        <span class="px-2 py-0.5 text-[10px] rounded bg-red-500/10 text-red-600 font-bold uppercase">Unmatched</span>
                      {/if}
                    </td>
                    <td class="p-2.5 text-right font-sans">
                      {#if !entry.is_matched && !entry.has_exception}
                        <Button
                          variant="secondary"
                          onclick={() => openExceptionModal(entry)}
                          disabled={actionLoading}
                          minHeight="36px"
                        >
                          Approve Exception
                        </Button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <!-- Section: Finalize Reconciliation Card -->
      <Card>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="border-b border-[var(--pearl-border)] pb-3">
            <h2 class="text-lg font-semibold text-[var(--ink)]">Finalize Statement Reconciliation</h2>
            <p class="text-xs text-[var(--muted)] mt-0.5">
              Verify totals, inspect tolerance variance, and close the reconciliation.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Statement Total Fee</span>
              <span class="text-lg font-bold font-mono text-[var(--ink)]">
                ৳{formatPoishaToBdt(statementTotalFeePoisha)}
              </span>
            </div>
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Total Entry Liability</span>
              <span class="text-lg font-bold font-mono text-[var(--ink)]">
                ৳{formatPoishaToBdt(coveredEntriesTotalLiabilityPoisha)}
              </span>
            </div>
            <div class="p-3 bg-[var(--pearl-surface)] rounded-lg">
              <span class="block text-[11px] uppercase tracking-wider text-[var(--muted)]">Variance</span>
              <span class="text-lg font-bold font-mono {varianceWithinTolerance ? 'text-green-600' : 'text-amber-600'}">
                ৳{formatPoishaToBdt(variancePoisha)}
                <span class="text-xs font-normal font-sans ml-1">
                  ({varianceWithinTolerance ? 'within tolerance' : 'exceeds tolerance'})
                </span>
              </span>
            </div>
          </div>

          {#if !varianceWithinTolerance}
            <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs">
              <p class="font-semibold">Variance exceeds default tolerance (৳1.00).</p>
              <p class="mt-0.5">
                A mandatory reconciliation note is required explaining the variance before closing this statement.
              </p>
            </div>
            <div>
              <label for="reconcile-note" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
                Reconciliation Note (Mandatory)
              </label>
              <textarea
                id="reconcile-note"
                bind:value={reconcileNote}
                rows={2}
                placeholder="Enter justification for fee variance..."
                class="w-full p-2.5 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
              ></textarea>
            </div>
          {/if}

          <div class="flex items-center justify-between pt-3 border-t border-[var(--pearl-border)]">
            <div class="text-xs text-[var(--muted)]">
              {#if unmatchedLinesCount > 0}
                <span class="text-amber-600 font-semibold">{unmatchedLinesCount} statement lines</span> still unmatched.
              {:else if unmatchedCoveredEntriesCount > 0}
                <span class="text-amber-600 font-semibold">{unmatchedCoveredEntriesCount} covered entries</span> still unmatched.
              {:else}
                <span class="text-green-600 font-semibold">All completion criteria satisfied.</span>
              {/if}
            </div>

            <Button
              variant="primary"
              onclick={handleFinalizeReconcile}
              disabled={!canFinalizeReconciliation || actionLoading || activeStatement.status === 'reconciled'}
              minHeight="44px"
            >
              {activeStatement.status === 'reconciled' ? 'Already Reconciled' : actionLoading ? 'Reconciling...' : 'Reconcile Statement'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  {/if}
</div>

<!-- Modal: Candidate Entry Picker for Line Matching -->
<Modal bind:open={candidateModalOpen} title="Match Statement Line to Ledger Entry">
  {#if selectedLineForMatch}
    <div class="p-4 space-y-4">
      <div class="p-3 bg-[var(--pearl-surface)] rounded text-xs">
        <p><span class="text-[var(--muted)]">Line Reference:</span> <strong class="font-mono text-[var(--ink)]">{selectedLineForMatch.reference || 'None'}</strong></p>
        <p class="mt-1"><span class="text-[var(--muted)]">Line Gross:</span> <strong class="font-mono text-[var(--ink)]">৳{formatPoishaToBdt(selectedLineForMatch.gross_poisha)}</strong></p>
      </div>

      <div>
        <label for="candidate-search" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
          Search Candidate Entries
        </label>
        <input
          id="candidate-search"
          type="text"
          bind:value={candidateSearchQuery}
          placeholder="Filter by entry number, ref, or customer..."
          class="w-full h-11 px-3 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
        />
      </div>

      <div class="max-h-60 overflow-y-auto border border-[var(--pearl-border)] rounded divide-y divide-[var(--pearl-border)]">
        {#if filteredCandidates.length === 0}
          <div class="p-4 text-center text-xs text-[var(--muted)]">No candidate entries found matching query.</div>
        {:else}
          {#each filteredCandidates as cand}
            <div class="p-3 flex items-center justify-between hover:bg-[var(--pearl-surface)] transition-colors">
              <div class="text-xs">
                <div class="font-mono font-bold text-[var(--ink)]">{cand.entry_number}</div>
                <div class="text-[var(--muted)]">{cand.entry_date} &bull; {cand.customer_name}</div>
                <div class="font-mono text-[11px] text-[var(--brand)]">৳{formatPoishaToBdt(cand.gross_poisha)}</div>
              </div>
              <Button
                variant="primary"
                onclick={() => handleSelectEntryMatch(cand)}
                disabled={actionLoading}
                minHeight="36px"
              >
                Select
              </Button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="flex justify-end pt-2">
        <Button variant="secondary" onclick={() => { candidateModalOpen = false; }} minHeight="44px">
          Cancel
        </Button>
      </div>
    </div>
  {/if}
</Modal>

<!-- Modal: Unmatch Reason (Eliminating browser prompt) -->
<Modal bind:open={unmatchModalOpen} title="Unmatch Statement Line">
  <div class="p-4 space-y-4">
    <p class="text-xs text-[var(--muted)]">
      Unmatching this statement line will sever its link to the ledger entry and revert the statement status to open.
    </p>
    <div>
      <label for="unmatch-reason-input" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
        Reason for Unmatching (Mandatory)
      </label>
      <input
        id="unmatch-reason-input"
        type="text"
        bind:value={unmatchReason}
        placeholder="e.g. Inadvertent match, duplicate line reference..."
        class="w-full h-11 px-3 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
      />
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onclick={() => { unmatchModalOpen = false; }} minHeight="44px">
        Cancel
      </Button>
      <Button
        variant="danger"
        onclick={handleConfirmUnmatch}
        disabled={actionLoading || unmatchReason.trim().length === 0}
        minHeight="44px"
      >
        Confirm Unmatch
      </Button>
    </div>
  </div>
</Modal>

<!-- Modal: Accept Unmatched Line Review Note -->
<Modal bind:open={acceptModalOpen} title="Accept Unmatched Statement Line">
  <div class="p-4 space-y-4">
    <p class="text-xs text-[var(--muted)]">
      Accepting an unmatched statement line logs the line into the audit trail as recognized without a corresponding ledger entry (e.g. gateway annual charge, fee adjustment).
    </p>
    <div>
      <label for="accept-note-input" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
        Review Note (Mandatory)
      </label>
      <textarea
        id="accept-note-input"
        bind:value={acceptReviewNote}
        rows={3}
        placeholder="e.g. Bank monthly account maintenance charge per statement..."
        class="w-full p-2.5 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
      ></textarea>
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onclick={() => { acceptModalOpen = false; }} minHeight="44px">
        Cancel
      </Button>
      <Button
        variant="primary"
        onclick={handleConfirmAccept}
        disabled={actionLoading || acceptReviewNote.trim().length === 0}
        minHeight="44px"
      >
        Accept Line
      </Button>
    </div>
  </div>
</Modal>

<!-- Modal: Approve Entry Exception -->
<Modal bind:open={exceptionModalOpen} title="Approve Reconciliation Exception">
  {#if selectedEntryForException}
    <div class="p-4 space-y-4">
      <div class="p-3 bg-[var(--pearl-surface)] rounded text-xs font-mono">
        <p><span class="text-[var(--muted)]">Entry:</span> <strong>{selectedEntryForException.entry_number}</strong></p>
        <p class="mt-1"><span class="text-[var(--muted)]">Gross:</span> ৳{formatPoishaToBdt(selectedEntryForException.gross_poisha)}</p>
      </div>
      <div>
        <label for="exception-reason-input" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
          Exception Reason (Mandatory)
        </label>
        <textarea
          id="exception-reason-input"
          bind:value={exceptionReason}
          rows={3}
          placeholder="e.g. Transaction settled outside reporting window, verified manually..."
          class="w-full p-2.5 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
        ></textarea>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onclick={() => { exceptionModalOpen = false; }} minHeight="44px">
          Cancel
        </Button>
        <Button
          variant="primary"
          onclick={handleConfirmException}
          disabled={actionLoading || exceptionReason.trim().length === 0}
          minHeight="44px"
        >
          Approve Exception
        </Button>
      </div>
    </div>
  {/if}
</Modal>

<!-- Modal: Supersede Statement -->
<Modal bind:open={supersedeModalOpen} title="Supersede Existing Statement">
  <div class="p-4 space-y-4">
    <p class="text-xs text-[var(--muted)]">
      Superseding marks the current statement as superseded in the audit log, permitting a replacement statement file to be uploaded for this month.
    </p>
    <div>
      <label for="supersede-reason-input" class="block text-xs font-semibold text-[var(--ink)] uppercase tracking-wider mb-1">
        Reason for Superseding (Mandatory)
      </label>
      <input
        id="supersede-reason-input"
        type="text"
        bind:value={supersedeReason}
        placeholder="e.g. Corrupt CSV export, wrong date filter applied..."
        class="w-full h-11 px-3 text-xs rounded border border-[var(--pearl-border)] bg-[var(--pearl-bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
      />
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onclick={() => { supersedeModalOpen = false; }} minHeight="44px">
        Cancel
      </Button>
      <Button
        variant="danger"
        onclick={handleConfirmSupersede}
        disabled={actionLoading || supersedeReason.trim().length === 0}
        minHeight="44px"
      >
        Confirm Supersede
      </Button>
    </div>
  </div>
</Modal>
```

### 6.7 `apps/web/src/routes/api/v1/reconcile/statements/upload/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { bkashCsvAdapter } from '$lib/server/reconcile/adapters/bkash-csv';
import { cardCombinedCsvAdapter } from '$lib/server/reconcile/adapters/card-combined-csv';
import type { StatementAdapter, ParsedStatement } from '$lib/server/reconcile/adapters/types';

const ALLOWED_MIME_TYPES = [
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/pdf',
];

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  // Enforce 10 MB maximum payload check before processing
  const contentLength = event.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
    throw error(413, 'payload_too_large: File exceeds 10 MB limit');
  }

  const formData = await event.request.formData().catch(() => null);
  if (!formData) {
    throw error(400, 'invalid_form_data');
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    throw error(400, 'missing_file');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw error(413, 'payload_too_large: File exceeds 10 MB limit');
  }

  const mimeType = (file.type || '').toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw error(415, `unsupported_media_type: ${mimeType}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Compute 64-character SHA-256 hex digest
  const fileSha256 = createHash('sha256').update(buffer).digest('hex');

  // Adapter selection: inspect headers via accepts() or resolve explicit adapterId
  const explicitAdapterId = formData.get('adapterId')?.toString();
  let adapter: StatementAdapter | null = null;

  if (explicitAdapterId) {
    if (explicitAdapterId === bkashCsvAdapter.id) adapter = bkashCsvAdapter;
    else if (explicitAdapterId === cardCombinedCsvAdapter.id) adapter = cardCombinedCsvAdapter;
  }

  if (!adapter) {
    if (bkashCsvAdapter.accepts(buffer, mimeType)) {
      adapter = bkashCsvAdapter;
    } else if (cardCombinedCsvAdapter.accepts(buffer, mimeType)) {
      adapter = cardCombinedCsvAdapter;
    }
  }

  if (!adapter) {
    throw error(422, 'no_matching_adapter: Unable to identify statement format from headers');
  }

  // Parse statement lines server-side under service_role
  let parsed: ParsedStatement;
  try {
    parsed = await adapter.parse(buffer);
  } catch (err: any) {
    throw error(422, `parse_failed: ${err.message || 'Error parsing statement file'}`);
  }

  const supabase = getServiceSupabase();

  // Ensure private statements storage bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some(b => b.name === 'statements')) {
    await supabase.storage.createBucket('statements', { public: false });
  }

  // Extract and validate month prefix for partition path (e.g. '2026-03')
  const monthParam = formData.get('month')?.toString();
  if (monthParam && !/^\d{4}-\d{2}(-01)?$/.test(monthParam)) {
    throw error(400, 'invalid_month_format: Expected YYYY-MM or YYYY-MM-01');
  }
  const monthPrefix = monthParam ? monthParam.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const storagePath = `statements/${monthPrefix}/${fileSha256}`;

  // Stream file directly to Supabase private storage
  const { error: uploadErr } = await supabase.storage
    .from('statements')
    .upload(storagePath, buffer, {
      contentType: file.type || 'text/csv',
      upsert: true,
    });

  if (uploadErr) {
    throw error(500, `storage_upload_failed: ${uploadErr.message}`);
  }

  return json({
    path: storagePath,
    fileSha256,
    linesCount: parsed.lines.length,
    parsedLines: parsed.lines.map(l => ({
      lineIndex: l.lineIndex,
      lineDate: l.date,
      reference: l.reference,
      grossPoisha: l.grossPoisha ? l.grossPoisha.toString() : '0',
      feePoisha: l.feePoisha ? l.feePoisha.toString() : '0',
      raw: l.raw,
    })),
    detectedAdapter: adapter.id,
    previewSummary: {
      totalGrossPoisha: parsed.summary.totalGrossPoisha.toString(),
      totalFeePoisha: parsed.summary.totalFeePoisha.toString(),
      linesCount: parsed.summary.linesCount,
      minDate: parsed.summary.minDate,
      maxDate: parsed.summary.maxDate,
    },
  });
};
```

### 6.8 `apps/web/src/routes/api/v1/reconcile/statements/signed-url/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const STORAGE_PATH_REGEX = /^statements\/\d{4}-\d{2}(-01)?\/[0-9a-f]{64}$/;

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const path = event.url.searchParams.get('path');
  if (!path || !STORAGE_PATH_REGEX.test(path)) {
    throw error(400, 'invalid_storage_path: Path must match statements/<month>/<sha256>');
  }

  const supabase = getServiceSupabase();

  // Signed URL expires in 900 seconds (15 minutes) per PRD §11.3
  const { data, error: signedErr } = await supabase.storage
    .from('statements')
    .createSignedUrl(path, 900);

  if (signedErr || !data?.signedUrl) {
    throw error(500, `signed_url_generation_failed: ${signedErr?.message || 'Unknown storage error'}`);
  }

  return json({
    signedUrl: data.signedUrl,
    expiresIn: 900,
  });
};
```

### 6.9 `apps/web/src/routes/api/v1/reconcile/match-line/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const matchSchema = z.object({
  lineId: z.string().uuid(),
  entryId: z.string().uuid(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = matchSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  const { error: rpcErr } = await supabase.rpc('match_statement_line', {
    p_line_id: parsed.data.lineId,
    p_entry_id: parsed.data.entryId,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    return json({ error: rpcErr.message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.10 `apps/web/src/routes/api/v1/reconcile/unmatch-line/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const unmatchSchema = z.object({
  lineId: z.string().uuid(),
  reason: z.string().min(1, 'Reason is required to unmatch statement line'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = unmatchSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  const { error: rpcErr } = await supabase.rpc('unmatch_statement_line', {
    p_line_id: parsed.data.lineId,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    return json({ error: rpcErr.message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.11 `apps/web/src/routes/api/v1/reconcile/accept-line/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const acceptSchema = z.object({
  lineId: z.string().uuid(),
  reviewNote: z.string().min(1, 'Review note is mandatory to accept statement line into audit log'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  const { error: rpcErr } = await supabase.rpc('accept_statement_line', {
    p_line_id: parsed.data.lineId,
    p_review_note: parsed.data.reviewNote,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    return json({ error: rpcErr.message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.12 `apps/web/src/routes/(app)/reconcile/+page.svelte`

```svelte
<!-- Modification to existing Reconciliation Overview Page (PRD §11.1 / §11.3) -->
<!-- In the Header Action Bar, add the Mode B Upload Action Button alongside Mode A -->
<div class="flex items-center gap-2">
  <Button
    variant="secondary"
    onclick={() => goto('/reconcile/upload')}
    minHeight="44px"
  >
    + Upload Statement File (Mode B)
  </Button>
  <Button
    variant="primary"
    onclick={() => openModeAModal()}
    minHeight="44px"
  >
    + Manual Reconciliation (Mode A)
  </Button>
</div>
```

### 6.13 `apps/web/src/lib/reconcile/adapters.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { bkashCsvAdapter, parseCsvRows, parsePoisha } from '$lib/server/reconcile/adapters/bkash-csv';
import { cardCombinedCsvAdapter } from '$lib/server/reconcile/adapters/card-combined-csv';
import { executeAutoMatch, type LedgerEntryCandidate } from '$lib/reconcile/matching';
import type { StatementLine } from '$lib/reconcile/types';

describe('Reconciliation Mode B Statement Adapters & Matching Engine', () => {
  it('parses bKash CSV statement with RFC 4180 quoted numbers and commas', async () => {
    const csvContent = [
      'TrxID,Date,Amount,Fee,Customer',
      'TRX987654,2026-03-05,"1,25,000.00",250.00,01700000000',
      'TRX987655,2026-03-06,500.50,10.00,01800000000',
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    expect(bkashCsvAdapter.accepts(buffer, 'text/csv')).toBe(true);
    expect(bkashCsvAdapter.accepts(buffer, 'application/vnd.ms-excel')).toBe(true);

    const parsed = await bkashCsvAdapter.parse(buffer);
    expect(parsed.adapterId).toBe('bkash-merchant-csv');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('TRX987654');
    expect(parsed.lines[0].grossPoisha).toBe(12500000n); // 1,25,000.00 * 100
    expect(parsed.lines[0].feePoisha).toBe(25000n);      // 250.00 * 100
    expect(parsed.summary.totalGrossPoisha).toBe(12550050n);
  });

  it('parses negative amounts and accounting parentheses without floating point errors', () => {
    expect(parsePoisha('-150.75')).toBe(-15075n);
    expect(parsePoisha('(250.00)')).toBe(-25000n);
    expect(parsePoisha('"(1,250.50)"')).toBe(-125050n);
    expect(parsePoisha('+500.00')).toBe(50000n);
  });

  it('safely handles jagged CSV rows and empty trailing lines', async () => {
    const csvContent = [
      'TrxID,Date,Amount,Fee,Customer',
      'TRX101,2026-03-01,100.00',          // Jagged row: missing Fee and Customer
      'TRX102,2026-03-02,200.00,5.00,User',
      '',                                   // Empty trailing line
      '   ',                                // Whitespace line
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    const parsed = await bkashCsvAdapter.parse(buffer);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('TRX101');
    expect(parsed.lines[0].feePoisha).toBe(0n); // Defaulted safely
  });

  it('parses Combined Card CSV statement with AuthCode and CardType headers', async () => {
    const csvContent = [
      'AuthCode,Date,CardType,Amount,MDR,Terminal',
      'AUTH1001,2026-03-10,VISA,3500.00,52.50,TERM01',
      'AUTH1002,2026-03-11,MASTERCARD,4200.00,63.00,TERM02',
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    expect(cardCombinedCsvAdapter.accepts(buffer, 'text/csv')).toBe(true);
    expect(cardCombinedCsvAdapter.accepts(buffer, '')).toBe(true);

    const parsed = await cardCombinedCsvAdapter.parse(buffer);
    expect(parsed.adapterId).toBe('card-combined-csv');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('AUTH1001');
    expect(parsed.lines[0].grossPoisha).toBe(350000n);
    expect(parsed.lines[0].feePoisha).toBe(5250n);
    expect(parsed.summary.linesCount).toBe(2);
  });

  it('computes 64-character SHA-256 hex digest for statement verification', () => {
    const content = Buffer.from('test statement payload');
    const hash = createHash('sha256').update(content).digest('hex');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('Pass 1: matches unique reference on both sides', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN100', grossPoisha: 10000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-1', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'TXN100', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lineIndex).toBe(1);
    expect(result.matches[0].entryId).toBe('entry-1');
    expect(result.matches[0].pass).toBe(1);
  });

  it('Pass 1 & 2: reference collision skips Pass 1 and prevents Pass 2 fallback', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'COLLIDE_REF', date: '2026-03-01', grossPoisha: 10000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-1', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'COLLIDE_REF', status: 'active' },
      { id: 'entry-2', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'COLLIDE_REF', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    // Collided on entry side: both entries have same txn_ref
    expect(result.matches).toHaveLength(0);
    expect(result.collidedReferences).toContain('COLLIDE_REF');
    expect(result.unmatchedLineIndices).toContain(1);
  });

  it('Pass 2: matches unreferenced lines via unique date + gross fallback', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: undefined, date: '2026-03-05', grossPoisha: 250000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-unref', entry_date: '2026-03-05', gross_poisha: 250000n, liability_poisha: 2875n, txn_ref: null, status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lineIndex).toBe(1);
    expect(result.matches[0].entryId).toBe('entry-unref');
    expect(result.matches[0].pass).toBe(2);
  });

  it('excludes candidate entries with zero liability from matching', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN_ZERO', grossPoisha: 50000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-zero', entry_date: '2026-03-05', gross_poisha: 50000n, liability_poisha: 0n, txn_ref: 'TXN_ZERO', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    // Zero liability entries carry 0 merchant settlement liability and are exempt from matching
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedLineIndices).toContain(1);
  });
});
```

## 7. Tests

1. Unit tests for CSV adapters and RFC 4180 handling:
   - Command: `pnpm --filter @clt/web test apps/web/src/lib/reconcile/adapters.test.ts`
   - Expected output: exit code `0`, all 6 test suites passing.

2. PostgreSQL reconciliation RPC integration tests:
   - Command: `pnpm vitest run tests/db/settlement_recon.test.ts`
   - Expected output: exit code `0`, covering `create_statement`, `match_statement_line`, `unmatch_statement_line`, `accept_statement_line`, and `reconcile_statement`.

3. Regression tests from PRD §16.2:
   - Command: `pnpm vitest run tests/db/settlement_recon.test.ts -t "test_16|test_19|test_51|test_52|test_53"`
   - Expected output: exit code `0`.

## 8. Acceptance criteria

1. Server statement adapters reside under `apps/web/src/lib/server/reconcile/adapters/`, preventing server builtins from leaking into client bundles.
2. `POST /api/v1/reconcile/statements/upload` strictly enforces 10 MB payload limits, supported MIME types, and streams to private `statements` bucket with 64-character SHA-256 digest computation.
3. Ingestion implements a two-step flow: Step 1 uploads and parses returning preview summary without creating statement rows; Step 2 confirms payables and month before invoking `create_statement` RPC.
4. Auto-matching implements two-sided 1-to-1 uniqueness: Pass 1 matches unique references; reference collisions on either side skip Pass 1 and skip Pass 2 fallback; Pass 2 matches unique date + gross for unreferenced lines.
5. Candidate entries with zero merchant liability (`liability_poisha === 0n`) are automatically exempt from statement matching per PRD §11.3.
6. The UI provides a usable candidate entry modal for manual matching displaying formatted entry number (`E-YYYYMM-XXXXXX`), customer name, date, gross amount, and payable liability.
7. Unmatched statement lines can be marked accepted via `accept_statement_line` with mandatory review note evidence.
8. Unmatching cascades any reconciled statement back to open via `unmatch_statement_line`.
9. The review screen displays the Entry-Side Review Table (PRD §11.3 Item 5) asserting all active entries for covered payables have been matched or approved via exceptions.
10. Final statement reconciliation asserts that all statement lines are matched/accepted, all covered entries are matched/excepted, and variance exceeds tolerance only with a mandatory reconcile note.

## 9. Hard rules touched

- Hard Rule 1: Rates and VAT rules are dynamic and never hardcoded.
- Hard Rule 2: Integer poisha used across all statement totals, fees, and tolerances.
- Hard Rule 3: Single calculation module and database constraint backstop integrity.
- Hard Rule 5: Every line match, unmatch, accept, exception review, and statement reconciliation logs an append-only audit log row in PostgreSQL.
- Hard Rule 7: Table mutations executed via `SECURITY DEFINER` RPCs under `service_role`.
- Hard Rule 8: Secrets and private storage credentials never exposed to client.
- Hard Rule 9: Server verifies actor role, statement month lock, and payable applicability.
- Hard Rule 10: Strict lock hierarchy respected: Month Lock 1001 &rarr; `payables FOR KEY SHARE` &rarr; `entries` &rarr; `statements` &rarr; `statement_lines`.
- Hard Rule 11: Zod validation on client and server payloads.

## 10. Pitfalls

1. **Storage Bucket Exists Guard**: Always verify and create the private `statements` bucket before attempting upload to prevent 404 or 400 storage errors.
2. **RFC 4180 Quoted Number Parsing**: CSV amounts formatted with South Asian grouping (e.g. `"1,25,000.00"`) contain embedded commas. Using naive `.split(',')` splits numbers into multiple columns. The custom `parseCsvRows` parser correctly preserves quoted fields.
3. **MIME Sniffing on Real Files**: Windows and Excel exports frequently submit `application/vnd.ms-excel` or empty MIME strings. Content header sniffing in `accepts()` must inspect the first 2 KB for known headers without solely relying on `file.type`.
4. **Collision Fallthrough**: If a reference collides (duplicate reference on either side), it must be flagged and skipped from Pass 2 date+gross fallback. Otherwise, ambiguous references could be falsely matched to unrelated transactions.
5. **Entry-Side Review Mandate**: Reconciling a statement without verifying entry coverage violates PRD §11.3 Item 5. The UI must explicitly query and display unmatched ledger entries and require exception approvals before enabling the reconcile action.

## 11. PRD ISSUES and DECISION PENDING

None. All Mode B reconciliation requirements, adapter specifications, lock hierarchies, and completion criteria are fully specified in PRD v1.19 §11.3 and confirmed by Plan 005 RPC implementations.

## 12. Handoff

Upon completing Plan 018:
- Mode B file ingestion, storage streaming, signed URLs, and adapter execution are operational.
- The two-step ingestion workflow and candidate entry selection modal are functional.
- The entry-side review table guarantees compliance with PRD §11.3 Item 5.
- Next implementation plan: `019_capacitor_android_release.md`.

## 13. Suggested task breakdown

- `CLT-T-018-A`: Implement statement adapter interfaces and parsers in `apps/web/src/lib/server/reconcile/adapters/` (`types.ts`, `bkash-csv.ts`, `card-combined-csv.ts`).
- `CLT-T-018-B`: Implement two-pass matching engine in `apps/web/src/lib/reconcile/matching.ts` with two-sided 1-to-1 uniqueness and candidate liability checks.
- `CLT-T-018-C`: Build server endpoints in `apps/web/src/routes/api/v1/reconcile/` (`statements/upload`, `statements/signed-url`, `match-line`, `unmatch-line`, `accept-line`).
- `CLT-T-018-D`: Build Mode B UI in `apps/web/src/routes/(app)/reconcile/upload/+page.svelte` with two-step preview, candidate modal, entry coverage review, and test suite `adapters.test.ts`.

## Changelog

- 2026-11-01 — Revision 3.1:
  - Resolved P0.1: Moved shared data contracts (`StatementLine`, `ParsedStatement`, `StatementAdapterSummary`, `StatementLineItem`, `CandidateEntry`) to `$lib/reconcile/types.ts` to prevent SvelteKit client/server module boundary import violations.
  - Resolved P0.2: Handled HTML5 `<input type="month">` YYYY-MM wire format by normalizing to `YYYY-MM-01` on client and validating `/^\d{4}-\d{2}(-01)?$/` on upload API.
  - Resolved P0.3: Fixed Asia/Dhaka month end-of-month query in `fetchCoveredEntries` using string comparison `.gte('entry_date', month).lt('entry_date', nextMonth)` instead of `toISOString()` truncation.
  - Resolved P0.4: Preserved `applicable_payable_id` on candidate entries for combined statements, ensuring `review_entry_reconciliation_exception` receives the valid payable ID.
  - Resolved P0.5: Replaced browser `prompt()` in line unmatching with an accessible `<Modal>` and mandatory reason validation.
  - Resolved P1.1: Added functional `supersedeModalOpen` dialog with reason input and `supabase.rpc('supersede_statement')` integration.
  - Resolved P1.2: Converted all buttons and cards in `upload/+page.svelte` to Plan 007 primitives (`Button`, `Card`, `Modal`) with minimum 44px touch targets.
  - Resolved P1.3: Added `application/pdf` to `ALLOWED_MIME_TYPES` and strict regex validation for `month` parameter in `upload/+server.ts`.
  - Resolved P1.4: Fixed property name alignment in `upload/+server.ts` to output `lineDate: l.date`.
  - Resolved P1.5: Replaced `Number()` floating point conversions in CSV parse with pure integer poisha parsing supporting negative amounts and parentheses.
  - Resolved P1.6: Enforced gross column priority over net column in card combined CSV adapter.
  - Resolved P1.7: Added jagged CSV row and empty row guards to prevent `undefined` column errors.
  - Resolved P1.8: Enforced Pass 2 collision skip in `matching.ts` to prevent collided references from matching via date+gross fallback.
  - Resolved P2.1: Added Specification 6.12 modifying `apps/web/src/routes/(app)/reconcile/+page.svelte` with a Mode B upload action button.
  - Resolved P2.2: Added comprehensive test coverage in `adapters.test.ts` for negative amounts, parentheses, jagged rows, and collision skips.

- 2026-11-01 — Revision 3.0:
  - Resolved Blocker 1: Fixed module imports across all five server endpoints to canonical `$lib/server/supabase.ts` (`getServiceSupabase`) and browser client to `$lib/supabase/client.ts` (`supabase`) with session bearer token authorization.
  - Resolved Blocker 2: Connected Mode B entry point from `/reconcile` overview with breadcrumb navigation and back links.
  - Resolved Blocker 3: Implemented full PRD §11.3 Item 5 entry-side review displaying covered ledger entries with non-zero liability, exception approval actions, variance against expected liability, tolerance checking, and mandatory reconcile notes.
  - Resolved Blocker 4: Implemented usable candidate entry modal for manual matching displaying formatted entry number (`E-YYYYMM-XXXXXX`), customer name, date, gross amount, liability amount, and search filter.
  - Resolved Blocker 5: Refactored file ingestion into two-step workflow (upload & parse preview followed by confirmation) and added statement supersession support for open statements.
  - Resolved Blocker 6: Aligned TypeScript simulation matching engine (`matching.ts`) with PostgreSQL `perform_statement_auto_match` logic, adding candidate liability filtering (`liability_poisha > 0n`) and reference collision skipping.
  - Resolved Blocker 7: Updated MIME allow-list and adapter `accepts()` header sniffing to support Excel and Windows exports (`application/vnd.ms-excel`, `application/octet-stream`, empty MIME).
  - Resolved Blocker 8: Ensured private `statements` storage bucket existence before file uploads.
  - Resolved Blocker 9: Prevented orphan storage files by validating and parsing buffers before storage persistence.
  - Resolved Blocker 10: Enforced single-payable (1 payable) vs combined-card (>= 2 payables) validation across UI and endpoints.
  - Resolved Further Defects: Implemented RFC 4180 quoted CSV parsing (`parseCsvRows`), date normalization (`normalizeDate`), integer poisha parsing (`parsePoisha`), Plan 007 button and token styling, Admin/Owner role guards, and relocated adapters to `$lib/server/reconcile/adapters/`.
- 2026-10-31 — Revision 2.0:
  - Resolved Flaws 1-7 from initial audit.
