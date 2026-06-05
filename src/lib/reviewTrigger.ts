/**
 * App-side policy for what counts as a prompt "completion" (review + donation).
 *
 * The canonical review/donation modules (src/storage/reviewPrompt.ts,
 * donationPrompt.ts) are synced from the factory and unforked — they only
 * count completions and own the studio-wide thresholds/caps (review: first
 * prompt at the 2nd completion, cap 3; donation: first at the 5th, cap 2).
 * What a "completion" *is* is per-app latitude, and lives here.
 *
 * For Packing List a completion is: the user finished building a distinct
 * trip's list (left Trip Detail with at least one item). Two guards make it
 * land on roughly the 3rd trip, never on the first-list experience:
 *
 *   - Skip the very first trip the user ever builds (kept by id, so re-
 *     editing it never counts either).
 *   - Count each other trip at most once (dedupe by trip id).
 *
 * With the canonical "first prompt at 2nd completion" gate that yields:
 * trip 1 → skipped, trip 2 → completion #1 (no prompt), trip 3 → completion
 * #2 → review prompt.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordSuccessfulCompletion as recordReviewCompletion } from '../storage/reviewPrompt';
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

/** Which prompt (if any) to surface for this completion. At most one is true. */
export interface PromptDecision {
  review: boolean;
  donation: boolean;
}

const NO_PROMPT: PromptDecision = { review: false, donation: false };

/**
 * Call when the user leaves Trip Detail with a non-empty list. Applies the
 * skip-first + dedupe policy; on a genuine new completion, advances the
 * canonical counters and decides which prompt to show.
 *
 * Review takes precedence on the same completion — it burns slower (3 prompts
 * vs 2) and returning early means the donation counter doesn't tick, so the
 * next genuine completion is still eligible for the donation prompt.
 */
export async function recordTripBuildIfEligible(
  tripId: string
): Promise<PromptDecision> {
  const state = await load();

  if (state.firstTripId === null) {
    state.firstTripId = tripId; // their first list — exempt forever
    await save(state);
    return NO_PROMPT;
  }
  if (tripId === state.firstTripId) return NO_PROMPT;
  if (state.counted.includes(tripId)) return NO_PROMPT;

  state.counted.push(tripId);
  await save(state);

  if (await recordReviewCompletion()) return { review: true, donation: false };
  if (await recordDonationCompletion()) return { review: false, donation: true };
  return NO_PROMPT;
}
