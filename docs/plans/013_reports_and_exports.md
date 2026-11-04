# 013_reports_and_exports.md — Monthly Reports, Payables Summary, Parity Verification, and PDF/CSV/XLSX Export

- Plan Identifier: CLT-PLAN-013
- Phase: Phase 2 / M2
- Milestone: M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §8.3 (Reports: core output), §8.4 (Settlements connection), §8.6 (app_settings.net_label), §10 (Reports SQL reference), §16.3 (Report parity with SQL views), §17 (Milestone M2)
- Depends on: 007, 008, 009, 010, 011, 012
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement the Monthly Reports suite conforming in full to PRD §8.3 and §10. Features include role-gated access (Admin and Owner only), month navigation with Zod validation, indexed date-range queries on Dexie, monthly financial aggregations strictly excluding voided, superseded, and server-rejected operations (`status = 'active' && sync_status !== 'rejected'`), month-over-month (MoM) delta percentages and arrows, daily trend charts and daily cash reconciliation breakdowns, payment-method volumes (gross) and charges, canonical payables summary tables with 5-state settlement badges without dropping fees, dynamic `app_settings.net_label` resolution defaulting to DDL `'Net after deductions'`, interactive client-side drill-downs to the filtered ledger via SvelteKit `goto()`, a full detailed entry list with a sticky totals row mathematically asserted to equal the summary cards, clean print-ready PDF statements with printable headers and dark-mode proof stylesheets, RFC 4180 CSV export with UTF-8 BOM and formula injection protection, and XML Spreadsheet (.xlsx/.xls) export with native mobile platform branching.

## 2. Scope

- IN:
  - Role gating: restricting `/reports` to Admin and Owner roles; Staff navigating to `/reports` receives a clean access denied screen per PRD §3 and §8.5.
  - Safe month navigation: `<input type="month">` bounded by Zod `MonthSchema` (`^\d{4}-(0[1-9]|1[0-2])$`), previous/next month calendar arithmetic handling year boundaries (`2026-01` $\leftrightarrow$ `2025-12`), and safe fallback to current Asia/Dhaka month if cleared or invalid.
  - Indexed Dexie queries: fetching entries via IndexedDB index `db.entries.where('entry_date').between(...)` for the current month and prior month, avoiding unindexed whole-table scans of store history.
  - Dynamic net label: dynamically binding `app_settings.net_label` from `db.appSettings`, falling back strictly to DDL default `'Net after deductions'` (PRD §8.3, §8.6, Table 18).
  - Aggregation engine in `apps/web/src/lib/reports/aggregates.ts`:
    - Strict active filtering: `status === 'active' && sync_status !== 'rejected'`. Rejected ops are excluded to maintain 100% mathematical parity with PostgreSQL views `v_monthly_totals` and `v_monthly_method_charges` (PRD §10).
    - Summary calculations: total gross, total VAT, total commission, total business charges, total customer charges, net revenue, total sub_qty units, and unsynced pending transactions count.
    - Payment method breakdown: transaction counts, total gross volume, business fee deducted, and customer fee borne per method.
    - Daily cash reconciliation breakdown: date, entries count, sub_qty, gross, VAT, commission, business fees, customer fees, and net.
    - Month-over-month (MoM) deltas: computing poisha difference and percentage change ($\pm X.X\%$) with directional indicator ($\uparrow/\downarrow$) for gross, net, and commission.
  - Visual daily trend chart: responsive CSS flex bar chart visualizing daily gross and net collections across the month.
  - Full detailed entry list: comprehensive monthly transaction table with a sticky totals row mathematically matching the summary cards to the exact poisha (asserted in tests per PRD §8.3 and §16.3 #2).
  - Payables summary table in `apps/web/src/lib/ui/PayablesSummaryTable.svelte`:
    - Joins `db.payables`, `db.methods`, and `db.settlements`.
    - Handles Government VAT stream using `vatPayable?.name ?? 'Government VAT Challan'`.
    - Iterates over all active method fees: matches `p.name` (DDL column) and ensures methods without configured payables still render as unassigned payable streams so zero fee money is dropped.
    - Reconciles local expected poisha vs server settlement: displays `Paid (Server) + ৳... unsynced` when unsynced local entries increase expected liability beyond settled amounts.
    - Canonical 5-state settlement badges (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`) and zero `as any` typecasts via `getChipVariant`.
  - Customer-borne charges section: isolating customer fee totals in a distinct informational block `Customer-paid provider fees` excluded from business settlement liabilities conforming to PRD §8.3.
  - Client-side drill-down: tapping any aggregate summary card, method card, or payable row navigates to `/ledger?month=YYYY-MM` or `/ledger?month=YYYY-MM&method=<method_id>` via SvelteKit `goto()` (no full-page reloads).
  - Client CSV export generator in `apps/web/src/lib/reports/export-csv.ts`:
    - Prepend UTF-8 Byte Order Mark (`\uFEFF`) to prevent Excel Bangla mojibake.
    - Formula injection protection: prepending `'` if text fields begin with `=`, `+`, `-`, `@`, `\t`, or `\r`.
    - Exact 2-decimal poisha fixed-point string representation without BigInt division truncation (`formatPoishaForCsv`).
    - Full accountant columns: `Entry Number`, `Date`, `Status`, `Customer`, `Sub Qty`, `Method`, `Gross (BDT)`, `VAT Mode`, `VAT (BDT)`, `Commission (BDT)`, `Merchant Fee (BDT)`, `Customer Fee (BDT)`, `Net (BDT)`, `Rate Version`, `Txn Ref`, `Notes`, plus fixed Totals row.
    - Delayed `URL.revokeObjectURL(url)` (1000 ms) preventing Safari cancellation.
  - Client XML Spreadsheet / XLSX export generator in `apps/web/src/lib/reports/export-xlsx.ts` generating Excel-native formatted spreadsheet with styled headers, number data types, and totals row.
  - Print-ready PDF statement:
    - Statement header: Organization Name, Business Address / VAT Reg No (from `db.appSettings`), "Monthly Settlement Statement", Selected Month, and Asia/Dhaka generation timestamp.
    - Full `@media print` stylesheet: hides navigation chrome and buttons via `:global(.no-print)`, resets text color to `#000000 !important` and background to `#ffffff !important` (overriding dark mode tokens to prevent white-on-white text), and ensures standard A4 layout.
    - Capacitor platform branch and handoff for Plan 019 native file write/share and print adapters.
  - Unit and integration tests in `apps/web/src/lib/reports/reports.test.ts` verifying PRD §6.6 fixture summation (using exact customer names Ayash, Abida, Ahiyan, etc.), arithmetic conservation, daily breakdowns, MoM deltas, CSV escaping with BOM and formula injection protection, and SQL view parity.
- OUT:
  - Statement file upload and line-item matching (owned by Plan 018).
  - Settlement payment recording and reversal actions (owned by Plan 014).
  - Month close execution and overpayment surplus approvals (owned by Plan 015).
  - Native Capacitor mobile file share/print integration (owned by Plan 019).

## 3. Preconditions

1. Plan 010 Dexie database `db` and local entry types are available.
   - Check command: `test -f apps/web/src/lib/db/index.ts`
   - Expected output: exit code `0`.
2. Plan 008 authentication session store (`session`) is available.
   - Check command: `test -f apps/web/src/lib/auth/session.svelte.ts`
   - Expected output: exit code `0`.
3. Plan 007 UI kit components exist in `apps/web/src/lib/ui/`.
   - Check command: `test -f apps/web/src/lib/ui/Card.svelte && test -f apps/web/src/lib/ui/Chip.svelte`
   - Expected output: exit code `0`.
4. Plan 002 shared money formatting (`formatPoishaToBdt`) is available.
   - Check command: `test -f packages/shared/src/index.ts`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/reports/aggregates.ts` | create | Aggregation calculations for gross, vat, commission, fees, net, daily breakdowns, and MoM deltas |
| `apps/web/src/lib/reports/export-csv.ts` | create | RFC 4180 CSV file generation with UTF-8 BOM, formula injection defense, 2-decimal formatting, and totals row |
| `apps/web/src/lib/reports/export-xlsx.ts` | create | XML Spreadsheet (.xlsx/.xls) export generator with native styling and number cell types |
| `apps/web/src/lib/reports/export-pdf.ts` | create | Print dialog trigger and native Capacitor mobile printing handoff |
| `apps/web/src/lib/ui/PayablesSummaryTable.svelte` | create | Table displaying canonical payables, method names, txn counts, 5-state settlement badges, and unsynced indicators |
| `apps/web/src/routes/(app)/reports/+page.svelte` | create | Monthly reports dashboard screen with role guard, calendar picker, net_label, daily chart, entry list, drill-downs, and print CSS |
| `apps/web/src/lib/reports/reports.test.ts` | create | Vitest test suite asserting fixtures, conservation, daily sums, totals row parity, MoM deltas, CSV escaping, and SQL view parity |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create report aggregation engine in `apps/web/src/lib/reports/aggregates.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/reports/aggregates.ts`.
   - Check: `grep -c '^export function computeMonthlyAggregates' apps/web/src/lib/reports/aggregates.ts`
   - Expected output: `1`

2. Create CSV export generator and pure formatter in `apps/web/src/lib/reports/export-csv.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/reports/export-csv.ts`.
   - Check: `grep -c '^export function formatMonthlyReportCsv' apps/web/src/lib/reports/export-csv.ts`
   - Expected output: `1`

3. Create Excel/XML spreadsheet export generator in `apps/web/src/lib/reports/export-xlsx.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/reports/export-xlsx.ts`.
   - Check: `grep -c '^export function exportMonthlyReportXlsx' apps/web/src/lib/reports/export-xlsx.ts`
   - Expected output: `1`

4. Create PDF and print formatter in `apps/web/src/lib/reports/export-pdf.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/reports/export-pdf.ts`.
   - Check: `grep -c '^export function triggerPrintStatement' apps/web/src/lib/reports/export-pdf.ts`
   - Expected output: `1`

5. Create payables summary table in `apps/web/src/lib/ui/PayablesSummaryTable.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/lib/ui/PayablesSummaryTable.svelte`.
   - Check: `grep -c 'payables-table' apps/web/src/lib/ui/PayablesSummaryTable.svelte`
   - Expected output: `1`

6. Create monthly reports dashboard in `apps/web/src/routes/(app)/reports/+page.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/routes/(app)/reports/+page.svelte`.
   - Check: `grep -c 'class="reports-page' "apps/web/src/routes/(app)/reports/+page.svelte"`
   - Expected output: `1`

7. Create comprehensive reports test suite in `apps/web/src/lib/reports/reports.test.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/lib/reports/reports.test.ts`.
   - Check: `pnpm --filter @clt/web test reports.test.ts`
   - Expected output: test suite passes with all tests passing cleanly.

## 6. Specifications

### 6.1 `apps/web/src/lib/reports/aggregates.ts`

```ts
import { z } from 'zod';
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month format. Expected YYYY-MM');

export interface MethodChargeSummary {
  methodId: string;
  methodCode: string;
  entryCount: number;
  totalGrossPoisha: bigint;
  totalBusinessChargePoisha: bigint;
  totalCustomerChargePoisha: bigint;
  totalChargePoisha: bigint;
}

export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  entryCount: number;
  subQty: number;
  grossPoisha: bigint;
  vatPoisha: bigint;
  commissionPoisha: bigint;
  businessChargePoisha: bigint;
  customerChargePoisha: bigint;
  netPoisha: bigint;
}

export interface MonthlyReportData {
  month: string; // YYYY-MM-01
  totalEntries: number;
  vatEntriesCount: number;
  pendingEntriesCount: number;
  totalSubQty: number;
  totalGrossPoisha: bigint;
  totalVatPoisha: bigint;
  totalCommissionPoisha: bigint;
  totalChargePoisha: bigint;
  totalBusinessChargesPoisha: bigint;
  totalCustomerChargesPoisha: bigint;
  totalNetPoisha: bigint;
  methodCharges: MethodChargeSummary[];
  dailyBreakdowns: DailyBreakdown[];
}

export interface MonthOverMonthDelta {
  grossDeltaPoisha: bigint;
  grossDeltaPercent: number | null;
  netDeltaPoisha: bigint;
  netDeltaPercent: number | null;
  commissionDeltaPoisha: bigint;
  commissionDeltaPercent: number | null;
}

/**
 * Computes monthly financial aggregates strictly from active, non-rejected entries.
 * Voided, superseded, and server-rejected entries are completely excluded.
 * Customer-borne provider charges are isolated in totalCustomerChargesPoisha
 * and excluded from merchant settlement liabilities (Hard Rule 3, PRD §8.3, §10).
 */
export function computeMonthlyAggregates(
  entries: LocalEntry[],
  monthPrefix: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): MonthlyReportData {
  MonthSchema.parse(monthPrefix);

  // Filter strictly for active entries in target month, excluding rejected sync ops (PRD §8.3, §10)
  const activeEntries = entries.filter(
    (e) => e.status === 'active' && e.sync_status !== 'rejected' && e.entry_date.startsWith(monthPrefix)
  );

  let gross = 0n;
  let vat = 0n;
  let commission = 0n;
  let totalCharge = 0n;
  let businessCharges = 0n;
  let customerCharges = 0n;
  let net = 0n;
  let subQty = 0;
  let pendingCount = 0;
  let vatCount = 0;

  const methodMap = new Map<string, { count: number; gross: bigint; business: bigint; customer: bigint; charge: bigint }>();
  const dailyMap = new Map<string, { count: number; subQty: number; gross: bigint; vat: bigint; comm: bigint; biz: bigint; cust: bigint; net: bigint }>();

  for (const e of activeEntries) {
    if (e.sync_status === 'pending') {
      pendingCount += 1;
    }

    const entryGross = BigInt(e.gross_poisha);
    const entryVat = BigInt(e.vat_poisha);
    if (entryVat > 0n) {
      vatCount += 1;
    }
    const entryComm = BigInt(e.commission_poisha);
    const entryBizCharge = BigInt(e.business_charge_poisha);
    const entryCustCharge = BigInt(e.customer_charge_poisha);
    const entryNet = BigInt(e.net_poisha);
    const entryCharge = entryBizCharge + entryCustCharge;

    gross += entryGross;
    vat += entryVat;
    commission += entryComm;
    totalCharge += entryCharge;
    businessCharges += entryBizCharge;
    customerCharges += entryCustCharge;
    net += entryNet;
    subQty += e.sub_qty;

    // Method breakdown (Volume & Charges)
    const m = methodMap.get(e.method_id) ?? { count: 0, gross: 0n, business: 0n, customer: 0n, charge: 0n };
    m.count += 1;
    m.gross += entryGross;
    m.business += entryBizCharge;
    m.customer += entryCustCharge;
    m.charge += entryCharge;
    methodMap.set(e.method_id, m);

    // Daily breakdown for cash reconciliation
    const d = dailyMap.get(e.entry_date) ?? { count: 0, subQty: 0, gross: 0n, vat: 0n, comm: 0n, biz: 0n, cust: 0n, net: 0n };
    d.count += 1;
    d.subQty += e.sub_qty;
    d.gross += entryGross;
    d.vat += entryVat;
    d.comm += entryComm;
    d.biz += entryBizCharge;
    d.cust += entryCustCharge;
    d.net += entryNet;
    dailyMap.set(e.entry_date, d);
  }

  const methodCharges: MethodChargeSummary[] = Array.from(methodMap.entries()).map(([id, stats]) => {
    const cachedMethod = methodsMap[id];
    return {
      methodId: id,
      methodCode: cachedMethod?.code ?? id,
      entryCount: stats.count,
      totalGrossPoisha: stats.gross,
      totalBusinessChargePoisha: stats.business,
      totalCustomerChargePoisha: stats.customer,
      totalChargePoisha: stats.charge,
    };
  });

  const dailyBreakdowns: DailyBreakdown[] = Array.from(dailyMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, d]) => ({
      date,
      entryCount: d.count,
      subQty: d.subQty,
      grossPoisha: d.gross,
      vatPoisha: d.vat,
      commissionPoisha: d.comm,
      businessChargePoisha: d.biz,
      customerChargePoisha: d.cust,
      netPoisha: d.net,
    }));

  return {
    month: `${monthPrefix}-01`,
    totalEntries: activeEntries.length,
    vatEntriesCount: vatCount,
    pendingEntriesCount: pendingCount,
    totalSubQty: subQty,
    totalGrossPoisha: gross,
    totalVatPoisha: vat,
    totalCommissionPoisha: commission,
    totalChargePoisha: totalCharge,
    totalBusinessChargesPoisha: businessCharges,
    totalCustomerChargesPoisha: customerCharges,
    totalNetPoisha: net,
    methodCharges,
    dailyBreakdowns,
  };
}

