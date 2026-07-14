/**
 * Trips store — Zustand state with disk-backed persistence.
 *
 * Public API stays compatible with the in-memory version that preceded it
 * (createTrip, getTrip, updateTrip, deleteTrip). Adds:
 *   - `hydrated` flag — true once initial load from SQLite completes.
 *   - `hydrate()` — call once at app start to load existing trips.
 *   - shared-sync entry points (shareTrip / joinShared / mergeRemoteTrip /
 *     flushPending) — see the shared-sync module (src/sync/*).
 *
 * Writes are fire-and-forget: React state updates synchronously (UI feels
 * instant); the SQLite save runs in the background.
 *
 * `updateTrip` is the single mutation funnel. It DIFFS the caller's new items
 * against the old ones and stamps the CRDT merge clocks centrally, so screens
 * keep calling `updateTrip(id, t => ({ ...t, items }))` unchanged and every
 * clock/tombstone rule lives in one place:
 *   - a packed-only flip stamps the item's OWN clock (packedUpdatedAt/packedAt),
 *     never `updatedAt`, so a concurrent content edit on another device can't
 *     revert it;
 *   - a content edit stamps `updatedAt`;
 *   - an item the caller spliced out is NOT dropped — it becomes a tombstone,
 *     so the delete survives a cross-device merge;
 *   - a rename bumps the name's own clock (`nameUpdatedAt`).
 */

import { create } from 'zustand';
import {
  applyTripInfo,
  healFutureStamps,
  pruneTombstones,
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  type Trip,
  type TripItem,
  type TripInfo,
} from '../data/trip';
import { makeId } from '../lib/id';
import { mergeImported } from '../lib/transfer';
import { makeShareIdentity } from '../sync/share';
import { mergeTrip } from '../sync/merge';
import {
  now as clockNow,
  initClock,
  observe as observeClock,
  peek as clockPeek,
  MAX_SKEW_MS,
} from '../sync/clock';
import { getSyncMeta, setSyncMeta } from '../storage/kv';
import { useSettingsStore } from './settings';
import { loadAllTrips, saveTrip, deleteTripFromDb } from './db';
import { QA_MODE } from '../qa/qaMode';
import { qaTrips } from '../qa/fixtures';

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

/** Default legacy-missing merge clocks on a loaded trip's items so nothing
 *  downstream sees `undefined` addedAt/updatedAt. Trips persisted before the
 *  shared-sync fields existed read those back as absent; give them the trip's
 *  own clock. Returns the same object when nothing needed filling. */
function migrateLoadedTrip(t: Trip): Trip {
  let changed = false;
  const fallback = t.updatedAt || t.createdAt || 0;
  const items = t.items.map((it) => {
    if (it.addedAt != null && it.updatedAt != null) return it;
    changed = true;
    const base = it.updatedAt ?? it.addedAt ?? fallback;
    return { ...it, addedAt: it.addedAt ?? base, updatedAt: it.updatedAt ?? base };
  });
  if (!changed) return t;
  return { ...t, items };
}

/** Has a content field (anything except `packed`, which rides its own clock)
 *  changed between the old and new copy of an item? Provenance fields
 *  (fromTypeIds/originName/userModified) are deliberately excluded so a
 *  recompose that only re-tags provenance doesn't spuriously out-clock a
 *  peer's real edit. A revive (deletedAt cleared) counts as a content change so
 *  it wins the merge. */
function itemContentChanged(a: TripItem, b: TripItem): boolean {
  return (
    a.name !== b.name ||
    a.quantity !== b.quantity ||
    a.category !== b.category ||
    a.assigneeId !== b.assigneeId ||
    a.source !== b.source ||
    (a.deletedAt ?? 0) !== (b.deletedAt ?? 0)
  );
}

/**
 * Diff the caller's new trip against the old one and stamp every merge clock.
 * The heart of the CRDT store: screens stay clock-unaware, this centralizes it.
 */
