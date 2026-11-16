import { createHash } from 'node:crypto';
import { calcSettlementStatus, type SettlementStatus } from '$lib/settlements/reminders';

/**
 * Plan 023 step 10 — impact preview and `dataVersion` (plan §6.6).
 *
 * A preview is bound to data, not to time. `dataVersion` hashes the state a void or
 * supersede would change: the month's entry high-water mark and count, every settlement
 * row for the month (its expected and paid amounts decide the status), every statement
 * that is not superseded, and whether the month is closed. Apply re-computes the same
 * hash inside the transaction that takes the month lock and refuses on a mismatch, so a
 * preview that no longer describes the data cannot be applied.
 *
 * The hash is computed here on the server, read-only, over a canonical tuple with a fixed
 * field order — JSON object key order is not a contract, so the tuple is built from
 * arrays in a fixed sequence. Nothing in this module writes.
 *
 * Every query names its center and month explicitly: the super-admin routes run on the
 * privileged pool, which bypasses RLS, so the predicate is the only scope.
 */

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface ImpactScope {
  centerId: string;
  /** First day of the target month, `YYYY-MM-01`. */
  month: string;
}

export interface SettlementSnapshot {
  id: string;
  status: string;
  expectedPoisha: string;
  paidPoisha: string;
}

export interface StatementSnapshot {
  id: string;
  status: string;
}

export type MonthCloseStatus = 'closed' | 'open';

export interface VersionSnapshot {
  entries: { maxServerSeq: string; count: number };
  settlements: SettlementSnapshot[];
  statements: StatementSnapshot[];
  monthClose: MonthCloseStatus | null;
}

/** Read-only: the four reads `dataVersion` is built from. */
export async function loadVersionSnapshot(
  db: Queryable,
  scope: ImpactScope,
): Promise<VersionSnapshot> {
  const [entries, settlements, statements, closes] = await Promise.all([
    db.query(
      `SELECT coalesce(max(server_seq), 0)::text AS max_server_seq,
              count(*)::int                  AS entry_count
         FROM entries
        WHERE center_id = $1
          AND date_trunc('month', entry_date)::date = $2::date`,
      [scope.centerId, scope.month],
    ),
    db.query(
      `SELECT id,
              status::text         AS status,
              expected_poisha::text AS expected_poisha,
              paid_poisha::text     AS paid_poisha
         FROM settlements
        WHERE center_id = $1 AND month = $2::date
        ORDER BY id`,
      [scope.centerId, scope.month],
    ),
    db.query(
      `SELECT id, status::text AS status
         FROM statements
        WHERE center_id = $1 AND month = $2::date AND status <> 'superseded'
        ORDER BY id`,
      [scope.centerId, scope.month],
    ),
    db.query(
      `SELECT status::text AS status
         FROM month_closes
        WHERE center_id = $1 AND month = $2::date`,
      [scope.centerId, scope.month],
    ),
  ]);

  return {
    entries: {
      maxServerSeq: String(entries.rows[0]?.max_server_seq ?? '0'),
      count: Number(entries.rows[0]?.entry_count ?? 0),
    },
    settlements: settlements.rows.map((row) => ({
      id: String(row.id),
      status: String(row.status),
      expectedPoisha: String(row.expected_poisha),
      paidPoisha: String(row.paid_poisha),
    })),
    statements: statements.rows.map((row) => ({
      id: String(row.id),
      status: String(row.status),
    })),
    // The schema's check constraint allows only these two; anything else is treated as
    // "no usable close row" rather than being passed through as a status.
    monthClose: (() => {
      const status = closes.rows[0]?.status;
      return status === 'closed' || status === 'open' ? status : null;
    })(),
  };
}

/**
 * The canonical tuple. Exported so the test can pin its composition: a field silently
 * dropped here would stop binding the preview to the data it describes, which is the
 * failure this whole mechanism exists to prevent.
 */
