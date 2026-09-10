/**
 * Regression fixtures for shared-trip defects THAT ACTUALLY HAPPENED.
 *
 * This is packing-list's copy of grocery-list's `reportedDefects.test.ts`
 * pattern: one named `describe` per record in the defect ledger
 * (`josh-approved-factory/defects/packing-list.jsonl`), pinning the defect at
 * the level a PERSON experienced it — the gestures they made and what they
 * expected to see afterwards — rather than at the level of the function that
 * was wrong. The unit test the defect closed on stays where it is; this file is
 * the second, independent net that fails if the same user-visible outcome ever
 * comes back through a different mechanism.
 *
 * WHY IT LOOKS DIFFERENT FROM GROCERY'S. grocery hand-rolls its own two-device
 * harness inside the test file because it was written before one existed.
 * packing already has that harness as a shared module (`../simHarness`) — the
 * real zustand trips store and the real logical clock, one isolated singleton
 * pair per simulated device, the wire modelled as the serialized trip that
 * `seal`/`open` carries. So this file reuses it instead of copying it. Every
 * clock, tombstone and merge decision below is the production code path.
 *
 * THE LEDGER, AS OF 2026-08-21. packing-list has exactly one CLOSED
 * sync-correctness defect, so this file starts with one entry. It is meant to
 * grow: when a shared-trip defect closes, add a `describe` here named for its
 * ledger id. (The other closed records are UX/contrast/geometry findings pinned
 * by their own tests, and the ledger's remaining sync entries are open
 * auto-filed jest-loader noise, not product defects — nothing to pin.)
 *
 *   D1  packing-list-20260820-1 — "Shared trip: a generated row's later birth
 *       stamp beat the other device's real pack, silently unpacking it."
 *       Two people each turn the same trip type on while apart. Trip-type seed
 *       rows are minted under a deterministic `gen-<rule>` id, so both devices
 *       independently create the SAME row id, each stamped with its own
 *       `addedAt`. One of them ticks an item off. On the next sync the other
 *       copy — untouched, but merely born later — used to win the packed
 *       comparison, and the item they had packed came back unpacked on BOTH
 *       devices. Fixed by `comparePackRecency` in `../merge`: a real pack
 *       ACTION always outranks a copy that was only born later.
 *
 *   D2  packing-list-20260910-1 — "Shared trip: the same item is listed twice
 *       after one person edits the trip while the other is packing."
 *       Both people are looking at a seeded row ("Toothpaste"). One nudges its
 *       quantity and then changes how long the trip is; recomposing the list
 *       used to hand that edited row a brand-new id, which only THAT phone
 *       knows about. The partner meanwhile nudges their own copy — still under
 *       the original `gen-<rule>` id — so the merge sees two unrelated records
 *       and keeps both, and every device ends up listing Toothpaste twice.
 *       Fixed in `../../data/trip` (composeItems keeps the row's id) with a
 *       healing net in `../merge` (the duplicate-name collapse no longer skips
 *       seed rows, so trips already split by the old build come back together).
 */

// Hermetic: mock everything the trips + settings stores touch beyond pure JS.
// (SQLite can't load in node; persistence is fire-and-forget and not the SUT.)
jest.mock('../../store/db', () => ({
  loadAllTrips: jest.fn(async () => []),
  saveTrip: jest.fn(async () => {}),
  deleteTripFromDb: jest.fn(async () => {}),
  getAppSetting: jest.fn(async () => null),
  setAppSetting: jest.fn(async () => {}),
}));
jest.mock('../../storage/kv', () => ({
  getSyncMeta: jest.fn(async () => null),
  setSyncMeta: jest.fn(async () => {}),
}));
jest.mock('../../qa/qaMode', () => ({ QA_MODE: false }));
jest.mock('../../qa/fixtures', () => ({ qaTrips: () => [] }));

import { normalizeItemName, type TripItem } from '../../data/trip';
import {
  type SimDev,
  type SimWorld,
  makeWorld,
  makeDev,
  on,
  converge,
  fingerprint,
  itemKey,
  setPacked,
  setQuantity,
  changeDuration,
  toggleType,
  visible,
} from '../simHarness';

