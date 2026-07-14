/**
 * Regression: the clock-skew failure modes are fixed for trips.
 *
 * Models two paired devices, each with its OWN logical clock (one phone an hour
 * fast), stamping edits and exchanging whole-trip copies through the real
 * `mergeTrip` — exactly the engine's data path. Before the logical-clock fix
 * these scenarios lost edits and made items disappear; the asserts pin the
 * corrected behaviour.
 */
import { LogicalClock } from '../clock';
import { mergeTrip } from '../merge';
import type { TripItem, Trip } from '../../data/trip';

const SECRET = 'shared-secret-xyz';
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** Shared "real" wall time the two fake device clocks are offset from. */
let real = T0;

class Device {
  trip: Trip;
  readonly clock: LogicalClock;
  constructor(label: string, skewMs: number) {
    this.clock = new LogicalClock({ physicalNow: () => real + skewMs });
    const at = this.clock.now();
    this.trip = {
      id: `t_${label}`,
      name: 'Trip',
      nameUpdatedAt: at,
      duration: 3,
      typeIds: [],
      packers: [{ id: 'me', name: 'Me' }],
      items: [],
      createdAt: at,
      updatedAt: at,
      shareIdentity: { secret: SECRET, createdAt: at },
    };
  }

  /** Upsert an item (create or edit), stamping with this device's clock. Custom
   *  ids (not `gen-`) so the merge treats concurrent same-name adds as distinct. */
  setItem(id: string, patch: Partial<TripItem>): void {
    const at = this.clock.now();
    const existing = this.trip.items.find((it) => it.id === id);
    const base: TripItem = existing ?? {
      id,
      name: id,
      category: 'Misc',
      quantity: 1,
      assigneeId: 'shared',
      packed: false,
      source: 'custom',
      addedAt: at,
      updatedAt: at,
    };
    const next = { ...base, ...patch, updatedAt: at };
    const items = existing
      ? this.trip.items.map((it) => (it.id === id ? next : it))
      : [...this.trip.items, next];
    this.trip = { ...this.trip, items, updatedAt: at };
  }

  delete(id: string): void {
    this.setItem(id, { deletedAt: this.clock.now() });
  }

  /** Receive a peer copy: fold its clock in, then merge (engine's data path). */
  receive(remote: Trip): void {
    let max = Math.max(remote.updatedAt, remote.nameUpdatedAt);
    for (const it of remote.items) {
      max = Math.max(max, it.updatedAt, it.addedAt, it.deletedAt ?? 0);
    }
    this.clock.observe(max);
    this.trip = mergeTrip(this.trip, remote);
  }

  qty(id: string): number | 'GONE' {
    const it = this.trip.items.find((x) => x.id === id && x.deletedAt == null);
    return it ? it.quantity : 'GONE';
  }
}

beforeEach(() => {
  real = T0;
});

test('a fresh edit beats a stale edit from the fast phone (no more lost edits)', () => {
  const fast = new Device('fast', HOUR); // wife's-fast-phone analogue
  const ok = new Device('ok', 0);

  // Both already share "socks x1" (it propagated once, so same id).
  fast.setItem('socks', { quantity: 1 });
  ok.receive(fast.trip); // ok now has socks, clock lifted past fast's stamp
  expect(ok.qty('socks')).toBe(1);

  // A minute later, the correct-clock phone corrects it to x2.
  real += 60_000;
  ok.setItem('socks', { quantity: 2 });

  // Exchange. The correction wins on BOTH — it was the last action in causal
  // order, even though the other phone's wall clock is an hour ahead.
  fast.receive(ok.trip);
  expect(ok.qty('socks')).toBe(2);
  expect(fast.qty('socks')).toBe(2);
});

test('a re-added item stays put — no disappear/reappear flapping', () => {
  const fast = new Device('fast', HOUR);
  const ok = new Device('ok', 0);

  fast.setItem('socks', { quantity: 1 });
  ok.receive(fast.trip);

  // Fast phone deletes socks; the other phone receives the delete → it vanishes.
  fast.delete('socks');
  ok.receive(fast.trip);
  expect(ok.qty('socks')).toBe('GONE');

  // The user puts socks back. With the logical clock the re-add out-clocks the
  // stale fast-phone delete, so it sticks immediately instead of re-vanishing.
  real += 120_000;
  ok.setItem('socks', { quantity: 1, deletedAt: undefined });
  fast.receive(ok.trip);
  expect(ok.qty('socks')).toBe(1);
  expect(fast.qty('socks')).toBe(1);
});

test('independent items from both devices both survive a merge', () => {
  const a = new Device('a', HOUR);
  const b = new Device('b', 0);
  a.setItem('passport', { quantity: 1 });
  b.setItem('charger', { quantity: 2 });
  // Full round trip.
  b.receive(a.trip);
  a.receive(b.trip);
  for (const d of [a, b]) {
    expect(d.qty('passport')).toBe(1);
    expect(d.qty('charger')).toBe(2);
  }
});
