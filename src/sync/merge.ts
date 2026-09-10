/**
 * App-specific merge for trips.
 *
 * The per-item LWW-element-set + tombstone logic lives in the factory module
 * (`./mergeRecordSet.ts`). This file resolves the *trip-level* fields and
 * delegates item-set merging to the generic helper. Trip configuration
 * (typeIds, duration, packers, laundry/thoroughness, share identity) follows
 * the whole-trip `updatedAt`; the **name merges on its own clock**
 * (`nameUpdatedAt`) so the name only changes when a person renames the trip —
 * never as a side effect of packing an item, and never when a freshly-joined
 * device (which has no name of its own) syncs in.
 *
 * Packing-specific merge decisions (mirror grocery's checked-clock work):
 *
 * PACKED MERGES ON ITS OWN CLOCK. An item's `packed` carries `packedUpdatedAt`;
 * content fields (name, quantity, category, assignee) ride `updatedAt`. Merging
 * whole items by one clock meant a partner's concurrent rename/quantity edit
 * silently reverted your pack — the "my packed items came back unpacked"
 * defect. The combiner folds the newer packed state into the content winner, so
 * both edits survive. Legacy records (no `packedUpdatedAt`) fall back to
 * `packedAt` then `addedAt` — NEVER `updatedAt` (that would re-create the very
 * defect this clock fixes).
 *
 * DUPLICATE NAMES COLLAPSE DETERMINISTICALLY. Two devices adding "Charger"
 * while apart mint two different ids. Because packing legitimately allows the
 * same name in two categories (a "Charger" in Electronics and one in Bags), the
 * collapse identity is name AND category. SEED ROWS TAKE PART TOO. They carry a
 * deterministic `gen-<rule>` id and so normally merge by id, but "normally" was
 * doing a lot of work: a build shipped before 2026-09-10 re-keyed an edited seed
 * row into the custom id space on the next trip edit, so trips out there already
 * hold one logical row as a `gen-` record on one phone and a `c-` record on
 * another, and nothing but this collapse can put them back together
 * (defect packing-list-20260910-1).
 */

import {
  normalizeItemName,
  type TripItem,
  type Trip,
} from '../data/trip';
import { mergeRecordSet } from './mergeRecordSet';

/** The clock the *name* merges by. Legacy trips persisted before `nameUpdatedAt`
 *  existed fall back to `createdAt` (the name was set at creation). A joined
 *  trip's placeholder name carries `nameUpdatedAt: 0`, so any real name beats
 *  it. */
function nameClock(t: Trip): number {
  return t.nameUpdatedAt ?? t.createdAt;
}

/** When a person last packed/unpacked this copy: the newest of
 *  `packedUpdatedAt` and `packedAt`, or 0 when nobody ever touched it.
 *  `packedAt` must participate even when `packedUpdatedAt` exists: an
 *  OLD-version device packs an item by writing only `packedAt`, and a stale
 *  `packedUpdatedAt` minted earlier by a new-version device must not mask that
 *  fresher action. NEVER falls back to `updatedAt` — the content clock rises
 *  with every edit, so using it would re-create the revert-a-pack defect. */
function packActionClock(it: TripItem): number {
  return Math.max(it.packedUpdatedAt ?? 0, it.packedAt ?? 0);
}

/** The packed state's clock, falling back to `addedAt` (unpacked since
 *  creation) for a copy nobody ever touched. */
function packedClock(it: TripItem): number {
  const explicit = packActionClock(it);
  return explicit > 0 ? explicit : it.addedAt;
}

/**
 * Order two copies of a row by how recent their packed state is. `> 0` means
 * `a` carries the fresher decision.
 *
 * A real pack ACTION always outranks a copy that was merely BORN later. This is
 * about two copies of ONE row (same id), which in packing means a generated one:
 * seed rows carry a deterministic `gen-<rule>` id, so two devices that each turn
 * a trip type on while apart mint the same row independently with their own
 * creation stamps, and letting an untouched later birth beat the other person's
 * tap would quietly unpack what they had ticked off
 * (./__tests__/mergePackedClock.test.ts). Two DIFFERENT rows that happen to
 * share a name are the opposite case — see collapseDuplicateNames.
 */
function comparePackRecency(a: TripItem, b: TripItem): number {
  const aAction = packActionClock(a);
  const bAction = packActionClock(b);
  if (aAction > 0 && bAction === 0) return 1;
  if (bAction > 0 && aAction === 0) return -1;
  return packedClock(a) - packedClock(b);
}

/** Fold the loser's packed state into the record winner when it is newer. Runs
 *  regardless of either side's liveness so a tombstoned winner still carries
 *  the newest packed clock forward (the duplicate-name fold can then lift a
 *  late pack made on a collapsed copy onto the surviving row). Preserves the
 *  winner's own liveness. */
function combineItems(win: TripItem, lose: TripItem): TripItem {
  if (comparePackRecency(lose, win) <= 0) return win;
  return {
    ...win,
    packed: lose.packed,
    packedAt: lose.packedAt,
    packedUpdatedAt: packedClock(lose),
  };
}

/** The duplicate-collapse identity: normalized name AND category (packing
 *  allows the same name across categories). */
function itemKey(it: TripItem): string {
  return normalizeItemName(it.name) + '|' + it.category;
}

/** Every named row takes part in the duplicate collapse — seed rows included.
 *  A seed row's `gen-<rule>` id normally keeps it out of trouble, but it is not
 *  a guarantee (see the header note on re-keyed rows), and one thing listed
 *  twice is a defect whichever id space the two copies came from. */
function isCollapsible(it: TripItem): boolean {
  return it.name !== '';
}

