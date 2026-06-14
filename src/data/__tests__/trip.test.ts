/**
 * Trust core — trip composition + category inference.
 *
 * These are the modules where a bug silently corrupts a user's list: it either
 * drops an item they hand-edited, duplicates a deduped one, miscounts a per-day
 * quantity, or mis-files a typed item under the wrong category. The spec's
 * composition rules (trip.ts header) and the two-layer inference contract
 * (categoryInference.ts header) are pinned here as worked examples + the edge
 * cases a refactor would quietly break.
 */

import {
  computeQuantity,
  composeItems,
  applyTypeToggle,
  applyDurationChange,
  applyTripInfo,
  groupByCategory,
  clampLaundryInterval,
  tripOpts,
  CATEGORY_ORDER,
  DEFAULT_COMPOSITION_OPTS,
  MIN_DURATION_DAYS,
  MAX_DURATION_DAYS,
  SHARED_ASSIGNEE,
  type ItemRule,
  type TripItem,
  type CompositionOpts,
} from '../trip';
import { inferCategory } from '../categoryInference';

const opts = (p: Partial<CompositionOpts> = {}): CompositionOpts => ({
  ...DEFAULT_COMPOSITION_OPTS,
  ...p,
});

// ===========================================================================
// computeQuantity — the per-day / per-day-divide / fixed / laundry math
// ===========================================================================

describe('computeQuantity', () => {
  it('fixed quantity is returned verbatim, ignoring duration', () => {
    const r: ItemRule = { name: 'Tent', category: 'Gear', fixed: 1 };
    expect(computeQuantity(r, 1)).toBe(1);
    expect(computeQuantity(r, 60)).toBe(1);
  });

  it('perDay multiplies by the whole trip when laundry is off', () => {
    const r: ItemRule = { name: 'Underwear', category: 'Clothing', perDay: 1 };
    expect(computeQuantity(r, 4)).toBe(4);
    expect(computeQuantity(r, 7)).toBe(7);
  });

  it('perDay caps at max when present', () => {
    // hiking "Hiking socks": perDay 1, max 5 — a 10-day trip still packs 5.
    const r: ItemRule = { name: 'Hiking socks', category: 'Clothing', perDay: 1, max: 5 };
    expect(computeQuantity(r, 10)).toBe(5);
    expect(computeQuantity(r, 3)).toBe(3); // under the cap, no clamp
  });

  it('perDayDivide rounds UP (ceil) — never short the user', () => {
    // "Pants": perDayDivide 3 → one pair per 3 days, rounded up.
    const r: ItemRule = { name: 'Pants', category: 'Clothing', perDayDivide: 3 };
    expect(computeQuantity(r, 3)).toBe(1);
    expect(computeQuantity(r, 4)).toBe(2); // ceil(4/3)
    expect(computeQuantity(r, 6)).toBe(2);
    expect(computeQuantity(r, 7)).toBe(3); // ceil(7/3)
  });

  it('laundry shrinks the effective span to the laundry cycle (capped at trip length)', () => {
    const r: ItemRule = { name: 'T-shirts', category: 'Clothing', perDay: 1 };
    // 10-day trip, laundry every 3 days → only need to cover 3 days.
    expect(computeQuantity(r, 10, opts({ canDoLaundry: true, laundryIntervalDays: 3 }))).toBe(3);
    // Short trip: the cycle can't exceed the trip, so a 2-day trip stays 2.
    expect(computeQuantity(r, 2, opts({ canDoLaundry: true, laundryIntervalDays: 3 }))).toBe(2);
  });

  it('laundry also shrinks perDayDivide quantities', () => {
    const r: ItemRule = { name: 'Pants', category: 'Clothing', perDayDivide: 3 };
    // 9-day trip, laundry every 3 → ceil(3/3) = 1 instead of ceil(9/3) = 3.
    expect(computeQuantity(r, 9, opts({ canDoLaundry: true, laundryIntervalDays: 3 }))).toBe(1);
  });
});

