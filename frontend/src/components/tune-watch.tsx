/**
 * Tune a watch to a budget — the sheet that opens after authoring a cloud watch, and again
 * from any of them whenever you want to change your mind.
 *
 * Every control re-prices instantly because `estimate()` is pure arithmetic over the
 * compiled spec; nothing here round-trips until you hit Save. Save persists only the
 * real program knobs via `configure_question` (mode, rate, model). "Expected activity"
 * is deliberately NOT persisted — it isn't a property of the program, it's your
 * estimate of how busy the scene is, so it only moves the projection.
 *
 * The chrome is the shared `Sheet`, so this rides the same z-axis as every other overlay:
 * a slide-up on a phone, a centered dialog on a desktop. Only the controls live here.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PillButton } from '@/components/dashboard/shared';
import { Sheet } from '@/components/ui/sheet';
import {
  ACTIVITY,
  BASELINE_LOOK_USD,
  cheapestPlan,
  estimate,
  formatLooks,
  formatUsd,
  PLANS,
  type ActivityLevel,
  type QuoteInput,
} from '@/demo/engine/pricing';
import { recommend } from '@/demo/engine/recommend';
import { dutyForGate as catalogDuty, gatesFor as catalogGates } from '@/demo/gates';
import { MODELS, type CloudModel, type RecordPolicy } from '@/demo/engine/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dutyForGate, gatesFromHome } from '@/lib/gates';
import type { HomeModel, Watch } from '@/lib/home';

/** Sample rates offered, fastest first. Mirrors the demo's RATES plus slower budget stops. */
const RATES = ['2s', '10s', '30s', '2m', '5m'];
const SLOWER = ['5m', '2m', '30s', '10s'];

export interface TunePatch {
  mode?: RecordPolicy['mode'];
  every?: string;
  model?: CloudModel;
}

