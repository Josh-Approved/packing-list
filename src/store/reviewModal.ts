/**
 * Cross-screen visibility flag for the review modal.
 *
 * The completion is detected as the user *leaves* Trip Detail, so the modal
 * can't live on that screen (it's unmounting). It's mounted on Trips Home
 * instead and driven by this tiny store: the Trip Detail beforeRemove
 * handler calls show(); Trips Home renders the modal when visible.
 *
 * Not persisted — a missed prompt (app killed between trigger and Home
 * render) is harmless; the canonical counter only advances on user action.
 */

import { create } from 'zustand';

interface ReviewModalState {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useReviewModal = create<ReviewModalState>()((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));
