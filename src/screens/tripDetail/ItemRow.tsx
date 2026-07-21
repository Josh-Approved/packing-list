/**
 * ItemRow — one item row on Trip Detail (drag handle, packed checkbox, name
 * with inline rename, quantity stepper, assignee pill).
 *
 * Extracted as a real component so we can use the useReorderableDrag hook
 * (must be inside a React component, not a render function). Defined outside
 * TripDetailScreen so React doesn't unmount/remount on every parent render.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Check, GripVertical } from 'lucide-react-native';
import { useReorderableDrag } from 'react-native-reorderable-list';
import { SHARED_ASSIGNEE, type TripItem } from '../../data/trip';
import { t as tr } from '../../i18n';
import type { Colors } from '../../theme';
import { Stepper } from '../../components/Stepper';
import { Pill } from '../../components/Pill';
import type { TripDetailStyles } from './styles';

export interface ItemRowProps {
  item: TripItem;
  isSoloPacker: boolean;
  isEditing: boolean;
  editingName: string;
  assigneeLabel: string;
  onPackedToggle: () => void;
  onQuantityChange: (n: number) => void;
  onItemRemove: () => void;
  onAssigneeCycle: () => void;
  onStartEdit: () => void;
  onChangeEditingName: (text: string) => void;
  onFinishEdit: () => void;
  onEditFocus: (node: TextInput | null) => void;
  c: Colors;
  s: TripDetailStyles;
}

export function ItemRow({
  item,
  isSoloPacker,
  isEditing,
  editingName,
  assigneeLabel,
  onPackedToggle,
  onQuantityChange,
  onItemRemove,
  onAssigneeCycle,
  onStartEdit,
  onChangeEditingName,
  onFinishEdit,
  onEditFocus,
  c,
  s,
}: ItemRowProps) {
  const drag = useReorderableDrag();

  // Select-all when inline edit opens, so the user can type straight over
  // the old name instead of backspacing it. `selectTextOnFocus` is
  // unreliable alongside `autoFocus` on iOS, so we drive `selection` from
  // state when edit opens and release control on the first user edit or
  // cursor move (otherwise a re-render would re-assert the full selection).
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  useEffect(() => {
    setSelection(isEditing ? { start: 0, end: editingName.length } : undefined);
    // Intentionally keyed only on isEditing: set the initial full selection
    // once when edit opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!isEditing) return;
    // Wait a beat so the row is laid out and the keyboard is animating in,
    // then lift the focused field clear of the keyboard.
    const id = setTimeout(() => onEditFocus(inputRef.current), 80);
    return () => clearTimeout(id);
  }, [isEditing, onEditFocus]);

  return (
    <View style={s.itemRow}>
      {/* Drag handle — long-press to start drag. Subtle styling so it doesn't
          compete with the +/- and packed checkbox affordances. */}
      <Pressable
        onLongPress={drag}
        delayLongPress={250}
        style={s.dragHandle}
        accessibilityLabel={tr('detail.reorderA11y', { name: item.name })}
        hitSlop={6}
      >
        <GripVertical size={16} color={c.fgSubtle} strokeWidth={1.5} />
      </Pressable>

      <Pressable
        onPress={onPackedToggle}
        hitSlop={8}
        style={({ pressed }) => [
          s.checkbox,
          item.packed && s.checkboxOn,
          pressed && s.checkboxPressed,
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.packed }}
        accessibilityLabel={tr('detail.itemPackedA11y', { name: item.name })}
      >
        {item.packed && <Check size={16} color={c.fgOnAccent} strokeWidth={2.25} />}
      </Pressable>

      <View style={s.itemNameWrap}>
        {isEditing ? (
          <TextInput
            ref={inputRef}
            value={editingName}
            onChangeText={(t) => {
              if (selection) setSelection(undefined);
              onChangeEditingName(t);
            }}
            onSelectionChange={() => {
              if (selection) setSelection(undefined);
            }}
            onBlur={onFinishEdit}
            onSubmitEditing={onFinishEdit}
            autoFocus
            selection={selection}
            returnKeyType="done"
            style={s.itemNameEditing}
            accessibilityLabel={tr('detail.renameItem')}
          />
        ) : (
          <Pressable
            onPress={onStartEdit}
            accessibilityRole="button"
            accessibilityLabel={tr('detail.itemRenameA11y', { name: item.name })}
          >
            <Text
              style={[s.itemName, item.packed && s.itemNamePacked]}
              numberOfLines={2}
            >
              {item.name}
            </Text>
          </Pressable>
        )}
      </View>

      <Stepper
        value={item.quantity}
        onChange={onQuantityChange}
        onRemove={onItemRemove}
        min={1}
        label={tr('detail.quantityOf', { name: item.name })}
      />

      {/* Assignee pill — hidden in solo-packer case (no UI noise) */}
      {!isSoloPacker && (
        <Pill
          label={assigneeLabel}
          active={item.assigneeId !== SHARED_ASSIGNEE}
          onPress={onAssigneeCycle}
          accessibilityLabel={tr('detail.assigneeA11y', { name: assigneeLabel })}
        />
      )}
    </View>
  );
}
