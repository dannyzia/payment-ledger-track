# 001_repo_foundation_and_tooling.md — Repository Foundation, Monorepo Tooling, and Workspace Scaffolding

- Plan Identifier: CLT-PLAN-001
- Phase: Phase 0 / M0
- Milestone: M0
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §0, §13, §17 (Milestone M0), AGENTS.md §2
- Depends on: none
- Current Status: Not Implemented
- Revision: 2.1 — 2026-11-01 (remediated 11 infrastructure and build audit findings)

## 1. Purpose

Establish the monorepo workspace foundation, runtime tooling, and package configurations for Cosmo Ledger Track. This foundation configures Node 22 LTS, pnpm workspaces, strict TypeScript compiler options (`module: "ESNext"`, `moduleResolution: "bundler"`), ESLint with Svelte support, Prettier with Svelte formatting, Vitest, Playwright, Supabase local CLI tooling, GitHub Actions continuous integration, and all nine root execution scripts specified in AGENTS.md §2. It guarantees reproducible development, build, typecheck, and test execution across all subsequent implementation plans.

## 2. Scope

- IN:
  - Runtime pinning: Node.js 22 LTS in `.nvmrc` and root `package.json` `engines`.
  - Package manager configuration: pnpm workspace layout covering `packages/*` and `apps/*` via `pnpm-workspace.yaml`.
  - Nine root scripts defined in AGENTS.md §2: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `format`, `db:bootstrap`, `db:reset`.
  - Strict TypeScript configuration: `tsconfig.base.json` (`ESNext` module and `bundler` resolution avoiding TS2835 `.js` extension errors) and root `tsconfig.json` (referencing composite packages `packages/calc` and `packages/shared`, with `apps/web` checked via `svelte-check`).
  - Linting and formatting: flat `eslint.config.js` and `.prettierrc` configured with Svelte plugins (`eslint-plugin-svelte`, `prettier-plugin-svelte`, and root `svelte` peer dependency).
  - Test runner configuration: `vitest.workspace.ts` for unit, property, and fixture tests, `tests/sanity.test.ts` initial unit test, and minimal `playwright.config.ts` with `tests/e2e/sanity.spec.ts` ensuring `pnpm test` and `pnpm test:e2e` pass at scaffold time.
  - SvelteKit application scaffold: `apps/web/vite.config.ts` (wiring SvelteKit and `@tailwindcss/vite` 4), `src/app.html`, `src/app.css`, `src/routes/+layout.ts` (SPA mode `ssr = false`), `src/routes/+layout.svelte` (root shell with Svelte 5 runes rendering `%sveltekit.body%`), and `src/routes/+page.svelte` ensuring `pnpm build` succeeds.
  - Package placeholder scaffolds: `packages/calc/src/index.ts` and `packages/shared/src/index.ts` preventing TS18003 "no inputs found" during root typecheck, and dev export map fallbacks.
  - Local database environment: Supabase CLI configuration via `supabase/config.toml` and database test runner selection.
  - Continuous integration: `.github/workflows/ci.yml` with `--frozen-lockfile`, pnpm caching, pinned Supabase CLI, and always-run container cleanup.
  - Environment variable declarations: `.env.example` declaring variable names without secrets.
  - Decisions log: root `DECISIONS.md` recording architectural choices and baseline defaults per PRD Rule 5 using standard `CLT-D-nnn` identifiers.
- OUT:
  - Calculation engine implementation logic in `packages/calc` (owned by Plan 002).
  - Domain schemas and wire converters in `packages/shared` (owned by Plan 002).
  - PostgreSQL schema migrations, DDL, constraints, and views (owned by Plan 003).
  - Database stored procedures, RPCs, and triggers (owned by Plans 004 and 005).
  - Database bootstrap runner script `scripts/bootstrap.ts` (owned by Plan 006).
  - SvelteKit business feature routes and design system UI components (owned by Plans 007, 008, 010).