/**
 * The clock the duplicate-name pack fold ranks copies by.
 *
 * A copy with a real pack ACTION ranks by that action. A copy with none ranks by
 * its birth — but only when a PERSON minted it. A `gen-` row is minted by the
 * composer (turning a trip type on, changing the duration), so its birth stamp
 * says nothing about what anyone wants; letting it outrank a sibling copy's real
 * tap would quietly unpack what someone had ticked off, which is defect
 * packing-list-20260820-1 arriving through the collapse instead of through the
 * same-id merge. A typed row's birth IS a person's action ("I need another one,
 * fresh"), so it keeps its say — see the note at the fold below.
 */
function foldClock(it: TripItem): number {
  const action = packActionClock(it);
  if (action > 0) return action;
  return it.id.startsWith('gen-') ? 0 : it.addedAt;
}

/**
 * Reconcile custom items that share a normalized name+category, deterministically.
 *
 * LIVE duplicates (concurrent adds on two devices) collapse to one row: the
 * FRESHEST copy survives (newest content clock; ties by addedAt then id) and
 * keeps its own content. Losers are tombstoned at their own clock so the
 * tie-break (delete wins) retires them on every device. PACKED state folds
 * across the whole group — including rows already tombstoned by an earlier
 * collapse — so a pack made on a copy the rest of the trip has since collapsed
 * away lands on the surviving row instead of evaporating. Pure function of the
 * merged set → identical on every device → convergent.
 */
function collapseDuplicateNames(items: TripItem[]): TripItem[] {
  // Fast bail: only matters when a name+category occurs twice among collapsibles.
  const seen = new Set<string>();
  let hasDup = false;
  for (const it of items) {
    if (!isCollapsible(it)) continue;
    const key = itemKey(it);
    if (seen.has(key)) {
      hasDup = true;
      break;
    }
    seen.add(key);
  }
  if (!hasDup) return items;

  const groups = new Map<string, TripItem[]>();
  for (const it of items) {
    if (!isCollapsible(it)) continue;
    const key = itemKey(it);
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  const replace = new Map<string, TripItem>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const live = group.filter((it) => it.deletedAt == null);
    if (live.length === 0) continue;
    const sorted = [...live].sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.addedAt - a.addedAt ||
        (a.id < b.id ? -1 : 1)
    );
    const keeper = sorted[0];
    // Newest pack action anywhere in the name group binds.
    // `foldClock` here, NOT comparePackRecency: a typed row added later with no
    // pack action of its own is a fresh need and rightly lands unpacked, so its
    // birth still counts. What foldClock strips out is a SEED row's birth, which
    // is the composer's stamp rather than anyone's decision.
    let packSource = keeper;
    for (const it of group) {
      if (it === keeper) continue;
      const dc = foldClock(it) - foldClock(packSource);
      if (dc > 0 || (dc === 0 && !it.packed)) packSource = it;
    }
    for (const dup of sorted.slice(1)) {
      replace.set(dup.id, {
        ...dup,
        deletedAt: Math.max(dup.updatedAt, dup.deletedAt ?? 0),
      });
    }
    // Fold only when the winning copy carries a real pack decision. Without
    // this, a group of untouched seed copies would still write the loser's
    // BIRTH stamp into the keeper's `packedUpdatedAt` — minting a pack action
    // nobody performed, which then out-clocks a real tap on the next merge.
    const foldsADecision =
      packActionClock(packSource) > 0 || packSource.packed !== keeper.packed;
    if (
      packSource !== keeper &&
      foldsADecision &&
      (packSource.packed !== keeper.packed ||
        packSource.packedAt !== keeper.packedAt ||
        packedClock(packSource) !== packedClock(keeper))
    ) {
      replace.set(keeper.id, {
        ...keeper,
        packed: packSource.packed,
        packedAt: packSource.packedAt,
        packedUpdatedAt: packedClock(packSource),
      });
    }
  }
  if (replace.size === 0) return items;
  return items.map((it) => replace.get(it.id) ?? it);
}

/** The trip-level configuration that resolves by the whole-trip clock. */
function headOf(t: Trip): string {
  return JSON.stringify([
    t.typeIds,
    t.duration,
    t.packers,
    t.canDoLaundry ?? false,
    t.laundryIntervalDays ?? null,
    t.thoroughness ?? null,
  ]);
}

/** Merge `remote` into `local`, returning a new trip. Conflict-free,
 *  commutative, idempotent. */
export function mergeTrip(local: Trip, remote: Trip): Trip {
  // Head (trip configuration + share identity) resolves by the whole-trip
  // clock; tie → the greater serialized head, so both devices agree even when
  // two edits land in the same millisecond ("keep local" would diverge).
  const head =
    local.updatedAt !== remote.updatedAt
      ? local.updatedAt > remote.updatedAt
        ? local
        : remote
      : headOf(local) >= headOf(remote)
        ? local
        : remote;
  // The name resolves on its OWN clock, independent of the trip's updatedAt.
  // Tie → the lexicographically greater name.
  const nc = nameClock(local) - nameClock(remote);
  const nameHead =
    nc !== 0 ? (nc > 0 ? local : remote) : local.name >= remote.name ? local : remote;
  return {
    id: local.id, // keep the local id — devices have independent local ids
    name: nameHead.name,
    nameUpdatedAt: Math.max(nameClock(local), nameClock(remote)),
    duration: head.duration,
    typeIds: head.typeIds,
    packers: head.packers,
    canDoLaundry: head.canDoLaundry,
    laundryIntervalDays: head.laundryIntervalDays,
    thoroughness: head.thoroughness,
    shareIdentity:
      head.shareIdentity ?? local.shareIdentity ?? remote.shareIdentity,
    items: collapseDuplicateNames(
      mergeRecordSet(local.items, remote.items, combineItems)
    ),
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
