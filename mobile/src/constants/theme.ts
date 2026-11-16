// Gridline's design tokens, matching css/styles.css on the website.
import { Platform } from 'react-native';

export const Colors = {
  light: {
    bg: '#f6f7f9', surface: '#ffffff', surface2: '#f1f3f6', border: '#e3e6eb',
    text: '#0f172a', text2: '#475569', muted: '#64748b',
    accent: '#0f766e', accentSoft: '#ccfbf1', ink: '#111827', onInk: '#ffffff', link: '#0e7490',
    good: '#047857', bad: '#b91c1c', warn: '#b45309',
    newBg: '#facc15', newText: '#1c1917', used: '#1e293b', cert: '#1d4ed8',
    dGreat: '#0f766e', dGood: '#5eb5a8', dFair: '#d7dce3', dHigh: '#f0a978', dOver: '#c2410c',
  },
  dark: {
    bg: '#000000', surface: '#0b0b0c', surface2: '#161618', border: '#26262a',
    text: '#f3f4f6', text2: '#b9bcc3', muted: '#8b8f98',
    accent: '#2dd4bf', accentSoft: '#0f3b38', ink: '#f3f4f6', onInk: '#000000', link: '#67e8f9',
    good: '#34d399', bad: '#f87171', warn: '#b45309',
    newBg: '#facc15', newText: '#1c1917', used: '#1e3a8a', cert: '#3b82f6',
    dGreat: '#2dd4bf', dGood: '#2a8f84', dFair: '#3b3b40', dHigh: '#b4683c', dOver: '#fb923c',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
});

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const Radius = 14;
