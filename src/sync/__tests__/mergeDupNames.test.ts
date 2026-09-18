/**
 * Duplicate-name collapse — the merge behaviour that makes two devices' second
 * "Charger" row converge to ONE row carrying the household's real pack intent
 * (see merge.ts § DUPLICATE NAMES COLLAPSE DETERMINISTICALLY).
 *
 * `./mergePackedClock.test.ts` pins the packed state's own clock for two copies
 * of the SAME id. This file pins the other half — what happens when two
 * DIFFERENT ids share a normalized name+category:
 *
 *   • keepership: a tombstoned namesake never steals keepership from the live
 *     row; among live copies the freshest wins (updatedAt, then addedAt, then
 *     smallest id) identically from both merge directions.
 *   • losers are tombstoned at their own clock (drives the pruning horizon).
 *   • the pack fold picks its source from the group, NEVER from the keeper
 *     itself — the `it === keeper` skip in the fold loop. Without it the keeper
 *     folds onto itself and shadows the real fold source, but only when it
 *     happens to come second in the merged order, so the two phones settle on
 *     different `packedAt` values and the trip never converges.
 *   • a no-op fold preserves the keeper's object identity (memoized rows).
 *
 * Every scenario asserts BOTH merge directions: convergence is the contract.
 */

import { mergeTrip } from '../merge';
import type { Trip, TripItem } from '../../data/trip';

const SECRET = 'shared-secret-dup-names';
const T0 = 1_700_000_000_000;

