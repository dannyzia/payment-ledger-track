import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    // Vitest collects web-app unit tests from src only; Playwright specs in tests/e2e
    // are executed separately via `pnpm test:e2e`.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'node',
  },
});
