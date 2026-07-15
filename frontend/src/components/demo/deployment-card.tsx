import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { capability } from '@/demo/home';
import { parseDuration } from '@/demo/engine/duration';
import {
  ACTIVITY,
  cheapestPlan,
  estimate,
  formatLooks,
  formatUsd,
  type ActivityLevel,
} from '@/demo/engine/pricing';
import { MODELS, type CloudModel, type RecordPolicy } from '@/demo/engine/types';
import type { Question } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Dropdown, Option } from './dropdown';

export type RecordPatch = { mode?: RecordPolicy['mode']; every?: string; retain?: number; model?: CloudModel };

const RATES = ['2s', '10s', '30s', '2m'];

/** Human "≈ N/min" (or /hr) for a sample interval — the metered rate readout. */
function rateLabel(every: string): string {
  const ms = parseDuration(every);
  if (!ms) return '—';
  const perMin = 60_000 / ms;
  if (perMin >= 1) return `${Number.isInteger(perMin) ? perMin : perMin.toFixed(1)}/min`;
  const perHr = perMin * 60;
  return `${Number.isInteger(perHr) ? perHr : perHr.toFixed(1)}/hr`;
}

/** A compiled Question — the honest output of a wish. */
export function DeploymentCard({
  dep,
  onRemove,
  onConfigure,
  active,
}: {
  dep: Question;
  onRemove?: () => void;
  onConfigure?: (patch: RecordPatch) => void;
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

      {dep.compiledSpec.kind === 'cloud' && dep.record && onConfigure ? (
        <RecordControls dep={dep} record={dep.record} onConfigure={onConfigure} />
      ) : null}
    </View>
  );
}

