import { json, type RequestHandler } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/supabase';

/**
 * Production health check (Plan 021 §6.3).
 *
 * Serves uptime monitoring and the rollback trigger conditions in
 * docs/runbooks/ROLLBACK.md (§1: health status >= 500). Pings the singleton
 * app_settings row through the service-role client; never returns secrets or
 * row contents, only status/uptime/timestamp.
 */
const startTime = Date.now();

export const GET: RequestHandler = async () => {
  try {
    const supabase = getServiceSupabase();
    // Quick ping on database
    const { error } = await supabase.from('app_settings').select('id').limit(1).single();

    if (error) {
      return json({ status: 'error', error: error.message }, { status: 503 });
    }

    return json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return json(
      { status: 'error', error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
};
