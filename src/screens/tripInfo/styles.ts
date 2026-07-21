/**
 * Styles for TripInfoScreen. Extracted verbatim from TripInfoScreen.tsx
 * (soft size ceiling decomposition).
 */

import { StyleSheet } from 'react-native';
import { typography, space, target, radius } from '../../theme';
import type { Colors } from '../../theme';
import { boundedContent } from '../../theme';

export function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    kbWrap: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      paddingBottom: space.s8,
    },
    pressedDim: { opacity: 0.6 },

    headerBar: {
      ...boundedContent,
      paddingHorizontal: space.s3,
      paddingTop: space.s2,
      paddingBottom: space.s2,
      flexDirection: 'row',
      alignItems: 'center',
    },
    backBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
    },

    missingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s5,
    },
    missingText: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fgMuted,
    },

    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
      paddingTop: space.s3,
    },
    subtitle: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
      paddingTop: space.s2,
    },

    section: {
      paddingTop: space.s6,
      gap: space.s4,
    },
    sectionLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.5,
      color: c.fgMuted,
    },
    helper: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 19,
      color: c.fgMuted,
    },

    nameInput: {
      minHeight: target.min,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: radius.md,
      backgroundColor: c.bgElevated,
      paddingHorizontal: space.s4,
      paddingVertical: space.s3,
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
    },
    unit: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
    },

    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.s3,
    },

    // Segmented control — single-select, same visual language as Chip
    // (hairline frame, per-app accent wash + ink when active).
    segmented: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: radius.md,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      minHeight: target.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.s3,
      paddingHorizontal: space.s2,
    },
    segmentDivider: {
      borderLeftWidth: 1,
      borderLeftColor: c.hairline,
    },
    segmentActive: {
      backgroundColor: c.appAccentBg,
    },
    segmentLabel: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
    segmentLabelActive: {
      fontFamily: typography.bodyEmphasis,
      color: c.fg,
    },

    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      minHeight: target.min,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: c.hairlineStrong,
      backgroundColor: c.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    checkLabel: {
      flex: 1,
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
    },
    laundryDetail: {
      gap: space.s4,
      paddingTop: space.s1,
    },

    ctaBar: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      paddingTop: space.s4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      backgroundColor: c.bgElevated,
    },
    cta: {
      minHeight: target.min,
      borderRadius: radius.pill,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.s4,
    },
    ctaPressed: { opacity: 0.85 },
    ctaLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      color: c.inkButtonText,
    },
  });
}