// ===========================================================================
// composeItems — generation, dedupe-with-max, and the data-loss invariants
// ===========================================================================

const byName = (items: TripItem[], name: string) =>
  items.find((i) => i.name === name);

describe('composeItems — generation from seed types', () => {
  it('generates the beach minimalist+normal items for a 4-day trip', () => {
    const items = composeItems(['beach'], 4);
    const swim = byName(items, 'Swimsuit');
    expect(swim).toBeDefined();
    expect(swim!.quantity).toBe(2); // fixed: 2
    expect(swim!.category).toBe('Clothing');
    expect(swim!.source).toBe('generated');
    // Thorough-tier beach items are NOT generated at 'normal'.
    expect(byName(items, 'Snorkel set')).toBeUndefined();
  });

  it("thoroughness gates which rules generate (minimalist ⊂ normal ⊂ thorough)", () => {
    const min = composeItems(['beach'], 4, [], opts({ thoroughness: 'minimalist' }));
    const norm = composeItems(['beach'], 4, [], opts({ thoroughness: 'normal' }));
    const thorough = composeItems(['beach'], 4, [], opts({ thoroughness: 'thorough' }));
    // minimalist has the core only; each higher tier is a superset.
    expect(byName(min, 'Swimsuit')).toBeDefined(); // minimalist
    expect(byName(min, 'Beach towel')).toBeUndefined(); // normal-tier, excluded
    expect(byName(norm, 'Beach towel')).toBeDefined();
    expect(byName(norm, 'Snorkel set')).toBeUndefined(); // thorough-tier
    expect(byName(thorough, 'Snorkel set')).toBeDefined();
    expect(min.length).toBeLessThan(norm.length);
    expect(norm.length).toBeLessThan(thorough.length);
  });

  it('gendered rules only generate when the account preference matches', () => {
    const none = composeItems(['essentials'], 3, [], opts({ thoroughness: 'minimalist', gender: 'unspecified' }));
    const female = composeItems(['essentials'], 3, [], opts({ thoroughness: 'minimalist', gender: 'female' }));
    const male = composeItems(['essentials'], 3, [], opts({ thoroughness: 'minimalist', gender: 'male' }));
    expect(byName(none, 'Bras')).toBeUndefined(); // default suppresses gendered extras
    expect(byName(female, 'Bras')).toBeDefined();
    expect(byName(male, 'Bras')).toBeUndefined();
  });
});

describe('composeItems — dedupe across types takes max() and merges provenance', () => {
  it('a shared name appearing in two types yields ONE item, not a duplicate', () => {
    // "Sunscreen" is in both beach and hiking (identical spelling → merges).
    const items = composeItems(['beach', 'hiking'], 4);
    const matches = items.filter((i) => i.name === 'Sunscreen');
    expect(matches).toHaveLength(1);
    const s = matches[0];
    // fromTypeIds records BOTH contributing types.
    expect(new Set(s.fromTypeIds)).toEqual(new Set(['beach', 'hiking']));
    // A shared rule keeps the shared assignee.
    expect(s.assigneeId).toBe(SHARED_ASSIGNEE);
  });

  it('merged quantity is the max of contributors', () => {
    // Construct two synthetic types via the real merge path: "Water bottle"
    // is fixed:1 in essentials, hiking, urban, gym — all 1, so the merge is 1
    // (and still a single item). This pins the no-duplicate + max invariant.
    const items = composeItems(['essentials', 'hiking', 'urban'], 5);
    const bottles = items.filter((i) => i.name === 'Water bottle');
    expect(bottles).toHaveLength(1);
    expect(bottles[0].quantity).toBe(1);
  });
});

