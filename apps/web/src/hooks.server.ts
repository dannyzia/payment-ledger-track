import type { Handle } from '@sveltejs/kit';

/**
 * CORS for native Capacitor Android WebViews (Plan 019, PRD §13).
 * The WebView origin is `https://localhost` (androidScheme) or `capacitor://localhost`,
 * so browser-initiated fetches to the hosted backend carry that origin header.
 * Only these two origins are recognized; everything else passes through untouched.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const origin = event.request.headers.get('origin');
  const isCapacitorOrigin = origin === 'https://localhost' || origin === 'capacitor://localhost';

  // Handle CORS preflight for native Capacitor WebView
  if (isCapacitorOrigin && event.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-Id',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  // Request correlation id + handler timing (R7).
  const requestId = event.request.headers.get('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  const response = await resolve(event);
  const durationMs = Date.now() - start;
  response.headers.set('x-request-id', requestId);
  if (event.url.pathname.startsWith('/api/')) {
    console.log(
      `[API] ${requestId} ${event.request.method} ${event.url.pathname} -> ${response.status} (${durationMs}ms)`,
    );
  }

  if (isCapacitorOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Device-Id',
    );
    response.headers.set('Vary', 'Origin');
  }

  return response;
};
