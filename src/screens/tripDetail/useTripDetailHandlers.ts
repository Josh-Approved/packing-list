/**
 * useTripDetailHandlers — navigation, item-mutation, packer and inline-rename
 * handlers for TripDetailScreen, plus the review-prompt trigger and the
 * inline-rename keyboard fix. Extracted verbatim from TripDetailScreen.tsx
 * (soft size ceiling decomposition).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollView, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { ReorderableListReorderEvent } from 'react-native-reorderable-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  SHARED_ASSIGNEE,
  groupByCategory,
  type Category,
  type TripItem,
  type Packer,
} from '../../data/trip';
import { useTripsStore } from '../../store/trips';
import { recordTripBuildIfEligible } from '../../lib/reviewTrigger';
import { useReviewModal } from '../../store/reviewModal';
import { useDonationModal } from '../../store/donationModal';
import { TIP_JAR_ENABLED } from '../../lib/links';
import { makeId } from '../../lib/id';
import { t as tr } from '../../i18n';
import { space } from '../../theme';
import { useActionMenu, usePrompt } from '../../components/Dialogs';
import type { RootStackParamList } from '../../../App';
import { buildFlatRows } from './flatRows';

type Navigation = NativeStackScreenProps<RootStackParamList, 'TripDetail'>['navigation'];

export function useTripDetailHandlers(
  tripId: string,
  navigation: Navigation,
  menu: ReturnType<typeof useActionMenu>,
  prompt: ReturnType<typeof usePrompt>
) {
  const updateTrip = useTripsStore((st) => st.updateTrip);

  // Per-item rename: which item is being edited inline + its in-progress name.
  // Tapping an item's name starts edit; submit/blur commits.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Inline-rename keyboard fix. The editing TextInput lives inside a nested
  // reorderable list whose ScrollViewContainer doesn't self-scroll a focused
  // field into view, so an item near the bottom ends up hidden behind the
  // keyboard. We hold a ref to the outer scroll view and to a wrapper around
  // its content; when a row starts editing it measures its own offset within
  // that content and we scroll it comfortably below the header (well clear of
  // the keyboard, which always covers the bottom).
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const scrollEditingIntoView = useCallback((node: TextInput | null) => {
    const content = contentRef.current;
    const sv = scrollRef.current;
    if (!node || !content || !sv) return;
    node.measureLayout(
      content,
      (_x, y) => sv.scrollTo({ y: Math.max(0, y - space.s7), animated: true }),
      () => {}
    );
  }, []);

  // Review prompt. The "satisfying success" for a packing app is finishing
  // the build of a trip's list — so we fire as the user *leaves* Trip Detail
  // with a non-empty list (beforeRemove covers the back chevron, the Done
  // FAB, and the swipe-back gesture). The skip-first + per-trip-dedupe policy
  // and the canonical threshold live in recordTripBuildIfEligible(); the
  // modal itself is mounted on Trips Home (this screen is unmounting).
  const showReviewModal = useReviewModal((s) => s.show);
  const showDonationModal = useDonationModal((s) => s.show);
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      const t = useTripsStore.getState().trips.find((x) => x.id === tripId);
      if (!t || t.items.length === 0) return;
      recordTripBuildIfEligible(tripId).then(({ review, donation }) => {
        if (review) showReviewModal();
        else if (TIP_JAR_ENABLED && donation) showDonationModal();
      });
    });
    return unsub;
  }, [navigation, tripId, showReviewModal, showDonationModal]);

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
          label: tr('common.rename'),
          onPress: () =>
            prompt.open({
              title: tr('detail.renamePacker'),
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
          label: tr('common.remove'),
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
      title: tr('detail.addPacker'),
      placeholder: tr('detail.packerNamePlaceholder'),
      confirmLabel: tr('common.add'),
      onSubmit: (name) => {
        const id = makeId('p');
        updateTrip(tripId, (t) => ({
          ...t,
          packers: [...t.packers, { id, name }],
        }));
      },
    });
  }, [prompt, updateTrip, tripId]);

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

  return {
    editingItemId,
    editingName,
    setEditingName,
    scrollRef,
    contentRef,
    scrollEditingIntoView,
    handleBack,
    handleOpenTripInfo,
    handleQuantityChange,
    handlePackedToggle,
    handleAssigneeCycle,
    handlePackerLongPress,
    handleReorder,
    handleAddPacker,
    handleStartEditItem,
    handleFinishEditItem,
  };
}
