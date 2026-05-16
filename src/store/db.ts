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
import type { Trip, TripItem, TripTypeId, Packer } from '../data/trip';

const DB_NAME = 'packing-list.db';

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS trips (
      id        TEXT PRIMARY KEY NOT NULL,
      name      TEXT NOT NULL,
      duration  INTEGER NOT NULL,
      typeIds   TEXT NOT NULL,
      packers   TEXT NOT NULL,
      items     TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      id        TEXT PRIMARY KEY NOT NULL,
      deletedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
  `);
  return _db;
}

interface TripRow {
  id: string;
  name: string;
  duration: number;
  typeIds: string;
  packers: string;
  items: string;
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
       (id, name, duration, typeIds, packers, items, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip.id,
      trip.name,
      trip.duration,
      JSON.stringify(trip.typeIds),
      JSON.stringify(trip.packers),
      JSON.stringify(trip.items),
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
