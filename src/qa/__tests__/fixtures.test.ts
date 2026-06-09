/**
 * Tier-1 guard for the QA seed. A broken fixture silently poisons every Tier-2
 * screenshot/e2e run — the app would boot under QA_MODE with a malformed trip
 * and the capture would be wrong without anything failing loudly. So we assert
 * the seed is internally consistent: built by the app's own composition, valid
 * categories, real packers, and matching the anchors the journey targets.
 */

import { qaTrips } from '../fixtures';
import { CATEGORY_ORDER, SHARED_ASSIGNEE } from '../../data/trip';

describe('qaTrips — the QA_MODE seed', () => {
  const trips = qaTrips();

  it('seeds exactly one trip, the "Greece" demo the selectors anchor to', () => {
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.name).toBe('Greece'); // qa/selectors.json @first-trip = "Greece.*"
    expect(t.duration).toBe(4); // the row reads "Greece · 4 days"
    expect(t.typeIds).toEqual(['beach']);
  });

  it('carries the three pre-seeded packers (so the shared-packing screen needs no live typing)', () => {
    const t = trips[0];
    expect(t.packers.map((p) => p.name)).toEqual(['Me', 'Sam', 'Maya']);
    // Packer ids are unique and non-empty.
    const ids = t.packers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('produced a non-empty, well-formed item list via the app’s own composition', () => {
    const t = trips[0];
    expect(t.items.length).toBeGreaterThan(0);
    for (const item of t.items) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.quantity).toBeGreaterThan(0);
      expect(Number.isInteger(item.quantity)).toBe(true);
      // Every category is a real one the UI knows how to group.
      expect(CATEGORY_ORDER).toContain(item.category);
      // Nothing is pre-packed in the seed.
      expect(item.packed).toBe(false);
    }
  });

  it('every item assignee is either shared or a real seeded packer', () => {
    const t = trips[0];
    const valid = new Set<string>([SHARED_ASSIGNEE, ...t.packers.map((p) => p.id)]);
    for (const item of t.items) {
      expect(valid.has(item.assigneeId)).toBe(true);
    }
  });

  it('item ids are unique (a collision would break React keys + reorder)', () => {
    const ids = trips[0].items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic — fixed timestamps and a stable trip id', () => {
    const t = trips[0];
    expect(t.id).toBe('qa-greece');
    expect(t.createdAt).toBe(t.updatedAt);
    // A second call produces an identical trip (no live id/clock).
    expect(qaTrips()).toEqual(trips);
  });
});
