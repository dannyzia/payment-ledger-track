import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { computeDataVersion } from '$lib/server/impact-preview';

/**
 * POST /api/v1/admin/super/ledger/supersede — Plan 023 step 11.
 *
 * The seat supersedes through `rpc_supersede_entry`, the same routine the center screen
 * uses. The replacement entry is built by the caller with `packages/calc` — the server
 * must not re-implement the calculation — and is **not** trusted: the RPC recomputes the
 * components from the published profile covering the replacement date, verifies the
 * supplied snapshot against it, and refuses a mismatch (`422 invalid_snapshot_rules`,
 * `422 rate_profile_date_mismatch`, `422 invalid_calc`). This route only validates the
 * envelope, so a malformed replacement fails at the RPC's own checks rather than here.
 *
 * `dataVersion` is re-computed inside the transaction holding the month lock, exactly as
 * in the void route; a mismatch is `409 stale_preview` and nothing is written. Both
 * months the RPC touches (the original's and the replacement's) are covered by the
 * version only when they are the same month — a replacement that moves the entry to a
 * different month is a reassignment, which the RPC's `chk_reassign` rules treat
 * separately, so the route refuses that shape here and leaves it to step 13.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  centerId: z.string().regex(UUID_RE, 'centerId must be a uuid'),
  entryId: z.string().regex(UUID_RE, 'entryId must be a uuid'),
  dataVersion: z.string().regex(/^[0-9a-f]{64}$/, 'dataVersion must be a sha-256 hex digest'),
  // Shape is the RPC's contract, not ours; the server never derives money from it.
  replacement: z.record(z.string(), z.unknown()),
});

const RPC_REASONS: Record<string, number> = {
  month_closed: 422,
  cannot_supersede_non_active: 422,
  parent_entry_not_found: 404,
  unauthorized: 403,
  rate_profile_date_mismatch: 422,
  invalid_snapshot_rules: 422,
  invalid_calc: 422,
  missing_entry_date: 422,
  missing_txn_ref: 422,
  inactive_payment_method: 422,
  no_rate_profile_for_date: 422,
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
  const { centerId, entryId, dataVersion, replacement } = parsed.data;

  const replacementDate = replacement['entryDate'];
  if (typeof replacementDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(replacementDate)) {
    // Handled by step 13's reassignment path, not by a version bound to one month.
    const originalMonth = await monthOfEntry(centerId, entryId);
    if (originalMonth && replacementDate.slice(0, 7) !== originalMonth.slice(0, 7)) {
      return json({ error: 'cross_month_supersede_unsupported' }, 422);
    }
  }

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
      return json({ error: 'parent_entry_not_found' }, 404);
    }

    const month = `${String(row.entry_date).slice(0, 7)}-01`;

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

    const applied = await client.query(
      `SELECT rpc_supersede_entry($1::uuid, $2::uuid, $3::jsonb, $4::uuid) AS result`,
      [centerId, entryId, JSON.stringify(replacement), caller.userId],
    );

    const result = applied.rows[0]?.result as { replacementEntryId?: string } | undefined;
    if (!result?.replacementEntryId) {
      await client.query('ROLLBACK');
      return json({ error: 'supersede_rejected' }, 422);
    }

    await client.query('COMMIT');
    return json(
      {
        ok: true,
        originalEntryId: entryId,
        replacementEntryId: result.replacementEntryId,
        dataVersion: current.dataVersion,
      },
      200,
    );
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = Object.keys(RPC_REASONS).find((reason) => message.includes(reason));
    if (code) return json({ error: code }, RPC_REASONS[code]!);
    return json({ error: 'supersede_failed', message }, 500);
  } finally {
    client.release();
  }
};

async function monthOfEntry(centerId: string, entryId: string): Promise<string | null> {
  const result = await getDbPool().query(
    `SELECT entry_date::text AS entry_date FROM entries WHERE id = $1 AND center_id = $2`,
    [entryId, centerId],
  );
  const entryDate = result.rows[0]?.entry_date;
  return entryDate ? `${String(entryDate).slice(0, 7)}-01` : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
