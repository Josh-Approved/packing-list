/**
 * Regression: a real pack ACTION is never undone by a copy that was merely BORN
 * later.
 *
 * Packing is the app where this can happen, because generated rows carry a
 * deterministic `gen-<rule>` id: two devices that each turn a trip type on while
 * apart mint the SAME row id independently, with their own creation stamps. Tick
 * the row off on one of them and the other's copy — untouched, but created later
 * — used to win the pack comparison, so the item silently came back unpacked
 * once the two synced. That is exactly the failure `packedUpdatedAt` exists to
 * prevent (merge.ts § PACKED MERGES ON ITS OWN CLOCK).
 *
 * Found by the shared-trip intent fuzzer (./intentFuzz.test.ts, oracle I2).
 */

import { mergeTrip } from '../merge';
import type { Trip, TripItem } from '../../data/trip';

const SECRET = 'shared-secret-packed';
const T0 = 1_700_000_000_000;

function trip(id: string, items: TripItem[], updatedAt: number): Trip {
  return {
    id,
    name: 'Trip',
    nameUpdatedAt: T0,
    duration: 3,
    typeIds: ['hiking'],
    packers: [{ id: 'me', name: 'Me' }],
    items,
    createdAt: T0,
    updatedAt,
    shareIdentity: { secret: SECRET, createdAt: T0 },
  };
}

function generated(patch: Partial<TripItem> & { addedAt: number }): TripItem {
  return {
    id: 'gen-hiking pants',
    name: 'Hiking pants',
    category: 'Clothing',
    quantity: 2,
    assigneeId: 'shared',
    packed: false,
    source: 'generated',
    updatedAt: patch.addedAt,
    ...patch,
  };
}

describe('mergeTrip — a pack action outranks a later-born copy', () => {
  it('keeps the pack when the peer regenerated the same row afterwards', () => {
    // Device A turned "hiking" on early and ticked the pants off.
    const packedCopy = generated({
      addedAt: T0 + 1_000,
      packed: true,
      packedAt: T0 + 5_000,
      packedUpdatedAt: T0 + 5_000,
    });
    // Device B, still apart, turned "hiking" on later — same deterministic id,
    // a fresh birth stamp, and no pack action of its own.
    const freshCopy = generated({ addedAt: T0 + 9_000 });

    const aThenB = mergeTrip(trip('a', [packedCopy], T0 + 5_000), trip('b', [freshCopy], T0 + 9_000));
    const bThenA = mergeTrip(trip('b', [freshCopy], T0 + 9_000), trip('a', [packedCopy], T0 + 5_000));

    expect(aThenB.items[0].packed).toBe(true);
    expect(bThenA.items[0].packed).toBe(true); // commutative — both devices agree
  });

  it('still lets a later real unpack win over an earlier pack', () => {
    const packed = generated({
      addedAt: T0 + 1_000,
      packed: true,
      packedAt: T0 + 5_000,
      packedUpdatedAt: T0 + 5_000,
    });
    const unpacked = generated({
      addedAt: T0 + 1_000,
      packed: false,
      packedUpdatedAt: T0 + 8_000,
    });

    const merged = mergeTrip(trip('a', [packed], T0 + 5_000), trip('b', [unpacked], T0 + 8_000));
    expect(merged.items[0].packed).toBe(false);
  });

  it('compares birth stamps when neither copy was ever touched', () => {
    const older = generated({ addedAt: T0 + 1_000, quantity: 2 });
    const newer = generated({ addedAt: T0 + 9_000, quantity: 5, updatedAt: T0 + 9_000 });

    const merged = mergeTrip(trip('a', [older], T0 + 1_000), trip('b', [newer], T0 + 9_000));
    expect(merged.items[0].packed).toBe(false);
    expect(merged.items[0].quantity).toBe(5); // content still resolves by its own clock
  });
});
