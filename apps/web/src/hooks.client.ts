// apps/web/src/hooks.client.ts
export { handleClientGuard, type GuardNavigationEvent } from '$lib/auth/guard';

import { Capacitor } from '@capacitor/core';

// Intercept /api/v1/* calls in native Capacitor Android WebViews (PRD §13):
// the WebView origin is https://localhost, so relative API paths would hit the
// device itself unless rewritten to the remote backend base URL. Read via
// import.meta.env (dynamic object) so the base can be injected at build time
// for native packaging without a svelte-kit sync dependency on .env contents.
const rawBase = ((import.meta.env.PUBLIC_API_BASE as string | undefined) || '').replace(/\/+$/, '');

if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Check native platform at request time to prevent bridge initialization races
    if (rawBase && Capacitor.isNativePlatform()) {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (parsed.pathname.startsWith('/api/v1/')) {
          const targetUrl = `${rawBase}${parsed.pathname}${parsed.search}`;
          if (input instanceof Request) {
            input = new Request(targetUrl, input);
          } else {
            input = targetUrl;
          }
        }
      } catch {
        // Fallback to original fetch if URL parsing fails
      }
    }

    return originalFetch(input, init);
  };
}
