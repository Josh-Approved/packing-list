/**
 * Edge-inset audit over this app's own screens — APP-OWNED: seeded once by
 * `sync.mjs qa`, never overwritten.
 *
 * src/qa/edgeInset.ts (canonical) fails when text or an icon sits closer than
 * 8pt to the inside edge of a card, sheet, row or button; the canonical
 * edgeInset.proof.test.tsx proves it catches the shape that shipped.
 *
 * What belongs here: Settings, and every screen, sheet or pane that draws a
 * card, a filled or bordered row, or a labelled button. Each renders with the
 * QA seed trip on file (the Greece beach trip, three packers, its composed
 * item list) so trip cards, item rows, pills and steppers actually appear. A
 * new screen or sheet gets a line here in the same PR. qa-canonical
 * `test/edge-inset-screens` warns while this file renders none of the app's
 * screens or components.
 *
 * Fixing a finding: give the content room inside the surface, usually the
 * container's own `paddingHorizontal: space.s5`, rather than padding each row.
 * The shell's sheets listed here (dialogs, feedback, review, tip jar,
 * acknowledgements) are canonical: a finding in one is fixed in the factory
 * template and re-synced, never forked here.
 */

import React, { useEffect } from 'react';

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
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
// SQLite can't load in node; persistence is fire-and-forget and not under test.
jest.mock('../../store/db', () => ({
  loadAllTrips: () => Promise.resolve([]),
  saveTrip: () => Promise.resolve(),
  deleteTripFromDb: () => Promise.resolve(),
  getAppSetting: () => Promise.resolve(null),
  setAppSetting: () => Promise.resolve(),
}));
jest.mock('../../storage/kv', () => ({
  getSyncMeta: () => Promise.resolve(null),
  setSyncMeta: () => Promise.resolve(),
}));
// The relay engine (websockets + ESM-only @noble crypto). The sync bar reads
// its status from the real in-memory status store; only the resync tap is stubbed.
jest.mock('../../sync', () => ({ resyncNow: jest.fn() }));
// The OS rating sheet is unavailable here, so the review prompt draws its own
// fallback modal (the one surface of it the app renders).
jest.mock('expo-store-review', () => ({
  isAvailableAsync: () => Promise.resolve(false),
  requestReview: () => Promise.resolve(),
}));
// Real price buttons, so the audit sees the tip tiers as they render.
jest.mock('../../lib/tipJar', () => {
  const { TIP_PRODUCT_IDS } = require('../../constants/tipProducts');
  return {
    isStoreKnownUnavailable: () => false,
    useTipJar: () => ({
      status: 'ready',
      products: TIP_PRODUCT_IDS.map((id: string) => ({ id, displayPrice: '$2.99' })),
      pendingSku: null,
      tip: jest.fn(),
    }),
  };
});
// The pull-to-reveal footer is reanimated + gesture-handler worklets: native
// machinery with no bearing on padding. The screens' own layout stays real.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    interpolate: (v: number, inRange: number[], outRange: number[]) =>
      outRange[0] + (v - inRange[0]) * (outRange[1] - outRange[0]),
  };
});
jest.mock('../../components/usePullRevealFooter', () => ({
  usePullRevealFooter: () => ({
    pullToReveal: false,
    reveal: { value: 0 },
    gesture: {},
    onScroll: undefined,
    onScrollJS: jest.fn(),
    onScrollViewLayout: jest.fn(),
    onContentSizeChange: jest.fn(),
    footerHeight: 0,
    onFooterLayout: jest.fn(),
  }),
}));
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    GestureHandlerRootView: View,
  };
});
// Drag-to-reorder is a reanimated/gesture list; render its rows in plain
// Views so the item rows themselves (real ItemRow) are what gets audited.
jest.mock('react-native-reorderable-list', () => {
  const R = require('react');
  const { View, ScrollView } = require('react-native');
  return {
    ScrollViewContainer: R.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => <ScrollView ref={ref} {...props} />
    ),
    NestedReorderableList: ({
      data,
      renderItem,
      keyExtractor,
    }: {
      data: unknown[];
      renderItem: (a: { item: unknown; index: number }) => React.ReactNode;
      keyExtractor: (item: unknown, index: number) => string;
    }) => (
      <View>
        {data.map((item, index) => (
          <R.Fragment key={keyExtractor(item, index)}>{renderItem({ item, index })}</R.Fragment>
        ))}
      </View>
    ),
    useReorderableDrag: () => jest.fn(),
  };
});

import { auditScreen } from '../edgeInsetAudit';
import { qaTrips } from '../fixtures';
import TripsHomeScreen from '../../screens/TripsHomeScreen';
import TripDetailScreen from '../../screens/TripDetailScreen';
import TripInfoScreen from '../../screens/TripInfoScreen';
import ShareScreen from '../../screens/ShareScreen';
import SettingsScreen from '../../screens/SettingsScreen';
import { UndoBar } from '../../screens/tripDetail/UndoBar';
import { makeStyles as makeTripDetailStyles } from '../../screens/tripDetail/styles';
import Credits from '../../components/Credits';
import GenderPrompt from '../../components/GenderPrompt';
import TipJarSheet from '../../components/TipJarSheet';
import ReviewModal from '../../components/ReviewModal';
import { useActionMenu, usePrompt } from '../../components/Dialogs';
import { FeedbackSheet } from '../../feedback/FeedbackSheet';
import { TIP_PRODUCT_IDS } from '../../constants/tipProducts';
import { APP_STORE_ID, ANDROID_PACKAGE } from '../../lib/links';
import { CATEGORY_ORDER } from '../../data/trip';
import { useTripsStore } from '../../store/trips';
import { useSettingsStore } from '../../store/settings';
import { useSyncStatusStore } from '../../sync/status';
import { useTheme } from '../../theme';

