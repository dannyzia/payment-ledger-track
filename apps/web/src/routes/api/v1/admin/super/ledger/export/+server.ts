import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/supabase';
import { escapeCsvField, formatPoishaForCsv } from '$lib/reports/export-csv';

/**
 * GET /api/v1/admin/super/ledger/export — Plan 023 SA-LED-08.
 *
 * The spreadsheet twin of `/api/v1/admin/super/ledger`: same mandatory scope, same
 * filters, same privileged read. `centerId` is required for exactly the reason the read
 * route requires it — the pool bypasses RLS, so the predicate is the only thing keeping
 * one center's rows out of another center's file — and an omitted scope is refused
 * rather than widened to the fleet.
 *
 * The export is a read, but it is still an audit event: a Head Office spreadsheet of
 * every center's money is itself worth a record, so `ledger.export` is written with the
 * filters and the exported row count before the file is returned. A failed audit write
 * fails the export rather than handing over an unrecorded copy.
 *
 * Formatting is RFC 4180 with a UTF-8 BOM (Excel needs it for Bangla) and the shared
 * formula-injection guard from `$lib/reports/export-csv`, so a customer name starting
 * with `=` cannot become a formula in the recipient's spreadsheet. Money leaves as an
 * exact 2-decimal BDT string built from integer poisha (Hard Rule 2).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const exportQuerySchema = z
  .object({
    centerId: z.union([
      z.string().regex(UUID_RE, 'centerId must be a center uuid'),
      z.literal('all'),
    ]),
    from: z.string().regex(DATE_RE, 'from must be YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'to must be YYYY-MM-DD').optional(),
    methodId: z.string().regex(UUID_RE, 'methodId must be a uuid').optional(),
    status: z.enum(['active', 'voided', 'superseded']).optional(),
    createdBy: z.string().regex(UUID_RE, 'createdBy must be a uuid').optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

type ExportQuery = z.infer<typeof exportQuerySchema>;

interface Where {
  sql: string;
  params: unknown[];
}

/**
 * Mirrors the predicate builder in `../+server.ts`. The two routes are separate modules
 * by SvelteKit's routing contract, so the clause list is repeated rather than shared;
 * the column and cast choices must stay identical or an export would describe a
 * different scope than the page it was launched from.
 */
function buildWhere(input: ExportQuery): Where {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (input.centerId !== 'all') {
    params.push(input.centerId);
    clauses.push(`e.center_id = $${params.length}`);
  }
  if (input.from) {
    params.push(input.from);
    clauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (input.to) {
    params.push(input.to);
    clauses.push(`e.entry_date <= $${params.length}::date`);
  }
  if (input.methodId) {
    params.push(input.methodId);
    clauses.push(`e.method_id = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    clauses.push(`e.status = $${params.length}::entry_status`);
  }
  if (input.createdBy) {
    params.push(input.createdBy);
    clauses.push(`e.created_by = $${params.length}`);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** `YYYYMMDD` in Asia/Dhaka, the calendar every business date in this app follows. */
function dhakaDateStamp(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');
}

function entryIdOf(row: {
  center_code: string;
  entry_number: string | null;
  entry_date: string;
}): string {
  if (row.entry_number === null) return '';
  const ym = row.entry_date.replace(/-/g, '').slice(0, 6);
  return `E-${row.center_code}-${ym}-${String(row.entry_number).padStart(6, '0')}`;
}

const HEADERS = [
  'Entry ID',
  'Center Code',
  'Center Name',
  'Date',
  'Status',
  'Customer',
  'Sub Qty',
  'Method',
  'Gross (BDT)',
  'VAT (BDT)',
  'Commission (BDT)',
  'Merchant Fee (BDT)',
  'Customer Fee (BDT)',
  'Net (BDT)',
  'Txn Ref',
  'Created By Name',
  'Created By Role',
];

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'ledger.read_all');

  const raw = Object.fromEntries(event.url.searchParams.entries());

  if (!raw.centerId) {
    return new Response(
      JSON.stringify({
        error: 'center_scope_required',
        message: "centerId is required: a center uuid, or 'all' for the whole fleet",
      }),
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = exportQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_query', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const query = parsed.data;

  const pool = getDbPool();
  const where = buildWhere(query);

  const { rows } = await pool.query(
    `SELECT e.id,
            e.entry_number::text               AS entry_number,
            e.entry_date::text                 AS entry_date,
            e.customer_name,
            e.txn_ref,
            e.sub_qty,
            e.gross_poisha::text               AS gross_poisha,
            e.vat_poisha::text                 AS vat_poisha,
            e.commission_poisha::text          AS commission_poisha,
            e.business_charge_poisha::text     AS business_charge_poisha,
            e.customer_charge_poisha::text     AS customer_charge_poisha,
            e.net_poisha::text                 AS net_poisha,
            e.status::text                     AS status,
            c.code                             AS center_code,
            c.name                             AS center_name,
            pm.name                            AS method_name,
            p.full_name                        AS created_by_name,
            p.role::text                       AS created_by_role
       FROM entries e
       JOIN centers c               ON c.id = e.center_id
       LEFT JOIN payment_methods pm ON pm.id = e.method_id
       LEFT JOIN profiles p         ON p.id = e.created_by
       ${where.sql}
      ORDER BY e.server_seq DESC, e.id DESC`,
    where.params,
  );

  const lines = rows.map((row) =>
    [
      escapeCsvField(entryIdOf(row)),
      escapeCsvField(row.center_code ?? ''),
      escapeCsvField(row.center_name ?? ''),
      row.entry_date,
      escapeCsvField(row.status ?? ''),
      escapeCsvField(row.customer_name ?? ''),
      String(row.sub_qty ?? 0),
      escapeCsvField(row.method_name ?? ''),
      formatPoishaForCsv(row.gross_poisha),
      formatPoishaForCsv(row.vat_poisha),
      formatPoishaForCsv(row.commission_poisha),
      formatPoishaForCsv(row.business_charge_poisha),
      formatPoishaForCsv(row.customer_charge_poisha),
      formatPoishaForCsv(row.net_poisha),
      escapeCsvField(row.txn_ref ?? ''),
      escapeCsvField(row.created_by_name ?? ''),
      escapeCsvField(row.created_by_role ?? ''),
    ].join(','),
  );

  const csv = '\uFEFF' + [HEADERS.join(','), ...lines].join('\r\n');

  // Hard Rule 5: the export is recorded before the file exists for the caller.
  const supabase = getServiceSupabase();
  const { error: auditError } = await supabase.from('audit_log').insert({
    center_id: null,
    actor: caller.userId,
    action: 'ledger.export',
    target_table: 'entries',
    target_id: null,
    before: null,
    after: {
      scope: query.centerId,
      from: query.from ?? null,
      to: query.to ?? null,
      methodId: query.methodId ?? null,
      status: query.status ?? null,
      createdBy: query.createdBy ?? null,
      row_count: rows.length,
      format: 'csv',
    },
  });

  if (auditError) {
    return new Response(JSON.stringify({ error: auditError.message }), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clt-ledger-export-${dhakaDateStamp()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