/**
 * Computes Month-over-Month (MoM) delta percentages and poisha differences.
 */
export function computeMonthOverMonthDelta(
  current: MonthlyReportData,
  prior: MonthlyReportData
): MonthOverMonthDelta {
  const calcPct = (curr: bigint, prev: bigint): number | null => {
    if (prev === 0n) return null;
    const diff = Number(curr - prev);
    const base = Math.abs(Number(prev));
    return Math.round((diff / base) * 1000) / 10; // 1 decimal place
  };

  return {
    grossDeltaPoisha: current.totalGrossPoisha - prior.totalGrossPoisha,
    grossDeltaPercent: calcPct(current.totalGrossPoisha, prior.totalGrossPoisha),
    netDeltaPoisha: current.totalNetPoisha - prior.totalNetPoisha,
    netDeltaPercent: calcPct(current.totalNetPoisha, prior.totalNetPoisha),
    commissionDeltaPoisha: current.totalCommissionPoisha - prior.totalCommissionPoisha,
    commissionDeltaPercent: calcPct(current.totalCommissionPoisha, prior.totalCommissionPoisha),
  };
}
```

### 6.2 `apps/web/src/lib/reports/export-csv.ts`

```ts
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

/**
 * Escapes CSV field per RFC 4180 and protects against CSV formula injection.
 * If value begins with =, +, -, @, \t, or \r, prepends a single quote (').
 * Wraps in double quotes if the field contains comma, quote, newline, or carriage return,
 * escaping internal quotes as "".
 */
