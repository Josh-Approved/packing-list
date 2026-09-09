/**
 * Intent fuzzer — packing-list trust core (Uplevel 3 / T1). The DRIVER.
 *
 * The model itself (commands, oracles I-NODUP / I-PACKED / I-KEEP /
 * I-ROUNDTRIP / I-IMPORT-NOLOSS / I-DELETE-STICKS, and the property the
 * replayer re-runs) lives in `qa/intent-fuzz/models/packing.model.ts` — read
 * that file's header for what each oracle means. This file's whole job is to
 * install the hermetic store mocks and run it.
 *
 * WHERE THE CRYSTALLIZED REGRESSIONS REPLAY. Not here — the replay kit
 * enumerates every checked-in fixture from every call site, so two call sites
 * means every fixture must know every model or the other file goes red on a
 * model it has never heard of (that is exactly how a `packing` fixture sat
 * un-replayed from 2026-09-06). There is now ONE call site,
 * `src/sync/__tests__/intentFuzz.model.test.ts`, and it registers both models.
 * If you add a model, register it there.
 */

import { runIntentFuzz } from '../../../qa/intent-fuzz/harness';

// Hermetic: mock everything the trips + settings stores touch beyond pure JS.
jest.mock('../db', () => ({
  loadAllTrips: jest.fn(async () => []),
  saveTrip: jest.fn(async () => {}),
  deleteTripFromDb: jest.fn(async () => {}),
  getAppSetting: jest.fn(async () => null),
  setAppSetting: jest.fn(async () => {}),
}));
// The store now imports the shared-sync clock persistence (storage/kv), which
// pulls in expo-sqlite (→ expo-asset, unresolvable in the jest env). The fuzzer
// never hydrates/flushes, so stub it out — same hermetic-store move as ../db.
jest.mock('../../storage/kv', () => ({
  getSyncMeta: jest.fn(async () => null),
  setSyncMeta: jest.fn(async () => {}),
}));
jest.mock('../../qa/qaMode', () => ({ QA_MODE: false }));
jest.mock('../../qa/fixtures', () => ({ qaTrips: () => [] }));

import {
  PACKING_MODEL,
  PACKING_MAX_COMMANDS,
  packingCommands,
  packingSetup,
  type Model,
  type Real,
} from '../../../qa/intent-fuzz/models/packing.model';

const APP = require('../../../app.json').expo.slug as string;

describe('packing — intent fuzzer', () => {
  it('user intent survives randomized packing stories', () => {
    runIntentFuzz<Model, Real>({
      app: APP,
      model: PACKING_MODEL,
      commands: packingCommands,
      setup: packingSetup,
      maxCommands: PACKING_MAX_COMMANDS,
    });
  });
});
