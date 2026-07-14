/**
 * App root.
 *
 * The shell (<AppShell/>) owns the chrome — gesture root, safe-area provider,
 * error boundary, the themed NavigationContainer + status bar, and the
 * cold-start splash. App.tsx owns only the readiness gate, the screen list,
 * and this app's startup effects (hydrating the trips + settings stores).
 *
 * Two-screen stack: TripsHome (root) + TripDetail. State lives in
 * useTripsStore (Zustand) — see src/store/trips.ts. Storage is SQLite via
 * src/store/db.ts; the store loads existing trips on mount and persists
 * every change in the background.
 *
 * Render gate: useAppFonts (so IBM Plex is loaded before first paint) AND
 * both stores' hydrated flags (so we don't render an empty "no trips yet"
 * state for half a second when there are actually trips on disk).
 */

import React, { useEffect } from 'react';
import { LogBox, Linking, AppState } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { createNavigationContainerRef } from '@react-navigation/native';

// Silence a benign dev warning: react-native-reorderable-list nests its own
// VirtualizedList inside its ScrollViewContainer, which RN's blanket warning
// flags even though the lib is designed for it. Production builds hide all
// LogBox warnings; this just removes the noise during development.
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
]);

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppFonts } from './src/theme';
import { AppShell } from './src/shell/AppShell';
import { useTripsStore } from './src/store/trips';
import { useSettingsStore } from './src/store/settings';
import TripsHomeScreen from './src/screens/TripsHomeScreen';
import TripInfoScreen from './src/screens/TripInfoScreen';
import TripDetailScreen from './src/screens/TripDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShareScreen from './src/screens/ShareScreen';
import Credits from './src/components/Credits';
import { startSyncEngine, stopSyncEngine, flushSyncEngine } from './src/sync';
import { parseShareLink } from './src/sync/share';
import { QA_MODE } from './src/qa/qaMode';

// Hold the native launch screen until the JS splash is mounted to take over, so
// the icon never blinks out between the two. AppShell owns hiding it via
// AnimatedSplash. Skipped under QA_MODE so the e2e screenshot harness sees
// deterministic frames.
if (!QA_MODE) {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

export type RootStackParamList = {
  TripsHome: undefined;
  /** Step 1 — Trip Information. No tripId = create flow (a trip is only
   *  minted on Continue). With tripId = edit an existing trip's info. */
  TripInfo: { tripId?: string } | undefined;
  TripDetail: { tripId: string };
  Settings: undefined;
  Share: { tripId: string };
  Acknowledgements: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const [fontsLoaded] = useAppFonts();
  const hydrated = useTripsStore((s) => s.hydrated);
  const hydrate = useTripsStore((s) => s.hydrate);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    hydrateSettings();
  }, [hydrate, hydrateSettings]);

  // Sync engine: start once the local store is ready, stop on teardown.
  useEffect(() => {
    if (!hydrated) return;
    startSyncEngine();
    return () => stopSyncEngine();
  }, [hydrated]);

  // On the way to the background, durably flush local state and push the latest
  // copy to peers immediately. Without this, a change made just before switching
  // apps can be lost (fire-and-forget save not yet landed) or never published
  // (the 700ms publish debounce is suspended mid-wait).
  useEffect(() => {
    if (!hydrated) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive' || next === 'background') {
        flushSyncEngine();
        useTripsStore.getState().flushPending();
      }
    });
    return () => sub.remove();
  }, [hydrated]);

  // Pairing via a tapped share link: join the shared trip, open it.
  useEffect(() => {
    const handle = (url: string | null) => {
      const secret = url ? parseShareLink(url) : null;
      if (!secret) return;
      const id = useTripsStore.getState().joinShared(secret);
      const go = () => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('TripDetail', { tripId: id });
          return true;
        }
        return false;
      };
      if (!go()) setTimeout(go, 500);
    };
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  // Content is ready once fonts AND disk-loaded data are in (no FOUT, no flash
  // of "no trips yet" on a populated database).
  const ready = fontsLoaded && hydrated && settingsHydrated;

  return (
    <AppShell ready={ready} navigationRef={navigationRef}>
      <Stack.Navigator
        initialRouteName="TripsHome"
        screenOptions={{ headerShown: false, animation: QA_MODE ? 'none' : undefined }}
      >
        <Stack.Screen name="TripsHome" component={TripsHomeScreen} />
        <Stack.Screen name="TripInfo" component={TripInfoScreen} />
        <Stack.Screen name="TripDetail" component={TripDetailScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="Share"
          component={ShareScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen name="Acknowledgements">
          {(props) => <Credits onBack={() => props.navigation.goBack()} />}
        </Stack.Screen>
      </Stack.Navigator>
    </AppShell>
  );
}
