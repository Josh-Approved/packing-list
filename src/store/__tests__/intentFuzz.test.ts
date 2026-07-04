/**
 * Intent fuzzer — packing-list trust core (Uplevel 3 / T1).
 *
 * Drives the REAL `useTripsStore` (a fresh module instance per run via
 * jest.isolateModules; persistence + settings mocked so it stays hermetic —
 * Google's "small" test: no disk, no network, no real timers) through random
 * user stories, and after every command asserts INTENT — what a person expects,
 * not "the state happened to converge".
 *
 * The trust core here is trips × items × trip-types (the "kits") × packed state,
 * plus the export/import transfer layer. Three of the four oracles come straight
 * from the T1 spec's packing bullet; the two structural ones bind everywhere:
 *
 *   I-NODUP        no two items in a trip share a name (case-insensitive) — kit
 *                  composition (max() merge) and add-item (bump-not-duplicate)
 *                  both dedupe, so a duplicate row is always a bug.
 *   I-PACKED       checked (packed) state survives a trip edit: for any item
 *                  name that persists across a type toggle / duration change,
 *                  its packed flag is unchanged (spec: "checked state survives
 *                  trip edits").
 *   I-KEEP         a user-modified / custom item survives type toggles — its
 *                  name is still present after recompose (spec + trip.ts §3).
 *   I-ROUNDTRIP    parseTransfer(serializeTrips(trips)) restores exactly what
 *                  export wrote (spec: "import restores exactly what export
 *                  wrote").
 *   I-IMPORT-NOLOSS  importing an exported set is purely additive: every prior
 *                  trip is untouched and exactly N trips are added.
 *
 * Oracles are intent statements, never convergence alone (canon, 2026-07-03).
 * The model is only the intent ledger (which trips exist); it never
 * re-implements composeItems — every quantity/drop/merge decision is read back
 * from the real store.
 *
 * Gender is held at 'unspecified' (the default, and the overwhelmingly common
 * path); the gendered seed rules are a small, orthogonal surface. Varying it is
 * a future extension, not a weakened oracle.
 */

import fc from 'fast-check';
import { runIntentFuzz, intent } from '../../../qa/intent-fuzz/harness';
import { replayRegressions } from '../../../qa/intent-fuzz/replay';

// Hermetic: mock everything the trips + settings stores touch beyond pure JS.
jest.mock('../db', () => ({
  loadAllTrips: jest.fn(async () => []),
  saveTrip: jest.fn(async () => {}),
  deleteTripFromDb: jest.fn(async () => {}),
  getAppSetting: jest.fn(async () => null),
  setAppSetting: jest.fn(async () => {}),
}));
jest.mock('../../qa/qaMode', () => ({ QA_MODE: false }));
jest.mock('../../qa/fixtures', () => ({ qaTrips: () => [] }));

import {
  applyTypeToggle,
  applyDurationChange,
  MAX_DURATION_DAYS,
  MIN_DURATION_DAYS,
  SHARED_ASSIGNEE,
  TRIP_TYPES,
  type Trip,
  type TripItem,
  type TripInfo,
  type TripTypeId,
} from '../../data/trip';
import { serializeTrips, parseTransfer, mergeImported } from '../../lib/transfer';

const APP = require('../../../app.json').expo.slug as string;
const MODEL = 'packing';

const TYPE_IDS: TripTypeId[] = TRIP_TYPES.map((t) => t.id);
// Names a user types by hand. A deliberate mix: some collide with generated
// rule names (exercises the add-item bump-not-duplicate dedupe path) and some
// are wholly novel (exercises a real custom item surviving recompose).
const CUSTOM_NAMES = ['Socks', 'Passport', 'Charger cable', 'Snacks', 'Book', 'Journal', 'Kite', 'Fishing rod'];

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Key-order-insensitive structural serialization. "Import restores exactly what
 * export wrote" is a claim about the DATA, not object key insertion order —
 * validateTrip legitimately rebuilds each trip with a canonical key order. Array
 * order is preserved (item order must survive the round-trip); object keys are
 * sorted so two structurally-identical values stringify identically.
 */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
      : val
  );
}

// The REAL store type (just the slice the fuzzer drives).
type TripsStore = {
  getState: () => {
    trips: Trip[];
    createTrip: (info: TripInfo) => string;
    getTrip: (id: string) => Trip | undefined;
    updateTrip: (id: string, fn: (t: Trip) => Trip) => void;
    duplicateTrip: (id: string) => string | null;
    importTrips: (imported: Trip[]) => number;
    deleteTrip: (id: string) => void;
  };
};

