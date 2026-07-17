/**
 * Transfer layer — direct trust-core unit tests (mutation-survivor kill pass).
 *
 * The intent fuzzer (src/store/__tests__/intentFuzz.test.ts) proves the happy
 * round-trip; these tests pin down the REJECTION truth tables the 2026-07-05
 * mutation run showed were unobserved: every type guard's false case (each
 * field must FAIL validation on a wrong-typed value, one field at a time), the
 * four parseTransfer error paths with their EXACT user-facing messages (a
 * mutant that blanks a message must die — .message is surfaced directly in an
 * Alert), the lenient trip-info defaults, and mergeImported's collision
 * behavior (fresh 't'-prefixed id + " (imported)" rename).
 *
 * All invalid payloads are built as JSON text (parseTransfer's real input
 * domain). Non-finite numbers are spliced in as raw `1e999` (JSON.parse →
 * Infinity) since JSON.stringify can't emit them.
 */

import {
  serializeTrips,
  parseTransfer,
  mergeImported,
  TransferError,
  TRANSFER_SCHEMA,
} from '../transfer';
import {
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  type Trip,
  type TripItem,
  type Packer,
} from '../../data/trip';

const DAMAGED = "This export is damaged and can't be imported.";
const NOT_EXPORT = "This file isn't a Packing List export.";
const NEWER =
  'This backup was made by a newer version of the app. Update Packing List and try again.';
const NO_TRIPS = "This export doesn't contain any trips.";

// ---------------------------------------------------------------------------
// Builders — a fully valid envelope, then break exactly one thing per test.
// ---------------------------------------------------------------------------

const packer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  name: 'Sam',
  ...over,
});

const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'i1',
  name: 'Socks',
  category: 'Clothing',
  quantity: 2,
  assigneeId: 'shared',
  packed: false,
  source: 'generated',
  ...over,
});

const trip = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'trip-1',
  name: 'Beach',
  duration: 5,
  typeIds: ['essentials', 'beach'],
  packers: [packer()],
  items: [item()],
  canDoLaundry: true,
  laundryIntervalDays: 3,
  thoroughness: 'thorough',
  nameUpdatedAt: 1500,
  createdAt: 1000,
  updatedAt: 2000,
  ...over,
});

function envelopeText(trips: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: 'packing-list',
    schema: TRANSFER_SCHEMA,
    exportedAt: 123,
    trips,
    ...over,
  });
}