function stampTripUpdate(old: Trip, base: Trip): Trip {
  const at = clockNow();
  const oldById = new Map(old.items.map((it) => [it.id, it]));
  const newIds = new Set(base.items.map((it) => it.id));

  const items: TripItem[] = [];
  for (const it of base.items) {
    const prev = oldById.get(it.id);
    if (!prev) {
      // Newly added — ensure it carries its own clocks.
      items.push({
        ...it,
        addedAt: it.addedAt ?? at,
        updatedAt: it.updatedAt ?? at,
        packed: it.packed ?? false,
      });
      continue;
    }
    let next = it;
    if (itemContentChanged(prev, it)) next = { ...next, updatedAt: at };
    if (!!it.packed !== !!prev.packed) {
      next = { ...next, packedUpdatedAt: at, packedAt: it.packed ? at : undefined };
    }
    items.push(next);
  }

  // Items the caller spliced out become tombstones (a delete must survive a
  // cross-device merge). An already-dead tombstone the caller dropped (e.g. a
  // display-filtered reorder) is preserved untouched so pruning can still
  // retire it — re-stamping it would keep it alive in the payload forever.
  for (const prev of old.items) {
    if (newIds.has(prev.id)) continue;
    if (prev.deletedAt != null) {
      items.push(prev);
      continue;
    }
    items.push({ ...prev, deletedAt: at, updatedAt: at });
  }

  // A rename stamps the name's own clock so it wins on every paired device.
  const nameChanged = base.name !== old.name;
  const stamped: Trip = {
    ...base,
    items,
    updatedAt: at,
    nameUpdatedAt: nameChanged ? at : (base.nameUpdatedAt ?? old.nameUpdatedAt),
  };
  // Keep dead weight bounded wherever tombstones are minted.
  return pruneTombstones(stamped, Date.now());
}

interface TripsState {
  trips: Trip[];
  /** True once the initial load from SQLite has completed (success or fail). */
  hydrated: boolean;

  /** Load all trips from SQLite. Call once at app start. */
  hydrate: () => Promise<void>;

  /** Create a new trip from a completed Trip Information step; returns the
   *  new id. */
  createTrip: (info: TripInfo) => string;

  /** Lookup by id. Returns undefined if not found. */
  getTrip: (id: string) => Trip | undefined;

  /** Apply an update function, diff-and-stamp merge clocks, bump updatedAt,
   *  persist. No-op if id missing. */
  updateTrip: (id: string, fn: (t: Trip) => Trip) => void;

  /** Clone an existing trip with a new id; returns the new id. */
  duplicateTrip: (id: string) => string | null;

  /** Trip-level-additive import (spec step 7). Never mutates existing trips;
   *  collisions get a fresh id + " (imported)" name. Returns count added. */
  importTrips: (imported: Trip[]) => number;

  deleteTrip: (id: string) => void;

  // ---- shared-sync ----
  /** Mint (or return the existing) share secret for a trip. Sharing is
   *  permanent once minted — the secret never rotates. */
  shareTrip: (tripId: string) => string | null;
  /** Create a local trip paired to an existing shared secret (tapped link /
   *  scanned QR). Idempotent: re-joining the same secret returns the trip
   *  already paired to it. Returns the local trip id. */
  joinShared: (secret: string) => string;
  /** Merge an incoming remote copy, matched by shared secret (NOT id — devices
   *  have independent local ids). Conflict-free per merge.ts. */
  mergeRemoteTrip: (remote: Trip) => void;
  /** Durably write all current state, AWAITED. Per-trip saves are otherwise
   *  fire-and-forget, so a change made right before the app is backgrounded can
   *  be lost if the OS suspends/kills the app before the write lands. */
  flushPending: () => Promise<void>;
}

// The sole packer a freshly created trip starts with.
const DEFAULT_PACKERS = [{ id: 'me', name: 'Me' }];