export function canonicalVersionTuple(scope: ImpactScope, snapshot: VersionSnapshot): string {
  return JSON.stringify({
    v: 1,
    centerId: scope.centerId,
    month: scope.month,
    maxServerSeq: snapshot.entries.maxServerSeq,
    entryCount: snapshot.entries.count,
    settlements: snapshot.settlements.map((row) => [
      row.id,
      row.status,
      row.expectedPoisha,
      row.paidPoisha,
    ]),
    statements: snapshot.statements.map((row) => [row.id, row.status]),
    monthClose: snapshot.monthClose,
  });
}

export function dataVersionOf(scope: ImpactScope, snapshot: VersionSnapshot): string {
  return createHash('sha256').update(canonicalVersionTuple(scope, snapshot), 'utf8').digest('hex');
}

export async function computeDataVersion(
  db: Queryable,
  scope: ImpactScope,
): Promise<{ dataVersion: string; snapshot: VersionSnapshot }> {
  const snapshot = await loadVersionSnapshot(db, scope);
  return { dataVersion: dataVersionOf(scope, snapshot), snapshot };
}

export type ImpactAction = 'void' | 'supersede';

export interface EntrySnapshot {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  status: string;
  methodId: string;
  grossPoisha: string;
  vatPoisha: string;
  businessChargePoisha: string;
  customerChargePoisha: string;
}

export interface SettlementDelta {
  settlementId: string;
  payableId: string;
  kind: string;
  methodId: string | null;
  expectedBefore: string;
  expectedAfter: string;
  paidPoisha: string;
  statusBefore: SettlementStatus;
  statusAfter: SettlementStatus;
}

export interface StatementReset {
  statementId: string;
  status: string;
  matchedLines: number;
}

export interface ImpactPreview {
  centerId: string;
  entryId: string;
  action: ImpactAction;
  month: string;
  dataVersion: string;
  entry: EntrySnapshot;
  settlementDeltas: SettlementDelta[];
  statementsReset: StatementReset[];
  monthState: { status: MonthCloseStatus | null; closed: boolean };
  /** Reasons an apply would be refused, not merely a consequence to confirm. */
  blockers: string[];
  /** Consequences worth showing but not refusals. */
  warnings: string[];
}

function monthOf(entryDate: string): string {
  return `${entryDate.slice(0, 7)}-01`;
}

/**
 * Row-level and derived effects of voiding or superseding one entry.
 *
 * Returns null when the entry is not in the named center — the caller answers 404, and
 * the route never reads an entry by id alone.
 */
