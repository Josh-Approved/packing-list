/**
 * Color tokens for packing-list.
 *
 * Mirror of josh-approved-design-system/colors_and_type.css for React Native.
 * Authored locally because `sync.mjs design-system-native` doesn't yet emit
 * colors.ts (open TODO in josh-approved-factory/CLAUDE.md). When that sync
 * extension lands, this file gets overwritten — keep the per-app accent
 * (`appAccent` / `appAccentBg`) declared in CLAUDE.md § Brand accent so the
 * sync can pick it up.
 */

import { useColorScheme } from 'react-native';

// ---------- Per-app accent ----------
// Aged ochre. Warm, earthy, evokes leather luggage and worn maps.
// In-app only — never a primary CTA, never replaces approval green.
export const appAccent = '#B58D3F';
export const appAccentBg = '#F1EDE0'; // ~12% mix over paper

// ---------- Light palette (canonical) ----------
const light = {
  // Backgrounds
  bg: '#FAFAF7',           // paper — default background
  bgElevated: '#FFFFFF',   // pure white — cards on paper
  bgSubtle: '#F2F2EE',     // ink-50 — subtle fill
  bgScrim: 'rgba(14, 14, 15, 0.5)',

  // Foregrounds
  fg: '#0E0E0F',           // ink-1000 — primary text
  fgMuted: '#6B6B72',      // ink-500 — secondary text
  fgSubtle: '#9A9AA0',     // ink-300 — tertiary, captions, disabled
  fgOnInk: '#FAFAF7',      // text on dark surfaces (e.g. ink CTA)
  fgOnAccent: '#FAFAF7',   // text on green

  // Hairlines (do the work shadows would do — design system rule)
  hairline: '#E5E5E2',     // ink-100
  hairlineStrong: '#C8C8CC', // ink-200

  // Approval green (verified / done / safe — never a CTA bg)
  accent: '#1F8A4C',
  accentHover: '#166534',
  accentBg: '#DCFCE7',

  // Semantic
  success: '#1F8A4C',
  successBg: '#DCFCE7',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  info: '#475569',
  infoBg: '#E2E8F0',

  // Per-app accent (in-app only — never CTA, never replaces approval green)
  appAccent,
  appAccentBg,

  // Focus ring
  focusRing: '#1F8A4C',
};

// ---------- Dark palette ----------
const dark = {
  bg: '#0B0B0C',
  bgElevated: '#131315',
  bgSubtle: '#1A1A1C',
  bgScrim: 'rgba(0, 0, 0, 0.6)',

  fg: '#F5F5F2',
  fgMuted: '#A0A0A6',
  fgSubtle: '#6B6B72',
  fgOnInk: '#F5F5F2',
  fgOnAccent: '#FFFFFF',

  hairline: '#26262A',
  hairlineStrong: '#3D3D42',

  accent: '#2EA866',          // green-500 lifts in dark
  accentHover: '#1F8A4C',
  accentBg: 'rgba(46, 168, 102, 0.15)',

  success: '#2EA866',
  successBg: 'rgba(46, 168, 102, 0.15)',
  warning: '#B45309',
  warningBg: 'rgba(180, 83, 9, 0.18)',
  danger: '#B91C1C',
  dangerBg: 'rgba(185, 28, 28, 0.18)',
  info: '#475569',
  infoBg: 'rgba(71, 85, 105, 0.22)',

  // Per-app accent in dark — same hue, slightly tinted bg
  appAccent,
  appAccentBg: 'rgba(181, 141, 63, 0.15)',

  focusRing: '#2EA866',
};

export type Colors = typeof light;

export const lightColors: Colors = light;
export const darkColors: Colors = dark;

/**
 * Colors hook — returns the active palette based on system color scheme.
 *
 *   const { c } = useTheme();
 *   const s = makeStyles(c);
 */
export function useTheme(): { c: Colors; isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { c: isDark ? dark : light, isDark };
}
