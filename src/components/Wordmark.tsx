/**
 * The "josh approved" attribution stamp — wordmark + approval-green check.
 *
 * Canonical across the catalogue: same mark, same green, same placement
 * (Settings → bottom of About). Do not restyle per app. Mirrors the Free
 * Workout Timer reference implementation 1:1.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme, fontFamily, tracking, type as t } from '../theme';

export default function Wordmark() {
  const { c } = useTheme();
  return (
    <View style={s.row} accessible accessibilityRole="text" accessibilityLabel="josh approved">
      <Check size={14} color={c.accent} strokeWidth={3} />
      <Text
        style={[
          s.text,
          {
            color: c.fg,
            fontFamily: fontFamily.sansSemibold,
            letterSpacing: tracking.mark,
            ...t.base,
          },
        ]}
        importantForAccessibility="no"
      >
        josh approved
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: {},
});
