/**
 * Sync engine wiring (sync/index.ts) — the layer the shipped shared-list
 * defects actually lived in (cold-start hello backfill, bidirectional
 * reconnect push, debounced force-publish, receive() dispatch, teardown). The
 * merge primitives are tested elsewhere (mergeRecordSet / syncSim / skewMerge);
 * this pins the ENGINE, which was untested because DropBoxTransport is created
 * inside the module and can't otherwise be reached.
 *
 * The __setTransportFactory seam swaps in a recording fake so we can drive the
 * onMessage / onReconnect / onStatus callbacks and inspect (decrypt) what the
 * engine publishes. Everything flows through the REAL crypto (seal/open) and
 * the REAL trips store, so this exercises the production dispatch, not a
 * re-implementation. Only the SQLite persistence layer is stubbed (it can't
 * load in node, and it is fire-and-forget — never the SUT).
 *
 * Ported from grocery-list's engine.test.ts (the fleet exemplar) onto
 * packing-list's domain. The differences are real, not cosmetic: packing-list
 * publishes ONE message kind (the whole trip) — there is no kits control
 * message — and it wires a fifth `onPublishResult` transport callback, whose
 * status path is pinned by publishRejectionStatus.test.tsx.
 */

// The real DropBoxTransport pulls in @noble/* (pure ESM jest doesn't transform)
// and opens WebSockets. The engine never constructs it here —
// __setTransportFactory injects a fake — so stub the module out to keep the
// import graph node-loadable.
jest.mock('../transport', () => ({
  DropBoxTransport: class {
    start() {}
    publish() {}
    close() {}
  },
  RELAYS: [],
}));

// SQLite can't load in node; persistence is fire-and-forget and not the SUT.
// Mirrors publishRejectionStatus.test.tsx.
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
import {
  startSyncEngine,
  stopSyncEngine,
  flushSyncEngine,
  resyncNow,
  __setTransportFactory,
  type EngineTransport,
} from '../index';
import type { Trip, TripItem } from '../../data/trip';

const SECRET = newSecret();

/** Recording fake — captures published ciphertext and exposes the engine's
 *  callbacks so a test can simulate an inbound message / reconnect. */
class FakeTransport implements EngineTransport {
  published: string[] = [];
  started = false;
  closed = false;
  constructor(
    public channel: string,
    public onMessage: (ct: string) => void,
    public onReconnect: () => void,
    public onStatus: (openRelays: number) => void,
    public onPublishResult?: (delivered: boolean, reason: string) => void
  ) {}
  start() {
    this.started = true;
  }
  publish(ct: string) {
    this.published.push(ct);
  }
  close() {
    this.closed = true;
  }
  /** Decrypt each published message to a parsed object for assertions. */
  decoded(): any[] {
    return this.published.map((ct) => JSON.parse(open(SECRET, ct) as string));
  }
  deliver(plaintext: string) {
    this.onMessage(seal(SECRET, plaintext));
  }
}

let created: FakeTransport[];
let restore: () => void;

const AT = 1_700_000_000_000;

function item(id: string, updatedAt = AT): TripItem {
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
  };
}

function sharedTrip(items: TripItem[] = []): Trip {
  return {
    id: 't1',
    name: 'Greece',
    nameUpdatedAt: AT,
    duration: 5,
    typeIds: [],
    packers: [{ id: 'me', name: 'Me' }],
    items,
    createdAt: AT,
    updatedAt: AT,
    shareIdentity: { secret: SECRET, createdAt: AT },
  };
}

/** The same trip with no share identity — an ordinary, private, unshared trip. */
function soloTrip(items: TripItem[] = []): Trip {
  const t = sharedTrip(items);
  delete t.shareIdentity;
  return t;
}

beforeEach(() => {
  created = [];
  restore = __setTransportFactory((channel, onMessage, onReconnect, onStatus, onPublishResult) => {
    const t = new FakeTransport(channel, onMessage, onReconnect, onStatus, onPublishResult);
    created.push(t);
    return t;
  });
  useTripsStore.setState({ trips: [], hydrated: true });
  useSyncStatusStore.setState({ bySecret: {} });
});

afterEach(() => {
  stopSyncEngine();
  restore();
  useTripsStore.setState({ trips: [], hydrated: true });
  useSyncStatusStore.setState({ bySecret: {} });
  jest.useRealTimers();
});

