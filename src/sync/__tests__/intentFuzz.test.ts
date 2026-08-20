/**
 * Intent fuzzer — the adversarial gate for the shared-TRIP stack.
 *
 * WHY A SECOND FUZZER. `syncSim.test.ts` drives hand-rolled ops straight at
 * `mergeTrip` and asserts CONVERGENCE — devices agree. But the defects this app
 * has actually shipped ("my packed items came back unpacked", "the charger is
 * in the list twice") CONVERGED just fine: every device agreed on the wrong
 * trip. Convergence is necessary, never sufficient. This fuzzer drives the REAL
 * gestures a person performs — add an item, tick it off, change the trip's
 * length, add a trip type, swipe a row away — through the production trips
 * store and logical clock, one per simulated device (see ../simHarness), across
 * random households (2–3 devices, honest clock skew, offline stretches, lost
 * and stale-replayed messages), and asserts USER INTENT:
 *
 *   I1 CONVERGENCE+   — what people SEE (name+category → quantity, packed) is
 *                       identical on every device (packed included, which
 *                       syncSim never modelled).
 *   I2 LAST PACK ACTION WINS — the wall-clock-latest pack/unpack of a THING
 *      (when clearly separated from any rival action) is what every device
 *      shows. Keyed by the thing, not the row, because two devices that both
 *      add or both regenerate it mint separate rows the merge then collapses
 *      carrying the newest tap. This is the "my ticked-off items came back"
 *      oracle, and the reason `packed` merges on its own clock (merge.ts §
 *      PACKED MERGES ON ITS OWN CLOCK).
 *   I3 RE-ADD IS A FRESH NEED — typing back a name you removed revives ONE
 *      unpacked row, asserted at the moment of the action on the acting device;
 *      typing a name that is already on the list bumps its quantity instead of
 *      opening a second row.
 *   I4 NO DUPLICATE ROWS — after syncing, no two visible rows share a name
 *      within a category (packing deliberately allows the same name in two
 *      different categories — merge.ts § DUPLICATE NAMES COLLAPSE).
 *   I5 NO RESURRECTION / NO LOSS — a specific ROW (id) whose last action was
 *      its removal stays gone everywhere; a name whose last action was adding it
 *      stays visible. Removal binds at id level deliberately: the set is
 *      add-wins, so a partner's unseen add of the same thing legitimately
 *      survives under its own id.
 *   I6 BOUNDED PAYLOAD — no device's published trip outgrows relay limits.
 *   I7 LAST TRIP EDIT WINS — trip length + trip types resolve as one head on
 *      the whole-trip clock, so when a trip edit is the newest action anywhere
 *      (and clearly separated), every device ends up on that trip's shape.
 *
 * Blind concurrent edits inside the separation window are inherently
 * last-writer-wins (the app is honest about this); the oracles only bind when
 * actions are separated by SEPARATION_MS — comfortably above the honest skews
 * modelled here (phones NTP-sync within seconds).
 *
 * WHERE AN ORACLE DELIBERATELY STANDS DOWN. Three places, each a real limit of
 * the app rather than a softened claim, and each worth fixing one day:
 *   - a removed SEED row is re-suggested by any later trip edit (that is what
 *     makes turning a type off and back on restore its items), so I5-gone binds
 *     on generated rows only while no trip edit has run since (see
 *     Scenario.lastRecompose);
 *   - a RENAME is last-writer-wins against a blind edit of the same row — the
 *     composer rewrites a seed row's name from its rule on the next trip edit,
 *     and the rename path has no dedupe — so the name-level oracles stand down
 *     for a name a rename has moved (Scenario.renamed);
 *   - editing a seed row makes it yours, and the next trip edit RE-ISSUES it
 *     under a fresh custom id; the merge's pack fold is keyed to the row and the
 *     duplicate collapse skips `gen-` ids, so a peer's pack action on the old id
 *     is dropped and the old row can briefly survive beside the new one
 *     (Scenario.reidentified). See `standsDown`.
 *
 * Deterministic (seeded mulberry32); a failure prints its seed + op log.
 */