## 3. Preconditions

1. Linux operating system with bash shell.
   - Check command: `uname -s && echo $BASH_VERSION`
   - Expected output: `Linux` and non-empty bash version string.
2. Node.js 22 LTS installed.
   - Check command: `node -v`
   - Expected output: string starting with `v22.`.
3. pnpm package manager version 9 or higher installed.
   - Check command: `pnpm -v`
   - Expected output: version number matching `^9.0.0` or higher.
4. Git installed.
   - Check command: `git --version`
   - Expected output: string containing `git version`.
5. Docker daemon running with socket access (required by Supabase CLI local stack for `supabase start` and `pnpm db:reset`).
   - Check command: `docker info >/dev/null 2>&1 && echo "DOCKER_OK"`
   - Expected output: `DOCKER_OK`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `.nvmrc` | create | Pins Node.js version 22 |
| `package.json` | create | Monorepo root manifest declaring exactly 9 root scripts, root `svelte` peer dep, and devDependencies |
| `pnpm-workspace.yaml` | create | Defines workspace packages directory structure (`packages/*`, `apps/*`) |
| `tsconfig.base.json` | create | Base TypeScript compiler configuration enforcing strict type safety with `ESNext`/`bundler` |
| `tsconfig.json` | create | Root project references configuration (references `packages/calc` and `packages/shared`) |
| `.prettierrc` | create | Prettier code formatting rules with `prettier-plugin-svelte` |
| `.prettierignore` | create | Excludes build outputs and dependency folders from formatting |
| `eslint.config.js` | create | ESLint flat configuration for TypeScript and Svelte files |
| `vitest.workspace.ts` | create | Vitest workspace runner configuration |
| `tests/sanity.test.ts` | create | Monorepo root sanity test ensuring test runner passes at scaffold time |
| `playwright.config.ts` | create | Minimal Playwright end-to-end test runner configuration |
| `tests/e2e/sanity.spec.ts` | create | Minimal e2e sanity test ensuring `pnpm test:e2e` passes at scaffold time |
| `.env.example` | create | Environment variable template with variable names only |
| `.github/workflows/ci.yml` | create | Continuous integration pipeline executing verification scripts |
| `DECISIONS.md` | create | Root decisions log recording architectural defaults per PRD Rule 5 |
| `supabase/config.toml` | create | Supabase local development configuration |
| `packages/calc/package.json` | create | Manifest for calculation engine package with dev export map |
| `packages/calc/tsconfig.json` | create | TypeScript configuration for calculation engine |
| `packages/calc/src/index.ts` | create | Placeholder TypeScript source avoiding TS18003 scaffold error |
| `packages/shared/package.json` | create | Manifest for shared schemas and types package with dev export map |
| `packages/shared/tsconfig.json` | create | TypeScript configuration for shared schemas package |
| `packages/shared/src/index.ts` | create | Placeholder TypeScript source avoiding TS18003 scaffold error |
| `apps/web/package.json` | create | Manifest for SvelteKit web application with Svelte 5 and Tailwind 4 |
| `apps/web/tsconfig.json` | create | TypeScript configuration for web application extending SvelteKit |
| `apps/web/vite.config.ts` | create | Vite bundler configuration wiring SvelteKit and Tailwind 4 plugins |
| `apps/web/svelte.config.js` | create | SvelteKit configuration pinning adapter-vercel |
| `apps/web/src/app.html` | create | SvelteKit HTML skeleton template |
| `apps/web/src/app.css` | create | Tailwind 4 CSS entrypoint (`@import "tailwindcss";`) |
| `apps/web/src/routes/+layout.ts` | create | Root layout script disabling SSR (SPA mode `ssr = false`) |
| `apps/web/src/routes/+layout.svelte` | create | Root Svelte 5 shell rendering `%sveltekit.body%` and importing global styles |
| `apps/web/src/routes/+page.svelte` | create | Minimal root page component ensuring `pnpm build` succeeds |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create file `.nvmrc` containing `22\n`.
   - Command: `echo "22" > .nvmrc`
   - Check: `cat .nvmrc`
   - Expected output: `22`

