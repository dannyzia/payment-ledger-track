import type { Plugin } from 'vite';

/**
 * Dev-only service worker so an installed app shell survives a reload with no
 * network. Production precaching is owned by @vite-pwa/sveltekit; this plugin
 * only runs under `vite dev` (`apply: 'serve'`) and never reaches a build.
 *
 * Network-first, cache-as-fallback: online dev keeps serving fresh modules, so
 * HMR is unaffected. The cache name carries a per-server-start stamp, so every
 * `vite dev` restart installs a fresh worker and the previous cache is dropped
 * rather than pinning stale code.
 */
const WORKER_PATH = '/dev-offline-sw.js';

const WORKER_SOURCE = (stamp: number) => `
const CACHE = 'clt-dev-offline-${stamp}';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(['/']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('clt-dev-offline-') && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Mutating and cross-origin traffic is never intercepted (Hard Rule 6):
  // /api/* and every Supabase call must fail loudly when offline.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      // Deep links reload through the SPA shell; the router resolves the path.
      if (request.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
`;

export function devOfflineShell(): Plugin {
  const stamp = Date.now();
  return {
    name: 'clt-dev-offline-shell',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== WORKER_PATH) return next();
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-store');
        // Allow the worker at the root scope it is registered under.
        res.setHeader('Service-Worker-Allowed', '/');
        res.end(WORKER_SOURCE(stamp));
      });
    },
  };
}
