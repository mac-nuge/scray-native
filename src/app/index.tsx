import { StyleSheet } from 'react-native';
import { ScrayWebView } from '../../modules/scray-native';

export default function HomeScreen() {
  return <ScrayWebView source="index.html" style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
