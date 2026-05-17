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
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, ChevronLeft, ChevronRight, ChevronDown, GripVertical } from 'lucide-react-native';
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
  SHARED_ASSIGNEE,
  groupByCategory,
  tripOpts,
  type Category,
  type TripItem,
  type Packer,
} from '../data/trip';
import { useTripsStore } from '../store/trips';
import { recordTripBuildIfEligible } from '../lib/reviewTrigger';
import { useReviewModal } from '../store/reviewModal';
import { inferCategory } from '../data/categoryInference';
import { makeId } from '../lib/id';
import { useTheme, typography, space, target, radius } from '../theme';
import type { Colors } from '../theme';
import { Stepper } from '../components/Stepper';
import { Pill } from '../components/Pill';
import { useActionMenu, usePrompt } from '../components/Dialogs';
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

  const menu = useActionMenu();
  const prompt = usePrompt();

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

  // Review prompt. The "satisfying success" for a packing app is finishing
  // the build of a trip's list — so we fire as the user *leaves* Trip Detail
  // with a non-empty list (beforeRemove covers the back chevron, the Done
  // FAB, and the swipe-back gesture). The skip-first + per-trip-dedupe policy
  // and the canonical threshold live in recordTripBuildIfEligible(); the
  // modal itself is mounted on Trips Home (this screen is unmounting).
  const showReviewModal = useReviewModal((s) => s.show);
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      const t = useTripsStore.getState().trips.find((x) => x.id === tripId);
      if (!t || t.items.length === 0) return;
      recordTripBuildIfEligible(tripId).then((should) => {
        if (should) showReviewModal();
      });
    });
    return unsub;
  }, [navigation, tripId, showReviewModal]);

  // ---------- Handlers ----------

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleOpenTripInfo = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    navigation.navigate('TripInfo', { tripId });
  }, [navigation, tripId]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    menu.open({
      title: packer.name,
      options: [
        {
          label: 'Rename',
          onPress: () =>
            prompt.open({
              title: 'Rename packer',
              initialValue: packer.name,
              selectAll: true,
              onSubmit: (name) =>
                updateTrip(tripId, (t) => ({
                  ...t,
                  packers: t.packers.map((p) =>
                    p.id === packer.id ? { ...p, name } : p
                  ),
                })),
            }),
        },
        {
          label: 'Remove',
          destructive: true,
          // Guard against removing the last packer; its items fall back to
          // the shared assignee.
          onPress: () =>
            updateTrip(tripId, (t) => {
              if (t.packers.length <= 1) return t;
              return {
                ...t,
                packers: t.packers.filter((p) => p.id !== packer.id),
                items: t.items.map((it) =>
                  it.assigneeId === packer.id
                    ? { ...it, assigneeId: SHARED_ASSIGNEE }
                    : it
                ),
              };
            }),
        },
      ],
    });
  }, [menu, prompt, updateTrip, tripId]);

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
    prompt.open({
      title: 'Add packer',
      placeholder: 'Name',
      confirmLabel: 'Add',
      onSubmit: (name) => {
        const id = makeId('p');
        updateTrip(tripId, (t) => ({
          ...t,
          packers: [...t.packers, { id, name }],
        }));
      },
    });
  }, [prompt, updateTrip, tripId]);

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
    menu.open({
      title: 'Category',
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

  // One-line summary for the condensed header: duration · types · how
  // thorough · laundry (only when on). Legacy trips read sensible defaults
  // via tripOpts so the line is always complete.
  const o = tripOpts(trip);
  const typeNames = trip.typeIds
    .map((id) => TRIP_TYPES.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n);
  const typeSummary =
    typeNames.length === 0
      ? 'No trip types'
      : typeNames.length <= 2
        ? typeNames.join(', ')
        : `${typeNames.slice(0, 2).join(', ')} +${typeNames.length - 2}`;
  const metaParts = [
    `${trip.duration} ${trip.duration === 1 ? 'day' : 'days'}`,
    typeSummary,
    o.thoroughness.charAt(0).toUpperCase() + o.thoroughness.slice(1),
  ];
  if (o.canDoLaundry) {
    metaParts.push(
      `Laundry every ${o.laundryIntervalDays} ${o.laundryIntervalDays === 1 ? 'day' : 'days'}`
    );
  }
  const tripMeta = metaParts.join('  ·  ');

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
          {/* Condensed trip info — stays out of the way; tap to reopen the
              Trip Information step and edit name / duration / types /
              thoroughness / laundry. */}
          <Pressable
            onPress={handleOpenTripInfo}
            style={({ pressed }) => [s.tripInfoCard, pressed && s.tripInfoCardPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${trip.name}. ${tripMeta}. Edit trip information.`}
          >
            <View style={s.tripInfoTop}>
              <Text style={s.tripInfoName} numberOfLines={1}>
                {trip.name}
              </Text>
              <ChevronRight size={20} color={c.fgMuted} strokeWidth={1.5} />
            </View>
            <Text style={s.tripInfoMeta} numberOfLines={2}>
              {tripMeta}
            </Text>
          </Pressable>

          <Text style={s.progressText}>
            {totalCount === 0 ? 'No items yet' : `${packedCount} of ${totalCount} packed`}
          </Text>

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
          put and floats clear, above the sticky add-item bar.

          Hidden while the Undo snackbar is up: the FAB is anchored at the
          same bottom-right corner as the snackbar's Undo button and would
          cover it. The FAB is redundant (the back chevron does the same),
          so a briefly-absent FAB beats an un-tappable Undo. */}
      {!recentlyRemoved && (
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
      )}

      {menu.element}
      {prompt.element}
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

    // ---------- Condensed trip-info header ----------
    tripInfoCard: {
      marginTop: space.s3,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
      gap: space.s2,
    },
    tripInfoCardPressed: {
      backgroundColor: c.bgSubtle,
    },
    tripInfoTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.s3,
    },
    tripInfoName: {
      flex: 1,
      fontFamily: typography.heading,
      fontSize: 20,
      lineHeight: 26,
      color: c.fg,
    },
    tripInfoMeta: {
      fontFamily: typography.body,
      fontSize: 13,
      lineHeight: 19,
      color: c.fgMuted,
    },
    progressText: {
      fontFamily: typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.fgMuted,
      paddingTop: space.s4,
      paddingBottom: space.s1,
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
