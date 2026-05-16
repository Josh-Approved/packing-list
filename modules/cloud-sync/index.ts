/**
 * JS face of the native CloudSync module (private CloudKit).
 *
 * `requireOptionalNativeModule` returns null when the native side isn't in
 * the binary — Android, Expo Go, or any build made before this module
 * landed. Every caller must treat `null` as "cloud unavailable, stay
 * local"; the app is fully functional offline-only and CloudKit is purely
 * additive backup/sync.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

export type CloudAccountStatus =
  | 'available'
  | 'noAccount'
  | 'restricted'
  | 'temporarilyUnavailable'
  | 'couldNotDetermine';

export interface RemoteTripRecord {
  /** recordName == the app's trip id */
  id: string;
  /** whole Trip serialized as JSON */
  payload: string;
  /** trip.updatedAt at write time (ms since epoch) */
  modifiedAt: number;
  /** soft-delete tombstone flag */
  deleted: boolean;
}

interface CloudSyncNative {
  accountStatus(): Promise<CloudAccountStatus>;
  fetchAll(): Promise<RemoteTripRecord[]>;
  putTrip(
    id: string,
    payload: string,
    modifiedAt: number,
    deleted: boolean
  ): Promise<void>;
}

const native = requireOptionalNativeModule<CloudSyncNative>('CloudSync');

/** True only when the native module is present in this binary (iOS dev/prod build). */
export const isCloudSyncAvailable = native != null;

export const CloudSync: CloudSyncNative | null = native;
