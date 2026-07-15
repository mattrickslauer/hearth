/**
 * What a watch costs, and how to make it cost less — for the real dashboard.
 *
 * The estimator is pure and lives in `demo/engine/pricing`, shared with the simulator
 * and (via `backend/src/domain.ts`) the cloud. Only the rendering differs per surface,
 * so this is the dashboard's view of the same arithmetic — no second source of truth.
 *
 * Suggestions here are ADVICE, not buttons: the MCP surface has no tool to patch a
 * watch's record/model/gate (`update_question` re-authors from a wish), so there is
 * nothing honest to wire a tap to yet.
 */

import { StyleSheet, Text, View } from 'react-native';

import { cheapestPlan, estimate, formatLooks, formatUsd, type QuoteInput } from '@/demo/engine/pricing';
import { recommend } from '@/demo/engine/recommend';
import { dutyForGate as catalogDuty, gatesFor as catalogGates } from '@/demo/gates';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dutyForGate, gatesFromHome } from '@/lib/gates';
import type { HomeModel, Watch } from '@/lib/home';

/** Cadence stops a suggestion may propose, slowest-first. */
const SLOWER = ['2m', '30s', '10s'];

export function CostQuote({ watch, home }: { watch: Watch; home: HomeModel | null }) {
  const theme = useTheme();

  // No compiledSpec means an older stored row we can't price — say nothing rather
  // than guess a number someone might believe.
  if (!watch.compiledSpec) return null;

  // Two sources, deliberately. `describe_home` is authoritative when a hub has actually
  // reported its devices, but it is EMPTY until one does — while authoring always binds
  // against the static capability catalog (`qwen.ts` → domain `CAPABILITIES`). So a
  // brain-emitted `entry.presence` gate resolves from the catalog even on a home with no
  // hub. Without this fallback a gated watch is priced as if its gate never fires — a
  // 50× overstatement on the very watch the demo authors.
  const homeGates = gatesFromHome(home, watch.boundInputs);
  const gates = homeGates.length ? homeGates : catalogGates(watch.boundInputs);
  const gate = watch.compiledSpec.kind === 'cloud' ? watch.compiledSpec.cloud.gate : undefined;
  const gateDuty = dutyForGate(home, gate) ?? catalogDuty(gate);

  const input: QuoteInput = {
    spec: watch.compiledSpec,
    record: watch.record,
    // An empty/absent link list means "use all of memory", not "no references".
    references: watch.memoryIds?.length || undefined,
    gateDuty,
  };
  const quote = estimate(input);
  const plan = cheapestPlan(quote);
  const recs = quote.local ? [] : recommend(input, { gates, slower: SLOWER });
  const fitsFree = plan?.id === 'free';

  return (
    <View style={styles.wrap}>
      <View style={[styles.quote, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <Text style={[styles.money, { color: fitsFree ? theme.text : theme.ember }]}>
          {quote.local ? (
            <>
              💸 $0/mo
              <Text style={{ color: theme.textMuted }}>{'  ·  '}runs on your hub, offline, forever</Text>
            </>
          ) : (
            <>
              💸 ~{formatLooks(quote.looksPerMonth)} Looks/mo
              <Text style={{ color: theme.textMuted }}>{'  ·  '}</Text>
              {formatUsd(quote.usdPerMonth)}/mo
            </>
          )}
        </Text>
        <View
          style={[
            styles.badge,
            {
              borderColor: fitsFree ? theme.border : theme.emberDeep,
              backgroundColor: fitsFree ? theme.backgroundElement : theme.emberGlow,
            },
          ]}>
          <Text style={[styles.badgeText, { color: fitsFree ? theme.textMuted : theme.ember }]}>
            {plan ? (fitsFree ? 'Free ✓' : `needs ${plan.label}`) : 'over every plan'}
          </Text>
        </View>
      </View>

      {recs.map((r) => (
        <View
          key={r.id}
          style={[styles.rec, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          <View style={styles.recHead}>
            <Text style={[styles.recTitle, { color: theme.text }]} numberOfLines={2}>
              {r.kind === 'hardware' ? '🔌 ' : '⚡ '}
              {r.title}
            </Text>
            <Text style={[styles.recSaves, { color: theme.ember }]}>−{formatUsd(r.savedUsd)}/mo</Text>
          </View>
          <Text style={[styles.recWhy, { color: theme.textMuted }]}>{r.why}</Text>
          <Text style={[styles.recWhy, { color: theme.textMuted }]}>
            {Math.round(r.savedPct)}% cheaper → {formatUsd(r.projected.usdPerMonth)}/mo
            {r.kind === 'hardware' ? ` · ${r.projected.local ? '' : 'one-time hardware'}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  quote: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  money: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700' },
  rec: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.one, gap: 3 },
  recHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.one },
  recTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '700' },
  recSaves: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  recWhy: { fontFamily: Fonts?.sans, fontSize: 10.5, lineHeight: 14 },
});
