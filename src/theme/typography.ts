/**
 * Josh Approved typography system.
 *
 * Components reference roles, never raw font family names. If we swap families
 * later, only this file changes.
 */

export const fontFamilies = {
  'IBMPlexSans-Regular': 'IBMPlexSans-Regular',
  'IBMPlexSans-Medium': 'IBMPlexSans-Medium',
  'IBMPlexSans-SemiBold': 'IBMPlexSans-SemiBold',
  'IBMPlexMono-Regular': 'IBMPlexMono-Regular',
  'IBMPlexMono-Medium': 'IBMPlexMono-Medium',
} as const;

export type FontFamily = keyof typeof fontFamilies;

export const typography = {
  body: fontFamilies['IBMPlexSans-Regular'],
  bodyEmphasis: fontFamilies['IBMPlexSans-Medium'],
  heading: fontFamilies['IBMPlexSans-SemiBold'],
  mono: fontFamilies['IBMPlexMono-Regular'],
  monoEmphasis: fontFamilies['IBMPlexMono-Medium'],
} as const;

export type TypographyRole = keyof typeof typography;