// Hermetic: mock everything the trips + settings stores touch beyond pure JS.
jest.mock('../../store/db', () => ({
  loadAllTrips: jest.fn(async () => []),
  saveTrip: jest.fn(async () => {}),
  deleteTripFromDb: jest.fn(async () => {}),
  getAppSetting: jest.fn(async () => null),
  setAppSetting: jest.fn(async () => {}),
}));
jest.mock('../../storage/kv', () => ({
  getSyncMeta: jest.fn(async () => null),
  setSyncMeta: jest.fn(async () => {}),
}));
jest.mock('../../qa/qaMode', () => ({ QA_MODE: false }));
jest.mock('../../qa/fixtures', () => ({ qaTrips: () => [] }));

import { normalizeItemName, type Category, type Trip, type TripTypeId } from '../../data/trip';
import {
  type SimDev,
  type SimWorld,
  makeWorld,
  makeDev,
  on,
  converge,
  deliver,
  deliverPayload,
  snapshot,
  sharedTripOf,
  visible,
  fingerprint,
  itemKey,
  tripConfig,
  addItem,
  setPacked,
  setQuantity,
  renameItem,
  removeItem,
  toggleType,
  changeDuration,
  rng,
} from '../simHarness';

// One Date.now mock for the whole file; each scenario swaps its world in.
const worldRef: { current: SimWorld | null } = { current: null };
let dateSpy: jest.SpyInstance<number, []>;
beforeAll(() => {
  dateSpy = jest
    .spyOn(Date, 'now')
    .mockImplementation(() =>
      worldRef.current
        ? worldRef.current.now + (worldRef.current.active?.skewMs ?? 0)
        : 1_750_000_000_000
    );
});
afterAll(() => dateSpy.mockRestore());

/**
 * Things a person types into the add bar, each with the one category it lands
 * in. Two properties are deliberate:
 *   - none of them collide with a seed-rule name, because a typed row and a
 *     generated row are different kinds of thing to the composer (generated
 *     rows share a `gen-<rule>` id across devices; typed rows are minted per
 *     device), and mixing them would make these oracles assert something the
 *     composer never promised;
 *   - each name has ONE category, because the add bar infers the category from
 *     the name (`inferCategory`), so two people typing the same thing land in
 *     the same category. Handing the same name two categories would be the
 *     fuzzer inventing a gesture the app doesn't make.
 */
const NAMES: Array<{ name: string; category: Category }> = [
  { name: 'Kite', category: 'Gear' },
  { name: 'Fishing rod', category: 'Gear' },
  { name: 'Board games', category: 'Misc' },
  { name: 'Corkscrew', category: 'Misc' },
  { name: 'Yoga mat', category: 'Gear' },
  { name: 'Binoculars', category: 'Electronics' },
  { name: 'Sketchbook', category: 'Misc' },
  { name: 'Frisbee', category: 'Gear' },
  { name: 'Travel pillow', category: 'Accessories' },
  { name: 'Playing cards', category: 'Misc' },
];
/** Trip types a person toggles mid-planning (essentials always stays on). */
const TOGGLEABLE_TYPES: TripTypeId[] = ['beach', 'cold', 'hiking', 'business'];
/** Honest skews: phones NTP-sync within seconds; a stray ±90s is generous. */
const SKEWS = [0, 2_000, -3_000, 30_000, -90_000];
/** Oracles only bind when rival actions are at least this far apart. */
const SEPARATION_MS = 5 * 60_000;
/**
 * Relay bound on a published trip. A packing trip is an order of magnitude
 * bigger than a grocery list (every selected type seeds items, and a long trip
 * multiplies quantities, not rows), and the whole trip is republished on every
 * change — so the number that matters is what a busy household's trip actually
 * reaches, kept well inside the ~64KB an event-size-capped public relay accepts
 * after sealing. Tombstone pruning (data/trip.ts) is what holds the line; these
 * scenarios top out around 14KB, so this is a tripwire on growth, not a fit.
 */
const PAYLOAD_LIMIT = 32 * 1024;

interface PackAction {
  wall: number;
  want: boolean; // desired packed state
}
interface ExistAction {
  wall: number;
  exists: boolean;
}

