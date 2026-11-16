import { createClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Re-authentication for the guarded purge (Plan 023 step 13).
 *
 * `aal2` says this session proved a second factor at some point; it does not say the
 * person at the keyboard right now is the seat. A purge is irreversible, so the route
 * asks for the password again and verifies it against GoTrue, using the anon key rather
 * than the service role: the question is "does this person know the password", and the
 * service-role key must not be able to answer it.
 *
 * The verification session is signed out immediately and never returned to the caller.
 * A missing Supabase URL or anon key is `unavailable`, not `wrong_password` — the route
 * answers 503 so an operator sees a configuration fault instead of a bad password.
 */
export type ReauthResult = 'ok' | 'wrong_password' | 'unavailable';

export async function reauthenticate(
  email: string | null,
  password: string,
): Promise<ReauthResult> {
  if (!email || !password) return 'wrong_password';

  const url =
    privateEnv.SUPABASE_URL ||
    publicEnv.PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;
  const anonKey =
    privateEnv.SUPABASE_ANON_KEY ||
    publicEnv.PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return 'unavailable';

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return 'wrong_password';

  try {
    await client.auth.signOut();
  } catch {
    // The verification session is short-lived and never leaves this function; failing to
    // revoke it does not make the password check wrong.
  }

  return 'ok';
}
