/**
 * Multi-device simulation harness for the shared-trip stack — used by the
 * intent fuzzers (and future sync tests). NOT a test file.
 *
 * Each simulated device is a fresh module registry (jest.isolateModules), so it
 * runs the REAL zustand trips store and the REAL logical clock as its own
 * singletons — the production code paths, not re-implementations. All devices
 * share one mocked wall clock (`world.now`) with a per-device skew; `on(dev,
 * fn)` routes Date.now to that device while `fn` runs.
 *
 * The wire is modelled as each device's serialized trip (what seal/open
 * carries), delivered via mergeRemoteTrip — the exact receive path of the
 * engine. Callers keep a history of published payloads so tests can deliver
 * stale copies out of order (relays re-deliver; the merge must be
 * order-tolerant).
 *
 * WHERE THIS DIFFERS FROM GROCERY'S HARNESS. grocery's list store exposes one
 * action per user gesture (addItem/setChecked/…), so its harness only has to
 * hand devices to the caller. packing routes every item edit through the single
 * `updateTrip` funnel, with the gesture-level policy living in the trip-detail
 * screen. So this harness also carries one *actions* section — the device-level
 * verbs a person performs — pointed at the real implementations wherever they
 * exist (`addItemToTrip`, `applyTypeToggle`, `applyDurationChange`); the
 * remaining verbs are one-line item maps copied from their screen handlers.
 * Every clock, tombstone and pruning decision still happens in the real store.
 *
 * Those reducers are taken from the DEVICE's own module registry (`dev.domain`
 * / `dev.addItemToTrip`), not this file's, because both stamp new items from
 * the `sync/clock` singleton — a copy loaded here would hand every device one
 * shared, un-skewed clock and quietly drop the skew this harness exists to
 * model.
 */

import {
  normalizeItemName,
  MAX_DURATION_DAYS,
  MIN_DURATION_DAYS,
  type Category,
  type Trip,
  type TripItem,
  type TripTypeId,
} from '../data/trip';

export interface SimWorld {
  now: number;
  active: SimDev | null;
}

export interface SimDev {
  name: string;
  skewMs: number;
  store: typeof import('../store/trips').useTripsStore;
  clock: typeof import('./clock');
  /** This device's copy of the composition rules (its own clock singleton). */
  domain: typeof import('../data/trip');
  /** This device's copy of the add-bar reducer (its own clock singleton). */
  addItemToTrip: typeof import('../screens/tripDetail/addItem').addItemToTrip;
  world: SimWorld;
}

export function makeWorld(startAt = 1_750_000_000_000): SimWorld {
  return { now: startAt, active: null };
}

type DevModules = Pick<SimDev, 'store' | 'clock' | 'domain' | 'addItemToTrip'>;

/**
 * One isolated module registry per device NAME, reused across households.
 * Devices must never share a registry (each needs its own store + clock
 * singletons), but successive households can: a fuzz file builds hundreds of
 * them, and a fresh registry per household exhausts the heap — packing's module
 * graph carries every trip type's seed rules, so it is an order of magnitude
 * heavier than a grocery list's. `makeDev` resets whatever it hands back
 * (test-reset clock + empty store), so a reused registry starts as blank as a
 * new one. The device name is its identity: reusing a name in one household
 * would hand both devices the same store.
 */
const registries = new Map<string, DevModules>();

function registryFor(name: string): DevModules {
  const cached = registries.get(name);
  if (cached) return cached;
  let mods!: DevModules;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    mods = {
      store: require('../store/trips').useTripsStore,
      clock: require('./clock'),
      domain: require('../data/trip'),
      addItemToTrip: require('../screens/tripDetail/addItem').addItemToTrip,
    };
    /* eslint-enable @typescript-eslint/no-var-requires */
  });
  registries.set(name, mods);
  return mods;
}

export function makeDev(world: SimWorld, name: string, skewMs = 0): SimDev {
  const dev: SimDev = { name, skewMs, world, ...registryFor(name) };
  on(dev, () => {
    dev.clock._resetForTest();
    dev.clock.initClock(0, () => {});
    dev.store.setState({ trips: [], hydrated: true });
  });
  return dev;
}

/** Run `fn` as this device (its skewed wall clock feeds Date.now). */
export function on<T>(dev: SimDev, fn: () => T): T {
  const prev = dev.world.active;
  dev.world.active = dev;
  try {
    return fn();
  } finally {
    dev.world.active = prev;
  }
}

export function sharedTripOf(dev: SimDev, secret: string): Trip {
  const trip = dev.store
    .getState()
    .trips.find((t) => t.shareIdentity?.secret === secret);
  if (!trip) throw new Error(`no shared trip on device ${dev.name}`);
  return trip;
}

