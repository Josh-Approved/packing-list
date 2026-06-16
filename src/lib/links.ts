/**
 * Canonical funding / feedback / review / privacy / source links.
 *
 * Single source of truth for every studio URL the app surfaces, so the
 * Settings/About screen, the tertiary footer, and the review prompt can't
 * drift apart. URLs are fixed studio-wide — do not localize or per-app them.
 */

import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';

export const BMAC_URL = 'https://buymeacoffee.com/jtysonwilliams';

/**
 * Gates every Buy Me a Coffee surface — the tertiary FundingFooter, the
 * Settings/About support row, and the soft donation prompt. Set false
 * 2026-06-16: Apple rejects external donation links for a for-profit app
 * (App Store guideline 3.1.1 — must be In-App Purchase). Flip back to true
 * when the IAP tip jar replaces the BMAC link.
 */
export const DONATIONS_ENABLED: boolean = false;

export const FEEDBACK_EMAIL = 'feedback@joshapproved.com';
export const REPO_URL = 'https://github.com/josh-approved/packing-list';
export const PRIVACY_URL =
  'https://github.com/josh-approved/packing-list/blob/master/PRIVACY.md';
export const STUDIO_URL = 'https://joshapproved.com';

// Numeric App Store Connect app id — matches eas.json
// submit.production.ios.ascAppId. Non-secret.
export const APP_STORE_ID = '6770051644';

// Android applicationId — matches app.json android.package. Used by the
// canonical ReviewModal for the Play Store write-review deep link.
export const ANDROID_PACKAGE = 'com.joshapproved.packinglist';

const APP_NAME = 'Packing List - Josh Approved';

/** "1.0.0 (1)" — read from the running bundle, never hardcoded. */
function versionAndBuild(): string {
  const v = Application.nativeApplicationVersion ?? '1.0.0';
  const b = Application.nativeBuildVersion ?? '1';
  return `${v} (${b})`;
}

/** "Version 1.0.0 (1)" — the Settings version-row string. */
export function versionLabel(): string {
  return `Version ${versionAndBuild()}`;
}

const open = (url: string) => {
  Linking.openURL(url).catch(() => {});
};

/** Canonical name used by synced shell components (FundingFooter). */
export function openUrl(url: string): void {
  open(url);
}

export function openBmac(): void {
  open(BMAC_URL);
}

export function openFeedback(): void {
  // Subject carries app + running version verbatim so support never has to
  // ask "what version are you on?".
  const subject = encodeURIComponent(`${APP_NAME} ${versionAndBuild()} — feedback`);
  open(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
}

/** Canonical name used by synced shell components (FundingFooter). */
export const openFeedbackMail = openFeedback;

export function openReview(): void {
  // Write-review deep link. Same per-platform URL form as the canonical
  // ReviewModal so the Settings row and the prompt resolve identically — on
  // Android the iOS-only itms-apps scheme is a no-op, so branch. Live
  // post-launch.
  const url =
    Platform.OS === 'ios'
      ? `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&showAllReviews=true`;
  open(url);
}

export function openPrivacy(): void {
  open(PRIVACY_URL);
}

export function openSource(): void {
  open(REPO_URL);
}

export function openStudio(): void {
  open(STUDIO_URL);
}