function persist(trip: Trip): void {
  saveTrip(trip).catch((err) =>
    console.warn('packing-list: failed to persist trip', err)
  );
}

export const useTripsStore = create<TripsState>()((set, get) => ({
  trips: [],
  hydrated: false,

  hydrate: async () => {
    const persistClock = (v: number) => {
      setSyncMeta('clock', String(v)).catch(() => {});
    };
    try {
      const [persistedClock, loaded] = await Promise.all([
        getSyncMeta('clock'),
        loadAllTrips(),
      ]);
      // Hygiene before anything reads the data: default legacy-missing clocks,
      // clamp far-future stamps (skew poison), and prune old tombstones (an
      // unpruned trip grows until public relays reject its published state).
      const phys = Date.now();
      const migrated = loaded.map(migrateLoadedTrip);
      const healed = migrated.map((t) =>
        pruneTombstones(healFutureStamps(t, phys + MAX_SKEW_MS), phys)
      );

      // Initialise the skew-resistant clock above both the persisted high-water
      // mark and anything already on disk.
      let maxTs = persistedClock ? Number(persistedClock) || 0 : 0;
      for (const t of healed) {
        maxTs = Math.max(maxTs, t.updatedAt, t.nameUpdatedAt ?? 0);
        for (const it of t.items) {
          maxTs = Math.max(
            maxTs,
            it.updatedAt,
            it.addedAt ?? 0,
            it.packedUpdatedAt ?? 0,
            it.packedAt ?? 0,
            it.deletedAt ?? 0
          );
        }
      }
      initClock(maxTs, persistClock);

      if (QA_MODE && healed.length === 0) {
        set({ trips: qaTrips(), hydrated: true });
        return;
      }
      const { trips, changed } = repairIds(healed);
      set({ trips, hydrated: true });
      // Persist any trip whose data hygiene or id-repair changed on load.
      const dirty = new Set<string>();
      for (let i = 0; i < healed.length; i++) {
        if (healed[i] !== loaded[i]) dirty.add(healed[i].id);
      }
      for (const t of changed) dirty.add(t.id);
      for (const t of trips) if (dirty.has(t.id)) persist(t);
    } catch (err) {
      // Fail open: mark hydrated so UI unblocks; trips just stay empty.
      console.warn('packing-list: failed to load trips from disk', err);
      initClock(Date.now(), persistClock);
      set({ hydrated: true });
    }
  },

  createTrip: (info) => {
    const id = makeId('t');
    const now = clockNow();
    const trip: Trip = {
      id,
      // Account gender personalizes the seeded list — read at create time.
      ...applyTripInfo(info, [], useSettingsStore.getState().gender),
      nameUpdatedAt: now,
      packers: DEFAULT_PACKERS,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ trips: [trip, ...s.trips] }));
    persist(trip);
    return id;
  },

  getTrip: (id) => get().trips.find((t) => t.id === id),

  updateTrip: (id, fn) => {
    let updated: Trip | undefined;
    set((s) => ({
      trips: s.trips.map((t) => {
        if (t.id !== id) return t;
        updated = stampTripUpdate(t, fn(t));
        return updated;
      }),
    }));
    if (updated) persist(updated);
  },

  duplicateTrip: (id) => {
    const original = get().trips.find((t) => t.id === id);
    if (!original) return null;
    const newId = makeId('t');
    const now = clockNow();
    // Reset packed-state; drop tombstones and the share identity (a copy is a
    // new, unshared trip); same name + " (copy)".
    const dup: Trip = {
      ...original,
      id: newId,
      name: `${original.name} (copy)`,
      nameUpdatedAt: now,
      items: original.items
        .filter((it) => it.deletedAt == null)
        .map((it) => ({
          ...it,
          packed: false,
          packedAt: undefined,
          packedUpdatedAt: undefined,
          addedAt: now,
          updatedAt: now,
        })),
      shareIdentity: undefined,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ trips: [dup, ...s.trips] }));
    persist(dup);
    return newId;
  },

  importTrips: (imported) => {
    const { trips, addedTrips } = mergeImported(
      get().trips,
      imported.map(migrateLoadedTrip)
    );
    set({ trips });
    for (const t of addedTrips) persist(t);
    return addedTrips.length;
  },

  deleteTrip: (id) => {
    // Local hard-delete: deleting your copy of a shared trip doesn't delete the
    // partner's (matches grocery — no trip-level tombstone).
    set((s) => ({ trips: s.trips.filter((t) => t.id !== id) }));
    deleteTripFromDb(id).catch((err) =>
      console.warn('packing-list: failed to delete trip from disk', err)
    );
  },

  shareTrip: (tripId) => {
    const trip = get().trips.find((t) => t.id === tripId);
    if (!trip) return null;
    if (trip.shareIdentity) return trip.shareIdentity.secret;
    const identity = makeShareIdentity();
    // Route through updateTrip: the item diff is a no-op (items unchanged), so
    // no item clocks bump, but the whole-trip updatedAt bumps so the new
    // shareIdentity head propagates and the sync engine picks it up.
    get().updateTrip(tripId, (t) => ({ ...t, shareIdentity: identity }));
    return identity.secret;
  },

  joinShared: (secret) => {
    const existing = get().trips.find(
      (t) => t.shareIdentity?.secret === secret
    );
    if (existing) return existing.id;
    const now = clockNow();
    const trip: Trip = {
      id: makeId('t'),
      // "Shared trip" is only a placeholder shown until the first sync arrives.
      // nameUpdatedAt:0 makes it lose the name merge to whatever the trip is
      // actually called, so joining never renames the other person's trip.
      name: 'Shared trip',
      nameUpdatedAt: 0,
      duration: 3,
      typeIds: [],
      packers: [...DEFAULT_PACKERS],
      items: [],
      canDoLaundry: false,
      laundryIntervalDays: LAUNDRY_DEFAULT_INTERVAL,
      thoroughness: THOROUGHNESS_DEFAULT,
      shareIdentity: { secret, createdAt: now },
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ trips: [trip, ...s.trips] }));
    persist(trip);
    return trip.id;
  },

  mergeRemoteTrip: (remote) => {
    const secret = remote.shareIdentity?.secret;
    if (!secret) return;
    const local = get().trips.find((t) => t.shareIdentity?.secret === secret);
    if (!local) return;
    // Heal the INCOMING copy too (hydrate only heals disk): a peer on an older
    // build could republish far-future poisoned stamps on every sync.
    const healed = healFutureStamps(remote, Date.now() + MAX_SKEW_MS);
    // Advance our clock past every timestamp in the incoming copy so our NEXT
    // local edit out-clocks whatever the peer last did.
    let remoteMax = Math.max(healed.updatedAt, healed.nameUpdatedAt ?? 0);
    for (const it of healed.items) {
      remoteMax = Math.max(
        remoteMax,
        it.updatedAt,
        it.addedAt ?? 0,
        it.packedUpdatedAt ?? 0,
        it.packedAt ?? 0,
        it.deletedAt ?? 0
      );
    }
    observeClock(remoteMax);
    const merged = mergeTrip(local, healed);
    // A converged echo (peer answering hello / reconnect force-publish) must
    // not cost a store update + full SQLite write + re-render.
    if (JSON.stringify(merged) === JSON.stringify(local)) return;
    set((s) => ({
      trips: s.trips.map((t) => (t.id === local.id ? merged : t)),
    }));
    persist(merged);
  },

  flushPending: async () => {
    const trips = get().trips;
    await Promise.all(trips.map((t) => saveTrip(t).catch(() => {})));
    try {
      await setSyncMeta('clock', String(clockPeek()));
    } catch {
      /* best-effort */
    }
  },
}));