export function TuneWatch({
  watch,
  home,
  visible,
  saving,
  error,
  onSave,
  onClose,
}: {
  watch: Watch | null;
  home: HomeModel | null;
  visible: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: (patch: TunePatch) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const spec = watch?.compiledSpec;
  const cloud = spec?.kind === 'cloud' ? spec.cloud : undefined;

  // Draft state — the modal edits a copy, so Cancel is free and Save is one call.
  // Seeded straight from the watch rather than re-synced in an effect: the parent keys
  // this component on the watch id, so opening a different watch remounts with fresh
  // initial state. Same result, no cascading render.
  const [mode, setMode] = useState<RecordPolicy['mode']>(watch?.record?.mode ?? 'on_event');
  const [every, setEvery] = useState(watch?.record?.every ?? '10s');
  const [model, setModel] = useState<CloudModel>(
    watch?.compiledSpec?.kind === 'cloud' ? watch.compiledSpec.cloud.model : 'qwen-vl',
  );
  const [activity, setActivity] = useState<ActivityLevel>('normal');

  if (!watch || !spec || !cloud) return null;

  const draftSpec = { kind: 'cloud' as const, cloud: { ...cloud, model } };
  const homeGates = gatesFromHome(home, watch.boundInputs);
  const gates = homeGates.length ? homeGates : catalogGates(watch.boundInputs);
  const gateDuty = dutyForGate(home, cloud.gate) ?? catalogDuty(cloud.gate);

  const input: QuoteInput = {
    spec: draftSpec,
    record: { ...(watch.record ?? { inputId: watch.boundInputs[0] ?? 'camera.frame', retain: 8 }), mode, every },
    references: watch.memoryIds?.length || undefined,
    eventsPerDay: ACTIVITY[activity],
    gateDuty,
  };
  const quote = estimate(input);
  const plan = cheapestPlan(quote);
  const recs = recommend(input, { gates, slower: SLOWER });
  const fitsFree = plan?.id === 'free';
  const free = PLANS[0];

  const dirty =
    mode !== (watch.record?.mode ?? 'on_event') ||
    every !== (watch.record?.every ?? '10s') ||
    model !== cloud.model;

  return (
    <Sheet
      open={visible}
      onClose={onClose}
      title={`Tune “${watch.title}”`}
      subtitle="What it watches never changes here — only how often it thinks, and with which brain."
      footer={
        <>
          <PillButton label="Cancel" onPress={onClose} />
          <PillButton
            label={dirty ? 'Save' : 'Saved'}
            tone="primary"
            grow
            busy={saving}
            disabled={!dirty}
            onPress={() => onSave({ mode, every, model })}
          />
        </>
      }>
      {/* The number everything else moves. */}
      <View style={[styles.quote, { borderColor: fitsFree ? theme.border : theme.emberDeep, backgroundColor: theme.backgroundElement }]}>
        {/* Lead with money and with how often it actually looks — the two things a
            person can reason about. A Look is a normalized COST unit, not a check:
            a sharper model spends 4 Looks per check. Conflating them would claim
            qwen-vl-max quadrupled the checks, when it only quadrupled the price. */}
        <Text style={[styles.money, { color: fitsFree ? theme.text : theme.ember }]}>
          💸 {formatUsd(quote.usdPerMonth)}/mo
          <Text style={{ color: theme.textMuted }}>{'  ·  '}</Text>
          <Text style={{ color: theme.textSecondary }}>≈{perDay(quote.callsPerMonth)} checks a day</Text>
        </Text>
        <Text style={[styles.planLine, { color: fitsFree ? theme.textMuted : theme.ember }]}>
          {plan
            ? fitsFree
              ? `fits Free — ${formatLooks(quote.looksPerMonth)} of ${formatLooks(free.looks)} Looks/mo`
              : `needs ${plan.label} ($${plan.usdPerMonth}/mo) — ${formatLooks(quote.looksPerMonth)} Looks/mo`
            : `over every plan — ${formatLooks(quote.looksPerMonth)} Looks/mo`}
        </Text>
        <Text style={[styles.rateLine, { color: theme.textMuted }]}>
          {quote.assumed ? 'estimated from expected activity below' : 'fixed by the timer'}
          {quote.model && quote.usdPerCall > 0
            ? ` · one check = ${(quote.usdPerCall / BASELINE_LOOK_USD).toFixed(1)} Looks on ${quote.model}`
            : ''}
        </Text>
      </View>

      <Section theme={theme} label="When does it think?">
        <View style={styles.row}>
          <Seg theme={theme} label="Only when the scene changes" active={mode === 'on_event'} onPress={() => setMode('on_event')} />
          <Seg theme={theme} label="On a timer" active={mode === 'interval'} onPress={() => setMode('interval')} />
        </View>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {mode === 'on_event'
            ? 'Cheapest, and usually right: nothing happens, nothing is spent.'
            : 'Checks every interval whether or not anything changed — including an empty porch at 4am.'}
        </Text>
      </Section>

      <Section theme={theme} label={mode === 'interval' ? 'How often?' : 'No faster than'}>
        <View style={styles.row}>
          {RATES.map((r) => (
            <Chip key={r} theme={theme} label={r} active={every === r} onPress={() => setEvery(r)} />
          ))}
        </View>
      </Section>

      {quote.assumed ? (
        <Section theme={theme} label="How busy is this scene?">
          <View style={styles.row}>
            {(Object.keys(ACTIVITY) as ActivityLevel[]).map((a) => (
              <Chip
                key={a}
                theme={theme}
                label={`${a} · ${ACTIVITY[a]}/day`}
                active={activity === a}
                onPress={() => setActivity(a)}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            We can’t know this from the program — it’s a fact about your home. It only moves the estimate, and isn’t saved.
          </Text>
        </Section>
      ) : null}

      <Section theme={theme} label="Which brain?">
        <View style={styles.rowWrap}>
          {MODELS.filter((m) => (watch.usesVision ? m.vision : true)).map((m) => (
            <Chip
              key={m.id}
              theme={theme}
              label={`${m.label} · ${m.note}`}
              active={model === m.id}
              onPress={() => setModel(m.id)}
            />
          ))}
        </View>
      </Section>

      {recs.length ? (
        <Section theme={theme} label="Qwen suggests">
          {recs.map((r) => (
            <Pressable
              key={r.id}
              disabled={!r.patch}
              onPress={() => {
                if (r.patch?.mode) setMode(r.patch.mode);
                if (r.patch?.every) setEvery(r.patch.every);
                if (r.patch?.model) setModel(r.patch.model);
              }}
              style={[styles.rec, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
              <View style={styles.recHead}>
                <Text style={[styles.recTitle, { color: theme.text }]} numberOfLines={2}>
                  {r.kind === 'hardware' ? '🔌 ' : '⚡ '}
                  {r.title}
                </Text>
                <Text style={[styles.recSaves, { color: theme.ember }]}>−{formatUsd(r.savedUsd)}/mo</Text>
              </View>
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {r.why} {r.patch ? '· tap to apply' : '· one-time hardware'}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

{error ? <Text style={[styles.err, { color: theme.ember }]}>{error}</Text> : null}
    </Sheet>
  );
}

/** Checks a day, rounded for humans — "<1" beats a misleading "0". */
function perDay(callsPerMonth: number): string {
  const d = callsPerMonth / 30;
  if (d === 0) return '0';
  if (d < 1) return '<1';
  return String(Math.round(d));
}

function Section({
  theme,
  label,
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{label.toUpperCase()}</Text>
      {children}
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
        { borderColor: active ? theme.emberDeep : theme.border, backgroundColor: active ? theme.emberGlow : 'transparent' },
      ]}>
      <Text style={[styles.segText, { color: active ? theme.ember : theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({
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
        styles.chip,
        { borderColor: active ? theme.emberDeep : theme.border, backgroundColor: active ? theme.emberGlow : 'transparent' },
      ]}>
      <Text style={[styles.chipText, { color: active ? theme.ember : theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two, gap: 3 },
  money: { fontFamily: Fonts?.mono, fontSize: 15, fontWeight: '800' },
  planLine: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  rateLine: { fontFamily: Fonts?.sans, fontSize: 11 },
  section: { gap: 6 },
  sectionLabel: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: 6 },
  rowWrap: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: Radius.sm, borderWidth: 1 },
  segText: { fontFamily: Fonts?.sans, fontSize: 11.5, fontWeight: '700', textAlign: 'center' },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, borderWidth: 1 },
  chipText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  hint: { fontFamily: Fonts?.sans, fontSize: 11, lineHeight: 15 },
  rec: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.one, gap: 3 },
  recHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.one },
  recTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '700' },
  recSaves: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  err: { fontFamily: Fonts?.sans, fontSize: 12 },
});
