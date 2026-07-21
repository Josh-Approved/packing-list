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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Keyboard,
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
import { useSettingsStore } from '../store/settings';
import { t as tr } from '../i18n';
import { useTheme, space } from '../theme';
import { Stepper } from '../components/Stepper';
import { Chip } from '../components/Chip';
import type { RootStackParamList } from '../../App';
import { makeStyles } from './tripInfo/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'TripInfo'>;

// Keys, not resolved strings — t() is called at render time (canon § Translations).
const THOROUGHNESS_OPTIONS: {
  value: Thoroughness;
  labelKey: string;
  blurbKey: string;
}[] = [
  { value: 'minimalist', labelKey: 'trip.minimalist', blurbKey: 'trip.minimalistBlurb' },
  { value: 'normal', labelKey: 'trip.normal', blurbKey: 'trip.normalBlurb' },
  { value: 'thorough', labelKey: 'trip.thorough', blurbKey: 'trip.thoroughBlurb' },
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
  const gender = useSettingsStore((st) => st.gender);

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

  // Hide the primary CTA while the keyboard is up so people use the keyboard's
  // "done" key to leave the name field rather than tapping Continue and
  // committing a trip they haven't finished setting up. Tracked explicitly
  // (not via KeyboardAvoidingView) so it's deterministic on Android too, where
  // the default adjustResize would otherwise push the CTA above the keyboard.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Create mode opens straight into naming the trip: focus the name field once
  // the push animation settles (autoFocus is unreliable under native-stack).
  const nameInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (isEdit) return;
    const unsub = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) nameInputRef.current?.focus();
    });
    return unsub;
  }, [isEdit, navigation]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleSubmit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isEdit && tripId) {
      updateTrip(tripId, (t) => ({ ...t, ...applyTripInfo(draft, t.items, gender) }));
      navigation.goBack();
    } else {
      const id = createTrip(draft);
      // replace, not navigate: the wizard step shouldn't sit in the back
      // stack behind the list the user is now working in.
      navigation.replace('TripDetail', { tripId: id });
    }
  }, [isEdit, tripId, draft, gender, updateTrip, createTrip, navigation]);

  const selectedBlurbKey = useMemo(
    () =>
      THOROUGHNESS_OPTIONS.find((o) => o.value === draft.thoroughness)?.blurbKey ??
      '',
    [draft.thoroughness]
  );
  const selectedBlurb = selectedBlurbKey ? tr(selectedBlurbKey) : '';

  // Edit mode for a trip that vanished (e.g. deleted on another device
  // mid-edit). Mirror TripDetail's missing-trip fallback.
  if (isEdit && !existingTrip) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerBar}>
          <Pressable onPress={handleBack} hitSlop={12} style={s.backBtn} accessibilityLabel={tr('common.back')}>
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>
        <View style={s.missingWrap}>
          <Text style={s.missingText}>{tr('trip.missing')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.kbWrap}>
        <View style={s.headerBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, pressed && s.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? tr('trip.backToList') : tr('trip.backToTrips')}
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
            {tr('trip.title')}
          </Text>
          <Text style={s.subtitle}>
            {tr('trip.subtitle')}
          </Text>

          {/* Trip name */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{tr('trip.name')}</Text>
            <TextInput
              ref={nameInputRef}
              value={draft.name}
              onChangeText={(t) => set('name', t)}
              placeholder={tr('trip.namePlaceholder')}
              placeholderTextColor={c.fgSubtle}
              style={s.nameInput}
              returnKeyType="done"
              accessibilityLabel={tr('trip.nameA11y')}
            />
          </View>

          {/* Duration */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{tr('trip.duration')}</Text>
            <View style={s.row}>
              <Stepper
                value={draft.duration}
                onChange={(n) => set('duration', n)}
                min={MIN_DURATION_DAYS}
                max={MAX_DURATION_DAYS}
                label={tr('trip.durationStepper')}
              />
              <Text style={s.unit}>{draft.duration === 1 ? tr('common.day') : tr('common.days')}</Text>
            </View>
          </View>

          {/* Laundry */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{tr('trip.laundry')}</Text>
            <Pressable
              onPress={handleToggleLaundry}
              style={({ pressed }) => [s.checkRow, pressed && s.pressedDim]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.canDoLaundry }}
              accessibilityLabel={tr('trip.laundryToggle')}
            >
              <View style={[s.checkbox, draft.canDoLaundry && s.checkboxOn]}>
                {draft.canDoLaundry && (
                  <Check size={16} color={c.fgOnAccent} strokeWidth={2.25} />
                )}
              </View>
              <Text style={s.checkLabel}>{tr('trip.laundryToggle')}</Text>
            </Pressable>

            {draft.canDoLaundry && (
              <View style={s.laundryDetail}>
                <View style={s.row}>
                  <Stepper
                    value={draft.laundryIntervalDays}
                    onChange={(n) => set('laundryIntervalDays', n)}
                    min={MIN_LAUNDRY_INTERVAL}
                    max={MAX_LAUNDRY_INTERVAL}
                    label={tr('trip.laundryStepper')}
                  />
                  <Text style={s.unit}>
                    {draft.laundryIntervalDays === 1
                      ? tr('trip.washCycleOne')
                      : tr('trip.washCycleOther')}
                  </Text>
                </View>
                <Text style={s.helper}>
                  {tr('trip.laundryHelper')}
                </Text>
              </View>
            )}
          </View>

          {/* Trip types */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{tr('trip.types')}</Text>
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
            <Text style={s.sectionLabel}>{tr('trip.thoroughnessLabel')}</Text>
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
                    accessibilityLabel={tr(o.labelKey)}
                  >
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>
                      {tr(o.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.helper}>{selectedBlurb}</Text>
          </View>
        </ScrollView>

        {/* Primary CTA — ink-on-paper per the design system. Hidden while the
            keyboard is up so it can't be tapped instead of finishing the name. */}
        {!keyboardVisible && (
          <View style={[s.ctaBar, { paddingBottom: Math.max(space.s4, insets.bottom) }]}>
            <Pressable
              onPress={handleSubmit}
              style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel={isEdit ? tr('trip.saveA11y') : tr('trip.continueA11y')}
            >
              <Text style={s.ctaLabel}>{isEdit ? tr('common.save') : tr('trip.continue')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