interface Real {
  store: TripsStore;
}
interface Model {
  // Intent ledger: the trip ids we believe exist. Resynced from the real store
  // after every mutation, so it is authoritative but never re-derives item
  // state (that is always read back from the store — the oracle's source).
  tripIds: string[];
}

// ---------------------------------------------------------------------------
// Oracle helpers
// ---------------------------------------------------------------------------

function tripAt(m: Model, r: Real, pick: number): Trip | undefined {
  if (m.tripIds.length === 0) return undefined;
  const id = m.tripIds[pick % m.tripIds.length];
  return r.store.getState().getTrip(id);
}

function resync(m: Model, r: Real): void {
  m.tripIds = r.store.getState().trips.map((t) => t.id);
}

/** I-NODUP: no two items share a case-insensitive name. */
function assertNoDupNames(t: Trip, ctx: string): void {
  const seen = new Set<string>();
  for (const it of t.items) {
    const k = norm(it.name);
    intent(`${ctx}: two items named "${it.name}" — kit composition/add must dedupe`, !seen.has(k));
    seen.add(k);
  }
}

/** name -> packed, for the before/after "checked survives" comparison. */
function packedByName(t: Trip): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const it of t.items) m.set(norm(it.name), it.packed);
  return m;
}

/**
 * I-PACKED + I-KEEP after a recompose (type toggle / duration change). For any
 * item NAME present both before and after, packed must be unchanged (a still-
 * present item never silently loses its check). And any custom/user-modified
 * item present before must still be present after (its edits are never dropped).
 */
function assertRecomposePreserved(before: Trip, after: Trip, ctx: string): void {
  const afterPacked = packedByName(after);
  const beforePacked = packedByName(before);
  for (const [name, packed] of beforePacked) {
    if (afterPacked.has(name)) {
      intent(
        `${ctx}: packed state of "${name}" changed across a trip edit (was ${packed}, now ${afterPacked.get(name)})`,
        afterPacked.get(name) === packed
      );
    }
  }
  const afterNames = new Set(after.items.map((it) => norm(it.name)));
  for (const it of before.items) {
    if (it.source === 'custom' || it.userModified) {
      intent(
        `${ctx}: user-modified/custom item "${it.name}" was dropped by a trip edit`,
        afterNames.has(norm(it.name))
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Commands — one per real user action
// ---------------------------------------------------------------------------

class CreateTrip implements fc.Command<Model, Real> {
  constructor(readonly typeIds: TripTypeId[], readonly duration: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const info: TripInfo = {
      name: `Trip ${m.tripIds.length + 1}`,
      duration: this.duration,
      // Essentials is always in the real create flow's default; include it so
      // trips are never empty, plus the drawn extras.
      typeIds: Array.from(new Set<TripTypeId>(['essentials', ...this.typeIds])),
      canDoLaundry: false,
      laundryIntervalDays: 4,
      thoroughness: 'normal',
    };
    const id = r.store.getState().createTrip(info);
    const t = r.store.getState().getTrip(id)!;
    assertNoDupNames(t, 'create');
    resync(m, r);
  }
  toString = () => `create([${this.typeIds.join(',')}], ${this.duration}d)`;
}

class ToggleType implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly typeId: TripTypeId) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const before = tripAt(m, r, this.pick);
    if (!before) return;
    const id = before.id;
    r.store.getState().updateTrip(id, (t) => {
      const { typeIds, items } = applyTypeToggle(t, this.typeId);
      return { ...t, typeIds, items };
    });
    const after = r.store.getState().getTrip(id)!;
    assertNoDupNames(after, 'toggle-type');
    assertRecomposePreserved(before, after, 'toggle-type');
    resync(m, r);
  }
  toString = () => `toggleType(#${this.pick}, ${this.typeId})`;
}

class ChangeDuration implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly duration: number) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const before = tripAt(m, r, this.pick);
    if (!before) return;
    const id = before.id;
    r.store.getState().updateTrip(id, (t) => ({
      ...t,
      duration: Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Math.round(this.duration))),
      items: applyDurationChange(t, this.duration),
    }));
    const after = r.store.getState().getTrip(id)!;
    assertNoDupNames(after, 'change-duration');
    assertRecomposePreserved(before, after, 'change-duration');
    resync(m, r);
  }
  toString = () => `changeDuration(#${this.pick}, ${this.duration}d)`;
}

