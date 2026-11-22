/**
 * Share-link intake. Same cold-start bug a Grocery List customer reported on
 * 2026-10-24 ("the QR code opens the app but doesn't give the shared list"),
 * which this app had too: it joined straight from Linking.getInitialURL().
 *
 * The phone camera hands the link to a CLOSED app. The old handler joined the
 * moment `Linking.getInitialURL()` resolved, which is before the store has
 * read the disk; `hydrate()` then replaced the store and the joined list was
 * gone from the screen (it only came back after a full restart). It also tried
 * to open the list once, 500 ms in, while the splash was still up.
 *
 * Grocery List carries the store-level cold-start regression; these pin the
 * shared hook's contract in this app.
 */

import { Linking } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import {
  useShareLinkIntake,
  OPEN_RETRY_MS,
  OPEN_GIVE_UP_MS,
} from '../shareIntake';
import { buildShareLink } from '../share';

const SECRET = 'S'.repeat(44); // plausible base64 length

let initialUrl: string | null = null;
let urlListener: ((e: { url: string }) => void) | null = null;

beforeEach(() => {
  initialUrl = null;
  urlListener = null;
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(async () => initialUrl);
  jest
    .spyOn(Linking, 'addEventListener')
    .mockImplementation(((_: string, fn: (e: { url: string }) => void) => {
      urlListener = fn;
      return { remove: () => (urlListener = null) };
    }) as unknown as typeof Linking.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('cold start (the app was closed when the link was opened)', () => {
  it('does nothing with the link until the app is ready', async () => {
    initialUrl = buildShareLink(SECRET);
    const join = jest.fn(() => 'id-1');
    const open = jest.fn(() => true);
    const { rerender } = await renderHook(
      ({ ready }: { ready: boolean }) => useShareLinkIntake({ ready, join, open }),
      { initialProps: { ready: false } }
    );
    expect(join).not.toHaveBeenCalled();
    await rerender({ ready: true });
    expect(join).toHaveBeenCalledWith(SECRET);
    expect(open).toHaveBeenCalledWith('id-1');
  });

  it('keeps trying to open the list while navigation is still mounting', async () => {
    jest.useFakeTimers();
    initialUrl = buildShareLink(SECRET);
    let navReadyAfter = 4;
    const open = jest.fn(() => --navReadyAfter <= 0);
    await renderHook(() =>
      useShareLinkIntake({ ready: true, join: () => 'id-1', open })
    );
    await act(async () => {
      jest.advanceTimersByTime(OPEN_RETRY_MS * 10);
    });
    expect(open).toHaveBeenCalledTimes(4);
    expect(open).toHaveBeenLastCalledWith('id-1');
  });

  it('gives up opening (but stays joined) if navigation never comes up', async () => {
    jest.useFakeTimers();
    initialUrl = buildShareLink(SECRET);
    const join = jest.fn(() => 'id-1');
    const open = jest.fn(() => false);
    await renderHook(() => useShareLinkIntake({ ready: true, join, open }));
    await act(async () => {
      jest.advanceTimersByTime(OPEN_GIVE_UP_MS + OPEN_RETRY_MS * 5);
    });
    const calls = open.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(OPEN_RETRY_MS * 20);
    });
    expect(open.mock.calls.length).toBe(calls);
    expect(join).toHaveBeenCalledTimes(1);
  });
});

describe('warm start (the app was already running)', () => {
  it('joins and opens straight away', async () => {
    const join = jest.fn(() => 'id-2');
    const open = jest.fn(() => true);
    await renderHook(() => useShareLinkIntake({ ready: true, join, open }));
    await act(async () => {
      urlListener!({ url: buildShareLink(SECRET) });
    });
    expect(join).toHaveBeenCalledWith(SECRET);
    expect(open).toHaveBeenCalledWith('id-2');
  });

  it('treats the same link arriving twice on one launch as one', async () => {
    initialUrl = buildShareLink(SECRET);
    const join = jest.fn(() => 'id-3');
    const open = jest.fn(() => true);
    await renderHook(() => useShareLinkIntake({ ready: true, join, open }));
    await act(async () => {
      urlListener!({ url: buildShareLink(SECRET) });
    });
    expect(join).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('accepts old app-scheme links and ignores links that are not invites', async () => {
    const join = jest.fn(() => 'id-4');
    await renderHook(() =>
      useShareLinkIntake({ ready: true, join, open: () => true })
    );
    await act(async () => {
      urlListener!({ url: 'packinglist://somewhere-else' });
      urlListener!({ url: `packinglist://join?s=${encodeURIComponent(SECRET)}` });
    });
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith(SECRET);
  });
});