/** Assert parseTransfer rejects with a TransferError carrying EXACTLY msg. */
function expectRejects(text: string, msg: string): void {
  let err: unknown;
  try {
    parseTransfer(text);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(TransferError);
  expect((err as Error).message).toBe(msg);
}

const rejectsDamaged = (text: string) => expectRejects(text, DAMAGED);

// ---------------------------------------------------------------------------
// parseTransfer — the four error paths, exact messages
// ---------------------------------------------------------------------------

describe('parseTransfer error paths', () => {
  it('rejects non-JSON text as not-an-export', () => {
    expectRejects('this is not json {', NOT_EXPORT);
  });

  it('rejects a JSON primitive envelope as not-an-export', () => {
    expectRejects('42', NOT_EXPORT);
  });

  it('rejects a JSON array envelope as not-an-export', () => {
    expectRejects('[]', NOT_EXPORT);
  });

  it('rejects a foreign app tag as not-an-export', () => {
    expectRejects(envelopeText([trip()], { app: 'grocery-list' }), NOT_EXPORT);
  });

  it('rejects a newer schema with the update-the-app message', () => {
    expectRejects(envelopeText([trip()], { schema: TRANSFER_SCHEMA + 1 }), NEWER);
  });

  it('rejects a non-numeric schema with the update-the-app message', () => {
    expectRejects(envelopeText([trip()], { schema: '1' }), NEWER);
  });

  it('accepts the current schema (the boundary is strictly greater-than)', () => {
    expect(parseTransfer(envelopeText([trip()], { schema: TRANSFER_SCHEMA }))).toHaveLength(1);
  });

  it('accepts an older schema', () => {
    expect(parseTransfer(envelopeText([trip()], { schema: 0 }))).toHaveLength(1);
  });

  it('rejects an empty trips array with the no-trips message', () => {
    expectRejects(envelopeText([]), NO_TRIPS);
  });

  it('rejects a missing / non-array trips field with the no-trips message', () => {
    expectRejects(envelopeText([], { trips: undefined }), NO_TRIPS);
    expectRejects(envelopeText([], { trips: 'nope' }), NO_TRIPS);
  });
});

// ---------------------------------------------------------------------------
// validateTrip — one broken field per test (guard truth table)
// ---------------------------------------------------------------------------

describe('validateTrip rejections', () => {
  it.each<[string, unknown]>([
    ['null trip', null],
    ['array trip', []],
    ['string trip', 'trip'],
    ['non-string id', trip({ id: 7 })],
    ['non-string name', trip({ name: 7 })],
    ['non-numeric duration', trip({ duration: '5' })],
    ['non-array typeIds', trip({ typeIds: 'essentials' })],
    ['typeIds with a non-string entry', trip({ typeIds: ['essentials', 7] })],
    ['non-array packers', trip({ packers: 'nope' })],
    ['non-array items', trip({ items: 'nope' })],
    ['non-numeric createdAt', trip({ createdAt: '1000' })],
    ['non-numeric updatedAt', trip({ updatedAt: '2000' })],
  ])('rejects %s as damaged', (_label, bad) => {
    rejectsDamaged(envelopeText([bad]));
  });

  it('rejects a non-finite duration (isNum requires finite)', () => {
    const text = envelopeText([trip()]).replace('"duration":5', '"duration":1e999');
    rejectsDamaged(text);
  });

  it('validates a full trip through to an exact canonical object', () => {
    const [t] = parseTransfer(envelopeText([trip()]));
    expect(t).toEqual({
      id: 'trip-1',
      name: 'Beach',
      duration: 5,
      typeIds: ['essentials', 'beach'],
      packers: [{ id: 'p1', name: 'Sam' }],
      items: [item()],
      canDoLaundry: true,
      laundryIntervalDays: 3,
      thoroughness: 'thorough',
      nameUpdatedAt: 1500,
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('defaults a missing/malformed nameUpdatedAt to createdAt (legacy exports)', () => {
    expect(parseTransfer(envelopeText([trip({ nameUpdatedAt: undefined })]))[0].nameUpdatedAt).toBe(1000);
    expect(parseTransfer(envelopeText([trip({ nameUpdatedAt: 'yesterday' })]))[0].nameUpdatedAt).toBe(1000);
  });
});

describe('validateTrip lenient trip-info defaults', () => {
  it.each<['minimalist' | 'normal' | 'thorough']>([['minimalist'], ['normal'], ['thorough']])(
    'preserves thoroughness %s exactly',
    (level) => {
      const [t] = parseTransfer(envelopeText([trip({ thoroughness: level })]));
      expect(t.thoroughness).toBe(level);
    }
  );

  it('defaults an unknown thoroughness to THOROUGHNESS_DEFAULT', () => {
    const [t] = parseTransfer(envelopeText([trip({ thoroughness: 'extreme' })]));
    expect(t.thoroughness).toBe(THOROUGHNESS_DEFAULT);
  });

  it('defaults a missing thoroughness to THOROUGHNESS_DEFAULT', () => {
    const [t] = parseTransfer(envelopeText([trip({ thoroughness: undefined })]));
    expect(t.thoroughness).toBe(THOROUGHNESS_DEFAULT);
  });

  it('preserves canDoLaundry true and false', () => {
    expect(parseTransfer(envelopeText([trip({ canDoLaundry: true })]))[0].canDoLaundry).toBe(true);
    expect(parseTransfer(envelopeText([trip({ canDoLaundry: false })]))[0].canDoLaundry).toBe(false);
  });

  it('defaults a missing or malformed canDoLaundry to false — never true', () => {
    expect(parseTransfer(envelopeText([trip({ canDoLaundry: undefined })]))[0].canDoLaundry).toBe(false);
    expect(parseTransfer(envelopeText([trip({ canDoLaundry: 'yes' })]))[0].canDoLaundry).toBe(false);
  });

  it('preserves a numeric laundryIntervalDays, defaults a missing/malformed one', () => {
    expect(parseTransfer(envelopeText([trip({ laundryIntervalDays: 7 })]))[0].laundryIntervalDays).toBe(7);
    expect(
      parseTransfer(envelopeText([trip({ laundryIntervalDays: undefined })]))[0].laundryIntervalDays
    ).toBe(LAUNDRY_DEFAULT_INTERVAL);
    expect(
      parseTransfer(envelopeText([trip({ laundryIntervalDays: 'weekly' })]))[0].laundryIntervalDays
    ).toBe(LAUNDRY_DEFAULT_INTERVAL);
  });
});

// ---------------------------------------------------------------------------
// validatePacker — guard truth table
// ---------------------------------------------------------------------------

describe('validatePacker rejections', () => {
  it.each<[string, unknown]>([
    ['null packer', null],
    ['string packer', 'Sam'],
    ['missing id', { name: 'Sam' }],
    ['non-string id', packer({ id: 7 })],
    ['non-string name', packer({ name: 7 })],
  ])('rejects %s as damaged', (_label, bad) => {
    rejectsDamaged(envelopeText([trip({ packers: [bad] })]));
  });

  it('rebuilds a valid packer to exactly { id, name }', () => {
    const [t] = parseTransfer(
      envelopeText([trip({ packers: [packer({ extra: 'dropped' })] })])
    );
    expect(t.packers).toEqual([{ id: 'p1', name: 'Sam' }]);
  });
});

// ---------------------------------------------------------------------------
// validateItem — guard truth table, one field at a time
// ---------------------------------------------------------------------------

describe('validateItem rejections', () => {
  it.each<[string, unknown]>([
    ['null item', null],
    ['string item', 'Socks'],
    ['non-string id', item({ id: 7 })],
    ['non-string name', item({ name: 7 })],
    ['non-string category', item({ category: 7 })],
    ['non-numeric quantity', item({ quantity: '2' })],
    ['non-string assigneeId', item({ assigneeId: 7 })],
    ['non-boolean packed', item({ packed: 'yes' })],
    ['non-string source', item({ source: 7 })],
  ])('rejects %s as damaged', (_label, bad) => {
    rejectsDamaged(envelopeText([trip({ items: [bad] })]));
  });

  it('rejects a non-finite quantity (isNum requires finite)', () => {
    const text = envelopeText([trip()]).replace('"quantity":2', '"quantity":1e999');
    rejectsDamaged(text);
  });

  it('passes a valid item through whole, optional provenance intact', () => {
    const rich = item({
      fromTypeIds: ['beach'],
      userModified: true,
      originName: 'socks',
    });
    const [t] = parseTransfer(envelopeText([trip({ items: [rich] })]));
    expect(t.items).toEqual([rich]);
  });
});

// ---------------------------------------------------------------------------
// serializeTrips round-trip
// ---------------------------------------------------------------------------

describe('serializeTrips', () => {
  it('round-trips through parseTransfer', () => {
    const t = trip() as unknown as Trip;
    const parsed = parseTransfer(serializeTrips([t]));
    expect(parsed).toEqual([t]);
  });

  it('stamps the app tag and current schema', () => {
    const env = JSON.parse(serializeTrips([trip() as unknown as Trip]));
    expect(env.app).toBe('packing-list');
    expect(env.schema).toBe(TRANSFER_SCHEMA);
  });
});

// ---------------------------------------------------------------------------
// mergeImported — collision id minting + rename
// ---------------------------------------------------------------------------

describe('mergeImported', () => {
  const asTrip = (over: Record<string, unknown> = {}) => trip(over) as unknown as Trip;

  it('without a collision keeps id and name and prepends imported trips', () => {
    const existing = [asTrip({ id: 'kept-1', name: 'Old' })];
    const imported = [asTrip({ id: 'incoming-1', name: 'New' })];
    const before = Date.now();
    const { trips: all, addedTrips } = mergeImported(existing, imported);
    expect(addedTrips).toHaveLength(1);
    expect(addedTrips[0].id).toBe('incoming-1');
    expect(addedTrips[0].name).toBe('New');
    expect(addedTrips[0].createdAt).toBe(1000); // preserved
    expect(addedTrips[0].updatedAt).toBeGreaterThanOrEqual(before); // reset to now
    expect(all.map((t) => t.id)).toEqual(['incoming-1', 'kept-1']);
    expect(all[1]).toBe(existing[0]); // existing trip untouched, same object
  });

  it('on id collision mints a fresh t-prefixed id and tags the name " (imported)"', () => {
    const existing = [asTrip({ id: 'dup-1', name: 'Beach' })];
    const imported = [asTrip({ id: 'dup-1', name: 'Beach' })];
    const { addedTrips } = mergeImported(existing, imported);
    expect(addedTrips[0].id).not.toBe('dup-1');
    // makeId('t') — the 't' prefix is load-bearing (matches store-minted trip ids).
    expect(addedTrips[0].id).toMatch(/^t[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/);
    expect(addedTrips[0].name).toBe('Beach (imported)');
  });

  it('a second colliding import against the freshly minted id also gets a new id', () => {
    const existing = [asTrip({ id: 'dup-1' })];
    const imported = [asTrip({ id: 'dup-1', name: 'A' }), asTrip({ id: 'dup-1', name: 'B' })];
    const { addedTrips } = mergeImported(existing, imported);
    const ids = addedTrips.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(undefined);
    expect(addedTrips.map((t) => t.name)).toEqual(['A (imported)', 'B (imported)']);
  });
});

// ---------------------------------------------------------------------------
// isNum guard — mutation survivor: the body
// `typeof v === 'number' && Number.isFinite(v)` replaced by `true`
// (isNum accepts everything). Observe its FALSE result on BOTH a REJECTING
// gate (validateItem.quantity) and a LENIENT default gate
// (validateTrip.laundryIntervalDays), using a truthy NON-number (a
// numeric-looking string) that a bare truthiness check would wave through, and
// separately a non-finite number (the Number.isFinite branch).
// ---------------------------------------------------------------------------

describe('isNum guard (always-true survivor)', () => {
  it('rejects a numeric-looking STRING quantity — a truthy non-number', () => {
    rejectsDamaged(envelopeText([trip({ items: [item({ quantity: '3' })] })]));
  });

  it('rejects a null quantity', () => {
    rejectsDamaged(envelopeText([trip({ items: [item({ quantity: null })] })]));
  });

  it('rejects an object quantity', () => {
    rejectsDamaged(envelopeText([trip({ items: [item({ quantity: { n: 3 } })] })]));
  });

  it('rejects a non-finite (Infinity) quantity — the Number.isFinite branch', () => {
    const text = envelopeText([trip()]).replace('"quantity":2', '"quantity":1e999');
    rejectsDamaged(text);
  });

  it('DEFAULTS a numeric-looking string in a lenient field — never preserves it', () => {
    // If isNum returned true, "7" would be kept verbatim rather than falling
    // back to LAUNDRY_DEFAULT_INTERVAL.
    const [t] = parseTransfer(envelopeText([trip({ laundryIntervalDays: '7' })]));
    expect(t.laundryIntervalDays).toBe(LAUNDRY_DEFAULT_INTERVAL);
  });

  it('DEFAULTS a non-finite number in a lenient field — the Number.isFinite branch', () => {
    const text = envelopeText([trip({ laundryIntervalDays: 0 })]).replace(
      '"laundryIntervalDays":0',
      '"laundryIntervalDays":1e999'
    );
    const [t] = parseTransfer(text);
    expect(t.laundryIntervalDays).toBe(LAUNDRY_DEFAULT_INTERVAL);
  });
});

// ---------------------------------------------------------------------------
// validateTrip shareIdentity — shared-sync round-trip (NoCoverage survivors:
// the isObj gate, the { secret, createdAt } object literal, and the
// conditional spread). A trip carrying a valid shareIdentity must round-trip
// it as EXACTLY { secret, createdAt }; a malformed one must be dropped.
// ---------------------------------------------------------------------------

describe('validateTrip shareIdentity', () => {
  it('preserves a valid shareIdentity as exactly { secret, createdAt }, dropping extras', () => {
    const [t] = parseTransfer(
      envelopeText([trip({ shareIdentity: { secret: 'sek', createdAt: 42, extra: 'x' } })])
    );
    expect(t.shareIdentity).toEqual({ secret: 'sek', createdAt: 42 });
  });

  it('drops a shareIdentity that is not an object', () => {
    const [t] = parseTransfer(envelopeText([trip({ shareIdentity: 'nope' })]));
    expect(t.shareIdentity).toBeUndefined();
    expect('shareIdentity' in t).toBe(false);
  });

  it('drops a shareIdentity missing / mistyped secret or createdAt', () => {
    const noCreated = parseTransfer(
      envelopeText([trip({ shareIdentity: { secret: 'x' } })])
    )[0];
    expect(noCreated.shareIdentity).toBeUndefined();
    const badSecret = parseTransfer(
      envelopeText([trip({ shareIdentity: { secret: 7, createdAt: 1 } })])
    )[0];
    expect(badSecret.shareIdentity).toBeUndefined();
    const badCreated = parseTransfer(
      envelopeText([trip({ shareIdentity: { secret: 'x', createdAt: '1' } })])
    )[0];
    expect(badCreated.shareIdentity).toBeUndefined();
  });

  it('omits shareIdentity entirely when absent (no empty-object key added)', () => {
    const [t] = parseTransfer(envelopeText([trip()]));
    expect('shareIdentity' in t).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateTrip thoroughness — mutation survivor: the `=== 'normal'` clause's
// string literal replaced by `""`. An empty-string thoroughness is NOT a valid
// level, so it must DEFAULT; the mutant would newly match `'' === ''` and
// preserve the empty string.
// ---------------------------------------------------------------------------

describe('validateTrip thoroughness empty-string', () => {
  it('defaults an empty-string thoroughness to THOROUGHNESS_DEFAULT (never keeps "")', () => {
    const [t] = parseTransfer(envelopeText([trip({ thoroughness: '' })]));
    expect(t.thoroughness).toBe(THOROUGHNESS_DEFAULT);
  });
});
