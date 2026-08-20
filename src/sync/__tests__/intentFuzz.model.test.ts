/**
 * Intent fuzzer — the fast-check MODEL-BASED port (Uplevel 3 / T1).
 *
 * This is the hand-rolled `./intentFuzz.test.ts` re-expressed on the factory
 * `qa/intent-fuzz` kit (fast-check `fc.commands`). It drives the SAME REAL trips
 * store per simulated device through the SAME `../simHarness`, judged by the
 * SAME user-intent oracles — nothing weakened. What the port adds over the
 * hand-rolled loop is exactly the two things fast-check gives:
 *
 *   1. SHRINKING — a failure minimizes itself to the shortest reproducing
 *      command story (half of "clearly articulated" for free).
 *   2. THE ARTIFACT PIPELINE — on a counterexample the harness crystallizes a
 *      checked-in regression fixture (`qa/regressions/packing-list-trip-sync-…`),
 *      a defect-intake line, and a logged seed, and `replayRegressions` re-runs
 *      that minimal case forever.
 *
 * PARITY, NOT REPLACEMENT. The hand-rolled `intentFuzz.test.ts` + `syncSim.
 * test.ts` keep running alongside this file; same trust core (the shared-trip
 * merge), same oracles (I1–I7, verbatim intent from the hand-rolled file), same
 * stand-downs — read that file's header for what each oracle means and why the
 * separation window exists. This is a second way of reaching the same claims,
 * not a second set of claims.
 *
 * NOTE ON THE OTHER MODEL. packing-list also runs a single-device fuzzer over
 * the trips store (`src/store/__tests__/intentFuzz.test.ts`, model `packing`).
 * The kit enumerates every checked-in fixture from every call site, so once a
 * failure is crystallized for one model the OTHER file's `replayRegressions`
 * will say it doesn't know that model — register the missing builder there when
 * that happens.
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

import fc from 'fast-check';
import { runIntentFuzz } from '../../../qa/intent-fuzz/harness';
import { replayRegressions } from '../../../qa/intent-fuzz/replay';

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
} from '../simHarness';

const APP = require('../../../app.json').expo.slug as string;
const MODEL = 'trip-sync';

/** Same add-bar vocabulary as the hand-rolled fuzzer: one category per name,
 *  because the add bar infers the category from the name. */
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
const TOGGLEABLE_TYPES: TripTypeId[] = ['beach', 'cold', 'hiking', 'business'];
/** Honest phone NTP skews (ms) — one per device, fixed per household. */
const DEV_SKEWS = [0, -3_000, 30_000];
/** Oracles only bind when rival actions are at least this far apart. */
const SEPARATION_MS = 5 * 60_000;
/** Same relay-size tripwire the hand-rolled fuzzer asserts. */
const PAYLOAD_LIMIT = 32 * 1024;

// One Date.now spy for the whole file; each story swaps its world in via setup
// (mirrors the hand-rolled file — the shared clock + per-device skew).
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

interface PackAction {
  wall: number;
  want: boolean;
}
interface ExistAction {
  wall: number;
  exists: boolean;
}

/** The intent ledger — last-action-wins expectations, newest first (max 2).
 *  Field-for-field the hand-rolled fuzzer's `Scenario` ledger; the prose for
 *  each entry lives there. */
interface Model {
  pack: Map<string, PackAction[]>; // per normalized name
  exist: Map<string, ExistAction[]>; // per normalized name
  rowFate: Map<string, ExistAction[]>; // per item id
  renamed: Set<string>;
  reidentified: Map<string, number>;
  lastRecompose: number;
  mutations: number[];
  configEdit: { wall: number; config: string } | null;
}

