/**
 * Shared layout constants.
 *
 * The app is a single-column phone layout. On a tablet (supportsTablet: true)
 * the same screens would otherwise stretch edge-to-edge — very wide inputs,
 * list rows, and long line lengths. `boundedContent` caps the content to a
 * comfortable reading column and centers it. It's a no-op on phones, where the
 * screen is narrower than CONTENT_MAX_WIDTH, so phone layout is unchanged.
 *
 * Apply to the persistent surfaces of each screen — the header, the scroll
 * content, and the sticky bottom bars — so they line up as one centered
 * column. Screen-anchored overlays (the +/Done FABs, the transient Undo
 * snackbar) intentionally stay at the screen edge, which is the conventional
 * place for them on any size.
 */
import type { ViewStyle } from 'react-native';

export const CONTENT_MAX_WIDTH = 640;

export const boundedContent: ViewStyle = {
  width: '100%',
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: 'center',
};
