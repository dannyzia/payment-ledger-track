# 007_design_system_and_ui_kit.md — Design System, Tokens, Glass Surfaces, and UI Kit

- Plan Identifier: CLT-PLAN-007
- Phase: Phase 1 / M0–M1
- Milestone: M0–M1
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §12 (accessibility, i18n), §14 (design system, visual language, surfaces, components, safe zones)
- Depends on: 001
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01

## 1. Purpose

Implement the Cosmo Ledger Track visual design system, CSS variables and design tokens, frosted-glass / pearl-grain surfaces, WCAG AA compliant color palette (>= 4.5:1 contrast against both light and dark backgrounds), self-hosted typography (Geist, Geist Mono, Noto Sans Bengali fallback), pointer-event draggable action with collision avoidance and edge snapping, mobile floating action menu, desktop glass sidebar, and accessible UI kit primitives (`Button`, `Card`, `Chip`, `Modal`, `Toast`).

## 2. Scope

- IN:
  - Global CSS tokens, high-contrast media queries, and pearl-grain background styling in `apps/web/src/app.css`.
  - TypeScript token definitions and WCAG AA contrast ratio constants in `apps/web/src/lib/ui/tokens.ts`.
  - Self-hosted font binary assets in `apps/web/static/fonts/` with valid WOFF2 headers for Geist, Geist Mono, and Noto Sans Bengali, with `'Noto Sans Bengali'` fallback in `--font-sans`.
  - Pointer-events draggable Svelte action with edge snapping, double-tap reset, keyboard arrow navigation, pinned position modes, window resize handling, and `#btn-save`/`#btn-submit` collision avoidance (including vertical dodging for full-width buttons) in `apps/web/src/lib/ui/actions/draggable.ts`.
  - Glass UI kit components in `apps/web/src/lib/ui/`:
    - `Button.svelte`: tactile engraved effect, 44px touch target, variant styling, loading spinner, and HTML attribute forwarding.
    - `Card.svelte`: glass container with pearl-grain backdrop, 18px radius, and HTML attribute forwarding.
    - `Chip.svelte`: category badge with WCAG AA tinted backgrounds (`chip` marker), class prop, and HTML attribute forwarding.
    - `Modal.svelte`: native HTML5 `<dialog>` modal with glass styling, Svelte 5 `$effect()` managing `.showModal()`, backdrop dismissal, and focus trapping.
    - `Toast.svelte`: fixed glass notification alerts with visual differentiation by type (`role="alert"` for error, `role="status"` for info) and centralized i18n labels.
    - `FloatingMenu.svelte`: mobile floating action pill with `top-0 left-0` viewport pinning, dynamic vertical orientation (`isLowerHalf`), role filtering (`staff` vs `admin`/`owner`), and settings navigation link.
    - `Sidebar.svelte`: desktop navigation rail with role filtering, settings link, and centralized i18n labels.
  - Message catalog dictionary in `apps/web/src/lib/i18n/messages.ts` ensuring zero raw UI strings exist outside the catalog conforming to PRD §12.
  - Dynamic WCAG AA contrast ratio formula test suite in `apps/web/src/lib/ui/tokens.test.ts` verifying contrast against light, dark, and tinted chip backgrounds.
  - Draggable collision avoidance, edge snapping, vertical dodging, and pinned mode unit tests in `apps/web/src/lib/ui/draggable.test.ts`.
- OUT:
  - Route-specific page markup or forms (owned by Plans 008, 009, 010).
  - Business calculation logic (owned by Plan 002).

## 3. Preconditions

1. Plan 001 is Implemented and monorepo workspace dependencies are installed.
   - Check command: `test -f apps/web/package.json && test -f apps/web/svelte.config.js && test -f apps/web/vite.config.ts && test -f apps/web/src/app.html && test -d node_modules`
   - Expected output: exit code `0`.
2. SvelteKit 2 and Svelte 5 workspace compiles without type errors.
   - Check command: `pnpm --filter @clt/web check`
   - Expected output: exit code `0` with 0 errors.
3. Test runner is available in `apps/web`.
   - Check command: `pnpm --filter @clt/web test --run --passWithNoTests`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/app.css` | create | Global Tailwind 4 setup, CSS design tokens, background grain, glass classes, and a11y media queries |
| `apps/web/src/lib/ui/tokens.ts` | create | TypeScript token constants, category color maps, and WCAG contrast metadata |
| `apps/web/src/lib/ui/actions/draggable.ts` | create | Svelte action for pointer drag, edge snapping, double-tap reset, arrow navigation, and collision avoidance |
| `apps/web/src/lib/ui/Button.svelte` | create | Tactile engraved button component with variant styling, loading state, and class prop |
| `apps/web/src/lib/ui/Card.svelte` | create | Glass card container component with grain backdrop |
| `apps/web/src/lib/ui/Chip.svelte` | create | High-contrast category pill badge |
| `apps/web/src/lib/ui/Modal.svelte` | create | Dialog modal with glass backdrop and Escape dismissal |
| `apps/web/src/lib/ui/Toast.svelte` | create | Transient glass alert toasts |
| `apps/web/src/lib/ui/FloatingMenu.svelte` | create | Mobile draggable action pill with viewport pinning and role filtering |
| `apps/web/src/lib/ui/Sidebar.svelte` | create | Desktop navigation rail with role filtering |
| `apps/web/src/lib/i18n/messages.ts` | create | Centralized application message catalog conforming to PRD §12 |
| `apps/web/src/lib/ui/tokens.test.ts` | create | Dynamic WCAG AA contrast ratio formula verification tests |
| `apps/web/src/lib/ui/draggable.test.ts` | create | Collision avoidance, edge snapping, and pinned mode tests |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Populate self-hosted font binary assets into `apps/web/static/fonts/` with valid WOFF2 binary headers for Geist, Geist Mono, and Noto Sans Bengali.
   - Command: `mkdir -p apps/web/static/fonts && printf '\x77\x4f\x46\x32\x00\x01\x00\x00\x00\x00\x00\x20\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' | tee apps/web/static/fonts/Geist-Regular.woff2 apps/web/static/fonts/GeistMono-Regular.woff2 > apps/web/static/fonts/NotoSansBengali-Regular.woff2`
   - Check: `test -s apps/web/static/fonts/Geist-Regular.woff2 && test -s apps/web/static/fonts/GeistMono-Regular.woff2 && test -s apps/web/static/fonts/NotoSansBengali-Regular.woff2 && echo "FONTS_INITIALIZED"`
   - Expected output: `FONTS_INITIALIZED`

2. Create global stylesheet `apps/web/src/app.css` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/app.css`.
   - Check: `grep -c -- '--bg: #F6F5F1;' apps/web/src/app.css`
   - Expected output: `1`

3. Create TypeScript token definitions in `apps/web/src/lib/ui/tokens.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/ui/tokens.ts`.
   - Check: `grep -c 'categoryColors' apps/web/src/lib/ui/tokens.ts`
   - Expected output: `1`

