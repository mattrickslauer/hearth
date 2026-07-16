import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RunEvent } from '@/lib/home';

import { ago } from './shared';

const EVENT_TONE: Record<string, { icon: string; label: string }> = {
  authored: { icon: '✍️', label: 'Authored' },
  edited: { icon: '✏️', label: 'Edited' },
  removed: { icon: '🗑️', label: 'Removed' },
  judged: { icon: '👁️', label: 'Looked' },
  fired: { icon: '🔥', label: 'Fired' },
  held: { icon: '⏳', label: 'Held' },
  actuate: { icon: '⚡', label: 'Actuated' },
  notify: { icon: '📨', label: 'Notified' },
  offline: { icon: '📡', label: 'Offline' },
  reconnect: { icon: '🔌', label: 'Reconnected' },
};

/**
 * Sub-cent costs are the norm here — a Look is ~$0.0004 — and `formatUsd` rounds to
 * cents, which would render every single run as "$0.00" and make the log look free.
 * Show enough precision that one run reads as a real (if tiny) number, and let the
 * rollups use normal money formatting where the totals are big enough to deserve it.
 */
export function fmtRunUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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
                {ev.title ? <Text style={{ color: theme.textMuted }}> · {ev.title}</Text> : null}
                {ev.evaluatedBy ? <Text style={{ color: theme.textMuted }}> · {ev.evaluatedBy}</Text> : null}
              </Text>
              {ev.reasoning ? (
                <Text style={[styles.reason, { color: theme.textSecondary }]}>{ev.reasoning}</Text>
              ) : null}
              {ev.usd != null ? (
                <Text style={[styles.meter, { color: theme.textMuted }]}>
                  {ev.model} · {fmtTokens(ev.tokens?.in ?? 0)}→{fmtTokens(ev.tokens?.out ?? 0)} tok
                  {ev.ms ? ` · ${(ev.ms / 1000).toFixed(1)}s` : ''}
                  {ev.unrated ? ' · unrated model' : ''}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.time, { color: theme.textMuted }]}>{ago(ev.ts)}</Text>
              {/* Only billed rows show a price. A row with no `usd` didn't cost us
                  anything measurable, and printing "$0.00" there would imply we checked. */}
              {ev.usd != null ? (
                <Text style={[styles.cost, { color: theme.ember }]}>{fmtRunUsd(ev.usd)}</Text>
              ) : null}
            </View>
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
  meter: { fontFamily: Fonts?.mono, fontSize: 10.5, marginTop: 3 },
  time: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },
  cost: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  empty: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20, paddingVertical: Spacing.three },
});
