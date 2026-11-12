# Task Brief — `CLT-T-078`

- **Task ID:** `CLT-T-078`
- **Role / Owner:** Implementer (`A-IMP-2`)
- **Depends On:** `CLT-T-077r3`
- **Triggered By:** Cleanliness & verification readiness before M2 gate re-certification (`CLT-D-033`): 16 pre-existing uncommitted files in the working tree fail `pnpm format` (`prettier --check .`).
- **Applicable Hard Rules:** Rules 8, 18 (formatting-only pass; zero functional/logic changes; dev DB port `54322` `postgres` untouched).

---

## Allowed SCOPE (Strictly These 17 Files — Do Not Touch Anything Else)

1. `apps/web/src/lib/auth/session.svelte.ts`
2. `apps/web/src/lib/database.types.ts`
3. `apps/web/src/lib/db/index.ts`
4. `apps/web/src/lib/server/auth.ts`
5. `apps/web/src/routes/(app)/admin/super/centers/+page.svelte`
6. `apps/web/src/routes/(app)/admin/super/search/+page.svelte`
7. `apps/web/src/routes/api/v1/admin/settings/+server.ts`
8. `apps/web/src/routes/api/v1/admin/super/centers/[id]/+server.ts`
9. `apps/web/src/routes/api/v1/admin/super/centers/+server.ts`
10. `apps/web/src/routes/api/v1/admin/super/search/+server.ts`
11. `apps/web/src/routes/api/v1/sync/push/+server.ts`
12. `apps/web/tests/e2e/ledger_role_split.spec.ts`
13. `apps/web/tests/e2e/offline_sync.spec.ts`
14. `apps/web/tests/regression/suite.test.ts`
15. `scripts/e2e/test-device-journey.ts`
16. `tests/db/entries_sync.test.ts`
17. `eslint.config.js` *(Scope expansion approved 2026-11-11 to ignore generated Capacitor/Playwright/Supabase dirs aligned with `.prettierignore`)*

---

## Requirements

### R1 — Prettier Formatting Only
- Run `pnpm exec prettier --write` strictly on files #1–#16 above (and `eslint.config.js` if needed after editing).
- Do **not** make any logic, comment, identifier, or behavioral edits to files #1–#16.

### R2 — ESLint Ignores Alignment (`eslint.config.js`)
- In `eslint.config.js` `ignores` array, add generated build/test artifact directories matching `.prettierignore` (`apps/web/android/**`, `apps/web/test-results/**`, `apps/web/playwright-report/**`, `e2e/supabase/.temp/**`, plus root `test-results/**` / `playwright-report/**` if generated).
- Verify `eslint.config.js` still passes `pnpm format`.

---

## Verification Checklist (Must All Run After Final Edit; Never Touch Port 54322 `postgres`)

1. `pnpm format` (`prettier --check .`) -> must exit `0`.
2. `pnpm lint` -> confirm `0` ESLint errors (report exact warning count if any pre-existing warnings exist).
3. `pnpm typecheck` -> must exit `0` (`0` errors, `0` warnings).
4. `git diff --stat` on those 16 files / confirm no files outside SCOPE were touched.
5. Output complete `=== TASK REPORT ===` (`Task: CLT-T-078`, `Status: DONE`) with verbatim outputs.

