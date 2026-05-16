/**
 * Canonical funding / feedback / review / privacy / source links.
 *
 * Single source of truth for every studio URL the app surfaces, so the
 * Settings/About screen, the tertiary footer, and the review prompt can't
 * drift apart. URLs are fixed by josh-approved-factory/canonical-requirements.md
 * § Funding & feedback — do not localize or per-app them.
 */

import { Linking } from 'react-native';
import * as Application from 'expo-application';

export const BMAC_URL = 'https://buymeacoffee.com/jtysonwilliams';
export const FEEDBACK_EMAIL = 'feedback@joshapproved.com';
export const REPO_URL = 'https://github.com/josh-approved/packing-list';
export const PRIVACY_URL =
  'https://github.com/josh-approved/packing-list/blob/master/PRIVACY.md';

// Numeric App Store Connect app id — matches eas.json
// submit.production.ios.ascAppId. Non-secret.
export const APP_STORE_ID = '6770051644';

// Android applicationId — matches app.json android.package. Used by the
// canonical ReviewModal for the Play Store write-review deep link.
export const ANDROID_PACKAGE = 'com.joshapproved.packinglist';

const APP_NAME = 'Packing List';

/** "1.0.0 (1)" — read from the running bundle, never hardcoded. */
export function versionAndBuild(): string {
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

export function openBmac(): void {
  open(BMAC_URL);
}

export function openFeedback(): void {
  // Subject carries app + running version verbatim so support never has to
  // ask "what version are you on?".
  const subject = encodeURIComponent(`${APP_NAME} ${versionAndBuild()} — feedback`);
  open(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
}

export function openReview(): void {
  // iOS write-review deep link. Resolves once the app is live on the store.
  open(`itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`);
}

export function openPrivacy(): void {
  open(PRIVACY_URL);
}

export function openSource(): void {
  open(REPO_URL);
}
