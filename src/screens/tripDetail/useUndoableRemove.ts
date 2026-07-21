/**
 * useUndoableRemove — item remove with a snackbar Undo window.
 *
 * Captures the removed item + its position so we can put it back if the user
 * taps Undo within the snackbar's lifetime. Extracted verbatim from
 * TripDetailScreen.tsx (soft size ceiling decomposition).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import type { TripItem } from '../../data/trip';
import { useTripsStore } from '../../store/trips';

export function useUndoableRemove(tripId: string) {
  const updateTrip = useTripsStore((st) => st.updateTrip);

  const [recentlyRemoved, setRecentlyRemoved] = useState<{ item: TripItem; index: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

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

  return { recentlyRemoved, handleItemRemove, handleUndoRemove };
}
