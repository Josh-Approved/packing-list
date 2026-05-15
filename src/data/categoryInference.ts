/**
 * Category inference for typed-in custom items.
 *
 * Two-layer pattern matching, all on-device, no LLM (per the "no LLM in v1"
 * tenet). When a user types an item name into the add-item bar, we infer the
 * most likely category so the picker pre-fills with something useful.
 *
 *   1. **Direct lookup against the 13 trip types' seed items.** The seed
 *      library already has ~70 items with hand-assigned categories
 *      ("Toothbrush" → Toiletries, "Phone charger" → Electronics, etc.).
 *      Case-insensitive exact-name match against those is the highest-
 *      confidence signal we have.
 *
 *   2. **Keyword matching against a curated dictionary.** For anything not
 *      in the seed library, we look for category-defining substrings inside
 *      the typed name. Substring matching handles plurals naturally
 *      ("shirts" matches "shirt"). When multiple keywords match, the LONGEST
 *      match wins (so "water bottle" → Gear via "water bottle", not Food via
 *      "water").
 *
 * Returns `null` when nothing matches — caller should keep whatever category
 * the user already had selected. We never silently default to "Misc"; that's
 * the user's call.
 */

import { TRIP_TYPES, type Category } from './trip';

// ---------- Layer 1: seed-name → category map ----------
// Built once at module load from the 13 trip types' itemRules.

const SEED_NAME_TO_CATEGORY: Map<string, Category> = (() => {
  const m = new Map<string, Category>();
  for (const type of TRIP_TYPES) {
    for (const rule of type.itemRules) {
      m.set(rule.name.toLowerCase(), rule.category);
    }
  }
  return m;
})();

// ---------- Layer 2: keyword dictionary ----------
// Each list is intentionally curated — broad enough to cover everyday packing
// items, narrow enough to avoid false positives. Add to these as we find
// misses in real use; the data lives here so it's easy to tune.

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Documents: [
    'passport', 'visa', 'license', 'wallet', 'cash', 'currency', 'card',
    'ticket', 'boarding pass', 'insurance', 'reservation', 'itinerary',
    'id', 'documents', 'paperwork',
  ],
  Clothing: [
    'shirt', 'tshirt', 't-shirt', 'pants', 'trousers', 'jeans', 'dress',
    'skirt', 'jacket', 'coat', 'suit', 'sock', 'underwear', 'briefs',
    'boxer', 'bra', 'belt', 'tie', 'hat', 'beanie', 'glove', 'mitten',
    'scarf', 'sweater', 'jumper', 'hoodie', 'shorts', 'pajama', 'pyjama',
    'swim', 'swimsuit', 'sandal', 'shoe', 'boot', 'sneaker', 'trainer',
    'flip flop', 'flip-flop', 'slipper', 'thermal', 'fleece', 'parka',
    'vest', 'leggings', 'tights', 'blouse', 'cardigan', 'tank top',
    'pullover',
  ],
  Toiletries: [
    'toothbrush', 'toothpaste', 'soap', 'shampoo', 'conditioner', 'razor',
    'shave', 'deodorant', 'lotion', 'sunscreen', 'sunblock', 'moisturizer',
    'mascara', 'lipstick', 'makeup', 'comb', 'hairbrush', 'floss',
    'mouthwash', 'tampon', 'pad ', 'cotton', 'nail clipper', 'tweezer',
    'perfume', 'cologne', 'aftershave', 'wipes', 'tissue', 'lip balm',
    'chapstick', 'hand sanitizer', 'dental', 'feminine',
  ],
  Electronics: [
    'phone', 'iphone', 'laptop', 'macbook', 'tablet', 'ipad', 'kindle',
    'reader', 'charger', 'cable', 'usb', 'lightning', 'adapter', 'battery',
    'powerbank', 'power bank', 'headphones', 'earbuds', 'airpods', 'camera',
    'lens', 'tripod', 'speaker', 'mouse', 'keyboard', 'sd card',
    'memory card', 'plug', 'converter', 'gopro', 'drone', 'gimbal',
    'switch', 'console', 'controller',
  ],
  Gear: [
    'tent', 'sleeping bag', 'backpack', 'pack', 'daypack', 'water bottle',
    'bottle', 'thermos', 'cooler', 'flashlight', 'headlamp', 'lantern',
    'compass', 'map', 'first aid', 'multi-tool', 'multitool', 'knife',
    'rope', 'tarp', 'mat', 'pillow', 'towel', 'blanket', 'umbrella',
    'binoculars', 'rain jacket', 'poncho', 'pole', 'stove', 'cookware',
    'duffel', 'duffle', 'carry-on', 'carryon', 'suitcase', 'luggage',
    'bag', 'fanny pack',
  ],
  Accessories: [
    'sunglasses', 'glasses', 'jewelry', 'jewellery', 'necklace', 'earring',
    'ring', 'bracelet', 'watch', 'bandana', 'cufflink', 'tie clip', 'pin',
    'sun hat',
  ],
  Food: [
    'snack', 'snacks', 'protein bar', 'granola', 'gel', 'jerky', 'nuts',
    'fruit', 'water ', 'gatorade', 'electrolyte', 'coffee', 'tea',
    'instant ', 'oatmeal', 'trail mix',
  ],
  Kids: [
    'diaper', 'baby', 'pacifier', 'binky', 'formula', 'bib', 'onesie',
    'stroller', 'bassinet', 'car seat', 'monitor', 'sippy', 'stuffed',
    'kid ', 'child ', 'toddler',
  ],
  Misc: [], // intentionally empty — Misc is the explicit user fallback
};

// ---------- Inference ----------

/**
 * Infer the most likely category for a typed-in item name.
 *
 * Returns null when no signal is found — caller should keep whatever the
 * user has currently selected rather than picking arbitrarily.
 */
export function inferCategory(name: string): Category | null {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;

  // Layer 1: exact match against seed items.
  const direct = SEED_NAME_TO_CATEGORY.get(trimmed);
  if (direct) return direct;

  // Layer 2: longest-keyword wins across all categories. We pad the typed
  // name with spaces so word-boundary keywords like "kid " or "water "
  // don't match mid-word ("kidney", "waterproof").
  const padded = ` ${trimmed} `;
  let bestMatch: { category: Category; length: number } | null = null;
  for (const category of Object.keys(CATEGORY_KEYWORDS) as Category[]) {
    for (const keyword of CATEGORY_KEYWORDS[category]) {
      if (padded.includes(keyword)) {
        if (!bestMatch || keyword.length > bestMatch.length) {
          bestMatch = { category, length: keyword.length };
        }
      }
    }
  }
  return bestMatch?.category ?? null;
}
