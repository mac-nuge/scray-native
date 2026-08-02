import Constants from 'expo-constants';
import { StyleSheet } from 'react-native';
import ScrayNativeView from '../../modules/scray-native/src/ScrayNativeView';

// Derives the dev server URL from whatever address Metro is actually
// running on right now, so it never needs manual updating when your
// Surface's IP changes (different Wi-Fi, DHCP renewal, etc.)
const debuggerHost = Constants.expoConfig?.hostUri?.split(':')[0];
const DEV_SERVER_URL = debuggerHost ? `http://${debuggerHost}:8080/index.html` : 'index.html';

export default function HomeScreen() {
  const source = __DEV__ ? DEV_SERVER_URL : 'index.html';
  return <ScrayNativeView source={source} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
