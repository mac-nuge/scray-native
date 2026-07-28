import { StyleSheet } from 'react-native';
import { ScrayWebView } from '../../modules/scray-native';

// Your Surface's local IP + the port `npx serve` uses below.
// Find your IP with `ipconfig` (look for "IPv4 Address" under your Wi-Fi adapter).
const DEV_SERVER_URL = 'http://192.168.1.XX:8080/index.html';

export default function HomeScreen() {
  const source = __DEV__ ? DEV_SERVER_URL : 'index.html';
  return <ScrayWebView source={source} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
