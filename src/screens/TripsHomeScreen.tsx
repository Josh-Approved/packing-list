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

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTripsStore } from '../store/trips';
import { getTripTypeIcon, TRIP_TYPES, type Trip } from '../data/trip';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'TripsHome'>;

export default function TripsHomeScreen({ navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);

  const trips = useTripsStore((st) => st.trips);
  const createTrip = useTripsStore((st) => st.createTrip);
  const duplicateTrip = useTripsStore((st) => st.duplicateTrip);
  const updateTrip = useTripsStore((st) => st.updateTrip);
  const deleteTrip = useTripsStore((st) => st.deleteTrip);

  const handleNewTrip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Naming up-front means trips are always recognizable in the list — no
    // orphan "New trip" entries to rename later. Cancel = no trip created.
    if (Platform.OS === 'ios') {
      Alert.prompt(
        "What's this trip?",
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: (text?: string) => {
              if (!text || !text.trim()) return;
              const id = createTrip(text.trim());
              navigation.navigate('TripDetail', { tripId: id });
            },
          },
        ],
        'plain-text',
        ''
      );
    } else {
      // Android fallback (v1 is iOS-only).
      const id = createTrip('Untitled trip');
      navigation.navigate('TripDetail', { tripId: id });
    }
  }, [createTrip, navigation]);

  const handleTripLongPress = useCallback((trip: Trip) => {
    if (Platform.OS !== 'ios') return; // iOS-only for v1
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Duplicate', 'Rename', 'Delete', 'Cancel'],
        cancelButtonIndex: 3,
        destructiveButtonIndex: 2,
        title: trip.name,
      },
      (idx) => {
        if (idx === 0) {
          // Duplicate — create a copy and stay on the home screen so the user
          // sees both cards. They can rename or open from there.
          duplicateTrip(trip.id);
        } else if (idx === 1) {
          // Rename — Alert.prompt with current name as default.
          Alert.prompt(
            'Rename trip',
            undefined,
            (text?: string) => {
              if (!text || !text.trim()) return;
              updateTrip(trip.id, (t) => ({ ...t, name: text.trim() }));
            },
            'plain-text',
            trip.name
          );
        } else if (idx === 2) {
          // Delete — confirm before destroying. Two-step protects against
          // accidental long-press on a trip with real data in it.
          Alert.alert(
            `Delete "${trip.name}"?`,
            'This trip and its items will be removed. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => deleteTrip(trip.id),
              },
            ]
          );
        }
      }
    );
  }, [duplicateTrip, updateTrip, deleteTrip]);

  const isEmpty = trips.length === 0;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">
          Packing list
        </Text>
      </View>

      {isEmpty ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>No trips yet</Text>
          <Text style={s.emptyHint}>Create your first trip to get a checklist that fits.</Text>
          <Pressable
            onPress={handleNewTrip}
            style={({ pressed }) => [s.primaryBtn, pressed && s.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="New trip"
          >
            <Plus size={18} color={c.fgOnInk} strokeWidth={1.5} />
            <Text style={s.primaryBtnLabel}>New trip</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
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
          <View style={{ height: space.s9 }} />
        </ScrollView>
      )}

      {!isEmpty && (
        <Pressable
          onPress={handleNewTrip}
          style={({ pressed }) => [s.fab, pressed && s.fabPressed]}
          accessibilityRole="button"
          accessibilityLabel="New trip"
        >
          <Plus size={24} color={c.fgOnInk} strokeWidth={1.5} />
        </Pressable>
      )}
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
      accessibilityLabel={`${trip.name}, ${trip.duration} days, ${packedCount} of ${totalCount} packed. Long press for options.`}
    >
      <Text style={s.cardName} numberOfLines={1}>{trip.name}</Text>

      <View style={s.cardMetaRow}>
        <Text style={s.cardMeta}>
          {trip.duration} {trip.duration === 1 ? 'day' : 'days'}
        </Text>
        <Text style={s.cardMetaDot}>·</Text>
        <Text style={s.cardMeta}>
          {totalCount === 0 ? 'No items' : `${packedCount} of ${totalCount} packed`}
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
      paddingHorizontal: space.s5,
      paddingTop: space.s5,
      paddingBottom: space.s4,
    },
    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
    },

    // ---------- Empty state ----------
    emptyWrap: {
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
      color: c.fgOnInk,
    },

    // ---------- List ----------
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: space.s5,
      paddingBottom: space.s7,
      gap: space.s4,
    },

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
