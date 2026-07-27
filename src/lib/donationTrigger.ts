/**
 * App-side policy for what counts as a "completion" for the donation prompt.
 *
 * The canonical donation module (src/storage/donationPrompt.ts) is synced from
 * the factory and unforked — it only counts completions and owns the
 * studio-wide threshold/cap (first prompt at the 5th completion, cap 2). What
 * a "completion" *is* is per-app latitude, and lives here.
 *
 * For Packing List a completion is: the user finished building a distinct
 * trip's list (left Trip Detail with at least one item). Two guards keep it
 * well clear of the first-list experience:
 *
 *   - Skip the very first trip the user ever builds (kept by id, so re-
 *     editing it never counts either).
 *   - Count each other trip at most once (dedupe by trip id).
 *
 * The review prompt used to share this policy. It no longer does: the review
 * prompt is session-based and fired entirely by the app shell (see
 * src/shell/AppShell.tsx and the `review` prop in App.tsx), so this file drives
 * the donation prompt only. The storage key keeps its original name so existing
 * installs carry their already-counted trips forward.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordSuccessfulCompletion as recordDonationCompletion } from '../storage/donationPrompt';

const KEY = '@packing-list/review-trips';

interface TripBuildState {
  /** Id of the first trip ever built — permanently exempt. */
  firstTripId: string | null;
  /** Ids of distinct trips already counted as completions. */
  counted: string[];
}

const EMPTY: TripBuildState = { firstTripId: null, counted: [] };

async function load(): Promise<TripBuildState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

async function save(state: TripBuildState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Best-effort — a lost write at worst delays/repeats one prompt.
  }
}

/**
 * Call when the user leaves Trip Detail with a non-empty list. Applies the
 * skip-first + dedupe policy; on a genuine new completion, advances the
 * canonical counter and returns true when the donation prompt should show.
 */
export async function recordTripBuildIfEligible(tripId: string): Promise<boolean> {
  const state = await load();

  if (state.firstTripId === null) {
    state.firstTripId = tripId; // their first list — exempt forever
    await save(state);
    return false;
  }
  if (tripId === state.firstTripId) return false;
  if (state.counted.includes(tripId)) return false;

  state.counted.push(tripId);
  await save(state);

  return recordDonationCompletion();
}
