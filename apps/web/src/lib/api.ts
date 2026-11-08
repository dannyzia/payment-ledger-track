import { supabase } from '$lib/supabase/client';
import { getOrGenerateDeviceId } from '$lib/auth/device';

// Read via import.meta.env so Vitest can inject PUBLIC_API_BASE at runtime
// (tests); SvelteKit's vite build resolves it identically from .env / build env.
export function getApiBaseUrl(): string {
  return ((import.meta.env.PUBLIC_API_BASE as string | undefined) || '').replace(/\/+$/, '');
}

export function resolveApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Native build API helper (PRD §13): rewrites relative `/api/v1/*` paths onto
 * `PUBLIC_API_BASE`, then attaches the Supabase bearer session, and the
 * mandatory `X-Device-Id` identity header (PRD §9.1, Hard Rule 9).
 */
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.startsWith('/api/v1/')) {
    url = resolveApiUrl(url);
  }

  const headers = new Headers(init?.headers || {});

  // Attach X-Device-Id header
  if (!headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', getOrGenerateDeviceId());
  }

  // Attach bearer token if authenticated
  if (!headers.has('Authorization')) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Fallback if session unreadable
    }
  }

  return fetch(url, { ...init, headers });
}
