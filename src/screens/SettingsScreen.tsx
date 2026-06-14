/**
 * SettingsScreen — the single known destination reached via the header gear
 * on the trips list. Holds, top to bottom:
 *
 *   1. App settings — gender (tailors suggested basics).
 *   2. Your data — export / import all trips.
 *   3. About — the five canonical entries + version (canonical-requirements
 *      § Settings / About screen).
 *   4. The "josh approved" stamp (canonical attribution, mirrors FWT).
 */

import React, { useCallback } from 'react';
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
  Upload,
  Download,
  Library,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, typography, space, target, radius, AppearanceToggle } from '../theme';
import type { Colors } from '../theme';
import { boundedContent } from '../theme';
import { t } from '../i18n';
import { AboutRow } from '../components/AboutRow';
import { LanguageSetting } from '../components/LanguageSetting';
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
import type { GenderPref } from '../data/trip';
import type { RootStackParamList } from '../../App';

// Keys, not resolved strings — t() is called at render time (canon § Translations).
const GENDER_OPTIONS: { labelKey: string; value: GenderPref }[] = [
  { labelKey: 'gender.female', value: 'female' },
  { labelKey: 'gender.male', value: 'male' },
  { labelKey: 'gender.unspecified', value: 'unspecified' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  const trips = useTripsStore((st) => st.trips);
  const importTrips = useTripsStore((st) => st.importTrips);
  const gender = useSettingsStore((st) => st.gender);
  const setGender = useSettingsStore((st) => st.setGender);

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
        Alert.alert(t('settings.exportUnavailableTitle'), t('settings.exportUnavailableMessage'));
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: t('settings.exportDialogTitle'),
      });
    } catch {
      Alert.alert(t('settings.couldntExportTitle'), t('settings.couldntExportMessage'));
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
            : t('settings.notAnExport');
        Alert.alert(t('settings.couldntImportTitle'), msg);
        return;
      }
      const n = importTrips(imported);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        t('settings.importComplete'),
        n === 1
          ? t('settings.addedTripsOne', { count: n })
          : t('settings.addedTripsOther', { count: n })
      );
    } catch {
      Alert.alert(t('settings.couldntImportTitle'), t('settings.couldntImportMessage'));
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
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
        </Pressable>
        <Text style={s.title} accessibilityRole="header">
          {t('settings.title')}
        </Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.sectionLabel}>{t('gender.section')}</Text>
        <View
          style={s.segmented}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('gender.a11y')}
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
                accessibilityLabel={t(opt.labelKey)}
              >
                <Text style={[s.segmentText, selected && s.segmentTextOn]}>
                  {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.caption}>{t('gender.caption')}</Text>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('settings.appearance')}</Text>
          <AppearanceToggle />
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('settings.language')}</Text>
          <LanguageSetting />
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('settings.yourData')}</Text>
          <View style={s.block}>
            {trips.length > 0 && (
              <AboutRow icon={Upload} label={t('settings.exportAll')} onPress={handleExport} />
            )}
            <AboutRow icon={Download} label={t('settings.importTrips')} onPress={handleImport} />
          </View>
          <Text style={s.caption}>{t('settings.dataCaption')}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('settings.about')}</Text>
          <View style={s.block}>
            <AboutRow icon={HandHeart} label={t('about.support')} onPress={openBmac} />
            <AboutRow icon={Mail} label={t('about.feedback')} onPress={openFeedback} />
            <AboutRow icon={Star} label={t('about.review')} onPress={openReview} />
            <AboutRow icon={Shield} label={t('about.privacy')} onPress={openPrivacy} />
            <AboutRow icon={Code} label={t('about.source')} onPress={openSource} />
            <AboutRow
              icon={Library}
              label={t('about.acknowledgements')}
              onPress={() => navigation.navigate('Acknowledgements')}
            />
          </View>
          <Text style={s.version}>{versionLabel()}</Text>
        </View>

        <View style={s.stamp}>
          <Wordmark />
          <Text style={s.stampText}>{t('about.oneLiner')}</Text>
          <Pressable
            onPress={openStudio}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel={t('about.learnMoreA11y')}
            accessibilityHint={t('about.learnMoreHint')}
            style={({ pressed }) => pressed && s.backBtnPressed}
          >
            <Text style={s.stampLink}>{t('about.learnMore')}</Text>
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
