import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { capability } from '@/demo/home';
import { dutyForGate, gatesFor } from '@/demo/gates';
import { parseDuration } from '@/demo/engine/duration';
import { recommend, type Recommendation } from '@/demo/engine/recommend';
import {
  ACTIVITY,
  cheapestPlan,
  estimate,
  formatLooks,
  formatUsd,
  type ActivityLevel,
} from '@/demo/engine/pricing';
import { MODELS, type CloudModel, type PredicateNode, type RecordPolicy } from '@/demo/engine/types';
import type { Question } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Dropdown, Option } from './dropdown';

export type RecordPatch = {
  mode?: RecordPolicy['mode'];
  every?: string;
  retain?: number;
  model?: CloudModel;
  /** A cheap local predicate that must hold before a cloud call is spent. */
  gate?: PredicateNode;
};

const RATES = ['2s', '10s', '30s', '2m'];

/** Cadence stops a recommendation may propose, slowest-first. */
const SLOWER = ['2m', '30s', '10s'];

/** Fallback duty for an already-gated watch whose gate we can't identify. */
const DEFAULT_GATE_DUTY = 0.05;

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

  // The activity + gate-duty assumptions live here, above both the quote and the
  // controls, so adjusting a slider re-prices against the same assumption.
  const [activity, setActivity] = useState<ActivityLevel>('normal');
  const gates = gatesFor(dep.boundInputs);
  // Resolve an existing gate's duty from the input it actually references — not from
  // whichever candidate happens to sort first.
  const gateDuty =
    dep.compiledSpec.kind === 'cloud'
      ? dutyForGate(dep.compiledSpec.cloud.gate) ?? (dep.compiledSpec.cloud.gate ? DEFAULT_GATE_DUTY : undefined)
      : undefined;
  const quoteInput = {
    spec: dep.compiledSpec,
    record: dep.record,
    // An empty/absent link list means "use all of memory", not "no references".
    references: dep.memoryIds?.length || undefined,
    eventsPerDay: ACTIVITY[activity],
    gateDuty,
  };
  const quote = estimate(quoteInput);
  const plan = cheapestPlan(quote);
  const recs = recommend(quoteInput, { gates, slower: SLOWER });

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

      {/* Cost is shown for EVERY watch, not just the ones that bill. A local watch
          reading "$0 · runs on your hub" is the whole token-frugal thesis, stated. */}
      <Quote quote={quote} plan={plan} activity={activity} onActivity={setActivity} />

      {recs.length && onConfigure ? <Recommendations recs={recs} onConfigure={onConfigure} /> : null}

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

  return (
    <View style={[styles.rec, { borderTopColor: theme.border }]}>
      <View style={styles.recHead}>
        <Text style={[styles.recTitle, { color: theme.textMuted }]}>RECORD POLICY</Text>
        <Text style={[styles.recRate, { color: theme.ember }]}>
          {metered ? '≈' : '≤'} {rateLabel(record.every)}
          <Text style={{ color: theme.textMuted }}>{'  ·  '}retain {record.retain}</Text>
        </Text>
      </View>

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

  // A local watch has no bill to show — say so plainly. This is the product's whole
  // argument ("Qwen compiles most wishes down to a local predicate"), so it deserves
  // a line rather than silence.
  if (quote.local) {
    return (
      <View style={[styles.quote, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <View style={styles.quoteHead}>
          <Text style={[styles.quoteMoney, { color: theme.text }]}>
            💸 $0/mo
            <Text style={{ color: theme.textMuted }}>{'  ·  '}runs on your hub, offline, forever</Text>
          </Text>
          <Badge label="Free ✓" tone="success" />
        </View>
      </View>
    );
  }

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

/**
 * Cost recommendations — Qwen negotiating the bill down, in the same visible-thinking
 * idiom as the rest of the product. Each saving is measured by re-quoting the proposed
 * config, never asserted, so the numbers here can't drift from the quote above.
 *
 * Tappable ones apply instantly. A hardware suggestion has no patch — you can't tap
 * your way to a PIR sensor — so it reads as advice with a price attached.
 */
function Recommendations({
  recs,
  onConfigure,
}: {
  recs: Recommendation[];
  onConfigure: (patch: RecordPatch) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.recs}>
      <Text style={[styles.recsTitle, { color: theme.textMuted }]}>QWEN SUGGESTS</Text>
      {recs.map((r) => {
        const tappable = !!r.patch;
        return (
          <Pressable
            key={r.id}
            disabled={!tappable}
            onPress={() => r.patch && onConfigure(r.patch)}
            style={[
              styles.recItem,
              { borderColor: theme.border, backgroundColor: theme.background, opacity: tappable ? 1 : 0.85 },
            ]}>
            <View style={styles.recItemHead}>
              <Text style={[styles.recItemTitle, { color: theme.text }]} numberOfLines={2}>
                {r.kind === 'hardware' ? '🔌 ' : '⚡ '}
                {r.title}
              </Text>
              <Text style={[styles.recSaves, { color: theme.ember }]}>
                −{formatUsd(r.savedUsd)}/mo
              </Text>
            </View>
            <Text style={[styles.recWhy, { color: theme.textMuted }]}>{r.why}</Text>
            <Text style={[styles.recWhy, { color: theme.textMuted }]}>
              {Math.round(r.savedPct)}% cheaper → {formatUsd(r.projected.usdPerMonth)}/mo
              {tappable ? ' · tap to apply' : ' · one-time hardware'}
            </Text>
          </Pressable>
        );
      })}
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
  recs: { gap: 6 },
  recsTitle: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  recItem: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.one, gap: 3 },
  recItemHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.one },
  recItemTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '700' },
  recSaves: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  recWhy: { fontFamily: Fonts?.sans, fontSize: 10.5, lineHeight: 14 },
});
