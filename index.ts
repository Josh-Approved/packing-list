// react-native-gesture-handler requires being imported at the very top of the
// entry file, before anything else. Required by react-native-reorderable-list
// (drag-reorder for items) and other gesture-based libs.
import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
