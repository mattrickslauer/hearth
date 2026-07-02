import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlameMark } from '@/components/landing/flame-mark';
import { EmberButton, GlowOrb, Pill, Wordmark } from '@/components/landing/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function DemoScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.center}>
        <GlowOrb size={520} color={theme.emberGlow} style={styles.glow} />
        <View style={{ alignItems: 'center', gap: Spacing.four, maxWidth: 480 }}>
          <FlameMark size={52} />
          <Pill dotColor={theme.warn}>Simulated home · coming online</Pill>
          <Text style={[styles.title, { color: theme.text }]}>The live demo lands here.</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            This is where the browser-runnable Hearth demo will live: a simulated home with zones,
            sensors and actuators — describe something in plain words and watch Qwen wire it up, turn
            the world past dark, and see a deployment fire. No hardware required.
          </Text>
          <View style={{ marginTop: Spacing.two }}>
            <EmberButton label="Back to the landing" trailing="←" variant="ghost" size="lg" onPress={() => router.back()} />
          </View>
        </View>
        <View style={styles.foot}>
          <Wordmark size={18} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  glow: { position: 'absolute', top: '18%' },
  title: {
    fontFamily: Fonts?.sans,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  body: { fontFamily: Fonts?.sans, fontSize: 16, lineHeight: 25, textAlign: 'center' },
  foot: { position: 'absolute', bottom: Spacing.five, alignItems: 'center' },
});