/** Configure the metered capture rate + which model runs the cloud check. */
function RecordControls({
  dep,
  record,
  onConfigure,
}: {
  dep: Question;
  record: RecordPolicy;
  onConfigure: (patch: RecordPatch) => void;
}) {
  const theme = useTheme();
  const model = dep.compiledSpec.kind === 'cloud' ? dep.compiledSpec.cloud.model : 'qwen-vl';
  const active = MODELS.find((m) => m.id === model);
  const metered = record.mode === 'interval';
  const visionMismatch = dep.usesVision && active && !active.vision;

  // A watch is a declared program, so its bill is knowable before it runs. Re-quoting
  // is pure arithmetic — every patch below re-prices instantly, with no round-trip.
  const [activity, setActivity] = useState<ActivityLevel>('normal');
  const quote = estimate({
    spec: dep.compiledSpec,
    record,
    // An empty/absent link list means "use all of memory", not "no references".
    references: dep.memoryIds?.length || undefined,
    eventsPerDay: ACTIVITY[activity],
  });
  const plan = cheapestPlan(quote);

  return (
    <View style={[styles.rec, { borderTopColor: theme.border }]}>
      <View style={styles.recHead}>
        <Text style={[styles.recTitle, { color: theme.textMuted }]}>RECORD POLICY</Text>
        <Text style={[styles.recRate, { color: theme.ember }]}>
          {metered ? '≈' : '≤'} {rateLabel(record.every)}
          <Text style={{ color: theme.textMuted }}>{'  ·  '}retain {record.retain}</Text>
        </Text>
      </View>

      <Quote quote={quote} plan={plan} activity={activity} onActivity={setActivity} />

      {/* mode: sample every N (metered) vs only on scene change (on_event) */}
      <View style={styles.segRow}>
        <Seg theme={theme} label="On event" active={!metered} onPress={() => onConfigure({ mode: 'on_event' })} />
        <Seg theme={theme} label="Metered" active={metered} onPress={() => onConfigure({ mode: 'interval' })} />
      </View>

      {/* frame rate presets */}
      <View style={styles.rateRow}>
        {RATES.map((r) => {
          const on = record.every === r;
          return (
            <Pressable
              key={r}
              onPress={() => onConfigure({ every: r })}
              style={[
                styles.rateChip,
                { borderColor: on ? theme.ember : theme.border, backgroundColor: on ? theme.emberGlow : theme.background },
              ]}>
              <Text style={[styles.rateText, { color: on ? theme.ember : theme.textSecondary }]}>{r}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* model picker */}
      <Dropdown icon="🧠" label="Model" value={active?.label ?? model} width={220}>
        {(close) =>
          MODELS.map((m) => (
            <Option
              key={m.id}
              label={`${m.label} — ${m.note}`}
              active={m.id === model}
              onPress={() => {
                onConfigure({ model: m.id });
                close();
              }}
            />
          ))
        }
      </Dropdown>

      {visionMismatch ? (
        <Text style={[styles.warn, { color: theme.textMuted }]}>
          ⚠ {active?.label} can’t read frames — this watch needs vision. Pick a Qwen-VL model.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The live quote — what this configuration will cost per month, and the cheapest
 * plan that covers it. Shown *before* deploy: the point is that you never discover
 * the bill afterwards.
 */
function Quote({
  quote,
  plan,
  activity,
  onActivity,
}: {
  quote: ReturnType<typeof estimate>;
  plan: ReturnType<typeof cheapestPlan>;
  activity: ActivityLevel;
  onActivity: (a: ActivityLevel) => void;
}) {
  const theme = useTheme();
  const fitsFree = plan?.id === 'free';
  const tone = !plan ? theme.ember : fitsFree ? theme.text : theme.ember;

  return (
    <View style={[styles.quote, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.quoteHead}>
        <Text style={[styles.quoteMoney, { color: tone }]}>
          💸 ~{formatLooks(quote.looksPerMonth)} Looks/mo
          <Text style={{ color: theme.textMuted }}>{'  ·  '}</Text>
          {formatUsd(quote.usdPerMonth)}/mo
        </Text>
        <Badge
          label={plan ? (fitsFree ? 'Free ✓' : `needs ${plan.label}`) : 'over every plan'}
          tone={fitsFree ? 'success' : 'ember'}
        />
      </View>

      {/* The one number the config can't tell us: how busy this scene actually is. */}
      {quote.assumed ? (
        <View style={styles.quoteAssume}>
          <Text style={[styles.quoteNote, { color: theme.textMuted }]}>assumes</Text>
          {(Object.keys(ACTIVITY) as ActivityLevel[]).map((a) => (
            <Pressable key={a} onPress={() => onActivity(a)} hitSlop={6}>
              <Text
                style={[
                  styles.quoteLevel,
                  { color: a === activity ? theme.ember : theme.textMuted },
                ]}>
                {a}
              </Text>
            </Pressable>
          ))}
          <Text style={[styles.quoteNote, { color: theme.textMuted }]}>
            · ~{ACTIVITY[activity]} events/day
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Seg({
  theme,
  label,
  active,
  onPress,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.seg,
        { borderColor: active ? theme.ember : theme.border, backgroundColor: active ? theme.emberGlow : 'transparent' },
      ]}>
      <Text style={[styles.segText, { color: active ? theme.ember : theme.textSecondary }]}>{label}</Text>
    </Pressable>
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
  rec: { borderTopWidth: 1, paddingTop: Spacing.two, marginTop: Spacing.one, gap: Spacing.two },
  recHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  recTitle: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  recRate: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  segRow: { flexDirection: 'row', gap: 6 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1 },
  segText: { fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '700' },
  rateRow: { flexDirection: 'row', gap: 6 },
  rateChip: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1 },
  rateText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },
  warn: { fontFamily: Fonts?.sans, fontSize: 11.5, lineHeight: 16, fontWeight: '500' },
  quote: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two, gap: 6 },
  quoteHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one },
  quoteMoney: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },
  quoteAssume: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  quoteNote: { fontFamily: Fonts?.mono, fontSize: 10.5 },
  quoteLevel: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700' },
});
