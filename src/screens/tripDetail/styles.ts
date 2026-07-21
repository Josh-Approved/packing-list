/**
 * Styles for TripDetailScreen and its sub-views (ItemRow, add-item bar, undo
 * snackbar). Extracted verbatim from TripDetailScreen.tsx (soft size ceiling
 * decomposition).
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
      paddingBottom: space.s4,
    },

    // ---------- Header bar (back button) ----------
    headerBar: {
      ...boundedContent,
      paddingHorizontal: space.s3,
      paddingTop: space.s2,
      paddingBottom: space.s2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    backBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtnPressed: { opacity: 0.6 },

    // ---------- Missing-trip fallback ----------
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

    // ---------- Condensed trip-info header ----------
    tripInfoCard: {
      marginTop: space.s3,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      gap: space.s2,
    },
    tripInfoCardPressed: {
      backgroundColor: c.bgSubtle,
    },
    tripInfoTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.s3,
    },
    tripInfoName: {
      flex: 1,
      fontFamily: typography.heading,
      fontSize: 20,
      lineHeight: 26,
      color: c.fg,
    },
    tripInfoMeta: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 19,
      color: c.fgMuted,
    },
    progressText: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
      paddingTop: space.s4,
      paddingBottom: space.s1,
    },

    // ---------- Section frame ----------
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

    // ---------- Packers ----------
    packersRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingVertical: space.s2,
    },
    addBtn: {
      width: target.min,
      height: target.min,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnPressed: { opacity: 0.7 },

    // ---------- Items: empty + categories ----------
    empty: {
      fontFamily: typography.body,
      fontSize: 14,
      color: c.fgMuted,
      paddingVertical: space.s4,
    },
    categoryBlock: {
      gap: space.s2,
      paddingTop: space.s3,
    },
    categoryHeading: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      lineHeight: 24,
      color: c.fg,
      // Was wrapped in categoryBlock (paddingTop s3) before the single-list
      // refactor; carry that separation here so categories still breathe.
      paddingTop: space.s5,
      paddingBottom: space.s2,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingVertical: space.s3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hairline,
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
    checkboxPressed: { backgroundColor: c.bgSubtle },
    checkboxOn: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    itemNameWrap: { flex: 1, minWidth: 0 },
    itemName: {
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
    },
    itemNamePacked: {
      color: c.fgSubtle,
      textDecorationLine: 'line-through',
    },
    itemNameEditing: {
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
      paddingVertical: 0,
      borderBottomWidth: 1,
      borderBottomColor: c.appAccent,
    },
    dragHandle: {
      width: 24,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -space.s2,
    },

    // ---------- Sticky add-item bar ----------
    addItemBar: {
      ...boundedContent,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingHorizontal: space.s5,
      paddingTop: space.s3,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      backgroundColor: c.bgElevated,
    },
    categoryPill: {
      minHeight: target.min,
      paddingHorizontal: space.s4,
      paddingVertical: space.s2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
    },
    categoryPillPressed: { opacity: 0.6 },
    categoryPillLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 13,
      color: c.fgMuted,
    },
    addItemInput: {
      flex: 1,
      minHeight: target.min,
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
      paddingVertical: 0,
      paddingHorizontal: space.s2,
    },
    addItemBtn: {
      width: target.min,
      height: target.min,
      borderRadius: radius.pill,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addItemBtnDisabled: {
      backgroundColor: c.bgSubtle,
    },
    addItemBtnPressed: { opacity: 0.85 },

    // ---------- Undo snackbar ----------
    // Sits above the sticky add-item bar. Ink-on-paper inverted to read as
    // a transient overlay. Hairline-only border keeps it from competing with
    // the add-item bar visually.
    undoBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.s4,
      paddingHorizontal: space.s5,
      paddingVertical: space.s3,
      backgroundColor: c.fg,
      marginHorizontal: space.s5,
      marginBottom: space.s2,
      borderRadius: radius.md,
      // Lone shadow exception per design system: floating overlay (snackbar).
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    undoBarText: {
      flex: 1,
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.inkButtonText,
    },
    undoBarBtn: {
      paddingHorizontal: space.s3,
      paddingVertical: space.s2,
      minHeight: target.min,
      justifyContent: 'center',
    },
    undoBarBtnPressed: {
      opacity: 0.6,
    },
    undoBarBtnLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 14,
      color: c.inkButtonText,
      textDecorationLine: 'underline',
    },

    // Done FAB. Ink circle + paper check, mirrors the "+" FAB on Trips Home
    // for a consistent floating-action language. `bottom` is set inline
    // (depends on safe-area insets) so it clears the sticky add-item bar.
    doneFab: {
      position: 'absolute',
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
    doneFabPressed: {
      opacity: 0.85,
    },
  });
}

export type TripDetailStyles = ReturnType<typeof makeStyles>;