/** Just the peer-visible messages of one kind, decrypted. A state message is a
 *  bare Trip (it has `shareIdentity` and no `_sync`); a hello is the control
 *  message. */
function messagesOfKind(t: FakeTransport, kind: 'state' | 'hello'): any[] {
  return t
    .decoded()
    .filter((m) => (kind === 'state' ? m?.shareIdentity && !m?._sync : m?._sync === kind));
}

describe('channel lifecycle', () => {
  test('a shared trip opens exactly one started channel, on the derived channel id', () => {
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();
    expect(created).toHaveLength(1);
    expect(created[0].started).toBe(true);
    // The relay only ever sees the derived channel id — never the secret.
    expect(created[0].channel).toBe(channelId(SECRET));
    expect(created[0].channel).not.toContain(SECRET);
  });
});

describe('hello handshake (cold-start backfill)', () => {
  // Relays are ephemeral couriers: a device that just opened hears nothing
  // until the OTHER side happens to edit. The hello is what closes that window.
  test('an inbound hello force-publishes our current trip', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('socks')])], hydrated: true });
    startSyncEngine();
    created[0].published = []; // ignore the debounced reconcile publish

    created[0].deliver(JSON.stringify({ _sync: 'hello' }));

    const state = messagesOfKind(created[0], 'state');
    expect(state).toHaveLength(1);
    expect(state[0].items.some((it: any) => it.id === 'socks')).toBe(true);
  });

  test('answering a hello bypasses the change-dedupe (our copy may not have changed)', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('socks')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700); // the normal publish has already gone out
    created[0].published = [];

    // Nothing changed locally since — but the peer asking may hold an empty or
    // stale copy, so the dedupe must not swallow the answer.
    created[0].deliver(JSON.stringify({ _sync: 'hello' }));

    expect(messagesOfKind(created[0], 'state')).toHaveLength(1);
  });
});

describe('reconnect (bidirectional)', () => {
  test('onReconnect pushes our state AND sends a hello to pull theirs', () => {
    // Both directions are needed: hello alone only fetches, so a device that
    // reconnects while its partner is already online would never re-share.
    useTripsStore.setState({ trips: [sharedTrip([item('passport')])], hydrated: true });
    startSyncEngine();
    created[0].published = [];

    created[0].onReconnect();

    expect(messagesOfKind(created[0], 'state')).toHaveLength(1); // pushed state
    expect(messagesOfKind(created[0], 'hello')).toHaveLength(1); // pulled via hello
  });

  test('two reconnects in quick succession announce us only once', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    created[0].published = [];

    // Relays often report several sockets opening at nearly the same moment.
    created[0].onReconnect();
    created[0].onReconnect();

    expect(messagesOfKind(created[0], 'hello')).toHaveLength(1);
  });

  test('once the announce window has passed, the next reconnect announces us again', () => {
    // A device that genuinely drops and reconnects minutes later must announce
    // again, or it never pulls the state it missed.
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    created[0].published = [];

    created[0].onReconnect();
    jest.advanceTimersByTime(3000); // the full announce window
    created[0].onReconnect();

    expect(messagesOfKind(created[0], 'hello')).toHaveLength(2);
  });
});

describe('debounced publish', () => {
  test('several rapid local edits coalesce into a single channel publish', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();

    // Three quick edits within the debounce window.
    for (let n = 2; n <= 4; n++) {
      useTripsStore.setState({
        trips: [sharedTrip([item('a'), item(`x${n}`, AT + n)])],
        hydrated: true,
      });
    }
    expect(created[0].published).toHaveLength(0); // nothing sent yet (still debouncing)

    jest.advanceTimersByTime(700);
    expect(created[0].published).toHaveLength(1); // coalesced to one send
  });

  test('answering a peer hello cancels the pending copy, so nothing stale lands', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700);
    created[0].published = [];

    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('sunscreen', AT + 3000)])],
      hydrated: true,
    });
    created[0].deliver(JSON.stringify({ _sync: 'hello' }));

    const sent = created[0].published.length;
    jest.advanceTimersByTime(700);
    expect(created[0].published).toHaveLength(sent);
  });
});

