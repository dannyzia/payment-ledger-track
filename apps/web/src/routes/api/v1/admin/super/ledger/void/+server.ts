import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { computeDataVersion } from '$lib/server/impact-preview';

/**
 * POST /api/v1/admin/super/ledger/void — Plan 023 step 11.
 *
 * The seat voids through the existing chain: `rpc_push_sync_op` with one `void_entry`
 * operation, which is the same path a center device takes. Nothing here updates
 * `entries` itself.
 *
 * The `dataVersion` from the preview is re-computed **inside** the transaction that
 * holds the center's month lock, and a mismatch is refused with `409 stale_preview`
 * before any write is attempted. The month lock is what makes that sound: every create
 * or void for a month takes the same lock, so while we hold it no other writer can move
 * the data the version describes. The RPC then takes the month lock again (re-entrant in
 * the same transaction) and the sequence lock, in the order PRD §7.2 fixes.
 *
 * The platform caller has no device row in the center — `devices` references a center
 * profile — so migration 0009 skips the presence upsert for it. The operation is still
 * recorded in `sync_ops` with a platform device identifier, so the trail is complete.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  centerId: z.string().regex(UUID_RE, 'centerId must be a uuid'),
  entryId: z.string().regex(UUID_RE, 'entryId must be a uuid'),
  dataVersion: z.string().regex(/^[0-9a-f]{64}$/, 'dataVersion must be a sha-256 hex digest'),
  reason: z.string().trim().min(1).max(500).optional(),
});

const RPC_REASONS: Record<string, number> = {
  month_closed: 422,
  cannot_void_non_active: 422,
  entry_not_found: 404,
  unauthorized: 403,
  device_revoked: 409,
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'ledger.write_any_center');

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const { centerId, entryId, dataVersion, reason } = parsed.data;

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const target = await client.query(
      `SELECT e.entry_date::text AS entry_date, c.center_number
         FROM entries e
         JOIN centers c ON c.id = e.center_id
        WHERE e.id = $1 AND e.center_id = $2`,
      [entryId, centerId],
    );
    const row = target.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return json({ error: 'entry_not_found' }, 404);
    }

    const month = `${String(row.entry_date).slice(0, 7)}-01`;

    // Month lock first, exactly as the RPC chain does (PRD §7.2 step 1).
    await client.query(
      `SELECT pg_advisory_xact_lock(
                (1001 << 16) | ($1::int & 65535),
                extract(year from $2::date)::int * 12 + extract(month from $2::date)::int
              )`,
      [Number(row.center_number), month],
    );

    const current = await computeDataVersion(client, { centerId, month });
    if (current.dataVersion !== dataVersion) {
      await client.query('ROLLBACK');
      return json({ error: 'stale_preview', expected: current.dataVersion }, 409);
    }

    const op = {
      opId: randomUUID(),
      type: 'void_entry',
      clientCreatedAt: new Date().toISOString(),
      payload: { entryId, reason: reason ?? 'Voided by platform super-admin' },
    };

    const applied = await client.query(
      `SELECT rpc_push_sync_op($1::uuid, $2, $3::uuid, 'super_admin'::user_role, $4::jsonb) AS result`,
      [centerId, `platform:${caller.userId}`, caller.userId, JSON.stringify([op])],
    );

    const result = applied.rows[0]?.result as
      { results?: Array<{ status: string; reason?: string }> } | undefined;
    const outcome = result?.results?.[0];

    if (!outcome || outcome.status !== 'ok') {
      const code = outcome?.reason ?? 'rejected';
      await client.query('ROLLBACK');
      return json({ error: code }, RPC_REASONS[code] ?? 422);
    }

    await client.query('COMMIT');
    return json({ ok: true, entryId, opId: op.opId, dataVersion: current.dataVersion }, 200);
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => undefined);
    return json(
      { error: 'void_failed', message: cause instanceof Error ? cause.message : String(cause) },
      500,
    );
  } finally {
    client.release();
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
