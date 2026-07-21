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
import {
  CATEGORY_ORDER,
  SHARED_ASSIGNEE,
  type Category,
  type TripItem,
} from '../../data/trip';
import { useTripsStore } from '../../store/trips';
import { inferCategory } from '../../data/categoryInference';
import { makeId } from '../../lib/id';
import { now as clockNow } from '../../sync/clock';
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
    updateTrip(tripId, (t) => {
      const lower = name.toLowerCase();
      // Dedup-by-name against VISIBLE items (case-insensitive): bump instead of
      // duplicating. Tombstones are skipped so a re-add never silently bumps a
      // dead row.
      const visIdx = t.items.findIndex(
        (it) => it.deletedAt == null && it.name.toLowerCase() === lower
      );
      if (visIdx >= 0) {
        return {
          ...t,
          items: t.items.map((it, i) =>
            i === visIdx ? { ...it, quantity: it.quantity + 1, userModified: true } : it
          ),
        };
      }
      // A tombstoned match (previously removed) is revived instead of stacking a
      // second row — the store's diff clears its tombstone and stamps it fresh.
      const deadIdx = t.items.findIndex(
        (it) => it.deletedAt != null && it.name.toLowerCase() === lower
      );
      if (deadIdx >= 0) {
        return {
          ...t,
          items: t.items.map((it, i) =>
            i === deadIdx
              ? {
                  ...it,
                  deletedAt: undefined,
                  quantity: 1,
                  packed: false,
                  category: draftCategory,
                  userModified: true,
                }
              : it
          ),
        };
      }
      const at = clockNow();
      const newItem: TripItem = {
        id: makeId('c'),
        name,
        category: draftCategory,
        quantity: 1,
        assigneeId: SHARED_ASSIGNEE,
        packed: false,
        source: 'custom',
        addedAt: at,
        updatedAt: at,
      };
      return { ...t, items: [...t.items, newItem] };
    });
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
        accessibilityLabel={tr('detail.categoryA11y', { category: draftCategory })}
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
        placeholderTextColor={c.fgSubtle}
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
