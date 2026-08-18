/**
 * The shared-trip merge is the trust core — these tests pin the CRDT
 * properties canon § Backup & restore #5 promises. A bug here silently loses
 * or resurrects a travelling party's packing items across devices, so we test
 * the real LWW-element-set-with-tombstones semantics, not a happy path:
 *
 *   • newer edit wins over older edit (last-write-wins by clock)
 *   • a tombstone out-clocks an older edit (delete wins) BUT a genuinely newer
 *     edit out-clocks an older tombstone (resurrection only when legitimately
 *     newer — a re-added item)
 *   • commutative: merge(a,b) ≡ merge(b,a)  (best-effort transport can reorder)
 *   • idempotent: merge(a,a) ≡ a            (re-publishing must not drift)
 *   • associative-ish: concurrent disjoint adds both survive
 *   • empty / one-sided merges
 *   • the optional `combine` hook (packing's packed-clock fold rides it)
 *
 * `mergeRecordSet.ts` is an overwrite-synced shared-sync module file — the
 * SAME bytes grocery-list and split-expenses run — so the generic sections
 * below are the port of grocery-list's `mergeRecordSet.test.ts` (the fleet
 * exemplar). The final sections cover packing-list's own wrapper, `mergeTrip`.
 * The whole-app CRDT behaviour over many rounds is exercised separately by
 * `syncSim.test.ts` / `skewMerge.test.ts`; this file pins the primitives those
 * simulations sit on.
 *
 * mergeRecordSet returns an array in undefined order, so every comparison
 * sorts by id first.
 */

import { mergeRecordSet, type Record } from '../mergeRecordSet';
import { mergeTrip } from '../merge';
import {
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  type Trip,
  type TripItem,
} from '../../data/trip';

// A minimal record satisfying the merge contract. Real timestamps (ms epoch).
type Rec = Record & { name?: string; packed?: boolean };

const T0 = 1_700_000_000_000; // a real ms-epoch baseline
const rec = (id: string, updatedAt: number, extra: Partial<Rec> = {}): Rec => ({
  id,
  updatedAt,
  ...extra,
});
const tomb = (id: string, updatedAt: number, deletedAt: number, extra: Partial<Rec> = {}): Rec =>
  ({ id, updatedAt, deletedAt, ...extra });