// One Date.now mock for the whole file; each scenario swaps its world in.
const worldRef: { current: SimWorld | null } = { current: null };
let dateSpy: jest.SpyInstance<number, []>;
beforeAll(() => {
  dateSpy = jest
    .spyOn(Date, 'now')
    .mockImplementation(() =>
      worldRef.current
        ? worldRef.current.now + (worldRef.current.active?.skewMs ?? 0)
        : 1_750_000_000_000
    );
});
afterAll(() => dateSpy.mockRestore());

/** Two paired devices on one shared trip, both online and agreeing. */
function household(): { world: SimWorld; a: SimDev; b: SimDev; secret: string } {
  const world = makeWorld();
  worldRef.current = world;
  // Honest skew: phones NTP-sync within seconds. Kept non-zero so nothing here
  // silently depends on two devices sharing one wall clock.
  const a = makeDev(world, 'a', 0);
  const b = makeDev(world, 'b', 2_000);
  const tripId = on(a, () =>
    a.store.getState().createTrip({
      name: 'Trip',
      duration: 4,
      typeIds: ['essentials'],
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    })
  );
  const secret = on(a, () => a.store.getState().shareTrip(tripId))!;
  on(b, () => b.store.getState().joinShared(secret));
  converge([a, b], secret);
  return { world, a, b, secret };
}

/** The generated (seed) rows currently on this device — the `gen-<rule>` ids two
 *  devices mint independently and identically. */
function generatedRows(dev: SimDev, secret: string): TripItem[] {
  return visible(dev, secret).filter((it) => it.id.startsWith('gen-'));
}

/**
 * Turn a trip type on and return the seed rows it just contributed.
 *
 * Deliberately a DIFF, not "every gen- row": the trip already carries the
 * essentials type's rows, and those were minted at trip creation on device A
 * only, so picking one of them would not reproduce the defect (which needs a
 * row BOTH devices mint independently, each with its own birth stamp).
 */
function enableTypeAndSeededRows(
  dev: SimDev,
  secret: string,
  typeId: Parameters<typeof toggleType>[2]
): TripItem[] {
  const before = new Set(generatedRows(dev, secret).map((it) => it.id));
  toggleType(dev, secret, typeId);
  return generatedRows(dev, secret).filter((it) => !before.has(it.id));
}

function rowById(dev: SimDev, secret: string, id: string): TripItem | undefined {
  return visible(dev, secret).find((it) => it.id === id);
}

// ---------------------------------------------------------------------------
// D1 — packing-list-20260820-1
// ---------------------------------------------------------------------------

