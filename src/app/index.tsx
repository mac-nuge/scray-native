import { StyleSheet } from 'react-native';
import ScrayNativeView from '../../modules/scray-native/src/ScrayNativeView';

const DEV_SERVER_URL = 'http://192.168.1.209:8080/index.html';

export default function HomeScreen() {
  const source = __DEV__ ? DEV_SERVER_URL : 'index.html';
  return <ScrayNativeView source={source} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
