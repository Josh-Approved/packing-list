/**
 * Per-app brand accent — the ONE additional color this app declares
 * (file-type tags, progress fills, the app-icon glyph). In-app only:
 * never a primary CTA, never replaces approval green, never on marketing
 * surfaces. See josh-approved-design-system § Color.
 *
 * This file is APP-OWNED. `sync.mjs design-system-native` creates it once —
 * migrating the accent out of a pre-existing colors.ts if it finds one —
 * and never overwrites it again. Edit the hex here; colors.ts derives the
 * light and dark background washes from it, so one declaration is enough.
 */

export const APP_ACCENT = '#B58D3F';