describe('composeItems — preserving the user’s edits (the data-loss core)', () => {
  it('a userModified item survives its type being toggled OFF (kept as custom)', () => {
    // Generate from beach, then the user edits "Swimsuit".
    const generated = composeItems(['beach'], 4);
    const swim = byName(generated, 'Swimsuit')!;
    const edited = generated.map((i) =>
      i.id === swim.id ? { ...i, quantity: 9, userModified: true } : i
    );
    // Toggle beach OFF → no types selected.
    const after = composeItems([], 4, edited);
    const keptSwim = byName(after, 'Swimsuit');
    expect(keptSwim).toBeDefined(); // NOT dropped
    expect(keptSwim!.quantity).toBe(9); // user's value preserved
    expect(keptSwim!.source).toBe('custom'); // reclassified so it survives forever
    expect(keptSwim!.userModified).toBe(false); // flag reset after reclassification
    expect(keptSwim!.id.startsWith('gen-')).toBe(false); // divorced from gen- id space
    // A plain (un-edited) generated beach item IS dropped when beach is off.
    expect(byName(after, 'Beach towel')).toBeUndefined();
  });

  it('overlays fresh quantities onto an existing generated item while keeping packed/id', () => {
    const first = composeItems(['essentials'], 4, [], opts({ thoroughness: 'minimalist' }));
    const underwear = byName(first, 'Underwear')!;
    expect(underwear.quantity).toBe(4);
    // Mark it packed, then recompose for a longer trip.
    const packed = first.map((i) =>
      i.id === underwear.id ? { ...i, packed: true } : i
    );
    const second = composeItems(['essentials'], 7, packed, opts({ thoroughness: 'minimalist' }));
    const again = byName(second, 'Underwear')!;
    expect(again.id).toBe(underwear.id); // stable id (stable React key)
    expect(again.packed).toBe(true); // packed state preserved
    expect(again.quantity).toBe(7); // quantity refreshed to the new duration
  });

  it('a renamed item claims its origin rule so the rule does NOT respawn a duplicate', () => {
    // Generate "Local currency" (international), then the user renames it to "Euros".
    const gen = composeItems(['international'], 5);
    const cur = byName(gen, 'Local currency')!;
    const renamed = gen.map((i) =>
      i.id === cur.id ? { ...i, name: 'Euros', userModified: true } : i
    );
    // First recompose reclassifies "Euros" to custom + stamps the claimed origin.
    const pass1 = composeItems(['international'], 5, renamed);
    expect(byName(pass1, 'Euros')).toBeDefined();
    expect(byName(pass1, 'Local currency')).toBeUndefined(); // not respawned
    // Toggling another type on must still not resurrect "Local currency".
    const pass2 = composeItems(['international', 'beach'], 5, pass1);
    expect(byName(pass2, 'Euros')).toBeDefined();
    expect(byName(pass2, 'Local currency')).toBeUndefined();
  });

  it('preserves a fully custom (typed-in) item across recomposition', () => {
    const custom: TripItem = {
      id: 'c-1', name: 'Snowboard wax', category: 'Misc', quantity: 1,
      assigneeId: SHARED_ASSIGNEE, packed: false, source: 'custom',
    };
    const after = composeItems(['beach'], 4, [custom]);
    expect(byName(after, 'Snowboard wax')).toBeDefined();
  });
});

