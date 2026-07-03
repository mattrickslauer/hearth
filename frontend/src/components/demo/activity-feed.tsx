import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { ActivityEvent } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]}>Activity & reasoning</Text>
        <View style={[styles.live, { borderColor: theme.border }]}>
          <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
          <Text style={[styles.liveText, { color: theme.textMuted }]}>live</Text>
        </View>
      </View>

      {events.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>
            Describe a watch, then poke the world — open the garage, drop the temperature, send
            someone to the door. Every time a watch reasons or fires, it explains itself here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {events.map((ev, i) => (
            <Animated.View key={ev.id} entering={i === 0 ? FadeInDown.duration(320) : undefined}>
              <EventRow ev={ev} />
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
}

function EventRow({ ev }: { ev: ActivityEvent }) {
  const theme = useTheme();

  if (!ev.judgment) {
    // authored / offline notices — quiet one-liners
    const map: Record<string, { icon: string; text: string; color: string }> = {
      authored: { icon: '✍️', text: `Compiled “${ev.questionTitle}”`, color: theme.textSecondary },
      offline: {
        icon: '📡',
        text: `Held “${ev.questionTitle}” — offline, needs cloud reasoning`,
        color: theme.warn,
      },
    };
    const m = map[ev.kind] ?? { icon: '•', text: ev.questionTitle, color: theme.textSecondary };
    return (
      <View style={styles.note}>
        <Text style={styles.noteIcon}>{m.icon}</Text>
        <Text style={[styles.noteText, { color: m.color }]}>{m.text}</Text>
        <Text style={[styles.noteTime, { color: theme.textMuted }]}>{ev.time}</Text>
      </View>
    );
  }

  const j = ev.judgment;
  const accent =
    ev.kind === 'held'
      ? theme.success
      : ev.kind === 'reconnect'
        ? theme.info
        : theme.ember;
  const vIcon = ev.kind === 'held' ? '✓' : ev.kind === 'reconnect' ? '⛅' : '⚠';

  return (
    <View style={[styles.trace, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      <View style={[styles.rule, { backgroundColor: accent }]} />
      <View style={styles.traceBody}>
        <View style={styles.traceHead}>
          <Text style={[styles.time, { color: theme.textMuted }]}>{ev.time}</Text>
          <Text style={[styles.depTitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {ev.questionTitle}
          </Text>
          <View style={[styles.verdict, { backgroundColor: accent + '22' }]}>
            <Text style={[styles.verdictText, { color: accent }]}>
              {vIcon} {j.verdict}
            </Text>
          </View>
        </View>

        <Text style={[styles.reason, { color: theme.text }]}>{j.reasoning}</Text>

        {ev.detail ? (
          <Text style={[styles.detail, { color: accent }]}>⏱ {ev.detail}</Text>
        ) : null}

        {j.steps.length ? (
          <View style={styles.steps}>
            {j.steps.map((s, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={[styles.arrow, { color: accent }]}>↳</Text>
                <Text style={[styles.stepText, { color: theme.textSecondary }]}>{s}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {j.privacyNote ? (
          <View style={[styles.privacy, { borderTopColor: theme.border }]}>
            <Text style={[styles.lock, { color: theme.success }]}>🔒</Text>
            <Text style={[styles.privacyText, { color: theme.textMuted }]}>{j.privacyNote}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.four, gap: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700' },
  empty: { paddingVertical: Spacing.four },
  emptyText: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 21 },
  list: { gap: Spacing.two },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  noteIcon: { fontSize: 13 },
  noteText: { flex: 1, fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '500' },
  noteTime: { fontFamily: Fonts?.mono, fontSize: 11 },
  trace: { flexDirection: 'row', borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  rule: { width: 3 },
  traceBody: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  traceHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  time: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '600' },
  depTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '600' },
  verdict: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.sm },
  verdictText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  reason: { fontFamily: Fonts?.sans, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  detail: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },
  steps: { gap: 4 },
  stepRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  arrow: { fontFamily: Fonts?.mono, fontSize: 14, lineHeight: 20 },
  stepText: { flex: 1, fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 20 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  lock: { fontSize: 12 },
  privacyText: { fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '500' },
});