describe('D1 (packing-list-20260820-1): a pack survives the partner turning the same trip type on later', () => {
  test('both people enable "hiking" while apart, one packs a seeded row → it stays packed on BOTH devices', () => {
    const { world, a, b, secret } = household();

    // Apart. A turns hiking on and ticks one of its seeded rows off.
    world.now += 60 * 60_000;
    const seeded = enableTypeAndSeededRows(a, secret, 'hiking');
    expect(seeded.length).toBeGreaterThan(0); // the type really seeds rows
    const target = seeded[0];
    expect(target.packed).toBe(false);

    world.now += 5 * 60_000;
    setPacked(a, secret, target.id, true);
    expect(rowById(a, secret, target.id)!.packed).toBe(true);

    // Still apart, LATER: B turns the same type on. Same deterministic id,
    // a fresh birth stamp, no pack action of its own. This is the defect's
    // exact shape — the losing copy is younger than the winning action.
    world.now += 30 * 60_000;
    toggleType(b, secret, 'hiking');
    const bCopy = rowById(b, secret, target.id);
    expect(bCopy).toBeDefined(); // both devices minted the SAME row id
    expect(bCopy!.addedAt).toBeGreaterThan(target.addedAt); // born later
    expect(bCopy!.packed).toBe(false);

    // Back in range.
    world.now += 60_000;
    converge([a, b], secret);

    // The reported symptom: the item they had ticked off came back unpacked,
    // on both devices at once.
    expect(rowById(a, secret, target.id)?.packed).toBe(true);
    expect(rowById(b, secret, target.id)?.packed).toBe(true);
    // …and the two devices genuinely agree on everything they show.
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });

  test('the guard is a tie-break, not "packed always wins": a genuinely later unpack still wins', () => {
    const { world, a, b, secret } = household();

    world.now += 60 * 60_000;
    const target = enableTypeAndSeededRows(a, secret, 'hiking')[0];
    world.now += 5 * 60_000;
    setPacked(a, secret, target.id, true);

    // B sees the pack, then a person on B unpacks it for real, later.
    world.now += 60_000;
    converge([a, b], secret);
    expect(rowById(b, secret, target.id)!.packed).toBe(true);

    world.now += 20 * 60_000;
    setPacked(b, secret, target.id, false);
    world.now += 60_000;
    converge([a, b], secret);

    expect(rowById(a, secret, target.id)?.packed).toBe(false);
    expect(rowById(b, secret, target.id)?.packed).toBe(false);
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });

  test('the pack survives the partner dithering over the type (on, off, on) while apart', () => {
    const { world, a, b, secret } = household();

    world.now += 60 * 60_000;
    const target = enableTypeAndSeededRows(a, secret, 'hiking')[0];
    world.now += 5 * 60_000;
    setPacked(a, secret, target.id, true);

    // B, apart the whole time, changes its mind twice and settles on ON. Every
    // pass restamps the row later than A's tap, and the middle pass leaves a
    // tombstone newer than it too — so this is the defect's shape plus the
    // delete-wins tie-break stacked on top. B's last word on the type is "on",
    // so the row is live everywhere and still carries A's pack.
    const toggles = ['on', 'off', 'on'];
    for (const _ of toggles) {
      world.now += 15 * 60_000;
      toggleType(b, secret, 'hiking');
    }
    expect(rowById(b, secret, target.id)).toBeDefined(); // settled ON, not OFF

    world.now += 60_000;
    converge([a, b], secret);

    expect(rowById(a, secret, target.id)?.packed).toBe(true);
    expect(rowById(b, secret, target.id)?.packed).toBe(true);
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });
});

// ---------------------------------------------------------------------------
// D2 — packing-list-20260910-1
// ---------------------------------------------------------------------------

/** Every name+category listed more than once on this device — what a person
 *  would read as "why is that in here twice?". */
function duplicateRows(dev: SimDev, secret: string): string[] {
  const keys = visible(dev, secret).map(itemKey);
  return keys.filter((k, i) => keys.indexOf(k) !== i);
}

function rowsNamed(dev: SimDev, secret: string, name: string): TripItem[] {
  const want = normalizeItemName(name);
  return visible(dev, secret).filter((it) => normalizeItemName(it.name) === want);
}

/** A seed row both devices already hold under the same `gen-<rule>` id. */
function sharedSeedRow(dev: SimDev, secret: string): TripItem {
  const row = generatedRows(dev, secret)[0];
  expect(row).toBeDefined();
  return row;
}

