/**
 * addItemToTrip — the "Add an item" reducer, extracted from AddItemBar so the
 * policy it encodes is testable on its own (same pattern as `flatRows.ts`).
 *
 * The policy IS the promise the user experiences, and all three branches carry
 * cross-device weight, which is why the shared-trip intent fuzzer drives this
 * function rather than a copy of it (src/sync/simHarness.ts):
 *   - a name that matches a VISIBLE row bumps that row's quantity — typing a
 *     thing twice means "I need two", never two rows;
 *   - a name that matches a TOMBSTONED row revives that row as a fresh single
 *     need (quantity 1, unpacked, in the category being added under) — the
 *     store's diff clears the tombstone and stamps it, so the revive survives
 *     a merge instead of being re-buried by the peer's copy of the delete;
 *   - anything else appends a new custom item.
 *
 * Returns the next trip; the caller hands it to `updateTrip`, which owns every
 * merge clock (see store/trips.ts § stampTripUpdate).
 */

import { SHARED_ASSIGNEE, type Category, type Trip, type TripItem } from '../../data/trip';
import { makeId } from '../../lib/id';
import { now as clockNow } from '../../sync/clock';

export function addItemToTrip(t: Trip, name: string, category: Category): Trip {
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
              category,
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
    category,
    quantity: 1,
    assigneeId: SHARED_ASSIGNEE,
    packed: false,
    source: 'custom',
    addedAt: at,
    updatedAt: at,
  };
  return { ...t, items: [...t.items, newItem] };
}