interface Real {
  world: SimWorld;
  devs: SimDev[];
  secret: string;
  history: Trip[];
  offline: Set<number>; // device indices currently offline
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

function mutated(m: Model, wall: number): void {
  m.mutations.unshift(wall);
  m.mutations = m.mutations.slice(0, 2);
}

function devOf(r: Real, idx: number): SimDev {
  return r.devs[idx % r.devs.length];
}

/** Every command advances the shared wall clock 30s–~20min, exactly like the
 *  hand-rolled loop (gap is a fast-check draw, so it shrinks + replays). */
function advance(r: Real, gap: number): number {
  r.world.now += 30_000 + gap * 30_000;
  return r.world.now;
}

class AddItem implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly devIdx: number, readonly nameIdx: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const dev = devOf(r, this.devIdx);
    const { name, category } = NAMES[this.nameIdx % NAMES.length];
    const key = normalizeItemName(name);
    const wall = advance(r, this.gap);
    const before = visible(dev, r.secret).find((it) => normalizeItemName(it.name) === key);
    addItem(dev, r.secret, name, category);
    mutated(m, wall);
    const after = visible(dev, r.secret).find((it) => normalizeItemName(it.name) === key);
    record(m.exist, key, { wall, exists: true });
    if (before) {
      // I3b: the row is bumped, never doubled.
      if (!after || after.id !== before.id || after.quantity !== before.quantity + 1) {
        throw new Error(
          `I3 add of on-list "${name}" on ${dev.name} → ${JSON.stringify(
            after && { qty: after.quantity, sameRow: after.id === before.id }
          )}, want the same row at qty ${before.quantity + 1}`
        );
      }
      record(m.rowFate, before.id, { wall, exists: true });
    } else {
      // I3a: re-adding something removed is one fresh, unpacked need, right now.
      if (!after || after.packed || after.quantity !== 1) {
        throw new Error(
          `I3 re-add of "${name}" on ${dev.name} → ${JSON.stringify(
            after && { qty: after.quantity, packed: after.packed }
          )}, want qty 1 unpacked`
        );
      }
      record(m.rowFate, after.id, { wall, exists: true });
      record(m.pack, key, { wall, want: false });
    }
  }
  toString = () => `d${this.devIdx}.add(${NAMES[this.nameIdx % NAMES.length].name})`;
}

class TogglePacked implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly devIdx: number, readonly itemIdx: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const dev = devOf(r, this.devIdx);
    const items = visible(dev, r.secret);
    if (items.length === 0) return;
    const it = items[this.itemIdx % items.length];
    const want = !it.packed;
    const wall = advance(r, this.gap);
    setPacked(dev, r.secret, it.id, want);
    mutated(m, wall);
    record(m.pack, normalizeItemName(it.name), { wall, want });
  }
  toString = () => `d${this.devIdx}.togglePacked(#${this.itemIdx})`;
}

class ContentEdit implements fc.Command<Model, Real> {
  constructor(
    readonly gap: number,
    readonly devIdx: number,
    readonly itemIdx: number,
    readonly asRename: boolean,
    readonly nameIdx: number,
    readonly qty: number
  ) {}
  check = () => true;
  run(m: Model, r: Real): void {
    // A content edit must NEVER disturb packed state (the defect class the
    // packed clock exists for) and KEEPS THE ROW.
    const dev = devOf(r, this.devIdx);
    const items = visible(dev, r.secret);
    if (items.length === 0) return;
    const it = items[this.itemIdx % items.length];
    const wall = advance(r, this.gap);
    if (this.asRename) {
      const { name } = NAMES[this.nameIdx % NAMES.length];
      const nextKey = normalizeItemName(name);
      // The rename path has no dedupe; don't hand it a collision and then blame
      // the merge for the duplicate.
      if (items.some((o) => o.id !== it.id && normalizeItemName(o.name) === nextKey)) return;
      renameItem(dev, r.secret, it.id, name);
      record(m.exist, normalizeItemName(it.name), { wall, exists: false });
      record(m.exist, nextKey, { wall, exists: true });
      m.renamed.add(normalizeItemName(it.name));
      m.renamed.add(nextKey);
    } else {
      setQuantity(dev, r.secret, it.id, 1 + (this.qty % 5));
      if (!it.id.startsWith('gen-')) {
        record(m.exist, normalizeItemName(it.name), { wall, exists: true });
      }
    }
    mutated(m, wall);
    record(m.rowFate, it.id, { wall, exists: true });
    if (it.id.startsWith('gen-')) m.reidentified.set(normalizeItemName(it.name), wall);
  }
  toString = () =>
    `d${this.devIdx}.${this.asRename ? 'rename' : 'setQty'}(#${this.itemIdx})`;
}