describe('publish dedupe', () => {
  test('a store touch that changes nothing sends no second copy', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700);
    expect(messagesOfKind(created[0], 'state')).toHaveLength(1);

    // Re-setting an identical trip (a rehydrate, an unrelated re-render) must
    // not put another copy of the whole trip on a public relay.
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    jest.advanceTimersByTime(700);
    expect(messagesOfKind(created[0], 'state')).toHaveLength(1);
  });
});

describe('receive() dispatch', () => {
  test('a peer state message with our secret is merged into the store', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('socks')])], hydrated: true });
    startSyncEngine();

    const remote = sharedTrip([item('socks'), item('charger', AT + 5000)]);
    remote.id = 'peer-trip-id'; // devices have different local ids; secret is the key
    created[0].deliver(JSON.stringify(remote));

    const merged = useTripsStore.getState().trips[0];
    expect(merged.id).toBe('t1'); // the LOCAL id is kept
    expect(merged.items.map((i) => i.id).sort()).toEqual(['charger', 'socks']);
  });

  test('an unknown _sync tag is ignored (forward wire-compat), no merge, no throw', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('rice')])], hydrated: true });
    startSyncEngine();
    const before = JSON.stringify(useTripsStore.getState().trips);

    expect(() =>
      created[0].deliver(JSON.stringify({ _sync: 'from-a-future-version', blob: 1 }))
    ).not.toThrow();

    expect(JSON.stringify(useTripsStore.getState().trips)).toBe(before);
  });

  test('a state message whose secret is not ours is ignored', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('rice')])], hydrated: true });
    startSyncEngine();
    const before = JSON.stringify(useTripsStore.getState().trips);

    const foreign = sharedTrip([item('poison', AT + 9000)]);
    foreign.shareIdentity = { secret: 'someone-elses-secret', createdAt: 1 };
    created[0].deliver(JSON.stringify(foreign));

    expect(JSON.stringify(useTripsStore.getState().trips)).toBe(before);
  });

  test('garbage from a public relay is ignored, never thrown into the app', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('rice')])], hydrated: true });
    startSyncEngine();
    const before = JSON.stringify(useTripsStore.getState().trips);

    // Anyone can push anything onto a public channel: text that decrypts but
    // isn't JSON, and bytes that don't decrypt at all.
    expect(() => created[0].deliver('<<not json at all>>')).not.toThrow();
    expect(() => created[0].onMessage('!!! not even base64 !!!')).not.toThrow();

    expect(JSON.stringify(useTripsStore.getState().trips)).toBe(before);
  });

  test('a bare JSON scalar is ignored, never thrown into the app', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('rice')])], hydrated: true });
    startSyncEngine();
    const before = JSON.stringify(useTripsStore.getState().trips);

    for (const payload of ['null', '42', '"just a string"', 'true']) {
      expect(() => created[0].deliver(payload)).not.toThrow();
    }

    expect(JSON.stringify(useTripsStore.getState().trips)).toBe(before);
    expect(useSyncStatusStore.getState().bySecret[SECRET]?.lastReceivedAt ?? null).toBeNull();
  });

  test("a state copy carrying someone else's secret never counts as hearing from our peer", () => {
    useTripsStore.setState({ trips: [sharedTrip([item('rice')])], hydrated: true });
    startSyncEngine();

    const foreign = sharedTrip([item('poison', AT + 9000)]);
    foreign.shareIdentity = { secret: 'someone-elses-secret', createdAt: 1 };
    created[0].deliver(JSON.stringify(foreign));

    // A stranger's copy must not merge AND must not make the trip read as
    // freshly synced — "last received just now" would be a lie the user acts on.
    expect(useTripsStore.getState().trips[0].items.map((i) => i.id)).toEqual(['rice']);
    expect(useSyncStatusStore.getState().bySecret[SECRET]?.lastReceivedAt ?? null).toBeNull();
  });
});

describe('unshared trips', () => {
  test('a solo trip opens no channel (and does not crash the reconcile)', () => {
    useTripsStore.setState({ trips: [soloTrip([item('socks')])], hydrated: true });
    startSyncEngine();
    expect(created).toHaveLength(0);
  });

  test('a solo trip sitting beside a shared one leaves exactly one channel', () => {
    useTripsStore.setState({
      trips: [soloTrip([item('socks')]), sharedTrip([item('passport')])],
      hydrated: true,
    });
    startSyncEngine();
    expect(created).toHaveLength(1);
  });

  test('unsharing a trip closes its channel and forgets its status', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('socks')])], hydrated: true });
    startSyncEngine();
    created[0].onStatus(2);
    expect(useSyncStatusStore.getState().bySecret[SECRET].connected).toBe(true);

    // The user turns sharing off. The relay socket must not outlive it, and no
    // stale "Connected" may stay attached to a secret nothing listens on.
    useTripsStore.setState({ trips: [soloTrip([item('socks')])], hydrated: true });

    expect(created[0].closed).toBe(true);
    expect(useSyncStatusStore.getState().bySecret[SECRET]).toBeUndefined();
  });
});