class TogglePacked implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly itemPick: number) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t || t.items.length === 0) return;
    const item = t.items[this.itemPick % t.items.length];
    const want = !item.packed;
    r.store.getState().updateTrip(t.id, (tr) => ({
      ...tr,
      items: tr.items.map((it) => (it.id === item.id ? { ...it, packed: want } : it)),
    }));
    const after = r.store.getState().getTrip(t.id)!.items.find((it) => it.id === item.id);
    intent(`last check action on "${item.name}" wins (wanted ${want})`, after?.packed === want);
    resync(m, r);
  }
  toString = () => `togglePacked(#${this.pick}, item#${this.itemPick})`;
}

class AddCustomItem implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly name: string) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t) return;
    const id = t.id;
    const name = this.name.trim();
    // Mirror handleAddItem: dedupe-by-name (bump existing), else append custom.
    r.store.getState().updateTrip(id, (tr) => {
      const lower = norm(name);
      const existing = tr.items.findIndex((it) => norm(it.name) === lower);
      if (existing >= 0) {
        return {
          ...tr,
          items: tr.items.map((it, i) =>
            i === existing ? { ...it, quantity: it.quantity + 1, userModified: true } : it
          ),
        };
      }
      const newItem: TripItem = {
        id: `c-${lower}-${tr.items.length}`,
        name,
        category: 'Misc',
        quantity: 1,
        assigneeId: SHARED_ASSIGNEE,
        packed: false,
        source: 'custom',
      };
      return { ...tr, items: [...tr.items, newItem] };
    });
    const after = r.store.getState().getTrip(id)!;
    assertNoDupNames(after, 'add-item');
    intent(
      `added item "${name}" is present after add`,
      after.items.some((it) => norm(it.name) === norm(name))
    );
    resync(m, r);
  }
  toString = () => `addItem(#${this.pick}, ${this.name})`;
}

class EditQuantity implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly itemPick: number, readonly qty: number) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t || t.items.length === 0) return;
    const item = t.items[this.itemPick % t.items.length];
    r.store.getState().updateTrip(t.id, (tr) => ({
      ...tr,
      items: tr.items.map((it) => (it.id === item.id ? { ...it, quantity: this.qty, userModified: true } : it)),
    }));
    const after = r.store.getState().getTrip(t.id)!.items.find((it) => it.id === item.id);
    intent(`quantity edit on "${item.name}" sticks (wanted ${this.qty})`, after?.quantity === this.qty);
    resync(m, r);
  }
  toString = () => `editQty(#${this.pick}, item#${this.itemPick}, ${this.qty})`;
}

class RenameItem implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly itemPick: number, readonly name: string) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t || t.items.length === 0) return;
    const item = t.items[this.itemPick % t.items.length];
    const trimmed = this.name.trim();
    if (!trimmed) return;
    // Renaming to a name another item already holds is a rare, unguarded UI
    // action (the store does not dedupe on rename); skip it so I-NODUP stays a
    // true global invariant of the compose/add trust core rather than a claim
    // the rename path never made.
    const collides = t.items.some((it) => it.id !== item.id && norm(it.name) === norm(trimmed));
    if (collides) return;
    r.store.getState().updateTrip(t.id, (tr) => ({
      ...tr,
      items: tr.items.map((it) => (it.id === item.id ? { ...it, name: trimmed, userModified: true } : it)),
    }));
    const after = r.store.getState().getTrip(t.id)!;
    assertNoDupNames(after, 'rename');
    intent(
      `renamed item "${trimmed}" is present after rename`,
      after.items.some((it) => norm(it.name) === norm(trimmed))
    );
    resync(m, r);
  }
  toString = () => `rename(#${this.pick}, item#${this.itemPick}, ${this.name})`;
}

class DeleteItem implements fc.Command<Model, Real> {
  constructor(readonly pick: number, readonly itemPick: number) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t || t.items.length === 0) return;
    const item = t.items[this.itemPick % t.items.length];
    const deadId = item.id;
    r.store.getState().updateTrip(t.id, (tr) => ({
      ...tr,
      items: tr.items.filter((it) => it.id !== deadId),
    }));
    const after = r.store.getState().getTrip(t.id)!;
    intent(`deleted item ${deadId} ("${item.name}") must not remain`, !after.items.some((it) => it.id === deadId));
    resync(m, r);
  }
  toString = () => `deleteItem(#${this.pick}, item#${this.itemPick})`;
}

class DuplicateTrip implements fc.Command<Model, Real> {
  constructor(readonly pick: number) {}
  // Bound total trips so repeated dup/import can't explode the story.
  check = (m: Model) => m.tripIds.length > 0 && m.tripIds.length < 8;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t) return;
    const newId = r.store.getState().duplicateTrip(t.id);
    if (!newId) return;
    const dup = r.store.getState().getTrip(newId)!;
    assertNoDupNames(dup, 'duplicate');
    // A fresh duplicate is reset to fully-unpacked (recovery from a template).
    intent('duplicated trip starts fully unpacked', dup.items.every((it) => it.packed === false));
    resync(m, r);
  }
  toString = () => `duplicateTrip(#${this.pick})`;
}

