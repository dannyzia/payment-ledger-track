import type { LocalEntry } from '$lib/db';
import type { DayGroup } from './types';

/**
 * Groups entries by entry_date descending (newest day first).
 * Within each day group, entries are sorted chronologically descending by created_at DESC
 * with server_seq DESC and id as strictly transitive tie-breakers.
 * Daily gross, net, and deductions strictly aggregate 'active' entries using BigInt poisha arithmetic.
 */
export function groupEntriesByDay(entries: LocalEntry[]): DayGroup[] {
  const map = new Map<string, LocalEntry[]>();

  for (const entry of entries) {
    const d = entry.entry_date;
    const list = map.get(d) ?? [];
    list.push(entry);
    map.set(d, list);
  }

  const sortedDates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));

  return sortedDates.map((date) => {
    const dayEntries = map.get(date) ?? [];

    // Strictly transitive intra-day sorting: created_at DESC -> server_seq DESC -> id DESC
    dayEntries.sort((a, b) => {
      const timeDiff = b.created_at.localeCompare(a.created_at);
      if (timeDiff !== 0) return timeDiff;

      if (a.server_seq && b.server_seq) {
        const seqA = BigInt(a.server_seq);
        const seqB = BigInt(b.server_seq);
        if (seqB > seqA) return 1;
        if (seqB < seqA) return -1;
        return 0;
      }
      if (b.server_seq && !a.server_seq) return 1;
      if (!b.server_seq && a.server_seq) return -1;

      return b.id.localeCompare(a.id);
    });

    let gross = 0n;
    let net = 0n;
    let deductions = 0n;
    let subQty = 0;

    for (const e of dayEntries) {
      if (e.status === 'active') {
        const g = BigInt(e.gross_poisha);
        const n = BigInt(e.net_poisha);
        gross += g;
        net += n;
        deductions += g - n;
        subQty += e.sub_qty;
      }
    }

    return {
      date,
      entries: dayEntries,
      totalGrossPoisha: gross,
      totalNetPoisha: net,
      totalDeductionsPoisha: deductions,
      totalSubQty: subQty,
    };
  });
}
