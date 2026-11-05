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
    // Authoritative RateSnapshot fields (packages/calc): vat.mode, version (CLT-D-016 alignment)
    const vatMode = e.snapshot?.vat?.mode ?? 'manual';
    const rateVer = e.snapshot?.version !== undefined ? `v${e.snapshot.version}` : 'v1';

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
 * Minimal structural contract for the Capacitor global (no `any` casts, CLT-D-015 pattern).
 */
interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean } | undefined;
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
  if (typeof window !== 'undefined' && (window as unknown as CapacitorWindow).Capacitor?.isNativePlatform?.()) {
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
