import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TraceStep = { text: string };

/**
 * The reasoning motif: a quiet left-rule "trace" block with ↳ step markers.
 * This is how the agent's thinking is made recognizable throughout the product —
 * the thing judges remember: "it's an agent, not a sensor."
 */
export function ReasoningTrace({
  time = '14:02',
  verdict = 'MATCH',
  body = 'The person at the door isn’t in your household set. The first frame was unclear, so I panned the camera to get a clean look at the face.',
  steps = [
    { text: 'looked closer — aimed camera +20°' },
    { text: 'confirmed: not a household member' },
    { text: 'notified you (push)' },
  ],
  privacyNote = 'raw frame never left your home',
}: {
  time?: string;
  verdict?: string;
  body?: string;
  steps?: TraceStep[];
  privacyNote?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.codeBg, borderColor: theme.border },
      ]}>
      <View style={[styles.rule, { backgroundColor: theme.ember }]} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={[styles.time, { color: theme.textMuted }]}>{time}</Text>
          <View style={[styles.verdict, { backgroundColor: theme.warn + '22' }]}>
            <Text style={[styles.verdictText, { color: theme.warn }]}>⚠ {verdict}</Text>
          </View>
        </View>

        <Text style={[styles.reason, { color: theme.text }]}>{body}</Text>

        <View style={styles.steps}>
          {steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={[styles.arrow, { color: theme.ember }]}>↳</Text>
              <Text style={[styles.stepText, { color: theme.textSecondary }]}>{s.text}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.privacyRow, { borderTopColor: theme.border }]}>
          <Text style={[styles.lock, { color: theme.success }]}>🔒</Text>
          <Text style={[styles.privacy, { color: theme.textMuted }]}>{privacyNote}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rule: { width: 3 },
  body: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  time: { fontFamily: Fonts?.mono, fontSize: 13, fontWeight: '600' },
  verdict: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.sm },
  verdictText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  reason: { fontFamily: Fonts?.sans, fontSize: 16, lineHeight: 25, fontWeight: '500' },
  steps: { gap: Spacing.two },
  stepRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  arrow: { fontFamily: Fonts?.mono, fontSize: 15, lineHeight: 22 },
  stepText: { fontFamily: Fonts?.sans, fontSize: 14.5, lineHeight: 22, flex: 1 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
  },
  lock: { fontSize: 13 },
  privacy: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '500' },
});