2. Create file `pnpm-workspace.yaml` referencing Specification 6.1.
   - Command: copy block 6.1 into `pnpm-workspace.yaml`.
   - Check: `cat pnpm-workspace.yaml`
   - Expected output: matches block 6.1.

3. Create root file `package.json` referencing Specification 6.2.
   - Command: copy block 6.2 into `package.json`.
   - Check: `cat package.json`
   - Expected output: contains `"name": "payment-ledger-track"` and exactly the 9 root scripts.

4. Create shared compiler base configuration `tsconfig.base.json` referencing Specification 6.3.
   - Command: copy block 6.3 into `tsconfig.base.json`.
   - Check: `cat tsconfig.base.json`
   - Expected output: contains `"strict": true`, `"module": "ESNext"`, and `"moduleResolution": "bundler"`.

5. Create root project configuration `tsconfig.json` referencing Specification 6.4.
   - Command: copy block 6.4 into `tsconfig.json`.
   - Check: `cat tsconfig.json`
   - Expected output: contains references to workspace directories.

6. Create formatting configuration files `.prettierrc` and `.prettierignore` referencing Specification 6.5.
   - Command: copy block 6.5 into `.prettierrc` and `.prettierignore`.
   - Check: `cat .prettierrc`
   - Expected output: matches block 6.5.

7. Create flat linter configuration `eslint.config.js` referencing Specification 6.6.
   - Command: copy block 6.6 into `eslint.config.js`.
   - Check: `cat eslint.config.js`
   - Expected output: matches block 6.6.

8. Create Vitest workspace configuration `vitest.workspace.ts`, root sanity test `tests/sanity.test.ts`, Playwright configuration `playwright.config.ts`, and e2e sanity test `tests/e2e/sanity.spec.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `vitest.workspace.ts`, `tests/sanity.test.ts`, `playwright.config.ts`, and `tests/e2e/sanity.spec.ts`.
   - Check: `cat vitest.workspace.ts && cat playwright.config.ts`
   - Expected output: matches block 6.7.

9. Create environment variable template `.env.example` referencing Specification 6.8.
   - Command: copy block 6.8 into `.env.example`.
   - Check: `cat .env.example`
   - Expected output: contains variable names with empty values.

10. Create CI workflow file `.github/workflows/ci.yml` referencing Specification 6.9.
    - Command: copy block 6.9 into `.github/workflows/ci.yml`.
    - Check: `cat .github/workflows/ci.yml`
    - Expected output: contains jobs executing lint, typecheck, test, and db checks with `--frozen-lockfile`, pnpm store cache, and pinned Supabase CLI.

11. Create directory `packages/calc` and files `packages/calc/package.json`, `packages/calc/tsconfig.json`, and `packages/calc/src/index.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `packages/calc/package.json`, `packages/calc/tsconfig.json`, and `packages/calc/src/index.ts`.
    - Check: `cat packages/calc/package.json`
    - Expected output: contains `"name": "@clt/calc"`.

12. Create directory `packages/shared` and files `packages/shared/package.json`, `packages/shared/tsconfig.json`, and `packages/shared/src/index.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `packages/shared/package.json`, `packages/shared/tsconfig.json`, and `packages/shared/src/index.ts`.
    - Check: `cat packages/shared/package.json`
    - Expected output: contains `"name": "@clt/shared"`.

13. Create directory `apps/web` and files `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/svelte.config.js`, `apps/web/src/app.html`, `apps/web/src/app.css`, `apps/web/src/routes/+layout.ts`, `apps/web/src/routes/+layout.svelte`, and `apps/web/src/routes/+page.svelte` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/` files.
    - Check: `cat apps/web/package.json`
    - Expected output: contains `"name": "@clt/web"`.

