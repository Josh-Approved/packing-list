/**
 * Sync engine — wires the store to the drop-box transport.
 *
 * For every trip that has a share identity it keeps one transport open,
 * publishes the (encrypted) whole trip when it changes locally, and merges
 * anything that arrives. The merge is conflict-free, so this can be
 * best-effort: a missed message re-converges on the next publish.
 *
 * Durable by construction: the channel is derived from the persistent
 * per-trip secret, so a paired trip reconnects forever with nothing from the
 * user ("pair once, synced forever"). Devices have different local trip ids;
 * the shared secret — not the id — is the join key.
 *
 * COLD-START BACKFILL. Relays are ephemeral couriers — they don't store, so a
 * device that just opened (or just reconnected, or just joined a link) hears
 * nothing until the OTHER side happens to edit. Fixed with a tiny "hello"
 * handshake: on each (re)connect a device announces itself; any peer that hears
 * a hello force-republishes its current full state, so the newcomer converges
 * within seconds. Hello carries no trip data; old app versions ignore it.
 *
 * Merge correctness across skewed device clocks is handled by the logical clock
 * (see ./clock.ts); `mergeRemoteTrip` folds the peer's timestamps in before
 * merging.
 *
 * NOT DEVICE-VERIFIED end-to-end (see transport.ts / crypto.ts headers).
 */

import { useTripsStore } from '../store/trips';
import type { Trip } from '../data/trip';
import { channelId, seal, open } from './crypto';
import { DropBoxTransport } from './transport';
import {
  markConnected,
  markDelivered,
  markReceived,
  markSent,
  dropStatus,
} from './status';

/** A control message asking peers to re-publish their current state. Encrypted
 *  like everything else; distinguished from a state message by `_sync` (a state
 *  message is a bare Trip, which has `shareIdentity` and no `_sync`). */
const HELLO = JSON.stringify({ _sync: 'hello' });
/** Don't re-announce more than this often per channel (relays may report
 *  several sockets opening near-simultaneously). */
const HELLO_DEBOUNCE_MS = 3000;

/** The slice of DropBoxTransport the engine drives. Named so a test can inject
 *  a fake (see __setTransportFactory) — the production transport is created and
 *  torn down entirely inside this module, so the wiring is otherwise unreachable. */
export interface EngineTransport {
  start(): void;
  publish(ciphertext: string): void;
  close(): void;
}

type TransportFactory = (
  channel: string,
  onMessage: (ciphertext: string) => void,
  onReconnect: () => void,
  onStatus: (openRelays: number) => void,
  onPublishResult?: (delivered: boolean, reason: string) => void
) => EngineTransport;

let makeTransport: TransportFactory = (
  channel,
  onMessage,
  onReconnect,
  onStatus,
  onPublishResult
) =>
  new DropBoxTransport(channel, onMessage, onReconnect, onStatus, onPublishResult);

/** TEST-ONLY seam: swap the transport factory (e.g. for a recording fake) and
 *  get back a restore fn. Production never calls this. */
export function __setTransportFactory(factory: TransportFactory): () => void {
  const prev = makeTransport;
  makeTransport = factory;
  return () => {
    makeTransport = prev;
  };
}

interface Channel {
  transport: EngineTransport;
  lastSent: string;
  timer: ReturnType<typeof setTimeout> | null;
  lastHelloAt: number;
}

const channels = new Map<string, Channel>();
let unsub: (() => void) | null = null;

function sharedSecret(t: Trip): string | undefined {
  return t.shareIdentity?.secret;
}

function ensureChannel(secret: string): Channel {
  let ch = channels.get(secret);
  if (ch) return ch;
  const transport = makeTransport(
    channelId(secret),
    (ct) => receive(secret, ct),
    () => onReconnect(secret),
    (openRelays) => markConnected(secret, openRelays > 0),
    (delivered) => markDelivered(secret, delivered)
  );
  ch = { transport, lastSent: '', timer: null, lastHelloAt: 0 };
  channels.set(secret, ch);
  transport.start();
  return ch;
}

/** Handle one decrypted peer message: a hello (→ re-publish our state) or a
 *  state copy (→ merge it). */
