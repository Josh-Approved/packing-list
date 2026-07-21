/**
 * TripCard — one trip on the Trips Home list (name, duration, type-icon row,
 * packed progress). Extracted verbatim from TripsHomeScreen.tsx (soft size
 * ceiling decomposition).
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { getTripTypeIcon, TRIP_TYPES, visibleItems, type Trip } from '../../data/trip';
import { t as tr } from '../../i18n';
import type { Colors } from '../../theme';
import { makeStyles } from './styles';

export function TripCard({
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
  // Exclude tombstoned items (they exist only for cross-device delete merges).
  const vis = visibleItems(trip);
  const totalCount = vis.length;
  const packedCount = vis.filter((i) => i.packed).length;
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
