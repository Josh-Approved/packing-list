/**
 * Export / import transfer layer (spec step 7 — recovery UX).
 *
 * UI-agnostic and pure except for makeId() on the collision path. Two jobs:
 *   1. serializeTrips()  — wrap all trips in a versioned envelope as JSON.
 *   2. parseTransfer()   — validate an envelope strictly, all-or-nothing.
 *   3. mergeImported()   — fold parsed trips into the live list.
 *
 * Design (settled before build, see project memory):
 *   - Import is purely ADDITIVE at the trip level. It never mutates, replaces
 *     or deletes an existing trip.
 *   - On id collision (re-import on the same device, partner sends back a
 *     list that originated here) we mint a fresh id and tag the name
 *     " (imported)" so the two are visibly distinct — the same non-destructive
 *     move store.duplicateTrip / repairIds already make.
 *   - Re-importing the same file twice therefore yields visible duplicates.
 *     Accepted: visible + reversible (long-press → Delete) beats silent
 *     dedupe/reconciliation, which is exactly the magic we rejected.
 *   - Validation is strict and whole-file: a damaged or foreign file imports
 *     NOTHING rather than partially corrupting a list the user trusted.
 */

import { makeId } from './id';
import {
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  type Trip,
  type TripItem,
  type Packer,
  type Thoroughness,
} from '../data/trip';

/** Bump only on a breaking envelope-shape change. Unknown/newer → rejected. */
export const TRANSFER_SCHEMA = 1;

const APP_TAG = 'packing-list';

interface TransferEnvelope {
  app: string;
  schema: number;
  exportedAt: number;
  trips: Trip[];
}

/** Thrown with a user-facing message — surface .message directly in an Alert. */
export class TransferError extends Error {}

export function serializeTrips(trips: Trip[]): string {
  const envelope: TransferEnvelope = {
    app: APP_TAG,
    schema: TRANSFER_SCHEMA,
    exportedAt: Date.now(),
    trips,
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------- validation ----------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const DAMAGED = "This export is damaged and can't be imported.";

function validatePacker(v: unknown): Packer {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) {
    throw new TransferError(DAMAGED);
  }
  return { id: v.id, name: v.name };
}

function validateItem(v: unknown): TripItem {
  if (
    !isObj(v) ||
    !isStr(v.id) ||
    !isStr(v.name) ||
    !isStr(v.category) ||
    !isNum(v.quantity) ||
    !isStr(v.assigneeId) ||
    !isBool(v.packed) ||
    !isStr(v.source)
  ) {
    throw new TransferError(DAMAGED);
  }
  // Pass the row through whole: optional provenance fields (fromTypeIds,
  // userModified, originName) are preserved verbatim so a round-trip
  // export→import doesn't strip composition history.
  return v as unknown as TripItem;
}

function validateTrip(v: unknown): Trip {
  if (
    !isObj(v) ||
    !isStr(v.id) ||
    !isStr(v.name) ||
    !isNum(v.duration) ||
    !Array.isArray(v.typeIds) ||
    !Array.isArray(v.packers) ||
    !Array.isArray(v.items) ||
    !isNum(v.createdAt) ||
    !isNum(v.updatedAt)
  ) {
    throw new TransferError(DAMAGED);
  }
  if (!v.typeIds.every(isStr)) throw new TransferError(DAMAGED);
  // Trip-info fields are optional/lenient: exports made before they existed
  // simply lack them, so a missing or malformed value defaults rather than
  // failing the whole import (validation is strict about shape, forgiving
  // about a newer optional field an older export couldn't have written).
  const thoroughness: Thoroughness =
    v.thoroughness === 'minimalist' ||
    v.thoroughness === 'normal' ||
    v.thoroughness === 'thorough'
      ? v.thoroughness
      : THOROUGHNESS_DEFAULT;
  // Shared-sync fields are preserved verbatim so an export→import round-trip
  // keeps the name clock and share pairing intact. Both are optional/lenient:
  // an export made before they existed simply lacks them.
  const shareIdentity =
    isObj(v.shareIdentity) &&
    isStr(v.shareIdentity.secret) &&
    isNum(v.shareIdentity.createdAt)
      ? { secret: v.shareIdentity.secret, createdAt: v.shareIdentity.createdAt }
      : undefined;
  return {
    id: v.id,
    name: v.name,
    nameUpdatedAt: isNum(v.nameUpdatedAt) ? v.nameUpdatedAt : v.createdAt,
    duration: v.duration,
    typeIds: v.typeIds as Trip['typeIds'],
    packers: v.packers.map(validatePacker),
    items: v.items.map(validateItem),
    canDoLaundry: isBool(v.canDoLaundry) ? v.canDoLaundry : false,
    laundryIntervalDays: isNum(v.laundryIntervalDays)
      ? v.laundryIntervalDays
      : LAUNDRY_DEFAULT_INTERVAL,
    thoroughness,
    ...(shareIdentity ? { shareIdentity } : {}),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/**
 * Parse + strictly validate an export file. Returns the trips on success;
 * throws TransferError with a user-facing .message on any problem.
 */
export function parseTransfer(text: string): Trip[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TransferError("This file isn't a Packing List export.");
  }
  if (!isObj(raw) || raw.app !== APP_TAG) {
    throw new TransferError("This file isn't a Packing List export.");
  }
  if (!isNum(raw.schema) || raw.schema > TRANSFER_SCHEMA) {
    throw new TransferError(
      'This backup was made by a newer version of the app. Update Packing List and try again.'
    );
  }
  if (!Array.isArray(raw.trips) || raw.trips.length === 0) {
    throw new TransferError("This export doesn't contain any trips.");
  }
  return raw.trips.map(validateTrip);
}

// ---------- merge ----------

/**
 * Trip-level-additive merge. Returns the new full list (imported block
 * prepended, newest-first, matching createTrip/duplicateTrip ordering) and
 * the processed imported trips so the caller can persist exactly those.
 *
 * updatedAt is reset to now so imported trips stay pinned to the top both
 * this session and after the next hydrate (DB sorts by updatedAt DESC) —
 * a trip vanishing down the list right after you import it is more
 * confusing than losing its original "last edited" stamp. createdAt is
 * preserved (semantic origin). packed state is preserved — this is
 * recovery, so half-packed lists must survive the round-trip.
 */
export function mergeImported(
  existing: Trip[],
  imported: Trip[]
): { trips: Trip[]; addedTrips: Trip[] } {
  const usedTripIds = new Set(existing.map((t) => t.id));
  const now = Date.now();

  const addedTrips = imported.map((t) => {
    const collides = usedTripIds.has(t.id);
    const id = collides ? makeId('t') : t.id;
    usedTripIds.add(id);
    return {
      ...t,
      id,
      name: collides ? `${t.name} (imported)` : t.name,
      createdAt: t.createdAt,
      updatedAt: now,
    };
  });

  return { trips: [...addedTrips, ...existing], addedTrips };
}