function receive(secret: string, ct: string): void {
  const json = open(secret, ct);
  if (!json) return;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return; // malformed — next publish re-converges
  }
  if (obj && typeof obj === 'object') {
    const sync = (obj as { _sync?: string })._sync;
    if (sync === 'hello') {
      // A newcomer: re-publish our state so they converge.
      forcePublish(secret);
      return;
    }
  }
  const remote = obj as Trip;
  if (remote?.shareIdentity?.secret === secret) {
    // mergeRemoteTrip folds the remote clock in before merging (see clock.ts).
    useTripsStore.getState().mergeRemoteTrip(remote);
    markReceived(secret, Date.now());
  }
}

/** On (re)connect, both PUSH our current state (so a peer already online
 *  converges to our latest) and PULL via hello (so peers push us theirs). Both
 *  directions are needed: hello alone only fetches, so a device that reconnects
 *  while its partner is already online would never re-share its own state. */
function onReconnect(secret: string): void {
  forcePublish(secret);
  sendHello(secret);
}

/** Announce ourselves so a peer re-publishes its current state. Debounced. */
function sendHello(secret: string): void {
  const ch = channels.get(secret);
  if (!ch) return;
  const t = Date.now();
  if (t - ch.lastHelloAt < HELLO_DEBOUNCE_MS) return;
  ch.lastHelloAt = t;
  ch.transport.publish(seal(secret, HELLO));
}

/** Publish our current full state immediately, bypassing the change-dedupe —
 *  used to answer a peer's hello (its copy may be empty/stale even though ours
 *  hasn't changed since we last sent). */
function forcePublish(secret: string): void {
  const ch = channels.get(secret);
  if (!ch) return;
  const trip = useTripsStore
    .getState()
    .trips.find((t) => sharedSecret(t) === secret);
  if (!trip) return;
  // Cancel any pending debounced publish: it captured an OLDER snapshot.
  if (ch.timer) {
    clearTimeout(ch.timer);
    ch.timer = null;
  }
  const payload = JSON.stringify(trip);
  ch.lastSent = payload;
  ch.transport.publish(seal(secret, payload));
  markSent(secret, Date.now());
}

function publish(secret: string, trip: Trip): void {
  const ch = ensureChannel(secret);
  const payload = JSON.stringify(trip);
  if (payload === ch.lastSent) return; // nothing changed since last send
  if (ch.timer) clearTimeout(ch.timer);
  ch.timer = setTimeout(() => {
    ch.lastSent = payload;
    ch.transport.publish(seal(secret, payload));
    markSent(secret, Date.now());
  }, 700);
}

/** Force an immediate full exchange for one shared trip (the UI's manual
 *  "resync" affordance): push our state and ask peers for theirs. */
export function resyncNow(secret: string): void {
  onReconnect(secret);
}

function reconcile(trips: Trip[]): void {
  const live = new Set<string>();
  for (const t of trips) {
    const secret = sharedSecret(t);
    if (!secret) continue;
    live.add(secret);
    publish(secret, t);
  }
  // Close channels for trips that are gone / no longer shared.
  for (const [secret, ch] of channels) {
    if (!live.has(secret)) {
      if (ch.timer) clearTimeout(ch.timer);
      ch.transport.close();
      channels.delete(secret);
      dropStatus(secret);
    }
  }
}

/** Start once after the store has hydrated (App.tsx). Idempotent. */
export function startSyncEngine(): void {
  if (unsub) return;
  reconcile(useTripsStore.getState().trips);
  unsub = useTripsStore.subscribe((state) => reconcile(state.trips));
}

/** Push current state immediately on every channel, skipping the debounce.
 *  Call when the app is about to background: the 700ms publish debounce would
 *  otherwise be suspended mid-wait, so a change made right before switching
 *  apps never leaves the device. Best-effort — sockets may be closing. */
export function flushSyncEngine(): void {
  for (const secret of channels.keys()) {
    const ch = channels.get(secret);
    if (ch?.timer) {
      clearTimeout(ch.timer);
      ch.timer = null;
    }
    forcePublish(secret);
  }
}

export function stopSyncEngine(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  for (const ch of channels.values()) {
    if (ch.timer) clearTimeout(ch.timer);
    ch.transport.close();
  }
  channels.clear();
}