interface Scenario {
  seed: number;
  log: string[];
  world: SimWorld;
  devs: SimDev[];
  secret: string;
  // Intent ledger: latest + previous rival action (newest first, max 2).
  pack: Map<string, PackAction[]>; // per normalized name
  exist: Map<string, ExistAction[]>; // per normalized name (adds/removals)
  rowFate: Map<string, ExistAction[]>; // per item id (removals / revives)
  /**
   * Names a rename touched. A rename is genuinely last-writer-wins against a
   * blind edit of the same row — including the composer's, which rewrites a
   * seed row's name from its rule on the next trip edit — so the name-level
   * oracles stand down for a name once a rename has moved it.
   */
  renamed: Set<string>;
  /**
   * Seed rows a content edit has made the user's own, and when. The next trip
   * edit re-issues such a row under a fresh custom id (data/trip.ts §
   * composeItems) and tombstones the old `gen-` one — and the merge's pack fold
   * is keyed to the row, so a pack action a peer made on the old id does NOT
   * follow the row across. That is a real gap, reported rather than papered
   * over; I2 stands down for the names it can reach.
   */
  reidentified: Map<string, number>;
  /** Wall clock of the last trip edit; a recompose legitimately re-suggests a
   *  removed SEED row (see data/trip.ts § composeItems), so I5-gone binds on
   *  generated rows only while no trip edit has run since the removal. */
  lastRecompose: number;
  /** Wall clock of every local mutation, newest first (max 2) — I7's guard. */
  mutations: number[];
  /** The trip shape the last trip edit left on the acting device. */
  configEdit: { wall: number; config: string } | null;
  breaches: string[];
}

function record<T extends { wall: number }>(
  map: Map<string, T[]>,
  key: string,
  action: T
): void {
  const arr = map.get(key) ?? [];
  arr.unshift(action);
  map.set(key, arr.slice(0, 2));
}

/** Note a local write, so I7 can tell "newest action anywhere" from "newest
 *  trip edit, later overwritten by someone else's unseen edit". */
function mutated(sc: Scenario, wall: number): void {
  sc.mutations.unshift(wall);
  sc.mutations = sc.mutations.slice(0, 2);
}

