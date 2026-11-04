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
