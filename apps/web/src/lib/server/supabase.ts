import { createClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { Database } from '$lib/database.types';

let serviceClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Returns a privileged Supabase client configured with the service role key.
 * Located in $lib/server/ to enforce SvelteKit compile-time server-only boundaries (Hard Rule 8).
 */
export function getServiceSupabase() {
  if (serviceClient) return serviceClient;

  // Read through SvelteKit's dynamic env, not process.env: `vite dev` loads the
  // repo-root .env/.env.local (envDir in vite.config.ts) into $env/dynamic/*, but
  // only puts PUBLIC_* into import.meta.env and does not touch process.env, so a
  // bare `pnpm dev` had no service key and every server route 500'd until the
  // shell happened to have the file sourced.
  const url =
    privateEnv.SUPABASE_URL ||
    publicEnv.PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'http://localhost:54321';
  const serviceKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not defined.');
  }

  serviceClient = createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceClient;
}
