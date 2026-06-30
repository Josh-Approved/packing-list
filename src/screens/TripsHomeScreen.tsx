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
  StyleSheet,
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
import { getTripTypeIcon, TRIP_TYPES, type Trip } from '../data/trip';
import { t as tr } from '../i18n';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import { boundedContent } from '../theme';
import type { RootStackParamList } from '../../App';

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

// ----------------------------------------------------------------------------
// Trip card
// ----------------------------------------------------------------------------

function TripCard({
  trip,
  onPress,
  onLongPress,
  c,
}: {
  trip: Trip;
  onPress: () => void;
  onLongPress: () => void;
  c: Colors;
}) {
  const s = makeStyles(c);
  const totalCount = trip.items.length;
  const packedCount = trip.items.filter((i) => i.packed).length;
  const progress = totalCount > 0 ? packedCount / totalCount : 0;

  // Render up to 4 type icons; "+N" if more.
  const visibleTypes = trip.typeIds.slice(0, 4);
  const overflow = trip.typeIds.length - visibleTypes.length;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={tr('home.cardA11y', {
        name: trip.name,
        duration: trip.duration,
        packed: packedCount,
        total: totalCount,
      })}
    >
      <Text style={s.cardName} numberOfLines={1}>{trip.name}</Text>

      <View style={s.cardMetaRow}>
        <Text style={s.cardMeta}>
          {trip.duration} {trip.duration === 1 ? tr('common.day') : tr('common.days')}
        </Text>
        <Text style={s.cardMetaDot}>·</Text>
        <Text style={s.cardMeta}>
          {totalCount === 0
            ? tr('home.noItems')
            : tr('home.packedProgress', { packed: packedCount, total: totalCount })}
        </Text>
      </View>

      <View style={s.cardIconRow}>
        {visibleTypes.map((id) => {
          const def = TRIP_TYPES.find((t) => t.id === id);
          if (!def) return null;
          const Icon = getTripTypeIcon(def.iconName);
          return (
            <View key={id} style={s.cardIconWrap}>
              <Icon size={14} color={c.fgMuted} strokeWidth={1.5} />
            </View>
          );
        })}
        {overflow > 0 && (
          <Text style={s.cardOverflow}>+{overflow}</Text>
        )}
      </View>

      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </Pressable>
  );
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },

    header: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      paddingTop: space.s5,
      paddingBottom: space.s4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
    },
    menuBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
      // Pull toward the screen edge so the icon optically aligns with the
      // s5 content gutter rather than sitting target.min/2 inside it.
      marginRight: -space.s3,
    },
    menuBtnPressed: { opacity: 0.6 },

    // ---------- Empty state ----------
    emptyWrap: {
      ...boundedContent,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s7,
      gap: space.s4,
    },
    emptyTitle: {
      fontFamily: typography.heading,
      fontSize: 22,
      lineHeight: 28,
      color: c.fg,
    },
    emptyHint: {
      fontFamily: typography.body,
      fontSize: 15,
      lineHeight: 22,
      color: c.fgMuted,
      textAlign: 'center',
      marginBottom: space.s4,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingHorizontal: space.s6,
      paddingVertical: space.s4,
      backgroundColor: c.fg,
      borderRadius: radius.pill,
      minHeight: target.min,
    },
    primaryBtnPressed: {
      opacity: 0.85,
    },
    primaryBtnLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      color: c.inkButtonText,
    },

    // ---------- List ----------
    scroll: { flex: 1 },
    scrollContent: {
      ...boundedContent,
      paddingHorizontal: space.s5,
      // Extra bottom room so the funding footer scrolls clear of the
      // floating "+" FAB rather than tucking under it at the list end.
      paddingBottom: space.s9,
      gap: space.s4,
    },
    footerHolder: { marginTop: 'auto' },

    // ---------- Card ----------
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      padding: space.s5,
      gap: space.s3,
    },
    cardPressed: {
      backgroundColor: c.bgSubtle,
    },
    cardName: {
      fontFamily: typography.heading,
      fontSize: 18,
      lineHeight: 24,
      color: c.fg,
    },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
    },
    cardMeta: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },
    cardMetaDot: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgSubtle,
    },
    cardIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      paddingTop: space.s1,
    },
    cardIconWrap: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardOverflow: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      color: c.fgMuted,
      paddingLeft: space.s1,
    },
    progressTrack: {
      height: 4,
      backgroundColor: c.bgSubtle,
      borderRadius: radius.pill,
      overflow: 'hidden',
      marginTop: space.s2,
    },
    progressFill: {
      height: '100%',
      backgroundColor: c.accent,
    },

    // ---------- FAB ----------
    fab: {
      position: 'absolute',
      bottom: space.s7,
      right: space.s5,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
      // Lone shadow exception per design system: floating overlay (FAB).
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
}
