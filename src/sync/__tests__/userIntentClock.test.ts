/**
 * Regression: marking a row as one YOU decided about has to reach the other
 * phone.
 *
 * The story a person lives: my partner swipes "Kite" off our shared list while
 * I am offline. On my phone I open that same row, re-confirm it (I tap into the
 * name, change nothing, tap done — or I step the quantity back to where it
 * started). Later we sync. My action was the most recent thing anyone did to
 * that row, so the row should be on the list. It wasn't: it vanished on both
 * phones, and the edit I made was on my disk and nowhere else.
 *
 * Why: the trips store stamps an item's merge clock only when a *content* field
 * changes. `userModified` was lumped in with provenance and excluded, so a
 * gesture whose other fields happened to land on the values already there wrote
 * the flag with no clock behind it — the row kept its old stamp and my
 * partner's earlier delete still out-clocked it. Crystallized by the intent
 * fuzzer as `qa/regressions/trip-sync-seed-161340779.json` (the recompose is
 * what put the flag back to false first, so the next tap was a pure flip).
 *
 * The same silence costs more than one lost row: `userModified` is the flag that
 * stops the composer overwriting or dropping a row, so a protection that never
 * syncs is a row a partner's next trip edit can still take away.
 *
 * The counter-story that must KEEP working: the composer's own reset of the flag
 * (true→false, when a trip edit reclassifies an edited row as custom) must NOT
 * bump the clock — that is provenance, and bumping on it would let a recompose
 * out-clock a partner's real edit.
 *
 * Hermetic, deterministic, no fast-check: the fuzzer found this, this file pins
 * it.
 */

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
  sharedTripOf,
  visible,
  addItem,
  setQuantity,
  renameItem,
  changeDuration,
} from '../simHarness';

// One mocked wall clock for the file, skewed per device while that device acts
// — same contract the fuzzers use.
const realNow: () => number = Date.now.bind(Date);
const worldRef: { current: SimWorld | null } = { current: null };
let dateSpy: jest.SpyInstance<number, []>;
beforeAll(() => {
  dateSpy = jest
    .spyOn(Date, 'now')
    .mockImplementation(() =>
      worldRef.current
        ? worldRef.current.now + (worldRef.current.active?.skewMs ?? 0)
        : realNow()
    );
});
afterAll(() => dateSpy.mockRestore());

const MINUTE = 60_000;

interface Household {
  world: SimWorld;
  devs: SimDev[];
  secret: string;
}

/** Two paired phones on one shared trip, already converged. */
function household(): Household {
  const world = makeWorld();
  worldRef.current = world;
  const devs = [makeDev(world, 'ua', 0), makeDev(world, 'ub', -3_000)];
  const tripId = on(devs[0], () =>
    devs[0].store.getState().createTrip({
      name: 'Trip',
      duration: 4,
      typeIds: ['essentials', 'beach'],
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    })
  );
  const secret = on(devs[0], () => devs[0].store.getState().shareTrip(tripId))!;
  on(devs[1], () => devs[1].store.getState().joinShared(secret));
  converge(devs, secret);
  return { world, devs, secret };
}

function rowNamed(dev: SimDev, secret: string, name: string): TripItem | undefined {
  const key = normalizeItemName(name);
  return sharedTripOf(dev, secret).items.find((it) => normalizeItemName(it.name) === key);
}

function sees(dev: SimDev, secret: string, name: string): boolean {
  const key = normalizeItemName(name);
  return visible(dev, secret).some((it) => normalizeItemName(it.name) === key);
}

/** Swipe the row away on `dev` (the store turns the splice into a tombstone). */
function remove(dev: SimDev, secret: string, itemId: string): void {
  const tripId = sharedTripOf(dev, secret).id;
  on(dev, () =>
    dev.store.getState().updateTrip(tripId, (t) => ({
      ...t,
      items: t.items.filter((it) => it.id !== itemId),
    }))
  );
}