describe('applyTypeToggle / applyDurationChange', () => {
  it('toggling a type on adds it; toggling again removes it', () => {
    const trip = { typeIds: ['beach'] as const, duration: 4, items: composeItems(['beach'], 4) };
    const on = applyTypeToggle({ ...trip, typeIds: [...trip.typeIds] }, 'hiking');
    expect(on.typeIds).toContain('hiking');
    const off = applyTypeToggle({ ...trip, typeIds: on.typeIds, items: on.items }, 'hiking');
    expect(off.typeIds).not.toContain('hiking');
  });

  it('applyDurationChange clamps to [MIN, MAX] days and rounds', () => {
    const trip = { typeIds: ['essentials'] as const, duration: 4, items: [] as TripItem[] };
    // 200 days → clamps to MAX; verify via a perDay item's quantity.
    const longItems = applyDurationChange({ ...trip, typeIds: [...trip.typeIds] }, 200);
    const under = byName(longItems, 'Underwear');
    if (under) expect(under.quantity).toBe(MAX_DURATION_DAYS);
    // 0 / negative → clamps up to MIN.
    const shortItems = applyDurationChange({ ...trip, typeIds: [...trip.typeIds] }, 0);
    const under2 = byName(shortItems, 'Underwear');
    if (under2) expect(under2.quantity).toBe(MIN_DURATION_DAYS);
  });
});