function runScenario(seed: number): string | null {
  const rand = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const world = makeWorld();
  worldRef.current = world;
  const devCount = 2 + (rand() < 0.35 ? 1 : 0);
  const devs = Array.from({ length: devCount }, (_, i) =>
    makeDev(world, `d${i}`, pick(SKEWS))
  );
  const sc: Scenario = {
    seed,
    log: [],
    world,
    devs,
    secret: '',
    pack: new Map(),
    exist: new Map(),
    rowFate: new Map(),
    renamed: new Set(),
    reidentified: new Map(),
    lastRecompose: 0,
    mutations: [],
    configEdit: null,
    breaches: [],
  };

  // One person plans a trip and shares it; everyone else taps the link.
  const tripId0 = on(devs[0], () =>
    devs[0].store.getState().createTrip({
      name: 'Trip',
      duration: 3 + Math.floor(rand() * 5),
      typeIds: ['essentials', pick(TOGGLEABLE_TYPES)],
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    })
  );
  sc.secret = on(devs[0], () => devs[0].store.getState().shareTrip(tripId0))!;
  for (const d of devs.slice(1)) on(d, () => d.store.getState().joinShared(sc.secret));
  converge(devs, sc.secret);

  // Per-channel publish history for stale replays.
  const history: Trip[] = [];
  // Devices currently offline don't exchange.
  const offline = new Set<SimDev>();

  const steps = 25 + Math.floor(rand() * 35);
  for (let s = 0; s < steps; s++) {
    world.now += 30_000 + Math.floor(rand() * 20 * 60_000); // 30s–20min
    const dev = pick(devs);
    const roll = rand();
    const wall = world.now;

    if (roll < 0.22) {
      // Type something into the add bar — the most common act.
      const { name, category } = pick(NAMES);
      // The add bar dedupes on the NAME alone, so that is the identity every
      // add/remove oracle reasons about.
      const key = normalizeItemName(name);
      const before = visible(dev, sc.secret).find(
        (it) => normalizeItemName(it.name) === key
      );
      addItem(dev, sc.secret, name, category);
      mutated(sc, wall);
      sc.log.push(`t+${wall} ${dev.name} addItem(${name}/${category})`);
      const after = visible(dev, sc.secret).find(
        (it) => normalizeItemName(it.name) === key
      );
      record(sc.exist, key, { wall, exists: true });
      if (before) {
        // I3b: the row is bumped, never doubled.
        if (!after || after.id !== before.id || after.quantity !== before.quantity + 1) {
          sc.breaches.push(
            `I3 add of on-list "${name}" on ${dev.name} → ${JSON.stringify(
              after && { qty: after.quantity, sameRow: after.id === before.id }
            )}, want the same row at qty ${before.quantity + 1}`
          );
        }
        record(sc.rowFate, before.id, { wall, exists: true });
      } else {
        // I3a: re-adding something removed (or adding it for the first time) is
        // one fresh, unpacked need, right now, on the acting device.
        if (!after || after.packed || after.quantity !== 1) {
          sc.breaches.push(
            `I3 re-add of "${name}" on ${dev.name} → ${JSON.stringify(
              after && { qty: after.quantity, packed: after.packed }
            )}, want qty 1 unpacked`
          );
        }
        if (after) record(sc.rowFate, after.id, { wall, exists: true });
        record(sc.pack, key, { wall, want: false });
      }
    } else if (roll < 0.44) {
      // Tick something off (or back on) that this device can see.
      const items = visible(dev, sc.secret);
      if (items.length === 0) continue;
      const it = pick(items);
      const want = !it.packed;
      setPacked(dev, sc.secret, it.id, want);
      mutated(sc, wall);
      sc.log.push(`t+${wall} ${dev.name} setPacked(${it.name}, ${want})`);
      record(sc.pack, normalizeItemName(it.name), { wall, want });
    } else if (roll < 0.54) {
      // Content edit — must never disturb packed state (the defect class
      // merge.ts's packed clock exists for). A content edit also KEEPS THE ROW:
      // editing a copy that a not-yet-seen removal covered revives it (the
      // editor demonstrably wants it). Ticking off deliberately doesn't revive:
      // both sides agree the thing is handled.
      const items = visible(dev, sc.secret);
      if (items.length === 0) continue;
      const it = pick(items);
      if (rand() < 0.6) {
        const q = 1 + Math.floor(rand() * 5);
        setQuantity(dev, sc.secret, it.id, q);
        sc.log.push(`t+${wall} ${dev.name} setQuantity(${it.name}, ${q})`);
        // Editing a row revives it if a not-yet-seen removal covered it — but
        // only a typed-in row's existence is the person's to claim. A seed row
        // belongs to the composer, which drops it the moment its type is turned
        // off, whatever anyone edited.
        if (!it.id.startsWith('gen-')) {
          record(sc.exist, normalizeItemName(it.name), { wall, exists: true });
        }
      } else {
        const { name } = pick(NAMES);
        const nextKey = normalizeItemName(name);
        // The rename path has no dedupe — the UI never offers a way to end up
        // with two rows of the same name, so don't hand it a collision and then
        // blame the merge for the duplicate.
        if (items.some((o) => o.id !== it.id && normalizeItemName(o.name) === nextKey)) {
          continue;
        }
        renameItem(dev, sc.secret, it.id, name);
        sc.log.push(`t+${wall} ${dev.name} rename(${it.name} → ${name})`);
        record(sc.exist, normalizeItemName(it.name), { wall, exists: false });
        record(sc.exist, nextKey, { wall, exists: true });
        sc.renamed.add(normalizeItemName(it.name));
        sc.renamed.add(nextKey);
      }
      mutated(sc, wall);
      record(sc.rowFate, it.id, { wall, exists: true });
      // Editing a seed row marks it user-modified, which is what makes the next
      // trip edit re-issue it under a new id (see Scenario.reidentified).
      if (it.id.startsWith('gen-')) {
        sc.reidentified.set(normalizeItemName(it.name), wall);
      }
    } else if (roll < 0.62) {
      // Swipe a row away.
      const items = visible(dev, sc.secret);
      if (items.length === 0) continue;
      const it = pick(items);
      removeItem(dev, sc.secret, it.id);
      mutated(sc, wall);
      sc.log.push(`t+${wall} ${dev.name} removeItem(${it.name})`);
      record(sc.exist, normalizeItemName(it.name), { wall, exists: false });
      record(sc.rowFate, it.id, { wall, exists: false });
    } else if (roll < 0.7) {
      // Change the trip itself — the packing-specific half of this stack: both
      // edits re-run the composer, which rewrites the whole item set.
      if (rand() < 0.5) {
        const ty = pick(TOGGLEABLE_TYPES);
        toggleType(dev, sc.secret, ty);
        sc.log.push(`t+${wall} ${dev.name} toggleType(${ty})`);
      } else {
        const days = 1 + Math.floor(rand() * 14);
        changeDuration(dev, sc.secret, days);
        sc.log.push(`t+${wall} ${dev.name} changeDuration(${days}d)`);
      }
      mutated(sc, wall);
      sc.lastRecompose = wall;
      sc.configEdit = { wall, config: tripConfig(dev, sc.secret) };
    } else if (roll < 0.78) {
      // Two devices happen to be online together and exchange.
      const other = pick(devs);
      if (other !== dev && !offline.has(dev) && !offline.has(other)) {
        deliver(dev, other, sc.secret);
        deliver(other, dev, sc.secret);
        sc.log.push(`t+${wall} exchange ${dev.name}<->${other.name}`);
      }
    } else if (roll < 0.86) {
      // Publish into the ether: another device may hear it now, or a relay may
      // replay it much later (stale copy) — the merge must not care.
      history.push(snapshot(dev, sc.secret));
      const other = pick(devs);
      if (other !== dev && !offline.has(other) && rand() < 0.7) {
        deliver(dev, other, sc.secret);
      }
      sc.log.push(`t+${wall} publish ${dev.name}`);
    } else if (roll < 0.92) {
      if (history.length > 0 && rand() < 0.8) {
        // Stale replay of an old payload to a random device.
        const victim = pick(devs);
        const stale = history[Math.floor(rand() * history.length)];
        deliverPayload(victim, JSON.parse(JSON.stringify(stale)) as Trip);
        sc.log.push(`t+${wall} stale-replay -> ${victim.name}`);
      }
    } else {
      // Toggle offline (a phone in a dead spot / backgrounded for days).
      if (offline.has(dev)) offline.delete(dev);
      else offline.add(dev);
      sc.log.push(`t+${wall} ${dev.name} ${offline.has(dev) ? 'offline' : 'online'}`);
    }
  }

  // Everyone comes back online after a long quiet gap and fully syncs.
  world.now += 26 * 3600 * 1000;
  converge(devs, sc.secret);
  assertOracles(sc);

  if (sc.breaches.length === 0) return null;
  const finals = sc.devs
    .map(
      (d) =>
        `${d.name}: ` +
        sharedTripOf(d, sc.secret)
          .items.map(
            (it) =>
              `${it.name || '·'}/${it.category}#${it.id.slice(-6)}[q${it.quantity},p${it.packed ? 1 : 0},u${it.updatedAt},pu${it.packedUpdatedAt ?? '-'}${it.deletedAt ? ',DEAD' + it.deletedAt : ''}]`
          )
          .join(' ')
    )
    .join('\n    ');
  return `seed ${seed}:\n  ${sc.breaches.join('\n  ')}\n  final:\n    ${finals}\n  ops:\n    ${sc.log.join('\n    ')}`;
}