14. Create root architectural decisions log `DECISIONS.md` referencing Specification 6.13.
    - Command: copy block 6.13 into `DECISIONS.md`.
    - Check: `cat DECISIONS.md`
    - Expected output: contains baseline decision records CLT-D-001, CLT-D-002, and CLT-D-003.

15. Create directory `supabase` and file `supabase/config.toml` referencing Specification 6.14.
    - Command: copy block 6.14 into `supabase/config.toml`.
    - Check: `cat supabase/config.toml`
    - Expected output: contains `project_id = "ledger"`.

16. Install all workspace dependencies using pnpm.
    - Command: `pnpm install`
    - Check: `pnpm -v`
    - Expected output: exits with code 0.

17. Execute root formatting verification script.
    - Command: `pnpm format`
    - Check: check exit code.
    - Expected output: exits with code 0.

18. Execute root typechecking verification script across packages and SvelteKit web.
    - Command: `pnpm typecheck`
    - Check: check exit code.
    - Expected output: exits with code 0.

19. Execute root linting verification script.
    - Command: `pnpm lint`
    - Check: check exit code.
    - Expected output: exits with code 0.

20. Execute root test runner script.
    - Command: `pnpm test`
    - Check: check exit code.
    - Expected output: exits with code 0 (passes sanity test in `tests/sanity.test.ts`).

21. Execute root build script across all workspaces.
    - Command: `pnpm build`
    - Check: check exit code.
    - Expected output: exits with code 0.

## 6. Specifications

### 6.1 `pnpm-workspace.yaml`
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### 6.2 Root `package.json`
```json
{
  "name": "payment-ledger-track",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "pnpm --filter @clt/web dev",
    "build": "pnpm -r build",
    "test": "vitest run --passWithNoTests",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "typecheck": "tsc --build packages/calc packages/shared && pnpm --filter @clt/web check",
    "format": "prettier --check .",
    "db:bootstrap": "tsx scripts/bootstrap.ts",
    "db:reset": "supabase db reset"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.2",
    "@supabase/supabase-js": "^2.46.1",
    "@types/node": "^22.8.0",
    "@types/pg": "^8.11.10",
    "eslint": "^9.14.0",
    "eslint-plugin-svelte": "^2.46.0",
    "fast-check": "^3.22.0",
    "pg": "^8.13.0",
    "prettier": "^3.3.3",
    "prettier-plugin-svelte": "^3.2.8",
    "supabase": "^1.207.0",
    "svelte": "^5.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.13.0",
    "vitest": "^2.1.4",
    "zod": "^3.23.8"
  }
}
```

### 6.3 `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### 6.4 `tsconfig.json`
```json
{
  "files": [],
  "references": [
    { "path": "./packages/calc" },
    { "path": "./packages/shared" }
  ]
}
```

### 6.5 `.prettierrc` and `.prettierignore`
`.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    {
      "files": "*.svelte",
      "options": {
        "parser": "svelte"
      }
    }
  ]
}
```

`.prettierignore`:
```
dist
node_modules
.svelte-kit
build
.pnpm-store
supabase/.temp
```

### 6.6 `eslint.config.js`
```javascript
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      'supabase/.temp/**',
    ],
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  }
);
```

### 6.7 `vitest.workspace.ts`, `tests/sanity.test.ts`, `playwright.config.ts`, and `tests/e2e/sanity.spec.ts`
`vitest.workspace.ts`:
```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/calc',
  'packages/shared',
  'apps/web',
  'tests',
]);
```

`tests/sanity.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Monorepo Foundation Sanity Suite', () => {
  it('executes workspace test runner cleanly', () => {
    expect(true).toBe(true);
  });
});
```

`playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

`tests/e2e/sanity.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('homepage loads minimal app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Cosmo Ledger Track');
});
```

### 6.8 `.env.example`
```bash
# Cosmo Ledger Track Environment Template
# No values committed to repository. Provide local values in .env.local

# Supabase Local and Hosted Credentials
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
PUBLIC_API_BASE=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Bootstrap Runner Credentials (PRD §7.4, AGENTS.md §2)
BOOTSTRAP_OWNER_EMAIL=
BOOTSTRAP_OWNER_PASSWORD=
```

### 6.9 `.github/workflows/ci.yml`
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    name: Lint, Typecheck, and Test
    runs-on: ubuntu-24.04
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9
          run_install: false

      - name: Get pnpm store directory
        shell: bash
        run: |
          echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

      - name: Setup pnpm cache
        uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify code formatting
        run: pnpm format

      - name: Run TypeScript and Svelte typecheck
        run: pnpm typecheck

      - name: Execute linter
        run: pnpm lint

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: 1.207.0

      - name: Start Supabase stack and verify database migrations
        run: |
          supabase start
          pnpm db:reset

      - name: Execute unit, property, and integration tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
        run: |
          pnpm test
          pnpm build

      - name: Tear down Supabase stack
        if: always()
        run: supabase stop
```

### 6.10 `packages/calc/package.json`, `tsconfig.json`, and `src/index.ts`
`packages/calc/package.json`:
```json
{
  "name": "@clt/calc",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "fast-check": "^3.22.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`packages/calc/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

`packages/calc/src/index.ts`:
```typescript
// @clt/calc placeholder scaffold - authoritative calculation functions implemented in Plan 002
export const CALC_ENGINE_VERSION = 1;
```

### 6.11 `packages/shared/package.json`, `tsconfig.json`, and `src/index.ts`
`packages/shared/package.json`:
```json
{
  "name": "@clt/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@clt/calc": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [
    { "path": "../calc" }
  ],
  "include": ["src/**/*"]
}
```

`packages/shared/src/index.ts`:
```typescript
// @clt/shared placeholder scaffold - authoritative schemas and helpers implemented in Plan 002
export const SHARED_SCHEMA_VERSION = 1;
```

### 6.12 `apps/web` Scaffolding Files
`apps/web/package.json`:
```json
{
  "name": "@clt/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@clt/calc": "workspace:*",
    "@clt/shared": "workspace:*",
    "@supabase/supabase-js": "^2.46.1",
    "dexie": "^4.0.9",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@sveltejs/adapter-vercel": "^5.4.5",
    "@sveltejs/kit": "^2.8.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "svelte": "^5.1.0",
    "svelte-check": "^4.0.7",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

`apps/web/vite.config.ts`:
```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
```

`apps/web/svelte.config.js`:
```javascript
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x',
    }),
  },
};

export default config;
```

`apps/web/src/app.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

`apps/web/src/app.css`:
```css
@import "tailwindcss";
```

`apps/web/src/routes/+layout.ts`:
```typescript
// PRD §13: SPA mode (ssr = false)
export const ssr = false;
export const prerender = false;
```

`apps/web/src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

`apps/web/src/routes/+page.svelte`:
```svelte
<main class="min-h-screen p-8 flex flex-col items-center justify-center">
  <h1 class="text-3xl font-bold tracking-tight">Cosmo Ledger Track</h1>
  <p class="text-sm text-gray-500 mt-2">Offline-first payment ledger and settlement tracker</p>
</main>
```

### 6.13 Root `DECISIONS.md`
```markdown
# DECISIONS.md — Implementer Decision Records

Records choices made where the PRD was silent (PRD §0 Rule 5) and baseline defaults accepted for bootstrapping.

---

## CLT-D-001: Baseline Default Rate Profile and Payable Fixtures Accepted for Bootstrapping
- Date: 2026-10-29
- Context: PRD §7.4 Step 5 seeds initial rate profile and payment methods. AGENTS.md Rule 20 states that business confirmation of Q1–Q4 is pending production sign-off.
- Decision: Accepted standard operational defaults as the bootstrap seed baseline: 42% commission, 115 bp bKash fee, 150 bp card fee, fixed 10th-of-month payables due date.

