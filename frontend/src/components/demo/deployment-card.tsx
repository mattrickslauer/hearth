import { Pressable, StyleSheet, Text, View } from 'react-native';

import { capability } from '@/demo/home';
import type { Question } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A compiled Question — the honest output of a wish. */
export function DeploymentCard({
  dep,
  onRemove,
  active,
}: {
  dep: Question;
  onRemove?: () => void;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.codeBg,
          borderColor: active ? theme.emberDeep : theme.border,
        },
      ]}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {dep.title}
          </Text>
          {onRemove ? (
            <Pressable onPress={onRemove} hitSlop={8}>
              <Text style={[styles.remove, { color: theme.textMuted }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.badges}>
          {dep.usesVision ? <Badge label="Qwen-VL" tone="ember" /> : null}
          <Badge
            label={dep.runsLocally ? 'local · offline' : 'cloud'}
            tone={dep.runsLocally ? 'success' : 'info'}
          />
          <Badge label={dep.cost === 'none' ? 'no tokens' : 'reasons'} tone="muted" />
        </View>
      </View>

      <View style={styles.chipRow}>
        {dep.boundInputs.map((id) => {
          const c = capability(id);
          return (
            <View key={id} style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <Text style={styles.chipIcon}>{c?.icon ?? '•'}</Text>
              <Text style={[styles.chipText, { color: theme.textSecondary }]}>{c?.label ?? id}</Text>
            </View>
          );
        })}
      </View>

      <Row theme={theme} k="When" v={dep.trigger} />
      <Row theme={theme} k="Do" v={dep.action} />
    </View>
  );
}

function Row({ theme, k, v }: { theme: ReturnType<typeof useTheme>; k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowKey, { color: theme.textMuted }]}>{k}</Text>
      <Text style={[styles.rowVal, { color: theme.text }]}>{v}</Text>
    </View>
  );
}

export function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'ember' | 'success' | 'info' | 'muted';
}) {
  const theme = useTheme();
  const color =
    tone === 'ember'
      ? theme.ember
      : tone === 'success'
        ? theme.success
        : tone === 'info'
          ? theme.info
          : theme.textMuted;
  return (
    <View style={[styles.badge, { backgroundColor: color + '1F' }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  head: { gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontFamily: Fonts?.sans, fontSize: 15.5, fontWeight: '700', letterSpacing: -0.2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.pill },
  badgeText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
  remove: { fontSize: 13, fontWeight: '700', paddingHorizontal: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  chipIcon: { fontSize: 12 },
  chipText: { fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'baseline' },
  rowKey: {
    fontFamily: Fonts?.mono,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    width: 38,
  },
  rowVal: { flex: 1, fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 19, fontWeight: '500' },
});
