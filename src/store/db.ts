/**
 * SQLite persistence layer for trips.
 *
 * Single-table-per-trip schema with JSON-encoded array columns
 * (typeIds, packers, items), so no relational migration is needed.
 *
 * All functions are async. Callers should fire-and-forget on writes
 * (catch silently — UI is the source of truth) and await on the
 * single hydration call at app start.
 */

import * as SQLite from 'expo-sqlite';
import {
  LAUNDRY_DEFAULT_INTERVAL,
  THOROUGHNESS_DEFAULT,
  type Trip,
  type TripItem,
  type TripTypeId,
  type Packer,
  type Thoroughness,
  type ShareIdentity,
} from '../data/trip';

const DB_NAME = 'packing-list.db';

let _db: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Memoizes the OPEN PROMISE, not the opened handle. Hydration, settings and
 * the sync engine all call this at startup, so caching only the resolved
 * handle let several callers run the open + migrate sequence concurrently:
 * each read PRAGMA table_info before any of them had ALTERed, so all of them
 * queued the same ADD COLUMN and the losers threw "duplicate column name",
 * failing the whole hydration ("failed to load trips from disk" = an empty
 * trip list on an upgrade install).
 */
function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = openAndMigrate().catch((err) => {
      _db = null; // a failed open must not be cached
      throw err;
    });
  }
  return _db;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Fresh installs get the full shape. The three trip-info columns carry
  // legacy-safe DEFAULTs so the migration below can ADD them to an existing
  // table without rewriting any row: an old trip reads back as
  // canDoLaundry=0 / laundryIntervalDays=4 / thoroughness='normal', which is
  // exactly the pre-laundry, normal-thoroughness behavior.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS trips (
      id                  TEXT PRIMARY KEY NOT NULL,
      name                TEXT NOT NULL,
      duration            INTEGER NOT NULL,
      typeIds             TEXT NOT NULL,
      packers             TEXT NOT NULL,
      items               TEXT NOT NULL,
      canDoLaundry        INTEGER NOT NULL DEFAULT 0,
      laundryIntervalDays INTEGER NOT NULL DEFAULT 4,
      thoroughness        TEXT NOT NULL DEFAULT 'normal',
      nameUpdatedAt       INTEGER NOT NULL DEFAULT 0,
      shareIdentity       TEXT,
      createdAt           INTEGER NOT NULL,
      updatedAt           INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
  `);
  await migrateTripColumns(db);
  return db;
}

/**
 * Idempotent additive migration for tables created before the trip-info
 * columns existed. ALTER TABLE ADD COLUMN with a constant DEFAULT is O(1) in
 * SQLite (no row rewrite) and safe to run on every open — we only ALTER the
 * columns PRAGMA table_info reports as missing.
 */
async function migrateTripColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(trips)`
  );
  const have = new Set(cols.map((c) => c.name));
  const adds: string[] = [];
  if (!have.has('canDoLaundry')) {
    adds.push(
      `ALTER TABLE trips ADD COLUMN canDoLaundry INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!have.has('laundryIntervalDays')) {
    adds.push(
      `ALTER TABLE trips ADD COLUMN laundryIntervalDays INTEGER NOT NULL DEFAULT 4`
    );
  }
  if (!have.has('thoroughness')) {
    adds.push(
      `ALTER TABLE trips ADD COLUMN thoroughness TEXT NOT NULL DEFAULT 'normal'`
    );
  }
  // Shared-sync columns (added when the feature landed). nameUpdatedAt defaults
  // to 0 → rowToTrip falls back to createdAt for legacy rows; shareIdentity is
  // nullable (absent until a trip is shared).
  if (!have.has('nameUpdatedAt')) {
    adds.push(
      `ALTER TABLE trips ADD COLUMN nameUpdatedAt INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!have.has('shareIdentity')) {
    adds.push(`ALTER TABLE trips ADD COLUMN shareIdentity TEXT`);
  }
  for (const sql of adds) {
    try {
      await db.execAsync(sql);
    } catch (err) {
      // Another connection (a second app instance, a restored background task)
      // may have added the same column between the PRAGMA and here. Losing that
      // race is fine — the column exists either way. Anything else is real.
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }
}

interface TripRow {
  id: string;
  name: string;
  duration: number;
  typeIds: string;
  packers: string;
  items: string;
  canDoLaundry: number;
  laundryIntervalDays: number;
  thoroughness: string;
  nameUpdatedAt: number | null;
  shareIdentity: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToTrip(row: TripRow): Trip {
  let shareIdentity: ShareIdentity | undefined;
  if (row.shareIdentity) {
    try {
      shareIdentity = JSON.parse(row.shareIdentity) as ShareIdentity;
    } catch {
      shareIdentity = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    // Legacy rows persisted before the name clock existed read back 0 → fall
    // back to createdAt (the name was set at creation).
    nameUpdatedAt: row.nameUpdatedAt || row.createdAt,
    duration: row.duration,
    typeIds: JSON.parse(row.typeIds) as TripTypeId[],
    packers: JSON.parse(row.packers) as Packer[],
    items: JSON.parse(row.items) as TripItem[],
    canDoLaundry: row.canDoLaundry === 1,
    laundryIntervalDays: row.laundryIntervalDays || LAUNDRY_DEFAULT_INTERVAL,
    thoroughness: (row.thoroughness as Thoroughness) || THOROUGHNESS_DEFAULT,
    shareIdentity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loadAllTrips(): Promise<Trip[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    'SELECT * FROM trips ORDER BY updatedAt DESC'
  );
  return rows.map(rowToTrip);
}

export async function saveTrip(trip: Trip): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO trips
       (id, name, duration, typeIds, packers, items,
        canDoLaundry, laundryIntervalDays, thoroughness,
        nameUpdatedAt, shareIdentity,
        createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip.id,
      trip.name,
      trip.duration,
      JSON.stringify(trip.typeIds),
      JSON.stringify(trip.packers),
      JSON.stringify(trip.items),
      trip.canDoLaundry ? 1 : 0,
      trip.laundryIntervalDays ?? LAUNDRY_DEFAULT_INTERVAL,
      trip.thoroughness ?? THOROUGHNESS_DEFAULT,
      trip.nameUpdatedAt ?? trip.createdAt,
      trip.shareIdentity ? JSON.stringify(trip.shareIdentity) : null,
      trip.createdAt,
      trip.updatedAt,
    ]
  );
}

export async function deleteTripFromDb(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM trips WHERE id = ?', [id]);
}

// ---------- App settings (account-level prefs) ----------
// User-facing preferences (gender, first-run prompt seen), stored locally.

export async function getAppSetting(k: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: string }>(
    'SELECT v FROM app_settings WHERE k = ?',
    [k]
  );
  return row?.v ?? null;
}

export async function setAppSetting(k: string, v: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO app_settings (k, v) VALUES (?, ?)',
    [k, v]
  );
}
