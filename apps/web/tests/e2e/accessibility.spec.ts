import { test, expect, type Page } from '@playwright/test';

/**
 * CLT-R-008 — automated accessibility evidence for Gate 5.
 *
 * The fifth device pass (reports/GATE5-DEVICE-RUN.md) recorded that outside M2
 * `verify-gates.ts` scored Gate 5 as "`pnpm test:e2e` exited 0", which measured
 * no contrast and never emulated an accessibility preference. These cases close
 * the automatable part only:
 *
 *   1. WCAG 2.1 AA contrast (4.5:1) for the design tokens in both themes, read
 *      from the stylesheet the app actually ships rather than from the hex
 *      comments in app.css;
 *   2. `prefers-reduced-motion: reduce` collapses transition and animation
 *      duration;
 *   3. `prefers-reduced-transparency: reduce` removes backdrop blur from glass
 *      surfaces.
 *
 * Haptics, WebView fallback, focus order on real hardware and physical-device
 * rendering are not provable by browser automation and stay on
 * GATE5_PHYSICAL_DEVICE_CHECKLIST.md. No database writes and no credentials are
 * needed: the probes measure resolved computed styles on the public login page.
 */

const AA_NORMAL_TEXT = 4.5;

interface TokenPair {
  label: string;
  fg: string;
  bg: string;
}

/**
 * Pairs the design system actually paints. `--c-*` channels are used as text on
 * the page background (ReceiptBreakdown, method pills), and `--muted`/`--accent`
 * appear on both `--bg` and `--surface` cards, so both grounds are measured.
 */
const TOKEN_PAIRS: TokenPair[] = [
  { label: 'ink on bg', fg: '--ink', bg: '--bg' },
  { label: 'ink on surface', fg: '--ink', bg: '--surface' },
  { label: 'muted on bg', fg: '--muted', bg: '--bg' },
  { label: 'muted on surface', fg: '--muted', bg: '--surface' },
  { label: 'accent on bg', fg: '--accent', bg: '--bg' },
  { label: 'accent on surface', fg: '--accent', bg: '--surface' },
  { label: 'commission on bg', fg: '--c-commission', bg: '--bg' },
  { label: 'vat on bg', fg: '--c-vat', bg: '--bg' },
  { label: 'bkash on bg', fg: '--c-bkash', bg: '--bg' },
  { label: 'visa on bg', fg: '--c-visa', bg: '--bg' },
  { label: 'mastercard on bg', fg: '--c-mastercard', bg: '--bg' },
];

const BUTTON_VARIANTS = ['commission', 'vat', 'bkash', 'visa', 'mastercard'] as const;
const EXPECTED_CONTRAST_COUNT = TOKEN_PAIRS.length + BUTTON_VARIANTS.length * 4;

