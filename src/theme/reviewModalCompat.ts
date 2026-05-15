/**
 * Compatibility shim for the synced canonical ReviewModal.
 *
 * `templates/review-prompt/ReviewModal.tsx` is synced verbatim from the
 * factory and must NOT be forked per app (canonical rule). It imports a
 * theme API — `fontFamily`, `type`, `hairline` — that predates this app's
 * theme split (which exposes `typography`, inline sizes, and
 * StyleSheet.hairlineWidth instead). These app-local aliases bridge the gap
 * so the canonical modal compiles unmodified. Keep the names verbatim; the
 * modal's import list is the contract.
 */

import { StyleSheet } from 'react-native';
import { typography } from './typography';

export const fontFamily = {
  sans: typography.body,
  sansSemibold: typography.heading,
} as const;

export const type = {
  base: { fontSize: 16, lineHeight: 22 },
  sm: { fontSize: 14, lineHeight: 20 },
  md: { fontSize: 20, lineHeight: 28 },
} as const;

export const hairline = StyleSheet.hairlineWidth;
