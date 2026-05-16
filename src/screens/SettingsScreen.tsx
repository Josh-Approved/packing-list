/**
 * SettingsScreen — the canonical known destination for funding, feedback,
 * review, privacy, source, and version (canonical-requirements.md § Settings /
 * About screen).
 *
 * Packing List has no app-specific preferences yet, so this is About-only.
 * The five canonical entries are the floor, not the ceiling — app toggles
 * would sit above the About block when they exist.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Coffee, Mail, Star, Shield, Code } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, typography, space, target } from '../theme';
import type { Colors } from '../theme';
import { AboutRow } from '../components/AboutRow';
import {
  openBmac,
  openFeedback,
  openReview,
  openPrivacy,
  openSource,
  versionLabel,
} from '../lib/links';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
        </Pressable>
        <Text style={s.title} accessibilityRole="header">
          Settings
        </Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.sectionLabel}>About</Text>
        <View style={s.block}>
          <AboutRow icon={Coffee} label="Buy me a coffee?" onPress={openBmac} />
          <AboutRow icon={Mail} label="Send feedback" onPress={openFeedback} />
          <AboutRow icon={Star} label="Leave a review" onPress={openReview} />
          <AboutRow icon={Shield} label="Privacy" onPress={openPrivacy} />
          <AboutRow icon={Code} label="Source code" onPress={openSource} />
        </View>

        <Text style={s.version}>{versionLabel()}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      paddingHorizontal: space.s3,
      paddingTop: space.s2,
      paddingBottom: space.s2,
    },
    backBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtnPressed: { opacity: 0.6 },
    title: {
      fontFamily: typography.heading,
      fontSize: 20,
      lineHeight: 28,
      color: c.fg,
    },
    scroll: { flex: 1 },
    scrollContent: {
      paddingTop: space.s6,
      paddingBottom: space.s8,
    },
    sectionLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.3,
      color: c.fgMuted,
      paddingHorizontal: space.s5,
      paddingBottom: space.s3,
    },
    block: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    version: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 18,
      color: c.fgMuted,
      paddingHorizontal: space.s5,
      paddingTop: space.s6,
    },
  });
}
