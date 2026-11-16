import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';

/**
 * GET /api/v1/admin/super/ledger
 * Plan 023 step 9 — cross-center ledger read for the Head Office.
 *
 * Scope is explicit and mandatory (Specification 6.5): `centerId` is either one center's
 * uuid or the literal `all`, and it becomes a `WHERE` predicate in every query. The read
 * runs on the privileged pool, which bypasses RLS, so the predicate is the only thing
 * keeping one center's rows out of another center's totals. Nothing here depends on a
 * policy to filter.
 *
 * Pagination is a keyset on `(server_seq, id)` — the pair the sync protocol orders by —
 * not an offset, so a row inserted between pages cannot shift the window. Money leaves
 * as integer poisha in decimal strings (Hard Rule 2).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z
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
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z
      .string()
      .regex(/^\d+:[0-9a-f-]{36}$/i, 'cursor must be <server_seq>:<id>')
      .optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

interface Where {
  sql: string;
  params: unknown[];
}

function buildWhere(input: z.infer<typeof querySchema>): Where {
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

function entryIdOf(row: {
  center_code: string;
  entry_number: string | null;
  entry_date: string;
}): string | null {
  if (row.entry_number === null) return null;
  const ym = row.entry_date.replace(/-/g, '').slice(0, 6);
  return `E-${row.center_code}-${ym}-${String(row.entry_number).padStart(6, '0')}`;
}

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  // Plan 023 step 7: cross-center ledger reads require aal2.
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'ledger.read_all');

  const raw = Object.fromEntries(event.url.searchParams.entries());

  // An omitted scope is refused rather than defaulted to every center: the route may not
  // decide on its own to read the whole fleet.
  if (!raw.centerId) {
    return new Response(
      JSON.stringify({
        error: 'center_scope_required',
        message: "centerId is required: a center uuid, or 'all' for the whole fleet",
      }),
      { status: 400 },
    );
  }

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_query', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const query = parsed.data;

  const pool = getDbPool();
  const where = buildWhere(query);

  // Cursor conditions are appended after the shared predicates so both the page query
  // and the aggregates describe the same scope.
  const pageParams = [...where.params];
  let pageWhere = where.sql;
  if (query.cursor) {
    const [seq, id] = query.cursor.split(':');
    pageParams.push(seq, id);
    const cursorClause = `(e.server_seq, e.id) < ($${pageParams.length - 1}::bigint, $${pageParams.length}::uuid)`;
    pageWhere = pageWhere ? `${pageWhere} AND ${cursorClause}` : `WHERE ${cursorClause}`;
  }
  pageParams.push(query.limit);

  const [pageResult, totalsResult, methodsResult, creatorsResult] = await Promise.all([
    pool.query(
      `SELECT e.id,
              e.center_id,
              e.server_seq::text        AS server_seq,
              e.entry_number::text      AS entry_number,
              e.entry_date::text        AS entry_date,
              e.customer_name,
              e.txn_ref,
              e.method_id,
              e.gross_poisha::text      AS gross_poisha,
              e.vat_poisha::text        AS vat_poisha,
              e.commission_poisha::text AS commission_poisha,
              e.charge_poisha::text     AS charge_poisha,
              e.net_poisha::text        AS net_poisha,
              e.status::text            AS status,
              e.stale_rates,
              e.created_by,
              e.created_at,
              c.code                    AS center_code,
              c.name                    AS center_name,
              pm.code                   AS method_code,
              pm.name                   AS method_name,
              p.full_name               AS created_by_name,
              p.role::text              AS created_by_role
         FROM entries e
         JOIN centers c        ON c.id = e.center_id
         LEFT JOIN payment_methods pm ON pm.id = e.method_id
         LEFT JOIN profiles p  ON p.id = e.created_by
         ${pageWhere}
        ORDER BY e.server_seq DESC, e.id DESC
        LIMIT $${pageParams.length}`,
      pageParams,
    ),
    pool.query(
      `SELECT e.center_id,
              c.code,
              c.name,
              count(*)::int             AS entry_count,
              coalesce(sum(e.gross_poisha), 0)::text AS gross_poisha
         FROM entries e
         JOIN centers c ON c.id = e.center_id
         ${where.sql}
        GROUP BY e.center_id, c.code, c.name
        ORDER BY c.code`,
      where.params,
    ),
    pool.query(
      `SELECT DISTINCT pm.id, pm.code, pm.name
         FROM entries e
         JOIN payment_methods pm ON pm.id = e.method_id
         ${where.sql}
        ORDER BY pm.name`,
      where.params,
    ),
    pool.query(
      `SELECT DISTINCT p.id, p.full_name, p.role::text AS role
         FROM entries e
         JOIN profiles p ON p.id = e.created_by
         ${where.sql}
        ORDER BY p.full_name`,
      where.params,
    ),
  ]);

  const entries = pageResult.rows.map((row) => ({
    id: row.id,
    centerId: row.center_id,
    centerCode: row.center_code,
    centerName: row.center_name,
    serverSeq: row.server_seq,
    entryNumber: row.entry_number,
    entryId: entryIdOf(row),
    entryDate: row.entry_date,
    customerName: row.customer_name,
    txnRef: row.txn_ref,
    methodId: row.method_id,
    methodCode: row.method_code,
    methodName: row.method_name,
    grossPoisha: row.gross_poisha,
    vatPoisha: row.vat_poisha,
    commissionPoisha: row.commission_poisha,
    chargePoisha: row.charge_poisha,
    netPoisha: row.net_poisha,
    status: row.status,
    staleRates: row.stale_rates,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
  }));

  const byCenter = totalsResult.rows.map((row) => ({
    centerId: row.center_id,
    code: row.code,
    name: row.name,
    count: Number(row.entry_count),
    grossPoisha: row.gross_poisha,
  }));

  const totals = byCenter.reduce(
    (acc, center) => ({
      count: acc.count + center.count,
      grossPoisha: (BigInt(acc.grossPoisha) + BigInt(center.grossPoisha)).toString(),
    }),
    { count: 0, grossPoisha: '0' },
  );

  const last = entries.at(-1);
  const nextCursor = entries.length === query.limit && last ? `${last.serverSeq}:${last.id}` : null;

  return new Response(
    JSON.stringify({
      scope: { centerId: query.centerId, from: query.from ?? null, to: query.to ?? null },
      entries,
      nextCursor,
      totals: { count: totals.count, grossPoisha: totals.grossPoisha, byCenter },
      facets: {
        methods: methodsResult.rows.map((row) => ({ id: row.id, code: row.code, name: row.name })),
        creators: creatorsResult.rows.map((row) => ({
          id: row.id,
          fullName: row.full_name,
          role: row.role,
        })),
      },
    }),
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};