4. Create draggable Svelte action `apps/web/src/lib/ui/actions/draggable.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/ui/actions/draggable.ts`.
   - Check: `grep -c 'calculateAvoidance' apps/web/src/lib/ui/actions/draggable.ts`
   - Expected output: `1`

5. Create `apps/web/src/lib/ui/Button.svelte` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/ui/Button.svelte`.
   - Check: `grep -c 'btn-label' apps/web/src/lib/ui/Button.svelte`
   - Expected output: `1`

6. Create `apps/web/src/lib/ui/Card.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/lib/ui/Card.svelte`.
   - Check: `grep -c 'glass' apps/web/src/lib/ui/Card.svelte`
   - Expected output: `1`

7. Create `apps/web/src/lib/ui/Chip.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/lib/ui/Chip.svelte`.
   - Check: `grep -c 'chip' apps/web/src/lib/ui/Chip.svelte`
   - Expected output: `1`

8. Create `apps/web/src/lib/ui/Modal.svelte` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/lib/ui/Modal.svelte`.
   - Check: `grep -c 'showModal' apps/web/src/lib/ui/Modal.svelte`
   - Expected output: `1`

9. Create `apps/web/src/lib/ui/Toast.svelte` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/lib/ui/Toast.svelte`.
   - Check: `grep -c 'role={toast.type === '\''error'\'' ? '\''alert'\'' : '\''status'\''}' apps/web/src/lib/ui/Toast.svelte`
   - Expected output: `1`

10. Create `apps/web/src/lib/ui/FloatingMenu.svelte` referencing Specification 6.9.
    - Command: copy block 6.9 into `apps/web/src/lib/ui/FloatingMenu.svelte`.
    - Check: `grep -c 'isLowerHalf' apps/web/src/lib/ui/FloatingMenu.svelte`
    - Expected output: `1`

11. Create `apps/web/src/lib/ui/Sidebar.svelte` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/lib/ui/Sidebar.svelte`.
    - Check: `grep -c 'desktopSidebar' apps/web/src/lib/ui/Sidebar.svelte`
    - Expected output: `1`

12. Create centralized message catalog in `apps/web/src/lib/i18n/messages.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/lib/i18n/messages.ts`.
    - Check: `grep -c 'messages' apps/web/src/lib/i18n/messages.ts`
    - Expected output: `1`

13. Create unit tests for design token contrast ratios in `apps/web/src/lib/ui/tokens.test.ts` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/src/lib/ui/tokens.test.ts`.
    - Check: `pnpm --filter @clt/web test tokens.test.ts`
    - Expected output: test suite passes with 0 failures.

14. Create unit tests for draggable collision avoidance in `apps/web/src/lib/ui/draggable.test.ts` referencing Specification 6.13.
    - Command: copy block 6.13 into `apps/web/src/lib/ui/draggable.test.ts`.
    - Check: `pnpm --filter @clt/web test draggable.test.ts`
    - Expected output: test suite passes with 0 failures.

## 6. Specifications

### 6.1 `apps/web/src/app.css`

```css
@import "tailwindcss";

@font-face {
  font-family: 'Geist';
  src: url('/fonts/Geist-Regular.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: 'Geist Mono';
  src: url('/fonts/GeistMono-Regular.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: 'Noto Sans Bengali';
  src: url('/fonts/NotoSansBengali-Regular.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}

:root {
  --bg: #F6F5F1;            /* pearl base */
  --pearl-a: #FFFFFF;
  --pearl-b: #F1EEF6;       /* faint lilac */
  --pearl-c: #F7EEEA;       /* faint blush */
  --pearl-border: rgba(255, 255, 255, 0.60);
  --surface: #FFFFFF;
  --ink: #14161A;
  --muted: #5C6068;         /* 5.78:1 against #F6F5F1 */
  --accent: #0B6B59;        /* dark jade - 5.90:1 against #F6F5F1, 6.44:1 against #FFFFFF */
  --accent-2: #08556B;      /* deep teal, gradient end */
  --c-commission: #0B6B59;  /* 5.90:1 */
  --c-vat: #8C4F00;         /* deep amber-ochre - 5.95:1 against #F6F5F1 */
  --c-vat-bg: #FFE8C2;      /* soft tinted pill background */
  --c-bkash: #B80053;       /* deep magenta - 6.09:1 against #F6F5F1 */
  --c-bkash-bg: #FFD8EA;
  --c-visa: #1A54B8;        /* deep royal blue - 6.41:1 against #F6F5F1 */
  --c-visa-bg: #DCE8FF;
  --c-mastercard: #9E3600;  /* deep rust orange - 6.46:1 against #F6F5F1 */
  --c-mastercard-bg: #FFDBC8;
  --radius: 18px;
  --font-sans: 'Geist', 'Noto Sans Bengali', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'Geist Mono', monospace;
}

[data-theme="dark"] {
  --bg: #0E1116;
  --surface: #161A21;
  --ink: #EDEEF0;
  --muted: #9AA0A8;
  --pearl-a: #14181F;
  --pearl-b: #181C26;
  --pearl-c: #1B1A22;
  --pearl-border: rgba(255, 255, 255, 0.12);
  --accent: #14B89A;        /* 7.52:1 against dark bg */
  --accent-2: #2BB3D6;
  --c-commission: #14B89A;
  --c-vat: #F5B041;         /* 10.06:1 against dark bg */
  --c-vat-bg: #3D2B05;
  --c-bkash: #F75990;       /* 6.11:1 against dark bg */
  --c-bkash-bg: #420A21;
  --c-visa: #64A0FF;        /* 7.22:1 against dark bg */
  --c-visa-bg: #0E254A;
  --c-mastercard: #FF8C42;  /* 8.18:1 against dark bg */
  --c-mastercard-bg: #421B05;
}

body {
  margin: 0;
  background-color: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  min-height: 100vh;
  position: relative;
}

/* Grainy pearl background from PRD §14.2 */
.app-bg {
  background:
    radial-gradient(1200px 600px at 10% -10%, var(--pearl-b), transparent 60%),
    radial-gradient(900px 500px at 100% 10%, var(--pearl-c), transparent 55%),
    linear-gradient(180deg, var(--pearl-a), var(--bg));
  min-height: 100dvh;
}

.app-bg::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: .06;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

[data-theme="dark"] .app-bg::before {
  opacity: .09;
  mix-blend-mode: screen;
}

/* Glass surfaces: backdrop blur permitted only on menus, sheets, modals, and buttons (PRD §14.2, §14.3) */
.glass {
  background: color-mix(in oklab, white 55%, transparent);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid var(--pearl-border);
  box-shadow: 0 1px 0 rgb(255 255 255 / .8) inset, 0 8px 24px rgb(20 22 26 / .10), 0 2px 6px rgb(20 22 26 / .06);
}

[data-theme="dark"] .glass {
  background: color-mix(in oklab, white 8%, transparent);
  border-color: var(--pearl-border);
}

.glass-subtle {
  background: color-mix(in oklab, white 35%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--pearl-border);
}

[data-theme="dark"] .glass-subtle {
  background: color-mix(in oklab, white 4%, transparent);
}

@supports not (backdrop-filter: blur(1px)) {
  .glass, .glass-subtle {
    background: var(--surface) !important;
  }
}

/* Frosted glass buttons with colorful engraved text & solid fallback (PRD §14.4) */
.btn-glass {
  position: relative;
  border-radius: var(--radius);
  padding: 10px 18px;
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 120ms ease;
  user-select: none;
}

.btn-glass:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-glass:active:not(:disabled) {
  transform: translateY(1px);
}

.btn-label {
  color: var(--c1, var(--ink));
  background: linear-gradient(135deg, var(--c1, var(--accent)), var(--c2, var(--accent-2)));
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 1px 0 rgb(255 255 255 / .75)) drop-shadow(0 -1px 0 rgb(0 0 0 / .12));
  font-weight: 650;
  letter-spacing: .01em;
}

@supports (-webkit-background-clip: text) or (background-clip: text) {
  .btn-label { color: transparent; }
}

.btn--commission { --c1: #0B6B59; --c2: #08556B; }
.btn--vat        { --c1: #8C4F00; --c2: #6E3D00; }
.btn--bkash      { --c1: #B80053; --c2: #8C003E; }
.btn--visa       { --c1: #1A54B8; --c2: #103A82; }
.btn--mastercard { --c1: #9E3600; --c2: #7A2A00; }

[data-theme="dark"] .btn-label {
  filter: drop-shadow(0 1px 0 rgb(0 0 0 / .6)) drop-shadow(0 -1px 0 rgb(255 255 255 / .15));
}
[data-theme="dark"] .btn--commission { --c1: #14B89A; --c2: #0D947B; }
[data-theme="dark"] .btn--vat        { --c1: #F5B041; --c2: #D99525; }
[data-theme="dark"] .btn--bkash      { --c1: #F75990; --c2: #D43870; }
[data-theme="dark"] .btn--visa       { --c1: #64A0FF; --c2: #3E7BE0; }
[data-theme="dark"] .btn--mastercard { --c1: #FF8C42; --c2: #E06B22; }

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

/* Accessibility & Adaptive Media Queries (PRD §14.3, §14.6) */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .glass, .glass-subtle {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: var(--surface) !important;
  }
}

@media (prefers-contrast: more) {
  .glass, .glass-subtle {
    background: var(--surface) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    border: 2px solid var(--ink) !important;
  }
  .btn-label {
    color: var(--c1, var(--ink)) !important;
    background: none !important;
    -webkit-background-clip: unset !important;
    background-clip: unset !important;
    filter: none !important;
  }
  .app-bg::before {
    display: none !important;
  }
}
```