describe('D2 (packing-list-20260910-1): editing the trip while the partner is packing does not list an item twice', () => {
  test('A nudges a seeded row then changes the trip length; B nudges their copy → ONE row everywhere', () => {
    const { world, a, b, secret } = household();
    const seed = sharedSeedRow(a, secret);
    // Both devices really are holding the same record right now.
    expect(rowById(b, secret, seed.id)).toBeDefined();

    // Apart. A makes the row theirs (a quantity nudge) and then edits the trip,
    // which recomposes the list. This is the moment the old build re-keyed it.
    world.now += 60 * 60_000;
    setQuantity(a, secret, seed.id, 3);
    world.now += 10 * 60_000;
    changeDuration(a, secret, 8);

    // Still apart, LATER: B nudges their copy of the SAME row, which on B is
    // still alive under the original id — so B's edit out-clocks whatever A's
    // recompose did to it.
    world.now += 30 * 60_000;
    setQuantity(b, secret, seed.id, 2);

    // Back in range.
    world.now += 60_000;
    converge([a, b], secret);

    // The reported symptom, on both devices at once.
    expect(duplicateRows(a, secret)).toEqual([]);
    expect(duplicateRows(b, secret)).toEqual([]);
    expect(rowsNamed(a, secret, seed.name)).toHaveLength(1);
    expect(rowsNamed(b, secret, seed.name)).toHaveLength(1);
    // …and the two devices genuinely agree on everything they show.
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });

  test('a trip edit keeps an edited seed row under the id the partner still holds', () => {
    const { world, a, b, secret } = household();
    const seed = sharedSeedRow(a, secret);

    world.now += 60 * 60_000;
    setQuantity(a, secret, seed.id, 3);
    world.now += 10 * 60_000;
    changeDuration(a, secret, 9);

    // The mechanism, pinned directly: recomposing makes the row the user's
    // (source 'custom') without moving it to an id nobody else knows.
    const after = rowById(a, secret, seed.id);
    expect(after).toBeDefined();
    expect(after!.source).toBe('custom');
    expect(rowsNamed(a, secret, seed.name)).toHaveLength(1);
    expect(rowById(b, secret, seed.id)).toBeDefined(); // still the shared identity
  });

  test('trips already split by the old build heal on the next sync', () => {
    // The forward fix cannot reach data that is ALREADY two records on two
    // phones, so the merge has to put them back together. Replays exactly that
    // state: A holds the re-keyed custom copy (id from the old `makeId('c')`
    // path) plus the tombstone it left, B still holds the `gen-` original.
    const { world, a, b, secret } = household();
    const seed = sharedSeedRow(a, secret);

    world.now += 60 * 60_000;
    on(a, () =>
      a.store.getState().updateTrip(a.store.getState().trips[0].id, (t) => ({
        ...t,
        items: t.items.map((it) =>
          it.id === seed.id
            ? { ...it, id: 'c-legacy-rekey', source: 'custom' as const, quantity: 3 }
            : it
        ),
      }))
    );
    expect(rowById(a, secret, 'c-legacy-rekey')).toBeDefined();
    expect(rowById(a, secret, seed.id)).toBeUndefined(); // tombstoned by the diff

    // B, apart, edits its copy of the original later — so the tombstone loses
    // and both records arrive live at the merge.
    world.now += 30 * 60_000;
    setQuantity(b, secret, seed.id, 2);

    world.now += 60_000;
    converge([a, b], secret);

    expect(duplicateRows(a, secret)).toEqual([]);
    expect(duplicateRows(b, secret)).toEqual([]);
    expect(rowsNamed(a, secret, seed.name)).toHaveLength(1);
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });

  test('the collapse never unpacks something a person ticked off', () => {
    // The healing net's own hazard: a seed row's BIRTH stamp must not outrank a
    // real tap on the copy it is collapsing against (defect
    // packing-list-20260820-1 arriving through the collapse).
    const { world, a, b, secret } = household();
    const seed = sharedSeedRow(a, secret);

    world.now += 60 * 60_000;
    setPacked(a, secret, seed.id, true);
    world.now += 5 * 60_000;
    on(a, () =>
      a.store.getState().updateTrip(a.store.getState().trips[0].id, (t) => ({
        ...t,
        items: t.items.map((it) =>
          it.id === seed.id
            ? { ...it, id: 'c-legacy-rekey', source: 'custom' as const }
            : it
        ),
      }))
    );

    // B, holding the untouched original, makes a later CONTENT edit to it. That
    // makes B's copy the freshest record in the group — but it carries no pack
    // decision of its own, so A's tap has to survive the collapse.
    world.now += 60 * 60_000;
    setQuantity(b, secret, seed.id, 4);
    world.now += 60_000;
    converge([a, b], secret);

    const survivor = rowsNamed(a, secret, seed.name);
    expect(survivor).toHaveLength(1);
    expect(survivor[0].packed).toBe(true);
    expect(fingerprint(a, secret)).toBe(fingerprint(b, secret));
  });
});
