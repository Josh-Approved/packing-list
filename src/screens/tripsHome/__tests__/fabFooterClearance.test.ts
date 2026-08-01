/**
 * Regression guard: the floating "+" FAB must not cover the funding footer's
 * buttons on the trips home screen.
 *
 * The geometry (all offsets measured up from the scroll view's bottom edge):
 *
 *   footer box   [P, P + H]        P = scrollContent.paddingBottom, H = footerHeight
 *   footer text  starts at P + H - space.s5   (FundingFooter's own paddingTop)
 *   FAB          [H + space.s4, H + space.s4 + 56]   (TripsHomeScreen lifts the
 *                                                     FAB by footerHeight + s4)
 *
 * The FAB's bottom edge intrudes into the footer's button row exactly when
 *
 *   H + space.s4  <  P + H - space.s5     ⟺     P > space.s4 + space.s5
 *
 * — note H cancels, so this is a pure relationship between the list's bottom
 * padding and two spacing tokens, independent of screen size and font scale.
 *
 * It broke in the v1.0.7 cycle: the funding-footer restyle (94bedd6) moved the
 * Support / Send feedback links into a bottom-anchored button row, while the
 * list kept a legacy space.s9 (64px) bottom padding from when the footer sat
 * inline. That put the FAB 52px into the footer and it clipped "Send feedback"
 * on every device — caught by the iPhone SE device-matrix cells.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { makeStyles } from '../styles';
import { space } from '../../../theme';
import type { Colors } from '../../../theme';

// makeStyles only reads colour values, so a bare stand-in is enough here.
const stubColors = new Proxy({}, { get: () => '#000000' }) as unknown as Colors;

describe('trips home — FAB clearance over the funding footer', () => {
  it('keeps the list bottom padding under the FAB lift, so the FAB clears the footer buttons', () => {
    const s = makeStyles(stubColors);
    const paddingBottom = StyleSheetFlatten(s.scrollContent).paddingBottom as number;

    expect(typeof paddingBottom).toBe('number');
    expect(paddingBottom).toBeLessThanOrEqual(space.s4 + space.s5);
  });

  it('still leaves the footer breathing room off the screen edge', () => {
    const s = makeStyles(stubColors);
    const paddingBottom = StyleSheetFlatten(s.scrollContent).paddingBottom as number;

    expect(paddingBottom).toBeGreaterThan(0);
  });
});

/** StyleSheet.create returns opaque ids on some RN versions; flatten defensively. */
function StyleSheetFlatten(style: unknown): Record<string, unknown> {
  const { StyleSheet } = require('react-native');
  return (StyleSheet.flatten(style) || {}) as Record<string, unknown>;
}
