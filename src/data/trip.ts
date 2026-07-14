/**
 * Trip data model + composition engine for packing-list.
 *
 * UI-agnostic. Mostly pure — composeItems() mints a fresh id (via makeId)
 * when it reclassifies an edited seed item to custom, so it is not strictly
 * deterministic on that path. Everything else is pure. Spec source:
 * `Packing List - Josh Approved — Build Spec` § Data model + § Composition rules.
 *
 * Composition rules (from the spec, restated):
 *   1. Walk every rule from every selected type, keyed by name.toLowerCase().
 *   2. If the same name appears in multiple types: take max() of computed
 *      quantities. Merge fromTypeIds. If any contributing rule is shared,
 *      the merged item is shared.
 *   3. Items the user manually edited (userModified: true) retain their
 *      user-set quantity and assignee — composition does not overwrite them.
 *   4. When a type is toggled off, generated items from that type drop
 *      UNLESS they're userModified or also produced by another still-selected
 *      type. Modified items are kept silently and reclassified as
 *      source: 'custom' so they survive future regeneration.
 */

import {
  Shirt, Sun, Snowflake, Briefcase, Mountain, Building2,
  Music, Car, Tent, Globe, Dumbbell, Sparkles, Baby,
  type LucideIcon,
} from 'lucide-react-native';
import { makeId } from '../lib/id';
import { now as clockNow } from '../sync/clock';

// ============================================================================
// Types
// ============================================================================

export type TripTypeId =
  | 'essentials' | 'beach' | 'cold' | 'business' | 'hiking' | 'urban'
  | 'festival' | 'roadtrip' | 'camping' | 'international' | 'gym'
  | 'formal' | 'kids';

export type Category =
  | 'Documents' | 'Clothing' | 'Toiletries' | 'Electronics'
  | 'Gear' | 'Accessories' | 'Food' | 'Kids' | 'Misc';

/**
 * How thoroughly the user wants to pack. Tiers nest: 'minimalist' ⊂ 'normal'
 * ⊂ 'thorough'. A trip at thoroughness T includes every seed rule whose own
 * tier rank is <= T (see ruleInScope). Rules with no explicit tier are
 * treated as 'normal' — the everyday default list.
 */
export type Thoroughness = 'minimalist' | 'normal' | 'thorough';

/**
 * Account-level gender preference. Only ever used to decide which gendered
 * seed rules are suggested when a list is generated (e.g. bras / period
 * products). It is NOT stored on a Trip, never leaves the device, and
 * 'unspecified' (the default, and what a dismissed first-run prompt leaves)
 * behaves exactly as the app did before this existed — no gendered extras.
 */
export type GenderPref = 'female' | 'male' | 'unspecified';

export interface Packer {
  id: string;
  name: string;
}

/**
 * The persistent shared-trip identity. Absent until a trip is shared; written
 * once at pairing and stored durably on every paired device (this is what
 * makes "pair once, synced forever" hold). Mirrors grocery-list's
 * ShareIdentity so both apps consume the same shared-sync module.
 */
export interface ShareIdentity {
  /** Stable per-trip secret; the drop-box channel id derives from it. */
  secret: string;
  createdAt: number;
}

export interface TripItem {
  id: string;
  name: string;
  category: Category;
  quantity: number;
  /** Packer.id, or 'shared' for the whole trip. */
  assigneeId: string;
  packed: boolean;
  source: 'generated' | 'custom';
  /** Which trip type(s) contributed this item. Undefined for source='custom'. */
  fromTypeIds?: TripTypeId[];
  /** True if user edited quantity/assignee after generation. Reclassifies to
   *  source='custom' on next composition (then this flag resets to false). */
  userModified?: boolean;
  /** Lowercased rule name this item descends from (provenance). Stamped at
   *  generation. Survives renames/reclassification so composeItems knows the
   *  originating rule is already represented by a (possibly renamed) item and
   *  must NOT regenerate a fresh duplicate. Undefined for items the user
   *  typed in themselves (no originating rule). */
  originName?: string;
  // ---- shared-sync merge clocks (mirror grocery GroceryItem) ----
  /** Stamped at item creation. Present on all fresh items; legacy items get it
   *  defaulted at hydrate. */
  addedAt: number;
  /** Content clock. Stamped at creation and on any content edit
   *  (name/quantity/category/assignee/…). NOT bumped by a packed-toggle. */
  updatedAt: number;
  /** Soft-delete tombstone (ms). Set instead of removing the item so a delete
   *  survives a cross-device merge. UI treats `deletedAt != null` as gone. */
  deletedAt?: number;
  /** When `packed` last became true, cleared when unpacked — mirrors grocery
   *  `checkedAt`. */
  packedAt?: number;
  /** The packed-flag's OWN merge clock (mirrors grocery `checkedUpdatedAt`).
   *  Stamped whenever `packed` changes, INSTEAD of `updatedAt`, so a partner's
   *  concurrent content edit can't revert a pack/unpack when the copies merge.
   *  Absent on legacy records → merge falls back to `packedAt`/`addedAt`. */
  packedUpdatedAt?: number;
}

