import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { queryAuditLog } from '$lib/server/audit-read-model';

/**
 * GET /api/v1/admin/audit — Plan 023 steps 9 and 14.
 *
 * The route parses the request and answers; the tenant predicate and the audit visibility
 * mode live in `audit-read-model.ts`, which is the one reader center screens, search and
 * export share. Keeping the mode out of this file is what stops a fourth surface from
 * quietly disagreeing with the other three about what a franchisee may see.
 */
export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner' && caller.role !== 'super_admin') {
    return json({ error: 'unauthorized' }, 403);
  }

  const limit = Math.min(
    100,
    Math.max(1, parseInt(event.url.searchParams.get('limit') || '50', 10)),
  );

  const result = await queryAuditLog(
    {
      centerId: event.url.searchParams.get('centerId'),
      table: event.url.searchParams.get('table'),
      action: event.url.searchParams.get('action'),
      actor: event.url.searchParams.get('actor'),
      startDate: event.url.searchParams.get('startDate'),
      endDate: event.url.searchParams.get('endDate'),
      limit,
    },
    { role: caller.role, centerId: caller.centerId },
  );

  if (result.error) {
    return json({ error: result.error }, 500);
  }

  return json({ events: result.events }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
