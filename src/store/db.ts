/**
 * SQLite persistence layer for trips.
 *
 * Single-table-per-trip schema with JSON-encoded array columns
 * (typeIds, packers, items). This deliberately matches the v1.1
 * CloudKit plan from the spec ("items stored as a JSON blob on the
 * record") so the storage shape is consistent across local + cloud
 * and no relational migration is needed when sync lands.
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
} from '../data/trip';

const DB_NAME = 'packing-list.db';

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  // Fresh installs get the full shape. The three trip-info columns carry
  // legacy-safe DEFAULTs so the migration below can ADD them to an existing
  // table without rewriting any row: an old trip reads back as
  // canDoLaundry=0 / laundryIntervalDays=4 / thoroughness='normal', which is
  // exactly the pre-laundry, normal-thoroughness behavior.
  await _db.execAsync(`
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
      createdAt           INTEGER NOT NULL,
      updatedAt           INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      id        TEXT PRIMARY KEY NOT NULL,
      deletedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
  `);
  await migrateTripColumns(_db);
  return _db;
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
  for (const sql of adds) await db.execAsync(sql);
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
  createdAt: number;
  updatedAt: number;
}

function rowToTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    duration: row.duration,
    typeIds: JSON.parse(row.typeIds) as TripTypeId[],
    packers: JSON.parse(row.packers) as Packer[],
    items: JSON.parse(row.items) as TripItem[],
    canDoLaundry: row.canDoLaundry === 1,
    laundryIntervalDays: row.laundryIntervalDays || LAUNDRY_DEFAULT_INTERVAL,
    thoroughness: (row.thoroughness as Thoroughness) || THOROUGHNESS_DEFAULT,
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
        createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      trip.createdAt,
      trip.updatedAt,
    ]
  );
}

export async function deleteTripFromDb(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM trips WHERE id = ?', [id]);
}

// ---------- CloudKit sync support ----------
// Tombstones let a local delete propagate to other devices: without a record
// of "trip X was deleted at T" a pull would just re-adopt X from the cloud.

interface TombstoneRow {
  id: string;
  deletedAt: number;
}

export async function loadTombstones(): Promise<TombstoneRow[]> {
  const db = await getDb();
  return db.getAllAsync<TombstoneRow>('SELECT id, deletedAt FROM tombstones');
}

export async function putTombstone(id: string, deletedAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO tombstones (id, deletedAt) VALUES (?, ?)',
    [id, deletedAt]
  );
}

export async function removeTombstone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM tombstones WHERE id = ?', [id]);
}

export async function getSyncMeta(k: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ v: string }>(
    'SELECT v FROM sync_meta WHERE k = ?',
    [k]
  );
  return row?.v ?? null;
}

export async function setSyncMeta(k: string, v: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (k, v) VALUES (?, ?)',
    [k, v]
  );
}

// ---------- App settings (account-level prefs) ----------
// Same k/v shape as sync_meta but a separate table: these are user-facing
// preferences (gender, first-run prompt seen), not sync bookkeeping, and
// must never be entangled with the CloudKit sync cursor.

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