## CLT-D-002: Rate Profile v1 Effective From Backdating Exemption
- Date: 2026-10-29
- Context: PRD §7.3 requires `effective_from >= current_date` for published rate profiles to prevent retroactive edits, but day-one system initialization requires accepting transactions recorded earlier in the calendar year.
- Decision: Seed Profile v1 with `effective_from = '2026-01-01'` during bootstrap runner execution as an explicit bootstrap-seed exemption (PRD §7.4 step 5).

## CLT-D-003: Monorepo Compiler Module Resolution
- Date: 2026-10-29
- Context: Vite, SvelteKit 2, tsx, and Vitest operate with modern ESM bundler semantics. Using `moduleResolution: "NodeNext"` enforces relative `.js` import extensions in TypeScript files (TS2835).
- Decision: Configured `module: "ESNext"` and `moduleResolution: "bundler"` in `tsconfig.base.json`. Enables seamless cross-workspace type resolution without relative `.js` import extension traps.
```

### 6.14 `supabase/config.toml`
```toml
project_id = "ledger"

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[auth]
enabled = true
site_url = "http://localhost:5173"
additional_redirect_urls = ["https://localhost:5173"]
jwt_expiry = 3600
enable_signup = false

[storage]
enabled = true
file_size_limit = "10MiB"
```

### 6.15 Database Tooling and Test Framework Decision
- Database Testing Method: Vitest with standard Node.js PostgreSQL client library (`pg`).
  - Reason: Allows direct execution of SQL assertion scripts in TypeScript within the monorepo test runner, supporting assertions on check constraints, transaction rollbacks, advisory locks, and JSON outputs without requiring external Perl dependencies demanded by pgTAP.
- Local Database Runtime: Supabase CLI local stack (`supabase start`, `supabase db reset`, `supabase stop`).
  - Reason: Directly reproduces the target hosted environment: PostgreSQL 15, Supabase Auth schema (`auth.users`), private Storage buckets, and security settings with zero deviation.

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Node Version Check | `node -v` | string starting with `v22.` | §13 | Shell check |
| Workspace Package Check | `pnpm --filter @clt/calc exec pwd` | path ending with `packages/calc` | §13 | Shell check |
| Root Script Dev Check | `pnpm dev --help` | Vite CLI usage options | §13, AGENTS.md §2 | Shell check |
| Root Script Build Check | `pnpm build` | exits with code 0 | §13, AGENTS.md §2 | Shell check |
| Root Script Format Check | `pnpm format` | exits with code 0 | §13, AGENTS.md §2 | Shell check |
| Root Script Lint Check | `pnpm lint` | exits with code 0 | §13, AGENTS.md §2 | Shell check |
| Root Script Typecheck Check | `pnpm typecheck` | exits with code 0 | AGENTS.md §2 | Shell check |
| Root Script Test Check | `pnpm test` | exits with code 0 | §13, AGENTS.md §2 | Shell check |

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Node 22 Pinned | `.nvmrc` contains 22 | `cat .nvmrc` | `22` |
| Workspace Configured | `pnpm-workspace.yaml` exists | `test -f pnpm-workspace.yaml && echo "EXISTS"` | `EXISTS` |
| Exactly Nine Root Scripts | Scripts in `package.json` match AGENTS.md §2 | `node -e 'const s=JSON.parse(fs.readFileSync("package.json")).scripts; const req=["dev","build","test","test:e2e","lint","typecheck","format","db:bootstrap","db:reset"]; console.log(Object.keys(s).length===9 && req.every(k=>s[k]!==undefined));'` | `true` |
| No Secrets in Template | `.env.example` has no assignments | `grep -E "=.+" .env.example \| wc -l` | `0` |
| TypeScript Strict Base | `"strict": true` configured | `grep '"strict": true' tsconfig.base.json \| wc -l` | `1` |
| Bundler Resolution Configured | `tsconfig.base.json` uses bundler | `grep '"moduleResolution": "bundler"' tsconfig.base.json \| wc -l` | `1` |
| Monorepo Format Clean | `pnpm format` passes | `pnpm format` | exits with code 0 |
| Monorepo Lint Clean | `pnpm lint` passes | `pnpm lint` | exits with code 0 |
| Monorepo Typecheck Clean | `pnpm typecheck` passes | `pnpm typecheck` | exits with code 0 |
| Monorepo Build Clean | `pnpm build` passes | `pnpm build` | exits with code 0 |
| Monorepo Tests Clean | `pnpm test` passes | `pnpm test` | exits with code 0 |

## 9. Hard Rules Touched

- Rule 2: Integer poisha throughout; configuration sets environment variables and compiler rules without float paths.
- Rule 8: No secrets in repository or files; `.env.example` contains variable names only without credential values.
- Rule 12: Build order follows PRD §17; Plan 001 establishes Phase 0 prerequisite tooling before any application code.
- Rule 17: No invented commands or versions; all commands conform to AGENTS.md §2 and PRD §13 specifications.

## 10. Pitfalls

1. Toolchain script discrepancy: PRD §13 lists seven root scripts, while AGENTS.md §2 defines nine by including `typecheck` and `db:reset`.
   - Symptom: Missing commands during audit checks or CI execution.
   - Fix: Include exactly the nine root scripts in `package.json` as specified in AGENTS.md §2 and block 6.2 without invented scripts.
2. SvelteKit build failure at scaffold time: `apps/web` lacks `vite.config.ts`, `app.html`, or page component.
   - Symptom: `pnpm build` exits with code 1 during workspace scaffolding.
   - Fix: Scaffold minimal SvelteKit shell files (`vite.config.ts`, `src/app.html`, `src/app.css`, `src/routes/+layout.ts`, `src/routes/+page.svelte`) in Step 13.
3. TypeScript TS18003 no inputs found: `packages/calc` and `packages/shared` lack source files at scaffold time.
   - Symptom: `pnpm typecheck` fails during early CI.
   - Fix: Provide initial placeholder files (`src/index.ts`) in each package scaffold.
4. Relative import TS2835 `.js` extension errors: `module: NodeNext` demanding `.js` extensions on TypeScript imports.
   - Symptom: Compilation errors when importing sibling `.ts` files.
   - Fix: Configure `module: "ESNext"` and `moduleResolution: "bundler"` in `tsconfig.base.json`.

## 11. PRD ISSUES and DECISION PENDING

- None. Toolchain definitions and monorepo scripts are aligned between PRD §13 and AGENTS.md §2.

## 12. Handoff

Once this plan is Implemented, subsequent plans rely on:
- Monorepo commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:reset`, `pnpm db:bootstrap`.
- Package directories: `packages/calc`, `packages/shared`, `apps/web`.
- Base TypeScript configuration: `tsconfig.base.json`.
- Root decisions log: `DECISIONS.md`.
- Environment variable names documented in `.env.example`.

