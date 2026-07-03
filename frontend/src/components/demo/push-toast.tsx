import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';

import { FlameMark } from '@/components/landing/flame-mark';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A phone-style push notification that slides in when a watch fires. */
export function PushToast({ text }: { text: string | null }) {
  const theme = useTheme();
  if (!text) return null;
  return (
    <Animated.View
      entering={FadeInUp.duration(320)}
      exiting={FadeOut.duration(240)}
      style={[styles.toast, { backgroundColor: theme.cardElevated, borderColor: theme.borderStrong }]}
      pointerEvents="none">
      <View style={[styles.icon, { backgroundColor: theme.emberGlow, borderColor: theme.border }]}>
        <FlameMark size={20} />
      </View>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={[styles.app, { color: theme.text }]}>Hearth</Text>
          <Text style={[styles.now, { color: theme.textMuted }]}>now</Text>
        </View>
        <Text style={[styles.msg, { color: theme.textSecondary }]}>{text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: Spacing.five,
    alignSelf: 'center',
    maxWidth: 420,
    width: '92%',
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 3, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  app: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '800', letterSpacing: -0.2 },
  now: { fontFamily: Fonts?.mono, fontSize: 11 },
  msg: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 19, fontWeight: '500' },
});
