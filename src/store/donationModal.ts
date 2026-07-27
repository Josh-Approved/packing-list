/**
 * Cross-screen visibility flag for the donation modal.
 *
 * The completion is detected as the user *leaves* Trip Detail, so the modal
 * can't live on that screen (it's unmounting). It's mounted on Trips Home
 * instead and driven by this tiny store. The trigger policy lives in
 * src/lib/donationTrigger.ts. (The review prompt is unrelated — it is
 * session-based and owned by the app shell.)
 *
 * Not persisted — a missed prompt (app killed between trigger and Home render)
 * is harmless; the canonical counter only advances on user action.
 */

import { create } from 'zustand';

interface DonationModalState {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useDonationModal = create<DonationModalState>()((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));
