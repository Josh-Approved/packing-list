/**
 * Secondary row for the Settings/About block.
 *
 * Design system § Settings / About screen: paper bg, full-width hairline
 * border, ink text + ink icon, Lucide 1.5px / 22px, sentence-case label,
 * right-aligned chevron. One component for all five canonical entries — no
 * per-row restyling.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useTheme, typography, space, target } from '../theme';
import type { Colors } from '../theme';

type Props = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
};

export function AboutRow({ icon: Icon, label, onPress }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={22} color={c.fg} strokeWidth={1.5} />
      <Text style={s.label}>{label}</Text>
      <ChevronRight size={20} color={c.fgSubtle} strokeWidth={1.5} />
    </Pressable>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      minHeight: target.min + space.s2,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      backgroundColor: c.bgElevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hairline,
    },
    pressed: { backgroundColor: c.bgSubtle },
    label: {
      flex: 1,
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
    },
  });
}