class DeleteTrip implements fc.Command<Model, Real> {
  constructor(readonly pick: number) {}
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const t = tripAt(m, r, this.pick);
    if (!t) return;
    const deadId = t.id;
    r.store.getState().deleteTrip(deadId);
    intent(`deleted trip ${deadId} must not remain`, !r.store.getState().trips.some((x) => x.id === deadId));
    resync(m, r);
  }
  toString = () => `deleteTrip(#${this.pick})`;
}

class ExportImport implements fc.Command<Model, Real> {
  check = (m: Model) => m.tripIds.length > 0;
  run(m: Model, r: Real): void {
    const before = r.store.getState().trips;
    // I-ROUNDTRIP — the transfer layer restores exactly what export wrote.
    const parsed = parseTransfer(serializeTrips(before));
    const normalized = JSON.parse(JSON.stringify(before)) as Trip[];
    intent(
      'export→import restores exactly what export wrote',
      stable(parsed) === stable(normalized)
    );
    // I-IMPORT-NOLOSS — merge is purely additive, existing trips untouched.
    if (before.length <= 4) {
      const beforeSnapshot = JSON.parse(JSON.stringify(before)) as Trip[];
      const added = r.store.getState().importTrips(parsed);
      intent(`import adds exactly ${parsed.length} trips`, added === parsed.length);
      const now = r.store.getState().trips;
      for (const prior of beforeSnapshot) {
        const stillThere = now.find((t) => t.id === prior.id);
        intent(
          `import must not mutate existing trip ${prior.id}`,
          !!stillThere && stable(stillThere) === stable(prior)
        );
      }
    }
    resync(m, r);
  }
  toString = () => `exportImport()`;
}

// ---------------------------------------------------------------------------
// Command arbitraries + setup
// ---------------------------------------------------------------------------

const smallInt = fc.nat({ max: 20 });
const duration = fc.integer({ min: 1, max: 60 });

const commands: fc.Arbitrary<fc.Command<Model, Real>>[] = [
  fc.tuple(fc.subarray(TYPE_IDS, { maxLength: 4 }), duration).map(([ts, d]) => new CreateTrip(ts, d)),
  fc.tuple(smallInt, fc.constantFrom(...TYPE_IDS)).map(([p, ty]) => new ToggleType(p, ty)),
  fc.tuple(smallInt, duration).map(([p, d]) => new ChangeDuration(p, d)),
  fc.tuple(smallInt, smallInt).map(([p, i]) => new TogglePacked(p, i)),
  fc.tuple(smallInt, fc.constantFrom(...CUSTOM_NAMES)).map(([p, n]) => new AddCustomItem(p, n)),
  fc.tuple(smallInt, smallInt, fc.integer({ min: 1, max: 99 })).map(([p, i, q]) => new EditQuantity(p, i, q)),
  fc.tuple(smallInt, smallInt, fc.constantFrom(...CUSTOM_NAMES)).map(([p, i, n]) => new RenameItem(p, i, n)),
  fc.tuple(smallInt, smallInt).map(([p, i]) => new DeleteItem(p, i)),
  smallInt.map((p) => new DuplicateTrip(p)),
  smallInt.map((p) => new DeleteTrip(p)),
  fc.constant(new ExportImport()),
];

/** A fresh REAL store per run (isolateModules re-instantiates the singleton). */
function setup(): { model: Model; real: Real } {
  let store!: TripsStore;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    store = require('../trips').useTripsStore;
  });
  return { model: { tripIds: [] }, real: { store } };
}

/** Shared by the live fuzzer and the regression replayer (same property). */
export function buildPackingProperty(): fc.IPropertyWithHooks<unknown> {
  return fc.property(fc.commands(commands, { maxCommands: 50 }), (cmds) => {
    const s = setup();
    fc.modelRun(() => ({ model: s.model, real: s.real }), cmds);
  }) as unknown as fc.IPropertyWithHooks<unknown>;
}

describe('packing — intent fuzzer', () => {
  it('user intent survives randomized packing stories', () => {
    runIntentFuzz<Model, Real>({ app: APP, model: MODEL, commands, setup, maxCommands: 50 });
  });
});

// Every crystallized failure replays as a normal test forever.
replayRegressions({ models: { [MODEL]: buildPackingProperty } });
