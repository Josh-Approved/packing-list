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
  composeItems,
  type Trip,
  type TripTypeId,
} from '../data/trip';
import { makeId } from '../lib/id';
import { loadAllTrips, saveTrip, deleteTripFromDb } from './db';

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

  /** Create a new trip with smart defaults; returns the new id.
   *  Caller MUST supply a name — the trips home flow prompts for it before
   *  calling this, so we never end up with anonymous "New trip" entries. */
  createTrip: (name: string) => string;

  /** Lookup by id. Returns undefined if not found. */
  getTrip: (id: string) => Trip | undefined;

  /** Apply an update function, bump updatedAt, persist. No-op if id missing. */
  updateTrip: (id: string, fn: (t: Trip) => Trip) => void;

  /** Clone an existing trip with a new id; returns the new id. */
  duplicateTrip: (id: string) => string | null;

  deleteTrip: (id: string) => void;
}

// ---------- Smart defaults for a new trip ----------
// Per spec § "Empty / new trip flow": Essentials only, 3 days, packers ['Me'].

const NEW_TRIP_DEFAULTS = {
  duration: 3,
  typeIds: ['essentials'] as TripTypeId[],
  packers: [{ id: 'me', name: 'Me' }],
};

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

  createTrip: (name) => {
    const id = makeId('t');
    const now = Date.now();
    const trip: Trip = {
      id,
      name: name.trim() || 'Untitled trip',
      duration: NEW_TRIP_DEFAULTS.duration,
      typeIds: NEW_TRIP_DEFAULTS.typeIds,
      packers: NEW_TRIP_DEFAULTS.packers,
      items: composeItems(NEW_TRIP_DEFAULTS.typeIds, NEW_TRIP_DEFAULTS.duration, []),
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

  deleteTrip: (id) => {
    set((s) => ({ trips: s.trips.filter((t) => t.id !== id) }));
    deleteTripFromDb(id).catch((err) =>
      console.warn('packing-list: failed to delete trip from disk', err)
    );
  },
}));
