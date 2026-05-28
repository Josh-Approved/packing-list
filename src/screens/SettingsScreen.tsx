/**
 * SettingsScreen — the single known destination reached via the header gear
 * on the trips list. Holds, top to bottom:
 *
 *   1. App settings — gender (tailors suggested basics) + iCloud backup.
 *   2. Your data — export / import all trips.
 *   3. About — the five canonical entries + version (canonical-requirements
 *      § Settings / About screen).
 *   4. The "josh approved" stamp (canonical attribution, mirrors FWT).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  HandHeart,
  Mail,
  Star,
  Shield,
  Code,
  Cloud,
  Upload,
  Download,
  Library,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import { boundedContent } from '../lib/layout';
import { AboutRow } from '../components/AboutRow';
import Wordmark from '../components/Wordmark';
import { useTripsStore } from '../store/trips';
import { useSettingsStore } from '../store/settings';
import { serializeTrips, parseTransfer, TransferError } from '../lib/transfer';
import {
  openBmac,
  openFeedback,
  openReview,
  openPrivacy,
  openSource,
  openStudio,
  versionLabel,
} from '../lib/links';
import { isCloudSyncAvailable } from '../../modules/cloud-sync';
import { syncNow, lastSyncAt } from '../sync/cloudSync';
import type { GenderPref } from '../data/trip';
import type { RootStackParamList } from '../../App';

function formatSince(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  const min = Math.round(d / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

const GENDER_OPTIONS: { label: string; value: GenderPref }[] = [
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' },
  { label: 'Prefer not to say', value: 'unspecified' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  const trips = useTripsStore((st) => st.trips);
  const importTrips = useTripsStore((st) => st.importTrips);
  const gender = useSettingsStore((st) => st.gender);
  const setGender = useSettingsStore((st) => st.setGender);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isCloudSyncAvailable) return;
    let alive = true;
    lastSyncAt().then((t) => {
      if (alive && t) setSyncMsg(`Last backed up ${formatSince(t)}`);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg('Backing up…');
    const r = await syncNow();
    switch (r.status) {
      case 'ok':
        setSyncMsg(
          r.pulled + r.pushed === 0
            ? 'Up to date'
            : `Backed up • ${r.pulled} in, ${r.pushed} out`
        );
        break;
      case 'noAccount':
        setSyncMsg('Sign in to iCloud to back up your trips.');
        break;
      case 'unavailable':
        setSyncMsg('iCloud backup needs the latest app version.');
        break;
      case 'restricted':
      case 'temporarilyUnavailable':
      case 'couldNotDetermine':
        setSyncMsg('iCloud is unavailable right now.');
        break;
      case 'error':
        setSyncMsg("Couldn't reach iCloud. It'll retry next time.");
        break;
    }
    setSyncing(false);
  }, [syncing]);

  const handleSetGender = useCallback(
    (g: GenderPref) => {
      if (g === gender) return;
      Haptics.selectionAsync().catch(() => {});
      setGender(g);
    },
    [gender, setGender]
  );

  const handleExport = useCallback(async () => {
    if (trips.length === 0) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const json = serializeTrips(trips);
      const stamp = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.cache, `packing-list-${stamp}.json`);
      // Overwrite any export made earlier the same day — the cache file is
      // a throwaway hand-off to the share sheet, not a stored artifact.
      if (file.exists) file.delete();
      file.create();
      file.write(json);
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Export unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: 'Export packing lists',
      });
    } catch {
      Alert.alert("Couldn't export", 'Something went wrong creating the export file.');
    }
  }, [trips]);

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const text = await new File(asset.uri).text();
      let imported;
      try {
        imported = parseTransfer(text);
      } catch (e) {
        const msg =
          e instanceof TransferError
            ? e.message
            : "This file isn't a Packing List export.";
        Alert.alert("Couldn't import", msg);
        return;
      }
      const n = importTrips(imported);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Import complete', `Added ${n} ${n === 1 ? 'trip' : 'trips'}.`);
    } catch {
      Alert.alert("Couldn't import", 'Something went wrong reading that file.');
    }
  }, [importTrips]);

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
        <Text style={s.sectionLabel}>Gender</Text>
        <View
          style={s.segmented}
          accessibilityRole="radiogroup"
          accessibilityLabel="Gender for suggested items"
        >
          {GENDER_OPTIONS.map((opt, i) => {
            const selected = opt.value === gender;
            return (
              <Pressable
                key={opt.value}
                onPress={() => handleSetGender(opt.value)}
                style={({ pressed }) => [
                  s.segment,
                  i > 0 && s.segmentDivider,
                  selected && s.segmentOn,
                  pressed && !selected && s.segmentPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.label}
              >
                <Text style={[s.segmentText, selected && s.segmentTextOn]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.caption}>
          Only used to pre-fill suggested items like bras or period products
          when a list is generated. Stays on this device.
        </Text>

        {isCloudSyncAvailable && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Backup</Text>
            <View style={s.block}>
              <AboutRow icon={Cloud} label="Back up to iCloud" onPress={handleSync} />
            </View>
            <Text style={s.caption}>
              {syncMsg ??
                'Your trips stay on this phone. Tap to also keep a private copy in your iCloud.'}
            </Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionLabel}>Your data</Text>
          <View style={s.block}>
            {trips.length > 0 && (
              <AboutRow icon={Upload} label="Export all trips" onPress={handleExport} />
            )}
            <AboutRow icon={Download} label="Import trips…" onPress={handleImport} />
          </View>
          <Text style={s.caption}>
            Export writes a JSON file you can save or share. Import always adds
            to your trips — it never replaces them.
          </Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>About</Text>
          <View style={s.block}>
            <AboutRow icon={HandHeart} label="Support this app" onPress={openBmac} />
            <AboutRow icon={Mail} label="Send feedback" onPress={openFeedback} />
            <AboutRow icon={Star} label="Leave a review" onPress={openReview} />
            <AboutRow icon={Shield} label="Privacy" onPress={openPrivacy} />
            <AboutRow icon={Code} label="Source code" onPress={openSource} />
            <AboutRow
              icon={Library}
              label="Acknowledgements"
              onPress={() => navigation.navigate('Acknowledgements')}
            />
          </View>
          <Text style={s.version}>{versionLabel()}</Text>
        </View>

        <View style={s.stamp}>
          <Wordmark />
          <Text style={s.stampText}>
            Privacy-first replacements for paywalled utility apps. Open source.
            Pay what you want.
          </Text>
          <Pressable
            onPress={openStudio}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Learn more about Josh Approved"
            accessibilityHint="Opens joshapproved.com in your browser"
            style={({ pressed }) => pressed && s.backBtnPressed}
          >
            <Text style={s.stampLink}>Learn more</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    headerBar: {
      ...boundedContent,
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
      ...boundedContent,
      paddingTop: space.s6,
      paddingBottom: space.s8,
    },
    section: {
      paddingTop: space.s6,
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

    // ---------- Gender segmented control ----------
    segmented: {
      flexDirection: 'row',
      marginHorizontal: space.s5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      minHeight: target.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s3,
      backgroundColor: c.bgElevated,
    },
    segmentDivider: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: c.hairlineStrong,
    },
    segmentOn: { backgroundColor: c.fg },
    segmentPressed: { backgroundColor: c.bgSubtle },
    segmentText: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 14,
      lineHeight: 20,
      color: c.fg,
      textAlign: 'center',
    },
    segmentTextOn: { color: c.fgOnInk },

    caption: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 18,
      color: c.fgMuted,
      paddingHorizontal: space.s5,
      paddingTop: space.s3,
    },
    version: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 18,
      color: c.fgMuted,
      paddingHorizontal: space.s5,
      paddingTop: space.s5,
    },

    // ---------- josh approved stamp ----------
    stamp: {
      alignItems: 'center',
      paddingTop: space.s8,
      paddingHorizontal: space.s6,
      gap: space.s3,
    },
    stampText: {
      fontFamily: typography.body,
      fontSize: 12,
      lineHeight: 16,
      color: c.fgMuted,
      textAlign: 'center',
    },
    stampLink: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      lineHeight: 16,
      color: c.fg,
      textDecorationLine: 'underline',
      textDecorationColor: c.hairlineStrong,
    },
  });
}
