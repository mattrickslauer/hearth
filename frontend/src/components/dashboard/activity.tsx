import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RunEvent } from '@/lib/home';

import { ago } from './shared';

const EVENT_TONE: Record<string, { icon: string; label: string }> = {
  authored: { icon: '✍️', label: 'Authored' },
  edited: { icon: '✏️', label: 'Edited' },
  removed: { icon: '🗑️', label: 'Removed' },
  fired: { icon: '🔥', label: 'Fired' },
  held: { icon: '⏳', label: 'Held' },
  actuate: { icon: '⚡', label: 'Actuated' },
  notify: { icon: '📨', label: 'Notified' },
  offline: { icon: '📡', label: 'Offline' },
  reconnect: { icon: '🔌', label: 'Reconnected' },
};

/** The event log. `limit` trims it to a glance for the Home tab; Activity shows the lot. */
export function ActivityList({
  events,
  loading,
  limit,
}: {
  events: RunEvent[] | null;
  loading: boolean;
  limit?: number;
}) {
  const theme = useTheme();
  const shown = limit != null ? events?.slice(0, limit) : events;

  if (!shown?.length) {
    return (
      <View style={[styles.wrap, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.empty, { color: theme.textMuted }]}>
          {loading ? 'Loading…' : 'Nothing has happened yet.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {shown.map((ev, i) => {
        const tone = EVENT_TONE[ev.kind] ?? { icon: '•', label: ev.kind };
        return (
          <View
            key={ev.id}
            style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}>
            <Text style={styles.icon}>{tone.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kind, { color: theme.text }]}>
                {tone.label}
                {ev.evaluatedBy ? <Text style={{ color: theme.textMuted }}> · {ev.evaluatedBy}</Text> : null}
              </Text>
              {ev.reasoning ? (
                <Text style={[styles.reason, { color: theme.textSecondary }]}>{ev.reasoning}</Text>
              ) : null}
            </View>
            <Text style={[styles.time, { color: theme.textMuted }]}>{ago(ev.ts)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: 12 },
  icon: { fontSize: 15, width: 22, textAlign: 'center' },
  kind: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '700' },
  reason: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19, marginTop: 1 },
  time: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },
  empty: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20, paddingVertical: Spacing.three },
});
