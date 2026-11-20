import type { UserRole } from '@clt/shared';
import { getServiceSupabase } from './supabase';
import { AUDIT_VISIBILITY_MODE, type AuditVisibilityMode } from './audit-visibility';

/**
 * Plan 023 step 14 (Specification 6.8) — the one reader of `audit_log` for center-facing
 * surfaces, and the place `CLT-D-037`'s mode is applied.
 *
 * Two rules meet here and neither may be re-implemented at a call site:
 *
 *  1. Tenant scope. The platform seat may read any center, and only the center it names;
 *     a center role reads its own center and nothing else, whatever `centerId` the
 *     request asked for. The predicate is built here because these reads run on the
 *     service role, which bypasses RLS.
 *  2. Visibility. A platform-authored row is either removed (`silent`, the recorded
 *     default) or kept with its actor replaced by `platform` (`attributable_unnamed`).
 *     The mode is a parameter only so a test can prove both branches; screens, search
 *     and export take the default.
 *
 * A row counts as platform-authored when either audit payload says `actor_role:
 * super_admin`, or when the actor's profile is the platform seat. The payload check is
 * the primary one — older rows predate the role column being written — and the profile
 * lookup catches a row whose payload was trimmed.
 */

export interface AuditQueryOptions {
  /** Only honored for a `super_admin` caller; a center caller is always scoped to its own. */
  centerId?: string | null;
  table?: string | null;
  action?: string | null;
  actor?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number | null;
}

export interface AuditCallerContext {
  role: UserRole;
  centerId: string | null;
}

export interface AuditEvent {
  id: number | string;
  center_id: string | null;
  actor: string | null;
  action: string;
  target_table: string | null;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  error?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | null | undefined): number {
  const value = Number.isFinite(limit) ? Number(limit) : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function payloadRole(row: AuditEvent): unknown {
  const after = row.after?.actor_role;
  return after ?? row.before?.actor_role;
}

/**
 * Reads `audit_log` for one caller and applies the tenant predicate and the visibility
 * mode. Every failure is returned, not thrown: the route answers 500 with the message and
 * the caller decides what to show.
 */
export async function queryAuditLog(
  options: AuditQueryOptions,
  caller: AuditCallerContext,
  visibilityMode: AuditVisibilityMode = AUDIT_VISIBILITY_MODE,
): Promise<AuditQueryResult> {
  const isSeat = caller.role === 'super_admin';

  if (!isSeat && !caller.centerId) {
    // A center role without a center cannot be scoped, and an unscoped read on the
    // service role would return every tenant's rows.
    return { events: [], error: 'center_required' };
  }

  const supabase = getServiceSupabase();
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('id', { ascending: false })
    .limit(clampLimit(options.limit));

  const centerId = isSeat ? (options.centerId ?? null) : caller.centerId;
  if (centerId) query = query.eq('center_id', centerId);

  if (options.table) query = query.eq('target_table', options.table);
  if (options.action) query = query.ilike('action', `%${options.action}%`);
  if (options.actor) query = query.eq('actor', options.actor);
  if (options.startDate) query = query.gte('at', options.startDate);
  if (options.endDate) query = query.lte('at', options.endDate + 'T23:59:59.999Z');

  const { data, error } = await query;
  if (error) {
    return { events: [], error: error.message };
  }

  const rows = (data ?? []) as AuditEvent[];

  // The seat's read is the full record; the mode describes what a center may see.
  if (isSeat) {
    return { events: rows };
  }

  const platformIds = await platformActorIds(supabase);
  const isPlatformRow = (row: AuditEvent): boolean =>
    payloadRole(row) === 'super_admin' ||
    (row.actor !== null && platformIds.has(String(row.actor)));

  if (visibilityMode === 'silent') {
    return { events: rows.filter((row) => !isPlatformRow(row)) };
  }

  return {
    events: rows.map((row) => (isPlatformRow(row) ? { ...row, actor: 'platform' } : row)),
  };
}

/**
 * The platform seat's profile ids, used to recognise a row whose payload does not carry
 * `actor_role`. A failed lookup yields an empty set rather than failing the read: the
 * payload check still applies, and the alternative — returning nothing — would hide a
 * center's own rows because of an unrelated query.
 */
async function platformActorIds(
  supabase: ReturnType<typeof getServiceSupabase>,
): Promise<Set<string>> {
  const { data, error } = await supabase.from('profiles').select('id').eq('role', 'super_admin');
  if (error || !data) return new Set();
  return new Set((data as Array<{ id: string }>).map((row) => String(row.id)));
}
