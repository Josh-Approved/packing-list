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
import { KEYWORDS_BY_LOCALE } from './categoryKeywords';

// ---------- Layer 1: seed-name → category map ----------
// Built once at module load from the 13 trip types' itemRules. The seed names
// are stable internal English, never display-localized, so this layer stays
// English-only — it's the highest-confidence exact-name signal.

const SEED_NAME_TO_CATEGORY: Map<string, Category> = (() => {
  const m = new Map<string, Category>();
  for (const type of TRIP_TYPES) {
    for (const rule of type.itemRules) {
      m.set(rule.name.toLowerCase(), rule.category);
    }
  }
  return m;
})();

// ---------- Layer 2: locale-aware keyword dictionary ----------
// The curated keyword lists now live in categoryKeywords.ts, keyed by locale,
// so an item typed in the active in-app language matches that language's words.
// English remains the per-key fallback (categoryKeywords.ts is the single
// source of truth — this file no longer carries an inline English list).

/**
 * Longest-keyword-wins scan of one locale's keyword map. `padded` is the typed
 * name wrapped in spaces so word-boundary keywords like "kid " or "water "
 * don't match mid-word ("kidney", "waterproof"). Returns null on no match.
 */
function matchKeywords(
  padded: string,
  map: Record<string, string[]> | undefined
): Category | null {
  if (!map) return null;
  let bestMatch: { category: Category; length: number } | null = null;
  for (const category of Object.keys(map) as Category[]) {
    for (const keyword of map[category]) {
      if (padded.includes(keyword)) {
        if (!bestMatch || keyword.length > bestMatch.length) {
          bestMatch = { category, length: keyword.length };
        }
      }
    }
  }
  return bestMatch?.category ?? null;
}

// ---------- Inference ----------

/**
 * Infer the most likely category for a typed-in item name, in the active
 * in-app locale.
 *
 * - Layer 1 (English seed exact-match) is tried first — highest confidence.
 * - Layer 2 tries the active locale's keyword set, then falls back to English
 *   (so English input still categorizes in any language mode, and an unknown
 *   locale behaves exactly like the old English-only matcher).
 *
 * `locale` defaults to 'en' so existing English-only call sites keep working.
 * Returns null when no signal is found — caller should keep whatever the user
 * has currently selected rather than picking arbitrarily (Misc is never
 * auto-assigned).
 */
export function inferCategory(name: string, locale: string = 'en'): Category | null {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;

  // Layer 1: exact match against seed items.
  const direct = SEED_NAME_TO_CATEGORY.get(trimmed);
  if (direct) return direct;

  // Layer 2: locale keywords first, then English fallback.
  const padded = ` ${trimmed} `;
  const localeMap = KEYWORDS_BY_LOCALE[locale];
  if (localeMap && localeMap !== KEYWORDS_BY_LOCALE.en) {
    const hit = matchKeywords(padded, localeMap);
    if (hit) return hit;
  }
  return matchKeywords(padded, KEYWORDS_BY_LOCALE.en);
}
