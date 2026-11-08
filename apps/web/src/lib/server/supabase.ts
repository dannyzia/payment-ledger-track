import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

let serviceClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Returns a privileged Supabase client configured with the service role key.
 * Located in $lib/server/ to enforce SvelteKit compile-time server-only boundaries (Hard Rule 8).
 */
export function getServiceSupabase() {
  if (serviceClient) return serviceClient;

  const url =
    process.env.PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
