/**
 * Pill — generic compact label used for packers and assignee.
 *
 * - Packers row: each packer's name, long-press to rename/remove.
 * - Item-row assignee: tap to cycle through Shared → Packer 1 → ... → Shared.
 *
 * `active` controls visual emphasis: filled with appAccentBg + ink text when
 * true, paper + hairline + fgMuted when false. The screen decides what counts
 * as active (e.g., assignee that matches the row's current assigneeId).
 */

import React, { useCallback } from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme, typography, radius, target, space, type as ty } from '../theme';
import type { Colors } from '../theme';

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Override accessibilityLabel; defaults to `label`. */
  accessibilityLabel?: string;
  /**
   * What the control does, for VoiceOver. Keep the extra words HERE, not in
   * the label: Voice Control matches the label against what the user can see,
   * so "Assigned to Sam, tap to change" makes a pill reading "Sam" unspeakable.
   */
  accessibilityHint?: string;
};

export function Pill({
  label,
  active = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const { c } = useTheme();
  const s = makeStyles(c, active);

  const handlePress = useCallback(() => {
    if (!onPress) return;
    Haptics.selectionAsync().catch(() => {});
    onPress();
  }, [onPress]);

  const handleLongPress = useCallback(() => {
    if (!onLongPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onLongPress();
  }, [onLongPress]);

  return (
    <Pressable
      onPress={onPress ? handlePress : undefined}
      onLongPress={onLongPress ? handleLongPress : undefined}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      // `active` is drawn as accent fill + accent border + a heavier label.
      // Colour alone would be invisible to a colour-blind user and to
      // VoiceOver; the weight covers the first, this covers the second.
      accessibilityState={onPress ? { selected: active } : undefined}
      style={({ pressed }) => [s.container, pressed && onPress && s.pressed]}
    >
      <Text style={s.label} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(c: Colors, active: boolean) {
  return StyleSheet.create({
    container: {
      minHeight: target.min,
      paddingHorizontal: space.s4,
      paddingVertical: space.s2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: active ? c.appAccent : c.hairline,
      backgroundColor: active ? c.appAccentBg : c.bgElevated,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    pressed: {
      opacity: 0.7,
    },
    label: {
      fontFamily: active ? typography.bodyEmphasis : typography.body,
      ...ty.sm,
      color: active ? c.fg : c.fgMuted,
    },
  });
}