class RemoveItem implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly devIdx: number, readonly itemIdx: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const dev = devOf(r, this.devIdx);
    const items = visible(dev, r.secret);
    if (items.length === 0) return;
    const it = items[this.itemIdx % items.length];
    const wall = advance(r, this.gap);
    removeItem(dev, r.secret, it.id);
    mutated(m, wall);
    record(m.exist, normalizeItemName(it.name), { wall, exists: false });
    record(m.rowFate, it.id, { wall, exists: false });
  }
  toString = () => `d${this.devIdx}.remove(#${this.itemIdx})`;
}

class TripEdit implements fc.Command<Model, Real> {
  constructor(
    readonly gap: number,
    readonly devIdx: number,
    readonly asType: boolean,
    readonly typeIdx: number,
    readonly days: number
  ) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const dev = devOf(r, this.devIdx);
    const wall = advance(r, this.gap);
    if (this.asType) {
      toggleType(dev, r.secret, TOGGLEABLE_TYPES[this.typeIdx % TOGGLEABLE_TYPES.length]);
    } else {
      changeDuration(dev, r.secret, 1 + (this.days % 14));
    }
    mutated(m, wall);
    m.lastRecompose = wall;
    m.configEdit = { wall, config: tripConfig(dev, r.secret) };
  }
  toString = () => `d${this.devIdx}.${this.asType ? 'toggleType' : 'changeDuration'}`;
}

class Exchange implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly aIdx: number, readonly bIdx: number) {}
  check = () => true;
  run(_m: Model, r: Real): void {
    advance(r, this.gap);
    const a = devOf(r, this.aIdx);
    const b = devOf(r, this.bIdx);
    if (a === b) return;
    if (r.offline.has(this.aIdx % r.devs.length) || r.offline.has(this.bIdx % r.devs.length)) return;
    deliver(a, b, r.secret);
    deliver(b, a, r.secret);
  }
  toString = () => `exchange(d${this.aIdx}<->d${this.bIdx})`;
}

class Publish implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly devIdx: number, readonly otherIdx: number) {}
  check = () => true;
  run(_m: Model, r: Real): void {
    advance(r, this.gap);
    const dev = devOf(r, this.devIdx);
    r.history.push(snapshot(dev, r.secret));
    const other = devOf(r, this.otherIdx);
    if (other !== dev && !r.offline.has(this.otherIdx % r.devs.length)) {
      deliver(dev, other, r.secret);
    }
  }
  toString = () => `publish(d${this.devIdx})`;
}

class StaleReplay implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly victimIdx: number, readonly histIdx: number) {}
  check = () => true;
  run(_m: Model, r: Real): void {
    advance(r, this.gap);
    if (r.history.length === 0) return;
    const victim = devOf(r, this.victimIdx);
    const stale = r.history[this.histIdx % r.history.length];
    deliverPayload(victim, JSON.parse(JSON.stringify(stale)) as Trip);
  }
  toString = () => `staleReplay(->d${this.victimIdx})`;
}

class ToggleOffline implements fc.Command<Model, Real> {
  constructor(readonly gap: number, readonly devIdx: number) {}
  check = () => true;
  run(_m: Model, r: Real): void {
    advance(r, this.gap);
    const i = this.devIdx % r.devs.length;
    if (r.offline.has(i)) r.offline.delete(i);
    else r.offline.add(i);
  }
  toString = () => `d${this.devIdx}.toggleOffline`;
}