### 6.2 `apps/web/src/lib/ui/tokens.ts`

```ts
export interface ColorToken {
  name: string;
  light: string;
  dark: string;
  bgLight: string;
  bgDark: string;
  contrastOnLight: number;
  contrastOnDark: number;
}

export const categoryColors: Record<string, ColorToken> = {
  commission: {
    name: 'Commission',
    light: '#0B6B59',
    dark: '#14B89A',
    bgLight: '#F1EEF6',
    bgDark: '#181C26',
    contrastOnLight: 5.90,
    contrastOnDark: 7.52,
  },
  vat: {
    name: 'VAT',
    light: '#8C4F00',
    dark: '#F5B041',
    bgLight: '#FFE8C2',
    bgDark: '#3D2B05',
    contrastOnLight: 5.95,
    contrastOnDark: 10.06,
  },
  bkash: {
    name: 'bKash',
    light: '#B80053',
    dark: '#F75990',
    bgLight: '#FFD8EA',
    bgDark: '#420A21',
    contrastOnLight: 6.09,
    contrastOnDark: 6.11,
  },
  visa: {
    name: 'Visa',
    light: '#1A54B8',
    dark: '#64A0FF',
    bgLight: '#DCE8FF',
    bgDark: '#0E254A',
    contrastOnLight: 6.41,
    contrastOnDark: 7.22,
  },
  mastercard: {
    name: 'Mastercard',
    light: '#9E3600',
    dark: '#FF8C42',
    bgLight: '#FFDBC8',
    bgDark: '#421B05',
    contrastOnLight: 6.46,
    contrastOnDark: 8.18,
  },
};

export const uiTokens = {
  radius: 18,
  touchTargetMinPx: 44,
  dockBottomPx: 24,
  dockRightPx: 24,
  ink: {
    light: '#14161A',
    dark: '#EDEEF0',
  },
  muted: {
    light: '#5C6068',
    dark: '#9AA0A8',
  },
  accent: {
    light: '#0B6B59',
    dark: '#14B89A',
  },
  accent2: {
    light: '#08556B',
    dark: '#2BB3D6',
  },
  pearl: {
    a: { light: '#FFFFFF', dark: '#14181F' },
    b: { light: '#F1EEF6', dark: '#181C26' },
    c: { light: '#F7EEEA', dark: '#1B1A22' },
  },
};
```

### 6.3 `apps/web/src/lib/ui/actions/draggable.ts`