/** Resolves token colours and composited .glass button stops in-page and returns WCAG contrast ratios. */
async function measureTokenContrast(
  page: Page,
  theme: 'light' | 'dark',
): Promise<Array<{ label: string; ratio: number }>> {
  return page.evaluate(
    ({ theme, pairs, variants }) => {
      const root = document.documentElement;
      const previous = root.getAttribute('data-theme');
      if (theme === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');

      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-10000px';
      host.style.top = '0';
      document.body.appendChild(host);

      type Rgba = [number, number, number, number];

      const parseNumericToken = (token: string, scale255 = false): number => {
        const trimmed = token.trim();
        if (trimmed.endsWith('%')) {
          const pct = Number(trimmed.slice(0, -1));
          if (!Number.isFinite(pct)) throw new Error(`unparseable percentage token: ${token}`);
          return scale255 ? (pct / 100) * 255 : pct / 100;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n)) throw new Error(`unparseable numeric token: ${token}`);
        return n;
      };

      const linToSrgb255 = (linear: number): number => {
        const clamped = Math.min(1, Math.max(0, linear));
        const srgb =
          clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
        return srgb * 255;
      };

      const oklabToRgba = (L: number, a: number, b: number, alpha: number): Rgba => {
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.291485548 * b;
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;
        const r = linToSrgb255(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
        const g = linToSrgb255(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
        const bl = linToSrgb255(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
        return [r, g, bl, alpha];
      };

      const parseRgba = (css: string): Rgba => {
        const rgbMatch = css.trim().match(/^rgba?\(([^)]+)\)$/i);
        if (rgbMatch) {
          const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean);
          if (parts.length !== 3 && parts.length !== 4) {
            throw new Error(`unparseable rgb/rgba colour: ${css}`);
          }
          const r = parseNumericToken(parts[0], true);
          const g = parseNumericToken(parts[1], true);
          const b = parseNumericToken(parts[2], true);
          const a = parts.length === 4 ? parseNumericToken(parts[3], false) : 1;
          return [r, g, b, a];
        }

        const srgbMatch = css.trim().match(/^color\(\s*srgb\s+([^)]+)\)$/i);
        if (srgbMatch) {
          const parts = srgbMatch[1].split(/[/\s]+/).filter(Boolean);
          if (parts.length !== 3 && parts.length !== 4) {
            throw new Error(`unparseable color(srgb) colour: ${css}`);
          }
          const r = parseNumericToken(parts[0], false) * 255;
          const g = parseNumericToken(parts[1], false) * 255;
          const b = parseNumericToken(parts[2], false) * 255;
          const a = parts.length === 4 ? parseNumericToken(parts[3], false) : 1;
          return [r, g, b, a];
        }

        const oklabMatch = css.trim().match(/^oklab\(([^)]+)\)$/i);
        if (oklabMatch) {
          const parts = oklabMatch[1].split(/[/\s]+/).filter(Boolean);
          if (parts.length !== 3 && parts.length !== 4) {
            throw new Error(`unparseable oklab colour: ${css}`);
          }
          const L = parseNumericToken(parts[0], false);
          const a = parseNumericToken(parts[1], false);
          const b = parseNumericToken(parts[2], false);
          const alpha = parts.length === 4 ? parseNumericToken(parts[3], false) : 1;
          return oklabToRgba(L, a, b, alpha);
        }

        throw new Error(`unparseable colour: ${css}`);
      };

      const compositeOver = (
        [fr, fg, fb, fa]: Rgba,
        [br, bg, bb]: [number, number, number],
      ): [number, number, number] => [
        fr * fa + br * (1 - fa),
        fg * fa + bg * (1 - fa),
        fb * fa + bb * (1 - fa),
      ];

      const luminance = ([r, g, b]: [number, number, number]): number => {
        const channel = (value: number): number => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      const contrastRatio = (
        fg: [number, number, number],
        bg: [number, number, number],
      ): number => {
        const fgLum = luminance(fg);
        const bgLum = luminance(bg);
        const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
        return Math.round(ratio * 100) / 100;
      };

      const resolveOn = (
        parent: HTMLElement,
        value: string,
        property: 'color' | 'background-color',
      ): string => {
        const el = document.createElement('span');
        el.style.setProperty(property, value);
        el.textContent = 'probe';
        parent.appendChild(el);
        const computed = getComputedStyle(el).getPropertyValue(property);
        el.remove();
        return computed;
      };

      const baseBg = compositeOver(
        parseRgba(resolveOn(host, 'var(--bg)', 'background-color')),
        [255, 255, 255],
      );
      const surfaceBg = compositeOver(
        parseRgba(resolveOn(host, 'var(--surface)', 'background-color')),
        baseBg,
      );

      const results = pairs.map((pair) => {
        const bg = compositeOver(
          parseRgba(resolveOn(host, `var(${pair.bg})`, 'background-color')),
          baseBg,
        );
        const fg = compositeOver(parseRgba(resolveOn(host, `var(${pair.fg})`, 'color')), bg);
        return { label: pair.label, ratio: contrastRatio(fg, bg) };
      });

      for (const variant of variants) {
        const btn = document.createElement('button');
        btn.className = `glass btn-glass btn--${variant}`;
        const labelEl = document.createElement('span');
        labelEl.className = 'btn-label';
        labelEl.textContent = 'probe';
        btn.appendChild(labelEl);
        host.appendChild(btn);

        const glassBg = compositeOver(parseRgba(getComputedStyle(btn).backgroundColor), baseBg);

        for (const stopVar of ['--c1', '--c2'] as const) {
          const stopRgb = compositeOver(
            parseRgba(resolveOn(labelEl, `var(${stopVar})`, 'color')),
            glassBg,
          );
          results.push({
            label: `.btn--${variant} .btn-label ${stopVar} on .glass`,
            ratio: contrastRatio(stopRgb, glassBg),
          });
          results.push({
            label: `.btn--${variant} .btn-label ${stopVar} on --surface`,
            ratio: contrastRatio(stopRgb, surfaceBg),
          });
        }

        btn.remove();
      }

      host.remove();
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);

      return results;
    },
    { theme, pairs: TOKEN_PAIRS, variants: [...BUTTON_VARIANTS] },
  );
}

