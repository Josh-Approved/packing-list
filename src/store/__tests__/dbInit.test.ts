/**
 * Database open + additive-migration concurrency (trust core).
 *
 * Regression cover for the 2026-07-27 upgrade defect: hydration, settings and
 * the sync engine all call into db.ts at startup. When the module cached the
 * resolved handle instead of the open PROMISE, each caller ran its own
 * open + migrate sequence — every one of them read PRAGMA table_info before
 * any had ALTERed, so they all queued the same ADD COLUMN and the losers threw
 * "duplicate column name", failing hydration. On an upgrade install (a table
 * created before the shared-sync columns existed) that showed up as
 * "failed to load trips from disk" — an empty trip list for a real user with
 * real trips. Fresh installs never hit it: nothing is missing, so nothing is
 * ALTERed.
 *
 * The fake database below reproduces SQLite's real behavior: a duplicate
 * ADD COLUMN throws. A regression re-opens the race and this test goes red.
 */

const LEGACY_COLUMNS = [
  'id',
  'name',
  'duration',
  'typeIds',
  'packers',
  'items',
  'canDoLaundry',
  'laundryIntervalDays',
  'thoroughness',
  'createdAt',
  'updatedAt',
];

let columns: string[] = [];
let openCount = 0;

/** Yields to the microtask/timer queue so concurrent callers interleave. */
const tick = () => new Promise((r) => setTimeout(r, 0));

const fakeDb = {
  async execAsync(sql: string) {
    await tick();
    const add = /ALTER TABLE trips ADD COLUMN (\w+)/.exec(sql);
    if (add) {
      const col = add[1];
      // Exactly what SQLite does — this is the failure the app hit.
      if (columns.includes(col)) {
        throw new Error(`SQLiteErrorException: duplicate column name: ${col}`);
      }
      columns.push(col);
    }
    return undefined;
  },
  async getAllAsync(sql: string) {
    await tick();
    if (/PRAGMA table_info/.test(sql)) {
      return columns.map((name) => ({ name }));
    }
    return [];
  },
  async getFirstAsync() {
    await tick();
    return null;
  },
  async runAsync() {
    await tick();
    return undefined;
  },
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    openCount += 1;
    await tick();
    return fakeDb;
  }),
}));

beforeEach(() => {
  columns = [...LEGACY_COLUMNS];
  openCount = 0;
});

describe('db init', () => {
  it('opens once and migrates once when several callers race at startup', async () => {
    await jest.isolateModulesAsync(async () => {
      const db = require('../db');

      // The real startup shape: hydration + a settings read + the sync engine
      // all reach for the database in the same tick.
      const [trips, setting] = await Promise.all([
        db.loadAllTrips(),
        db.getAppSetting('gender'),
        db.loadAllTrips(),
      ]);

      expect(trips).toEqual([]);
      expect(setting).toBeNull();
      expect(openCount).toBe(1);
      // Each shared-sync column added exactly once, by exactly one caller.
      expect(columns.filter((c) => c === 'nameUpdatedAt')).toHaveLength(1);
      expect(columns).toContain('shareIdentity');
    });
  });

  it('adds the shared-sync columns to a legacy table', async () => {
    await jest.isolateModulesAsync(async () => {
      const db = require('../db');
      await db.loadAllTrips();
      expect(columns).toContain('nameUpdatedAt');
      expect(columns).toContain('shareIdentity');
    });
  });

  it('survives another connection winning the same ADD COLUMN', async () => {
    await jest.isolateModulesAsync(async () => {
      const db = require('../db');
      // A second process adds the column between our PRAGMA and our ALTER.
      const realGetAll = fakeDb.getAllAsync;
      fakeDb.getAllAsync = async (sql: string) => {
        const rows = await realGetAll(sql);
        if (/PRAGMA table_info/.test(sql)) columns.push('nameUpdatedAt');
        return rows;
      };
      try {
        await expect(db.loadAllTrips()).resolves.toEqual([]);
      } finally {
        fakeDb.getAllAsync = realGetAll;
      }
    });
  });
});