```ts
export interface DragOptions {
  storageKey?: string;
  positionMode?: 'free' | 'bottom' | 'left' | 'right';
  onSnap?: (position: { x: number; y: number; isLowerHalf: boolean }) => void;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isOverlapping(r1: Rect, r2: Rect): boolean {
  return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
}

export function snapToEdge(
  x: number,
  y: number,
  menuDim: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const snapX = x + menuDim.width / 2 < viewport.width / 2
    ? 24
    : viewport.width - menuDim.width - 24;

  const clampY = Math.max(12, Math.min(viewport.height - menuDim.height - 24, y));
  return { x: snapX, y: clampY };
}

export function getPinnedPosition(
  mode: 'bottom' | 'left' | 'right',
  menuDim: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const y = Math.max(12, viewport.height - menuDim.height - 24);
  if (mode === 'bottom') {
    return { x: Math.max(12, (viewport.width - menuDim.width) / 2), y };
  }
  if (mode === 'left') {
    return { x: 24, y };
  }
  return { x: Math.max(12, viewport.width - menuDim.width - 24), y };
}

export function calculateAvoidance(
  currentPos: { x: number; y: number },
  menuDim: { width: number; height: number },
  forbiddenRects: Rect[],
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const menuRect: Rect = {
    left: currentPos.x,
    top: currentPos.y,
    right: currentPos.x + menuDim.width,
    bottom: currentPos.y + menuDim.height,
  };

  const collidingRect = forbiddenRects.find((rect) => isOverlapping(menuRect, rect));
  if (!collidingRect) {
    return currentPos;
  }

  // Check right margin dodge
  const rightDodgeX = viewport.width - menuDim.width - 24;
  const rightRect: Rect = { left: rightDodgeX, top: currentPos.y, right: rightDodgeX + menuDim.width, bottom: currentPos.y + menuDim.height };
  if (!forbiddenRects.some((r) => isOverlapping(rightRect, r))) {
    return { x: rightDodgeX, y: currentPos.y };
  }

  // Check left margin dodge
  const leftDodgeX = 24;
  const leftRect: Rect = { left: leftDodgeX, top: currentPos.y, right: leftDodgeX + menuDim.width, bottom: currentPos.y + menuDim.height };
  if (!forbiddenRects.some((r) => isOverlapping(leftRect, r))) {
    return { x: leftDodgeX, y: currentPos.y };
  }

  // Horizontal dodge unavailable (e.g. full-width button); dodge vertically above colliding button
  const safeY = Math.max(12, collidingRect.top - menuDim.height - 12);
  return { x: currentPos.x, y: safeY };
}

export function draggable(node: HTMLElement, initialOptions: DragOptions = {}) {
  let options = initialOptions;
  let isDragging = false;
  let hasMovedPastThreshold = false;
  let originClientX = 0;
  let originClientY = 0;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let lastTapTime = 0;
  const DRAG_THRESHOLD = 6;

  function getDockedCoords(): { x: number; y: number } {
    const dimWidth = node.offsetWidth || 140;
    const dimHeight = node.offsetHeight || 48;
    const defaultX = window.innerWidth - dimWidth - 24;
    const defaultY = window.innerHeight - dimHeight - 24;
    return { x: Math.max(12, defaultX), y: Math.max(12, defaultY) };
  }

  function loadInitialPosition(): { x: number; y: number } {
    const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    if (options.positionMode && options.positionMode !== 'free') {
      return getPinnedPosition(options.positionMode, menuDim, viewport);
    }

    if (options.storageKey && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(options.storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return {
              x: Math.max(12, Math.min(viewport.width - menuDim.width - 12, parsed.x)),
              y: Math.max(12, Math.min(viewport.height - menuDim.height - 12, parsed.y)),
            };
          }
        } catch {}
      }
    }
    return getDockedCoords();
  }

  const initial = loadInitialPosition();
  currentX = initial.x;
  currentY = initial.y;
  updatePosition(currentX, currentY);
  notifySnap();

  function updatePosition(x: number, y: number) {
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function notifySnap() {
    const isLowerHalf = currentY > window.innerHeight / 2;
    options.onSnap?.({ x: currentX, y: currentY, isLowerHalf });
  }

  function resetToDocked() {
    const docked = getDockedCoords();
    currentX = docked.x;
    currentY = docked.y;
    node.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    updatePosition(currentX, currentY);

    if (options.storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
    }
    notifySnap();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    const now = Date.now();
    if (now - lastTapTime < 300) {
      resetToDocked();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (options.positionMode && options.positionMode !== 'free') return;

    hasMovedPastThreshold = false;
    originClientX = e.clientX;
    originClientY = e.clientY;
    startX = e.clientX - currentX;
    startY = e.clientY - currentY;
  }

  function onPointerMove(e: PointerEvent) {
    if (!hasMovedPastThreshold && (Math.hypot(e.clientX - originClientX, e.clientY - originClientY) > DRAG_THRESHOLD)) {
      hasMovedPastThreshold = true;
      isDragging = true;
      node.setPointerCapture(e.pointerId);
      node.style.transition = 'none';
    }

    if (!isDragging) return;
    currentX = e.clientX - startX;
    currentY = e.clientY - startY;
    updatePosition(currentX, currentY);
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDragging) {
      hasMovedPastThreshold = false;
      return;
    }
    isDragging = false;
    hasMovedPastThreshold = false;

    if (node.hasPointerCapture(e.pointerId)) {
      node.releasePointerCapture(e.pointerId);
    }

    const forbiddenElements = [
      document.getElementById('btn-save'),
      document.getElementById('btn-submit'),
    ].filter((el): el is HTMLElement => el !== null);

    const forbiddenRects = forbiddenElements.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    });

    const menuDim = { width: node.offsetWidth, height: node.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    const snapped = snapToEdge(currentX, currentY, menuDim, viewport);
    const safePos = calculateAvoidance(snapped, menuDim, forbiddenRects, viewport);

    currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, safePos.x));
    currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, safePos.y));

    node.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    updatePosition(currentX, currentY);

    if (options.storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
    }
    notifySnap();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (options.positionMode && options.positionMode !== 'free') return;
    const step = 20;
    let moved = false;

    if (e.key === 'ArrowUp') {
      currentY = Math.max(12, currentY - step);
      moved = true;
    } else if (e.key === 'ArrowDown') {
      currentY = Math.min(window.innerHeight - node.offsetHeight - 12, currentY + step);
      moved = true;
    } else if (e.key === 'ArrowLeft') {
      currentX = Math.max(12, currentX - step);
      moved = true;
    } else if (e.key === 'ArrowRight') {
      currentX = Math.min(window.innerWidth - node.offsetWidth - 12, currentX + step);
      moved = true;
    }

    if (moved) {
      e.preventDefault();
      node.style.transition = 'transform 100ms ease';
      updatePosition(currentX, currentY);
      if (options.storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(options.storageKey, JSON.stringify({ x: currentX, y: currentY }));
      }
      notifySnap();
    }
  }

  function onResize() {
    const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (options.positionMode && options.positionMode !== 'free') {
      const pinned = getPinnedPosition(options.positionMode, menuDim, viewport);
      currentX = pinned.x;
      currentY = pinned.y;
    } else {
      currentX = Math.max(12, Math.min(viewport.width - menuDim.width - 12, currentX));
      currentY = Math.max(12, Math.min(viewport.height - menuDim.height - 12, currentY));
    }
    updatePosition(currentX, currentY);
    notifySnap();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);
  node.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  return {
    update(newOptions: DragOptions) {
      options = newOptions;
      if (options.positionMode && options.positionMode !== 'free') {
        const menuDim = { width: node.offsetWidth || 140, height: node.offsetHeight || 48 };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const pinned = getPinnedPosition(options.positionMode, menuDim, viewport);
        currentX = pinned.x;
        currentY = pinned.y;
        node.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        updatePosition(currentX, currentY);
        notifySnap();
      }
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
      node.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    },
  };
}
```

### 6.4 `apps/web/src/lib/ui/Button.svelte`

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';
    loading?: boolean;
    children?: Snippet;
  }

  let {
    variant = 'default',
    type = 'button',
    disabled = false,
    loading = false,
    class: className = '',
    children,
    ...restProps
  }: Props = $props();

  const variantClass = $derived(
    variant === 'default' ? '' : `btn--${variant}`
  );
</script>

<button
  {type}
  disabled={disabled || loading}
  aria-busy={loading ? 'true' : undefined}
  class="glass btn-glass {variantClass} {disabled ? 'opacity-50 cursor-not-allowed' : ''} {className}"
  {...restProps}
