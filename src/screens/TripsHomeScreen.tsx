/**
 * TripsHomeScreen — root of the app.
 *
 * Empty state on first launch: "No trips yet" + a primary "+ New trip" CTA.
 * Once trips exist: a list of cards (name, duration, type-icon row, packed
 * progress) + a floating "+" button bottom-right.
 *
 * Tapping a card navigates to TripDetail with the trip's id.
 * Tapping "+" creates a new trip with smart defaults and navigates to it.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Settings } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTripsStore } from '../store/trips';
import ReviewModal from '../components/ReviewModal';
import TipJarSheet from '../components/TipJarSheet';
import GenderPrompt from '../components/GenderPrompt';
import { useActionMenu, usePrompt } from '../components/Dialogs';
import { GestureDetector } from 'react-native-gesture-handler';
import { FundingFooter } from '../components/FundingFooter';
import { usePullRevealFooter } from '../components/usePullRevealFooter';
import { useReviewModal } from '../store/reviewModal';
import { useDonationModal } from '../store/donationModal';
import { APP_STORE_ID, ANDROID_PACKAGE, TIP_JAR_ENABLED } from '../lib/links';
import { TIP_PRODUCT_IDS } from '../constants/tipProducts';
import { type Trip } from '../data/trip';
import { t as tr } from '../i18n';
import { useTheme, space } from '../theme';
import type { RootStackParamList } from '../../App';
import { TripCard } from './tripsHome/TripCard';
import { makeStyles } from './tripsHome/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'TripsHome'>;

export default function TripsHomeScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  const trips = useTripsStore((st) => st.trips);
  const duplicateTrip = useTripsStore((st) => st.duplicateTrip);
  const updateTrip = useTripsStore((st) => st.updateTrip);
  const deleteTrip = useTripsStore((st) => st.deleteTrip);

  // Review modal lives here (not Trip Detail): the completion is detected as
  // the user leaves Trip Detail, so the prompt surfaces once they're back.
  const reviewVisible = useReviewModal((st) => st.visible);
  const hideReview = useReviewModal((st) => st.hide);
  // The twice-only soft prompt — surfaced from Trip Detail via this store —
  // now opens the IAP tip jar instead of the BMAC link-out.
  const donationVisible = useDonationModal((st) => st.visible);
  const hideDonation = useDonationModal((st) => st.hide);

  // The quiet tertiary "Support this app" footer link opens the same sheet.
  const [tipVisible, setTipVisible] = useState(false);

  const menu = useActionMenu();
  const prompt = usePrompt();

  const {
    pullToReveal,
    reveal,
    gesture,
    onScrollJS,
    onScrollViewLayout,
    onContentSizeChange,
    footerHeight,
    onFooterLayout,
  } = usePullRevealFooter();

  const handleNewTrip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Step 1 is the Trip Information screen. The trip itself is only minted
    // when the user taps Continue there — backing out makes nothing, so
    // there are never orphan drafts to clean up.
    navigation.navigate('TripInfo');
  }, [navigation]);

  const handleTripLongPress = useCallback((trip: Trip) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    menu.open({
      title: trip.name,
      options: [
        // Duplicate — create a copy and stay on the home screen so the user
        // sees both cards. They can rename or open from there.
        { label: tr('home.duplicate'), onPress: () => duplicateTrip(trip.id) },
        {
          label: tr('common.rename'),
          onPress: () =>
            prompt.open({
              title: tr('home.renameTrip'),
              initialValue: trip.name,
              selectAll: true,
              onSubmit: (name) =>
                updateTrip(trip.id, (t) => ({ ...t, name })),
            }),
        },
        {
          label: tr('common.delete'),
          destructive: true,
          // Two-step confirm protects against an accidental long-press on a
          // trip with real data in it. Alert.alert is cross-platform.
          onPress: () =>
            Alert.alert(
              tr('home.deleteTitle', { name: trip.name }),
              tr('home.deleteMessage'),
              [
                { text: tr('common.cancel'), style: 'cancel' },
                {
                  text: tr('common.delete'),
                  style: 'destructive',
                  onPress: () => deleteTrip(trip.id),
                },
              ]
            ),
        },
      ],
    });
  }, [menu, prompt, duplicateTrip, updateTrip, deleteTrip]);

  const handleOpenSettings = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    navigation.navigate('Settings');
  }, [navigation]);

  const isEmpty = trips.length === 0;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">
          {tr('home.title')}
        </Text>
        <Pressable
          onPress={handleOpenSettings}
          hitSlop={12}
          style={({ pressed }) => [s.menuBtn, pressed && s.menuBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={tr('settings.title')}
        >
          <Settings size={22} color={c.fg} strokeWidth={1.5} />
        </Pressable>
      </View>

      {isEmpty ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>{tr('home.emptyTitle')}</Text>
          <Text style={s.emptyHint}>{tr('home.emptyHint')}</Text>
          <Pressable
            onPress={handleNewTrip}
            style={({ pressed }) => [s.primaryBtn, pressed && s.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={tr('home.newTrip')}
          >
            <Plus size={18} color={c.inkButtonText} strokeWidth={1.5} />
            <Text style={s.primaryBtnLabel}>{tr('home.newTrip')}</Text>
          </Pressable>
        </View>
      ) : null}

      {isEmpty ? (
        <FundingFooter onSupport={() => setTipVisible(true)} />
      ) : (
        <GestureDetector gesture={gesture}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { flexGrow: 1 }]}
          onScroll={pullToReveal ? onScrollJS : undefined}
          scrollEventThrottle={16}
          alwaysBounceVertical={pullToReveal}
          overScrollMode={pullToReveal ? 'never' : 'auto'}
          onLayout={onScrollViewLayout}
          onContentSizeChange={(_w, h) => onContentSizeChange(_w, h)}
        >
          {trips.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              onPress={() => navigation.navigate('TripDetail', { tripId: t.id })}
              onLongPress={() => handleTripLongPress(t)}
              c={c}
            />
          ))}
          <View style={s.footerHolder} onLayout={onFooterLayout}>
            <FundingFooter
              onSupport={() => setTipVisible(true)}
              reveal={reveal}
              pullToReveal={pullToReveal}
            />
          </View>
        </ScrollView>
        </GestureDetector>
      )}

      {!isEmpty && (
        <Pressable
          onPress={handleNewTrip}
          style={({ pressed }) => [
            s.fab,
            { bottom: footerHeight + space.s4 },
            pressed && s.fabPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={tr('home.newTrip')}
        >
          <Plus size={24} color={c.inkButtonText} strokeWidth={1.5} />
        </Pressable>
      )}

      <ReviewModal
        visible={reviewVisible}
        onDismiss={hideReview}
        appName="Packing List - Josh Approved"
        iosAppStoreId={APP_STORE_ID}
        androidPackageName={ANDROID_PACKAGE}
      />

      {TIP_JAR_ENABLED && donationVisible && (
        <TipJarSheet
          visible
          onDismiss={hideDonation}
          productIds={TIP_PRODUCT_IDS}
        />
      )}

      {TIP_JAR_ENABLED && tipVisible && (
        <TipJarSheet
          visible
          onDismiss={() => setTipVisible(false)}
          productIds={TIP_PRODUCT_IDS}
        />
      )}

      <GenderPrompt />

      {menu.element}
      {prompt.element}
    </SafeAreaView>
  );
}