function item(over: Partial<TripItem> & { id: string }): TripItem {
  return {
    name: 'Charger',
    category: 'Electronics',
    quantity: 1,
    assigneeId: 'shared',
    packed: false,
    source: 'custom',
    addedAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function tripWith(id: string, items: TripItem[]): Trip {
  return {
    id,
    name: 'Trip',
    nameUpdatedAt: T0,
    duration: 3,
    typeIds: ['hiking'],
    packers: [{ id: 'me', name: 'Me' }],
    items,
    createdAt: T0,
    updatedAt: T0,
    shareIdentity: { secret: SECRET, createdAt: T0 },
  };
}

/** Merge both directions and return both item sets — every assertion must
 *  hold on each (convergence). */
function bothWays(a: TripItem[], b: TripItem[]): TripItem[][] {
  return [
    mergeTrip(tripWith('a', a), tripWith('b', b)).items,
    mergeTrip(tripWith('b', b), tripWith('a', a)).items,
  ];
}

const live = (items: TripItem[]) => items.filter((i) => i.deletedAt == null);
const get = (items: TripItem[], id: string) => items.find((i) => i.id === id);

// ---------------------------------------------------------------------------
// Keepership — who survives a duplicate-name collapse
// ---------------------------------------------------------------------------

describe('duplicate-name collapse — keepership', () => {
  it('a tombstoned namesake never steals keepership from the live row', () => {
    // The dead copy has the NEWER content clock. If it could win keepership,
    // the live "Charger" would get tombstoned and the row would vanish from the
    // trip entirely — only LIVE copies compete.
    const liveRow = item({ id: 'live1', updatedAt: T0 + 100 });
    const deadRow = item({
      id: 'dead1',
      updatedAt: T0 + 500,
      deletedAt: T0 + 600,
    });
    for (const out of bothWays([liveRow], [deadRow])) {
      expect(get(out, 'live1')?.deletedAt).toBeUndefined(); // still on the list
      expect(get(out, 'dead1')?.deletedAt).toBe(T0 + 600); // still gone
      expect(live(out).map((i) => i.name)).toEqual(['Charger']);
    }
  });

  it('on an updatedAt tie the more recently ADDED copy survives, from both sides', () => {
    const older = item({ id: 'a1', quantity: 2, addedAt: T0 + 50, updatedAt: T0 + 100 });
    const newer = item({ id: 'b1', quantity: 5, addedAt: T0 + 80, updatedAt: T0 + 100 });
    for (const out of bothWays([older], [newer])) {
      expect(get(out, 'b1')?.deletedAt).toBeUndefined();
      expect(get(out, 'b1')?.quantity).toBe(5); // the keeper keeps its own content
      // The loser is tombstoned at its OWN clock (drives the pruning horizon).
      expect(get(out, 'a1')?.deletedAt).toBe(older.updatedAt);
    }
  });

  it('on a full clock tie the smallest id survives — identical on every device', () => {
    const aa = item({ id: 'aa', updatedAt: T0 + 100 });
    const bb = item({ id: 'bb', updatedAt: T0 + 100 });
    for (const out of bothWays([aa], [bb])) {
      expect(get(out, 'aa')?.deletedAt).toBeUndefined();
      expect(get(out, 'bb')?.deletedAt).toBe(T0 + 100);
    }
  });

  it('the same name in a DIFFERENT category is not a duplicate', () => {
    // Packing legitimately allows one "Charger" in Electronics and another in
    // Bags — the collapse identity is name AND category.
    const electronics = item({ id: 'e1', category: 'Electronics', updatedAt: T0 + 100 });
    const gear = item({ id: 'g1', category: 'Gear', updatedAt: T0 + 200 });
    for (const out of bothWays([electronics], [gear])) {
      expect(get(out, 'e1')?.deletedAt).toBeUndefined();
      expect(get(out, 'g1')?.deletedAt).toBeUndefined();
      expect(live(out)).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// The pack fold across a name group
// ---------------------------------------------------------------------------

describe('duplicate-name collapse — the pack fold', () => {
  it('two equal-clock unpacked copies that disagree only on packedAt converge from both directions', () => {
    // THE PIN for the `it === keeper` skip in the fold loop.
    //
    // The pack stamps of an incoming copy are NOT validated at the receive
    // boundary (store/trips.ts mergeRemoteTrip only heals FUTURE stamps and
    // advances our clock), so the merge must stay commutative for any pair the
    // TripItem type permits — including a peer whose `packed` and `packedAt`
    // disagree. Our own writers clear `packedAt` on an unpack; a peer on some
    // other build is not this function's invariant to assume.
    //
    // Both copies are unpacked with the SAME fold clock (T0+500), so neither
    // out-clocks the other and the tie keeps the unpacked source. They differ
    // only in `packedAt`. The keeper (the fresher content clock) must adopt the
    // group's fold source, and must do so regardless of which side the merge
    // starts from — otherwise the two phones settle on different `packedAt`
    // values and the trip never converges.
    //
    // Remove `if (it === keeper) continue;` from collapseDuplicateNames and
    // this goes red: the keeper folds onto ITSELF whenever it comes second in
    // the merged order, shadowing the real source on exactly one of the two
    // directions.
    const other = item({
      id: 'a1',
      updatedAt: T0 + 100,
      packed: false,
      packedAt: T0 + 200,
      packedUpdatedAt: T0 + 500,
    });
    const keeper = item({
      id: 'k1',
      updatedAt: T0 + 200,
      packed: false,
      packedAt: T0 + 300,
      packedUpdatedAt: T0 + 500,
    });
    for (const out of bothWays([other], [keeper])) {
      expect(get(out, 'k1')?.deletedAt).toBeUndefined(); // fresher copy keeps
      expect(get(out, 'a1')?.deletedAt).toBe(T0 + 100); // loser at its own clock
      expect(get(out, 'k1')?.packed).toBe(false);
      expect(get(out, 'k1')?.packedUpdatedAt).toBe(T0 + 500);
      // The fold source is the non-keeper copy on every device — the keeper is
      // never allowed to fold onto itself and shadow it.
      expect(get(out, 'k1')?.packedAt).toBe(T0 + 200);
    }
  });

  it("carries the group's newest pack clock onto the keeper (re-merge is a fixed point)", () => {
    // Both copies packed at the same moment, but the loser's pack clock has
    // advanced further (a fold on another device). The keeper must adopt the
    // newest clock or later merges could flip the state back and forth.
    const keeper = item({
      id: 'k1',
      updatedAt: T0 + 100,
      packed: true,
      packedAt: T0 + 50,
      packedUpdatedAt: T0 + 50,
    });
    const loser = item({
      id: 'l1',
      updatedAt: T0,
      packed: true,
      packedAt: T0 + 50,
      packedUpdatedAt: T0 + 80,
    });
    for (const out of bothWays([keeper], [loser])) {
      expect(get(out, 'k1')?.packed).toBe(true);
      expect(get(out, 'k1')?.packedUpdatedAt).toBe(T0 + 80);
    }
  });

  it('a no-op fold keeps the keeper object identity (memoized rows do not re-render)', () => {
    const keeper = item({ id: 'k1', updatedAt: T0 + 100 });
    const loser = item({ id: 'l1', updatedAt: T0 });
    const out = mergeTrip(tripWith('a', [keeper]), tripWith('b', [loser])).items;
    // The fold changes nothing about the keeper's pack state, so the exact same
    // object must come back — not a value-equal copy.
    expect(get(out, 'k1')).toBe(keeper);
  });
});