/** The device's current copy as the wire would carry it. */
export function snapshot(dev: SimDev, secret: string): Trip {
  return JSON.parse(JSON.stringify(sharedTripOf(dev, secret))) as Trip;
}

/** Deliver an arbitrary (possibly stale) payload to a device. */
export function deliverPayload(to: SimDev, payload: Trip): void {
  on(to, () => to.store.getState().mergeRemoteTrip(payload));
}

/** Deliver `from`'s CURRENT state to `to`. */
export function deliver(from: SimDev, to: SimDev, secret: string): void {
  deliverPayload(to, snapshot(from, secret));
}

/** Every device exchanges with every other until quiescent. */
export function converge(devs: SimDev[], secret: string, rounds = 4): void {
  for (let r = 0; r < rounds; r++) {
    for (const a of devs) {
      for (const b of devs) {
        if (a !== b) deliver(a, b, secret);
      }
    }
  }
}

export function visible(dev: SimDev, secret: string): TripItem[] {
  return sharedTripOf(dev, secret).items.filter((it) => it.deletedAt == null);
}

/** The identity two copies of "the same thing" collapse on: packing lets the
 *  same name live in two categories (a charger in Electronics and one in Bags),
 *  so the key is name AND category — same rule merge.ts collapses by. */
export function itemKey(it: Pick<TripItem, 'name' | 'category'>): string {
  return `${normalizeItemName(it.name)}|${it.category}`;
}

/** Canonical fingerprint of what the user SEES on this device: item key →
 *  quantity/packed, order-independent. Two converged devices must produce
 *  identical fingerprints. */
export function fingerprint(dev: SimDev, secret: string): string {
  return visible(dev, secret)
    .map((it) => `${itemKey(it)}=${it.quantity},${it.packed ? 1 : 0}`)
    .sort()
    .join(';');
}

/** The trip-level configuration the head merge resolves as one unit. */
export function tripConfig(dev: SimDev, secret: string): string {
  const t = sharedTripOf(dev, secret);
  return `${t.duration}d:${[...t.typeIds].sort().join('+')}`;
}

// ---------------------------------------------------------------------------
// Device actions — one per real user gesture (see the header note)
// ---------------------------------------------------------------------------

function tripIdOn(dev: SimDev, secret: string): string {
  return sharedTripOf(dev, secret).id;
}

/** Type an item into the add bar (AddItemBar → addItemToTrip). */
export function addItem(
  dev: SimDev,
  secret: string,
  name: string,
  category: Category
): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => dev.addItemToTrip(t, name, category))
  );
}

/** Tap an item's checkbox (useTripDetailHandlers.handlePackedToggle). */
export function setPacked(
  dev: SimDev,
  secret: string,
  itemId: string,
  packed: boolean
): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => ({
      ...t,
      items: t.items.map((it) => (it.id === itemId ? { ...it, packed } : it)),
    }))
  );
}

/** Nudge an item's stepper (useTripDetailHandlers.handleQuantityChange). */
export function setQuantity(
  dev: SimDev,
  secret: string,
  itemId: string,
  quantity: number
): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => ({
      ...t,
      items: t.items.map((it) =>
        it.id === itemId ? { ...it, quantity, userModified: true } : it
      ),
    }))
  );
}

/** Inline-rename an item (useTripDetailHandlers.handleFinishEditItem). */
export function renameItem(
  dev: SimDev,
  secret: string,
  itemId: string,
  name: string
): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => ({
      ...t,
      items: t.items.map((it) =>
        it.id === itemId ? { ...it, name, userModified: true } : it
      ),
    }))
  );
}

/** Swipe an item away (useUndoableRemove.handleItemRemove — the store's diff
 *  turns the splice into a tombstone). */
export function removeItem(dev: SimDev, secret: string, itemId: string): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => ({
      ...t,
      items: t.items.filter((it) => it.id !== itemId),
    }))
  );
}

/** Add/remove a trip type on the Trip Info screen (real applyTypeToggle). */
export function toggleType(
  dev: SimDev,
  secret: string,
  typeId: TripTypeId
): void {
  const id = tripIdOn(dev, secret);
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = dev.domain.applyTypeToggle(t, typeId);
      return { ...t, typeIds, items };
    })
  );
}

/** Change how many days the trip is (real applyDurationChange). */
export function changeDuration(dev: SimDev, secret: string, days: number): void {
  const id = tripIdOn(dev, secret);
  const clamped = Math.min(
    MAX_DURATION_DAYS,
    Math.max(MIN_DURATION_DAYS, Math.round(days))
  );
  on(dev, () =>
    dev.store.getState().updateTrip(id, (t) => ({
      ...t,
      duration: clamped,
      items: dev.domain.applyDurationChange(t, clamped),
    }))
  );
}

/** Deterministic PRNG (mulberry32) — seeded so failures are replayable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