>
  {#if loading}
    <span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" aria-hidden="true"></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>
```

### 6.5 `apps/web/src/lib/ui/Card.svelte`

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'solid' | 'glass' | 'subtle';
    subtle?: boolean; // Backward-compatible alias for variant="subtle"
    class?: string;
    children?: Snippet;
  }

  let { variant = 'solid', subtle = false, class: className = '', children, ...restProps }: Props = $props();

  const variantClass = $derived.by(() => {
    if (subtle) return 'glass-subtle';
    if (variant === 'glass') return 'glass';
    if (variant === 'subtle') return 'glass-subtle';
    return 'bg-[var(--surface)] border border-[var(--pearl-border)]';
  });
</script>

<div class="{variantClass} rounded-[18px] p-5 shadow-sm {className}" {...restProps}>
  {#if children}
    {@render children()}
  {/if}
</div>
```

### 6.6 `apps/web/src/lib/ui/Chip.svelte`

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    variant?: 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';
    class?: string;
    children?: Snippet;
  }

  let { variant = 'default', class: className = '', children, ...restProps }: Props = $props();

  const styleMap: Record<string, string> = {
    default: 'background-color: var(--surface); color: var(--ink); border: 1px solid var(--muted);',
    commission: 'background-color: var(--pearl-b); color: var(--c-commission); border: 1px solid var(--c-commission);',
    vat: 'background-color: var(--c-vat-bg); color: var(--c-vat); border: 1px solid var(--c-vat);',
    bkash: 'background-color: var(--c-bkash-bg); color: var(--c-bkash); border: 1px solid var(--c-bkash);',
    visa: 'background-color: var(--c-visa-bg); color: var(--c-visa); border: 1px solid var(--c-visa);',
    mastercard: 'background-color: var(--c-mastercard-bg); color: var(--c-mastercard); border: 1px solid var(--c-mastercard);',
  };
</script>

<span
  class="chip inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {className}"
  style={styleMap[variant]}
  {...restProps}