export interface Trip {
  id: string;
  name: string;
  /** When the *name* was last set by a person (rename, or creation). The name
   *  merges by its own clock, NOT the whole-trip `updatedAt` — so editing an
   *  item never lets a stale name win, and a freshly-joined device (which has
   *  no name of its own, nameUpdatedAt:0) can't rename the other side's trip.
   *  Legacy trips (persisted before this field) default to `createdAt`. */
  nameUpdatedAt: number;
  /** Days, integer. MIN_DURATION_DAYS <= duration <= MAX_DURATION_DAYS. */
  duration: number;
  typeIds: TripTypeId[];
  packers: Packer[];
  items: TripItem[];
  /** Present once the trip is shared; the join key for the sync channel. */
  shareIdentity?: ShareIdentity;
  /**
   * Whether the user can do laundry mid-trip. Optional for backward compat:
   * trips persisted before this field default to false via tripOpts().
   */
  canDoLaundry?: boolean;
  /**
   * Days between laundry runs — the cycle per-day items must cover. Only
   * meaningful when canDoLaundry. Optional/legacy → LAUNDRY_DEFAULT_INTERVAL.
   */
  laundryIntervalDays?: number;
  /** Packing thoroughness. Optional/legacy → THOROUGHNESS_DEFAULT ('normal'). */
  thoroughness?: Thoroughness;
  createdAt: number;
  updatedAt: number;
}

export interface ItemRule {
  name: string;
  category: Category;
  // Exactly one of fixed | perDay | perDayDivide.
  fixed?: number;
  perDay?: number;
  perDayDivide?: number;
  /** Cap on computed quantity (only meaningful with perDay). */
  max?: number;
  /** Suggests 'shared' assignee when this rule contributes. */
  shared?: boolean;
  /**
   * Lowest thoroughness at which this rule is suggested. Omitted = 'normal'
   * (the everyday list). 'minimalist' = true can't-leave-without items;
   * 'thorough' = the careful-packer extras.
   */
  tier?: Thoroughness;
  /**
   * Only suggest this rule when the account gender preference matches.
   * Omitted = everyone (the default — unchanged behavior). A rule with a
   * gender is skipped entirely for any other preference, including
   * 'unspecified'.
   */
  gender?: Exclude<GenderPref, 'unspecified'>;
}

export interface TripTypeDef {
  id: TripTypeId;
  name: string;
  /** Lucide icon name; resolved via getTripTypeIcon(). */
  iconName: string;
  defaultSelected?: boolean;
  itemRules: ItemRule[];
}

// ============================================================================
// Constants
// ============================================================================

export const CATEGORY_ORDER: Category[] = [
  'Documents', 'Clothing', 'Toiletries', 'Electronics',
  'Gear', 'Accessories', 'Food', 'Kids', 'Misc',
];

export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 60;

export const SHARED_ASSIGNEE = 'shared' as const;

// ---------- Laundry + thoroughness ----------

export const THOROUGHNESS_DEFAULT: Thoroughness = 'normal';

export const MIN_LAUNDRY_INTERVAL = 1;
export const MAX_LAUNDRY_INTERVAL = 14;
export const LAUNDRY_DEFAULT_INTERVAL = 4;

/** Tier nesting: a higher rank includes everything at or below it. */
const TIER_RANK: Record<Thoroughness, number> = {
  minimalist: 0,
  normal: 1,
  thorough: 2,
};

/** Does this rule appear at the given thoroughness? Untiered = 'normal'. */
function ruleInScope(rule: ItemRule, thoroughness: Thoroughness): boolean {
  return TIER_RANK[rule.tier ?? 'normal'] <= TIER_RANK[thoroughness];
}

/**
 * Composition inputs beyond typeIds/duration. Pulled off the Trip (with
 * legacy-safe defaults) by tripOpts(); also assembled directly by the
 * create flow before a Trip exists.
 */
export interface CompositionOpts {
  canDoLaundry: boolean;
  laundryIntervalDays: number;
  thoroughness: Thoroughness;
  /**
   * Account gender preference. Account-level (not per-trip), so callers pass
   * the current setting in at compose time. Defaults to 'unspecified', which
   * suppresses every gendered rule — identical to the pre-gender behavior.
   */
  gender: GenderPref;
}

export const DEFAULT_COMPOSITION_OPTS: CompositionOpts = {
  canDoLaundry: false,
  laundryIntervalDays: LAUNDRY_DEFAULT_INTERVAL,
  thoroughness: THOROUGHNESS_DEFAULT,
  gender: 'unspecified',
};

/**
 * Read composition options off a Trip, defaulting any field a legacy trip
 * (persisted before these fields existed) is missing. Missing → behaves
 * exactly as the pre-laundry, normal-thoroughness app did.
 */
export function tripOpts(
  trip: Pick<Trip, 'canDoLaundry' | 'laundryIntervalDays' | 'thoroughness'>,
  gender: GenderPref = 'unspecified'
): CompositionOpts {
  return {
    canDoLaundry: trip.canDoLaundry ?? false,
    laundryIntervalDays: trip.laundryIntervalDays ?? LAUNDRY_DEFAULT_INTERVAL,
    thoroughness: trip.thoroughness ?? THOROUGHNESS_DEFAULT,
    gender,
  };
}