const gap = fc.integer({ min: 0, max: 40 });
const dIdx = fc.integer({ min: 0, max: 2 });
const idx = fc.nat({ max: 40 });

const commands: fc.Arbitrary<fc.Command<Model, Real>>[] = [
  fc.tuple(gap, dIdx, fc.nat({ max: NAMES.length - 1 })).map(([g, d, n]) => new AddItem(g, d, n)),
  fc.tuple(gap, dIdx, idx).map(([g, d, i]) => new TogglePacked(g, d, i)),
  fc
    .tuple(gap, dIdx, idx, fc.boolean(), fc.nat({ max: NAMES.length - 1 }), fc.nat({ max: 4 }))
    .map(([g, d, i, rn, n, q]) => new ContentEdit(g, d, i, rn, n, q)),
  fc.tuple(gap, dIdx, idx).map(([g, d, i]) => new RemoveItem(g, d, i)),
  fc
    .tuple(gap, dIdx, fc.boolean(), fc.nat({ max: 3 }), fc.nat({ max: 13 }))
    .map(([g, d, ty, t, days]) => new TripEdit(g, d, ty, t, days)),
  fc.tuple(gap, dIdx, dIdx).map(([g, a, b]) => new Exchange(g, a, b)),
  fc.tuple(gap, dIdx, dIdx).map(([g, d, o]) => new Publish(g, d, o)),
  fc.tuple(gap, dIdx, idx).map(([g, v, h]) => new StaleReplay(g, v, h)),
  fc.tuple(gap, dIdx).map(([g, d]) => new ToggleOffline(g, d)),
];

function setup(): { model: Model; real: Real } {
  const world = makeWorld();
  worldRef.current = world;
  const devs = DEV_SKEWS.map((skew, i) => makeDev(world, `d${i}`, skew));
  const tripId0 = on(devs[0], () =>
    devs[0].store.getState().createTrip({
      name: 'Trip',
      duration: 4,
      typeIds: ['essentials', 'beach'],
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    })
  );
  const secret = on(devs[0], () => devs[0].store.getState().shareTrip(tripId0))!;
  for (const d of devs.slice(1)) on(d, () => d.store.getState().joinShared(secret));
  converge(devs, secret);
  return {
    model: {
      pack: new Map(),
      exist: new Map(),
      rowFate: new Map(),
      renamed: new Set(),
      reidentified: new Map(),
      lastRecompose: 0,
      mutations: [],
      configEdit: null,
    },
    real: { world, devs, secret, history: [], offline: new Set() },
  };
}

/** Names whose row identity the app genuinely doesn't pin down — same two
 *  classes the hand-rolled fuzzer documents (rename; edited seed row re-issued
 *  under a new id by the next trip edit). */
function standsDown(m: Model, key: string): boolean {
  if (m.renamed.has(key)) return true;
  const reidAt = m.reidentified.get(key);
  return reidAt != null && m.lastRecompose > reidAt;
}

/** After the story: everyone comes back online after a long quiet gap and fully
 *  syncs, then the intent oracles I1–I7 are asserted (verbatim from the
 *  hand-rolled fuzzer). Throws on a breached oracle → fast-check shrinks. */
