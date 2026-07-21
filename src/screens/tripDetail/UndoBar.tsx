/**
 * UndoBar — the transient "Removed <item> / Undo" snackbar shown above the
 * sticky add-item bar after an item remove. Extracted verbatim from
 * TripDetailScreen.tsx (soft size ceiling decomposition).
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { t as tr } from '../../i18n';
import type { TripDetailStyles } from './styles';

export function UndoBar({
  itemName,
  onUndo,
  s,
}: {
  itemName: string;
  onUndo: () => void;
  s: TripDetailStyles;
}) {
  return (
    <View style={s.undoBar} accessibilityLiveRegion="polite">
      <Text style={s.undoBarText} numberOfLines={1}>
        {tr('detail.removed', { name: itemName })}
      </Text>
      <Pressable
        onPress={onUndo}
        style={({ pressed }) => [s.undoBarBtn, pressed && s.undoBarBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel={tr('detail.undoA11y', { name: itemName })}
      >
        <Text style={s.undoBarBtnLabel}>{tr('detail.undo')}</Text>
      </Pressable>
    </View>
  );
}
