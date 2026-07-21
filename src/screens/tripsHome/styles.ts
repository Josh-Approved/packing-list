/**
 * Styles for TripsHomeScreen and its TripCard sub-view.
 * Extracted verbatim from TripsHomeScreen.tsx (soft size ceiling decomposition).
 */

import { StyleSheet } from 'react-native';
import { typography, space, target, radius } from '../../theme';
import type { Colors } from '../../theme';
import { boundedContent } from '../../theme';

export function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },

    header: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      paddingTop: space.s5,
      paddingBottom: space.s4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
    },
    menuBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
      // Pull toward the screen edge so the icon optically aligns with the
      // s5 content gutter rather than sitting target.min/2 inside it.
      marginRight: -space.s3,
    },
    menuBtnPressed: { opacity: 0.6 },

    // ---------- Empty state ----------
    emptyWrap: {
      ...boundedContent,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s7,
      gap: space.s4,
    },
    emptyTitle: {
      fontFamily: typography.heading,
      fontSize: 22,
      lineHeight: 28,
      color: c.fg,
    },
    emptyHint: {
      fontFamily: typography.body,
      fontSize: 15,
      lineHeight: 22,
      color: c.fgMuted,
      textAlign: 'center',
      marginBottom: space.s4,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingHorizontal: space.s6,
      paddingVertical: space.s4,
      backgroundColor: c.fg,
      borderRadius: radius.pill,
      minHeight: target.min,
    },
    primaryBtnPressed: {
      opacity: 0.85,
    },
    primaryBtnLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      color: c.inkButtonText,
    },

    // ---------- List ----------
    scroll: { flex: 1 },
    scrollContent: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      // Extra bottom room so the funding footer scrolls clear of the
      // floating "+" FAB rather than tucking under it at the list end.
      paddingBottom: space.s9,
      gap: space.s4,
    },
    footerHolder: { marginTop: 'auto' },

    // ---------- Card ----------
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      padding: space.s5,
      gap: space.s3,
    },
    cardPressed: {
      backgroundColor: c.bgSubtle,
    },
    cardName: {
      fontFamily: typography.heading,
      fontSize: 18,
      lineHeight: 24,
      color: c.fg,
    },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
    },
    cardMeta: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
    cardMetaDot: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
    cardIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      paddingTop: space.s1,
    },
    cardIconWrap: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardOverflow: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      color: c.fgMuted,
      paddingLeft: space.s1,
    },
    progressTrack: {
      height: 4,
      backgroundColor: c.bgSubtle,
      borderRadius: radius.pill,
      overflow: 'hidden',
      marginTop: space.s2,
    },
    progressFill: {
      height: '100%',
      backgroundColor: c.accent,
    },

    // ---------- FAB ----------
    fab: {
      position: 'absolute',
      bottom: space.s7,
      right: space.s5,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
      // Lone shadow exception per design system: floating overlay (FAB).
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
}
