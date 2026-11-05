import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: isCapacitor
      ? adapterStatic({
          pages: 'build',
          assets: 'build',
          fallback: 'index.html',
          precompress: false,
          // strict: false: server API routes (+server.ts) are ignored, not errors,
          // in the native static build. Never move or delete src/routes/api (Plan 019 §10.1).
          strict: false,
        })
      : adapterVercel({
          runtime: 'nodejs22.x',
        }),
    // Service worker registration is owned by @vite-pwa/sveltekit's virtual module
    // (vite-pwa docs: disable Kit's own registration when using pwa virtual modules).
    serviceWorker: {
      register: false,
    },
    // Server-private env (`SUPABASE_SERVICE_ROLE_KEY`, bootstrap owner creds)
    // lives in the untracked root .env/.env.local that db:bootstrap also reads;
    // dev servers are spawned from apps/web, so Vite's envDir points at the
    // monorepo root (apps/web/vite.config.ts `envDir`), never a user's cwd.
  },
};

export default config;