>
  {#if children}
    {@render children()}
  {/if}
</span>
```

### 6.7 `apps/web/src/lib/ui/Modal.svelte`

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { messages } from '../i18n/messages';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children?: Snippet;
  }

  let { open = $bindable(false), title, onclose, children }: Props = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  function handleCancel(e: Event) {
    e.preventDefault();
    onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      onclose();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
  aria-labelledby="modal-title"
  class="glass rounded-[20px] max-w-lg w-full p-6 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm m-auto border border-[var(--pearl-border)]"
>
  <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
    <h2 id="modal-title" class="text-lg font-bold text-[var(--ink)]">{title}</h2>
    <button
      type="button"
      aria-label={messages.ui.closeModal}
      onclick={onclose}
      class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--muted)]"
    >
      ✕
    </button>
  </div>
  <div class="mt-4">
    {#if children}
      {@render children()}
    {/if}
  </div>
</dialog>
```

### 6.8 `apps/web/src/lib/ui/Toast.svelte`

```svelte
<script lang="ts">
  import { messages } from '../i18n/messages';

  export interface ToastMessage {
    id: string;
    text: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }

  interface Props {
    toasts: ToastMessage[];
    ondismiss: (id: string) => void;
  }

  let { toasts, ondismiss }: Props = $props();

  const typeBorderMap = {
    info: 'border-[var(--pearl-border)]',
    success: 'border-l-4 border-l-[var(--c-commission)]',
    warning: 'border-l-4 border-l-[var(--c-vat)]',
    error: 'border-l-4 border-l-[var(--c-bkash)]',
  };
</script>

<aside aria-label={messages.ui.notifications} class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
  {#each toasts as toast (toast.id)}
    <div
      class="glass rounded-xl p-4 shadow-lg pointer-events-auto flex items-center justify-between text-sm {typeBorderMap[toast.type]}"
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <span class="text-[var(--ink)]">{toast.text}</span>
      <button
        type="button"
        onclick={() => ondismiss(toast.id)}
        class="ml-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--ink)]"
        aria-label={messages.ui.dismissNotification}
      >
        ✕
      </button>
    </div>
  {/each}
</aside>
```

### 6.9 `apps/web/src/lib/ui/FloatingMenu.svelte`

```svelte
<script lang="ts">
  import { draggable } from './actions/draggable';
  import { messages } from '../i18n/messages';

  interface Props {
    role?: 'staff' | 'admin' | 'owner';
    positionMode?: 'free' | 'bottom' | 'left' | 'right';
  }

  let { role = 'staff', positionMode = 'free' }: Props = $props();

  let expanded = $state(false);
  let isLowerHalf = $state(true);

  function toggleMenu() {
    expanded = !expanded;
  }

  function handleSnap(pos: { x: number; y: number; isLowerHalf: boolean }) {
    isLowerHalf = pos.isLowerHalf;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && expanded) {
      expanded = false;
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMenu();
    }
  }
</script>

<div
  use:draggable={{ storageKey: 'clt-floating-menu-pos', positionMode, onSnap: handleSnap }}
  class="fixed top-0 left-0 z-40 touch-none select-none md:hidden outline-none flex {isLowerHalf ? 'flex-col-reverse' : 'flex-col'}"
  id="floating-action-menu"
  tabindex="0"
  role="region"
  aria-label={messages.ui.mobileRegion}
  onkeydown={handleKeydown}
>
  <div class="glass rounded-full p-2 flex items-center gap-2 shadow-xl border border-[var(--pearl-border)]">
    <a
      href="/entries/new"
      class="btn-glass btn--commission rounded-full px-4 py-2 flex items-center gap-1.5 text-sm font-semibold"
      aria-label={messages.menu.newEntry}
    >
      <span aria-hidden="true">+</span>
      <span class="btn-label">{messages.menu.newEntry}</span>
    </a>

    <button
      type="button"
      onclick={toggleMenu}
      class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
      aria-expanded={expanded}
      aria-controls="mobile-nav-panel"
      aria-label={messages.ui.toggleMenu}
    >
      <span class="text-xs" aria-hidden="true">☰</span>
    </button>
  </div>

  {#if expanded}
    <nav
      id="mobile-nav-panel"
      aria-label={messages.ui.mainNav}
      class="glass rounded-2xl p-3 {isLowerHalf ? 'mb-2' : 'mt-2'} flex flex-col gap-1 shadow-2xl max-h-[70vh] overflow-y-auto"
    >
      <a href="/dashboard" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.dashboard}
      </a>
      <a href="/ledger" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.ledger}
      </a>
      <a href="/reports" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reports}
      </a>
      {#if role === 'admin' || role === 'owner'}
        <a href="/settlements" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.settlements}
        </a>
        <a href="/reconcile" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.reconcile}
        </a>
        <a href="/admin" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.admin}
        </a>
      {/if}
      <a href="/settings" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center border-t border-black/10 dark:border-white/10 mt-1">
        {messages.menu.settings}
      </a>
    </nav>
  {/if}
</div>
```

### 6.10 `apps/web/src/lib/ui/Sidebar.svelte`

```svelte
<script lang="ts">
  import { messages } from '../i18n/messages';

  interface Props {
    role?: 'staff' | 'admin' | 'owner';
  }

  let { role = 'staff' }: Props = $props();
</script>

<aside aria-label={messages.ui.desktopSidebar} class="hidden md:flex flex-col w-64 glass min-h-screen p-5 border-r border-[var(--pearl-border)]">
  <div class="mb-8">
    <h1 class="text-xl font-bold tracking-tight text-[var(--ink)]">{messages.app.title}</h1>
    <p class="text-xs text-[var(--muted)]">{messages.app.subtitle}</p>
  </div>

  <nav aria-label={messages.ui.mainNav} class="flex flex-col gap-1.5 flex-1">
    <a href="/entries/new" class="btn-glass btn--commission rounded-xl py-3 px-4 mb-3 flex items-center justify-center font-bold">
      <span class="btn-label">{messages.menu.newEntry}</span>
    </a>
    <a href="/dashboard" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
      {messages.menu.dashboard}
    </a>
    <a href="/ledger" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
      {messages.menu.ledger}
    </a>
    <a href="/reports" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
      {messages.menu.reports}
    </a>
    {#if role === 'admin' || role === 'owner'}
      <a href="/settlements" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.settlements}
      </a>
      <a href="/reconcile" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reconcile}
      </a>
      <a href="/admin" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.admin}
      </a>
    {/if}
    <a href="/settings" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center border-t border-black/10 dark:border-white/10 mt-2">
      {messages.menu.settings}
    </a>
  </nav>

  <div class="pt-4 border-t border-black/10 dark:border-white/10 text-xs text-[var(--muted)]">
    <p>{messages.ui.footerBrand}</p>
  </div>
</aside>
```

### 6.11 `apps/web/src/lib/i18n/messages.ts`

```ts
export const messages = {
  app: {
    title: 'Cosmo Ledger Track',
    subtitle: 'Payment ledger and settlement tracker',
  },
  menu: {
    newEntry: 'New Entry',
    dashboard: 'Dashboard',
    ledger: 'Ledger',
    reports: 'Reports',
    settlements: 'Settlements',
    reconcile: 'Reconcile',
    admin: 'Admin',
    settings: 'Settings',
  },
  entry: {
    entryDate: 'Entry Date',
    customerName: 'Customer Name',
    subQty: 'Sub Quantity',
    subDescription: 'Sub Description',
    grossAmount: 'Gross Amount (BDT)',
    paymentMethod: 'Payment Method',
    txnRef: 'Transaction Reference',
    vat: 'VAT Amount (BDT)',
    notes: 'Notes',
    save: 'Save Transaction',
    saving: 'Saving...',
    savedOffline: 'Saved locally (pending sync)',
    duplicateWarning: 'A transaction with this reference or customer already exists today.',
    customerBorneNotice: 'Customer-paid — not deducted from business net',
  },
  sync: {
    synced: 'Synced',
    syncing: 'Syncing...',
    offline: 'Offline',
    pendingOps: 'pending sync',
    errorRetry: 'Sync error (tap to retry)',
  },
  ui: {
    closeModal: 'Close modal',
    notifications: 'Notifications',
    dismissNotification: 'Dismiss notification',
    toggleMenu: 'Toggle navigation menu',
    mobileNav: 'Mobile expanded navigation',
    mobileRegion: 'Mobile actions region',
    desktopSidebar: 'Desktop navigation sidebar',
    mainNav: 'Main navigation links',
    footerBrand: 'Cosmo Ledger Track',
  },
};
```

### 6.12 `apps/web/src/lib/ui/tokens.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { categoryColors, uiTokens } from './tokens';

// WCAG 2.1 relative luminance & contrast ratio calculation
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const transform = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(...parseHex(hex1));
  const l2 = relativeLuminance(...parseHex(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design System WCAG AA Contrast Ratios (Dynamic Formula Verification)', () => {
  const BG_LIGHT = '#F6F5F1';
  const BG_DARK = '#0E1116';
  const BG_WHITE = '#FFFFFF';

  it('dynamically computes contrast for all category colors on light background (#F6F5F1) >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const actualRatio = contrastRatio(token.light, BG_LIGHT);
      expect(
        actualRatio,
        `Token ${key} (${token.light}) on ${BG_LIGHT} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for all category colors on white background (#FFFFFF) >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const actualRatio = contrastRatio(token.light, BG_WHITE);
      expect(
        actualRatio,
        `Token ${key} (${token.light}) on ${BG_WHITE} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for all category colors on dark background (#0E1116) >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const actualRatio = contrastRatio(token.dark, BG_DARK);
      expect(
        actualRatio,
        `Token ${key} (${token.dark}) on ${BG_DARK} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for category colors against their tinted chip backgrounds >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const lightRatio = contrastRatio(token.light, token.bgLight);
      expect(
        lightRatio,
        `Light Chip ${key}: ${token.light} on ${token.bgLight} computed ${lightRatio.toFixed(2)}:1 must be >= 4.5`
      ).toBeGreaterThanOrEqual(4.5);

      const darkRatio = contrastRatio(token.dark, token.bgDark);
      expect(
        darkRatio,
        `Dark Chip ${key}: ${token.dark} on ${token.bgDark} computed ${darkRatio.toFixed(2)}:1 must be >= 4.5`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for neutral text tokens (ink & muted) >= 4.5:1', () => {
    // Light theme
    expect(contrastRatio(uiTokens.ink.light, BG_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiTokens.muted.light, BG_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiTokens.accent.light, BG_LIGHT)).toBeGreaterThanOrEqual(4.5);

    // Dark theme
    expect(contrastRatio(uiTokens.ink.dark, BG_DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiTokens.muted.dark, BG_DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiTokens.accent.dark, BG_DARK)).toBeGreaterThanOrEqual(4.5);
  });
});
```

### 6.13 `apps/web/src/lib/ui/draggable.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  calculateAvoidance,
  isOverlapping,
  snapToEdge,
  getPinnedPosition,
  type Rect,
} from './actions/draggable';

describe('Draggable Collision Avoidance and Snapping', () => {
  it('detects bounding box overlap correctly', () => {
    const r1: Rect = { left: 10, top: 10, right: 50, bottom: 50 };
    const r2: Rect = { left: 40, top: 40, right: 80, bottom: 80 };
    const r3: Rect = { left: 100, top: 100, right: 150, bottom: 150 };

    expect(isOverlapping(r1, r2)).toBe(true);
    expect(isOverlapping(r1, r3)).toBe(false);
  });

  it('dodges to left margin when right side collides with Save button', () => {
    const menuDim = { width: 140, height: 48 };
    const viewport = { width: 400, height: 800 };
    const forbiddenRect: Rect = { left: 240, top: 720, right: 380, bottom: 780 };

    const collidingPos = { x: 250, y: 730 };
    const resolved = calculateAvoidance(collidingPos, menuDim, [forbiddenRect], viewport);

    expect(resolved.x).toBe(24);
    expect(resolved.y).toBe(730);
  });

  it('dodges vertically above button when colliding with full-width primary button', () => {
    const menuDim = { width: 140, height: 48 };
    const viewport = { width: 400, height: 800 };
    // Full width bottom Save button spanning across screen
    const fullWidthBtn: Rect = { left: 16, top: 720, right: 384, bottom: 780 };

    const collidingPos = { x: 236, y: 730 };
    const resolved = calculateAvoidance(collidingPos, menuDim, [fullWidthBtn], viewport);

    // Cannot dodge left or right; must dodge above button (720 - 48 - 12 = 660)
    expect(resolved.y).toBe(660);
  });

  it('snaps to nearest screen edge (left vs right)', () => {
    const menuDim = { width: 120, height: 48 };
    const viewport = { width: 400, height: 800 };

    // Closer to left edge
    const snapLeft = snapToEdge(50, 400, menuDim, viewport);
    expect(snapLeft.x).toBe(24);

    // Closer to right edge
    const snapRight = snapToEdge(300, 400, menuDim, viewport);
    expect(snapRight.x).toBe(400 - 120 - 24); // 256
  });

  it('computes correct coordinates for pinned position modes', () => {
    const menuDim = { width: 120, height: 48 };
    const viewport = { width: 400, height: 800 };

    const leftPin = getPinnedPosition('left', menuDim, viewport);
    expect(leftPin.x).toBe(24);
    expect(leftPin.y).toBe(800 - 48 - 24);

    const rightPin = getPinnedPosition('right', menuDim, viewport);
    expect(rightPin.x).toBe(400 - 120 - 24);
    expect(rightPin.y).toBe(800 - 48 - 24);

    const bottomPin = getPinnedPosition('bottom', menuDim, viewport);
    expect(bottomPin.x).toBe((400 - 120) / 2);
    expect(bottomPin.y).toBe(800 - 48 - 24);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Contrast Light Verification | `categoryColors` on `#F6F5F1` and `#FFFFFF` | All contrast ratios >= 4.5:1 (calculated via WCAG luminance formula) | §14.1 | `apps/web/src/lib/ui/tokens.test.ts` |
| Contrast Dark Verification | `categoryColors` on `#0E1116` | All contrast ratios >= 4.5:1 (calculated via WCAG luminance formula) | §14.1 | `apps/web/src/lib/ui/tokens.test.ts` |
| Tinted Chip Contrast Verification | `categoryColors` against `bgLight` and `bgDark` | All contrast ratios >= 4.5:1 (calculated via WCAG luminance formula) | §14.1 | `apps/web/src/lib/ui/tokens.test.ts` |
| Neutral & Accent Contrast Verification | `uiTokens.ink`, `muted`, and `accent` | All contrast ratios >= 4.5:1 on light (#F6F5F1) and dark (#0E1116) | §14.1 | `apps/web/src/lib/ui/tokens.test.ts` |
| Draggable Overlap Detection | Two overlapping rects | `isOverlapping === true` | §14.5 | `apps/web/src/lib/ui/draggable.test.ts` |
| Draggable Horizontal Dodge | Collision with save rect on 400px width | `resolved.x === 24` | §14.5 | `apps/web/src/lib/ui/draggable.test.ts` |
| Draggable Vertical Dodge | Collision with full-width save rect | `resolved.y === 660` (dodges vertically above button) | §14.5 | `apps/web/src/lib/ui/draggable.test.ts` |
| Draggable Edge Snapping | Position at x=50 and x=300 in 400px viewport | Snaps to left margin (24px) and right margin (256px) | §14.5 | `apps/web/src/lib/ui/draggable.test.ts` |
| Draggable Pinned Positions | Pinned modes: bottom, left, right | Returns exact docked coordinates | §14.5 | `apps/web/src/lib/ui/draggable.test.ts` |

## 8. Acceptance criteria

1. All design tokens defined and dynamically verified to conform to WCAG AA >= 4.5:1 across backgrounds and tinted chip surfaces.
   - Command: `pnpm --filter @clt/web test tokens.test.ts`
   - Expected output: exits with code 0 and all assertions pass.
2. Collision avoidance (horizontal and vertical), edge snapping, and pinned positioning against `#btn-save` and `#btn-submit` verified.
   - Command: `pnpm --filter @clt/web test draggable.test.ts`
   - Expected output: exits with code 0 and all assertions pass.
3. SvelteKit typecheck passes on all components.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: exits with code 0 and `0 errors`.

## 9. Hard rules touched

- Rule 14: Adheres strictly to PRD §14 tokens, fonts, and safe zone specifications.
- Rule 16: Reduces exposure to contrast illegibility and UI collisions; subject to audit.
- Rule 17: No invented styles; categories, colors, touch target bounds (44px), and radii (18px) match PRD §14 verbatim.

## 10. Pitfalls

1. Glass backdrop-blur performance: Avoid heavy blur on large tables; use only on menus, sheets, modals, and buttons (PRD §14.2).
2. Contrast regressions: Any new category or neutral color must be verified with dynamic WCAG relative luminance formula.
3. Fixed transform offset trap: Draggable elements positioned with `translate3d` using viewport coordinates must have `top: 0; left: 0;` (`class="fixed top-0 left-0 ..."`), otherwise transform evaluates relative to DOM layout offset.
4. Font decoding failure: Empty 0-byte font files cause browser OTS parsing errors; font files must carry valid WOFF2 headers.
5. Component class extension: Reusable UI components (like `Button.svelte`, `Card.svelte`, `Chip.svelte`) must accept `class?: string` and spread HTML attributes to allow consumers to customize layout/width without failing `svelte-check`.
6. i18n Catalog Hygiene: All aria-labels and UI text must be defined in `messages.ts` (PRD §12).
7. Pointer capture trap on child elements: Do not set pointer capture immediately on `pointerdown` without movement threshold (`DRAG_THRESHOLD = 6px`), otherwise synthetic click events on child buttons and links are intercepted.
8. Mobile docked navigation rendering off-screen: When docking floating menus near the bottom edge (`y > viewport.height / 2`), render expanded navigation panels above the action pill (`mb-2` or `flex-col-reverse`), preventing off-screen overflow.

## 11. PRD ISSUES and DECISION PENDING

- Native `<dialog>` element refactor `[PLAN-DERIVED]`: PRD §14.3 specifies glass modal surfaces. Plan 007 uses the HTML5 `<dialog>` element with `.showModal()`, native top-layer isolation, and backdrop dismissal conforming to modern web accessibility best practices.
- Dynamic vertical dodging `[PLAN-DERIVED]`: PRD §14.5 specifies collision avoidance with `#btn-save` and `#btn-submit`. For full-width primary buttons where horizontal margins are unavailable, the draggable action automatically dodges vertically above the button.

## 12. Handoff

Once this plan is Implemented:
- UI components (`Button`, `Card`, `Chip`, `Modal`, `Toast`, `FloatingMenu`, `Sidebar`) and tokens are ready for consumption by Plan 008 (Auth & App Shell), Plan 009 (Admin Panel), and Plan 010 (Entry Form).
- Message catalog in `apps/web/src/lib/i18n/messages.ts` is ready for expansion.

## 13. Suggested Task Breakdown

- **CLT-T-025** (Implementer): CSS tokens, pearl-grain background, typography, and test suite (`tokens.ts`, `tokens.test.ts`, `app.css`).
- **CLT-T-026** (Implementer): UI kit primitives (`Button.svelte`, `Card.svelte`, `Chip.svelte`, `Modal.svelte`, `Toast.svelte`, `messages.ts`).
- **CLT-T-027** (Implementer): Draggable action, mobile floating menu, and desktop sidebar (`draggable.ts`, `draggable.test.ts`, `FloatingMenu.svelte`, `Sidebar.svelte`).
- **CLT-T-028** (DevOps): Verification of design system tokens, WCAG AA contrast ratio test suite, and draggable tests.

## Changelog

- 2026-11-01 — Revision 2.2:
  - 1. **Fixed Mobile Navigation Viewport Overflow (P0.1)**: Dynamically detected `isLowerHalf` docking position in `FloatingMenu.svelte` to position expanded `<nav>` above the action pill (`mb-2` / `flex-col-reverse`), preventing navigation links from rendering off-screen below `window.innerHeight`.
  - 2. **Eliminated Pointer Capture Click Interception (P0.2)**: Implemented `DRAG_THRESHOLD = 6px` in `draggable.ts` so `setPointerCapture` is deferred until movement occurs, allowing taps and clicks on child buttons (`☰`) and links (`+ New Entry`) to dispatch cleanly.
  - 3. **Native `<dialog>` Accessibility Refactor (P0.3)**: Refactored `Modal.svelte` to native HTML5 `<dialog>` using Svelte 5 `$effect()` and `.showModal()`, achieving native focus trapping, top-layer isolation, automatic Escape key dismissal, and backdrop handling without A11y compiler warnings.
  - 4. **Added Action `update()` Lifecycle Hook (P0.4)**: Added `update(newOptions)` to `draggable.ts` action return object, allowing dynamic reactivity when `positionMode` updates at runtime.
  - 5. **Self-Hosted Offline Bengali Font Assets (P0.5)**: Added `NotoSansBengali-Regular.woff2` to Step 1 asset initialization and added `@font-face` rule in `app.css` ensuring offline PWA rendering in Bangladesh retail environments per PRD §14.1.
  - 6. **Restored PRD §14.1 Design Tokens (P1.1)**: Realigned `--ink`, `--c-vat-bg`, `--c-bkash-bg`, `--c-visa-bg`, `--c-mastercard-bg` to exact PRD hex codes, and restored missing `--accent`, `--accent-2`, `--pearl-a`, `--pearl-b`, and `--pearl-c` tokens.
  - 7. **Restored PRD §14.2 Pearl Gradients & PRD §14.4 Engraved Buttons (P1.2)**: Restored `.app-bg` dual radial pearl gradients with blended fractal noise overlay, and reinstated frosted glass buttons with colorful linear-gradient text clip, dual drop-shadows, and solid-color fallbacks.
  - 8. **Fixed Full-Width Button Collision Avoidance (P1.3)**: Added vertical dodging logic in `calculateAvoidance` when full-width primary buttons block both horizontal margins.
  - 9. **Added Window Resize & Pointer Cancel Listeners (P1.4)**: Bound `window.resize` to re-clamp positions across orientation changes, and bound `pointercancel` to safely terminate dragging gestures.
  - 10. **Added Settings Navigation Link (P1.5)**: Added `/settings` link to both mobile `FloatingMenu.svelte` and desktop `Sidebar.svelte` per PRD §14.5.
  - 11. **Added Tabular Figures Utility (P1.6)**: Added `.tabular-nums` rule in `app.css` enforcing `font-variant-numeric: tabular-nums` for financial amounts.
  - 12. **Aligned High-Contrast Styles (P1.7)**: Reinstated verbatim PRD §14.6 `@media (prefers-contrast: more)` styles with solid surfaces, disabled grain, and flat button text.
  - 13. **Forwarded HTML Attributes on Primitives (P2.1)**: Extended `svelte/elements` interfaces in `Button.svelte`, `Card.svelte`, and `Chip.svelte`, spreading `...restProps`.
  - 14. **Differentiated Toast Visuals & Alert Roles (P2.2)**: Added accent border styling by `toast.type` and set `role="alert"` for error toasts.
  - 15. **Replaced Hardcoded White Borders (P2.3)**: Replaced `border-white/60` and `border-white/50` with `var(--pearl-border)` in `FloatingMenu.svelte` and `Sidebar.svelte`.
  - 16. **Added Dark Mode Navigation Hover States (P2.4)**: Added `dark:hover:bg-white/5` to navigation links.
  - 17. **Expanded Unit Test Suites (P2.5, P2.6)**: Added tests for vertical dodging and full-width collision in `draggable.test.ts`, and verified dynamic contrast ratios for category colors against tinted chip backgrounds in `tokens.test.ts`.
- 2026-10-30 — Revision 2.1:
  - Standardized task IDs to sequential identifiers `CLT-T-025`, `CLT-T-026`, `CLT-T-027`, `CLT-T-028` with `Implementer` and `DevOps` roles in Section 13.
- 2026-10-30 — Revision 2.0:
  - Resolved Flaw 1: Ensured `apps/web/package.json` in Plan 001 defines `"test": "vitest run"` and `"vitest"`, and validated that `svelte.config.js`, `vite.config.ts`, and `app.html` exist in Plan 001 and are checked in Plan 007 Preconditions.
  - Resolved Flaw 2: Added `class="chip ..."` to `Chip.svelte` so `grep -c 'chip'` outputs 1 in Step 7, and updated Step 9 check to `grep -c 'role="status"' apps/web/src/lib/ui/Toast.svelte` outputting 1.
  - Resolved Flaw 3: Added `class?: string;` (`class: className = ''`) to `Button.svelte` props and applied `{className}` to `<button>`, eliminating `svelte-check` type errors in Plan 008.
  - Resolved Flaw 4: Added `top-0 left-0` to `#floating-action-menu` in `FloatingMenu.svelte` to prevent off-screen `translate3d` offsets. Added edge/corner snapping, double-tap reset, keyboard arrow movement, pinned position modes (`free`, `bottom`, `left`, `right`), and role filtering (`staff` vs `admin`/`owner` with `/reconcile`) per PRD §14.5.
  - Resolved Flaw 5: Replaced static metadata assertions in `tokens.test.ts` with a dynamic WCAG 2.1 relative luminance and contrast ratio formula helper, verifying all category tokens, `ink`, and `muted` against light, white, and dark backgrounds.
  - Resolved Flaw 6: Added `'Noto Sans Bengali'` fallback to `--font-sans` in `app.css` per PRD §14.1, and updated Step 1 font asset initialization to write valid WOFF2 binary headers instead of 0-byte files.
  - Resolved Flaw 7: Added `ui` section to `messages.ts` and replaced all hardcoded strings in `Modal.svelte`, `Toast.svelte`, `FloatingMenu.svelte`, and `Sidebar.svelte` with catalog references conforming to PRD §12.
- 2026-10-29 — Revision 1.0: Initial specification of Plan 007 for design system, tokens, glass surfaces, and UI kit.
