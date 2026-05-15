/**
 * TripDetailScreen — single scrolling screen with all editing inline.
 *
 * Reads the trip from useTripsStore via route.params.tripId; dispatches every
 * change back through updateTrip(id, fn). State changes show up immediately
 * because Zustand selector re-renders the screen when the matched trip object
 * changes.
 *
 * Sections, top to bottom (per spec § Trip Detail):
 *   - In-screen header: back button + page chrome
 *   - Trip name (inline-editable) + packed progress
 *   - Duration stepper
 *   - Trip-type chip grid (multi-select; recomposes items)
 *   - Packers row (horizontal scroll + add)
 *   - Items grouped by category
 *
 * The assignee pill on each item row is HIDDEN when packers.length === 1 —
 * the field still exists internally and defaults to the sole packer; pills
 * appear automatically when a 2nd packer is added.
 *
 * Sticky bottom: an always-visible "Add an item" input. Tapping the category
 * pill cycles through CATEGORY_ORDER. Submitting either taps + or hits return.
 * If the typed name already exists (case-insensitive), its quantity is bumped
 * by 1 instead of duplicating the row.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, ChevronLeft, ChevronDown, GripVertical } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  NestedReorderableList,
  ScrollViewContainer,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  TRIP_TYPES,
  CATEGORY_ORDER,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  SHARED_ASSIGNEE,
  applyTypeToggle,
  applyDurationChange,
  groupByCategory,
  getTripTypeIcon,
  type Category,
  type TripTypeId,
  type TripItem,
  type Packer,
} from '../data/trip';
import { useTripsStore } from '../store/trips';
import { inferCategory } from '../data/categoryInference';
import { makeId } from '../lib/id';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import { Stepper } from '../components/Stepper';
import { Chip } from '../components/Chip';
import { Pill } from '../components/Pill';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'TripDetail'>;

// The items list is rendered as ONE reorderable list of interleaved rows:
// a non-draggable category header followed by that category's item rows.
// Dragging an item under a different header recategorizes it (see
// handleReorder). Headers carry no drag handle so they can't be dragged.
type FlatRow =
  | { kind: 'header'; category: Category }
  | { kind: 'item'; item: TripItem };

function buildFlatRows(
  grouped: Array<{ category: Category; items: TripItem[] }>
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const g of grouped) {
    rows.push({ kind: 'header', category: g.category });
    for (const it of g.items) rows.push({ kind: 'item', item: it });
  }
  return rows;
}

export default function TripDetailScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const { tripId } = route.params;
  const trip = useTripsStore((st) => st.trips.find((t) => t.id === tripId));
  const updateTrip = useTripsStore((st) => st.updateTrip);

  // Add-item local state (input text + selected category).
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState<Category>('Misc');
  // True once the user has manually picked a category for THIS draft —
  // we stop auto-inferring so we don't override their choice while they
  // keep typing. Resets to false on submit.
  const [userPickedCategory, setUserPickedCategory] = useState(false);

  // Per-item rename: which item is being edited inline + its in-progress name.
  // Tapping an item's name starts edit; submit/blur commits.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Undo state for item remove: capture the removed item + its position so we
  // can put it back if the user taps Undo within the snackbar's lifetime.
  const [recentlyRemoved, setRecentlyRemoved] = useState<{ item: TripItem; index: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // ---------- Handlers ----------

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleNameChange = useCallback((next: string) => {
    updateTrip(tripId, (t) => ({ ...t, name: next }));
  }, [updateTrip, tripId]);

  const handleDurationChange = useCallback((next: number) => {
    updateTrip(tripId, (t) => {
      const items = applyDurationChange(t, next);
      return { ...t, duration: next, items };
    });
  }, [updateTrip, tripId]);

  const handleTypeToggle = useCallback((typeId: TripTypeId) => {
    updateTrip(tripId, (t) => {
      const { typeIds, items } = applyTypeToggle(t, typeId);
      return { ...t, typeIds, items };
    });
  }, [updateTrip, tripId]);

  const handleQuantityChange = useCallback((itemId: string, next: number) => {
    updateTrip(tripId, (t) => ({
      ...t,
      items: t.items.map((it) =>
        it.id === itemId ? { ...it, quantity: next, userModified: true } : it
      ),
    }));
  }, [updateTrip, tripId]);

  const handleItemRemove = useCallback((itemId: string) => {
    // Capture the item + its position BEFORE removing so Undo can restore it.
    const current = useTripsStore.getState().trips.find((t) => t.id === tripId);
    if (!current) return;
    const idx = current.items.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    const removed = current.items[idx];
    if (!removed) return;

    updateTrip(tripId, (t) => ({
      ...t,
      items: t.items.filter((it) => it.id !== itemId),
    }));

    // Show snackbar; replace any prior pending undo (only the most-recent
    // remove is undoable — keeping a stack would surprise users).
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setRecentlyRemoved({ item: removed, index: idx });
    undoTimerRef.current = setTimeout(() => {
      setRecentlyRemoved(null);
      undoTimerRef.current = null;
    }, 5000);
  }, [updateTrip, tripId]);

  const handleUndoRemove = useCallback(() => {
    if (!recentlyRemoved) return;
    const { item, index } = recentlyRemoved;
    Haptics.selectionAsync().catch(() => {});
    updateTrip(tripId, (t) => ({
      ...t,
      items: [...t.items.slice(0, index), item, ...t.items.slice(index)],
    }));
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setRecentlyRemoved(null);
  }, [recentlyRemoved, updateTrip, tripId]);

  const handlePackedToggle = useCallback((itemId: string) => {
    Haptics.selectionAsync().catch(() => {});
    updateTrip(tripId, (t) => ({
      ...t,
      items: t.items.map((it) =>
        it.id === itemId ? { ...it, packed: !it.packed } : it
      ),
    }));
  }, [updateTrip, tripId]);

  const handleAssigneeCycle = useCallback((itemId: string) => {
    updateTrip(tripId, (t) => {
      const cycle: string[] = [SHARED_ASSIGNEE, ...t.packers.map((p) => p.id)];
      return {
        ...t,
        items: t.items.map((it) => {
          if (it.id !== itemId) return it;
          const idx = cycle.indexOf(it.assigneeId);
          const next = cycle[(idx + 1) % cycle.length] ?? SHARED_ASSIGNEE;
          return { ...it, assigneeId: next, userModified: true };
        }),
      };
    });
  }, [updateTrip, tripId]);

  const handlePackerLongPress = useCallback((packer: Packer) => {
    if (Platform.OS !== 'ios') return; // iOS-only for v1
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Rename', 'Remove', 'Cancel'],
        cancelButtonIndex: 2,
        destructiveButtonIndex: 1,
        title: packer.name,
      },
      (idx) => {
        if (idx === 0) {
          // Rename
          Alert.prompt(
            'Rename packer',
            undefined,
            (text) => {
              if (!text || !text.trim()) return;
              updateTrip(tripId, (t) => ({
                ...t,
                packers: t.packers.map((p) =>
                  p.id === packer.id ? { ...p, name: text.trim() } : p
                ),
              }));
            },
            'plain-text',
            packer.name
          );
        } else if (idx === 1) {
          // Remove — guard against removing the last packer.
          updateTrip(tripId, (t) => {
            if (t.packers.length <= 1) return t;
            return {
              ...t,
              packers: t.packers.filter((p) => p.id !== packer.id),
              // Items assigned to the removed packer fall back to shared.
              items: t.items.map((it) =>
                it.assigneeId === packer.id ? { ...it, assigneeId: SHARED_ASSIGNEE } : it
              ),
            };
          });
        }
      }
    );
  }, [updateTrip, tripId]);

  const handleReorder = useCallback(
    (evt: ReorderableListReorderEvent) => {
      const { from, to } = evt;
      if (from === to) return;
      updateTrip(tripId, (t) => {
        // Rebuild the exact flat rows the list rendered, apply the move,
        // then re-derive each item's category from the nearest preceding
        // header. An item dropped under a different header is recategorized;
        // one dropped above the first header keeps its original category
        // (invalid drop = no-op for that item).
        const flat = buildFlatRows(groupByCategory(t.items));
        if (from < 0 || from >= flat.length || to < 0 || to >= flat.length) {
          return t;
        }
        const moved = [...flat];
        const [picked] = moved.splice(from, 1);
        if (!picked || picked.kind !== 'item') return t; // headers don't move
        moved.splice(to, 0, picked);

        let current: Category | null = null;
        const next: TripItem[] = [];
        for (const row of moved) {
          if (row.kind === 'header') {
            current = row.category;
          } else {
            const cat = current ?? row.item.category;
            // Mark userModified on a category change so composeItems()
            // (type-toggle / duration change) preserves the manual move
            // instead of regenerating the item into its seed category.
            next.push(
              cat !== row.item.category
                ? { ...row.item, category: cat, userModified: true }
                : row.item
            );
          }
        }
        return { ...t, items: next };
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [updateTrip, tripId]
  );

  const handleAddPacker = useCallback(() => {
    if (Platform.OS === 'ios' && (Alert as { prompt?: typeof Alert.prompt }).prompt) {
      Alert.prompt(
        'Add packer',
        'Name',
        (text) => {
          if (!text || !text.trim()) return;
          const id = makeId('p');
          updateTrip(tripId, (t) => ({
            ...t,
            packers: [...t.packers, { id, name: text.trim() }],
          }));
        },
        'plain-text'
      );
    } else {
      updateTrip(tripId, (t) => ({
        ...t,
        packers: [
          ...t.packers,
          { id: makeId('p'), name: `Packer ${t.packers.length + 1}` },
        ],
      }));
    }
  }, [updateTrip, tripId]);

  const handleDraftNameChange = useCallback((text: string) => {
    setDraftName(text);
    // Auto-infer category from typed name UNLESS user has already manually
    // picked one for this draft. Inference returns null when nothing matches
    // — in that case keep whatever the user had.
    if (!userPickedCategory) {
      const inferred = inferCategory(text);
      if (inferred) setDraftCategory(inferred);
    }
  }, [userPickedCategory]);

  const handleStartEditItem = useCallback((it: TripItem) => {
    setEditingItemId(it.id);
    setEditingName(it.name);
  }, []);

  const handleFinishEditItem = useCallback(() => {
    if (!editingItemId) return;
    const trimmed = editingName.trim();
    const targetId = editingItemId;
    if (trimmed.length > 0) {
      updateTrip(tripId, (t) => ({
        ...t,
        items: t.items.map((it) =>
          it.id === targetId ? { ...it, name: trimmed, userModified: true } : it
        ),
      }));
    }
    setEditingItemId(null);
    setEditingName('');
  }, [editingItemId, editingName, updateTrip, tripId]);

  const handleCategoryPick = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (Platform.OS === 'ios') {
      const options = [...CATEGORY_ORDER, 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          title: 'Category',
        },
        (idx) => {
          if (idx >= 0 && idx < CATEGORY_ORDER.length) {
            const next = CATEGORY_ORDER[idx];
            if (next) {
              setDraftCategory(next);
              setUserPickedCategory(true);
            }
          }
        }
      );
    } else {
      // Android fallback: cycle (v1 is iOS-only; this is a safety net).
      setDraftCategory((cur) => {
        const idx = CATEGORY_ORDER.indexOf(cur);
        return CATEGORY_ORDER[(idx + 1) % CATEGORY_ORDER.length] ?? 'Misc';
      });
    }
  }, []);

  const handleAddItem = useCallback(() => {
    const name = draftName.trim();
    if (!name) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    updateTrip(tripId, (t) => {
      // Dedup-by-name (case-insensitive): bump existing instead of duplicating.
      const lower = name.toLowerCase();
      const existing = t.items.findIndex((it) => it.name.toLowerCase() === lower);
      if (existing >= 0) {
        return {
          ...t,
          items: t.items.map((it, i) =>
            i === existing ? { ...it, quantity: it.quantity + 1, userModified: true } : it
          ),
        };
      }
      const newItem: TripItem = {
        id: makeId('c'),
        name,
        category: draftCategory,
        quantity: 1,
        assigneeId: SHARED_ASSIGNEE,
        packed: false,
        source: 'custom',
      };
      return { ...t, items: [...t.items, newItem] };
    });
    setDraftName('');
    setUserPickedCategory(false); // reset for the next item
  }, [draftName, draftCategory, updateTrip, tripId]);

  // ---------- Derived ----------

  const groupedItems = useMemo(
    () => (trip ? groupByCategory(trip.items) : []),
    [trip]
  );

  const flatRows = useMemo(() => buildFlatRows(groupedItems), [groupedItems]);

  if (!trip) {
    // Trip vanished (unlikely in MVP — no delete from this screen yet).
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerBar}>
          <Pressable onPress={handleBack} hitSlop={12} style={s.backBtn} accessibilityLabel="Back">
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>
        <View style={s.missingWrap}>
          <Text style={s.missingText}>This trip no longer exists.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const itemsHeading = trip.typeIds.length === 0 ? 'Your list' : 'Suggested items';
  const packedCount = trip.items.filter((i) => i.packed).length;
  const totalCount = trip.items.length;
  const isSoloPacker = trip.packers.length === 1;

  const assigneeLabel = (id: string): string => {
    if (id === SHARED_ASSIGNEE) return 'Shared';
    return trip.packers.find((p) => p.id === id)?.name ?? 'Shared';
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={s.kbWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* In-screen header (back button) */}
        <View style={s.headerBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to trips"
          >
            <ChevronLeft size={24} color={c.fg} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollViewContainer
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Trip name + progress */}
          <View style={s.headerSection}>
            <TextInput
              value={trip.name}
              onChangeText={handleNameChange}
              placeholder="Untitled trip"
              placeholderTextColor={c.fgSubtle}
              style={s.title}
              accessibilityLabel="Trip name"
            />
            <Text style={s.progress}>
              {totalCount === 0 ? 'No items yet' : `${packedCount} of ${totalCount} packed`}
            </Text>
          </View>

          {/* Duration */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Duration</Text>
            <View style={s.durationRow}>
              <Stepper
                value={trip.duration}
                onChange={handleDurationChange}
                min={MIN_DURATION_DAYS}
                max={MAX_DURATION_DAYS}
                label="Trip duration in days"
              />
              <Text style={s.durationUnit}>{trip.duration === 1 ? 'day' : 'days'}</Text>
            </View>
          </View>

          {/* Trip types */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Trip types</Text>
            <View style={s.chipGrid}>
              {TRIP_TYPES.map((t) => (
                <Chip
                  key={t.id}
                  icon={getTripTypeIcon(t.iconName)}
                  label={t.name}
                  selected={trip.typeIds.includes(t.id)}
                  onPress={() => handleTypeToggle(t.id)}
                />
              ))}
            </View>
          </View>

          {/* Packers */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Packers</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.packersRow}
            >
              {trip.packers.map((p) => (
                <Pill
                  key={p.id}
                  label={p.name}
                  onLongPress={() => handlePackerLongPress(p)}
                  accessibilityLabel={`Packer ${p.name}, long press to rename or remove`}
                />
              ))}
              <Pressable
                onPress={handleAddPacker}
                style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Add packer"
              >
                <Plus size={18} color={c.fg} strokeWidth={1.5} />
              </Pressable>
            </ScrollView>
          </View>

          {/* Items */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>{itemsHeading}</Text>
            {flatRows.length === 0 ? (
              <Text style={s.empty}>
                Add a trip type above, or type an item below to start your list.
              </Text>
            ) : (
              <NestedReorderableList
                data={flatRows}
                keyExtractor={(row) =>
                  row.kind === 'header' ? `h-${row.category}` : row.item.id
                }
                scrollable={false}
                onReorder={handleReorder}
                renderItem={({ item: row }) =>
                  row.kind === 'header' ? (
                    <Text style={s.categoryHeading}>{row.category}</Text>
                  ) : (
                    <ItemRow
                      item={row.item}
                      isSoloPacker={isSoloPacker}
                      isEditing={editingItemId === row.item.id}
                      editingName={editingName}
                      assigneeLabel={assigneeLabel(row.item.assigneeId)}
                      onPackedToggle={() => handlePackedToggle(row.item.id)}
                      onQuantityChange={(n) => handleQuantityChange(row.item.id, n)}
                      onItemRemove={() => handleItemRemove(row.item.id)}
                      onAssigneeCycle={() => handleAssigneeCycle(row.item.id)}
                      onStartEdit={() => handleStartEditItem(row.item)}
                      onChangeEditingName={setEditingName}
                      onFinishEdit={handleFinishEditItem}
                      c={c}
                      s={s}
                    />
                  )
                }
              />
            )}
          </View>

          {/* Bottom spacer — must clear the sticky add-item bar (~target.min
              + paddingTop + paddingBottom incl. safe-area inset). Generous to
              avoid the just-added item being hidden under the bar. */}
          <View style={{ height: target.min + space.s7 + insets.bottom }} />
        </ScrollViewContainer>

        {/* ---------- Undo snackbar (above the sticky add-item bar) ---------- */}
        {recentlyRemoved && (
          <View style={s.undoBar} accessibilityLiveRegion="polite">
            <Text style={s.undoBarText} numberOfLines={1}>
              Removed "{recentlyRemoved.item.name}"
            </Text>
            <Pressable
              onPress={handleUndoRemove}
              style={({ pressed }) => [s.undoBarBtn, pressed && s.undoBarBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Undo removing ${recentlyRemoved.item.name}`}
            >
              <Text style={s.undoBarBtnLabel}>Undo</Text>
            </Pressable>
          </View>
        )}

        {/* ---------- Sticky bottom: Add an item ---------- */}
        <View style={[s.addItemBar, { paddingBottom: Math.max(space.s3, insets.bottom) }]}>
          <Pressable
            onPress={handleCategoryPick}
            style={({ pressed }) => [s.categoryPill, pressed && s.categoryPillPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Category ${draftCategory}, tap to change`}
          >
            <Text style={s.categoryPillLabel}>{draftCategory}</Text>
            <ChevronDown size={14} color={c.fgMuted} strokeWidth={1.5} />
          </Pressable>
          <TextInput
            value={draftName}
            onChangeText={handleDraftNameChange}
            onSubmitEditing={handleAddItem}
            placeholder="Add an item"
            placeholderTextColor={c.fgSubtle}
            returnKeyType="done"
            style={s.addItemInput}
            accessibilityLabel="New item name"
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
            accessibilityLabel="Add item"
          >
            <Plus size={20} color={draftName.trim() ? c.fgOnInk : c.fgSubtle} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Done FAB. The trip auto-saves continuously, so this is NOT a
          save-or-lose gate — it's a reachable "done editing, take me back"
          affordance (closure + one-handed exit; the top-left chevron does
          the same thing but is a stretch on a big phone). Anchored to the
          SafeAreaView (outside the keyboard-avoiding wrapper) so it stays
          put and floats clear, above the sticky add-item bar. */}
      <Pressable
        onPress={handleBack}
        style={({ pressed }) => [
          s.doneFab,
          { bottom: target.min + space.s6 + insets.bottom },
          pressed && s.doneFabPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Done editing this trip"
      >
        <Check size={24} color={c.fgOnInk} strokeWidth={2} />
      </Pressable>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    kbWrap: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: space.s5,
      paddingBottom: space.s4,
    },

    // ---------- Header bar (back button) ----------
    headerBar: {
      paddingHorizontal: space.s3,
      paddingTop: space.s2,
      paddingBottom: space.s2,
      flexDirection: 'row',
      alignItems: 'center',
    },
    backBtn: {
      width: target.min,
      height: target.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtnPressed: { opacity: 0.6 },

    // ---------- Missing-trip fallback ----------
    missingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s5,
    },
    missingText: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fgMuted,
    },

    // ---------- Trip name + progress ----------
    headerSection: {
      paddingTop: space.s3,
      paddingBottom: space.s5,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hairline,
      gap: space.s2,
    },
    title: {
      fontFamily: typography.heading,
      fontSize: 28,
      lineHeight: 36,
      color: c.fg,
      paddingVertical: 0,
    },
    progress: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
    },

    // ---------- Section frame ----------
    section: {
      paddingTop: space.s6,
      gap: space.s4,
    },
    sectionLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.fgMuted,
    },

    // ---------- Duration ----------
    durationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
    },
    durationUnit: {
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
    },

    // ---------- Chip grid ----------
    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.s3,
    },

    // ---------- Packers ----------
    packersRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingVertical: space.s2,
    },
    addBtn: {
      width: target.min,
      height: target.min,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnPressed: { opacity: 0.7 },

    // ---------- Items: empty + categories ----------
    empty: {
      fontFamily: typography.body,
      fontSize: 14,
      color: c.fgMuted,
      paddingVertical: space.s4,
    },
    categoryBlock: {
      gap: space.s2,
      paddingTop: space.s3,
    },
    categoryHeading: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 16,
      lineHeight: 24,
      color: c.fg,
      // Was wrapped in categoryBlock (paddingTop s3) before the single-list
      // refactor; carry that separation here so categories still breathe.
      paddingTop: space.s5,
      paddingBottom: space.s2,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingVertical: space.s3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hairline,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: c.hairlineStrong,
      backgroundColor: c.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxPressed: { backgroundColor: c.bgSubtle },
    checkboxOn: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    itemNameWrap: { flex: 1, minWidth: 0 },
    itemName: {
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
    },
    itemNamePacked: {
      color: c.fgSubtle,
      textDecorationLine: 'line-through',
    },
    itemNameEditing: {
      fontFamily: typography.body,
      fontSize: 16,
      lineHeight: 22,
      color: c.fg,
      paddingVertical: 0,
      borderBottomWidth: 1,
      borderBottomColor: c.appAccent,
    },
    dragHandle: {
      width: 24,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -space.s2,
    },

    // ---------- Sticky add-item bar ----------
    addItemBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s3,
      paddingHorizontal: space.s5,
      paddingTop: space.s3,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      backgroundColor: c.bgElevated,
    },
    categoryPill: {
      minHeight: target.min,
      paddingHorizontal: space.s4,
      paddingVertical: space.s2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
    },
    categoryPillPressed: { opacity: 0.6 },
    categoryPillLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 13,
      color: c.fgMuted,
    },
    addItemInput: {
      flex: 1,
      minHeight: target.min,
      fontFamily: typography.body,
      fontSize: 16,
      color: c.fg,
      paddingVertical: 0,
      paddingHorizontal: space.s2,
    },
    addItemBtn: {
      width: target.min,
      height: target.min,
      borderRadius: radius.pill,
      backgroundColor: c.fg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addItemBtnDisabled: {
      backgroundColor: c.bgSubtle,
    },
    addItemBtnPressed: { opacity: 0.85 },

    // ---------- Undo snackbar ----------
    // Sits above the sticky add-item bar. Ink-on-paper inverted to read as
    // a transient overlay. Hairline-only border keeps it from competing with
    // the add-item bar visually.
    undoBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.s4,
      paddingHorizontal: space.s5,
      paddingVertical: space.s3,
      backgroundColor: c.fg,
      marginHorizontal: space.s5,
      marginBottom: space.s2,
      borderRadius: radius.md,
      // Lone shadow exception per design system: floating overlay (snackbar).
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    undoBarText: {
      flex: 1,
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgOnInk,
    },
    undoBarBtn: {
      paddingHorizontal: space.s3,
      paddingVertical: space.s2,
      minHeight: target.min,
      justifyContent: 'center',
    },
    undoBarBtnPressed: {
      opacity: 0.6,
    },
    undoBarBtnLabel: {
      fontFamily: typography.bodyEmphasis,
      fontSize: 14,
      color: c.fgOnInk,
      textDecorationLine: 'underline',
    },

    // Done FAB. Ink circle + paper check, mirrors the "+" FAB on Trips Home
    // for a consistent floating-action language. `bottom` is set inline
    // (depends on safe-area insets) so it clears the sticky add-item bar.
    doneFab: {
      position: 'absolute',
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
    doneFabPressed: {
      opacity: 0.85,
    },
  });
}

