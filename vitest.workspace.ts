import { defineWorkspace } from 'vitest/config';

// Playwright e2e specs live in tests/e2e and are run by `pnpm test:e2e` only.
// Vitest collects *.test.ts files across workspaces, never Playwright .spec.ts files.
export default defineWorkspace([
  'packages/calc',
  'packages/shared',
  'apps/web',
  {
    test: {
      name: 'root-tests',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/e2e/**'],
    },
  },
]);
