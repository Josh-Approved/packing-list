/**
 * Trips store — Zustand state with disk-backed persistence.
 *
 * Public API stays compatible with the in-memory version that preceded it
 * (createTrip, getTrip, updateTrip, deleteTrip). Adds:
 *   - `hydrated` flag — true once initial load from SQLite completes.
 *   - `hydrate()` — call once at app start to load existing trips.
 *
 * Writes are fire-and-forget: React state updates synchronously (UI feels
 * instant); the SQLite save runs in the background. If a write fails the UI
 * is still consistent — recovery UX (export/import) lands at spec step 7.
 */

import { create } from 'zustand';
import {
  applyTripInfo,
  type Trip,
  type TripInfo,
} from '../data/trip';
import { makeId } from '../lib/id';
import { mergeImported } from '../lib/transfer';
import { useSettingsStore } from './settings';
import {
  loadAllTrips,
  saveTrip,
  deleteTripFromDb,
  putTombstone,
  removeTombstone,
} from './db';

/**
 * Heal duplicate ids in loaded data (legacy `${prefix}${Date.now()}` ids
 * could collide). Reassigns colliding trip ids, and item/packer ids within
 * each trip. Returns the cleaned list plus the trips that were mutated so
 * the caller can persist just those.
 */
function repairIds(trips: Trip[]): { trips: Trip[]; changed: Trip[] } {
  const seenTrip = new Set<string>();
  const changed: Trip[] = [];

  const out = trips.map((t) => {
    let mutated = false;

    let tripId = t.id;
    if (seenTrip.has(tripId)) {
      tripId = makeId('t');
      mutated = true;
    }
    seenTrip.add(tripId);

    const seenItem = new Set<string>();
    const items = t.items.map((it) => {
      let id = it.id;
      if (seenItem.has(id)) {
        id = makeId('c');
        mutated = true;
      }
      seenItem.add(id);
      return id === it.id ? it : { ...it, id };
    });

    const seenPacker = new Set<string>();
    const packers = t.packers.map((p) => {
      let id = p.id;
      if (seenPacker.has(id)) {
        id = makeId('p');
        mutated = true;
      }
      seenPacker.add(id);
      return id === p.id ? p : { ...p, id };
    });

    if (mutated) {
      const repaired: Trip = { ...t, id: tripId, items, packers };
      changed.push(repaired);
      return repaired;
    }
    return t;
  });

  return { trips: out, changed };
}

interface TripsState {
  trips: Trip[];
  /** True once the initial load from SQLite has completed (success or fail). */
  hydrated: boolean;

  /** Load all trips from SQLite. Call once at app start. */
  hydrate: () => Promise<void>;

  /** Create a new trip from a completed Trip Information step; returns the
   *  new id. The wizard collects the full bundle (name, duration, types,
   *  laundry, thoroughness) before this is called, so a trip only ever
   *  exists once it's been deliberately configured — no orphan drafts. */
  createTrip: (info: TripInfo) => string;

  /** Lookup by id. Returns undefined if not found. */
  getTrip: (id: string) => Trip | undefined;

  /** Apply an update function, bump updatedAt, persist. No-op if id missing. */
  updateTrip: (id: string, fn: (t: Trip) => Trip) => void;

  /** Clone an existing trip with a new id; returns the new id. */
  duplicateTrip: (id: string) => string | null;

  /** Trip-level-additive import (spec step 7). Never mutates existing trips;
   *  collisions get a fresh id + " (imported)" name. Returns count added. */
  importTrips: (imported: Trip[]) => number;

  deleteTrip: (id: string) => void;

  /** Apply a resolved CloudKit sync result. Remote is authoritative for the
   *  trips it carries — upserts keep their incoming `updatedAt` (NOT bumped,
   *  so last-writer-wins stays stable across devices); deletes are removed
   *  locally. Persistence + tombstone bookkeeping handled here. */
  applySync: (changes: { upserts: Trip[]; deletes: string[] }) => void;
}

// The sole packer a freshly created trip starts with. Trip configuration
// (duration, types, laundry, thoroughness) now comes from the Trip
// Information step via TripInfo; packers are still managed on the list.
const DEFAULT_PACKERS = [{ id: 'me', name: 'Me' }];

