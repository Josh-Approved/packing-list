/**
 * Flat-row model for the Trip Detail items list.
 *
 * The items list is rendered as ONE reorderable list of interleaved rows:
 * a non-draggable category header followed by that category's item rows.
 * Dragging an item under a different header recategorizes it (see
 * handleReorder in useTripDetailHandlers). Headers carry no drag handle so
 * they can't be dragged.
 */

import type { Category, TripItem } from '../../data/trip';

export type FlatRow =
  | { kind: 'header'; category: Category }
  | { kind: 'item'; item: TripItem };

export function buildFlatRows(
  grouped: Array<{ category: Category; items: TripItem[] }>
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const g of grouped) {
    rows.push({ kind: 'header', category: g.category });
    for (const it of g.items) rows.push({ kind: 'item', item: it });
  }
  return rows;
}
