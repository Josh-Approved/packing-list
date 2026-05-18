/**
 * Account-level settings — Zustand state with disk-backed persistence.
 *
 * Mirrors the trips store: synchronous React state (UI feels instant) with
 * fire-and-forget SQLite writes, and a `hydrated` flag plus a one-shot
 * `hydrate()` called at app start.
 *
 * The only setting today is the gender preference used to pre-generate
 * gendered basics (see data/trip.ts § GenderPref). It is on-device only —
 * never synced, never sent anywhere — and 'unspecified' (the default, and
 * what dismissing the first-run prompt leaves) reproduces the pre-gender
 * behavior exactly.
 */

import { create } from 'zustand';
import type { GenderPref } from '../data/trip';
import { getAppSetting, setAppSetting } from './db';

const K_GENDER = 'gender';
const K_PROMPT_SEEN = 'genderPromptSeen';

function isGenderPref(v: string | null): v is GenderPref {
  return v === 'female' || v === 'male' || v === 'unspecified';
}

interface SettingsState {
  gender: GenderPref;
  /** True once the user has answered or dismissed the first-run prompt. */
  genderPromptSeen: boolean;
  /** True once the initial load from SQLite has completed (success or fail). */
  hydrated: boolean;

  /** Load settings from SQLite. Call once at app start. */
  hydrate: () => Promise<void>;

  /** Set the gender preference. Also marks the first-run prompt as seen — a
   *  deliberate choice (including "Prefer not to say" → 'unspecified') is an
   *  answer, so it never re-prompts. */
  setGender: (g: GenderPref) => void;

  /** Dismiss the first-run prompt without choosing. Gender stays whatever it
   *  was (default 'unspecified' = no gendered extras); the prompt won't show
   *  again — it's always changeable in Settings. */
  dismissGenderPrompt: () => void;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  gender: 'unspecified',
  genderPromptSeen: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const [g, seen] = await Promise.all([
        getAppSetting(K_GENDER),
        getAppSetting(K_PROMPT_SEEN),
      ]);
      set({
        gender: isGenderPref(g) ? g : 'unspecified',
        genderPromptSeen: seen === '1',
        hydrated: true,
      });
    } catch {
      // Fail open: unblock UI with defaults. Worst case the first-run prompt
      // shows again — harmless and still dismissible.
      set({ hydrated: true });
    }
  },

  setGender: (g) => {
    if (get().gender === g && get().genderPromptSeen) return;
    set({ gender: g, genderPromptSeen: true });
    setAppSetting(K_GENDER, g).catch((err) =>
      console.warn('packing-list: failed to persist gender', err)
    );
    setAppSetting(K_PROMPT_SEEN, '1').catch((err) =>
      console.warn('packing-list: failed to persist gender-prompt flag', err)
    );
  },

  dismissGenderPrompt: () => {
    if (get().genderPromptSeen) return;
    set({ genderPromptSeen: true });
    setAppSetting(K_PROMPT_SEEN, '1').catch((err) =>
      console.warn('packing-list: failed to persist gender-prompt flag', err)
    );
  },
}));
