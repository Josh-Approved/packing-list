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
import { useTheme, typography, radius, target, space } from '../theme';
import type { Colors } from '../theme';

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Override accessibilityLabel; defaults to `label`. */
  accessibilityLabel?: string;
};

export function Pill({ label, active = false, onPress, onLongPress, accessibilityLabel }: Props) {
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
      style={({ pressed }) => [s.container, pressed && onPress && s.pressed]}
    >
      <Text style={s.label} numberOfLines={1}>
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
      fontSize: 14,
      lineHeight: 20,
      color: active ? c.fg : c.fgMuted,
    },
  });
}