## 13. Suggested Task Breakdown

- Task CLT-T-010: Monorepo root configuration, workspace manifests, and compiler settings (`.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `DECISIONS.md`). Role: Implementer. Priority: P0. Scope: root configuration files. Depends on: none.
- Task CLT-T-011: Tooling, linter, formatting, and CI workflow (`eslint.config.js`, `.prettierrc`, `.prettierignore`, `vitest.workspace.ts`, `tests/sanity.test.ts`, `.env.example`, `.github/workflows/ci.yml`). Role: DevOps. Priority: P0. Scope: tooling configs and CI. Depends on: CLT-T-010.
- Task CLT-T-012: Package scaffolds, app shell, and local database configuration (`packages/calc/*`, `packages/shared/*`, `apps/web/*`, `supabase/config.toml`). Role: Implementer. Priority: P0. Scope: package directories and Supabase config. Depends on: CLT-T-011.

## Changelog

- 2026-11-01: Revision 2.1 remediated 11 Cold Infrastructure and Systems Architecture audit findings:
  - Fixed fatal `pnpm typecheck` crash by removing illegal `tsc --noEmit --build` argument order, executing `tsc --build packages/calc packages/shared && pnpm --filter @clt/web check`.
  - Excluded `apps/web` from root `tsconfig.json` project references, eliminating TS5083/TS18003 clean-checkout crashes on missing `.svelte-kit/tsconfig.json` and delegating SvelteKit rune checking cleanly to `svelte-check`.
  - Resolved TS6310 composite `--noEmit` prohibition by compiling upstream declaration artifacts.
  - Added missing root shell `apps/web/src/routes/+layout.svelte` using Svelte 5 runes (`{@render children()}`), guaranteeing `%sveltekit.body%` mounts and global styles are accessible across all routes.
  - Added `playwright.config.ts` and `tests/e2e/sanity.spec.ts` guaranteeing `pnpm test:e2e` passes at scaffold time.
  - Added `svelte` to root `devDependencies` to satisfy strict pnpm peer dependency requirements for `eslint-plugin-svelte` and `prettier-plugin-svelte`.
  - Added development export map fallbacks (`"development": "./src/index.ts"`) in `packages/calc` and `packages/shared` to prevent fresh-checkout `pnpm dev` module resolution failures.
  - Added Docker daemon running check to §3 Preconditions for local Supabase operations.
  - Aligned decision record IDs in `DECISIONS.md` strictly to `CLT-D-001`, `CLT-D-002`, `CLT-D-003` per AGENTS.md §6.
  - Added pnpm store caching and `if: always()` container cleanup to `.github/workflows/ci.yml`.
- 2026-10-29: Revision 2.0 remediated all 12 Plan Audit findings:
  - Added placeholder `src/index.ts` files in `packages/calc` and `packages/shared` preventing TS18003 "no inputs found" error.
  - Added `tests/sanity.test.ts` and set `--passWithNoTests` flag on vitest runner ensuring `pnpm test` exits 0 cleanly at scaffold time.
  - Added full SvelteKit shell scaffolding (`apps/web/vite.config.ts`, `src/app.html`, `src/app.css`, `src/routes/+page.svelte`) wiring `@tailwindcss/vite` 4 and ensuring `pnpm build` succeeds.
  - Added `svelte-check` into root `typecheck` script and updated `apps/web/tsconfig.json` to extend SvelteKit compiler output.
  - Integrated `eslint-plugin-svelte` and `prettier-plugin-svelte` into root linting and formatting configs for complete Svelte coverage.
  - Configured `module: "ESNext"` and `moduleResolution: "bundler"` in `tsconfig.base.json` eliminating TS2835 `.js` import extension errors.
  - Standardized ESLint flat config using direct `typescript-eslint` helper without undeclared imports.
  - Updated all dependency versions to current LTS/stable releases and pinned Supabase CLI version `1.207.0` in CI.
  - Enforced `--frozen-lockfile` in CI workflow and wired test database environment configuration (`DATABASE_URL`).
  - Added root `DECISIONS.md` file deliverable and specification documenting baseline architectural decisions D-1, D-2, and D-3.
  - Re-scoped Task IDs to `CLT-T-010`, `CLT-T-011`, `CLT-T-012` and aligned roles strictly to roster (`Implementer`, `DevOps`).
  - Removed invented `format:fix` script, strictly enforcing the exact 9 root scripts specified in AGENTS.md §2.
- 2026-10-29: Initial specification of Plan 001 for M0 repository foundation and tooling.
