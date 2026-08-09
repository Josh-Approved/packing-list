/**
 * Voice Control names — the accessible name must BE the visible name.
 *
 * Voice Control lets someone say the words they can SEE on a control, and it
 * matches those words against the accessibilityLabel. So a label that wraps the
 * visible text in extra words ("Assigned to Sam, tap to change" over a pill that
 * reads "Sam") makes the control unspeakable, and the App Store's Voice Control
 * claim becomes false.
 *
 * The trap is the locale, not the English: labels and visible text come from
 * different i18n keys, and a pair that reads as a clean prefix in English
 * inverts in verb-final German and Japanese. So these assert EQUALITY, not
 * "starts with" — the context belongs in accessibilityHint, which Voice Control
 * ignores and VoiceOver still reads.
 *
 * Every case here fails against the pre-2026-08-09 code.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-haptics', () => ({
  selectionAsync: () => Promise.resolve(),
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

import { Pill } from '../Pill';
import { Chip } from '../Chip';
import { Sun } from 'lucide-react-native';

describe('Voice Control names', () => {
  it('names an assignee pill by the packer name a user can see, not by a sentence', async () => {
    await render(
      <Pill label="Sam" active onPress={() => {}} accessibilityHint="Tap to change who packs this." />
    );

    // Speakable: the button's name is exactly the word on it.
    expect(screen.getByRole('button', { name: 'Sam' })).toBeTruthy();
  });

  it('keeps the pill context in the hint, and marks the active pill selected', async () => {
    await render(
      <Pill label="Sam" active onPress={() => {}} accessibilityHint="Tap to change who packs this." />
    );

    const pill = screen.getByRole('button', { name: 'Sam' });
    expect(pill.props.accessibilityHint).toBe('Tap to change who packs this.');
    // The active pill differs from an inactive one by accent fill AND a heavier
    // label; state carries it for anyone who can't see either.
    expect(pill.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('names a trip-type chip by its visible label and reports its checked state', async () => {
    await render(<Chip icon={Sun} label="Beach" selected onPress={() => {}} />);

    const chip = screen.getByRole('checkbox', { name: 'Beach' });
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  });

  it('lets a long name wrap rather than clipping the user’s own words', async () => {
    await render(<Pill label="Alexandra Constantinou" onPress={() => {}} />);

    // numberOfLines={1} would show LESS of someone's name the larger they set
    // their text. Two lines is the floor for user-typed content.
    const text = screen.getByText('Alexandra Constantinou');
    expect(text.props.numberOfLines).toBeGreaterThanOrEqual(2);
  });
});
