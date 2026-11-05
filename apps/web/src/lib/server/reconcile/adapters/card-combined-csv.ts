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
