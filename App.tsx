/**
 * App root.
 *
 * Two-screen stack: TripsHome (root) + TripDetail. State lives in
 * useTripsStore (Zustand) — see src/store/trips.ts. Storage is SQLite via
 * src/store/db.ts; the store loads existing trips on mount and persists
 * every change in the background.
 *
 * Render gates: useAppFonts (so IBM Plex is loaded before first paint) AND
 * the store's hydrated flag (so we don't render an empty "no trips yet"
 * state for half a second when there are actually trips on disk).
 *
 * GestureHandlerRootView wraps everything — required by react-native-
 * reorderable-list (drag-reorder for items, spec build step 6) and any other
 * gesture-based library we add later.
 */

import React, { useEffect } from 'react';
import { useColorScheme, LogBox } from 'react-native';

// Silence a benign dev warning: react-native-reorderable-list nests its own
// VirtualizedList inside its ScrollViewContainer, which RN's blanket warning
// flags even though the lib is designed for it. Production builds hide all
// LogBox warnings; this just removes the noise during development.
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
]);
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAppFonts, lightColors, darkColors, typography } from './src/theme';
import { useTripsStore } from './src/store/trips';
import TripsHomeScreen from './src/screens/TripsHomeScreen';
import TripDetailScreen from './src/screens/TripDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';

export type RootStackParamList = {
  TripsHome: undefined;
  TripDetail: { tripId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function buildNavTheme(isDark: boolean): Theme {
  const c = isDark ? darkColors : lightColors;
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: c.bg,
      card: c.bg,
      text: c.fg,
      border: c.hairline,
      primary: c.fg,
    },
    fonts: {
      regular: { fontFamily: typography.body, fontWeight: '400' },
      medium: { fontFamily: typography.bodyEmphasis, fontWeight: '500' },
      bold: { fontFamily: typography.heading, fontWeight: '600' },
      heavy: { fontFamily: typography.heading, fontWeight: '600' },
    },
  };
}

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const [fontsLoaded] = useAppFonts();
  const hydrated = useTripsStore((s) => s.hydrated);
  const hydrate = useTripsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // SplashScreen stays visible until BOTH fonts and disk-loaded trips are
  // ready (no FOUT, no flash of "no trips yet" on a populated database).
  if (!fontsLoaded || !hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={buildNavTheme(isDark)}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack.Navigator
            initialRouteName="TripsHome"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="TripsHome" component={TripsHomeScreen} />
            <Stack.Screen name="TripDetail" component={TripDetailScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