describe('applyTripInfo — the wizard/edit entry point', () => {
  it('clamps duration, defaults an empty name, and composes a list', () => {
    const res = applyTripInfo({
      name: '   ',
      duration: 999,
      typeIds: ['beach'],
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    });
    expect(res.name).toBe('Untitled trip');
    expect(res.duration).toBe(MAX_DURATION_DAYS);
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('trims a real name and keeps it', () => {
    const res = applyTripInfo({
      name: '  Greece  ', duration: 4, typeIds: ['beach'],
      canDoLaundry: false, laundryIntervalDays: 4, thoroughness: 'normal',
    });
    expect(res.name).toBe('Greece');
  });
});

describe('groupByCategory', () => {
  it('groups items in CATEGORY_ORDER and omits empty categories', () => {
    const items = composeItems(['beach'], 4);
    const groups = groupByCategory(items);
    const cats = groups.map((g) => g.category);
    // Order must be a subsequence of the canonical CATEGORY_ORDER.
    const idxs = cats.map((c) => CATEGORY_ORDER.indexOf(c));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
    // Every produced bucket is non-empty, and every item is accounted for.
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(items.length);
    // beach has no Kids items → that bucket is absent.
    expect(cats).not.toContain('Kids');
  });

  it('empty input yields no groups', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('clampLaundryInterval / tripOpts legacy defaults', () => {
  it('clamps laundry interval into [1, 14] and rounds', () => {
    expect(clampLaundryInterval(0)).toBe(1);
    expect(clampLaundryInterval(100)).toBe(14);
    expect(clampLaundryInterval(3.6)).toBe(4);
  });

  it('tripOpts fills legacy-missing fields with the pre-feature defaults', () => {
    // A trip persisted before laundry/thoroughness existed: all undefined.
    const o = tripOpts({});
    expect(o.canDoLaundry).toBe(false);
    expect(o.thoroughness).toBe('normal');
    expect(o.laundryIntervalDays).toBe(4);
    expect(o.gender).toBe('unspecified');
  });
});

// ===========================================================================
// categoryInference — the typed-item → category contract
// ===========================================================================

describe('inferCategory — Layer 1 (exact seed-name match)', () => {
  it('matches seed item names case-insensitively to their hand-assigned category', () => {
    expect(inferCategory('Toothbrush')).toBe('Toiletries');
    expect(inferCategory('toothbrush')).toBe('Toiletries');
    expect(inferCategory('Phone charger')).toBe('Electronics');
    expect(inferCategory('Passport')).toBe('Documents');
    expect(inferCategory('Tent')).toBe('Gear');
    expect(inferCategory('Diapers')).toBe('Kids');
  });
});

describe('inferCategory — Layer 2 (keyword dictionary, longest wins)', () => {
  it('matches keywords as substrings (handles plurals)', () => {
    expect(inferCategory('linen shirts')).toBe('Clothing'); // "shirt" inside "shirts"
    expect(inferCategory('hiking jacket')).toBe('Clothing');
    expect(inferCategory('USB cable')).toBe('Electronics');
  });

  it('the LONGEST matching keyword wins across categories', () => {
    // "water bottle": Gear "water bottle" (12) beats Food "water " (6).
    expect(inferCategory('insulated water bottle')).toBe('Gear');
  });

  it('space-suffixed keywords do not match mid-word', () => {
    // The "kid " keyword (trailing space) must not fire on "kidlet" — the
    // padded name " kidlet " has no "kid " (no space after "kid").
    expect(inferCategory('kidlet')).toBe('Documents'); // grabs "id" (Documents), NOT "kid " (Kids)
    // "water " (trailing space) must not match "waterproof"; nothing else in
    // it matches either, so the result is null.
    expect(inferCategory('waterproof')).toBeNull();
  });
});

describe('inferCategory — fallback', () => {
  it('returns null when nothing matches (never silently defaults to Misc)', () => {
    expect(inferCategory('zzzq wggw')).toBeNull();
    expect(inferCategory('')).toBeNull();
    expect(inferCategory('   ')).toBeNull();
  });
});

// ===========================================================================
// inferCategory — locale-aware Layer 2 (the Josh bug: app in Spanish, items
// typed in Spanish landed in "Otros" because the matcher was English-only).
// Each locale must categorize its own everyday vocabulary to the correct
// NON-fallback category, and English input must still work in any mode.
// ===========================================================================

describe('inferCategory — localized keyword matching', () => {
  it('Spanish (es)', () => {
    expect(inferCategory('pasaporte', 'es')).toBe('Documents');
    expect(inferCategory('cepillo de dientes', 'es')).toBe('Toiletries');
    expect(inferCategory('camiseta', 'es')).toBe('Clothing');
    expect(inferCategory('botella de agua', 'es')).toBe('Gear');
    // English still categorizes in Spanish mode (per-key fallback).
    expect(inferCategory('sneaker', 'es')).toBe('Clothing');
  });

  it('German (de)', () => {
    expect(inferCategory('reisepass', 'de')).toBe('Documents');
    expect(inferCategory('zahnbürste', 'de')).toBe('Toiletries');
    expect(inferCategory('hemd', 'de')).toBe('Clothing');
  });

  it('French (fr)', () => {
    expect(inferCategory('passeport', 'fr')).toBe('Documents');
    expect(inferCategory('brosse à dents', 'fr')).toBe('Toiletries');
    expect(inferCategory('chemise', 'fr')).toBe('Clothing');
    // English fallback under French.
    expect(inferCategory('fleece', 'fr')).toBe('Clothing');
  });

  it('Italian (it)', () => {
    expect(inferCategory('passaporto', 'it')).toBe('Documents');
    expect(inferCategory('spazzolino', 'it')).toBe('Toiletries');
    expect(inferCategory('camicia', 'it')).toBe('Clothing');
  });

  it('Portuguese — Brazil (pt-BR)', () => {
    expect(inferCategory('passaporte', 'pt-BR')).toBe('Documents');
    expect(inferCategory('escova de dentes', 'pt-BR')).toBe('Toiletries');
    expect(inferCategory('camisa', 'pt-BR')).toBe('Clothing');
  });

  it('Japanese (ja)', () => {
    expect(inferCategory('パスポート', 'ja')).toBe('Documents');
    expect(inferCategory('歯ブラシ', 'ja')).toBe('Toiletries');
    expect(inferCategory('シャツ', 'ja')).toBe('Clothing');
    // English fallback under Japanese.
    expect(inferCategory('jerky', 'ja')).toBe('Food');
  });

  it('an unknown locale behaves exactly like the English-only matcher', () => {
    expect(inferCategory('linen shirts', 'xx')).toBe('Clothing');
    expect(inferCategory('manzanas', 'xx')).toBeNull(); // no Spanish words in en
  });

  it('the default (no locale arg) stays English — back-compat', () => {
    expect(inferCategory('USB cable')).toBe('Electronics');
    expect(inferCategory('pasaporte')).toBeNull(); // English mode: no es words
  });
});
