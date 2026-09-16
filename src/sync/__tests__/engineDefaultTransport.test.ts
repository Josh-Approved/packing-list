/**
 * The engine's PRODUCTION transport wiring (sync/index.ts, the default
 * `makeTransport` factory).
 *
 * Every other engine test injects a fake through the `__setTransportFactory`
 * test seam, so the one line that actually runs on a user's phone — the default
 * factory that constructs a `DropBoxTransport` and hands it the engine's five
 * callbacks — was never executed by the suite. A factory that built nothing, or
 * wired the callbacks to the wrong parameters, would have shipped green: shared
 * trips would simply never connect, and no test would notice.
 *
 * This file deliberately does NOT install a factory. It stubs the transport
 * MODULE instead (the real one opens WebSockets and pulls in pure-ESM
 * @noble/*), so the engine takes its real production path into `new
 * DropBoxTransport(...)`, and then drives each captured callback to prove it
 * lands on the behaviour the engine documents.
 *
 * Ported from grocery-list's file of the same name onto packing-list's domain.
 * The differences are real, not cosmetic: the payload is a whole Trip, the join
 * key is the trip's share secret (devices hold different local trip ids), and
 * the 5th callback (`onPublishResult`) exists here — grocery's engine has it
 * too, but packing's status path for it is the one pinned by
 * publishRejectionStatus.test.tsx, so this file proves the callback is wired to
 * the right constructor slot in the first place.
 *
 * MUTATION-REPORT CAVEAT — do not "fix" this file. The default factory is a
 * module-init expression, so its mutant (ArrowFunction → `() => undefined`) is
 * STATIC: Stryker records no per-test coverage for it. The tests below do fail
 * when that mutant is applied by hand, but Stryker's incremental cache can never
 * notice, because a static mutant has no covering tests to diff, so
 * `mutantCanBeReused` keeps re-serving its old Survived verdict however many
 * tests are added. If the report still lists it as a survivor, invalidate the
 * cache (`--force`, or delete stryker-incremental.json) rather than writing
 * another test — there is no test that can clear a reused result.
 */

/** What the engine's production factory hands the transport constructor. */
interface StubTransport {
  channel: string;
  onMessage: (ct: string) => void;
  onReconnect: () => void;
  onStatus: (openRelays: number) => void;
  onPublishResult?: (delivered: boolean, reason: string) => void;
  started: boolean;
  closed: boolean;
  published: string[];
}

// The stub records every construction so the test can inspect the arguments
// the REAL default factory passed. Declared inside the factory (jest hoists
// this call above the imports, so it may not close over outer bindings).
jest.mock('../transport', () => {
  const built: unknown[] = [];
  // NOTE: nothing in here may name a variable inside a TYPE ANNOTATION, and it
  // may not use TS parameter properties. Jest hoists this factory above the
  // imports and babel's out-of-scope check runs BEFORE types are stripped, so
  // `constructor(public channel: string, onMessage: (ct: string) => void)`
  // reads as references to out-of-scope `channel` / `ct`. The shape is pinned
  // by the StubTransport interface above, where the test actually reads it.
  function DropBoxTransport(...args: unknown[]) {
    const t = {
      channel: args[0],
      onMessage: args[1],
      onReconnect: args[2],
      onStatus: args[3],
      onPublishResult: args[4],
      started: false,
      closed: false,
      published: [] as unknown[],
      start() {
        t.started = true;
      },
      publish(ct: unknown) {
        t.published.push(ct);
      },
      close() {
        t.closed = true;
      },
    };
    built.push(t);
    return t;
  }
  return { DropBoxTransport, RELAYS: [], __built: built };
});

/** Every transport the engine constructed, in order, with its callbacks. */
const built = (jest.requireMock('../transport') as { __built: StubTransport[] }).__built;

// Same SQLite stub as engine.test.ts — the store must load under node.
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

import { useTripsStore } from '../../store/trips';
import { channelId, newSecret, seal, open } from '../crypto';
import { useSyncStatusStore } from '../status';
import { startSyncEngine, stopSyncEngine } from '../index';
import type { Trip } from '../../data/trip';

const SECRET = newSecret();
const AT = 1_700_000_000_000;

function sharedTrip(): Trip {
  return {
    id: 't1',
    name: 'Greece',
    nameUpdatedAt: AT,
    duration: 5,
    typeIds: [],
    packers: [{ id: 'me', name: 'Me' }],
    items: [],
    createdAt: AT,
    updatedAt: AT,
    shareIdentity: { secret: SECRET, createdAt: AT },
  };
}

beforeEach(() => {
  built.length = 0;
  useTripsStore.setState({ trips: [], hydrated: true });
  useSyncStatusStore.setState({ bySecret: {} });
});

afterEach(() => {
  stopSyncEngine();
  useTripsStore.setState({ trips: [], hydrated: true });
  useSyncStatusStore.setState({ bySecret: {} });
  jest.useRealTimers();
});

describe('the default (production) transport factory', () => {
  test('a shared trip builds a real transport on the channel derived from its secret, and starts it', () => {
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });

    startSyncEngine();

    expect(built).toHaveLength(1);
    // The channel is derived from the secret — never the secret itself, and
    // never the trip id (devices hold different local ids for one shared trip).
    expect(built[0].channel).toBe(channelId(SECRET));
    expect(built[0].channel).not.toContain(SECRET);
    expect(built[0].started).toBe(true);
  });

  test('the callbacks it is handed are the engine ones, in the order the transport calls them', () => {
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();
    const t = built[0];

    // 2nd arg — inbound message → the engine decrypts and merges a peer copy.
    // The peer carries a different local trip id (the secret is the join key)
    // and a newer name clock, so the merge is visible in one field.
    const peer: Trip = {
      ...sharedTrip(),
      id: 'peer-trip-id',
      name: 'Greece with the in-laws',
      nameUpdatedAt: AT + 9000,
    };
    t.onMessage(seal(SECRET, JSON.stringify(peer)));
    expect(useTripsStore.getState().trips[0].name).toBe('Greece with the in-laws');
    expect(useTripsStore.getState().trips[0].id).toBe('t1'); // our local id stands
    expect(useSyncStatusStore.getState().bySecret[SECRET].lastReceivedAt).toBeGreaterThan(0);

    // 3rd arg — reconnect → push our state and ask peers for theirs (hello).
    t.published = [];
    t.onReconnect();
    const sent = t.published.map((ct) => JSON.parse(open(SECRET, ct) as string));
    expect(sent.some((m) => m?._sync === 'hello')).toBe(true);
    expect(sent.some((m) => m?.shareIdentity && !m?._sync)).toBe(true);

    // 4th arg — relay count → the honest connected/offline indicator.
    t.onStatus(1);
    expect(useSyncStatusStore.getState().bySecret[SECRET].connected).toBe(true);
    t.onStatus(0);
    expect(useSyncStatusStore.getState().bySecret[SECRET].connected).toBe(false);

    // 5th arg — publish result → "sent" is not "delivered".
    t.onPublishResult?.(false, 'rejected');
    expect(useSyncStatusStore.getState().bySecret[SECRET].publishRejected).toBe(true);
    t.onPublishResult?.(true, '');
    expect(useSyncStatusStore.getState().bySecret[SECRET].publishRejected).toBe(false);
  });

  test('stopping the engine closes the real transport it built', () => {
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();

    stopSyncEngine();

    expect(built[0].closed).toBe(true);
  });
});
