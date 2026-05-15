/**
 * Chip — trip-type toggle. Lucide icon + label, multi-select.
 *
 * Selected: filled with the per-app accent bg, ink fg, ink-colored icon.
 * Unselected: paper bg, hairline border, fgMuted text and icon.
 *
 * Per design system: no two different icons for selected vs unselected — same
 * icon, color shifts only. Sentence case label.
 */

import React, { useCallback } from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme, typography, radius, target, space } from '../theme';
import type { Colors } from '../theme';

type Props = {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function Chip({ icon: Icon, label, selected, onPress }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c, selected);

  const handlePress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [s.container, pressed && s.containerPressed]}
    >
      <View style={s.row}>
        <Icon
          size={18}
          color={selected ? c.fg : c.fgMuted}
          strokeWidth={1.5}
        />
        <Text style={s.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(c: Colors, selected: boolean) {
  return StyleSheet.create({
    container: {
      minHeight: target.min,
      paddingHorizontal: space.s4,
      paddingVertical: space.s3,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: selected ? c.appAccent : c.hairline,
      backgroundColor: selected ? c.appAccentBg : c.bgElevated,
      justifyContent: 'center',
    },
    containerPressed: {
      opacity: 0.7,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
    },
    label: {
      fontFamily: selected ? typography.bodyEmphasis : typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: selected ? c.fg : c.fgMuted,
    },
  });
}
