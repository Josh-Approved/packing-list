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

export interface Packer {
  id: string;
  name: string;
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
}

export interface Trip {
  id: string;
  name: string;
  /** Days, integer. MIN_DURATION_DAYS <= duration <= MAX_DURATION_DAYS. */
  duration: number;
  typeIds: TripTypeId[];
  packers: Packer[];
  items: TripItem[];
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

// ============================================================================
// Trip type definitions — the 13 seed types
// ============================================================================

export const TRIP_TYPES: TripTypeDef[] = [
  {
    id: 'essentials',
    name: 'Essentials',
    iconName: 'Shirt',
    defaultSelected: true,
    itemRules: [
      { name: 'Underwear', category: 'Clothing', perDay: 1 },
      { name: 'Socks', category: 'Clothing', perDay: 1 },
      { name: 'T-shirts', category: 'Clothing', perDay: 1 },
      { name: 'Pajamas', category: 'Clothing', fixed: 1 },
      { name: 'Toothbrush', category: 'Toiletries', fixed: 1 },
      { name: 'Toothpaste', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Deodorant', category: 'Toiletries', fixed: 1 },
      { name: 'Phone charger', category: 'Electronics', fixed: 1 },
      { name: 'Wallet', category: 'Documents', fixed: 1 },
    ],
  },
  {
    id: 'beach',
    name: 'Beach',
    iconName: 'Sun',
    itemRules: [
      { name: 'Swimsuit', category: 'Clothing', fixed: 2 },
      { name: 'Sunscreen', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Beach towel', category: 'Gear', fixed: 1 },
      { name: 'Sandals', category: 'Clothing', fixed: 1 },
      { name: 'Sunglasses', category: 'Accessories', fixed: 1 },
      { name: 'Sun hat', category: 'Accessories', fixed: 1 },
    ],
  },
  {
    id: 'cold',
    name: 'Cold weather',
    iconName: 'Snowflake',
    itemRules: [
      { name: 'Heavy jacket', category: 'Clothing', fixed: 1 },
      { name: 'Gloves', category: 'Accessories', fixed: 1 },
      { name: 'Beanie', category: 'Accessories', fixed: 1 },
      { name: 'Thermal base layers', category: 'Clothing', fixed: 2 },
      { name: 'Wool socks', category: 'Clothing', fixed: 3 },
      { name: 'Scarf', category: 'Accessories', fixed: 1 },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    iconName: 'Briefcase',
    itemRules: [
      { name: 'Dress shirts', category: 'Clothing', perDay: 1 },
      { name: 'Dress pants', category: 'Clothing', perDayDivide: 2 },
      { name: 'Tie', category: 'Clothing', fixed: 2 },
      { name: 'Dress shoes', category: 'Clothing', fixed: 1 },
      { name: 'Belt', category: 'Clothing', fixed: 1 },
      { name: 'Laptop', category: 'Electronics', fixed: 1 },
      { name: 'Laptop charger', category: 'Electronics', fixed: 1 },
      { name: 'Notebook', category: 'Misc', fixed: 1 },
    ],
  },
  {
    id: 'hiking',
    name: 'Hiking',
    iconName: 'Mountain',
    itemRules: [
      { name: 'Hiking boots', category: 'Gear', fixed: 1 },
      { name: 'Hiking socks', category: 'Clothing', perDay: 1, max: 5 },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
      { name: 'Daypack', category: 'Gear', fixed: 1 },
      { name: 'Trail snacks', category: 'Food', fixed: 3, shared: true },
      { name: 'First aid kit', category: 'Gear', fixed: 1, shared: true },
      { name: 'Rain jacket', category: 'Clothing', fixed: 1 },
    ],
  },
  {
    id: 'urban',
    name: 'Urban',
    iconName: 'Building2',
    itemRules: [
      { name: 'Walking shoes', category: 'Clothing', fixed: 1 },
      { name: 'Day bag', category: 'Gear', fixed: 1 },
      { name: 'Portable charger', category: 'Electronics', fixed: 1 },
      { name: 'Reusable water bottle', category: 'Gear', fixed: 1 },
      { name: 'Light jacket', category: 'Clothing', fixed: 1 },
    ],
  },
  {
    id: 'festival',
    name: 'Festival',
    iconName: 'Music',
    itemRules: [
      { name: 'Sunscreen', category: 'Toiletries', fixed: 1, shared: true },
      { name: 'Earplugs', category: 'Misc', fixed: 1 },
      { name: 'Portable charger', category: 'Electronics', fixed: 1 },
      { name: 'Bandana', category: 'Accessories', fixed: 1 },
      { name: 'Comfy shoes', category: 'Clothing', fixed: 1 },
      { name: 'Cash', category: 'Documents', fixed: 1 },
    ],
  },
  {
    id: 'roadtrip',
    name: 'Road trip',
    iconName: 'Car',
    itemRules: [
      { name: 'Phone car mount', category: 'Electronics', fixed: 1, shared: true },
      { name: 'USB cable', category: 'Electronics', fixed: 1, shared: true },
      { name: 'Snacks', category: 'Food', fixed: 5, shared: true },
      { name: 'Cooler', category: 'Gear', fixed: 1, shared: true },
      { name: "Driver's license", category: 'Documents', fixed: 1 },
    ],
  },
  {
    id: 'camping',
    name: 'Camping',
    iconName: 'Tent',
    itemRules: [
      { name: 'Tent', category: 'Gear', fixed: 1, shared: true },
      { name: 'Sleeping bag', category: 'Gear', fixed: 1 },
      { name: 'Sleeping pad', category: 'Gear', fixed: 1 },
      { name: 'Headlamp', category: 'Gear', fixed: 1 },
      { name: 'Camp stove', category: 'Gear', fixed: 1, shared: true },
      { name: 'Cookware', category: 'Gear', fixed: 1, shared: true },
    ],
  },
  {
    id: 'international',
    name: 'International',
    iconName: 'Globe',
    itemRules: [
      { name: 'Passport', category: 'Documents', fixed: 1 },
      { name: 'Travel adapter', category: 'Electronics', fixed: 1 },
      { name: 'Local currency', category: 'Documents', fixed: 1 },
      { name: 'Backup credit card', category: 'Documents', fixed: 1 },
    ],
  },
  {
    id: 'gym',
    name: 'Gym',
    iconName: 'Dumbbell',
    itemRules: [
      { name: 'Workout shirt', category: 'Clothing', perDay: 1 },
      { name: 'Workout shorts', category: 'Clothing', perDayDivide: 2 },
      { name: 'Running shoes', category: 'Clothing', fixed: 1 },
      { name: 'Water bottle', category: 'Gear', fixed: 1 },
    ],
  },
  {
    id: 'formal',
    name: 'Formal',
    iconName: 'Sparkles',
    itemRules: [
      { name: 'Suit / dress', category: 'Clothing', fixed: 1 },
      { name: 'Dress shoes', category: 'Clothing', fixed: 1 },
      { name: 'Cufflinks / jewelry', category: 'Accessories', fixed: 1 },
    ],
  },
  {
    id: 'kids',
    name: 'Kids along',
    iconName: 'Baby',
    itemRules: [
      { name: 'Diapers', category: 'Kids', perDay: 5 },
      { name: 'Wipes', category: 'Kids', fixed: 1, shared: true },
      { name: 'Kid snacks', category: 'Kids', perDay: 3, shared: true },
      { name: 'Stuffed animal', category: 'Kids', fixed: 1 },
      { name: 'Kid toothbrush', category: 'Kids', fixed: 1 },
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

export function computeQuantity(rule: ItemRule, duration: number): number {
  if (rule.fixed != null) return rule.fixed;
  if (rule.perDay != null) {
    const q = rule.perDay * duration;
    return rule.max != null ? Math.min(q, rule.max) : q;
  }
  if (rule.perDayDivide != null) return Math.ceil(duration / rule.perDayDivide);
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
  existingItems: TripItem[] = []
): TripItem[] {
  // 1. Build the "generated" map from the currently selected types.
  const generated = new Map<string, TripItem>();
  for (const typeId of typeIds) {
    const typeDef = TRIP_TYPES.find((t) => t.id === typeId);
    if (!typeDef) continue;
    for (const rule of typeDef.itemRules) {
      const key = rule.name.toLowerCase();
      const qty = computeQuantity(rule, duration);
      const existing = generated.get(key);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, qty);
        existing.fromTypeIds = Array.from(
          new Set([...(existing.fromTypeIds ?? []), typeId])
        );
        if (rule.shared) existing.assigneeId = SHARED_ASSIGNEE;
      } else {
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

/** Toggle a trip type and recompute items. Returns new {typeIds, items}. */
export function applyTypeToggle(
  trip: Pick<Trip, 'typeIds' | 'duration' | 'items'>,
  typeId: TripTypeId
): { typeIds: TripTypeId[]; items: TripItem[] } {
  const isSelected = trip.typeIds.includes(typeId);
  const typeIds = isSelected
    ? trip.typeIds.filter((t) => t !== typeId)
    : [...trip.typeIds, typeId];
  const items = composeItems(typeIds, trip.duration, trip.items);
  return { typeIds, items };
}

/** Recompute items for a new duration, preserving modifications. */
export function applyDurationChange(
  trip: Pick<Trip, 'typeIds' | 'duration' | 'items'>,
  duration: number
): TripItem[] {
  const clamped = Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Math.round(duration)));
  return composeItems(trip.typeIds, clamped, trip.items);
}

/** Group items by category in CATEGORY_ORDER. Empty categories are omitted. */
export function groupByCategory(items: TripItem[]): Array<{ category: Category; items: TripItem[] }> {
  const buckets = new Map<Category, TripItem[]>();
  for (const item of items) {
    const arr = buckets.get(item.category) ?? [];
    arr.push(item);
    buckets.set(item.category, arr);
  }
  return CATEGORY_ORDER
    .filter((cat) => buckets.has(cat))
    .map((cat) => ({ category: cat, items: buckets.get(cat)! }));
}