/** Clamp a laundry interval into the supported range (integer days). */
export function clampLaundryInterval(n: number): number {
  return Math.min(
    MAX_LAUNDRY_INTERVAL,
    Math.max(MIN_LAUNDRY_INTERVAL, Math.round(n))
  );
}

// ============================================================================
// Shared-sync data hygiene (CRDT-ready) — mirror grocery data/list.ts
// ============================================================================

/** THE name-identity rule for the merge's duplicate collapse (and any layer
 *  that answers "are these the same item?"). Packing legitimately allows the
 *  same name in two categories, so the merge keys on name AND category — this
 *  is just the name half of that key. */
export function normalizeItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** Items the user can see — tombstoned ones are gone. */
export function visibleItems(trip: Pick<Trip, 'items'>): TripItem[] {
  return trip.items.filter((it) => it.deletedAt == null);
}

/** How long a tombstone keeps carrying its dead item in the payload, and how
 *  many we keep at most. Tombstones exist so a delete beats a paired device's
 *  stale live copy; a device offline longer than the horizon may resurrect
 *  what it never saw deleted (accepted tradeoff — without pruning the
 *  published payload grows without bound until public relays reject it and
 *  sync silently dies, which is far worse). */
export const TOMBSTONE_HORIZON_MS = 21 * 24 * 3600 * 1000;
/** High enough that a couple of heavy back-to-back trips never evict a
 *  tombstone younger than the horizon; still bounds a pathological flood. */
export const MAX_TOMBSTONES = 150;
/** Tombstones keep their payload (notably the NAME) this long: the merge folds
 *  a late pack made on a collapsed duplicate into the surviving same-name row,
 *  and that fold needs the dead row's name. After a week the trip has long
 *  converged; only id + clocks are worth carrying. */
export const STRIP_AFTER_MS = 7 * 24 * 3600 * 1000;

/**
 * Bound the trip's dead weight: drop tombstones older than the horizon or
 * beyond the count cap (oldest first), and strip payload fields off the
 * remaining ones once they're old enough that no same-name fold can still need
 * them. Returns the same trip object when nothing changed, so callers can
 * cheaply detect a no-op. PURE of merge — depends on wall time, so run it at
 * hydrate / after a delete, never inside the merge.
 */
export function pruneTombstones(trip: Trip, now: number): Trip {
  const dead = trip.items.filter((it) => it.deletedAt != null);
  if (dead.length === 0) return trip;

  const keepIds = new Set(
    dead
      .filter((it) => now - (it.deletedAt ?? 0) < TOMBSTONE_HORIZON_MS)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      .slice(0, MAX_TOMBSTONES)
      .map((it) => it.id)
  );

  let changed = false;
  const items: TripItem[] = [];
  for (const it of trip.items) {
    if (it.deletedAt == null) {
      items.push(it);
      continue;
    }
    if (!keepIds.has(it.id)) {
      changed = true;
      continue;
    }
    const oldEnoughToStrip = now - (it.deletedAt ?? 0) >= STRIP_AFTER_MS;
    if (!oldEnoughToStrip || it.name === '') {
      items.push(it);
      continue;
    }
    changed = true;
    items.push({
      id: it.id,
      name: '',
      category: it.category,
      quantity: 1,
      assigneeId: SHARED_ASSIGNEE,
      packed: false,
      source: it.source,
      addedAt: it.addedAt,
      updatedAt: it.updatedAt,
      packedUpdatedAt: it.packedUpdatedAt,
      packedAt: it.packedAt,
      deletedAt: it.deletedAt,
    });
  }
  return changed ? { ...trip, items } : trip;
}

/**
 * Clamp every merge-participating stamp to `cap` (wall time + the clock's max
 * skew). Heals data poisoned by a device with a fast wall clock minting
 * far-future stamps: those stamps otherwise beat every fresh edit until real
 * time catches up. Returns the same object when nothing changed.
 */
export function healFutureStamps(trip: Trip, cap: number): Trip {
  const clampTs = (t: number): number => (t > cap ? cap : t);
  let changed =
    trip.updatedAt > cap ||
    (trip.nameUpdatedAt ?? 0) > cap ||
    trip.createdAt > cap;
  const items = trip.items.map((it) => {
    if (
      it.updatedAt <= cap &&
      it.addedAt <= cap &&
      (it.packedUpdatedAt ?? 0) <= cap &&
      (it.packedAt ?? 0) <= cap &&
      (it.deletedAt ?? 0) <= cap
    ) {
      return it;
    }
    changed = true;
    return {
      ...it,
      updatedAt: clampTs(it.updatedAt),
      addedAt: clampTs(it.addedAt),
      packedUpdatedAt:
        it.packedUpdatedAt != null ? clampTs(it.packedUpdatedAt) : undefined,
      packedAt: it.packedAt != null ? clampTs(it.packedAt) : undefined,
      deletedAt: it.deletedAt != null ? clampTs(it.deletedAt) : undefined,
    };
  });
  if (!changed) return trip;
  return {
    ...trip,
    updatedAt: clampTs(trip.updatedAt),
    nameUpdatedAt: clampTs(trip.nameUpdatedAt ?? trip.createdAt),
    createdAt: clampTs(trip.createdAt),
    items,
  };
}