describe('a decision about a row carries a clock', () => {
  it('re-confirming a row after a partner deleted it keeps the row', () => {
    const h = household();
    const [ua, ub] = h.devs;

    // I add Kite, then stretch the trip — the recompose reclassifies my Kite and
    // clears its userModified flag. We sync, so both phones agree.
    h.world.now += MINUTE;
    addItem(ua, h.secret, 'Kite', 'Gear');
    h.world.now += MINUTE;
    changeDuration(ua, h.secret, 7);
    converge(h.devs, h.secret);
    expect(rowNamed(ub, h.secret, 'Kite')?.userModified).toBeFalsy();

    // My partner swipes Kite away.
    h.world.now += MINUTE;
    const kiteOnA = rowNamed(ua, h.secret, 'Kite')!;
    remove(ua, h.secret, kiteOnA.id);

    // Ten minutes later, on my phone (which hasn't heard about the delete), I
    // open Kite's name, change nothing, and tap done. A real gesture whose
    // fields land where they already were.
    h.world.now += 10 * MINUTE;
    const kiteOnB = rowNamed(ub, h.secret, 'Kite')!;
    renameItem(ub, h.secret, kiteOnB.id, kiteOnB.name);

    converge(h.devs, h.secret);

    expect(sees(ub, h.secret, 'Kite')).toBe(true);
    expect(sees(ua, h.secret, 'Kite')).toBe(true);
  });

  it('stepping a quantity back to the value it already had is still an edit', () => {
    const h = household();
    const [ua, ub] = h.devs;

    h.world.now += MINUTE;
    addItem(ua, h.secret, 'Frisbee', 'Gear');
    h.world.now += MINUTE;
    changeDuration(ua, h.secret, 6);
    converge(h.devs, h.secret);

    const before = rowNamed(ub, h.secret, 'Frisbee')!;
    h.world.now += 10 * MINUTE;
    setQuantity(ub, h.secret, before.id, before.quantity);

    const after = rowNamed(ub, h.secret, 'Frisbee')!;
    expect(after.userModified).toBe(true);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it('a re-confirm is the newest word on the row, not the oldest', () => {
    // Ordering, not just survival: my re-confirm happened last, so it is the
    // state the row settles on. Without a clock behind it, my partner's older
    // edit kept winning forever and the flag I raised never travelled at all.
    const h = household();
    const [ua, ub] = h.devs;

    h.world.now += MINUTE;
    addItem(ua, h.secret, 'Yoga mat', 'Gear');
    h.world.now += MINUTE;
    changeDuration(ua, h.secret, 5);
    converge(h.devs, h.secret);
    expect(rowNamed(ub, h.secret, 'Yoga mat')?.userModified).toBeFalsy();

    // My partner bumps it to 4 — then goes quiet.
    h.world.now += MINUTE;
    const matOnA = rowNamed(ua, h.secret, 'Yoga mat')!;
    setQuantity(ua, h.secret, matOnA.id, 4);

    // Ten minutes later I open the row and re-confirm its name.
    h.world.now += 10 * MINUTE;
    const matOnB = rowNamed(ub, h.secret, 'Yoga mat')!;
    renameItem(ub, h.secret, matOnB.id, matOnB.name);

    converge(h.devs, h.secret);

    for (const d of [ua, ub]) {
      const row = rowNamed(d, h.secret, 'Yoga mat')!;
      expect(row.quantity).toBe(matOnB.quantity);
      expect(row.userModified).toBe(true);
    }
  });

  it('the composer clearing the flag does not out-clock a partner edit', () => {
    // The counter-story. A trip edit reclassifies my custom row and resets
    // userModified — provenance, not a decision, so the row's clock must stand
    // still and my partner's real edit must still win.
    const h = household();
    const [ua, ub] = h.devs;

    h.world.now += MINUTE;
    addItem(ua, h.secret, 'Corkscrew', 'Misc');
    h.world.now += MINUTE;
    const added = rowNamed(ua, h.secret, 'Corkscrew')!;
    setQuantity(ua, h.secret, added.id, 2); // makes it mine: userModified true
    converge(h.devs, h.secret);

    const beforeOnA = rowNamed(ua, h.secret, 'Corkscrew')!;
    expect(beforeOnA.userModified).toBe(true);
    expect(beforeOnA.source).toBe('custom');

    // My partner sets the quantity to 3.
    h.world.now += MINUTE;
    setQuantity(ub, h.secret, beforeOnA.id, 3);

    // Meanwhile I stretch the trip. The recompose only retags my row.
    h.world.now += MINUTE;
    changeDuration(ua, h.secret, 9);
    const afterRecompose = rowNamed(ua, h.secret, 'Corkscrew')!;
    expect(afterRecompose.userModified).toBe(false);
    expect(afterRecompose.updatedAt).toBe(beforeOnA.updatedAt);

    converge(h.devs, h.secret);
    expect(rowNamed(ua, h.secret, 'Corkscrew')?.quantity).toBe(3);
    expect(rowNamed(ub, h.secret, 'Corkscrew')?.quantity).toBe(3);
  });
});
