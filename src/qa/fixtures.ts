// QA fixtures — deterministic data the app boots with under QA_MODE (the capture
// pipeline builds with EXPO_PUBLIC_QA_MODE=1). Built with the app's OWN
// composition (applyTripInfo) so the item list is valid + realistic by
// construction. The trip is pre-seeded with packers so the "shared packing"
// screen is screenshot-ready without typing live. ids/timestamps don't appear
// in screenshots, so the fixed values below are purely for stability.
import { applyTripInfo, type Trip, type TripInfo } from '../data/trip';

const T0 = 1700000000000;

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
    },
  ];
}