/* eslint-disable @typescript-eslint/no-explicit-any */
const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => () => {}),
} as any;
const route = (name: string, params?: object) => ({ key: name, name, params }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */
const noop = () => {};

const TRIP_ID = 'qa-greece';
const SECRET = 'edge-inset-audit-secret';

/** The QA seed trip, shared (so the live-sync bar shows), laundry on (so the
 *  laundry stepper shows on Trip info), one item packed (checked checkbox). */
function seedTrip() {
  const [trip] = qaTrips();
  return {
    ...trip,
    canDoLaundry: true,
    shareIdentity: { secret: SECRET, createdAt: trip.createdAt },
    items: trip.items.map((it, i) => (i === 0 ? { ...it, packed: true } : it)),
  };
}

/** The snackbar takes Trip detail's styles; build them the way the screen does. */
function UndoBarHarness() {
  const { c } = useTheme();
  return <UndoBar itemName="Sunscreen" onUndo={noop} s={makeTripDetailStyles(c)} />;
}

function ActionMenuHarness() {
  const menu = useActionMenu();
  useEffect(() => {
    menu.open({ title: 'Category', options: CATEGORY_ORDER.map((label) => ({ label, onPress: noop })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return menu.element;
}

function PromptHarness() {
  const prompt = usePrompt();
  useEffect(() => {
    prompt.open({ title: 'Rename trip', initialValue: 'Greece', onSubmit: noop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return prompt.element;
}

beforeEach(() => {
  useTripsStore.setState({ trips: [seedTrip()], hydrated: true });
  useSettingsStore.setState({ gender: 'unspecified', genderPromptSeen: true, hydrated: true });
  useSyncStatusStore.setState({
    bySecret: {
      [SECRET]: { connected: true, lastReceivedAt: null, lastSentAt: null, publishRejected: false },
    },
  });
});

describe("edge-inset audit — this app's screens", () => {
  it('Settings', async () => {
    expect(
      await auditScreen(<SettingsScreen navigation={navigation} route={route('Settings')} />)
    ).toEqual([]);
  });

  it('Trips home (with a trip)', async () => {
    expect(
      await auditScreen(<TripsHomeScreen navigation={navigation} route={route('TripsHome')} />, {
        readyText: 'Greece',
      })
    ).toEqual([]);
  });

  it('Trips home (no trips yet)', async () => {
    useTripsStore.setState({ trips: [] });
    expect(
      await auditScreen(<TripsHomeScreen navigation={navigation} route={route('TripsHome')} />)
    ).toEqual([]);
  });

  it('Trip detail (shared trip, three packers)', async () => {
    expect(
      await auditScreen(
        <TripDetailScreen navigation={navigation} route={route('TripDetail', { tripId: TRIP_ID })} />,
        { readyText: 'Greece' }
      )
    ).toEqual([]);
  });

  it('Trip detail (solo packer)', async () => {
    useTripsStore.setState({
      trips: [{ ...seedTrip(), packers: [{ id: 'me', name: 'Me' }], shareIdentity: undefined }],
    });
    expect(
      await auditScreen(
        <TripDetailScreen navigation={navigation} route={route('TripDetail', { tripId: TRIP_ID })} />,
        { readyText: 'Greece' }
      )
    ).toEqual([]);
  });

  it('Trip detail undo bar', async () => {
    expect(await auditScreen(<UndoBarHarness />)).toEqual([]);
  });

  it('Trip info (new trip)', async () => {
    expect(
      await auditScreen(<TripInfoScreen navigation={navigation} route={route('TripInfo')} />)
    ).toEqual([]);
  });

  it('Trip info (editing, laundry on)', async () => {
    expect(
      await auditScreen(
        <TripInfoScreen navigation={navigation} route={route('TripInfo', { tripId: TRIP_ID })} />
      )
    ).toEqual([]);
  });

  it('Share', async () => {
    expect(
      await auditScreen(<ShareScreen navigation={navigation} route={route('Share', { tripId: TRIP_ID })} />)
    ).toEqual([]);
  });

  it('Acknowledgements', async () => {
    expect(await auditScreen(<Credits onBack={noop} />)).toEqual([]);
  });

  it('Gender prompt', async () => {
    useSettingsStore.setState({ genderPromptSeen: false });
    expect(await auditScreen(<GenderPrompt />)).toEqual([]);
  });

  it('Action menu (category picker)', async () => {
    expect(await auditScreen(<ActionMenuHarness />, { readyText: 'Toiletries' })).toEqual([]);
  });

  it('Text prompt (rename trip)', async () => {
    expect(await auditScreen(<PromptHarness />, { readyText: 'Rename trip' })).toEqual([]);
  });

  it('Feedback sheet (pick a kind)', async () => {
    expect(
      await auditScreen(<FeedbackSheet visible onClose={noop} />, { readyText: 'Report a bug' })
    ).toEqual([]);
  });

  it('Feedback sheet (bug report form)', async () => {
    expect(
      await auditScreen(<FeedbackSheet visible initialType="bug" onClose={noop} />, {
        readyText: 'What happened?',
      })
    ).toEqual([]);
  });

  it('Review prompt (fallback modal)', async () => {
    expect(
      await auditScreen(
        <ReviewModal
          visible
          onDismiss={noop}
          appName="Packing List"
          iosAppStoreId={APP_STORE_ID}
          androidPackageName={ANDROID_PACKAGE}
        />,
        { readyText: 'Enjoying Packing List?' }
      )
    ).toEqual([]);
  });

  it('Tip jar sheet', async () => {
    expect(
      await auditScreen(<TipJarSheet visible onDismiss={noop} productIds={TIP_PRODUCT_IDS} />)
    ).toEqual([]);
  });
});
