import type { LocalEntry } from '$lib/db';
import type { NormalizedSearchQuery } from './types';

/**
 * Normalizes user search input:
 * 1. Formatted entry numbers (e.g. 'E-202610-000042' or 'E-000105' -> 42 or 105)
 * 2. Unsynced local badges (e.g. '#LOCAL-a1b2c3' or 'LOCAL-a1b2c3' -> 'a1b2c3')
 * 3. Raw numeric strings (e.g. '42' -> 42)
 * 4. Free text (customer name, txn ref, notes)
 */
export function normalizeEntrySearchQuery(rawQuery: string): NormalizedSearchQuery {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { rawQuery: '', numericEntryNumber: null, localBadgeQuery: null, textQuery: '' };
  }

  // 1. Check for #LOCAL-xxxx or LOCAL-xxxx badge query
  const localMatch = trimmed.match(/^#?LOCAL-([a-z0-9]+)$/i);
  const localBadgeQuery = localMatch && localMatch[1] ? localMatch[1].toLowerCase() : null;

  // 2. Check for formatted entry number E-YYYYMM-0*(\d+) or E-0*(\d+)
  const prefixMatch = trimmed.match(/^E-(?:\d{6}-)?0*(\d+)$/i);
  let numericEntryNumber: number | null = null;
  if (prefixMatch && prefixMatch[1]) {
    const num = parseInt(prefixMatch[1], 10);
    numericEntryNumber = isNaN(num) ? null : num;
  } else if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    numericEntryNumber = isNaN(num) ? null : num;
  }

  return {
    rawQuery: trimmed,
    numericEntryNumber,
    localBadgeQuery,
    textQuery: trimmed.toLowerCase(),
  };
}

/**
 * Evaluates whether an entry satisfies the normalized search criteria.
 * Strictly prevents numeric searches like '10' or '2026' from matching
 * the YYYYMM date component of E-YYYYMM-XXXXXX.
 */
export function matchesEntrySearch(entry: LocalEntry, query: NormalizedSearchQuery): boolean {
  if (!query.rawQuery) return true;

  // 1. Numeric entry number match against integer sequence portion only (supports both 2-part and 3-part formats)
  if (query.numericEntryNumber !== null && entry.entry_number) {
    const parts = entry.entry_number.split('-');
    const seqPart = parts.length >= 2 ? parts[parts.length - 1] : null;
    if (seqPart && parseInt(seqPart, 10) === query.numericEntryNumber) {
      return true;
    }
  }

  // 2. Local badge match (against #LOCAL-xxxx)
  if (query.localBadgeQuery !== null && entry.local_id) {
    if (entry.local_id.toLowerCase().includes(query.localBadgeQuery)) {
      return true;
    }
  }

  // 3. Exact full match on formatted entry_number if query starts with 'E-'
  if (query.rawQuery.toUpperCase().startsWith('E-') && entry.entry_number) {
    if (entry.entry_number.toLowerCase().includes(query.textQuery)) {
      return true;
    }
  }

  // 4. Free text matches: customer name, transaction reference, notes, and local badge
  if (entry.customer_name && entry.customer_name.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.txn_ref && entry.txn_ref.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.notes && entry.notes.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.local_id && entry.local_id.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  return false;
}
