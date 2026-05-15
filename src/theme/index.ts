// Synced from josh-approved-factory/templates/design-system/ — re-export the
// canonical typography + font loader, plus app-local color and token modules.

export { typography, fontFamilies } from './typography';
export type { TypographyRole, FontFamily } from './typography';
export { useAppFonts } from './useAppFonts';

export {
  appAccent,
  appAccentBg,
  lightColors,
  darkColors,
  useTheme,
} from './colors';
export type { Colors } from './colors';

export { space, radius, target, motion } from './tokens';

// Compatibility aliases for the synced canonical ReviewModal — see
// ./reviewModalCompat.ts. Not for general use; prefer `typography` etc.
export { fontFamily, type, hairline } from './reviewModalCompat';