const byId = <T extends Record>(xs: T[]): T[] =>
  [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Deep-equal-after-sort, the only meaningful equality for an unordered set. */
const sameSet = <T extends Record>(a: T[], b: T[]) =>
  expect(byId(a)).toEqual(byId(b));

const get = <T extends Record>(xs: T[], id: string): T | undefined =>
  xs.find((r) => r.id === id);

// ---------------------------------------------------------------------------
// Last-write-wins by clock
// ---------------------------------------------------------------------------

describe('mergeRecordSet — last-write-wins by clock', () => {
  it('the newer edit wins over the older edit, regardless of side', () => {
    const old = rec('x', T0, { name: 'Socks' });
    const fresh = rec('x', T0 + 1000, { name: 'Wool socks' });

    expect(get(mergeRecordSet([old], [fresh]), 'x')).toEqual(fresh);
    // and the other way round — the newer one still wins
    expect(get(mergeRecordSet([fresh], [old]), 'x')).toEqual(fresh);
  });

  it('on an exact updatedAt tie between two live edits, BOTH merge orders pick the same copy', () => {
    const left = rec('x', T0, { name: 'A' });
    const right = rec('x', T0, { name: 'B' });
    // The contract: a tie between two live edits resolves by CONTENT (stable
    // key-sorted serialization), identically on every device. The old
    // "keep whichever copy is local" rule meant two phones that stamped the
    // same millisecond each kept their own copy — divergent forever.
    const ab = get(mergeRecordSet([left], [right]), 'x');
    const ba = get(mergeRecordSet([right], [left]), 'x');
    expect(ab).toEqual(ba);
    expect([left, right]).toContainEqual(ab);
  });
});

// ---------------------------------------------------------------------------
// Tombstones — delete wins, resurrection only when legitimately newer
// ---------------------------------------------------------------------------

describe('mergeRecordSet — tombstone (deletion) semantics', () => {
  it('a tombstone beats an OLDER live edit (delete wins — the item stays gone)', () => {
    const edit = rec('x', T0, { name: 'Passport' });
    const deletion = tomb('x', T0, T0 + 5000); // deleted after the edit
    const out = get(mergeRecordSet([edit], [deletion]), 'x');
    expect(out?.deletedAt).toBe(T0 + 5000);
    sameSet(mergeRecordSet([edit], [deletion]), mergeRecordSet([deletion], [edit]));
  });

  it("a tombstone's clock is max(updatedAt, deletedAt) — a stale-updatedAt delete still out-clocks the edit", () => {
    // The delete was authored with an old updatedAt but a fresh deletedAt;
    // the effective clock must be the deletedAt, so the delete wins.
    const edit = rec('x', T0 + 2000, { name: 'Passport' });
    const deletion = tomb('x', T0, T0 + 9000);
    expect(get(mergeRecordSet([edit], [deletion]), 'x')?.deletedAt).toBe(T0 + 9000);
  });

  it('a genuinely NEWER edit beats an older tombstone (legit resurrection / re-add)', () => {
    const deletion = tomb('x', T0, T0 + 1000);
    const readd = rec('x', T0 + 5000, { name: 'Passport (again)' }); // re-added later
    const out = get(mergeRecordSet([deletion], [readd]), 'x');
    expect(out).toEqual(readd);
    expect(out?.deletedAt).toBeUndefined();
    // commutative
    sameSet(mergeRecordSet([deletion], [readd]), mergeRecordSet([readd], [deletion]));
  });

  it('an OLDER edit can NEVER resurrect a newer tombstone (no accidental zombie)', () => {
    const staleEdit = rec('x', T0, { name: 'Passport' });
    const deletion = tomb('x', T0 + 1000, T0 + 8000);
    expect(get(mergeRecordSet([deletion], [staleEdit]), 'x')?.deletedAt).toBe(T0 + 8000);
    expect(get(mergeRecordSet([staleEdit], [deletion]), 'x')?.deletedAt).toBe(T0 + 8000);
  });

  it('on an exact clock tie, a delete beats a live edit (safe convergence, both sides)', () => {
    const edit = rec('x', T0 + 3000, { name: 'Passport' });
    // deletedAt chosen so clock(deletion) === clock(edit) === T0 + 3000
    const deletion = tomb('x', T0, T0 + 3000);
    expect(get(mergeRecordSet([edit], [deletion]), 'x')?.deletedAt).toBe(T0 + 3000);
    expect(get(mergeRecordSet([deletion], [edit]), 'x')?.deletedAt).toBe(T0 + 3000);
  });

  it('the newer of two competing tombstones wins (re-delete after a re-add)', () => {
    const firstDelete = tomb('x', T0, T0 + 1000);
    const secondDelete = tomb('x', T0 + 4000, T0 + 5000);
    expect(get(mergeRecordSet([firstDelete], [secondDelete]), 'x')?.deletedAt).toBe(T0 + 5000);
    expect(get(mergeRecordSet([secondDelete], [firstDelete]), 'x')?.deletedAt).toBe(T0 + 5000);
  });
});

// ---------------------------------------------------------------------------
// Concurrent disjoint edits — nothing is lost
// ---------------------------------------------------------------------------

describe('mergeRecordSet — concurrent disjoint changes both survive', () => {
  it('two devices each add a different item offline; the merge keeps both', () => {
    const a = [rec('socks', T0, { name: 'Socks' })];
    const b = [rec('charger', T0 + 100, { name: 'Charger' })];
    const out = mergeRecordSet(a, b);
    expect(out).toHaveLength(2);
    expect(get(out, 'socks')?.name).toBe('Socks');
    expect(get(out, 'charger')?.name).toBe('Charger');
  });

  it('a per-record merge — one device edits item A, the other deletes item B; both intents land', () => {
    const base = [rec('A', T0, { name: 'A0' }), rec('B', T0, { name: 'B0' })];
    const deviceA = [rec('A', T0 + 1000, { name: 'A-edited' }), base[1]];
    const deviceB = [base[0], tomb('B', T0, T0 + 1000)];
    const out = mergeRecordSet(deviceA, deviceB);
    expect(get(out, 'A')?.name).toBe('A-edited'); // A's edit survived
    expect(get(out, 'B')?.deletedAt).toBe(T0 + 1000); // B's delete survived
  });
});

// ---------------------------------------------------------------------------
// Algebraic laws: commutativity, idempotency
// ---------------------------------------------------------------------------

describe('mergeRecordSet — CRDT algebraic laws', () => {
  // A rich, mixed pair: shared ids with different clocks, tombstones on each
  // side, and disjoint ids — the kind of state two real devices reach.
  const a: Rec[] = [
    rec('shared-newer-on-a', T0 + 9000, { name: 'A wins' }),
    rec('shared-newer-on-b', T0, { name: 'A loses' }),
    tomb('deleted-on-a', T0, T0 + 7000),
    rec('only-on-a', T0 + 200, { name: 'solo A' }),
    rec('readd-on-a', T0 + 6000, { name: 'A re-added' }),
  ];
  const b: Rec[] = [
    rec('shared-newer-on-a', T0, { name: 'B loses' }),
    rec('shared-newer-on-b', T0 + 9000, { name: 'B wins' }),
    rec('deleted-on-a', T0, { name: 'still live on B' }),
    rec('only-on-b', T0 + 300, { name: 'solo B' }),
    tomb('readd-on-a', T0, T0 + 1000),
  ];

  it('is commutative: merge(a,b) deep-equals merge(b,a)', () => {
    sameSet(mergeRecordSet(a, b), mergeRecordSet(b, a));
  });

  it('is idempotent: merge(a,a) deep-equals a (re-publishing the same state does not drift)', () => {
    sameSet(mergeRecordSet(a, a), a);
  });

  it('produces the correct converged state on the mixed pair (no winner is wrong)', () => {
    const out = mergeRecordSet(a, b);
    expect(get(out, 'shared-newer-on-a')?.name).toBe('A wins');
    expect(get(out, 'shared-newer-on-b')?.name).toBe('B wins');
    expect(get(out, 'deleted-on-a')?.deletedAt).toBe(T0 + 7000); // delete (newer) beats live B
    expect(get(out, 'only-on-a')?.name).toBe('solo A');
    expect(get(out, 'only-on-b')?.name).toBe('solo B');
    expect(get(out, 'readd-on-a')?.name).toBe('A re-added'); // re-add (T0+6000) beats tomb (T0+1000)
    expect(get(out, 'readd-on-a')?.deletedAt).toBeUndefined();
    expect(out).toHaveLength(6);
  });

  it('re-merging the converged state against either parent is a fixed point', () => {
    const merged = mergeRecordSet(a, b);
    sameSet(mergeRecordSet(merged, a), merged);
    sameSet(mergeRecordSet(merged, b), merged);
    sameSet(mergeRecordSet(merged, merged), merged);
  });
});

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------

describe('mergeRecordSet — empty and one-sided', () => {
  it('merging into empty returns the other side', () => {
    const xs = [rec('a', T0), rec('b', T0 + 1)];
    sameSet(mergeRecordSet([], xs), xs);
    sameSet(mergeRecordSet(xs, []), xs);
  });

  it('merging two empty sets is empty', () => {
    expect(mergeRecordSet([], [])).toEqual([]);
  });

  it('a lone tombstone survives a merge against empty (a delete is real state, not nothing)', () => {
    const t = [tomb('gone', T0, T0 + 1)];
    sameSet(mergeRecordSet([], t), t);
  });
});

// ---------------------------------------------------------------------------
// Tie-break determinism — two copies stamping the same millisecond must
// converge to ONE copy on every device, whatever shape the copies are in.
// These pin the winner()/stableStringify()/shallowEqual() semantics.
// ---------------------------------------------------------------------------

describe('mergeRecordSet — tie-break determinism', () => {
  /** Merge one-record sets both ways; every assertion must hold on each. */
  const winners = (a: Rec, b: Rec): Rec[] => [
    get(mergeRecordSet([a], [b]), a.id)!,
    get(mergeRecordSet([b], [a]), a.id)!,
  ];

  it('a live tie resolves to the greater serialized content, from both sides', () => {
    const smaller = rec('x', T0, { name: 'A' });
    const greater = rec('x', T0, { name: 'B' });
    for (const w of winners(smaller, greater)) expect(w.name).toBe('B');
  });

  it('object key INSERTION order never influences which copy wins a tie', () => {
    // The same logical record can reach the merge with different key orders
    // (built in memory vs hydrated from JSON). The tie-break must compare
    // content, not key order: z:9 beats z:2 regardless of construction.
    const idFirst = { id: 'x', updatedAt: T0, z: 9 } as Rec & { z: number };
    const zFirst = { z: 2, id: 'x', updatedAt: T0 } as Rec & { z: number };
    for (const w of winners(idFirst, zFirst)) expect((w as unknown as { z: number }).z).toBe(9);
  });

  it('an explicitly-undefined key serializes like an absent key (what the JSON wire drops)', () => {
    const withUndef = { id: 'x', updatedAt: T0, aaa: undefined, z: 9 } as Rec & { z: number };
    const plain = { id: 'x', updatedAt: T0, z: 2 } as Rec & { z: number };
    for (const w of winners(withUndef, plain)) expect((w as unknown as { z: number }).z).toBe(9);
  });

  it('null-valued fields serialize safely and the tie still converges', () => {
    const a = rec('x', T0, { name: 'A', note: null } as unknown as Partial<Rec>);
    const b = rec('x', T0, { name: 'B', note: null } as unknown as Partial<Rec>);
    for (const w of winners(a, b)) expect(w.name).toBe('B');
  });

  it('array-valued fields compare by content and the tie converges to the same copy', () => {
    const a = { id: 'x', updatedAt: T0, tags: ['b'] } as Rec & { tags: string[] };
    const b = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    for (const w of winners(a, b)) expect((w as unknown as { tags: string[] }).tags).toEqual(['b']);
  });

  it("sparse array slots serialize as the wire's null, so both devices compare the same content", () => {
    // JSON.stringify([undefined, 2]) is '[null,2]' — a record that crossed the
    // wire and one still in memory must serialize identically, or the tie-break
    // would order them differently on the two devices.
    const inMemory = { id: 'x', updatedAt: T0, tags: [undefined, 2] } as Rec & { tags: unknown[] };
    const other = { id: 'x', updatedAt: T0, tags: [9] } as Rec & { tags: unknown[] };
    const ab = get(mergeRecordSet([inMemory], [other]), 'x');
    const ba = get(mergeRecordSet([other], [inMemory]), 'x');
    expect(ab).toEqual(ba);
    // '[null,2]' > '[9]' ('n' > '9') — the wire-form comparison decides.
    expect((ab as unknown as { tags: unknown[] }).tags).toEqual([undefined, 2]);
  });

  it('a tie against a copy MISSING a field still converges (both directions, either side lean)', () => {
    // shallow-equality must not mistake {id,updatedAt} for {id,updatedAt,name}
    // in either direction — a false "equal" would let each device keep its own
    // copy on a tie and diverge forever.
    const full = rec('x', T0, { name: 'M' });
    const lean = rec('x', T0);
    const [ab1, ba1] = winners(full, lean);
    expect(ab1).toEqual(ba1);
    const [ab2, ba2] = winners(lean, full);
    expect(ab2).toEqual(ba2);
  });

  it('a value-equal remote copy never replaces the local object (memo stability)', () => {
    // Value-equal but not reference-equal (nested array forces the deep path).
    const local = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    const remote = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    expect(get(mergeRecordSet([local], [remote]), 'x')).toBe(local);
    // Same contract between two value-equal tombstones.
    const localDead = { id: 'y', updatedAt: T0, deletedAt: T0 + 1, tags: ['a'] } as Rec & { tags: string[] };
    const remoteDead = { id: 'y', updatedAt: T0, deletedAt: T0 + 1, tags: ['a'] } as Rec & { tags: string[] };
    expect(get(mergeRecordSet([localDead], [remoteDead]), 'y')).toBe(localDead);
  });

  it('between two tied tombstones the LEANER payload wins (the size bound must propagate)', () => {
    // A payload-stripped tombstone must beat a fatter copy even when the fat
    // copy would win a plain content comparison. This is what makes
    // `pruneTombstones`' strip actually shrink the published payload swarm-wide.
    const fat = tomb('x', T0, T0 + 5, { name: 'Sunscreen!' });
    const leanDead = tomb('x', T0, T0 + 5, { name: 'Su' });
    for (const w of winners(fat, leanDead)) expect(w.name).toBe('Su');
  });

  it('live ties do NOT use the leaner rule — content decides even when longer', () => {
    const longLive = rec('x', T0, { name: 'Sunscreen!' });
    const shortLive = rec('x', T0, { name: 'Su' });
    for (const w of winners(longLive, shortLive)) expect(w.name).toBe('Sunscreen!');
  });

  it('two tied tombstones of EQUAL size converge to the greater content', () => {
    const aa = tomb('x', T0, T0 + 5, { name: 'AA' });
    const zz = tomb('x', T0, T0 + 5, { name: 'ZZ' });
    for (const w of winners(aa, zz)) expect(w.name).toBe('ZZ');
  });
});

// ---------------------------------------------------------------------------
// The optional `combine` hook — how an app folds a field that carries its OWN
// clock into the record winner. packing-list rides this for `packed`
// (merge.ts § combineItems), so the hook's contract is load-bearing here.
// ---------------------------------------------------------------------------

describe('mergeRecordSet — the combine hook', () => {
  it('runs for every id present on BOTH sides, with (winner, loser) in that order', () => {
    const calls: Array<[string, string]> = [];
    const local = [rec('x', T0 + 1000, { name: 'local-newer' }), rec('only-local', T0)];
    const remote = [rec('x', T0, { name: 'remote-older' }), rec('only-remote', T0)];

    mergeRecordSet(local, remote, (win, lose) => {
      calls.push([win.name ?? '', lose.name ?? '']);
      return win;
    });

    expect(calls).toEqual([['local-newer', 'remote-older']]);
  });

  it('never runs for a record only one side has (nothing to fold in)', () => {
    const combine = jest.fn((win: Rec) => win);
    mergeRecordSet([rec('a', T0)], [rec('b', T0)], combine);
    expect(combine).not.toHaveBeenCalled();
  });

  it('its return value is what lands in the merged set (the fold is honoured)', () => {
    const local = [rec('x', T0 + 1000, { name: 'kept', packed: false })];
    const remote = [rec('x', T0, { name: 'dropped', packed: true })];
    // The shape of packing's real hook: content from the winner, the
    // field-clocked flag from whichever copy toggled it last.
    const out = mergeRecordSet(local, remote, (win, lose) => ({ ...win, packed: lose.packed }));
    expect(get(out, 'x')).toEqual({ id: 'x', updatedAt: T0 + 1000, name: 'kept', packed: true });
  });

  it('runs even when the winner is a tombstone, so a field clock can ride through a dead record', () => {
    const seen: boolean[] = [];
    const deadWinner = [tomb('x', T0, T0 + 9000, { packed: false })];
    const liveLoser = [rec('x', T0, { packed: true })];
    mergeRecordSet(deadWinner, liveLoser, (win, lose) => {
      seen.push(!!lose.packed);
      return win;
    });
    expect(seen).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// The app-specific wrapper: mergeTrip (trip-level fields + delegated item
// merge). The multi-round / skew behaviour lives in syncSim + skewMerge; this
// pins the single-merge field resolution those simulations assume.
// ---------------------------------------------------------------------------

function baseTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: 'local-id',
    name: 'Base',
    nameUpdatedAt: T0,
    duration: 3,
    typeIds: [],
    packers: [{ id: 'me', name: 'Me' }],
    items: [],
    canDoLaundry: false,
    laundryIntervalDays: LAUNDRY_DEFAULT_INTERVAL,
    thoroughness: THOROUGHNESS_DEFAULT,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** A live custom item. Names are unique per id in these cases so the
 *  duplicate-name collapse (covered by its own path in merge.ts) never fires
 *  and the id-keyed record merge is what is under test. */
function tripItem(id: string, updatedAt: number, over: Partial<TripItem> = {}): TripItem {
  return {
    id,
    name: id,
    category: 'Clothing',
    quantity: 1,
    assigneeId: 'shared',
    packed: false,
    source: 'custom',
    addedAt: updatedAt,
    updatedAt,
    ...over,
  };
}

describe('mergeTrip — packing-list wrapper', () => {
  it('delegates item-set merge to mergeRecordSet (per-item, with tombstones)', () => {
    const local = baseTrip({
      updatedAt: T0,
      items: [tripItem('socks', T0), tripItem('passport', T0)],
    });
    const remote = baseTrip({
      id: 'remote-id',
      updatedAt: T0 + 1,
      items: [
        tripItem('socks', T0 + 1000, { quantity: 6 }), // newer edit
        { ...tripItem('passport', T0), deletedAt: T0 + 2000 }, // deleted on remote
        tripItem('charger', T0 + 50), // added on remote
      ],
    });
    const out = mergeTrip(local, remote);
    const m = (id: string) => out.items.find((i) => i.id === id);
    expect(m('socks')?.quantity).toBe(6); // newer edit won
    expect(m('passport')?.deletedAt).toBe(T0 + 2000); // tombstone kept
    expect(m('charger')).toBeDefined(); // disjoint add survived
    expect(out.items).toHaveLength(3);
  });

  it('keeps the LOCAL id (devices have independent local ids)', () => {
    const local = baseTrip({ id: 'local-id', updatedAt: T0 });
    const remote = baseTrip({ id: 'remote-id', updatedAt: T0 + 1000 });
    expect(mergeTrip(local, remote).id).toBe('local-id');
  });

  it('trip configuration follows the whole-trip updatedAt; createdAt=min, updatedAt=max', () => {
    const local = baseTrip({
      updatedAt: T0,
      createdAt: T0 - 5000,
      duration: 3,
      typeIds: ['beach'],
      packers: [{ id: 'me', name: 'Me' }],
    });
    const remote = baseTrip({
      id: 'r',
      updatedAt: T0 + 9000,
      createdAt: T0,
      duration: 10,
      typeIds: ['beach', 'hiking'],
      packers: [
        { id: 'me', name: 'Me' },
        { id: 'p-sam', name: 'Sam' },
      ],
    });
    const out = mergeTrip(local, remote);
    expect(out.duration).toBe(10); // remote newer → its head wins
    expect(out.typeIds).toEqual(['beach', 'hiking']);
    expect(out.packers.map((p) => p.id)).toEqual(['me', 'p-sam']);
    expect(out.createdAt).toBe(T0 - 5000); // earliest creation
    expect(out.updatedAt).toBe(T0 + 9000); // latest touch
  });

  it('a strictly NEWER local updatedAt wins the trip configuration (not only the remote side)', () => {
    const local = baseTrip({ updatedAt: T0 + 9000, duration: 12 });
    const remote = baseTrip({ id: 'r', updatedAt: T0, duration: 2 });
    expect(mergeTrip(local, remote).duration).toBe(12);
  });

  it('an exact updatedAt tie converges to ONE configuration on both devices', () => {
    // Two edits in the same millisecond: "keep local" would leave the two
    // phones on different durations forever, so the tie resolves by the greater
    // serialized head — the same answer computed independently on each device.
    const a = baseTrip({ updatedAt: T0, duration: 4 });
    const b = baseTrip({ id: 'r', updatedAt: T0, duration: 9 });
    expect(mergeTrip(a, b).duration).toBe(mergeTrip(b, a).duration);
  });

  it('adopts a shareIdentity from whichever side has one (pairing must propagate)', () => {
    const ident = { secret: 's3cr3t-aaaaaaaaaaaaaaaa', createdAt: T0 };
    const local = baseTrip({ updatedAt: T0, shareIdentity: undefined });
    const remote = baseTrip({ id: 'r', updatedAt: T0 + 1, shareIdentity: ident });
    expect(mergeTrip(local, remote).shareIdentity).toEqual(ident);
    // and the symmetric case — local has it, remote doesn't
    const local2 = baseTrip({ updatedAt: T0 + 1, shareIdentity: ident });
    const remote2 = baseTrip({ id: 'r', updatedAt: T0, shareIdentity: undefined });
    expect(mergeTrip(local2, remote2).shareIdentity).toEqual(ident);
  });

  it('the item merge inside mergeTrip is commutative on the converged item set', () => {
    const local = baseTrip({
      updatedAt: T0,
      items: [tripItem('a', T0 + 5), { ...tripItem('b', T0), deletedAt: T0 + 9 }],
    });
    const remote = baseTrip({
      id: 'r',
      updatedAt: T0,
      items: [tripItem('a', T0), tripItem('c', T0 + 3)],
    });
    const ab = byId(mergeTrip(local, remote).items);
    const ba = byId(mergeTrip(remote, local).items);
    expect(ab).toEqual(ba);
  });

  it('is idempotent: merging a converged trip against either parent changes nothing', () => {
    const local = baseTrip({ updatedAt: T0, items: [tripItem('a', T0 + 5)] });
    const remote = baseTrip({ id: 'r', updatedAt: T0 + 1, items: [tripItem('b', T0 + 6)] });
    const merged = mergeTrip(local, remote);
    expect(byId(mergeTrip(merged, local).items)).toEqual(byId(merged.items));
    expect(byId(mergeTrip(merged, remote).items)).toEqual(byId(merged.items));
    expect(mergeTrip(merged, merged).updatedAt).toBe(merged.updatedAt);
  });
});

// ---------------------------------------------------------------------------
// The name merges on its OWN clock (nameUpdatedAt), not the trip's updatedAt.
// Regression cover for the "joining renamed my trip to 'Shared trip'" bug: the
// name must survive a partner joining and survive everyday item edits, and
// only ever change when someone actually renames the trip.
// ---------------------------------------------------------------------------

describe('mergeTrip — the name only changes on an explicit rename', () => {
  it("a freshly-joined device (placeholder name, nameUpdatedAt:0) never renames the creator's trip", () => {
    // The creator's trip — named "Greece" at creation.
    const creator = baseTrip({
      name: 'Greece',
      nameUpdatedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    // The joiner's placeholder: created later (so a NAIVE whole-trip LWW would
    // let it win), but its name clock is 0 because the joiner never named it —
    // exactly what store.joinShared() mints.
    const joinerPlaceholder = baseTrip({
      id: 'joiner',
      name: 'Shared trip',
      nameUpdatedAt: 0,
      createdAt: T0 + 60_000,
      updatedAt: T0 + 60_000,
    });

    // On the creator's device: merge the joiner's copy in.
    expect(mergeTrip(creator, joinerPlaceholder).name).toBe('Greece');
    // On the joiner's device: it adopts the creator's real name.
    expect(mergeTrip(joinerPlaceholder, creator).name).toBe('Greece');
  });

  it('adding/packing items (which bump updatedAt) does NOT change the name', () => {
    // Creator named it at T0; then both sides keep editing items for a week,
    // pushing updatedAt far past the name clock. The name must stay put.
    const creator = baseTrip({
      name: 'Greece',
      nameUpdatedAt: T0,
      updatedAt: T0 + 999_999, // lots of item activity since the name was set
    });
    const partner = baseTrip({
      id: 'p',
      name: 'Shared trip', // partner's stale placeholder
      nameUpdatedAt: 0,
      updatedAt: T0 + 1_000_000, // partner edited an item most recently
    });
    expect(mergeTrip(creator, partner).name).toBe('Greece');
    expect(mergeTrip(partner, creator).name).toBe('Greece');
  });

  it('an explicit rename (newer nameUpdatedAt) wins on every device, either side', () => {
    const renamed = baseTrip({ name: 'Crete week', nameUpdatedAt: T0 + 5000 });
    const stale = baseTrip({ id: 'r', name: 'Greece', nameUpdatedAt: T0 });
    expect(mergeTrip(renamed, stale).name).toBe('Crete week');
    expect(mergeTrip(stale, renamed).name).toBe('Crete week');
  });

  it('carries the winning name clock forward so a re-merge is a fixed point (converges)', () => {
    const a = baseTrip({ name: 'Greece', nameUpdatedAt: T0, updatedAt: T0 });
    const b = baseTrip({ id: 'b', name: 'Shared trip', nameUpdatedAt: 0, updatedAt: T0 + 9 });
    const m = mergeTrip(a, b);
    expect(m.name).toBe('Greece');
    expect(m.nameUpdatedAt).toBe(T0); // max of the two name clocks
    // Re-merging either parent in does not flip the name.
    expect(mergeTrip(m, b).name).toBe('Greece');
    expect(mergeTrip(b, m).name).toBe('Greece');
  });

  it('a name-clock tie converges to the lexicographically greater name on both devices', () => {
    const alps = baseTrip({ name: 'Alps', nameUpdatedAt: T0 });
    const zermatt = baseTrip({ id: 'r', name: 'Zermatt', nameUpdatedAt: T0 });
    expect(mergeTrip(alps, zermatt).name).toBe('Zermatt');
    expect(mergeTrip(zermatt, alps).name).toBe('Zermatt');
  });

  it('falls back to createdAt for legacy trips persisted before nameUpdatedAt existed', () => {
    // Simulate a pre-migration pair: neither carries an explicit name clock.
    const older = baseTrip({ name: 'Greece', createdAt: T0, updatedAt: T0 + 100 });
    const newer = baseTrip({ name: 'Greece', id: 'r', createdAt: T0 + 1, updatedAt: T0 });
    delete (older as Partial<Trip>).nameUpdatedAt;
    delete (newer as Partial<Trip>).nameUpdatedAt;
    // Both fall back to createdAt; the later-created side's name clock wins —
    // and since both are 'Greece' here, the result is stable either way.
    expect(mergeTrip(older, newer).name).toBe('Greece');
    expect(mergeTrip(newer, older).name).toBe('Greece');
  });
});

// ---------------------------------------------------------------------------
// KNOWN-EQUIVALENT MUTANTS (mutation sweep record — do not chase these).
//
// mergeRecordSet.ts is the byte-identical shared-sync module grocery-list
// runs, and its survivors carry `Stryker disable` pragmas in the source with
// the full argument. In short: the `ca > cb` / `sa.length < sb.length`
// comparisons are guard-shadowed by the `!==` test above them; every
// shallowEqual weakening only disables a fast path (the slow path computes the
// same winner); and the stableStringify join-separator / array-form variants
// decorate BOTH compared serializations identically, so the `sa >= sb` verdict
// never flips. Killing any of them would need a tautological test written
// backwards from the mutation. See grocery-list's mergeRecordSet.test.ts for
// the long-form argument (verified there 2026-08-13).
// ---------------------------------------------------------------------------
