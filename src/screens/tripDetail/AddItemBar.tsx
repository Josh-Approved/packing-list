/**
 * AddItemBar — the sticky bottom "Add an item" bar on Trip Detail: category
 * pill (opens the category menu), name input, and the + button, plus the
 * local draft state and add/dedupe logic behind them.
 *
 * Tapping the category pill opens the category menu. Submitting either taps +
 * or hits return. If the typed name already exists (case-insensitive), its
 * quantity is bumped by 1 instead of duplicating the row.
 *
 * Extracted verbatim from TripDetailScreen.tsx (soft size ceiling
 * decomposition). The persistent-keyboard input (blurOnSubmit={false}) and its
 * empty-submit Keyboard.dismiss() escape deliberately live in this one file
 * (canon rn/keyboard-dismiss-escape).
 */

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { CATEGORY_ORDER, type Category } from '../../data/trip';
import { useTripsStore } from '../../store/trips';
import { inferCategory } from '../../data/categoryInference';
import { addItemToTrip } from './addItem';
import { t as tr } from '../../i18n';
import { space } from '../../theme';
import type { Colors } from '../../theme';
import type { useActionMenu } from '../../components/Dialogs';
import type { TripDetailStyles } from './styles';

export function AddItemBar({
  tripId,
  menu,
  activeLocale,
  c,
  s,
}: {
  tripId: string;
  menu: ReturnType<typeof useActionMenu>;
  activeLocale: string;
  c: Colors;
  s: TripDetailStyles;
}) {
  const insets = useSafeAreaInsets();
  const updateTrip = useTripsStore((st) => st.updateTrip);

  // Add-item local state (input text + selected category).
  const inputRef = useRef<TextInput>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState<Category>('Misc');
  // True once the user has manually picked a category for THIS draft —
  // we stop auto-inferring so we don't override their choice while they
  // keep typing. Resets to false on submit.
  const [userPickedCategory, setUserPickedCategory] = useState(false);

  const handleDraftNameChange = useCallback((text: string) => {
    setDraftName(text);
    // Auto-infer category from typed name UNLESS user has already manually
    // picked one for this draft. Inference returns null when nothing matches
    // — in that case keep whatever the user had.
    if (!userPickedCategory) {
      const inferred = inferCategory(text, activeLocale);
      if (inferred) setDraftCategory(inferred);
    }
  }, [userPickedCategory, activeLocale]);

  const handleCategoryPick = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    menu.open({
      title: tr('detail.category'),
      options: CATEGORY_ORDER.map((cat) => ({
        label: cat,
        onPress: () => {
          setDraftCategory(cat);
          setUserPickedCategory(true);
        },
      })),
    });
  }, [menu]);

  const handleAddItem = useCallback(() => {
    const name = draftName.trim();
    // blurOnSubmit={false} keeps the keyboard up after each add so you can
    // rapid-fire several items in a row. An empty submit means "done adding" —
    // drop the keyboard so the return key is never a dead end (mirrors
    // grocery-list's add box; canon rn/keyboard-dismiss-escape).
    if (!name) {
      Keyboard.dismiss();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // The dedupe/revive/append policy lives in ./addItem so the shared-trip
    // intent fuzzer drives the real thing rather than a copy.
    updateTrip(tripId, (t) => addItemToTrip(t, name, draftCategory));
    setDraftName('');
    setUserPickedCategory(false); // reset for the next item
    // Keep focus so the next item can be typed straight away.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [draftName, draftCategory, updateTrip, tripId]);

  return (
    <View style={[s.addItemBar, { paddingBottom: Math.max(space.s3, insets.bottom) }]}>
      <Pressable
        onPress={handleCategoryPick}
        style={({ pressed }) => [s.categoryPill, pressed && s.categoryPillPressed]}
        accessibilityRole="button"
        accessibilityLabel={draftCategory}
        accessibilityHint={tr('detail.categoryHint')}
      >
        <Text style={s.categoryPillLabel}>{draftCategory}</Text>
        <ChevronDown size={14} color={c.fgMuted} strokeWidth={1.5} />
      </Pressable>
      <TextInput
        ref={inputRef}
        value={draftName}
        onChangeText={handleDraftNameChange}
        onSubmitEditing={handleAddItem}
        blurOnSubmit={false}
        placeholder={tr('detail.addItemPlaceholder')}
        placeholderTextColor={c.fgMuted}
        returnKeyType="done"
        style={s.addItemInput}
        accessibilityLabel={tr('detail.newItemA11y')}
      />
      <Pressable
        onPress={handleAddItem}
        disabled={!draftName.trim()}
        style={({ pressed }) => [
          s.addItemBtn,
          !draftName.trim() && s.addItemBtnDisabled,
          pressed && draftName.trim() && s.addItemBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={tr('detail.addItem')}
      >
        <Plus size={20} color={draftName.trim() ? c.inkButtonText : c.fgSubtle} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
