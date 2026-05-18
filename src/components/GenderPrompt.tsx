/**
 * First-run gender prompt.
 *
 * Shown once, over the trips list, the first time the app opens. It only
 * tailors which gender-specific basics get suggested when a list is
 * generated — nothing else. Dismissing it ("Not now", the scrim, or
 * the hardware back button) leaves the preference 'unspecified' (no gendered
 * extras) and never asks again; it's always changeable in Settings.
 *
 * Visibility is derived from the settings store, so this can be rendered
 * unconditionally from the root screen. Styling mirrors the canonical
 * centered-card dialog (same scrim/card tokens); reduced motion drops the
 * present animation (WCAG 2.2 AA).
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSettingsStore } from '../store/settings';
import { useReducedMotion } from './Dialogs';
import {
  useTheme,
  fontFamily,
  space,
  radius,
  target,
  type as t,
  hairline,
  type Colors,
} from '../theme';
import type { GenderPref } from '../data/trip';

const CHOICES: { label: string; value: GenderPref }[] = [
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' },
  { label: 'Prefer not to say', value: 'unspecified' },
];

export default function GenderPrompt() {
  const { c } = useTheme();
  const s = makeStyles(c);
  const reduced = useReducedMotion();

  const hydrated = useSettingsStore((st) => st.hydrated);
  const seen = useSettingsStore((st) => st.genderPromptSeen);
  const setGender = useSettingsStore((st) => st.setGender);
  const dismiss = useSettingsStore((st) => st.dismissGenderPrompt);

  const visible = hydrated && !seen;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        style={s.overlay}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title} accessibilityRole="header">
            One quick thing
          </Text>
          <Text style={s.body}>
            Your gender only tailors which basics new trips suggest — it stays
            on this device and you can change it anytime in Settings.
          </Text>
          <View style={s.choices}>
            {CHOICES.map((ch) => (
              <Pressable
                key={ch.value}
                onPress={() => setGender(ch.value)}
                style={({ pressed }) => [s.choice, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityLabel={ch.label}
              >
                <Text style={s.choiceText}>{ch.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={dismiss}
            style={({ pressed }) => [s.notNow, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={s.notNowText}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    pressed: { opacity: 0.6 },
    overlay: {
      flex: 1,
      backgroundColor: c.bgScrim,
      justifyContent: 'center',
      alignItems: 'center',
      padding: space.s7,
    },
    card: {
      width: '100%',
      backgroundColor: c.bgElevated,
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
      padding: space.s7,
    },
    title: {
      ...t.md,
      fontFamily: fontFamily.sansSemibold,
      color: c.fg,
      marginBottom: space.s3,
    },
    body: {
      ...t.sm,
      fontFamily: fontFamily.sans,
      color: c.fgMuted,
      marginBottom: space.s6,
    },
    choices: {
      gap: space.s3,
    },
    choice: {
      minHeight: target.min,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s5,
    },
    choiceText: {
      ...t.base,
      fontFamily: fontFamily.sansMedium,
      color: c.fg,
    },
    notNow: {
      minHeight: target.min,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: space.s3,
    },
    notNowText: {
      ...t.base,
      fontFamily: fontFamily.sans,
      color: c.fgMuted,
    },
  });
}