export async function previewEntryImpact(
  db: Queryable,
  input: { centerId: string; entryId: string; action: ImpactAction },
): Promise<ImpactPreview | null> {
  const entryResult = await db.query(
    `SELECT id,
            entry_number::text     AS entry_number,
            entry_date::text       AS entry_date,
            status::text           AS status,
            method_id,
            gross_poisha::text     AS gross_poisha,
            vat_poisha::text       AS vat_poisha,
            business_charge_poisha::text AS business_charge_poisha,
            customer_charge_poisha::text AS customer_charge_poisha
       FROM entries
      WHERE id = $1 AND center_id = $2`,
    [input.entryId, input.centerId],
  );

  const row = entryResult.rows[0];
  if (!row) return null;

  const entry: EntrySnapshot = {
    id: String(row.id),
    entryNumber: row.entry_number === null ? null : String(row.entry_number),
    entryDate: String(row.entry_date),
    status: String(row.status),
    methodId: String(row.method_id),
    grossPoisha: String(row.gross_poisha),
    vatPoisha: String(row.vat_poisha),
    businessChargePoisha: String(row.business_charge_poisha),
    customerChargePoisha: String(row.customer_charge_poisha),
  };

  const scope: ImpactScope = { centerId: input.centerId, month: monthOf(entry.entryDate) };
  const { dataVersion, snapshot } = await computeDataVersion(db, scope);

  // Settlement streams the entry feeds: the center's VAT payable for the month, and the
  // method-charge payable for the entry's own method. `generate_monthly_settlements`
  // sums `vat_poisha` into the first and `business_charge_poisha` into the second, and
  // only for entries whose status is active.
  const settlementRows = await db.query(
    `SELECT s.id, s.payable_id, p.kind::text AS kind, p.method_id,
            s.expected_poisha::text AS expected_poisha,
            s.paid_poisha::text     AS paid_poisha
       FROM settlements s
       JOIN payables p ON p.id = s.payable_id AND p.center_id = s.center_id
      WHERE s.center_id = $1 AND s.month = $2::date
      ORDER BY p.kind, p.method_id, s.id`,
    [scope.centerId, scope.month],
  );

  const wasActive = entry.status === 'active';
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (snapshot.monthClose === 'closed') blockers.push('month_closed');
  if (!wasActive) blockers.push('entry_not_active');

  const contributionFor = (kind: string, methodId: string | null): bigint => {
    if (!wasActive) return 0n;
    if (kind === 'vat') return BigInt(entry.vatPoisha);
    if (kind === 'method_charge' && methodId === entry.methodId) {
      return BigInt(entry.businessChargePoisha);
    }
    return 0n;
  };

  const settlementDeltas: SettlementDelta[] = settlementRows.rows
    .map((settlement) => {
      const kind = String(settlement.kind);
      const methodId = settlement.method_id === null ? null : String(settlement.method_id);
      const contribution = contributionFor(kind, methodId);
      const expectedBefore = BigInt(String(settlement.expected_poisha));
      const expectedAfter = expectedBefore - contribution;

      if (expectedAfter < 0n) warnings.push('settlement_would_go_negative');

      const paid = BigInt(String(settlement.paid_poisha));
      return {
        settlementId: String(settlement.id),
        payableId: String(settlement.payable_id),
        kind,
        methodId,
        expectedBefore: expectedBefore.toString(),
        expectedAfter: expectedAfter.toString(),
        paidPoisha: paid.toString(),
        statusBefore: calcSettlementStatus(expectedBefore, paid),
        statusAfter: calcSettlementStatus(expectedAfter, paid),
      };
    })
    // Streams the entry does not feed are unchanged; listing them would bury the change.
    .filter((delta) => delta.expectedAfter !== delta.expectedBefore);

  // A statement line matched to this entry loses its match when the entry stops being
  // active, which puts a reconciled statement back to open.
  const linesResult = await db.query(
    `SELECT s.id                        AS statement_id,
            s.status::text              AS status,
            count(l.id)::int            AS matched_lines
       FROM statements s
       JOIN statement_lines l
         ON l.statement_id = s.id AND l.center_id = s.center_id
      WHERE s.center_id = $1
        AND s.month = $2::date
        AND s.status <> 'superseded'
        AND l.matched_entry_id = $3
        AND l.is_active_match
      GROUP BY s.id, s.status
      ORDER BY s.id`,
    [scope.centerId, scope.month, entry.id],
  );

  const statementsReset: StatementReset[] = linesResult.rows.map((line) => ({
    statementId: String(line.statement_id),
    status: String(line.status),
    matchedLines: Number(line.matched_lines),
  }));

  if (wasActive && statementsReset.some((statement) => statement.status === 'reconciled')) {
    warnings.push('reconciled_statements_reset');
  }
  for (const delta of settlementDeltas) {
    if (delta.statusBefore !== delta.statusAfter && delta.statusAfter === 'overpaid') {
      warnings.push('settlement_becomes_overpaid');
      break;
    }
  }

  return {
    centerId: input.centerId,
    entryId: entry.id,
    action: input.action,
    month: scope.month,
    dataVersion,
    entry,
    settlementDeltas,
    statementsReset,
    monthState: { status: snapshot.monthClose, closed: snapshot.monthClose === 'closed' },
    blockers,
    warnings,
  };
}