function atQuiescence(s: { model: Model; real: Real }): void {
  const { model: m, real: r } = s;
  const { devs, secret } = r;
  r.offline.clear();
  r.world.now += 26 * 3600 * 1000;
  converge(devs, secret);

  const breaches: string[] = [];

  // I1 convergence on what people SEE (name+category, quantity, packed).
  const prints = devs.map((d) => fingerprint(d, secret));
  if (new Set(prints).size !== 1) {
    breaches.push(
      `I1 divergence: ${devs.map((d, i) => `${d.name}=[${prints[i]}]`).join(' vs ')}`
    );
  }

  // I4 duplicate visible rows within a category.
  for (const d of devs) {
    const keys = visible(d, secret)
      .filter((it) => !standsDown(m, normalizeItemName(it.name)))
      .map(itemKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length) breaches.push(`I4 duplicate rows on ${d.name}: ${dupes.join(',')}`);
  }

  // I5-gone, id level: a row whose last (separated) fate was removal must be
  // gone everywhere — unless a later trip edit re-suggested that seed row.
  for (const [id, fates] of m.rowFate) {
    const [last, prev] = fates;
    if (!last || last.exists) continue;
    if (prev && last.wall - prev.wall < SEPARATION_MS) continue;
    if (id.startsWith('gen-') && m.lastRecompose > last.wall) continue;
    for (const d of devs) {
      const row = visible(d, secret).find((it) => it.id === id);
      if (row) {
        breaches.push(
          `I5 resurrection of row ${id} ("${row.name}") on ${d.name} (last fate: removal @${last.wall})`
        );
        break;
      }
    }
  }
  // I5-present, name level: a thing last (separated) added must be visible.
  for (const [key, actions] of m.exist) {
    const [last, prev] = actions;
    if (!last || !last.exists) continue;
    if (prev && last.wall - prev.wall < SEPARATION_MS) continue;
    if (m.renamed.has(key)) continue;
    const rows = visible(devs[0], secret).filter((it) => normalizeItemName(it.name) === key);
    if (rows.length === 0) breaches.push(`I5 loss of "${key}" (last action was adding it)`);
  }
  // I2 last pack action wins, per thing.
  for (const [key, actions] of m.pack) {
    const [last, prev] = actions;
    if (!last || (prev && last.wall - prev.wall < SEPARATION_MS)) continue;
    if (standsDown(m, key)) continue;
    const existLast = m.exist.get(key)?.[0];
    if (existLast && !existLast.exists) continue; // should be gone; I5's turf
    if (existLast && existLast.wall > last.wall) continue; // re-added after; add semantics rule
    const row = visible(devs[0], secret).find((it) => normalizeItemName(it.name) === key);
    if (row && row.packed !== last.want) {
      breaches.push(
        `I2 packed state of "${key}" is ${row.packed}, last action wanted ${last.want}`
      );
    }
  }

  // I7 the newest trip edit anywhere decides the trip's shape.
  const cfg = m.configEdit;
  const [newest, before] = m.mutations;
  if (cfg && newest === cfg.wall && (before == null || cfg.wall - before >= SEPARATION_MS)) {
    for (const d of devs) {
      const got = tripConfig(d, secret);
      if (got !== cfg.config) {
        breaches.push(`I7 trip shape on ${d.name} is ${got}, newest trip edit set ${cfg.config}`);
        break;
      }
    }
  }

  // I6 payload bound.
  for (const d of devs) {
    const bytes = JSON.stringify(sharedTripOf(d, secret)).length;
    if (bytes > PAYLOAD_LIMIT) breaches.push(`I6 payload ${bytes}B on ${d.name}`);
  }

  if (breaches.length) throw new Error(breaches.join(' | '));
}

/** The SAME property the live fuzzer runs — replayed against a checked-in
 *  fixture's exact seed+path by `replayRegressions`. Must mirror runIntentFuzz's
 *  internal build (same commands, same maxCommands, same setup + atQuiescence). */
export function buildTripSyncProperty(): fc.IPropertyWithHooks<unknown> {
  return fc.property(fc.commands(commands, { maxCommands: 40 }), (cmds) => {
    const s = setup();
    fc.modelRun(() => ({ model: s.model, real: s.real }), cmds);
    atQuiescence(s);
  }) as unknown as fc.IPropertyWithHooks<unknown>;
}

describe('packing shared trip — intent fuzzer (fast-check model port)', () => {
  it('user intent survives randomized household stories', () => {
    runIntentFuzz<Model, Real>({
      app: APP,
      model: MODEL,
      commands,
      setup,
      atQuiescence,
      maxCommands: 40,
    });
  });
});

replayRegressions({ models: { [MODEL]: buildTripSyncProperty } });
