// QA fixtures — deterministic data the app boots with under QA_MODE (the capture
// pipeline builds with EXPO_PUBLIC_QA_MODE=1). Built with the app's OWN
// composition (applyTripInfo) so the item list is valid + realistic by
// construction. The trip is pre-seeded with packers so the "shared packing"
// screen is screenshot-ready without typing live. ids/timestamps don't appear
// in screenshots, so the fixed values below are purely for stability.
import { applyTripInfo, type Trip, type TripInfo } from '../data/trip';

const T0 = 1700000000000;

/**
 * Two-device sync E2E pairing. When a fixed shared secret is injected at build
 * time (`EXPO_PUBLIC_QA_SHARE_SECRET`, set by scripts/e2e/run-two-device.sh's
 * Metro invocation), the seeded Greece trip becomes a SHARED trip carrying that
 * identity, so a simulator and an emulator booting the same build rendezvous on
 * the same relay channel with no pairing gesture to drive.
 *
 * Safe by construction in every other context: unset in production, in normal
 * QA captures and in tests, so the whole branch is a no-op (Metro inlines the
 * env var, so an unset one is a literal empty string).
 *
 * The seed is ALREADY deterministic — `applyTripInfo` mints `gen-<rule>` ids
 * from the rules, and every clock below is pinned to T0 — which is what makes
 * the rendezvous safe: two devices seed byte-identical copies, so the first
 * hello merges idempotently instead of unioning into duplicates.
 */
const QA_SHARE_SECRET = process.env.EXPO_PUBLIC_QA_SHARE_SECRET || '';

export function qaTrips(): Trip[] {
  const info: TripInfo = {
    name: 'Greece',
    duration: 4,
    typeIds: ['beach'],
    canDoLaundry: false,
    laundryIntervalDays: 4,
    thoroughness: 'normal',
  };
  const composed = applyTripInfo(info, [], 'unspecified');
  return [
    {
      id: 'qa-greece',
      ...composed,
      // Pin the shared-sync merge clocks to T0 so the fixture is fully
      // deterministic (composeItems stamps addedAt/updatedAt from the live
      // logical clock, which would otherwise differ call to call).
      items: composed.items.map((it) => ({ ...it, addedAt: T0, updatedAt: T0 })),
      nameUpdatedAt: T0,
      packers: [
        { id: 'me', name: 'Me' },
        { id: 'p-sam', name: 'Sam' },
        { id: 'p-maya', name: 'Maya' },
      ],
      createdAt: T0,
      updatedAt: T0,
      ...(QA_SHARE_SECRET
        ? { shareIdentity: { secret: QA_SHARE_SECRET, createdAt: T0 } }
        : null),
    },
  ];
}
