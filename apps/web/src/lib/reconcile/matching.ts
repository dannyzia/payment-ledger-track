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
