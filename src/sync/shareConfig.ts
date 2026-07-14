/**
 * Per-app share-link scheme. APP-OWNED — the factory syncs this file only if
 * it's absent, so each consuming app keeps its own value across re-syncs.
 *
 * Must match `expo.scheme` in the app's `app.json`. iOS's `Info.plist`
 * `CFBundleURLSchemes` array must include it too (Expo prebuild does this
 * from `expo.scheme`; verify after `expo run:ios`).
 *
 * Replace with this app's scheme on first sync, e.g. 'grocerylist'.
 */

export const SHARE_SCHEME = 'packinglist';
