# Task Brief: CLT-T-080 — Gate 5 Automated Accessibility & Evidence Hardening (`CLT-R-008`)

| Field | Value |
|---|---|
| Task ID | CLT-T-080 |
| Feature | CLT-F-034 / CLT-R-008 |
| Assigned Agent | A-IMP-2 (Implementer) |
| Audit Status | Initial external builder patch `FAIL` (remediation required) |
| Rules | Hard Rules 8, 11, 16; PRD §14 |

## Context
An initial external builder implementation added `apps/web/tests/e2e/accessibility.spec.ts`, updated `scripts/verify-gates.ts` (`--gate5-only`) and `scripts/e2e/isolated-stack.ts` (`--gate5`), and wrote `docs/orchestration/reports/GATE5_EVIDENCE.json`. Independent Zero-Trust audit (`A-AUD-1`) returned `FAIL` because `pnpm typecheck` fails, dark `.glass` gradient button text falls below WCAG AA `4.5:1`, the accessibility probes do not alpha-composite translucent surfaces or check rendered `.btn-label` stops, and `GATE5_EVIDENCE.json` was labeled `"milestone": "M2"`.

## Scope Files
- `apps/web/src/app.css`
- `apps/web/tests/e2e/accessibility.spec.ts`
- `scripts/verify-gates.ts`
- `scripts/e2e/isolated-stack.ts` (`--gate5` invocation & `no-console` cleanup)

## Required Changes
1. **Fix `pnpm typecheck` error (`apps/web/tests/e2e/accessibility.spec.ts:296`):**
   - Replace `styles.webkitBackdropFilter` with `styles.getPropertyValue('-webkit-backdrop-filter')` so `pnpm typecheck` and `svelte-check` pass with 0 errors.
2. **Fix dark-theme `.glass` button gradient contrast (`apps/web/src/app.css:205-224`):**
   - Adjust `[data-theme='dark']` `--c2` (and `--c1` if helpful) on `.btn--commission`, `.btn--bkash`, `.btn--visa` (and verify `.btn--vat`, `.btn--mastercard`) so **both** gradient stops meet `>= 4.5:1` contrast against **both** `--surface` AND the composited dark `.glass` surface (`color-mix(in oklab, white 8%, transparent)` over `#0e1116`), while preserving brand hue recognizability.
3. **Upgrade `accessibility.spec.ts` measurements:**
   - Replace raw channel splitting in `toRgb()` so alpha is parsed and composited over resolved `--bg` (and fail clearly on unparseable colour strings).
   - Measure actual composited `.glass` button background vs both `--c1` and `--c2` resolved colour stops for `.btn--commission`, `.btn--vat`, `.btn--bkash`, `.btn--visa`, `.btn--mastercard` in both `light` and `dark` themes (`>= 4.5:1`).
   - In `default motion is present`, also assert baseline `motion.animationSeconds > 1` on the `2s` animated probe so reduced-motion cannot pass vacuously for animations.
   - In `prefers-reduced-transparency: reduce`, fail (`expect(supported).toBe(true)`) instead of silently calling `test.skip(!supported, ...)` so an unsupported automation engine cannot turn green silently.
4. **Fix `scripts/verify-gates.ts` & `isolated-stack.ts`:**
   - When `--gate5-only` is passed without an explicit `--milestone` flag, default `milestoneArg` to `'M5'` (and pass `--milestone M5` from `scripts/e2e/isolated-stack.ts`).
   - Avoid running `accessibility.spec.ts` twice inside `evaluateGate5()` (e.g., pass `--grep-invert "CLT-R-008"` or ignore `accessibility.spec.ts` on the main E2E command so non-a11y E2E runs once and `[accessibility]` runs `accessibility.spec.ts` once), and slice captured evidence cleanly on newline boundaries.
   - Replace `console.log` with `console.info` in `scripts/verify-gates.ts` and `scripts/e2e/isolated-stack.ts` to eliminate `no-console` ESLint warnings.

## Acceptance Criteria
- `pnpm typecheck` exits `0`.
- `pnpm lint` reports `0 errors` and `0 warnings` in the modified scripts/specs.
- Both light and dark `.glass` button stops pass `>= 4.5:1` WCAG AA in `accessibility.spec.ts` without silent skips.
- `GATE5_EVIDENCE.json` regenerated under `"milestone": "M5"` (orchestrator / E2E verification step).

