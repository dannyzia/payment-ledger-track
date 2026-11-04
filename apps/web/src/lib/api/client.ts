import { supabase } from '$lib/supabase/client';

/**
 * Authenticated client-side fetch wrapper for SvelteKit SPA mode.
 * Automatically inspects the local Supabase session and attaches
 * Authorization: Bearer <access_token> header to all API requests.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers = new Headers(init?.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