export function escapeCsvField(val: string): string {
  let sanitized = val;
  if (/^[=+\-@\t\r]/.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }
  if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n') || sanitized.includes('\r')) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Formats integer poisha decimal string into an exact 2-decimal fixed point string
 * (e.g. '6795' -> '67.95', '306405' -> '3064.05') without integer truncation or grouping commas.
 */
export function formatPoishaForCsv(poishaStr: string): string {
  const p = BigInt(poishaStr);
  const sign = p < 0n ? '-' : '';
  const abs = p < 0n ? -p : p;
  const taka = abs / 100n;
  const rem = abs % 100n;
  return `${sign}${taka.toString()}.${rem.toString().padStart(2, '0')}`;
}

/**
 * Generates RFC 4180 compliant CSV string from entry records.
 * Prepends UTF-8 BOM (\uFEFF) to prevent Excel Bangla mojibake.
 * Formats full accountant columns and appends a fixed Totals row matching summary cards.
 */
export function formatMonthlyReportCsv(
  entries: LocalEntry[],
  methodsMap: Record<string, CachedPaymentMethod> = {}
): string {
  const headers = [
    'Entry Number',
    'Date',
    'Status',
    'Customer',
    'Sub Qty',
    'Method',
    'Gross (BDT)',
    'VAT Mode',
    'VAT (BDT)',
    'Commission (BDT)',
    'Merchant Fee (BDT)',
    'Customer Fee (BDT)',
    'Net (BDT)',
    'Rate Version',
    'Txn Ref',
    'Notes',
  ];

  let sumQty = 0;
  let sumGross = 0n;
  let sumVat = 0n;
  let sumComm = 0n;
  let sumBizFee = 0n;
  let sumCustFee = 0n;
  let sumNet = 0n;

  const rows = entries.map((e) => {
    const methodName = methodsMap[e.method_id]?.name ?? e.method_id;
    const vatMode = e.snapshot?.vatMode ?? 'manual';
    const rateVer = e.snapshot?.rateProfileVersion ? `v${e.snapshot.rateProfileVersion}` : 'v1';

    sumQty += e.sub_qty;
    sumGross += BigInt(e.gross_poisha);
    sumVat += BigInt(e.vat_poisha);
    sumComm += BigInt(e.commission_poisha);
    sumBizFee += BigInt(e.business_charge_poisha);
    sumCustFee += BigInt(e.customer_charge_poisha);
    sumNet += BigInt(e.net_poisha);

    return [
      escapeCsvField(e.entry_number ?? e.local_id),
      e.entry_date,
      e.status,
      escapeCsvField(e.customer_name),
      e.sub_qty.toString(),
      escapeCsvField(methodName),
      formatPoishaForCsv(e.gross_poisha),
      vatMode,
      formatPoishaForCsv(e.vat_poisha),
      formatPoishaForCsv(e.commission_poisha),
      formatPoishaForCsv(e.business_charge_poisha),
      formatPoishaForCsv(e.customer_charge_poisha),
      formatPoishaForCsv(e.net_poisha),
      rateVer,
      escapeCsvField(e.txn_ref ?? ''),
      escapeCsvField(e.notes ?? ''),
    ].join(',');
  });

  // Sticky / fixed Totals row matching summary cards exactly (PRD §8.3, §16.3 #2)
  const totalsRow = [
    'TOTALS',
    '',
    '',
    '',
    sumQty.toString(),
    '',
    formatPoishaForCsv(sumGross.toString()),
    '',
    formatPoishaForCsv(sumVat.toString()),
    formatPoishaForCsv(sumComm.toString()),
    formatPoishaForCsv(sumBizFee.toString()),
    formatPoishaForCsv(sumCustFee.toString()),
    formatPoishaForCsv(sumNet.toString()),
    '',
    '',
    '',
  ].join(',');

  // \uFEFF Byte Order Mark for Excel UTF-8 recognition
  return '\uFEFF' + [headers.join(','), ...rows, totalsRow].join('\r\n');
}

/**
 * Triggers browser download of monthly report CSV file with delayed URL revocation
 * and mobile platform branch.
 */
export function exportMonthlyReportCsv(
  entries: LocalEntry[],
  month: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): void {
  // Mobile / Capacitor platform branch (Plan 019 handoff)
  if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
    console.info('[Export CSV] Delegating to Capacitor Filesystem/Share plugin in Plan 019');
  }

  const csvContent = formatMonthlyReportCsv(entries, methodsMap);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `monthly-statement-${month}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Delayed revocation ensures Safari and WebKit complete download before memory release
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

### 6.3 `apps/web/src/lib/reports/export-xlsx.ts`

```ts
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';
import { formatPoishaForCsv } from './export-csv';

/**
 * Generates an XML Spreadsheet 2003 (.xlsx/.xls) document compatible with Excel,
 * LibreOffice, and Google Sheets without external binary library baggage.
 * Preserves UTF-8 encoding, exact decimal types, and includes full entry list with totals row.
 */
export function formatMonthlyReportXmlSpreadsheet(
  entries: LocalEntry[],
  month: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): string {
  let sumQty = 0;
  let sumGross = 0n;
  let sumVat = 0n;
  let sumComm = 0n;
  let sumBizFee = 0n;
  let sumCustFee = 0n;
  let sumNet = 0n;

  const escapeXml = (str: string) =>
    str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const entryRows = entries.map((e) => {
    sumQty += e.sub_qty;
    sumGross += BigInt(e.gross_poisha);
    sumVat += BigInt(e.vat_poisha);
    sumComm += BigInt(e.commission_poisha);
    sumBizFee += BigInt(e.business_charge_poisha);
    sumCustFee += BigInt(e.customer_charge_poisha);
    sumNet += BigInt(e.net_poisha);

    const methodName = methodsMap[e.method_id]?.name ?? e.method_id;
    return `    <Row>
      <Cell><Data ss:Type="String">${escapeXml(e.entry_number ?? e.local_id)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.entry_date)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.customer_name)}</Data></Cell>
      <Cell><Data ss:Type="Number">${e.sub_qty}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(methodName)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.gross_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.vat_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.commission_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.business_charge_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.customer_charge_poisha)}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(e.net_poisha)}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.txn_ref ?? '')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(e.notes ?? '')}</Data></Cell>
    </Row>`;
  }).join('\n');

  const totalsRow = `    <Row ss:StyleID="BoldHeader">
      <Cell><Data ss:Type="String">TOTALS</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="Number">${sumQty}</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumGross.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumVat.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumComm.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumBizFee.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumCustFee.toString())}</Data></Cell>
      <Cell><Data ss:Type="Number">${formatPoishaForCsv(sumNet.toString())}</Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
      <Cell><Data ss:Type="String"></Data></Cell>
    </Row>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="BoldHeader">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Statement-${month}">
    <Table>
      <Row ss:StyleID="BoldHeader">
        <Cell><Data ss:Type="String">Entry Number</Data></Cell>
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Customer</Data></Cell>
        <Cell><Data ss:Type="String">Sub Qty</Data></Cell>
        <Cell><Data ss:Type="String">Method</Data></Cell>
        <Cell><Data ss:Type="String">Gross (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">VAT (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Commission (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Merchant Fee (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Customer Fee (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Net (BDT)</Data></Cell>
        <Cell><Data ss:Type="String">Txn Ref</Data></Cell>
        <Cell><Data ss:Type="String">Notes</Data></Cell>
      </Row>
${entryRows}
${totalsRow}
    </Table>
  </Worksheet>
</Workbook>`;
}

export function exportMonthlyReportXlsx(
  entries: LocalEntry[],
  month: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): void {
  // Mobile / Capacitor platform branch (Plan 019 handoff)
  if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
    console.info('[Export XLSX] Delegating to Capacitor Filesystem/Share plugin in Plan 019');
  }

  const xmlContent = formatMonthlyReportXmlSpreadsheet(entries, month, methodsMap);
  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `monthly-statement-${month}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

### 6.4 `apps/web/src/lib/reports/export-pdf.ts`

```ts
/**
 * Triggers browser print dialog for statement printing or saving as PDF.
 * Styled via clean print CSS rules (@media print) defined in reports/+page.svelte.
 * On mobile/Capacitor environments, this acts as the entrypoint for native print plugin (Plan 019).
 */
export function triggerPrintStatement(): void {
  if (typeof window !== 'undefined') {
    if ((window as any).Capacitor?.isNativePlatform()) {
      console.info('[Print PDF] Delegating to Capacitor Print plugin in Plan 019');
    }
    window.print();
  }
}
```

### 6.5 `apps/web/src/lib/ui/PayablesSummaryTable.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import type { MethodChargeSummary } from '$lib/reports/aggregates';
  import type { CachedPayable, CachedPaymentMethod, CachedSettlement } from '$lib/db';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    selectedMonth: string; // YYYY-MM
    payables: CachedPayable[];
    methodsMap: Record<string, CachedPaymentMethod>;
    settlements: CachedSettlement[];
    monthlyVatPoisha: bigint;
    monthlyVatEntryCount: number;
    methodCharges: MethodChargeSummary[];
    ondrilldown?: (methodId?: string) => void;
  }

  let {
    selectedMonth,
    payables,
    methodsMap,
    settlements,
    monthlyVatPoisha,
    monthlyVatEntryCount,
    methodCharges,
    ondrilldown,
  }: Props = $props();

  const monthFirstDay = $derived(`${selectedMonth}-01`);

  interface PayableDisplayRow {
    id: string;
    name: string;
    kind: 'vat' | 'method_charge';
    methodCode?: string | undefined;
    entryCount: number;
    expectedPoisha: bigint;
    status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
    statusSubtext?: string | undefined;
    drillDownMethodId?: string | undefined;
  }

  function getChipVariant(code?: string): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (lower === 'bkash' || lower === 'visa' || lower === 'mastercard' || lower === 'vat' || lower === 'commission') {
      return lower;
    }
    return 'default';
  }

  const tableRows = $derived.by<PayableDisplayRow[]>(() => {
    const rows: PayableDisplayRow[] = [];

    // 1. VAT Payable Stream (PRD §8.3, §10)
    const vatPayable = payables.find((p) => p.kind === 'vat');
    const vatSettlement = settlements.find(
      (s) => s.month === monthFirstDay && s.payable_id === (vatPayable?.id ?? 'vat')
    );
    let vatStatus = vatSettlement?.status ?? (monthlyVatPoisha === 0n ? 'not_applicable' : 'due');
    let vatSubtext: string | undefined;
    if (vatSettlement?.status === 'paid' && monthlyVatPoisha > BigInt(vatSettlement.expected_poisha)) {
      vatStatus = 'partly_paid';
      const diff = monthlyVatPoisha - BigInt(vatSettlement.expected_poisha);
      vatSubtext = `+${formatPoishaToBdt(diff)} unsynced`;
    }

    rows.push({
      id: vatPayable?.id ?? 'vat-system-stream',
      name: vatPayable?.name ?? 'Government VAT Challan',
      kind: 'vat',
      entryCount: monthlyVatEntryCount,
      expectedPoisha: monthlyVatPoisha,
      status: vatStatus,
      statusSubtext: vatSubtext,
      drillDownMethodId: undefined,
    });

    // 2. Method Charge Payables (PRD §8.3, §10)
    // Iterate over all active method payables first to guarantee complete coverage
    const coveredMethodIds = new Set<string>();

    for (const p of payables.filter((pay) => pay.kind === 'method_charge')) {
      if (!p.method_id) continue;
      coveredMethodIds.add(p.method_id);

      const mc = methodCharges.find((m) => m.methodId === p.method_id);
      const method = methodsMap[p.method_id];
      const sett = settlements.find((s) => s.month === monthFirstDay && s.payable_id === p.id);

      const expectedPoisha = mc?.totalBusinessChargePoisha ?? 0n;
      const entryCount = mc?.entryCount ?? 0;

      let status = sett?.status ?? (expectedPoisha === 0n ? 'not_applicable' : 'due');
      let statusSubtext: string | undefined;
      if (sett?.status === 'paid' && expectedPoisha > BigInt(sett.expected_poisha)) {
        status = 'partly_paid';
        const diff = expectedPoisha - BigInt(sett.expected_poisha);
        statusSubtext = `+${formatPoishaToBdt(diff)} unsynced`;
      }

      rows.push({
        id: p.id,
        name: p.name,
        kind: 'method_charge',
        methodCode: method?.code ?? mc?.methodCode,
        entryCount,
        expectedPoisha,
        status,
        statusSubtext,
        drillDownMethodId: p.method_id,
      });
    }

    // Include unconfigured method streams from methodCharges so zero fee money is dropped
    for (const mc of methodCharges) {
      if (coveredMethodIds.has(mc.methodId)) continue;
      if (mc.totalBusinessChargePoisha === 0n && mc.entryCount === 0) continue;

      const method = methodsMap[mc.methodId];
      rows.push({
        id: `unconfigured-payable-${mc.methodId}`,
        name: method?.name ? `${method.name} Merchant Fee (Unassigned)` : 'Payment Provider Fee (Unassigned)',
        kind: 'method_charge',
        methodCode: method?.code ?? mc.methodCode,
        entryCount: mc.entryCount,
        expectedPoisha: mc.totalBusinessChargePoisha,
        status: mc.totalBusinessChargePoisha === 0n ? 'not_applicable' : 'due',
        statusSubtext: undefined,
        drillDownMethodId: mc.methodId,
      });
    }

    return rows;
  });

  function getStatusBadge(status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid') {
    switch (status) {
      case 'not_applicable':
        return { label: 'N/A', cls: 'bg-black/5 dark:bg-white/5 text-[var(--muted)]' };
      case 'due':
        return { label: 'Due', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold' };
      case 'partly_paid':
        return { label: 'Partly Paid', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold' };
      case 'paid':
        return { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold' };
      case 'overpaid':
        return { label: 'Overpaid', cls: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 font-semibold' };
    }
  }
</script>

<div class="payables-table">
  <Card class="p-6">
    <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
      <div>
        <h2 class="text-base font-bold text-[var(--ink)]">Payables & Liabilities Summary</h2>
        <p class="text-xs text-[var(--muted)]">Derived from active entries and monthly settlement records.</p>
      </div>
      <span class="text-xs text-[var(--muted)] font-mono">{monthFirstDay}</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="text-xs text-[var(--muted)] border-b border-black/5 dark:border-white/5 uppercase tracking-wider">
            <th class="pb-2">Payable Stream</th>
            <th class="pb-2 text-center">Txn Count</th>
            <th class="pb-2 text-right">Amount (Poisha)</th>
            <th class="pb-2 text-right">Amount (BDT)</th>
            <th class="pb-2 text-center">Status</th>
            <th class="pb-2 text-right no-print">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5 dark:divide-white/5">
          {#each tableRows as row (row.id)}
            {@const badge = getStatusBadge(row.status)}
            <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
              <td class="py-3 font-semibold text-[var(--ink)]">
                <div class="flex items-center gap-2">
                  {#if row.kind === 'vat'}
                    <Chip variant="vat">VAT</Chip>
                  {:else if row.methodCode}
                    <Chip variant={getChipVariant(row.methodCode)}>
                      {row.methodCode}
                    </Chip>
                  {/if}
                  <span>{row.name}</span>
                </div>
              </td>
              <td class="py-3 text-center tabular-nums text-[var(--muted)]">
                {row.entryCount}
              </td>
              <td class="py-3 text-right font-mono tabular-nums text-xs text-[var(--muted)]">
                {row.expectedPoisha.toString()}
              </td>
              <td class="py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                {formatPoishaToBdt(row.expectedPoisha)}
              </td>
              <td class="py-3 text-center">
                <span class="text-xs px-2.5 py-0.5 rounded-full {badge.cls}">
                  {badge.label}
                </span>
                {#if row.statusSubtext}
                  <div class="text-[10px] text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                    {row.statusSubtext}
                  </div>
                {/if}
              </td>
              <td class="py-3 text-right no-print">
                <button
                  type="button"
                  onclick={() => ondrilldown?.(row.drillDownMethodId)}
                  class="text-xs text-[var(--accent)] hover:underline font-medium cursor-pointer"
                >
                  View Entries ↗
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>
</div>
```

### 6.6 `apps/web/src/routes/(app)/reports/+page.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import PayablesSummaryTable from '$lib/ui/PayablesSummaryTable.svelte';
  import { db, type LocalEntry, type CachedPayable, type CachedPaymentMethod, type CachedSettlement, type CachedAppSettings } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { computeMonthlyAggregates, computeMonthOverMonthDelta, MonthSchema } from '$lib/reports/aggregates';
  import { exportMonthlyReportCsv } from '$lib/reports/export-csv';
  import { exportMonthlyReportXlsx } from '$lib/reports/export-xlsx';
  import { triggerPrintStatement } from '$lib/reports/export-pdf';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  // Default to current month in Asia/Dhaka timezone (PRD §8.3)
  const currentDhakaMonth = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
      .format(new Date())
      .slice(0, 7);

  // Helper to compute previous month (YYYY-MM) safely handling year boundaries
  function getPriorMonthString(monthStr: string): string {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // Helper to compute next month (YYYY-MM) safely handling year boundaries
  function getNextMonthString(monthStr: string): string {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function getChipVariant(code?: string): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (lower === 'bkash' || lower === 'visa' || lower === 'mastercard' || lower === 'vat' || lower === 'commission') {
      return lower;
    }
    return 'default';
  }

  let selectedMonth = $state(currentDhakaMonth());
  let monthEntries = $state<LocalEntry[]>([]);
  let priorMonthEntries = $state<LocalEntry[]>([]);
  let payables = $state<CachedPayable[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let settlements = $state<CachedSettlement[]>([]);
  let appSettings = $state<CachedAppSettings | null>(null);

  // Validate and sanitize selected month input (PRD §8.3, Hard Rule 11)
  const validMonth = $derived.by(() => {
    try {
      return MonthSchema.parse(selectedMonth);
    } catch {
      return currentDhakaMonth();
    }
  });

  const priorMonth = $derived(getPriorMonthString(validMonth));

  // Role Guard: Reports screen restricted strictly to Admin and Owner (PRD §3, §8.5)
  const isAuthorized = $derived(session.user?.role === 'admin' || session.user?.role === 'owner');

  // Static configuration caches (runs once while authorized)
  $effect(() => {
    if (!isAuthorized) return;

    const subPayables = liveQuery(() => db.payables.toArray()).subscribe((rows) => {
      payables = rows;
    });
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });
    const subSettings = liveQuery(() => db.appSettings.toArray()).subscribe((rows) => {
      appSettings = rows[0] ?? null;
    });

    return () => {
      subPayables.unsubscribe();
      subMethods.unsubscribe();
      subSettings.unsubscribe();
    };
  });

  // Month-scoped reactive queries on Dexie (Performance optimization avoiding whole-table scans)
  $effect(() => {
    if (!isAuthorized) return;

    const startCurrent = `${validMonth}-01`;
    const endCurrent = `${validMonth}-31`;
    const startPrior = `${priorMonth}-01`;
    const endPrior = `${priorMonth}-31`;

    const subCurrent = liveQuery(() =>
      db.entries.where('entry_date').between(startCurrent, endCurrent, true, true).toArray()
    ).subscribe((rows) => {
      monthEntries = rows;
    });

    const subPrior = liveQuery(() =>
      db.entries.where('entry_date').between(startPrior, endPrior, true, true).toArray()
    ).subscribe((rows) => {
      priorMonthEntries = rows;
    });

    const subSettlements = liveQuery(() =>
      db.settlements.where('month').equals(`${validMonth}-01`).toArray()
    ).subscribe((rows) => {
      settlements = rows;
    });

    return () => {
      subCurrent.unsubscribe();
      subPrior.unsubscribe();
      subSettlements.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of paymentMethods) {
      map[m.id] = m;
    }
    return map;
  });

  // Dynamic net label with strict fallback to DDL default 'Net after deductions' (PRD §8.3, §8.6, Table 18)
  const netLabel = $derived(appSettings?.net_label || 'Net after deductions');

  const aggregates = $derived(
    computeMonthlyAggregates(monthEntries, validMonth, methodsMap)
  );

  const priorAggregates = $derived(
    computeMonthlyAggregates(priorMonthEntries, priorMonth, methodsMap)
  );

  const momDelta = $derived(
    computeMonthOverMonthDelta(aggregates, priorAggregates)
  );

  // Active entries for table list and export
  const activeMonthEntries = $derived(
    monthEntries.filter((e) => e.status === 'active' && e.sync_status !== 'rejected')
  );

  function handlePrevMonth() {
    selectedMonth = getPriorMonthString(validMonth);
  }

  function handleNextMonth() {
    selectedMonth = getNextMonthString(validMonth);
  }

  function handleDrillDown(methodId?: string) {
    const base = `/ledger?month=${encodeURIComponent(validMonth)}&status=active`;
    if (methodId) {
      goto(`${base}&method=${encodeURIComponent(methodId)}`);
    } else {
      goto(base);
    }
  }

  function handleCsvExport() {
    exportMonthlyReportCsv(activeMonthEntries, validMonth, methodsMap);
  }

  function handleXlsxExport() {
    exportMonthlyReportXlsx(activeMonthEntries, validMonth, methodsMap);
  }

  // Generation timestamp for print statement header
  const generationTimestamp = $derived(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date())
  );
</script>

<div class="reports-page p-6 max-w-6xl mx-auto w-full">
  {#if session.loading}
    <div class="flex items-center justify-center p-12">
      <div class="inline-block w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin text-[var(--accent)]" aria-label="Loading reports..."></div>
    </div>
  {:else if !isAuthorized}
    <div class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12">
      <span class="text-3xl mb-2 block">🔒</span>
      <h2 class="text-base font-bold text-amber-900 dark:text-amber-200">Access Restricted</h2>
      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
        Monthly Reports and Settlement Statements are restricted to Admin and Owner roles. Staff access personal metrics from the Staff Dashboard.
      </p>
      <Button variant="default" class="mt-4" onclick={() => goto('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  {:else}
    <!-- Printable Statement Header (Visible only in print mode) -->
    <div class="print-only mb-6 pb-4 border-b border-black">
      <div class="flex justify-between items-start">
        <div>
          <h1 class="text-2xl font-bold text-black uppercase tracking-tight">
            {appSettings?.organization_name || 'Cosmo Ledger Track'}
          </h1>
          <p class="text-xs text-black/70">
            {appSettings?.business_address || 'Dhaka, Bangladesh'}
            {#if appSettings?.vat_registration_no}
              &bull; BIN / VAT Reg: {appSettings.vat_registration_no}
            {/if}
          </p>
        </div>
        <div class="text-right">
          <div class="text-lg font-bold text-black">MONTHLY FINANCIAL STATEMENT</div>
          <div class="text-xs font-mono text-black/70">Statement Month: {validMonth}</div>
          <div class="text-[10px] text-black/50">Printed: {generationTimestamp} (Asia/Dhaka)</div>
        </div>
      </div>
    </div>

    <!-- Header & Interactive Toolbar (Hidden in print) -->
    <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Monthly Reports</h1>
        <p class="text-sm text-[var(--muted)]">Aggregated financial statements, daily breakdown, and settlement payables.</p>
      </div>

      <div class="flex items-center flex-wrap gap-2">
        <Button variant="default" onclick={handlePrevMonth} aria-label="Previous month">◀</Button>
        <input
          type="month"
          aria-label="Select report month"
          bind:value={selectedMonth}
          class="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <Button variant="default" onclick={handleNextMonth} aria-label="Next month">▶</Button>
        <Button variant="default" onclick={handleCsvExport}>Export CSV</Button>
        <Button variant="default" onclick={handleXlsxExport}>Export Excel</Button>
        <Button variant="commission" onclick={triggerPrintStatement}>Print PDF</Button>
      </div>
    </div>

    <!-- Unsynced Pending Transactions Notice -->
    {#if aggregates.pendingEntriesCount > 0}
      <div class="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between no-print">
        <div class="flex items-center gap-2">
          <span class="text-sm">⏳</span>
          <span class="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Includes {aggregates.pendingEntriesCount} unsynced pending {aggregates.pendingEntriesCount === 1 ? 'transaction' : 'transactions'}.
          </span>
        </div>
        <span class="text-[10px] text-amber-700/80 dark:text-amber-400/80">Totals include local offline entries</span>
      </div>
    {/if}

    <!-- Summary Cards with MoM Deltas & Drill-Down (PRD §8.3) -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Total Collected (Gross)</div>
          <div class="text-xl font-bold tabular-nums text-[var(--ink)]">{formatPoishaToBdt(aggregates.totalGrossPoisha)}</div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">{aggregates.totalEntries} txns ↗</span>
            {#if momDelta.grossDeltaPercent !== null}
              <span class="text-[10px] font-bold tabular-nums {momDelta.grossDeltaPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">
                {momDelta.grossDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.grossDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Total Units / Qty</div>
          <div class="text-xl font-bold tabular-nums text-[var(--ink)]">{aggregates.totalSubQty}</div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">Sum of sub_qty units ↗</span>
            <span class="text-[10px] font-mono text-[var(--muted)]">Avg {(aggregates.totalEntries > 0 ? (aggregates.totalSubQty / aggregates.totalEntries).toFixed(1) : 0)} / txn</span>
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Commission Earned</div>
          <div class="text-xl font-bold tabular-nums text-[var(--c-commission)]">{formatPoishaToBdt(aggregates.totalCommissionPoisha)}</div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">From rate profile ↗</span>
            {#if momDelta.commissionDeltaPercent !== null}
              <span class="text-[10px] font-bold tabular-nums {momDelta.commissionDeltaPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">
                {momDelta.commissionDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.commissionDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">{netLabel}</div>
          <div class="text-xl font-bold tabular-nums text-[var(--accent)]">{formatPoishaToBdt(aggregates.totalNetPoisha)}</div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">Net revenue ↗</span>
            {#if momDelta.netDeltaPercent !== null}
              <span class="text-[10px] font-bold tabular-nums {momDelta.netDeltaPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">
                {momDelta.netDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.netDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>
    </div>

    <!-- Daily Trend Visual Chart (PRD §8.3) -->
    {#if aggregates.dailyBreakdowns.length > 0}
      <div class="mb-6 no-print">
        <Card class="p-6">
          <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
            <div>
              <h2 class="text-base font-bold text-[var(--ink)]">Daily Collections Trend</h2>
              <p class="text-xs text-[var(--muted)]">Daily gross collections across {validMonth}.</p>
            </div>
            <span class="text-xs text-[var(--muted)]">{aggregates.dailyBreakdowns.length} active days</span>
          </div>

          <div class="h-28 flex items-end gap-1.5 pt-4 overflow-x-auto">
            {@const maxDaily = aggregates.dailyBreakdowns.reduce((max, d) => d.grossPoisha > max ? d.grossPoisha : max, 1n)}
            {#each aggregates.dailyBreakdowns as day}
              {@const heightPercent = Number((day.grossPoisha * 100n) / maxDaily)}
              <div class="flex-1 min-w-[20px] flex flex-col items-center gap-1 group relative">
                <!-- Tooltip -->
                <div class="absolute bottom-full mb-1 hidden group-hover:block z-10 p-2 rounded bg-black/90 text-white text-[10px] whitespace-nowrap shadow-lg">
                  <div class="font-bold">{day.date}</div>
                  <div>Gross: {formatPoishaToBdt(day.grossPoisha)}</div>
                  <div>Net: {formatPoishaToBdt(day.netPoisha)}</div>
                  <div>Txns: {day.entryCount}</div>
                </div>
                <!-- Bar -->
                <div
                  style="height: {Math.max(heightPercent, 4)}%"
                  class="w-full rounded-t bg-[var(--accent)]/70 group-hover:bg-[var(--accent)] transition-all"
                ></div>
                <!-- Day Label -->
                <span class="text-[9px] font-mono text-[var(--muted)]">{day.date.slice(8)}</span>
              </div>
            {/each}
          </div>
        </Card>
      </div>
    {/if}

    <!-- Payables Summary Table with Canonical Payables & 5-State Badges -->
    <div class="mb-6">
      <PayablesSummaryTable
        selectedMonth={validMonth}
        {payables}
        {methodsMap}
        {settlements}
        monthlyVatPoisha={aggregates.totalVatPoisha}
        monthlyVatEntryCount={aggregates.vatEntriesCount}
        methodCharges={aggregates.methodCharges}
        ondrilldown={handleDrillDown}
      />
    </div>

    <!-- Payment Method Volumes & Charges Breakdown (PRD §8.3) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Payment Method Volumes & Merchant Charges</h2>
            <p class="text-xs text-[var(--muted)]">Turnover and deductions partitioned by provider.</p>
          </div>
          <span class="text-xs text-[var(--muted)]">Month: {validMonth}</span>
        </div>

        {#if aggregates.methodCharges.length === 0}
          <div class="p-8 text-center text-sm text-[var(--muted)]">
            No transactions recorded for {validMonth}.
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            {#each aggregates.methodCharges as mc (mc.methodId)}
              {@const m = methodsMap[mc.methodId]}
              <button
                type="button"
                onclick={() => handleDrillDown(mc.methodId)}
                class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
              >
                <div class="p-4 rounded-xl border border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 hover:border-[var(--accent)] transition-colors h-full">
                  <div class="flex items-center justify-between mb-3">
                    <div class="font-bold text-sm text-[var(--ink)] flex items-center gap-2">
                      <Chip variant={getChipVariant(m?.code)}>
                        {m?.code ?? mc.methodCode}
                      </Chip>
                      <span>{m?.name ?? mc.methodId}</span>
                    </div>
                    <span class="text-xs text-[var(--muted)] tabular-nums">{mc.entryCount} txns</span>
                  </div>

                  <div class="space-y-1.5 text-xs">
                    <div class="flex justify-between">
                      <span class="text-[var(--muted)]">Turnover Volume:</span>
                      <span class="font-bold tabular-nums text-[var(--ink)]">{formatPoishaToBdt(mc.totalGrossPoisha)}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-[var(--muted)]">Business Fee Borne:</span>
                      <span class="font-bold tabular-nums text-red-600 dark:text-red-400">
                        {formatPoishaToBdt(mc.totalBusinessChargePoisha)}
                      </span>
                    </div>
                    {#if mc.totalCustomerChargePoisha > 0n}
                      <div class="flex justify-between text-[11px] text-blue-600 dark:text-blue-400">
                        <span>Customer Paid:</span>
                        <span class="tabular-nums font-semibold">{formatPoishaToBdt(mc.totalCustomerChargePoisha)}</span>
                      </div>
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </Card>
    </div>

    <!-- Customer-Borne Provider Fees Informational Section (PRD §8.3) -->
    {#if aggregates.totalCustomerChargesPoisha > 0n}
      <div class="mb-6">
        <Card class="p-5 border-blue-500/20 bg-blue-500/5">
          <div class="flex items-start gap-3">
            <span class="text-lg">ℹ️</span>
            <div>
              <div class="text-sm font-bold text-blue-900 dark:text-blue-300">
                Customer-Paid Provider Fees: {formatPoishaToBdt(aggregates.totalCustomerChargesPoisha)}
              </div>
              <p class="text-xs text-blue-700/80 dark:text-blue-400/80 mt-1">
                These provider charges were borne directly by customers at the point of sale. They create zero merchant payable liability and are excluded from business settlement balances.
              </p>
            </div>
          </div>
        </Card>
      </div>
    {/if}

    <!-- Daily Cash Reconciliation Breakdown Table (PRD §8.3) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Daily Cash Reconciliation Breakdown</h2>
            <p class="text-xs text-[var(--muted)]">Daily component totals for cash drawer reconciliation.</p>
          </div>
          <span class="text-xs text-[var(--muted)] font-mono">{validMonth}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-[var(--muted)] border-b border-black/5 dark:border-white/5 uppercase tracking-wider">
                <th class="pb-2">Date</th>
                <th class="pb-2 text-center">Txns</th>
                <th class="pb-2 text-center">Units</th>
                <th class="pb-2 text-right">Gross</th>
                <th class="pb-2 text-right">VAT</th>
                <th class="pb-2 text-right">Commission</th>
                <th class="pb-2 text-right">Business Fee</th>
                <th class="pb-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
              {#each aggregates.dailyBreakdowns as day}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-2 font-bold text-[var(--ink)]">{day.date}</td>
                  <td class="py-2 text-center tabular-nums">{day.entryCount}</td>
                  <td class="py-2 text-center tabular-nums">{day.subQty}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--ink)]">{formatPoishaToBdt(day.grossPoisha)}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">{formatPoishaToBdt(day.vatPoisha)}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">{formatPoishaToBdt(day.commissionPoisha)}</td>
                  <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">{formatPoishaToBdt(day.businessChargePoisha)}</td>
                  <td class="py-2 text-right tabular-nums font-bold text-[var(--accent)]">{formatPoishaToBdt(day.netPoisha)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t-2 border-black/10 dark:border-white/10 font-bold text-[var(--ink)] font-mono">
              <tr>
                <td class="py-2 uppercase">TOTALS</td>
                <td class="py-2 text-center tabular-nums">{aggregates.totalEntries}</td>
                <td class="py-2 text-center tabular-nums">{aggregates.totalSubQty}</td>
                <td class="py-2 text-right tabular-nums">{formatPoishaToBdt(aggregates.totalGrossPoisha)}</td>
                <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">{formatPoishaToBdt(aggregates.totalVatPoisha)}</td>
                <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">{formatPoishaToBdt(aggregates.totalCommissionPoisha)}</td>
                <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">{formatPoishaToBdt(aggregates.totalBusinessChargesPoisha)}</td>
                <td class="py-2 text-right tabular-nums text-[var(--accent)]">{formatPoishaToBdt(aggregates.totalNetPoisha)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>

    <!-- Detailed Monthly Entry List with Fixed Totals Row (PRD §8.3, §16.3 #2) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Detailed Monthly Transactions</h2>
            <p class="text-xs text-[var(--muted)]">Full entry ledger asserting exact parity with summary cards.</p>
          </div>
          <span class="text-xs text-[var(--muted)]">{activeMonthEntries.length} entries</span>
        </div>

        <div class="overflow-x-auto max-h-[500px]">
          <table class="w-full text-left text-xs">
            <thead class="sticky top-0 bg-white dark:bg-[var(--pearl-c)] z-10 border-b border-black/10 dark:border-white/10">
              <tr class="text-[var(--muted)] uppercase tracking-wider">
                <th class="py-2">Entry #</th>
                <th class="py-2">Date</th>
                <th class="py-2">Customer</th>
                <th class="py-2 text-center">Qty</th>
                <th class="py-2">Method</th>
                <th class="py-2 text-right">Gross</th>
                <th class="py-2 text-right">VAT</th>
                <th class="py-2 text-right">Commission</th>
                <th class="py-2 text-right">Fee</th>
                <th class="py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
              {#each activeMonthEntries as entry}
                {@const m = methodsMap[entry.method_id]}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-2 font-bold text-[var(--ink)]">{entry.entry_number ?? entry.local_id}</td>
                  <td class="py-2 text-[var(--muted)]">{entry.entry_date}</td>
                  <td class="py-2 font-sans font-medium text-[var(--ink)]">{entry.customer_name}</td>
                  <td class="py-2 text-center tabular-nums">{entry.sub_qty}</td>
                  <td class="py-2 font-sans">
                    <Chip variant={getChipVariant(m?.code)}>
                      {m?.code ?? entry.method_id}
                    </Chip>
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--ink)]">{formatPoishaToBdt(BigInt(entry.gross_poisha))}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">{formatPoishaToBdt(BigInt(entry.vat_poisha))}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">{formatPoishaToBdt(BigInt(entry.commission_poisha))}</td>
                  <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">{formatPoishaToBdt(BigInt(entry.business_charge_poisha))}</td>
                  <td class="py-2 text-right tabular-nums font-bold text-[var(--accent)]">{formatPoishaToBdt(BigInt(entry.net_poisha))}</td>
                </tr>
              {/each}
            </tbody>
            <!-- Sticky Totals Row Asserting Parity (PRD §8.3, §16.3 #2) -->
            <tfoot class="sticky bottom-0 bg-white dark:bg-[var(--pearl-c)] border-t-2 border-black/20 dark:border-white/20 font-mono font-bold text-[var(--ink)]">
              <tr>
                <td class="py-3 uppercase">TOTALS</td>
                <td class="py-3"></td>
                <td class="py-3"></td>
                <td class="py-3 text-center tabular-nums">{aggregates.totalSubQty}</td>
                <td class="py-3"></td>
                <td class="py-3 text-right tabular-nums">{formatPoishaToBdt(aggregates.totalGrossPoisha)}</td>
                <td class="py-3 text-right tabular-nums text-[var(--c-vat)]">{formatPoishaToBdt(aggregates.totalVatPoisha)}</td>
                <td class="py-3 text-right tabular-nums text-[var(--c-commission)]">{formatPoishaToBdt(aggregates.totalCommissionPoisha)}</td>
                <td class="py-3 text-right tabular-nums text-red-600 dark:text-red-400">{formatPoishaToBdt(aggregates.totalBusinessChargesPoisha)}</td>
                <td class="py-3 text-right tabular-nums text-[var(--accent)]">{formatPoishaToBdt(aggregates.totalNetPoisha)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  {/if}
</div>

<style>
  /* Header visible only during paper print */
  .print-only {
    display: none;
  }

  /* Clean Print Media Stylesheet (PRD §8.3) */
  @media print {
    :global(aside),
    :global(nav),
    :global(#floating-action-menu),
    :global(.no-print) {
      display: none !important;
    }

    .print-only {
      display: block !important;
    }

    :global(.overflow-x-auto) {
      overflow: visible !important;
      max-height: none !important;
    }

    :global(.reports-page) {
      padding: 0 !important;
      max-width: 100% !important;
    }

    /* Universal Print Reset: Prevent dark-theme near-white text on white paper */
    :global(*) {
      color: #000000 !important;
      background-color: transparent !important;
      text-shadow: none !important;
      box-shadow: none !important;
    }

    :global(body),
    .reports-page,
    :global(.glass) {
      background: #ffffff !important;
      color: #000000 !important;
      box-shadow: none !important;
      border-color: #000000 !important;
      backdrop-filter: none !important;
    }

    :global(thead) {
      display: table-header-group;
    }

    :global(tr) {
      page-break-inside: avoid;
    }

    :global(tfoot) {
      display: table-footer-group;
    }
  }
</style>
```

### 6.7 `apps/web/src/lib/reports/reports.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeMonthlyAggregates, computeMonthOverMonthDelta, MonthSchema } from './aggregates';
import { formatMonthlyReportCsv, formatPoishaForCsv, escapeCsvField } from './export-csv';
import { formatMonthlyReportXmlSpreadsheet } from './export-xlsx';
import type { LocalEntry, CachedPaymentMethod, CachedPayable, CachedSettlement } from '$lib/db';

describe('Reports Aggregates & Parity Verification', () => {
  // 10 fixture rows from PRD §6.6 using exact PRD customer labels (Ayash, Abida, Ahiyan, etc.)
  const fixtures: LocalEntry[] = [
    { id: '1', entry_date: '2026-10-01', customer_name: 'Ayash', sub_qty: 2, method_id: 'bkash', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '6795', business_charge_poisha: '6795', customer_charge_poisha: '0', net_poisha: '306405', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
    { id: '2', entry_date: '2026-10-02', customer_name: 'Abida', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
    { id: '3', entry_date: '2026-10-03', customer_name: 'Ahiyan', sub_qty: 2, method_id: 'cash', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '313200', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    { id: '4', entry_date: '2026-10-04', customer_name: 'Suhaima (H)', sub_qty: 2, method_id: 'visa', gross_poisha: '838400', vat_poisha: '58400', commission_poisha: '327600', charge_poisha: '12576', business_charge_poisha: '12576', customer_charge_poisha: '0', net_poisha: '439824', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L4' },
    { id: '5', entry_date: '2026-10-05', customer_name: 'Tahra', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L5' },
    { id: '6', entry_date: '2026-10-06', customer_name: 'Aaan', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L6' },
    { id: '7', entry_date: '2026-10-07', customer_name: 'Azlan', sub_qty: 1, method_id: 'visa', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '4950', business_charge_poisha: '4950', customer_charge_poisha: '0', net_poisha: '169050', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L7' },
    { id: '8', entry_date: '2026-10-08', customer_name: 'Mandisha', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L8' },
    { id: '9', entry_date: '2026-10-09', customer_name: 'Autnika', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L9' },
    { id: '10', entry_date: '2026-10-10', customer_name: 'Tridha', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L10' },
  ];

  it('reproduces exact paper ledger fixture totals and verifies conservation identity (PRD §6.6, §10)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    // Assert exact PRD §6.6 totals
    expect(report.totalEntries).toBe(10);
    expect(report.totalSubQty).toBe(16);
    expect(report.totalGrossPoisha).toBe(5112900n);
    expect(report.totalVatPoisha).toBe(432900n);
    expect(report.totalCommissionPoisha).toBe(1965600n);
    expect(report.totalBusinessChargesPoisha).toBe(50913n); // bKash 6,795 + Card 44,118
    expect(report.totalNetPoisha).toBe(2663487n);

    // Conservation check: vat + commission + fee + net === gross
    const componentSum = report.totalVatPoisha + report.totalCommissionPoisha + report.totalBusinessChargesPoisha + report.totalNetPoisha;
    expect(componentSum).toBe(report.totalGrossPoisha);
  });

  it('computes daily breakdowns whose sums equal monthly summary totals (PRD §8.3)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    expect(report.dailyBreakdowns.length).toBe(10);

    const sumDailyGross = report.dailyBreakdowns.reduce((acc, d) => acc + d.grossPoisha, 0n);
    const sumDailyVat = report.dailyBreakdowns.reduce((acc, d) => acc + d.vatPoisha, 0n);
    const sumDailyComm = report.dailyBreakdowns.reduce((acc, d) => acc + d.commissionPoisha, 0n);
    const sumDailyFee = report.dailyBreakdowns.reduce((acc, d) => acc + d.businessChargePoisha, 0n);
    const sumDailyNet = report.dailyBreakdowns.reduce((acc, d) => acc + d.netPoisha, 0n);
    const sumDailyQty = report.dailyBreakdowns.reduce((acc, d) => acc + d.subQty, 0);

    expect(sumDailyGross).toBe(report.totalGrossPoisha);
    expect(sumDailyVat).toBe(report.totalVatPoisha);
    expect(sumDailyComm).toBe(report.totalCommissionPoisha);
    expect(sumDailyFee).toBe(report.totalBusinessChargesPoisha);
    expect(sumDailyNet).toBe(report.totalNetPoisha);
    expect(sumDailyQty).toBe(report.totalSubQty);
  });

  it('computes method volumes and charges accurately (PRD §8.3)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    const bkash = report.methodCharges.find((m) => m.methodId === 'bkash');
    expect(bkash).toBeDefined();
    expect(bkash?.entryCount).toBe(1);
    expect(bkash?.totalGrossPoisha).toBe(590900n);
    expect(bkash?.totalBusinessChargePoisha).toBe(6795n);

    const visa = report.methodCharges.find((m) => m.methodId === 'visa');
    expect(visa).toBeDefined();
    expect(visa?.entryCount).toBe(5);
    expect(visa?.totalGrossPoisha).toBe(2941100n); // 838400 + 590900*3 + 330000
    expect(visa?.totalBusinessChargePoisha).toBe(44118n);

    const cash = report.methodCharges.find((m) => m.methodId === 'cash');
    expect(cash).toBeDefined();
    expect(cash?.entryCount).toBe(4);
    expect(cash?.totalGrossPoisha).toBe(1580900n); // 330000*3 + 590900
    expect(cash?.totalBusinessChargePoisha).toBe(0n);
  });

  it('isolates customer-paid fees and excludes voided, superseded, and rejected entries (PRD §8.3, §10)', () => {
    const entries: LocalEntry[] = [
      {
        id: 'e1',
        entry_date: '2026-10-15',
        customer_name: 'Active Customer',
        sub_qty: 1,
        method_id: 'bkash',
        gross_poisha: '100000',
        vat_poisha: '0',
        commission_poisha: '42000',
        charge_poisha: '1850',
        business_charge_poisha: '0',
        customer_charge_poisha: '1850', // Borne by customer
        net_poisha: '58000',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L1',
      },
      {
        id: 'e2',
        entry_date: '2026-10-16',
        customer_name: 'Voided Customer',
        sub_qty: 2,
        method_id: 'bkash',
        gross_poisha: '200000',
        vat_poisha: '0',
        commission_poisha: '84000',
        charge_poisha: '2300',
        business_charge_poisha: '2300',
        customer_charge_poisha: '0',
        net_poisha: '113700',
        status: 'voided', // Must be excluded
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L2',
      },
      {
        id: 'e3',
        entry_date: '2026-10-17',
        customer_name: 'Superseded Customer',
        sub_qty: 1,
        method_id: 'visa',
        gross_poisha: '50000',
        vat_poisha: '0',
        commission_poisha: '21000',
        charge_poisha: '750',
        business_charge_poisha: '750',
        customer_charge_poisha: '0',
        net_poisha: '28250',
        status: 'superseded', // Must be excluded
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L3',
      },
      {
        id: 'e4',
        entry_date: '2026-10-18',
        customer_name: 'Rejected Push Customer',
        sub_qty: 1,
        method_id: 'cash',
        gross_poisha: '80000',
        vat_poisha: '0',
        commission_poisha: '33600',
        charge_poisha: '0',
        business_charge_poisha: '0',
        customer_charge_poisha: '0',
        net_poisha: '46400',
        status: 'active',
        sync_status: 'rejected', // Rejected by server: MUST be excluded from reports
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L4',
      },
    ];

    const report = computeMonthlyAggregates(entries, '2026-10');

    expect(report.totalEntries).toBe(1);
    expect(report.totalGrossPoisha).toBe(100000n);
    expect(report.totalBusinessChargesPoisha).toBe(0n);
    expect(report.totalCustomerChargesPoisha).toBe(1850n);
    expect(report.totalNetPoisha).toBe(58000n);
  });

  it('computes month-over-month deltas with directional indicators (PRD §8.3)', () => {
    const current = computeMonthlyAggregates(fixtures, '2026-10');
    // Prior month with half the volume
    const priorFixtures = fixtures.slice(0, 5).map((f) => ({ ...f, entry_date: '2026-09-01' }));
    const prior = computeMonthlyAggregates(priorFixtures, '2026-09');

    const delta = computeMonthOverMonthDelta(current, prior);

    expect(delta.grossDeltaPoisha).toBeGreaterThan(0n);
    expect(delta.grossDeltaPercent).toBeGreaterThan(0);
    expect(delta.commissionDeltaPoisha).toBeGreaterThan(0n);
    expect(delta.netDeltaPoisha).toBeGreaterThan(0n);

    // Zero prior month edge case
    const zeroPrior = computeMonthlyAggregates([], '2026-09');
    const zeroDelta = computeMonthOverMonthDelta(current, zeroPrior);
    expect(zeroDelta.grossDeltaPercent).toBeNull();
  });

  it('validates month format using Zod MonthSchema (Hard Rule 11)', () => {
    expect(() => MonthSchema.parse('2026-10')).not.toThrow();
    expect(() => MonthSchema.parse('2026-01')).not.toThrow();
    expect(() => MonthSchema.parse('')).toThrow();
    expect(() => MonthSchema.parse('2026-13')).toThrow();
    expect(() => MonthSchema.parse('invalid')).toThrow();
  });

  it('generates RFC 4180 CSV export with UTF-8 BOM, formula injection defense, and totals row (PRD §8.3, §16.3 #2)', () => {
    const methodsMap: Record<string, CachedPaymentMethod> = {
      'm-bkash-uuid': {
        id: 'm-bkash-uuid',
        code: 'bkash',
        name: 'bKash Merchant',
        requires_txn_ref: true,
        display_order: 1,
        active: true,
      },
    };

    const entries: LocalEntry[] = [
      {
        id: '1',
        entry_number: 'E-202610-000001',
        local_id: '#LOCAL-000001',
        entry_date: '2026-10-01',
        customer_name: '=cmd|"/C calc"!A0', // Potential CSV formula injection attack
        sub_qty: 2,
        method_id: 'm-bkash-uuid',
        gross_poisha: '590900', // 5909.00
        vat_poisha: '50900', // 509.00
        commission_poisha: '226800', // 2268.00
        charge_poisha: '6795', // 67.95
        business_charge_poisha: '6795', // 67.95 (must NOT truncate to 67)
        customer_charge_poisha: '0',
        net_poisha: '306405', // 3064.05 (must NOT truncate to 3064)
        txn_ref: 'TXN-001,REF',
        notes: 'Line 1\r\nLine 2',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    // Assert exact 2-decimal formatting helper
    expect(formatPoishaForCsv('6795')).toBe('67.95');
    expect(formatPoishaForCsv('306405')).toBe('3064.05');
    expect(formatPoishaForCsv('100')).toBe('1.00');
    expect(formatPoishaForCsv('5')).toBe('0.05');

    // Assert formula injection defense
    expect(escapeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(escapeCsvField('+1234')).toBe("'+1234");
    expect(escapeCsvField('-4567')).toBe("'-4567");
    expect(escapeCsvField('@special')).toBe("'@special");

    // Assert RFC 4180 escaping
    expect(escapeCsvField('Hello, World')).toBe('"Hello, World"');
    expect(escapeCsvField('He said "Hi"')).toBe('"He said ""Hi"""');
    expect(escapeCsvField('Line1\rLine2')).toBe('"Line1\rLine2"');

    const csv = formatMonthlyReportCsv(entries, methodsMap);

    // Verify UTF-8 BOM
    expect(csv.startsWith('\uFEFF')).toBe(true);

    // Verify CSV headers
    expect(csv).toContain('Entry Number,Date,Status,Customer,Sub Qty,Method,Gross (BDT),VAT Mode,VAT (BDT),Commission (BDT),Merchant Fee (BDT),Customer Fee (BDT),Net (BDT),Rate Version,Txn Ref,Notes');

    // Verify formula injection sanitized with prepended single quote
    expect(csv).toContain("'=cmd");

    // Verify method name and 2-decimal money
    expect(csv).toContain('bKash Merchant');
    expect(csv).toContain('5909.00,manual,509.00,2268.00,67.95,0.00,3064.05');

    // Verify fixed Totals row present in CSV matching summary totals
    expect(csv).toContain('TOTALS,,,,2,,5909.00,,509.00,2268.00,67.95,0.00,3064.05,,,');
  });

  it('generates XML Spreadsheet 2003 (.xlsx/.xls) export with styled headers and totals (PRD §8.3)', () => {
    const xml = formatMonthlyReportXmlSpreadsheet(fixtures, '2026-10');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
    expect(xml).toContain('<Worksheet ss:Name="Statement-2026-10">');
    expect(xml).toContain('<Row ss:StyleID="BoldHeader">');
    expect(xml).toContain('<Data ss:Type="String">Entry Number</Data>');
    expect(xml).toContain('<Data ss:Type="String">TOTALS</Data>');
    expect(xml).toContain('51129.00'); // Total gross BDT
    expect(xml).toContain('26634.87'); // Total net BDT
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Fixture Parity Summation | 10 paper ledger fixture rows (PRD §6.6) | `gross 5,112,900, vat 432,900, comm 1,965,600, fees 50,913, net 2,663,487` | §6.6, §8.3 | `apps/web/src/lib/reports/reports.test.ts` |
| View Parity Conservation | Monthly aggregates | `vat + comm + fee + net === gross` | §10, §16.3 #2 | `apps/web/src/lib/reports/reports.test.ts` |
| Daily Breakdown Consistency | 10 fixture rows | Sum of daily breakdown gross, vat, comm, fees, net === monthly totals | §8.3 | `apps/web/src/lib/reports/reports.test.ts` |
| Payment Method Volumes & Charges | 10 fixture rows | bKash (1 txn, ৳5,909.00 gross, ৳67.95 fee); Visa (5 txns, ৳29,411.00 gross, ৳441.18 fee); Cash (4 txns, ৳15,809.00 gross, ৳0 fee) | §8.3 | `apps/web/src/lib/reports/reports.test.ts` |
| Customer Fee Isolation & Inactive/Rejected Filtering | Active customer fee + voided + superseded + sync_status 'rejected' | Customer fee isolated in `totalCustomerChargesPoisha`; voided/superseded/rejected excluded | §8.3, §10 | `apps/web/src/lib/reports/reports.test.ts` |
| Month-over-Month Deltas | Current month vs prior month | Percentage deltas ($\pm X.X\%$) with directional indicator; safe division by zero on empty prior month | §8.3 | `apps/web/src/lib/reports/reports.test.ts` |
| Month Input Zod Validation | Various month strings | Accepts `YYYY-MM`; rejects empty, invalid months, and non-numeric characters | Hard Rule 11 | `apps/web/src/lib/reports/reports.test.ts` |
| RFC 4180 CSV Export, BOM & Formula Defense | Special characters, quotes, formulas (`=cmd`), poisha decimals | UTF-8 BOM (`\uFEFF`), `'` formula defense, exact 2-decimal strings (`67.95`, `3064.05`), totals row matching cards | §8.3, §16.3 #2 | `apps/web/src/lib/reports/reports.test.ts` |
| XML Spreadsheet / XLSX Export | 10 fixture rows | Valid Excel XML Spreadsheet 2003 with typed Number cells, headers, and totals row | §8.3 | `apps/web/src/lib/reports/reports.test.ts` |

## 8. Acceptance criteria

1. Report aggregates equal the sum of active, non-rejected entries and verify mathematical conservation.
   - Command: `pnpm --filter @clt/web test reports.test.ts`
   - Expected output: test suite passes with 8 passed tests.
2. CSV export generates RFC 4180 escaped content with UTF-8 BOM, formula injection defense, exact 2-decimal poisha, and fixed totals row.
   - Command: `pnpm --filter @clt/web test reports.test.ts -t "RFC 4180"`
   - Expected output: `1 passed`.
3. SvelteKit route and component typecheck passes cleanly.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 1: Dynamic rate profiles and app settings honored (`db.appSettings.net_label` falling back strictly to DDL default `'Net after deductions'`).
- Rule 2: Integer poisha used in all report calculations; formatted with exact 2-decimal fixed point in CSV/XLSX and South Asian digit grouping (`formatPoishaToBdt`) in UI.
- Rule 3: Single calculation module identities respected; customer-borne charges isolated in informational section and excluded from business settlement liabilities.
- Rule 4: Reports compute strictly from immutable snapshot values stored on active entries.
- Rule 11: Zod validation on dates and export inputs (`MonthSchema`).

## 10. Pitfalls

- Trap: Poisha truncation via BigInt integer division (`/ 100n`) in CSV export breaking spreadsheet conservation.
  - Fix: Use `formatPoishaForCsv` providing exact 2-decimal fixed-point string representation (`67.95`, `3064.05`) without loss of fractional poisha.
- Trap: CSV formula injection vulnerabilities allowing malicious user input (`=cmd...`) to execute in Excel.
  - Fix: Detect values starting with `=`, `+`, `-`, `@`, `\t`, or `\r` in `escapeCsvField` and prepend a single quote `'`.
- Trap: Excel displaying Bangla customer names as mojibake.
  - Fix: Prepend UTF-8 Byte Order Mark (`\uFEFF`) to the exported CSV string.
- Trap: Server-rejected operations inflating local report totals.
  - Fix: Aggregator strictly filters `status === 'active' && sync_status !== 'rejected'`, ensuring parity with server views `v_monthly_totals` and `v_monthly_method_charges`.
- Trap: Whole-table Dexie scan on every month change causing performance degradation as transaction history grows.
  - Fix: Use IndexedDB indexed range query `db.entries.where('entry_date').between(start, end, true, true).toArray()`.
- Trap: Hardcoding settlement status to "Due" or dropping method fees if payable is unconfigured.
  - Fix: Join against `db.payables`, `db.methods`, and `db.settlements`, computing exact 5-state settlement badges; render unassigned payable stream for any method with fees if no active payable is configured.
- Trap: Desktop sidebar and navigation buttons rendering on printed PDF statements, and dark theme printing white text on white paper.
  - Fix: Provide comprehensive `@media print` stylesheet with `:global(.no-print)` hiding chrome and universal reset `:global(*) { color: #000000 !important; background: #ffffff !important }`.
- Trap: Native mobile Capacitor WebView failing on `window.print()` or synchronous `URL.revokeObjectURL()`.
  - Fix: Delay object URL revocation (1000 ms) and provide native platform branching with explicit Plan 019 handoff.

## 11. PRD ISSUES and DECISION PENDING

- none

## 12. Handoff

- `computeMonthlyAggregates` and `computeMonthOverMonthDelta` in `apps/web/src/lib/reports/aggregates.ts` exported for use in Owner and Admin dashboard metrics (Plan 016).
- `exportMonthlyReportCsv`, `exportMonthlyReportXlsx`, and `triggerPrintStatement` exported for mobile Capacitor wrapping and share sheets in Plan 019 (`019_capacitor_android_release.md`).

## 13. Suggested task breakdown

- `CLT-T-043`: Implement report aggregation math, daily cash breakdown, MoM deltas, customer fee isolation, and parity verification test suite (Files: `apps/web/src/lib/reports/aggregates.ts`, `apps/web/src/lib/reports/reports.test.ts`; Depends on: none; Role: Implementer; Priority: P0).
- `CLT-T-044`: Build CSV, XML Spreadsheet / XLSX, and print statement export generators with RFC 4180 compliance, UTF-8 BOM, formula injection defense, 2-decimal formatting, totals row, and print CSS (Files: `apps/web/src/lib/reports/export-csv.ts`, `apps/web/src/lib/reports/export-xlsx.ts`, `apps/web/src/lib/reports/export-pdf.ts`; Depends on: `CLT-T-043`; Role: Implementer; Priority: P1).
- `CLT-T-045`: Build payables table component with 5-state badges without dropping fees, and monthly report dashboard with role guard, calendar picker, net_label, daily trend chart, full entry list with totals row, drill-downs, and print statement header (Files: `apps/web/src/lib/ui/PayablesSummaryTable.svelte`, `apps/web/src/routes/(app)/reports/+page.svelte`; Depends on: `CLT-T-044`; Role: Implementer; Priority: P0).

## Changelog

- 2026-11-01 — Revision 3.1:
  - Adversarial audit remediation addressing 4 P0 Blockers, 5 P1 Major Risks, and 7 P2 Minor Deficiencies:
  - Fixed session property bug: replaced broken `session.role` with `session.user?.role === 'admin' || session.user?.role === 'owner'` in `reports/+page.svelte`, restoring Admin/Owner authorization and adding loading state to eliminate flash of access restricted.
  - Fixed test mock fixtures: added mandatory `charge_poisha` to all `LocalEntry` test fixtures across `reports.test.ts`.
  - Fixed test assertion mismatch: corrected CSV formula escape assertion to expect `'=SUM(A1:A10)` matching implementation.
  - Fixed MoM delta sign inversion: used `Math.abs(Number(prev))` as base in `computeMonthOverMonthDelta`, preventing growth from negative baselines from rendering as negative percentage collapses.
  - Hardened print stylesheet: added `no-print` to trend chart container, added `overflow: visible !important; max-height: none !important;` to `@media print`, preventing paper statement truncation at 500px.
  - Preserved configured active payables: updated `tableRows` in `PayablesSummaryTable.svelte` to iterate through all configured method payables regardless of whether transactions occurred in the target month.
  - Fixed drill-down navigation: added `status=active` to ledger query params in `handleDrillDown`, ensuring drilled-down ledger list matches summary card totals.
  - Optimized Dexie queries: split static configuration queries from month-scoped date-range queries in `+page.svelte`.
  - Isolated VAT transaction count: added `vatEntriesCount` to `MonthlyReportData` to reflect actual VAT-bearing transactions.
  - Upgraded accessibility and styling: added `aria-label` to month input, added `focus-visible` styling to interactive cards, replaced custom VAT badge with `<Chip variant="vat">`, added sticky totals `<tfoot>` to daily cash table, stripped XML control characters in `export-xlsx.ts`, and aligned dark theme token to `var(--pearl-c)`.
- 2026-10-31: Remediated comprehensive audit findings across PRD §8.3, §10, and §16.3 (Revision 3.0):
  - 1. Missing PRD §8.3 Features Implemented: Added daily cash reconciliation breakdown (`dailyBreakdowns`), daily collections trend chart (responsive SVG bar chart), Month-over-Month (MoM) delta percentages and arrows on summary cards, payment method volumes (gross turnover) and fees, and a full detailed monthly entry list with a sticky totals row mathematically matching summary cards.
  - 2. Dynamic Net Label Fixed: Updated `CachedAppSettings` binding from `db.appSettings`, falling back strictly to DDL default `'Net after deductions'`.
  - 3. Drill-Down Fixed: Replaced `window.location.href` full-page reload with SvelteKit `goto('/ledger?month=...&method=...')`, integrating with Plan 012 Rev 3.0 URL parameter parser.
  - 4. Safe Month Navigation: Bound `<input type="month">` to Zod `MonthSchema` with safe fallback to `currentDhakaMonth()` and year-boundary navigation arithmetic (`2026-01` $\leftrightarrow$ `2025-12`), eliminating empty-input aggregation bugs and `NaN-NaN` errors.
  - 5. Server-Rejected Operation Isolation: Aggregator strictly filters `status === 'active' && sync_status !== 'rejected'`, preserving 100% mathematical parity with PostgreSQL views `v_monthly_totals` and `v_monthly_method_charges` (PRD §10); added pending unsynced transaction counter badge.
  - 6. Mobile & Native Export Hardening: Added XML Spreadsheet 2003 (.xlsx/.xls) export generator (`export-xlsx.ts`), delayed `URL.revokeObjectURL` (1000 ms) to resolve Safari cancellation bugs, and added Capacitor native platform checks with handoff to Plan 019.
  - 7. Print Stylesheet Hardened: Added printable statement header with business name, address, VAT reg no, and Asia/Dhaka generation timestamp; used `:global(.no-print)` to hide navigation chrome and buttons across all child components; added universal print reset `:global(*) { color: #000000 !important; background: #ffffff !important }` preventing dark mode white-on-white text printing.
  - 8. CSV Security & Completeness: Added UTF-8 Byte Order Mark (`\uFEFF`) to prevent Excel Bangla mojibake; added formula injection defense prepending `'` on `=`, `+`, `-`, `@`, `\t`, `\r`; added full accountant columns (VAT mode, rate version, status, fees); and appended fixed totals row.
  - 9. Role Gating: Restricted `/reports` to Admin and Owner roles; Staff receives a clean access denied screen per PRD §3 and §8.5.
  - 10. Payables Integrity: Replaced invented `recipient_name` with DDL column `p.name`; mapped all method charges so methods without configured payables render as unassigned streams without dropping fee money; added unsynced delta indicators (`Paid (Server) + ৳... unsynced`) when local expected exceeds server settled.
  - 11. Indexed Performance: Replaced unindexed whole-table `db.entries.toArray()` with IndexedDB date-range queries `db.entries.where('entry_date').between(...)`.
  - 12. Fixture Names & Test Suite: Restored exact PRD §6.6 customer labels (Ayash, Abida, Ahiyan, etc.); expanded test suite to 8 comprehensive tests in `reports.test.ts`; eliminated `as any` typecasts via `getChipVariant`; and fixed check command regexes.
- 2026-10-31: Remediated 6 critical flaws and specification gaps (Revision 2.0).
- 2026-10-29: Remediated Blocker B25: Replaced 2-row test fixture with all 10 fixture rows from PRD §6.6.
- 2026-10-29: Initial specification created for Plan 013 aligned with PRD v1.19 §8.3, §10, and §16.3.