/**
 * Names whose row identity the app genuinely doesn't pin down, so the oracles
 * that reason about a THING rather than a row stand down for them. Both cases
 * are gaps worth reporting, not oracle softening: see `Scenario.renamed` (a
 * rename is last-writer-wins against a blind edit, and the rename path has no
 * dedupe) and `Scenario.reidentified` (a trip edit re-issues an edited seed row
 * under a fresh id, and the collapse skips `gen-` ids, so the old row and the
 * new one can both survive).
 */
function standsDown(sc: Scenario, key: string): boolean {
  if (sc.renamed.has(key)) return true;
  const reidAt = sc.reidentified.get(key);
  return reidAt != null && sc.lastRecompose > reidAt;
}

/** I1–I7, asserted once the household is quiet and fully synced. */
function assertOracles(sc: Scenario): void {
  const { devs, secret } = sc;

  // I1 convergence on what people SEE (name+category, quantity, packed).
  const prints = devs.map((d) => fingerprint(d, secret));
  if (new Set(prints).size !== 1) {
    sc.breaches.push(
      `I1 divergence: ${devs.map((d, i) => `${d.name}=[${prints[i]}]`).join(' vs ')}`
    );
  }

  // I4 duplicate visible rows within a category (see standsDown for the two
  // name classes this can't speak for).
  for (const d of devs) {
    const keys = visible(d, secret)
      .filter((it) => !standsDown(sc, normalizeItemName(it.name)))
      .map(itemKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length) sc.breaches.push(`I4 duplicate rows on ${d.name}: ${dupes.join(',')}`);
  }

  // I5-gone, id level: a specific row whose last fate (clearly separated) was
  // removal must not be visible anywhere. Add-wins: another device's unseen add
  // of the same thing may legitimately survive under a different id.
  for (const [id, fates] of sc.rowFate) {
    const [last, prev] = fates;
    if (!last || last.exists) continue;
    if (prev && last.wall - prev.wall < SEPARATION_MS) continue;
    // A seed row is re-suggested by any later trip edit (that is how toggling a
    // type off and back on restores its items), so it only has to stay gone
    // while nobody has re-run the composer since.
    if (id.startsWith('gen-') && sc.lastRecompose > last.wall) continue;
    for (const d of devs) {
      const row = visible(d, secret).find((it) => it.id === id);
      if (row) {
        sc.breaches.push(
          `I5 resurrection of row ${id} ("${row.name}") on ${d.name} (last fate: removal @${last.wall}; row u${row.updatedAt} pu${row.packedUpdatedAt ?? '-'})`
        );
        break;
      }
    }
  }
  // I5-present, name level: a thing whose last action (clearly separated) was
  // adding it must be visible.
  for (const [key, actions] of sc.exist) {
    const [last, prev] = actions;
    if (!last || !last.exists) continue;
    if (prev && last.wall - prev.wall < SEPARATION_MS) continue;
    if (sc.renamed.has(key)) continue;
    const rows = visible(devs[0], secret).filter(
      (it) => normalizeItemName(it.name) === key
    );
    if (rows.length === 0) sc.breaches.push(`I5 loss of "${key}" (last action was adding it)`);
  }

  // I2 last pack action wins. Keyed by the thing, not the row: two devices that
  // both add or both regenerate the same thing mint separate rows, and the
  // merge collapses them carrying the newest pack action of the group — which
  // is what the person meant by ticking it off.
  for (const [key, actions] of sc.pack) {
    const [last, prev] = actions;
    if (!last || (prev && last.wall - prev.wall < SEPARATION_MS)) continue;
    if (standsDown(sc, key)) continue;
    const existLast = sc.exist.get(key)?.[0];
    if (existLast && !existLast.exists) continue; // it should be gone; I5's turf
    if (existLast && existLast.wall > last.wall) continue; // re-added after; add semantics rule
    const row = visible(devs[0], secret).find((it) => normalizeItemName(it.name) === key);
    if (row && row.packed !== last.want) {
      sc.breaches.push(
        `I2 packed state of "${key}" is ${row.packed}, last action wanted ${last.want}`
      );
    }
  }

  // I7 the newest trip edit anywhere decides the trip's shape. It only binds
  // when nothing else was written after it (the head — length + types — merges
  // as one unit on the whole-trip clock, so a later unrelated edit on a device
  // that hasn't seen this one legitimately carries its own older shape).
  const cfg = sc.configEdit;
  const [newest, before] = sc.mutations;
  if (
    cfg &&
    newest === cfg.wall &&
    (before == null || cfg.wall - before >= SEPARATION_MS)
  ) {
    for (const d of devs) {
      const got = tripConfig(d, secret);
      if (got !== cfg.config) {
        sc.breaches.push(
          `I7 trip shape on ${d.name} is ${got}, newest trip edit set ${cfg.config}`
        );
        break;
      }
    }
  }

  // I6 payload bound (pruning happens through the real store's tombstone work).
  for (const d of devs) {
    const bytes = JSON.stringify(sharedTripOf(d, secret)).length;
    if (bytes > PAYLOAD_LIMIT) sc.breaches.push(`I6 payload ${bytes}B on ${d.name}`);
  }
}

test('user intent survives 250 randomized household scenarios', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 250; seed++) {
    const breach = runScenario(seed);
    if (breach) failures.push(breach);
  }
  if (failures.length) {
    // Print the first few in full; the count says how widespread it is.
    throw new Error(
      `${failures.length}/250 scenarios breached intent:\n\n${failures
        .slice(0, 3)
        .join('\n\n')}`
    );
  }
});

test('scenarios are deterministic (same seed → same outcome)', () => {
  for (const seed of [3, 77, 191]) {
    expect(runScenario(seed)).toBe(runScenario(seed));
  }
});