export const useTripsStore = create<TripsState>()((set, get) => ({
  trips: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const loaded = await loadAllTrips();
      const { trips, changed } = repairIds(loaded);
      set({ trips, hydrated: true });
      // Persist any trips whose colliding ids we just healed.
      for (const t of changed) {
        saveTrip(t).catch((err) =>
          console.warn('packing-list: failed to persist id-repaired trip', err)
        );
      }
    } catch (err) {
      // Fail open: mark hydrated so UI unblocks; trips just stay empty.
      console.warn('packing-list: failed to load trips from disk', err);
      set({ hydrated: true });
    }
  },

  createTrip: (info) => {
    const id = makeId('t');
    const now = Date.now();
    const trip: Trip = {
      id,
      // Account gender personalizes the seeded list (e.g. bras / period
      // products). Read at create time — it's account-level, never stored
      // on the trip itself.
      ...applyTripInfo(info, [], useSettingsStore.getState().gender),
      packers: DEFAULT_PACKERS,
      createdAt: now,
      updatedAt: now,
    };
    // Newest first so the trips home shows recent at the top, matching the
    // SQL ORDER BY updatedAt DESC on hydration.
    set((s) => ({ trips: [trip, ...s.trips] }));
    saveTrip(trip).catch((err) =>
      console.warn('packing-list: failed to save new trip', err)
    );
    return id;
  },

  getTrip: (id) => get().trips.find((t) => t.id === id),

  updateTrip: (id, fn) => {
    let updated: Trip | undefined;
    set((s) => ({
      trips: s.trips.map((t) => {
        if (t.id !== id) return t;
        updated = { ...fn(t), updatedAt: Date.now() };
        return updated;
      }),
    }));
    if (updated) {
      saveTrip(updated).catch((err) =>
        console.warn('packing-list: failed to save trip update', err)
      );
    }
  },

  duplicateTrip: (id) => {
    const original = get().trips.find((t) => t.id === id);
    if (!original) return null;
    const newId = makeId('t');
    const now = Date.now();
    // Reset packed-state on the duplicate; same name + " (copy)".
    const dup: Trip = {
      ...original,
      id: newId,
      name: `${original.name} (copy)`,
      items: original.items.map((it) => ({ ...it, packed: false })),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ trips: [dup, ...s.trips] }));
    saveTrip(dup).catch((err) =>
      console.warn('packing-list: failed to save duplicated trip', err)
    );
    return newId;
  },

  importTrips: (imported) => {
    const { trips, addedTrips } = mergeImported(get().trips, imported);
    set({ trips });
    for (const t of addedTrips) {
      saveTrip(t).catch((err) =>
        console.warn('packing-list: failed to save imported trip', err)
      );
    }
    return addedTrips.length;
  },

  deleteTrip: (id) => {
    set((s) => ({ trips: s.trips.filter((t) => t.id !== id) }));
    deleteTripFromDb(id).catch((err) =>
      console.warn('packing-list: failed to delete trip from disk', err)
    );
    // Record the delete so the next sync can propagate it; without this a
    // pull would re-adopt the trip from the cloud.
    putTombstone(id, Date.now()).catch((err) =>
      console.warn('packing-list: failed to write tombstone', err)
    );
  },

  applySync: ({ upserts, deletes }) => {
    if (upserts.length === 0 && deletes.length === 0) return;
    const delSet = new Set(deletes);
    const upMap = new Map(upserts.map((t) => [t.id, t]));

    set((s) => {
      const next: Trip[] = [];
      for (const t of s.trips) {
        if (delSet.has(t.id)) continue; // removed by remote
        next.push(upMap.get(t.id) ?? t); // replaced by remote, or unchanged
      }
      // Trips that exist remotely but not locally yet.
      for (const t of upserts) {
        if (!s.trips.some((x) => x.id === t.id)) next.push(t);
      }
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return { trips: next };
    });

    for (const t of upserts) {
      saveTrip(t).catch((err) =>
        console.warn('packing-list: failed to persist synced trip', err)
      );
      // Adopting a live remote trip cancels any stale local tombstone.
      removeTombstone(t.id).catch(() => {});
    }
    for (const id of deletes) {
      deleteTripFromDb(id).catch((err) =>
        console.warn('packing-list: failed to delete synced trip', err)
      );
      // Keep a local tombstone so we converge and never resurrect it.
      putTombstone(id, Date.now()).catch(() => {});
    }
  },
}));