describe('engine lifecycle', () => {
  test('starting twice opens only one channel', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    startSyncEngine();
    expect(created).toHaveLength(1);
  });

  test('starting twice leaves no orphan subscription behind after stop', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    startSyncEngine();

    stopSyncEngine();
    created = [];

    // After stop, an edit must reach no transport at all. A second, unreleased
    // store subscription would quietly re-open a relay socket right here.
    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('b', AT + 2000)])],
      hydrated: true,
    });
    expect(created).toHaveLength(0);
  });

  test('stopping closes the open channel and stops publishing', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    const transport = created[0];

    stopSyncEngine();

    expect(transport.closed).toBe(true);
    created = [];
    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('b', AT + 2000)])],
      hydrated: true,
    });
    expect(created).toHaveLength(0);
    expect(transport.published).toHaveLength(0);
  });
});

describe('flushSyncEngine (the app is backgrounding)', () => {
  test('an edit still inside the debounce window leaves the device immediately', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700);
    created[0].published = [];

    // Pack something, then switch apps at once: the 700ms debounce is about to
    // be suspended mid-wait, which is how an edit used to be stranded.
    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('sunscreen', AT + 3000)])],
      hydrated: true,
    });
    expect(created[0].published).toHaveLength(0);

    flushSyncEngine();

    const state = messagesOfKind(created[0], 'state');
    expect(state).toHaveLength(1);
    expect(state[0].items.some((it: any) => it.id === 'sunscreen')).toBe(true);

    // The suspended debounce must not then fire a second, older copy.
    const sent = created[0].published.length;
    jest.advanceTimersByTime(700);
    expect(created[0].published).toHaveLength(sent);
  });

  test('flushing with nothing shared publishes nothing and does not crash', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [soloTrip([item('a')])], hydrated: true });
    startSyncEngine();
    expect(created).toHaveLength(0); // nothing shared → no channel

    expect(() => flushSyncEngine()).not.toThrow();

    // Sharing later still publishes normally — backgrounding while unshared
    // must not leave any state behind that silences the first real send.
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    expect(created).toHaveLength(1);
    jest.advanceTimersByTime(700);
    expect(messagesOfKind(created[0], 'state')).toHaveLength(1);
  });
});

describe('resyncNow (the tap-to-resync affordance)', () => {
  test('pushes our trip and asks peers for theirs', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('passport')])], hydrated: true });
    startSyncEngine();
    created[0].published = [];

    resyncNow(SECRET);

    expect(messagesOfKind(created[0], 'state')).toHaveLength(1);
    expect(messagesOfKind(created[0], 'hello')).toHaveLength(1);
  });

  test('tapping resync for a secret no channel is open on does nothing and does not crash', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    created[0].published = [];

    expect(() => resyncNow(newSecret())).not.toThrow();

    expect(created[0].published).toHaveLength(0);
  });

  test('tapping resync while the engine is not running does nothing and does not crash', () => {
    // The trip is on screen with its share identity, but the engine's effect
    // has not started (or its cleanup already ran), so it holds no channel.
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });

    expect(() => resyncNow(SECRET)).not.toThrow();

    expect(created).toHaveLength(0);
  });
});

describe('one channel carries exactly one trip', () => {
  test('answering a hello publishes THIS trip, never another trip on the device', () => {
    const OTHER = newSecret();
    const other = sharedTrip([item('other-party-only')]);
    other.id = 't2';
    other.shareIdentity = { secret: OTHER, createdAt: AT };
    // The other trip is FIRST in the store, so "whichever trip came to hand"
    // would put its contents on this party's relay channel.
    useTripsStore.setState({
      trips: [other, sharedTrip([item('socks')])],
      hydrated: true,
    });
    startSyncEngine();

    const ours = created.find((t) => t.channel === channelId(SECRET));
    expect(ours).toBeDefined();
    ours!.published = [];

    ours!.deliver(JSON.stringify({ _sync: 'hello' }));

    const state = messagesOfKind(ours!, 'state');
    expect(state).toHaveLength(1);
    expect(state[0].items.map((it: any) => it.id)).toEqual(['socks']);
  });
});

