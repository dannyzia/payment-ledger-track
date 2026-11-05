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

  // RFC 4180 quoting is normally removed by parseCsvRows, but a directly-quoted
  // value must also parse (integer-math only, no floats — Hard Rule 2).
  if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
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
