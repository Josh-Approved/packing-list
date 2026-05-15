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
import { loadAllTrips, saveTrip, deleteTripFromDb } from './db';

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
      const trips = await loadAllTrips();
      set({ trips, hydrated: true });
    } catch (err) {
      // Fail open: mark hydrated so UI unblocks; trips just stay empty.
      console.warn('packing-list: failed to load trips from disk', err);
      set({ hydrated: true });
    }
  },

  createTrip: (name) => {
    const id = `t${Date.now()}`;
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
    const newId = `t${Date.now()}`;
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
