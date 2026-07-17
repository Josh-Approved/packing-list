/**
 * Trips store — direct trust-core unit tests (mutation-survivor kill pass).
 *
 * The intent fuzzer (intentFuzz.test.ts) drives randomized stories through the
 * live store; the 2026-07-05 mutation run showed the pieces it never observes:
 * repairIds (never executed — the fuzzer hydrates from an empty DB), the
 * QA-mode seed branch, every persistence-failure warn path, and the exact
 * strings/ids the fuzzer doesn't pin (the makeId prefixes, " (copy)",
 * DEFAULT_PACKERS). These tests exercise each deterministically.
 *
 * Hermetic like the fuzzer: db + QA modules mocked, a fresh store instance per
 * test via jest.isolateModules.
 */

import type { Trip, TripItem, TripInfo, Packer } from '../../data/trip';

interface TripsApi {
  trips: Trip[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createTrip: (info: TripInfo) => string;
  getTrip: (id: string) => Trip | undefined;
  updateTrip: (id: string, fn: (t: Trip) => Trip) => void;
  duplicateTrip: (id: string) => string | null;
  importTrips: (imported: Trip[]) => number;
  deleteTrip: (id: string) => void;
}
type TripsStore = { getState: () => TripsApi };

// Controllable db mock — one object, re-defaulted per test, wired in via
// jest.doMock inside loadStore (so the QA_MODE flag can vary per scenario).
const db = {
  loadAllTrips: jest.fn(async (): Promise<Trip[]> => []),
  saveTrip: jest.fn(async (_t: Trip): Promise<void> => {}),
  deleteTripFromDb: jest.fn(async (_id: string): Promise<void> => {}),
  getAppSetting: jest.fn(async (): Promise<null> => null),
  setAppSetting: jest.fn(async (): Promise<void> => {}),
};

// Sync-meta kv mock — trips.ts imports storage/kv (expo-sqlite) for the
// shared-sync clocks; stub it so the store loads hermetically under jest.
const kv = {
  getSyncMeta: jest.fn(async (): Promise<null> => null),
  setSyncMeta: jest.fn(async (): Promise<void> => {}),
};

const QA_SENTINEL: Trip[] = [];

function loadStore(qaMode = false): TripsStore {
  let store!: TripsStore;
  jest.isolateModules(() => {
    jest.doMock('../db', () => db);
    jest.doMock('../../storage/kv', () => kv);
    jest.doMock('../../qa/qaMode', () => ({ QA_MODE: qaMode }));
    jest.doMock('../../qa/fixtures', () => ({ qaTrips: () => QA_SENTINEL }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    store = require('../trips').useTripsStore as TripsStore;
  });
  return store;
}

/** Let fire-and-forget saveTrip(...).catch(...) chains settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const makeItem = (id: string, over: Partial<TripItem> = {}): TripItem => ({
  id,
  name: `Item ${id}`,
  category: 'Misc',
  quantity: 1,
  assigneeId: 'shared',
  packed: false,
  source: 'custom',
  addedAt: 500,
  updatedAt: 500,
  ...over,
});

const makePacker = (id: string, over: Partial<Packer> = {}): Packer => ({
  id,
  name: `Packer ${id}`,
  ...over,
});

const makeTrip = (id: string, over: Partial<Trip> = {}): Trip => ({
  id,
  name: `Trip ${id}`,
  duration: 5,
  typeIds: ['essentials'],
  packers: [makePacker(`pk-${id}`)],
  items: [makeItem(`it-${id}`)],
  canDoLaundry: false,
  laundryIntervalDays: 4,
  thoroughness: 'normal',
  nameUpdatedAt: 1000,
  createdAt: 1000,
  updatedAt: 2000,
  ...over,
});

const info = (name: string): TripInfo => ({
  name,
  duration: 5,
  typeIds: ['essentials'],
  canDoLaundry: false,
  laundryIntervalDays: 4,
  thoroughness: 'normal',
});

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  db.loadAllTrips.mockReset().mockResolvedValue([]);
  db.saveTrip.mockReset().mockResolvedValue(undefined);
  db.deleteTripFromDb.mockReset().mockResolvedValue(undefined);
  db.getAppSetting.mockReset().mockResolvedValue(null);
  db.setAppSetting.mockReset().mockResolvedValue(undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// hydrate + repairIds
// ---------------------------------------------------------------------------

describe('hydrate / repairIds', () => {
  it('leaves unique ids untouched — same objects, nothing re-persisted', async () => {
    const a = makeTrip('a');
    const b = makeTrip('b');
    db.loadAllTrips.mockResolvedValue([a, b]);
    const store = loadStore();
    await store.getState().hydrate();

    const { trips, hydrated } = store.getState();
    expect(hydrated).toBe(true);
    expect(trips).toHaveLength(2);
    // Untouched trips are returned by reference, not cloned.
    expect(trips[0]).toBe(a);
    expect(trips[1]).toBe(b);
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('with no duplicates, the changed set stays empty — nothing spurious is re-persisted', async () => {
    // repairIds' `changed` accumulator must start EMPTY. A trip whose id is
    // undefined is re-persisted only if `changed` wrongly began non-empty: a
    // bogus seed element's `.id` (undefined) would land in the dirty set and
    // match this trip. With an empty `changed`, hydrate re-persists nothing.
    const clean = makeTrip('a', { id: undefined });
    db.loadAllTrips.mockResolvedValue([clean]);
    const store = loadStore();
    await store.getState().hydrate();

    expect(store.getState().trips).toHaveLength(1);
    expect(store.getState().trips[0]).toBe(clean); // untouched, same object
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('regenerates a duplicate trip id (the LATER one) and persists just that trip', async () => {
    const first = makeTrip('zz', { name: 'First' });
    const second = makeTrip('zz', {
      name: 'Second',
      items: [makeItem('it-second')],
      packers: [makePacker('pk-second')],
    });
    db.loadAllTrips.mockResolvedValue([first, second]);
    const store = loadStore();
    await store.getState().hydrate();

    const { trips } = store.getState();
    expect(trips[0]).toBe(first); // earlier trip keeps its id, untouched
    expect(trips[0].id).toBe('zz');
    expect(trips[1].id).not.toBe('zz');
    expect(trips[1].id).toMatch(/^t[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/); // makeId('t')
    expect(trips[1].name).toBe('Second'); // rest of the trip preserved
    expect(trips[1].items).toEqual(second.items);
    expect(trips[1].packers).toEqual(second.packers);
    expect(db.saveTrip).toHaveBeenCalledTimes(1);
    expect(db.saveTrip.mock.calls[0][0]).toBe(trips[1]);
  });

  it('regenerates a duplicate item id within a trip (the later one, c-prefixed)', async () => {
    const dupA = makeItem('zz', { name: 'Sock A' });
    const dupB = makeItem('zz', { name: 'Sock B' });
    const t = makeTrip('a', { items: [dupA, dupB] });
    db.loadAllTrips.mockResolvedValue([t]);
    const store = loadStore();
    await store.getState().hydrate();

    const [repaired] = store.getState().trips;
    expect(repaired.id).toBe('a'); // trip id itself untouched
    expect(repaired.items[0]).toBe(dupA); // first keeps id + object identity
    expect(repaired.items[1].id).not.toBe('zz');
    expect(repaired.items[1].id).toMatch(/^c[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/); // makeId('c')
    expect(repaired.items[1]).toEqual({ ...dupB, id: repaired.items[1].id });
    expect(db.saveTrip).toHaveBeenCalledTimes(1);
    expect(db.saveTrip.mock.calls[0][0]).toBe(repaired);
  });

  it('regenerates a duplicate packer id within a trip (the later one, p-prefixed)', async () => {
    const dupA = makePacker('zz', { name: 'Sam' });
    const dupB = makePacker('zz', { name: 'Alex' });
    const t = makeTrip('a', { packers: [dupA, dupB] });
    db.loadAllTrips.mockResolvedValue([t]);
    const store = loadStore();
    await store.getState().hydrate();

    const [repaired] = store.getState().trips;
    expect(repaired.packers[0]).toBe(dupA);
    expect(repaired.packers[1].id).not.toBe('zz');
    expect(repaired.packers[1].id).toMatch(/^p[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/); // makeId('p')
    expect(repaired.packers[1].name).toBe('Alex');
    expect(db.saveTrip).toHaveBeenCalledTimes(1);
  });

  it('item-id dedupe is per-trip: the same item id in two different trips is left alone', async () => {
    const t1 = makeTrip('a', { items: [makeItem('same')] });
    const t2 = makeTrip('b', { items: [makeItem('same')] });
    db.loadAllTrips.mockResolvedValue([t1, t2]);
    const store = loadStore();
    await store.getState().hydrate();

    const { trips } = store.getState();
    expect(trips[0]).toBe(t1);
    expect(trips[1]).toBe(t2);
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('warns (and still repairs state) when persisting a repaired trip fails', async () => {
    db.loadAllTrips.mockResolvedValue([makeTrip('zz'), makeTrip('zz')]);
    db.saveTrip.mockRejectedValue(new Error('disk full'));
    const store = loadStore();
    await store.getState().hydrate();
    await flush();

    expect(store.getState().trips[1].id).not.toBe('zz');
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to persist trip',
      expect.anything()
    );
  });

  it('fails open when the load itself fails: hydrated flips, trips stay empty', async () => {
    db.loadAllTrips.mockRejectedValue(new Error('no db'));
    const store = loadStore();
    await store.getState().hydrate();

    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().trips).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to load trips from disk',
      expect.anything()
    );
  });

  it('QA mode seeds fixtures only on an empty load', async () => {
    const store = loadStore(true);
    await store.getState().hydrate();
    expect(store.getState().trips).toBe(QA_SENTINEL);
    expect(store.getState().hydrated).toBe(true);
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('QA mode with existing trips loads them, not the fixtures', async () => {
    const a = makeTrip('a');
    db.loadAllTrips.mockResolvedValue([a]);
    const store = loadStore(true);
    await store.getState().hydrate();
    expect(store.getState().trips).toEqual([a]);
    expect(store.getState().trips).not.toBe(QA_SENTINEL);
  });

  it('outside QA mode an empty load stays empty (no fixture seeding)', async () => {
    const store = loadStore(false);
    await store.getState().hydrate();
    expect(store.getState().trips).toEqual([]);
    expect(store.getState().trips).not.toBe(QA_SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// createTrip
// ---------------------------------------------------------------------------

describe('createTrip', () => {
  it('mints a t-prefixed id, seeds the default packer, prepends, persists', async () => {
    const store = loadStore();
    const before = Date.now();
    const id = store.getState().createTrip(info('Weekend'));

    expect(id).toMatch(/^t[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/); // makeId('t')
    const t = store.getState().getTrip(id)!;
    expect(t.name).toBe('Weekend');
    expect(t.packers).toEqual([{ id: 'me', name: 'Me' }]); // DEFAULT_PACKERS
    expect(t.createdAt).toBe(t.updatedAt);
    expect(t.createdAt).toBeGreaterThanOrEqual(before);
    expect(store.getState().trips[0]).toBe(t);
    expect(db.saveTrip).toHaveBeenCalledWith(t);

    const second = store.getState().createTrip(info('Later'));
    expect(store.getState().trips.map((x) => x.id)).toEqual([second, id]); // newest first
  });

  it('warns when persisting a new trip fails (state keeps the trip)', async () => {
    db.saveTrip.mockRejectedValue(new Error('disk'));
    const store = loadStore();
    const id = store.getState().createTrip(info('Weekend'));
    await flush();
    expect(store.getState().getTrip(id)).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to persist trip',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// getTrip / updateTrip
// ---------------------------------------------------------------------------

describe('getTrip / updateTrip', () => {
  it('getTrip finds by id and returns undefined for a missing id', async () => {
    const a = makeTrip('a');
    db.loadAllTrips.mockResolvedValue([a]);
    const store = loadStore();
    await store.getState().hydrate();
    expect(store.getState().getTrip('a')).toBe(a);
    expect(store.getState().getTrip('nope')).toBeUndefined();
  });

  it('applies the update fn to exactly the target, bumps updatedAt, persists', async () => {
    const a = makeTrip('a', { updatedAt: 1 });
    const b = makeTrip('b');
    db.loadAllTrips.mockResolvedValue([a, b]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockClear();

    const before = Date.now();
    store.getState().updateTrip('a', (t) => ({ ...t, name: 'Renamed' }));

    const updated = store.getState().getTrip('a')!;
    expect(updated.name).toBe('Renamed');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    expect(store.getState().getTrip('b')).toBe(b); // untouched, same object
    expect(db.saveTrip).toHaveBeenCalledTimes(1);
    expect(db.saveTrip).toHaveBeenCalledWith(updated);
  });

  it('is a no-op (and never persists) for a missing id', async () => {
    const a = makeTrip('a');
    db.loadAllTrips.mockResolvedValue([a]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockClear();

    store.getState().updateTrip('nope', (t) => ({ ...t, name: 'X' }));
    expect(store.getState().getTrip('a')).toBe(a);
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('warns when persisting an update fails', async () => {
    db.loadAllTrips.mockResolvedValue([makeTrip('a')]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockRejectedValue(new Error('disk'));

    store.getState().updateTrip('a', (t) => ({ ...t, name: 'X' }));
    await flush();
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to persist trip',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// duplicateTrip
// ---------------------------------------------------------------------------

describe('duplicateTrip', () => {
  it('clones with a fresh t-prefixed id, " (copy)" name, packed reset, fresh stamps', async () => {
    const original = makeTrip('a', {
      name: 'Beach',
      items: [makeItem('i1', { packed: true }), makeItem('i2', { packed: true })],
      createdAt: 1,
      updatedAt: 2,
    });
    db.loadAllTrips.mockResolvedValue([original]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockClear();

    const before = Date.now();
    const newId = store.getState().duplicateTrip('a');

    expect(newId).not.toBeNull();
    expect(newId).not.toBe('a');
    expect(newId!).toMatch(/^t[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/); // makeId('t')
    const dup = store.getState().getTrip(newId!)!;
    expect(dup.name).toBe('Beach (copy)');
    expect(dup.items.map((i) => i.packed)).toEqual([false, false]); // reset
    expect(dup.items.map((i) => i.id)).toEqual(['i1', 'i2']); // ids kept
    expect(dup.createdAt).toBeGreaterThanOrEqual(before);
    expect(dup.createdAt).toBe(dup.updatedAt);
    expect(store.getState().trips[0]).toBe(dup); // prepended
    // Original untouched: same object, packed state intact.
    expect(store.getState().getTrip('a')).toBe(original);
    expect(original.items.every((i) => i.packed)).toBe(true);
    expect(db.saveTrip).toHaveBeenCalledWith(dup);
  });

  it('returns null (and changes nothing) for a missing id', async () => {
    db.loadAllTrips.mockResolvedValue([makeTrip('a')]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockClear();

    expect(store.getState().duplicateTrip('nope')).toBeNull();
    expect(store.getState().trips).toHaveLength(1);
    expect(db.saveTrip).not.toHaveBeenCalled();
  });

  it('warns when persisting the duplicate fails', async () => {
    db.loadAllTrips.mockResolvedValue([makeTrip('a')]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockRejectedValue(new Error('disk'));

    store.getState().duplicateTrip('a');
    await flush();
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to persist trip',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// importTrips / deleteTrip
// ---------------------------------------------------------------------------

describe('importTrips', () => {
  it('prepends the imported block, persists each added trip, returns the count', async () => {
    const existing = makeTrip('a');
    db.loadAllTrips.mockResolvedValue([existing]);
    const store = loadStore();
    await store.getState().hydrate();
    db.saveTrip.mockClear();

    const added = store.getState().importTrips([makeTrip('x'), makeTrip('y')]);

    expect(added).toBe(2);
    const { trips } = store.getState();
    expect(trips.map((t) => t.id)).toEqual(['x', 'y', 'a']);
    expect(trips[2]).toBe(existing); // existing untouched
    expect(db.saveTrip).toHaveBeenCalledTimes(2);
    expect(db.saveTrip.mock.calls.map(([t]) => t.id)).toEqual(['x', 'y']);
  });

  it('warns when persisting an imported trip fails', async () => {
    const store = loadStore();
    db.saveTrip.mockRejectedValue(new Error('disk'));
    store.getState().importTrips([makeTrip('x')]);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to persist trip',
      expect.anything()
    );
  });
});

describe('deleteTrip', () => {
  it('removes exactly the target trip and deletes it from disk', async () => {
    const a = makeTrip('a');
    const b = makeTrip('b');
    db.loadAllTrips.mockResolvedValue([a, b]);
    const store = loadStore();
    await store.getState().hydrate();

    store.getState().deleteTrip('a');
    expect(store.getState().trips).toHaveLength(1);
    expect(store.getState().trips[0]).toBe(b);
    expect(db.deleteTripFromDb).toHaveBeenCalledWith('a');
  });

  it('warns when the disk delete fails (state already updated)', async () => {
    db.loadAllTrips.mockResolvedValue([makeTrip('a')]);
    const store = loadStore();
    await store.getState().hydrate();
    db.deleteTripFromDb.mockRejectedValue(new Error('disk'));

    store.getState().deleteTrip('a');
    await flush();
    expect(store.getState().trips).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'packing-list: failed to delete trip from disk',
      expect.anything()
    );
  });
});