// ============================================================================
// Trip type definitions — the 13 seed types
// ============================================================================

// Tier convention used below:
//   tier: 'minimalist'  → in every list, even the leanest. The true core.
//   (no tier)           → 'normal', the everyday expected list.
//   tier: 'thorough'    → the careful-packer extras (just-in-case, comfort).
// Shared/common item names (Sunscreen, First aid kit, Headphones, Portable
// charger, Bug spray, Sunglasses, Rain jacket, Water bottle) are spelled
// identically across types so composeItems() merges rather than duplicates.

export const TRIP_TYPES: TripTypeDef[] = [
  {
    id: 'essentials',
    name: 'Essentials',
    iconName: 'Shirt',
    defaultSelected: true,
    itemRules: [
      // Core — you cannot travel without these.
      { name: 'Underwear', category: 'Clothing', perDay: 1, tier: 'minimalist' },
      { name: 'Bras', category: 'Clothing', perDayDivide: 3, tier: 'minimalist', gender: 'female' },
      { name: 'Socks', category: 'Clothing', perDay: 1, tier: 'minimalist' },
      { name: 'T-shirts', category: 'Clothing', perDay: 1, tier: 'minimalist' },
      { name: 'Toothbrush', category: 'Toiletries', fixed: 1, tier: 'minimalist' },
      { name: 'Toothpaste', category: 'Toiletries', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Tampons / pads', category: 'Toiletries', fixed: 1, tier: 'minimalist', gender: 'female' },
      { name: 'Phone charger', category: 'Electronics', fixed: 1, tier: 'minimalist' },
      { name: 'Wallet', category: 'Documents', fixed: 1, tier: 'minimalist' },
      { name: 'Phone', category: 'Electronics', fixed: 1, tier: 'minimalist' },
      // Normal — the everyday expected list.
      { name: 'Pants', category: 'Clothing', perDayDivide: 3 },
      { name: 'Pajamas', category: 'Clothing', fixed: 1 },
      { name: 'Sweater / hoodie', category: 'Clothing', fixed: 1 },
      { name: 'Deodorant', category: 'Toiletries', fixed: 1 },
      { name: 'Shampoo', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Body wash / soap', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Hairbrush / comb', category: 'Toiletries', fixed: 1 },
      { name: 'Sunglasses', category: 'Accessories', fixed: 1 },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
      { name: 'Headphones', category: 'Electronics', fixed: 1 },
      { name: 'Keys', category: 'Documents', fixed: 1 },
      { name: 'Lip balm', category: 'Toiletries', fixed: 1 },
      // Thorough — the careful-packer extras.
      { name: 'Razor', category: 'Toiletries', fixed: 1, tier: 'thorough' },
      { name: 'Floss', category: 'Toiletries', fixed: 1, tier: 'thorough' },
      { name: 'Nail clippers', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Hand sanitizer', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Tissues', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Pain relievers', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Bandages', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Laundry bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Travel pillow', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Earplugs', category: 'Misc', fixed: 1, tier: 'thorough' },
      { name: 'Portable charger', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'Watch', category: 'Accessories', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'beach',
    name: 'Beach',
    iconName: 'Sun',
    itemRules: [
      { name: 'Swimsuit', category: 'Clothing', fixed: 2, tier: 'minimalist' },
      { name: 'Sunscreen', category: 'Toiletries', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Beach towel', category: 'Gear', fixed: 1 },
      { name: 'Sandals', category: 'Clothing', fixed: 1 },
      { name: 'Sunglasses', category: 'Accessories', fixed: 1 },
      { name: 'Sun hat', category: 'Accessories', fixed: 1 },
      { name: 'After-sun / aloe', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Cover-up / sarong', category: 'Clothing', fixed: 1 },
      { name: 'Beach bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Snorkel set', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Waterproof phone pouch', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'Beach umbrella', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Cooler', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Beach blanket', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Water shoes', category: 'Clothing', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'cold',
    name: 'Cold weather',
    iconName: 'Snowflake',
    itemRules: [
      { name: 'Heavy jacket', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Thermal base layers', category: 'Clothing', fixed: 2, tier: 'minimalist' },
      { name: 'Wool socks', category: 'Clothing', fixed: 3, tier: 'minimalist' },
      { name: 'Gloves', category: 'Accessories', fixed: 1 },
      { name: 'Beanie', category: 'Accessories', fixed: 1 },
      { name: 'Scarf', category: 'Accessories', fixed: 1 },
      { name: 'Sweater', category: 'Clothing', fixed: 2 },
      { name: 'Insulated boots', category: 'Clothing', fixed: 1 },
      { name: 'Long underwear', category: 'Clothing', fixed: 2 },
      { name: 'Hand warmers', category: 'Gear', fixed: 4, tier: 'thorough' },
      { name: 'Lip balm', category: 'Toiletries', fixed: 1, tier: 'thorough' },
      { name: 'Heavy moisturizer', category: 'Toiletries', fixed: 1, tier: 'thorough' },
      { name: 'Ear muffs', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Snow pants', category: 'Clothing', fixed: 1, tier: 'thorough' },
      { name: 'Balaclava', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Thermos', category: 'Gear', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    iconName: 'Briefcase',
    itemRules: [
      { name: 'Dress shirts', category: 'Clothing', perDay: 1, tier: 'minimalist' },
      { name: 'Dress pants', category: 'Clothing', perDayDivide: 2, tier: 'minimalist' },
      { name: 'Dress shoes', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Laptop', category: 'Electronics', fixed: 1, tier: 'minimalist' },
      { name: 'Laptop charger', category: 'Electronics', fixed: 1, tier: 'minimalist' },
      { name: 'Tie', category: 'Clothing', fixed: 2 },
      { name: 'Belt', category: 'Clothing', fixed: 1 },
      { name: 'Blazer / suit jacket', category: 'Clothing', fixed: 1 },
      { name: 'Dress socks', category: 'Clothing', perDay: 1 },
      { name: 'Notebook', category: 'Misc', fixed: 1 },
      { name: 'Pens', category: 'Misc', fixed: 2 },
      { name: 'Business cards', category: 'Documents', fixed: 1 },
      { name: 'Garment bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Travel steamer', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'Lint roller', category: 'Misc', fixed: 1, tier: 'thorough' },
      { name: 'Cufflinks', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Portable monitor', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'Extra charging cable', category: 'Electronics', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'hiking',
    name: 'Hiking',
    iconName: 'Mountain',
    itemRules: [
      { name: 'Hiking boots', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Hiking socks', category: 'Clothing', perDay: 1, max: 5, tier: 'minimalist' },
      { name: 'Water bottle', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Daypack', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Trail snacks', category: 'Food', fixed: 3, shared: true },
      { name: 'First aid kit', category: 'Gear', fixed: 1, shared: true },
      { name: 'Rain jacket', category: 'Clothing', fixed: 1 },
      { name: 'Moisture-wicking shirts', category: 'Clothing', perDay: 1, max: 5 },
      { name: 'Hiking pants', category: 'Clothing', perDayDivide: 3 },
      { name: 'Sun hat', category: 'Accessories', fixed: 1 },
      { name: 'Sunscreen', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Bug spray', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Trekking poles', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Headlamp', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Map / compass', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Blister kit', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Water filter', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Gaiters', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Emergency whistle', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Electrolyte tablets', category: 'Food', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'urban',
    name: 'Urban',
    iconName: 'Building2',
    itemRules: [
      { name: 'Walking shoes', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Day bag', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Portable charger', category: 'Electronics', fixed: 1 },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
      { name: 'Light jacket', category: 'Clothing', fixed: 1 },
      { name: 'Casual outfits', category: 'Clothing', perDayDivide: 2 },
      { name: 'Offline maps', category: 'Misc', fixed: 1 },
      { name: 'Umbrella', category: 'Gear', fixed: 1, shared: true },
      { name: 'Anti-theft bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Transit card', category: 'Documents', fixed: 1, tier: 'thorough' },
      { name: 'Evening shoes', category: 'Clothing', fixed: 1, tier: 'thorough' },
      { name: 'Crossbody wallet', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Refillable coffee cup', category: 'Gear', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'festival',
    name: 'Festival',
    iconName: 'Music',
    itemRules: [
      { name: 'Tickets / wristband', category: 'Documents', fixed: 1, tier: 'minimalist' },
      { name: 'Sunscreen', category: 'Toiletries', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Comfy shoes', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Earplugs', category: 'Misc', fixed: 1 },
      { name: 'Portable charger', category: 'Electronics', fixed: 1 },
      { name: 'Bandana', category: 'Accessories', fixed: 1 },
      { name: 'Cash', category: 'Documents', fixed: 1 },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
      { name: 'Hat', category: 'Accessories', fixed: 1 },
      { name: 'Rain poncho', category: 'Clothing', fixed: 1 },
      { name: 'Hydration pack', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Glow sticks', category: 'Misc', fixed: 1, tier: 'thorough' },
      { name: 'Hand sanitizer', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Wet wipes', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Foldable chair', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Fanny pack', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Festival outfits', category: 'Clothing', perDay: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'roadtrip',
    name: 'Road trip',
    iconName: 'Car',
    itemRules: [
      { name: "Driver's license", category: 'Documents', fixed: 1, tier: 'minimalist' },
      { name: 'Phone car mount', category: 'Electronics', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Phone charging cable', category: 'Electronics', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Snacks', category: 'Food', fixed: 5, shared: true },
      { name: 'Cooler', category: 'Gear', fixed: 1, shared: true },
      { name: 'Water bottles', category: 'Gear', fixed: 2, shared: true },
      { name: 'Sunglasses', category: 'Accessories', fixed: 1 },
      { name: 'Vehicle registration', category: 'Documents', fixed: 1, shared: true },
      { name: 'Roadside emergency kit', category: 'Gear', fixed: 1, shared: true },
      { name: 'Travel mug', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Trash bags', category: 'Misc', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Blanket', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Tire pressure gauge', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Jumper cables', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Paper towels', category: 'Misc', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Paper map / atlas', category: 'Misc', fixed: 1, shared: true, tier: 'thorough' },
    ],
  },
  {
    id: 'camping',
    name: 'Camping',
    iconName: 'Tent',
    itemRules: [
      { name: 'Tent', category: 'Gear', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Sleeping bag', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Sleeping pad', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Headlamp', category: 'Gear', fixed: 1, tier: 'minimalist' },
      { name: 'Camp stove', category: 'Gear', fixed: 1, shared: true },
      { name: 'Cookware', category: 'Gear', fixed: 1, shared: true },
      { name: 'Camp chair', category: 'Gear', fixed: 1 },
      { name: 'Lighter / matches', category: 'Gear', fixed: 1, shared: true },
      { name: 'Water filter', category: 'Gear', fixed: 1, shared: true },
      { name: 'First aid kit', category: 'Gear', fixed: 1, shared: true },
      { name: 'Bug spray', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Trash bags', category: 'Misc', fixed: 1, shared: true },
      { name: 'Lantern', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Camp pillow', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Multi-tool', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Paracord', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Dry bags', category: 'Gear', fixed: 2, tier: 'thorough' },
      { name: 'Camp towel', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Cooler', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Biodegradable soap', category: 'Toiletries', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Tarp', category: 'Gear', fixed: 1, shared: true, tier: 'thorough' },
    ],
  },
  {
    id: 'international',
    name: 'International',
    iconName: 'Globe',
    itemRules: [
      { name: 'Passport', category: 'Documents', fixed: 1, tier: 'minimalist' },
      { name: 'Travel adapter', category: 'Electronics', fixed: 1, tier: 'minimalist' },
      { name: 'Local currency', category: 'Documents', fixed: 1 },
      { name: 'Backup credit card', category: 'Documents', fixed: 1 },
      { name: 'Copies of passport', category: 'Documents', fixed: 1 },
      { name: 'Travel insurance documents', category: 'Documents', fixed: 1 },
      { name: 'Visa documents', category: 'Documents', fixed: 1 },
      { name: 'Phrasebook / translation app', category: 'Misc', fixed: 1 },
      { name: 'Vaccination records', category: 'Documents', fixed: 1, tier: 'thorough' },
      { name: 'Universal sink stopper', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Money belt', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Voltage converter', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'SIM card / eSIM', category: 'Electronics', fixed: 1, tier: 'thorough' },
      { name: 'Emergency contact card', category: 'Documents', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'gym',
    name: 'Gym',
    iconName: 'Dumbbell',
    itemRules: [
      { name: 'Workout shirt', category: 'Clothing', perDay: 1, tier: 'minimalist' },
      { name: 'Workout shorts', category: 'Clothing', perDayDivide: 2, tier: 'minimalist' },
      { name: 'Running shoes', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
      { name: 'Athletic socks', category: 'Clothing', perDay: 1 },
      { name: 'Sweat towel', category: 'Gear', fixed: 2 },
      { name: 'Headphones', category: 'Electronics', fixed: 1 },
      { name: 'Resistance bands', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Lifting gloves', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Shaker bottle', category: 'Food', fixed: 1, tier: 'thorough' },
      { name: 'Gym bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Jump rope', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Foam roller', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Post-workout sandals', category: 'Clothing', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'formal',
    name: 'Formal',
    iconName: 'Sparkles',
    itemRules: [
      { name: 'Suit / dress', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Dress shoes', category: 'Clothing', fixed: 1, tier: 'minimalist' },
      { name: 'Dress shirt', category: 'Clothing', fixed: 1 },
      { name: 'Belt', category: 'Clothing', fixed: 1 },
      { name: 'Dress socks / hosiery', category: 'Clothing', fixed: 2 },
      { name: 'Tie / accessories', category: 'Accessories', fixed: 1 },
      { name: 'Jewelry', category: 'Accessories', fixed: 1 },
      { name: 'Cufflinks', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Pocket square', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Garment bag', category: 'Gear', fixed: 1, tier: 'thorough' },
      { name: 'Shoe shine kit', category: 'Misc', fixed: 1, tier: 'thorough' },
      { name: 'Clutch / formal bag', category: 'Accessories', fixed: 1, tier: 'thorough' },
      { name: 'Spare dress shirt', category: 'Clothing', fixed: 1, tier: 'thorough' },
      { name: 'Wrinkle release spray', category: 'Toiletries', fixed: 1, tier: 'thorough' },
    ],
  },
  {
    id: 'kids',
    name: 'Kids along',
    iconName: 'Baby',
    itemRules: [
      { name: 'Diapers', category: 'Kids', perDay: 5, tier: 'minimalist' },
      { name: 'Wipes', category: 'Kids', fixed: 1, shared: true, tier: 'minimalist' },
      { name: 'Kid snacks', category: 'Kids', perDay: 3, shared: true, tier: 'minimalist' },
      { name: 'Kid clothes', category: 'Kids', perDay: 1 },
      { name: 'Kid pajamas', category: 'Kids', perDayDivide: 3 },
      { name: 'Stuffed animal', category: 'Kids', fixed: 1 },
      { name: 'Kid toothbrush', category: 'Kids', fixed: 1 },
      { name: 'Sippy cup', category: 'Kids', fixed: 2 },
      { name: 'Kid sunscreen', category: 'Kids', fixed: 1, shared: true },
      { name: 'Kid hat', category: 'Kids', fixed: 1 },
      { name: 'Stroller', category: 'Kids', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Car seat', category: 'Kids', fixed: 1, tier: 'thorough' },
      { name: 'Baby carrier', category: 'Kids', fixed: 1, tier: 'thorough' },
      { name: 'Changing pad', category: 'Kids', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Diaper rash cream', category: 'Kids', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Kid medicine', category: 'Kids', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Travel toys', category: 'Kids', fixed: 3, shared: true, tier: 'thorough' },
      { name: 'Night light', category: 'Kids', fixed: 1, shared: true, tier: 'thorough' },
      { name: 'Extra pacifiers', category: 'Kids', fixed: 3, tier: 'thorough' },
      { name: 'Bibs', category: 'Kids', fixed: 3, tier: 'thorough' },
    ],
  },
];

// ============================================================================
// Icon registry — string-name → lucide component
// ============================================================================

const ICONS: Record<string, LucideIcon> = {
  Shirt, Sun, Snowflake, Briefcase, Mountain, Building2,
  Music, Car, Tent, Globe, Dumbbell, Sparkles, Baby,
};

export function getTripTypeIcon(iconName: string): LucideIcon {
  return ICONS[iconName] ?? Shirt;
}

// ============================================================================
// Pure functions
// ============================================================================

export function computeQuantity(
  rule: ItemRule,
  duration: number,
  opts: CompositionOpts = DEFAULT_COMPOSITION_OPTS
): number {
  if (rule.fixed != null) return rule.fixed;
  // Per-day items only need to last between laundry runs. With laundry on,
  // the effective span is the laundry cycle (capped at the trip itself for
  // short trips); off, it's the whole trip — the original behavior.
  const effectiveDays = opts.canDoLaundry
    ? Math.min(duration, opts.laundryIntervalDays)
    : duration;
  if (rule.perDay != null) {
    const q = rule.perDay * effectiveDays;
    return rule.max != null ? Math.min(q, rule.max) : q;
  }
  if (rule.perDayDivide != null) {
    return Math.ceil(effectiveDays / rule.perDayDivide);
  }
  return 1;
}

/**
 * Recompute the items list from the selected trip types and duration,
 * preserving any items the user has modified or added manually.
 *
 * - Generated items from selected types overlay onto existing ones (preserving
 *   id / packed / assignee).
 * - userModified items are kept and reclassified to source='custom'
 *   (their userModified flag resets afterwards). If their id was still in the
 *   `gen-` space it's reissued so a regenerated rule can't collide React keys.
 * - A kept edited/custom item "claims" its origin rule (via originName, or
 *   recovered from a legacy `gen-<rule>` id). The originating rule then does
 *   NOT regenerate a fresh duplicate — e.g. renaming "Local currency" to
 *   "Euros" won't respawn "Local currency" when another type is toggled on.
 * - Existing source='custom' items are always preserved.
 * - Generated items no longer produced by any selected type are dropped.
 */
export function composeItems(
  typeIds: TripTypeId[],
  duration: number,
  existingItems: TripItem[] = [],
  opts: CompositionOpts = DEFAULT_COMPOSITION_OPTS
): TripItem[] {
  // 1. Build the "generated" map from the currently selected types. Rules
  //    above the chosen thoroughness are skipped before they ever generate.
  const generated = new Map<string, TripItem>();
  for (const typeId of typeIds) {
    const typeDef = TRIP_TYPES.find((t) => t.id === typeId);
    if (!typeDef) continue;
    for (const rule of typeDef.itemRules) {
      if (!ruleInScope(rule, opts.thoroughness)) continue;
      // Gendered rules only generate when the account preference matches;
      // 'unspecified' (and a dismissed prompt) gets none of them.
      if (rule.gender && rule.gender !== opts.gender) continue;
      const key = rule.name.toLowerCase();
      const qty = computeQuantity(rule, duration, opts);
      const existing = generated.get(key);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, qty);
        existing.fromTypeIds = Array.from(
          new Set([...(existing.fromTypeIds ?? []), typeId])
        );
        if (rule.shared) existing.assigneeId = SHARED_ASSIGNEE;
      } else {
        const at = clockNow();
        generated.set(key, {
          id: `gen-${key}`,
          name: rule.name,
          category: rule.category,
          quantity: qty,
          assigneeId: SHARED_ASSIGNEE,
          packed: false,
          source: 'generated',
          fromTypeIds: [typeId],
          originName: key,
          addedAt: at,
          updatedAt: at,
        });
      }
    }
  }

  // 2. Walk existing items. Three cases:
  //    a) userModified or source='custom' — keep, reclassify userModified→custom.
  //    b) source='generated' AND still produced — overlay fresh values, keep
  //       packed/assignee/id from existing for stable rendering.
  //    c) source='generated' AND no longer produced — drop.
  const result: TripItem[] = [];
  const consumed = new Set<string>(); // generated keys overlaid onto an existing item
  const claimedOrigins = new Set<string>(); // rules already owned by a kept edited/custom item

  for (const item of existingItems) {
    const key = item.name.toLowerCase();
    if (item.userModified || item.source === 'custom') {
      // Recover provenance for legacy items saved before originName existed:
      // a `gen-<rule>` id encodes the rule it descended from.
      const origin =
        item.originName ??
        (item.id.startsWith('gen-') ? item.id.slice(4) : undefined);
      result.push({
        ...item,
        // Once a user edits a seed item it's truly theirs — divorce it from
        // the gen- id space so a regenerated rule can never collide keys.
        id: item.id.startsWith('gen-') ? makeId('c') : item.id,
        source: 'custom',
        userModified: false,
        fromTypeIds: undefined,
        originName: origin,
      });
      if (origin) claimedOrigins.add(origin);
      consumed.add(key);
    } else if (generated.has(key)) {
      const fresh = generated.get(key)!;
      result.push({
        ...fresh,
        id: item.id,
        packed: item.packed,
        assigneeId: item.assigneeId,
        // Carry the existing item's merge clocks so a recompose that changes
        // nothing doesn't churn stamps; the store's updateTrip diff bumps
        // updatedAt only when content actually changed.
        addedAt: item.addedAt ?? fresh.addedAt,
        updatedAt: item.updatedAt ?? fresh.updatedAt,
        packedAt: item.packedAt,
        packedUpdatedAt: item.packedUpdatedAt,
      });
      consumed.add(key);
    }
    // else: generated but no longer produced → drop.
  }

  // 3. Add newly generated items not already represented. An item the user
  //    renamed/edited "claims" its origin rule (claimedOrigins), so we don't
  //    respawn a fresh duplicate of what they already customized.
  for (const [key, item] of generated) {
    if (!consumed.has(key) && !claimedOrigins.has(key)) {
      result.push(item);
    }
  }

  return result;
}

type ComposableTrip = Pick<
  Trip,
  'typeIds' | 'duration' | 'items'
  | 'canDoLaundry' | 'laundryIntervalDays' | 'thoroughness'
>;

/** Toggle a trip type and recompute items. Returns new {typeIds, items}. */
export function applyTypeToggle(
  trip: ComposableTrip,
  typeId: TripTypeId,
  gender: GenderPref = 'unspecified'
): { typeIds: TripTypeId[]; items: TripItem[] } {
  const isSelected = trip.typeIds.includes(typeId);
  const typeIds = isSelected
    ? trip.typeIds.filter((t) => t !== typeId)
    : [...trip.typeIds, typeId];
  const items = composeItems(typeIds, trip.duration, trip.items, tripOpts(trip, gender));
  return { typeIds, items };
}

/** Recompute items for a new duration, preserving modifications. */
export function applyDurationChange(
  trip: ComposableTrip,
  duration: number,
  gender: GenderPref = 'unspecified'
): TripItem[] {
  const clamped = Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Math.round(duration)));
  return composeItems(trip.typeIds, clamped, trip.items, tripOpts(trip, gender));
}

/** The user-editable trip-info bundle the wizard / condensed header writes. */
export interface TripInfo {
  name: string;
  duration: number;
  typeIds: TripTypeId[];
  canDoLaundry: boolean;
  laundryIntervalDays: number;
  thoroughness: Thoroughness;
}

/**
 * Apply a full trip-info edit at once and recompute the list, preserving the
 * user's manual edits / custom items (composeItems handles that). Used both
 * by the create flow (fresh items list) and the edit flow (existing trip).
 */
export function applyTripInfo(
  info: TripInfo,
  existingItems: TripItem[] = [],
  gender: GenderPref = 'unspecified'
): Pick<Trip, 'name' | 'duration' | 'typeIds' | 'canDoLaundry' | 'laundryIntervalDays' | 'thoroughness' | 'items'> {
  const duration = Math.min(
    MAX_DURATION_DAYS,
    Math.max(MIN_DURATION_DAYS, Math.round(info.duration))
  );
  const laundryIntervalDays = clampLaundryInterval(info.laundryIntervalDays);
  const opts: CompositionOpts = {
    canDoLaundry: info.canDoLaundry,
    laundryIntervalDays,
    thoroughness: info.thoroughness,
    gender,
  };
  return {
    name: info.name.trim() || 'Untitled trip',
    duration,
    typeIds: info.typeIds,
    canDoLaundry: info.canDoLaundry,
    laundryIntervalDays,
    thoroughness: info.thoroughness,
    items: composeItems(info.typeIds, duration, existingItems, opts),
  };
}

/** Group items by category in CATEGORY_ORDER. Empty categories are omitted.
 *  Tombstoned items (`deletedAt != null`) are filtered out — they exist only
 *  so a delete survives a cross-device merge, never for display. */
export function groupByCategory(items: TripItem[]): Array<{ category: Category; items: TripItem[] }> {
  const buckets = new Map<Category, TripItem[]>();
  for (const item of items) {
    if (item.deletedAt != null) continue;
    const arr = buckets.get(item.category) ?? [];
    arr.push(item);
    buckets.set(item.category, arr);
  }
  return CATEGORY_ORDER
    .filter((cat) => buckets.has(cat))
    .map((cat) => ({ category: cat, items: buckets.get(cat)! }));
}