// ============================================================================
// ItemRow — extracted as a real component so we can use the
// useReorderableDrag hook (must be inside a React component, not a render
// function). Defined outside TripDetailScreen so React doesn't unmount/
// remount on every parent render.
// ============================================================================

type ItemRowStyles = ReturnType<typeof makeStyles>;

interface ItemRowProps {
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
  c: Colors;
  s: ItemRowStyles;
}

function ItemRow({
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
  c,
  s,
}: ItemRowProps) {
  const drag = useReorderableDrag();

  return (
    <View style={s.itemRow}>
      {/* Drag handle — long-press to start drag. Subtle styling so it doesn't
          compete with the +/- and packed checkbox affordances. */}
      <Pressable
        onLongPress={drag}
        delayLongPress={250}
        style={s.dragHandle}
        accessibilityLabel={`Reorder ${item.name}`}
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
        accessibilityLabel={`${item.name} packed`}
      >
        {item.packed && <Check size={16} color={c.fgOnAccent} strokeWidth={2.25} />}
      </Pressable>

      <View style={s.itemNameWrap}>
        {isEditing ? (
          <TextInput
            value={editingName}
            onChangeText={onChangeEditingName}
            onBlur={onFinishEdit}
            onSubmitEditing={onFinishEdit}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            style={s.itemNameEditing}
            accessibilityLabel="Rename item"
          />
        ) : (
          <Pressable
            onPress={onStartEdit}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, tap to rename`}
          >
            <Text
              style={[s.itemName, item.packed && s.itemNamePacked]}
              numberOfLines={1}
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
        label={`Quantity of ${item.name}`}
      />

      {/* Assignee pill — hidden in solo-packer case (no UI noise) */}
      {!isSoloPacker && (
        <Pill
          label={assigneeLabel}
          active={item.assigneeId !== SHARED_ASSIGNEE}
          onPress={onAssigneeCycle}
          accessibilityLabel={`Assigned to ${assigneeLabel}, tap to change`}
        />
      )}
    </View>
  );
}
