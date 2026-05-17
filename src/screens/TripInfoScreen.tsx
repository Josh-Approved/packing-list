/**
 * TripInfoScreen — step 1 of building a list: the Trip Information screen.
 *
 * Two modes, decided by route.params.tripId:
 *   - CREATE (no tripId): a local draft. Nothing is persisted until the user
 *     taps Continue — backing out creates no trip (no orphan drafts). On
 *     Continue we mint the trip and `replace` into TripDetail, so the back
 *     gesture from the list goes to Trips Home, not back into this step.
 *   - EDIT (tripId present): reached from the condensed header on TripDetail.
 *     The draft is seeded from the trip; only Save commits (back = discard).
 *     Save recomposes the list, preserving the user's manual/custom edits.
 *
 * What's collected here (and nowhere else): name, duration, trip types,
 * thoroughness, and whether laundry is available + its cycle. Packers and the
 * items themselves stay on the packing list screen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  TRIP_TYPES,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  MIN_LAUNDRY_INTERVAL,
  MAX_LAUNDRY_INTERVAL,
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  applyTripInfo,
  getTripTypeIcon,
  tripOpts,
  type Thoroughness,
  type TripInfo,
  type TripTypeId,
} from '../data/trip';
import { useTripsStore } from '../store/trips';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import { Stepper } from '../components/Stepper';
import { Chip } from '../components/Chip';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'TripInfo'>;

const THOROUGHNESS_OPTIONS: {
  value: Thoroughness;
  label: string;
  blurb: string;
}[] = [
  {
    value: 'minimalist',
    label: 'Minimalist',
    blurb: 'Just the essentials. Pack light and do more laundry.',
  },
  {
    value: 'normal',
    label: 'Normal',
    blurb: 'The usual list — a solid checklist for most trips.',
  },
  {
    value: 'thorough',
    label: 'Thorough',
    blurb: 'Everything, including the just-in-case extras.',
  },
];

const DEFAULT_INFO: TripInfo = {
  name: '',
  duration: 3,
  typeIds: ['essentials'],
  canDoLaundry: false,
  laundryIntervalDays: LAUNDRY_DEFAULT_INTERVAL,
  thoroughness: THOROUGHNESS_DEFAULT,
};

export default function TripInfoScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const tripId = route.params?.tripId;
  const isEdit = tripId != null;

  const existingTrip = useTripsStore((st) =>
    isEdit ? st.trips.find((t) => t.id === tripId) : undefined
  );
  const createTrip = useTripsStore((st) => st.createTrip);
  const updateTrip = useTripsStore((st) => st.updateTrip);

  // Local draft. Seeded once from the trip in edit mode (legacy trips get
  // their missing laundry/thoroughness fields filled by tripOpts). In create
  // mode this is the only place the in-progress trip exists until Continue.
  const [draft, setDraft] = useState<TripInfo>(() => {
    if (existingTrip) {
      const o = tripOpts(existingTrip);
      return {
        name: existingTrip.name,
        duration: existingTrip.duration,
        typeIds: existingTrip.typeIds,
        canDoLaundry: o.canDoLaundry,
        laundryIntervalDays: o.laundryIntervalDays,
        thoroughness: o.thoroughness,
      };
    }
    return DEFAULT_INFO;
  });

  const set = useCallback(
    <K extends keyof TripInfo>(key: K, value: TripInfo[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    []
  );

  const toggleType = useCallback((id: TripTypeId) => {
    setDraft((d) => ({
      ...d,
      typeIds: d.typeIds.includes(id)
        ? d.typeIds.filter((t) => t !== id)
        : [...d.typeIds, id],
    }));
  }, []);

  const handleToggleLaundry = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setDraft((d) => ({ ...d, canDoLaundry: !d.canDoLaundry }));
  }, []);

  const handlePickThoroughness = useCallback((value: Thoroughness) => {
    Haptics.selectionAsync().catch(() => {});
    setDraft((d) => ({ ...d, thoroughness: value }));
  }, []);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleSubmit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isEdit && tripId) {
      updateTrip(tripId, (t) => ({ ...t, ...applyTripInfo(draft, t.items) }));
      navigation.goBack();
    } else {
      const id = createTrip(draft);
      // replace, not navigate: the wizard step shouldn't sit in the back
      // stack behind the list the user is now working in.
      navigation.replace('TripDetail', { tripId: id });
    }
  }, [isEdit, tripId, draft, updateTrip, createTrip, navigation]);

  const selectedBlurb = useMemo(
    () =>
      THOROUGHNESS_OPTIONS.find((o) => o.value === draft.thoroughness)?.blurb ??
      '',
    [draft.thoroughness]
  );

  // Edit mode for a trip that vanished (e.g. deleted on another device
  // mid-edit). Mirror TripDetail's missing-trip fallback.
  if (isEdit && !existingTrip) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerBar}>
          <Pressable onPress={handleBack} hitSlop={12} style={s.backBtn} accessibilityLabel="Back">
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>
        <View style={s.missingWrap}>
          <Text style={s.missingText}>This trip no longer exists.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={s.kbWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.headerBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, pressed && s.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? 'Back to packing list' : 'Back to trips'}
          >
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.title} accessibilityRole="header">
            Trip information
          </Text>
          <Text style={s.subtitle}>
            Set this up once. You can change it any time from the list.
          </Text>

          {/* Trip name */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Trip name</Text>
            <TextInput
              value={draft.name}
              onChangeText={(t) => set('name', t)}
              placeholder="Untitled trip"
              placeholderTextColor={c.fgSubtle}
              style={s.nameInput}
              returnKeyType="done"
              accessibilityLabel="Trip name"
            />
          </View>

          {/* Duration */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Duration</Text>
            <View style={s.row}>
              <Stepper
                value={draft.duration}
                onChange={(n) => set('duration', n)}
                min={MIN_DURATION_DAYS}
                max={MAX_DURATION_DAYS}
                label="Trip duration in days"
              />
              <Text style={s.unit}>{draft.duration === 1 ? 'day' : 'days'}</Text>
            </View>
          </View>

          {/* Trip types */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Trip types</Text>
            <View style={s.chipGrid}>
              {TRIP_TYPES.map((t) => (
                <Chip
                  key={t.id}
                  icon={getTripTypeIcon(t.iconName)}
                  label={t.name}
                  selected={draft.typeIds.includes(t.id)}
                  onPress={() => toggleType(t.id)}
                />
              ))}
            </View>
          </View>

          {/* Thoroughness */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>How thoroughly to pack</Text>
            <View style={s.segmented}>
              {THOROUGHNESS_OPTIONS.map((o, i) => {
                const active = draft.thoroughness === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => handlePickThoroughness(o.value)}
                    style={({ pressed }) => [
                      s.segment,
                      i > 0 && s.segmentDivider,
                      active && s.segmentActive,
                      pressed && s.pressedDim,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={o.label}
                  >
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.helper}>{selectedBlurb}</Text>
          </View>

          {/* Laundry */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Laundry</Text>
            <Pressable
              onPress={handleToggleLaundry}
              style={({ pressed }) => [s.checkRow, pressed && s.pressedDim]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.canDoLaundry }}
              accessibilityLabel="I can do laundry on this trip"
            >
              <View style={[s.checkbox, draft.canDoLaundry && s.checkboxOn]}>
                {draft.canDoLaundry && (
                  <Check size={16} color={c.fgOnAccent} strokeWidth={2.25} />
                )}
              </View>
              <Text style={s.checkLabel}>I can do laundry on this trip</Text>
            </Pressable>

            {draft.canDoLaundry && (
              <View style={s.laundryDetail}>
                <View style={s.row}>
                  <Stepper
                    value={draft.laundryIntervalDays}
                    onChange={(n) => set('laundryIntervalDays', n)}
                    min={MIN_LAUNDRY_INTERVAL}
                    max={MAX_LAUNDRY_INTERVAL}
                    label="Days between laundry"
                  />
                  <Text style={s.unit}>
                    {draft.laundryIntervalDays === 1
                      ? 'day between washes'
                      : 'days between washes'}
                  </Text>
                </View>
                <Text style={s.helper}>
                  Per-day items (underwear, socks, shirts) cover one wash cycle
                  instead of the whole trip, so the list won't balloon on a long
                  one.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Primary CTA — ink-on-paper per the design system. */}
        <View style={[s.ctaBar, { paddingBottom: Math.max(space.s4, insets.bottom) }]}>
          <Pressable
            onPress={handleSubmit}
            style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? 'Save trip information' : 'Continue to packing list'}
          >
            <Text style={s.ctaLabel}>{isEdit ? 'Save' : 'Continue'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    kbWrap: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: space.s5,
      paddingBottom: space.s8,
    },
    pressedDim: { opacity: 0.6 },

    headerBar: {
      paddingHorizontal: space.s3,
      paddingTop: space.s2,
      paddingBottom: space.s2,
      flexDirection: 'row',
      alignItems: 'center',
    },
    backBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
    },

    missingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s5,
    },
    missingText: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fgMuted,
    },

    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
      paddingTop: space.s3,
    },
    subtitle: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
      paddingTop: space.s2,
    },

    section: {
      paddingTop: space.s6,
      gap: space.s4,
    },
    sectionLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.fgMuted,
    },
    helper: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 19,
      color: c.fgMuted,
    },

    nameInput: {
      minHeight: target.min,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: radius.md,
      backgroundColor: c.bgElevated,
      paddingHorizontal: space.s4,
      paddingVertical: space.s3,
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
    },
    unit: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
    },

    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.s3,
    },

    // Segmented control — single-select, same visual language as Chip
    // (hairline frame, per-app accent wash + ink when active).
    segmented: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: radius.md,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      minHeight: target.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.s3,
      paddingHorizontal: space.s2,
    },
    segmentDivider: {
      borderLeftWidth: 1,
      borderLeftColor: c.hairline,
    },
    segmentActive: {
      backgroundColor: c.appAccentBg,
    },
    segmentLabel: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
    segmentLabelActive: {
      fontFamily: typography.bodyEmphasis,
      color: c.fg,
    },

    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      minHeight: target.min,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: c.hairlineStrong,
      backgroundColor: c.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    checkLabel: {
      flex: 1,
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
    },
    laundryDetail: {
      gap: space.s4,
      paddingTop: space.s1,
    },

    ctaBar: {
      paddingHorizontal: space.s5,
      paddingTop: space.s4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      backgroundColor: c.bgElevated,
    },
    cta: {
      minHeight: target.min,
      borderRadius: radius.pill,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.s4,
    },
    ctaPressed: { opacity: 0.85 },
    ctaLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      color: c.fgOnInk,
    },
  });
}
