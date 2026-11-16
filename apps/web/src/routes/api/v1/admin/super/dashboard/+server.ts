import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';

/**
 * GET /api/v1/admin/super/dashboard — Plan 023 step 15.
 *
 * The fleet at a glance: centers by status, active entries and gross per center for the
 * last day, week and month, devices the fleet has not heard from, rejected operations
 * still awaiting resolution, entries carrying stale rate snapshots, and the backup
 * signal.
 *
 * "Today" is the business date in Asia/Dhaka, the same boundary every report uses, so a
 * dashboard opened at 01:00 Dhaka does not show the previous day as today.
 *
 * Reads run on the privileged pool, so every query carries its own predicate; nothing
 * here depends on RLS. `backup` reports `recorded: false` because the daily export writes
 * files off-database and leaves no row behind — the plan asks for last success, and
 * inventing a timestamp would be worse than saying it is not recorded.
 */

const STALE_DEVICE_DAYS = 14;

const BANGKOK_TODAY = "(now() at time zone 'Asia/Dhaka')::date";

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'center.read_all');

  const pool = getDbPool();
  const [statuses, activity, devices, rejected, staleRates, lastBackupMarker] = await Promise.all([
    pool.query(
      `SELECT status::text AS status, count(*)::int AS count
         FROM centers
        GROUP BY status
        ORDER BY status`,
    ),
    pool.query(
      `SELECT c.id,
              c.code,
              c.name,
              c.status::text AS status,
              count(e.id) FILTER (
                WHERE e.entry_date = ${BANGKOK_TODAY} AND e.status = 'active'
              )::int AS entries_today,
              coalesce(sum(e.gross_poisha) FILTER (
                WHERE e.entry_date = ${BANGKOK_TODAY} AND e.status = 'active'
              ), 0)::text AS gross_today,
              count(e.id) FILTER (
                WHERE e.entry_date >= ${BANGKOK_TODAY} - 6 AND e.status = 'active'
              )::int AS entries_7d,
              coalesce(sum(e.gross_poisha) FILTER (
                WHERE e.entry_date >= ${BANGKOK_TODAY} - 6 AND e.status = 'active'
              ), 0)::text AS gross_7d,
              count(e.id) FILTER (
                WHERE e.entry_date >= ${BANGKOK_TODAY} - 29 AND e.status = 'active'
              )::int AS entries_30d,
              coalesce(sum(e.gross_poisha) FILTER (
                WHERE e.entry_date >= ${BANGKOK_TODAY} - 29 AND e.status = 'active'
              ), 0)::text AS gross_30d,
              max(e.created_at) AS last_entry_at
         FROM centers c
         LEFT JOIN entries e ON e.center_id = c.id
        GROUP BY c.id, c.code, c.name, c.status
        ORDER BY c.code`,
    ),
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE revoked)::int AS revoked,
              count(*) FILTER (
                WHERE NOT revoked AND last_seen_at < now() - make_interval(days => $1)
              )::int AS stale,
              max(last_seen_at) AS last_seen_at
         FROM devices`,
      [STALE_DEVICE_DAYS],
    ),
    pool.query(
      `SELECT count(*)::int AS count, min(created_at) AS oldest_created_at
         FROM sync_ops
        WHERE result = 'rejected' AND resolution_status = 'pending'`,
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE stale_rates)::int AS flagged_entries,
              count(*) FILTER (WHERE stale_review_status = 'flagged')::int AS pending_review
         FROM entries`,
    ),
    // The backup script writes encrypted files outside the database; there is no row to
    // read. A marker is only reported if one is ever recorded here.
    pool.query(
      `SELECT max(at) AS last_at
         FROM audit_log
        WHERE action = 'backup.export'`,
    ),
  ]);

  const byStatus: Record<string, number> = { active: 0, suspended: 0, archived: 0 };
  for (const row of statuses.rows) {
    byStatus[String(row.status)] = Number(row.count);
  }

  const backupAt = lastBackupMarker.rows[0]?.last_at ?? null;

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      centers: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
      },
      fleet: activity.rows.map((row) => ({
        centerId: String(row.id),
        code: String(row.code),
        name: String(row.name),
        status: String(row.status),
        entries: {
          today: Number(row.entries_today),
          last7Days: Number(row.entries_7d),
          last30Days: Number(row.entries_30d),
        },
        grossPoisha: {
          today: String(row.gross_today),
          last7Days: String(row.gross_7d),
          last30Days: String(row.gross_30d),
        },
        lastEntryAt: row.last_entry_at === null ? null : String(row.last_entry_at),
      })),
      devices: {
        staleAfterDays: STALE_DEVICE_DAYS,
        total: Number(devices.rows[0]?.total ?? 0),
        revoked: Number(devices.rows[0]?.revoked ?? 0),
        stale: Number(devices.rows[0]?.stale ?? 0),
        lastSeenAt: devices.rows[0]?.last_seen_at ? String(devices.rows[0].last_seen_at) : null,
      },
      rejectedOperations: {
        pending: Number(rejected.rows[0]?.count ?? 0),
        oldestCreatedAt: rejected.rows[0]?.oldest_created_at
          ? String(rejected.rows[0].oldest_created_at)
          : null,
      },
      staleRates: {
        flaggedEntries: Number(staleRates.rows[0]?.flagged_entries ?? 0),
        pendingReview: Number(staleRates.rows[0]?.pending_review ?? 0),
      },
      backup: {
        // `recorded` is the honest part: the daily export leaves no database row.
        recorded: backupAt !== null,
        lastSuccessAt: backupAt === null ? null : String(backupAt),
        source: 'scripts/ops/backup-export.ts',
      },
    }),
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};
