/**
 * DoneFab — the floating "done editing, take me back" check button.
 *
 * The trip auto-saves continuously, so this is NOT a save-or-lose gate — it's
 * a reachable exit affordance (closure + one-handed exit; the top-left chevron
 * does the same thing but is a stretch on a big phone). Anchored to the
 * screen's SafeAreaView (outside the keyboard-avoiding wrapper) so it stays
 * put and floats clear, above the sticky add-item bar.
 *
 * The parent hides it while the Undo snackbar is up: the FAB is anchored at
 * the same bottom-right corner as the snackbar's Undo button and would cover
 * it. The FAB is redundant (the back chevron does the same), so a
 * briefly-absent FAB beats an un-tappable Undo.
 *
 * Extracted verbatim from TripDetailScreen.tsx (soft size ceiling
 * decomposition).
 */

import React from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { t as tr } from '../../i18n';
import { space, target } from '../../theme';
import type { Colors } from '../../theme';
import type { TripDetailStyles } from './styles';

export function DoneFab({
  onPress,
  c,
  s,
}: {
  onPress: () => void;
  c: Colors;
  s: TripDetailStyles;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.doneFab,
        { bottom: target.min + space.s6 + insets.bottom },
        pressed && s.doneFabPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={tr('detail.doneEditing')}
    >
      <Check size={24} color={c.inkButtonText} strokeWidth={2} />
    </Pressable>
  );
}
