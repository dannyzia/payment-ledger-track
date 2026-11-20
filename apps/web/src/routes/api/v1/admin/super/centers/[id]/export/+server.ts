import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/supabase';
import { escapeCsvField, formatPoishaForCsv } from '$lib/reports/export-csv';

/**
 * GET /api/v1/admin/super/centers/[id]/export — Plan 023 SA-CTR-09.
 *
 * One center's record as the Head Office holds it: the center profile, its active
 * entries as a total, and every settlement row with its expected, paid and variance
 * amounts. This is the file handed to a franchisee who asks what the platform knows
 * about their business, so it is written as one rectangular table rather than a
 * multi-section report: the `Section` column says which kind of row each line is, which
 * keeps the file importable by any spreadsheet without a bespoke parser.
 *
 * The read runs on the privileged pool scoped by `center_id`, and the target id is
 * validated before a query is built. The export is audited as `center.export` with the
 * center id and the row counts, and a failed audit write fails the export (Hard Rule 5).
 *
 * Money is integer poisha in the database and leaves as an exact 2-decimal BDT string
 * (Hard Rule 2); every free-text field passes the shared formula-injection guard.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEADERS = [
  'Section',
  'Center Code',
  'Center Name',
  'Center Status',
  'BIN',
  'Phone',
  'Address',
  'Month',
  'Payable Code',
  'Expected (BDT)',
  'Paid (BDT)',
  'Variance (BDT)',
  'Settlement Status',
  'Active Entries',
  'Gross (BDT)',
];

const COLUMNS = HEADERS.length;

/** Pads a partial row to the table width so every line has the same number of fields. */
function row(cells: string[]): string {
  const padded = [...cells, ...Array<string>(COLUMNS - cells.length).fill('')];
  return padded.join(',');
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

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'center.read_all');

  const centerId = event.params.id ?? '';
  if (!UUID_RE.test(centerId)) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const pool = getDbPool();

  const centerResult = await pool.query(
    `SELECT id, code, name, status::text AS status, bin_number, phone, address
       FROM centers
      WHERE id = $1`,
    [centerId],
  );
  const center = centerResult.rows[0];
  if (!center) {
    return new Response(JSON.stringify({ error: 'center_not_found' }), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const [entriesResult, settlementsResult] = await Promise.all([
    pool.query(
      `SELECT count(*)::int                        AS active_entries,
              coalesce(sum(gross_poisha), 0)::text AS gross_poisha
         FROM entries
        WHERE center_id = $1
          AND status = 'active'`,
      [centerId],
    ),
    pool.query(
      `SELECT to_char(s.month, 'YYYY-MM')     AS month,
              pb.code                         AS payable_code,
              s.expected_poisha::text         AS expected_poisha,
              s.paid_poisha::text             AS paid_poisha,
              coalesce(s.variance_poisha, 0)::text AS variance_poisha,
              s.status::text                  AS status
         FROM settlements s
         JOIN payables pb ON pb.id = s.payable_id AND pb.center_id = s.center_id
        WHERE s.center_id = $1
        ORDER BY s.month, pb.code`,
      [centerId],
    ),
  ]);

  const activeEntries = Number(entriesResult.rows[0]?.active_entries ?? 0);
  const grossPoisha = String(entriesResult.rows[0]?.gross_poisha ?? '0');
  const centerCode = String(center.code);
  const centerName = String(center.name);
  const centerStatus = String(center.status);

  const lines = [
    // The center row leaves the settlement columns empty and owns the two summary
    // columns at the end of the table.
    row([
      'center',
      escapeCsvField(centerCode),
      escapeCsvField(centerName),
      escapeCsvField(centerStatus),
      escapeCsvField(center.bin_number ?? ''),
      escapeCsvField(center.phone ?? ''),
      escapeCsvField(center.address ?? ''),
      '',
      '',
      '',
      '',
      '',
      '',
      String(activeEntries),
      formatPoishaForCsv(grossPoisha),
    ]),
    ...settlementsResult.rows.map((settlement) =>
      row([
        'settlement',
        escapeCsvField(centerCode),
        escapeCsvField(centerName),
        escapeCsvField(centerStatus),
        '',
        '',
        '',
        String(settlement.month),
        escapeCsvField(settlement.payable_code ?? ''),
        formatPoishaForCsv(settlement.expected_poisha),
        formatPoishaForCsv(settlement.paid_poisha),
        formatPoishaForCsv(settlement.variance_poisha),
        escapeCsvField(settlement.status ?? ''),
      ]),
    ),
  ];

  const csv = '\uFEFF' + [HEADERS.join(','), ...lines].join('\r\n');

  const supabase = getServiceSupabase();
  const { error: auditError } = await supabase.from('audit_log').insert({
    center_id: null,
    actor: caller.userId,
    action: 'center.export',
    target_table: 'centers',
    target_id: centerId,
    before: null,
    after: {
      center_id: centerId,
      code: centerCode,
      active_entries: activeEntries,
      gross_poisha: grossPoisha,
      settlement_rows: settlementsResult.rows.length,
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
      'Content-Disposition': `attachment; filename="clt-center-${centerCode}-export-${dhakaDateStamp()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