/** Reads the durations the browser computes for a glass button and an animated box. */
async function measureMotion(page: Page): Promise<{
  reducedMotionMatches: boolean;
  transitionSeconds: number;
  animationSeconds: number;
}> {
  return page.evaluate(() => {
    const seconds = (value: string): number => {
      const first = value.split(',')[0].trim();
      return first.endsWith('ms') ? parseFloat(first) / 1000 : parseFloat(first);
    };

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    document.body.appendChild(host);

    const button = document.createElement('button');
    button.className = 'btn-glass';
    button.textContent = 'probe';
    host.appendChild(button);

    const animated = document.createElement('div');
    animated.style.animation = 'clt-a11y-probe 2s linear infinite';
    host.appendChild(animated);

    const result = {
      reducedMotionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionSeconds: seconds(getComputedStyle(button).transitionDuration),
      animationSeconds: seconds(getComputedStyle(animated).animationDuration),
    };

    host.remove();
    return result;
  });
}

test.describe('Gate 5 automated accessibility evidence (CLT-R-008)', () => {
  // A cold dev-server start serves the SPA shell before the module graph and
  // stylesheet land; measuring then reads an empty body and no token values.
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    // Public route: no credentials, no database writes.
    await page.goto('/login', { waitUntil: 'load' });
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 30_000 });
    // Do not measure a page whose stylesheet has not applied yet.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        { timeout: 15_000 },
      )
      .not.toBe('');
  });

  test('light theme design tokens meet WCAG AA (4.5:1) for normal text', async ({ page }) => {
    const results = await measureTokenContrast(page, 'light');
    expect(results.length).toBe(EXPECTED_CONTRAST_COUNT);
    for (const { label, ratio } of results) {
      expect(
        ratio,
        `light: ${label} is ${ratio}:1, below the 4.5:1 AA minimum`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  test('dark theme design tokens meet WCAG AA (4.5:1) for normal text', async ({ page }) => {
    const results = await measureTokenContrast(page, 'dark');
    expect(results.length).toBe(EXPECTED_CONTRAST_COUNT);
    for (const { label, ratio } of results) {
      expect(
        ratio,
        `dark: ${label} is ${ratio}:1, below the 4.5:1 AA minimum`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  test('default motion is present, so the reduced-motion case cannot pass vacuously', async ({
    page,
  }) => {
    const motion = await measureMotion(page);
    expect(motion.reducedMotionMatches).toBe(false);
    expect(
      motion.transitionSeconds,
      'the glass button should animate at 120ms unless reduced motion is requested',
    ).toBeGreaterThan(0.05);
    expect(
      motion.animationSeconds,
      'the baseline 2s CSS animation probe should remain > 1s unless reduced motion is active',
    ).toBeGreaterThan(1);
  });

  test('prefers-reduced-motion: reduce collapses transition and animation duration', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await measureMotion(page);

    expect(motion.reducedMotionMatches).toBe(true);
    expect(
      motion.transitionSeconds,
      `transition-duration stayed at ${motion.transitionSeconds}s under reduced motion`,
    ).toBeLessThanOrEqual(0.02);
    expect(
      motion.animationSeconds,
      `animation-duration stayed at ${motion.animationSeconds}s under reduced motion`,
    ).toBeLessThanOrEqual(0.02);
  });

  test('the shipped stylesheet contains the reduced-transparency rule for glass surfaces', async ({
    page,
  }) => {
    const matched = await page.evaluate(() => {
      const hits: string[] = [];

      const walk = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
          const anyRule = rule as CSSRule & {
            conditionText?: string;
            cssText?: string;
            cssRules?: CSSRuleList;
          };
          if (
            typeof anyRule.conditionText === 'string' &&
            /prefers-reduced-transparency/i.test(anyRule.conditionText)
          ) {
            hits.push(anyRule.cssText);
          }
          if (anyRule.cssRules) walk(anyRule.cssRules);
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          // A cross-origin sheet cannot be inspected; none are expected here.
        }
      }

      return hits;
    });

    expect(
      matched.length,
      'no @media (prefers-reduced-transparency: reduce) rule reached the browser',
    ).toBeGreaterThan(0);
    expect(
      matched.some((text) => /backdrop-filter/i.test(text)),
      'the reduced-transparency rule does not touch backdrop-filter on .glass',
    ).toBe(true);
  });

  test('prefers-reduced-transparency: reduce removes backdrop blur where the engine supports it', async ({
    page,
  }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });

    const supported = await page.evaluate(
      () => matchMedia('(prefers-reduced-transparency: reduce)').matches,
    );
    expect(
      supported,
      'Chromium automation must expose prefers-reduced-transparency media feature emulation',
    ).toBe(true);

    const glass = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-10000px';
      document.body.appendChild(host);

      const el = document.createElement('div');
      el.className = 'glass';
      el.textContent = 'probe';
      host.appendChild(el);

      const styles = getComputedStyle(el);
      const result = {
        backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
        backgroundColor: styles.backgroundColor,
      };

      host.remove();
      return result;
    });

    expect(
      ['none', ''].includes(glass.backdropFilter),
      `backdrop-filter was "${glass.backdropFilter}" with reduced transparency requested`,
    ).toBe(true);
  });
});
