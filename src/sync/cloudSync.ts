/**
 * CloudKit sync engine (private database, additive backup/sync).
 *
 * Model (matches the v1.1 plan in CLAUDE.md + the SQLite JSON-blob shape):
 *   - One CKRecord per trip; recordName == trip.id; whole trip in `payload`.
 *   - Last-writer-wins by timestamp: a live trip's clock is `updatedAt`, a
 *     deleted trip's is the local tombstone's `deletedAt` / the record's
 *     `modifiedAt`. The newer side wins; ties are no-ops.
 *   - Deletes propagate as soft-delete tombstone records, so a delete on
 *     one device isn't undone by a pull on another.
 *
 * It is intentionally pull+push on demand (app start, foreground, manual)
 * rather than streaming: simple, robust, good enough for a handful of
 * trips. The whole thing degrades to a no-op when there's no native module
 * or no iCloud account — the app is fully usable local-only.
 *
 * NOT YET DEVICE-VERIFIED: tsc/lint only. The CloudKit round-trip needs an
 * EAS dev/prod build, the Apple Developer portal CloudKit container, and a
 * device signed into iCloud. Same build→device-verify rhythm as the rest
 * of this app.
 */

import { CloudSync, isCloudSyncAvailable, type CloudAccountStatus } from '../../modules/cloud-sync';
import { useTripsStore } from '../store/trips';
import { loadTombstones, setSyncMeta, getSyncMeta } from '../store/db';
import type { Trip } from '../data/trip';

export type SyncResult =
  | { status: 'ok'; pulled: number; pushed: number; at: number }
  | { status: 'unavailable' }
  | { status: 'noAccount' | 'restricted' | 'temporarilyUnavailable' | 'couldNotDetermine' }
  | { status: 'error'; message: string };

function parseTrip(payload: string): Trip | null {
  try {
    const t = JSON.parse(payload) as Trip;
    if (
      t &&
      typeof t.id === 'string' &&
      typeof t.name === 'string' &&
      Array.isArray(t.items) &&
      typeof t.updatedAt === 'number'
    ) {
      return t;
    }
  } catch {
    /* fall through */
  }
  return null;
}

let inFlight: Promise<SyncResult> | null = null;

/** Pull + merge + push. Safe to call concurrently — overlapping calls share
 *  the one in-flight run. */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncResult> {
  if (!isCloudSyncAvailable || !CloudSync) return { status: 'unavailable' };

  let account: CloudAccountStatus;
  try {
    account = await CloudSync.accountStatus();
  } catch (e) {
    return { status: 'error', message: `accountStatus: ${String(e)}` };
  }
  if (account !== 'available') return { status: account };

  let remote;
  try {
    remote = await CloudSync.fetchAll();
  } catch (e) {
    return { status: 'error', message: `fetchAll: ${String(e)}` };
  }

  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localTrips = useTripsStore.getState().trips;
  const localById = new Map(localTrips.map((t) => [t.id, t]));
  const tombstones = new Map(
    (await loadTombstones()).map((t) => [t.id, t.deletedAt])
  );

  const upserts: Trip[] = [];
  const deletes: string[] = [];
  const pushLive: Trip[] = [];
  const pushDeleted: Array<{ id: string; at: number }> = [];

  const ids = new Set<string>([
    ...remoteById.keys(),
    ...localById.keys(),
    ...tombstones.keys(),
  ]);

  for (const id of ids) {
    const r = remoteById.get(id);
    const local = localById.get(id);
    const tomb = tombstones.get(id);

    if (!r) {
      // Cloud has never seen this id.
      if (local) pushLive.push(local);
      else if (tomb != null) pushDeleted.push({ id, at: tomb });
      continue;
    }

    if (r.deleted) {
      // Remote tombstone.
      if (local) {
        if (local.updatedAt > r.modifiedAt) pushLive.push(local); // local revived it
        else deletes.push(id); // honor remote delete
      } // else: we don't have it (or already tombstoned) → converged
      continue;
    }

    // Remote is a live record.
    if (tomb != null && tomb >= r.modifiedAt) {
      pushDeleted.push({ id, at: tomb }); // our delete is newer than their copy
    } else if (!local) {
      const parsed = parseTrip(r.payload);
      if (parsed) upserts.push(parsed); // adopt (new here, or our tombstone is stale)
    } else if (r.modifiedAt > local.updatedAt) {
      const parsed = parseTrip(r.payload);
      if (parsed) upserts.push(parsed); // remote newer
    } else if (local.updatedAt > r.modifiedAt) {
      pushLive.push(local); // local newer
    }
    // equal timestamps → already converged
  }

  useTripsStore.getState().applySync({ upserts, deletes });

  let pushed = 0;
  for (const t of pushLive) {
    try {
      await CloudSync.putTrip(t.id, JSON.stringify(t), t.updatedAt, false);
      pushed++;
    } catch (e) {
      console.warn('packing-list: cloud push (live) failed', t.id, e);
    }
  }
  for (const d of pushDeleted) {
    try {
      await CloudSync.putTrip(d.id, '', d.at, true);
      pushed++;
    } catch (e) {
      console.warn('packing-list: cloud push (delete) failed', d.id, e);
    }
  }

  const at = Date.now();
  await setSyncMeta('lastSyncAt', String(at)).catch(() => {});
  return { status: 'ok', pulled: upserts.length + deletes.length, pushed, at };
}

/** Last successful sync time (ms) or null — for the Settings status line. */
export async function lastSyncAt(): Promise<number | null> {
  const v = await getSyncMeta('lastSyncAt').catch(() => null);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
