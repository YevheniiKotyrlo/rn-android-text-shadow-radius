import { StatusBar, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <TextShadows />
    </SafeAreaProvider>
  );
}

function TextShadows() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: safeAreaInsets.top + 16 }]}>
      <Text
        accessible
        accessibilityLabel="blurred shadow"
        style={[styles.sample, styles.blurred]}
      >
        Shadow
      </Text>
      <Text style={styles.caption}>
        textShadowOffset: {'{'}width: 0, height: 0{'}'}, textShadowRadius: 8
      </Text>
      <Text
        accessible
        accessibilityLabel="sharp shadow, radius 0"
        style={[styles.sample, styles.sharp, styles.radiusZero]}
      >
        Shadow
      </Text>
      <Text style={styles.caption}>
        textShadowOffset: {'{'}width: 4, height: 4{'}'}, textShadowRadius: 0
      </Text>
      <Text
        accessible
        accessibilityLabel="sharp shadow, radius 1"
        style={[styles.sample, styles.sharp, styles.radiusOne]}
      >
        Shadow
      </Text>
      <Text style={styles.caption}>
        textShadowOffset: {'{'}width: 4, height: 4{'}'}, textShadowRadius: 1
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  sample: {
    fontSize: 32,
    color: '#000000',
    textShadowColor: '#ff0000',
  },
  blurred: {
    padding: 32,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  sharp: {
    marginTop: 16,
    padding: 8,
    textShadowOffset: { width: 4, height: 4 },
  },
  radiusZero: {
    textShadowRadius: 0,
  },
  radiusOne: {
    textShadowRadius: 1,
  },
  caption: {
    fontSize: 12,
    color: '#57606a',
  },
});

export default App;
