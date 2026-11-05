import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x',
    }),
    // Service worker registration is owned by @vite-pwa/sveltekit's virtual module
    // (vite-pwa docs: disable Kit's own registration when using pwa virtual modules).
    serviceWorker: {
      register: false,
    },
  },
};

export default config;
