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
        `Token ${key} (${token.light}) on ${BG_LIGHT} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for all category colors on white background (#FFFFFF) >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const actualRatio = contrastRatio(token.light, BG_WHITE);
      expect(
        actualRatio,
        `Token ${key} (${token.light}) on ${BG_WHITE} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for all category colors on dark background (#0E1116) >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const actualRatio = contrastRatio(token.dark, BG_DARK);
      expect(
        actualRatio,
        `Token ${key} (${token.dark}) on ${BG_DARK} computed ${actualRatio.toFixed(2)}:1 must be >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dynamically computes contrast for category colors against their tinted chip backgrounds >= 4.5:1', () => {
    for (const [key, token] of Object.entries(categoryColors)) {
      const lightRatio = contrastRatio(token.light, token.bgLight);
      expect(
        lightRatio,
        `Light Chip ${key}: ${token.light} on ${token.bgLight} computed ${lightRatio.toFixed(2)}:1 must be >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);

      const darkRatio = contrastRatio(token.dark, token.bgDark);
      expect(
        darkRatio,
        `Dark Chip ${key}: ${token.dark} on ${token.bgDark} computed ${darkRatio.toFixed(2)}:1 must be >= 4.5`,
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
