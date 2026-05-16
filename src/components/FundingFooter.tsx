/**
 * Tertiary funding/feedback text-link row — the quiet, primary-screen half of
 * the canonical dual placement (the loud half is the Settings/About block).
 *
 * Design system § BMAC + Send feedback placement: NOT a button. No background,
 * no border, no chrome. Lucide icon 1.5px/18px + label, both fgMuted, body
 * size, sentence case, pressed = 0.6 opacity. Present, not promotional — the
 * label is the entire pitch.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Coffee, Mail } from 'lucide-react-native';
import { useTheme, typography, space, target } from '../theme';
import type { Colors } from '../theme';
import { openBmac, openFeedback } from '../lib/links';

export function FundingFooter() {
  const { c } = useTheme();
  const s = makeStyles(c);

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={openBmac}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
        accessibilityRole="link"
        accessibilityLabel="Buy me a coffee"
      >
        <Coffee size={18} color={c.fgMuted} strokeWidth={1.5} />
        <Text style={s.label}>Buy me a coffee?</Text>
      </Pressable>
      <Pressable
        onPress={openFeedback}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
        accessibilityRole="link"
        accessibilityLabel="Send feedback"
      >
        <Mail size={18} color={c.fgMuted} strokeWidth={1.5} />
        <Text style={s.label}>Send feedback</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    wrap: {
      gap: space.s4,
      paddingVertical: space.s6,
      alignItems: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      minHeight: target.min,
    },
    pressed: { opacity: 0.6 },
    label: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
  });
}
