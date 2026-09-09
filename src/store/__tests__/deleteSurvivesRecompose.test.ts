/**
 * Regression: a deleted item must STAY deleted across a recompose.
 *
 * Defect packing-list-20260908-1 (class: correctness, user-facing, shipped):
 * "Deleting an item does not stick: any recompose (duration change or type
 * toggle) revives the tombstoned row." The intent fuzzer found it as the
 * downstream duplicate ("two items named Socks"); this file pins the user
 * story directly, deterministically, with no fast-check involved.
 *
 * The story a person lives: I delete "Toothbrush" off my packing list, then I
 * change the trip from 4 days to 7 — and Toothbrush is back. Same if I switch
 * another trip type on. A delete the app quietly undoes is a delete that never
 * happened.
 *
 * The counter-story that must KEEP working (trip.ts § composeItems): turning a
 * type OFF and back ON restores that type's items. That restore rides the
 * "newly generated, not represented" path, not the tombstone path, so keeping
 * a tombstone dead does not break it. Both are asserted here.
 *
 * Hermetic like the fuzzer: db + kv + QA modules mocked, fresh store per test.
 */

import type { Trip, TripItem, TripInfo } from '../../data/trip';

jest.mock('../db', () => ({
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

import { applyDurationChange, applyTypeToggle } from '../../data/trip';

type TripsApi = {
  trips: Trip[];
  createTrip: (info: TripInfo) => string;
  getTrip: (id: string) => Trip | undefined;
  updateTrip: (id: string, fn: (t: Trip) => Trip) => void;
};
type TripsStore = { getState: () => TripsApi };

function loadStore(): TripsStore {
  let store!: TripsStore;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    store = require('../trips').useTripsStore as TripsStore;
  });
  return store;
}

const visible = (t: Trip): TripItem[] => t.items.filter((it) => it.deletedAt == null);
const norm = (s: string) => s.trim().toLowerCase();
const seesName = (t: Trip, name: string) => visible(t).some((it) => norm(it.name) === norm(name));

const INFO: TripInfo = {
  name: 'Trip',
  duration: 4,
  typeIds: ['essentials', 'beach'],
  canDoLaundry: false,
  laundryIntervalDays: 4,
  thoroughness: 'normal',
};

/** Delete by id exactly the way the UI does — splice it out and let the store
 *  soft-delete it into a tombstone. */
function deleteItemById(store: TripsStore, tripId: string, itemId: string): void {
  store.getState().updateTrip(tripId, (t) => ({
    ...t,
    items: t.items.filter((it) => it.id !== itemId),
  }));
}

describe('a delete survives a recompose', () => {
  it('a deleted generated item does not come back when the duration changes', () => {
    const store = loadStore();
    const id = store.getState().createTrip(INFO);

    const victim = visible(store.getState().getTrip(id)!).find((it) => it.source === 'generated')!;
    expect(victim).toBeDefined();

    deleteItemById(store, id, victim.id);
    expect(seesName(store.getState().getTrip(id)!, victim.name)).toBe(false);

    // The user stretches the trip 4 → 7 days.
    store.getState().updateTrip(id, (t) => ({
      ...t,
      duration: 7,
      items: applyDurationChange(t, 7),
    }));

    const after = store.getState().getTrip(id)!;
    expect(seesName(after, victim.name)).toBe(false);
  });

  it('a deleted generated item does not come back when another type is toggled on', () => {
    const store = loadStore();
    const id = store.getState().createTrip(INFO);

    const victim = visible(store.getState().getTrip(id)!).find((it) => it.source === 'generated')!;
    deleteItemById(store, id, victim.id);
    expect(seesName(store.getState().getTrip(id)!, victim.name)).toBe(false);

    // The user switches "hiking" on. Nothing about that says "undo my delete".
    store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = applyTypeToggle(t, 'hiking');
      return { ...t, typeIds, items };
    });

    const after = store.getState().getTrip(id)!;
    expect(seesName(after, victim.name)).toBe(false);
  });

  it('a revived delete never leaves two visible rows with the same name', () => {
    // The shape the intent fuzzer actually caught: the revived row collides with
    // a row the user renamed onto the same name.
    const store = loadStore();
    const id = store.getState().createTrip(INFO);

    const vis = visible(store.getState().getTrip(id)!);
    const victim = vis.find((it) => it.source === 'generated')!;
    const other = vis.find((it) => it.id !== victim.id)!;

    deleteItemById(store, id, victim.id);
    // The user renames a surviving row to the name they just cleared out.
    store.getState().updateTrip(id, (t) => ({
      ...t,
      items: t.items.map((it) =>
        it.id === other.id ? { ...it, name: victim.name, userModified: true } : it
      ),
    }));

    store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = applyTypeToggle(t, 'hiking');
      return { ...t, typeIds, items };
    });

    const names = visible(store.getState().getTrip(id)!).map((it) => norm(it.name));
    expect(names.filter((n) => n === norm(victim.name))).toHaveLength(1);
  });

  it('still restores a type’s items when the type is toggled off and back on', () => {
    // The behaviour the tombstone-revive was mistaken for. Must keep working.
    const store = loadStore();
    const id = store.getState().createTrip(INFO);

    const beachOnly = visible(store.getState().getTrip(id)!).filter(
      (it) => it.fromTypeIds?.includes('beach') && !it.fromTypeIds?.includes('essentials')
    );
    expect(beachOnly.length).toBeGreaterThan(0);
    const sample = beachOnly[0].name;

    store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = applyTypeToggle(t, 'beach');
      return { ...t, typeIds, items };
    });
    expect(seesName(store.getState().getTrip(id)!, sample)).toBe(false);

    store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = applyTypeToggle(t, 'beach');
      return { ...t, typeIds, items };
    });
    expect(seesName(store.getState().getTrip(id)!, sample)).toBe(true);
  });

  it('switching a kit off and back on brings back even a row the user deleted', () => {
    // The one place a delete is deliberately let go: you asked for this kit
    // again, so it arrives whole. Only rows this kit alone brings — see the
    // "another type is toggled on" test above for rows already in the trip.
    const store = loadStore();
    const id = store.getState().createTrip(INFO);

    const beachOnly = visible(store.getState().getTrip(id)!).find(
      (it) => it.fromTypeIds?.includes('beach') && !it.fromTypeIds?.includes('essentials')
    )!;
    expect(beachOnly).toBeDefined();

    deleteItemById(store, id, beachOnly.id);
    expect(seesName(store.getState().getTrip(id)!, beachOnly.name)).toBe(false);

    for (let i = 0; i < 2; i++) {
      store.getState().updateTrip(id, (t) => {
        const { typeIds, items } = applyTypeToggle(t, 'beach');
        return { ...t, typeIds, items };
      });
    }
    expect(seesName(store.getState().getTrip(id)!, beachOnly.name)).toBe(true);
  });
});