describe('connection status the bar reads', () => {
  test('no open relay reads as not connected; at least one reads as connected', () => {
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();

    created[0].onStatus(1);
    expect(useSyncStatusStore.getState().bySecret[SECRET].connected).toBe(true);

    created[0].onStatus(0);
    expect(useSyncStatusStore.getState().bySecret[SECRET].connected).toBe(false);
  });

  test('a peer copy timestamps the trip as heard-from', () => {
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    expect(useSyncStatusStore.getState().bySecret[SECRET]?.lastReceivedAt ?? null).toBeNull();

    const remote = sharedTrip([item('a'), item('b', AT + 5000)]);
    remote.id = 'peer-trip-id';
    created[0].deliver(JSON.stringify(remote));

    expect(useSyncStatusStore.getState().bySecret[SECRET].lastReceivedAt).toBeGreaterThan(0);
  });

  test('our own publish timestamps the trip as sent', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    expect(useSyncStatusStore.getState().bySecret[SECRET]?.lastSentAt ?? null).toBeNull();

    jest.advanceTimersByTime(700);

    expect(useSyncStatusStore.getState().bySecret[SECRET].lastSentAt).toBeGreaterThan(0);
  });

  test('the engine wires the publish-result callback through to the status store', () => {
    // The transport's fifth callback is what makes "Connected" honest when
    // every relay is rejecting our publishes. (The full transport → UI path is
    // pinned by publishRejectionStatus.test.tsx; this pins the engine's wiring.)
    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();
    expect(created[0].onPublishResult).toBeDefined();

    created[0].onPublishResult!(false, 'invalid: event too large');
    expect(useSyncStatusStore.getState().bySecret[SECRET].publishRejected).toBe(true);

    created[0].onPublishResult!(true, '');
    expect(useSyncStatusStore.getState().bySecret[SECRET].publishRejected).toBe(false);
  });
});

describe('teardown leaves nothing armed', () => {
  test('unsharing cancels the pending copy — nothing lands on the closed channel', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700);
    created[0].published = [];

    // An edit is still waiting out the debounce when the user turns sharing off.
    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('sunscreen', AT + 3000)])],
      hydrated: true,
    });
    useTripsStore.setState({
      trips: [soloTrip([item('a'), item('sunscreen', AT + 3000)])],
      hydrated: true,
    });

    jest.advanceTimersByTime(3000);

    expect(created[0].closed).toBe(true);
    expect(created[0].published).toHaveLength(0);
  });

  test('stopping cancels every pending publish and detaches the engine', () => {
    jest.useFakeTimers();
    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    startSyncEngine();
    jest.advanceTimersByTime(700);
    const transport = created[0];
    transport.published = [];

    // Arm the debounce, then tear down.
    useTripsStore.setState({
      trips: [sharedTrip([item('a'), item('sunscreen', AT + 3000)])],
      hydrated: true,
    });
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    stopSyncEngine();

    // Nothing may fire after teardown — a stranded timer publishes onto a
    // closed relay socket, and a stranded subscription re-arms one on the next
    // edit.
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(5000);
    expect(transport.published).toHaveLength(0);

    useTripsStore.setState({ trips: [sharedTrip([item('a')])], hydrated: true });
    expect(jest.getTimerCount()).toBe(0);
    expect(transport.published).toHaveLength(0);
  });
});

describe('the transport seam', () => {
  test('restoring puts the PREVIOUS factory back, so a fake cannot leak forward', () => {
    const inner: string[] = [];
    const restoreInner = __setTransportFactory((channel, onMessage, onReconnect, onStatus) => {
      inner.push(channel);
      return new FakeTransport(channel, onMessage, onReconnect, onStatus);
    });

    restoreInner();

    useTripsStore.setState({ trips: [sharedTrip()], hydrated: true });
    startSyncEngine();

    // Without a working restore the inner fake would still be installed here —
    // and in production the surrounding factory is the REAL relay transport.
    expect(inner).toHaveLength(0);
    expect(created).toHaveLength(1);
  });
});
