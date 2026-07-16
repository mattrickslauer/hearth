/**
 * Billing — the money page. Three answers, in the order a homeowner asks them:
 *
 *   1. "What have I actually spent?"    — the meter (search_runs totals, measured USD)
 *   2. "What will this month cost me?"  — the forecast (the same estimator every quote uses)
 *   3. "Where is it going, and why?"    — per-watch forecast vs actual, plans, the rate card
 *
 * Forecast and meter sit side by side deliberately, like target and actual on a
 * thermostat — the gap is the interesting part. Every number here is either measured
 * from the API's usage block or computed by `pricing.ts`; nothing is invented, and the
 * plans are shown as the catalog they are (entitlement isn't enforced server-side yet,
 * so there is no fake "Upgrade" button to nowhere).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { quoteForWatch } from '@/components/cost-quote';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import {
  BASELINE_LOOK_USD,
  MODEL_RATES,
  PLANS,
  costPerCall,
  fitsPlan,
  formatLooks,
  formatUsd,
  type Plan,
  type Quote,
} from '@/demo/engine/pricing';
import { MODELS } from '@/demo/engine/types';
import { useTheme } from '@/hooks/use-theme';
import { searchRuns, type HomeModel, type RunSearch, type Watch } from '@/lib/home';

import { SectionLabel } from './shared';

const DAY_MS = 86_400_000;

/** The three windows the spend hero answers for. */
const WINDOWS = [
  { key: 'day', label: 'Today', ms: DAY_MS },
  { key: 'week', label: '7 days', ms: 7 * DAY_MS },
  { key: 'month', label: '30 days', ms: 30 * DAY_MS },
] as const;

type Totals = RunSearch['totals'];

interface BillingData {
  /** Window totals, keyed as WINDOWS. */
  windows: Record<(typeof WINDOWS)[number]['key'], Totals> | null;
  /** Measured 30-day totals per watch id. */
  perWatch: Record<string, Totals>;
  loading: boolean;
  error: string | null;
}

/**
 * The meter reads. `limit: 1` everywhere because we only want `totals` — they cover the
 * WHOLE match regardless of page size, so this costs the backend a scan it was doing
 * anyway and the wire almost nothing.
 */
function useBillingData(token: string | null | undefined, watches: Watch[] | null): BillingData {
  const [data, setData] = useState<Omit<BillingData, 'loading' | 'error'>>({ windows: null, perWatch: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refetch when the set of watches changes (created/deleted), not on every list identity.
  const watchIds = useMemo(() => (watches ?? []).map((w) => w.id).sort().join(','), [watches]);
  const seq = useRef(0);

  /* Deferred a tick and last-write-wins, like the run log: authoring/deleting a watch can
   * change `watchIds` in quick succession, and an out-of-order reply must never overwrite
   * a newer result. The spinner starts when the request does. */
  useEffect(() => {
    const mine = ++seq.current;
    const ids = watchIds ? watchIds.split(',') : [];
    const t = setTimeout(() => {
      setLoading(true);
      Promise.all([
        ...WINDOWS.map((w) => searchRuns({ sinceMs: w.ms, billedOnly: true, limit: 1 }, token)),
        ...ids.map((id) =>
          searchRuns({ sinceMs: 30 * DAY_MS, questionId: id, billedOnly: true, limit: 1 }, token),
        ),
      ])
        .then((results) => {
          if (seq.current !== mine) return;
          const windows = {
            day: results[0].totals,
            week: results[1].totals,
            month: results[2].totals,
          };
          const perWatch: Record<string, Totals> = {};
          ids.forEach((id, i) => {
            perWatch[id] = results[WINDOWS.length + i].totals;
          });
          setData({ windows, perWatch });
          setError(null);
        })
        .catch((e: Error) => {
          if (seq.current === mine) setError(e.message);
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, 40);
    return () => clearTimeout(t);
  }, [token, watchIds]);

  return { ...data, loading, error };
}

/** Looks a measured USD amount bought, at the baseline rate. */
const usdToLooks = (usd: number): number => Math.round(usd / BASELINE_LOOK_USD);

/** One big number in the spend hero. */
function SpendCell({ label, totals, hero }: { label: string; totals: Totals | null; hero?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.spendCell}>
      <Text style={[hero ? styles.spendHero : styles.spendValue, { color: hero ? theme.ember : theme.text }]}>
        {totals ? formatUsd(totals.usd) : '—'}
      </Text>
      <Text style={[styles.cellLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

/**
 * A thin usage bar — how far through a plan's included Looks the last 30 days got.
 * Overflow saturates at 100% and turns ember: the bar says "over", the caption says by how much.
 */
function UsageBar({ used, included }: { used: number; included: number }) {
  const theme = useTheme();
  const frac = included > 0 ? Math.min(1, used / included) : 1;
  const over = used > included;
  return (
    <View style={[styles.usageTrack, { backgroundColor: theme.backgroundElement }]}>
      <View
        style={[
          styles.usageFill,
          { width: `${frac * 100}%`, backgroundColor: over ? theme.ember : theme.success },
        ]}
      />
    </View>
  );
}

/** Which plan the whole current configuration needs: the costliest per-watch requirement. */
function planNeeded(quotes: (Quote | null)[]): Plan | null | 'none' {
  let needed: Plan | 'none' = 'none';
  for (const q of quotes) {
    if (!q || q.local) continue;
    const fit = PLANS.find((p) => fitsPlan(q, p));
    if (!fit) return null; // one watch is over every plan
    if (needed === 'none' || PLANS.indexOf(fit) > PLANS.indexOf(needed)) needed = fit;
  }
  return needed;
}

export function BillingPanel({
  token,
  watches,
  home,
  onOpenWatch,
}: {
  token?: string | null;
  watches: Watch[] | null;
  home: HomeModel | null;
  /** Tap a row → the watch's own sheet, where Tune lives. */
  onOpenWatch: (id: string) => void;
}) {
  const theme = useTheme();
  const { windows, perWatch, loading, error } = useBillingData(token, watches);

  // Forecasts: the same estimator every quote sheet uses, one call per watch.
  const quotes = useMemo(
    () => (watches ?? []).map((w) => ({ watch: w, quote: quoteForWatch(w, home) })),
    [watches, home],
  );
  const forecastUsd = quotes.reduce((s, q) => s + (q.quote?.usdPerMonth ?? 0), 0);
  const needed = planNeeded(quotes.map((q) => q.quote));

  const month = windows?.month ?? null;
  const looksUsed = month ? usdToLooks(month.usd) : 0;

  // Cloud watches first, priciest forecast first — the rows worth reading lead.
  const rows = useMemo(
    () =>
      [...quotes].sort(
        (a, b) => (b.quote?.usdPerMonth ?? 0) - (a.quote?.usdPerMonth ?? 0),
      ),
    [quotes],
  );

  return (
    <View style={{ gap: Spacing.four }}>
      {/* ------------------------------------------------ the meter */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Spend</SectionLabel>
        {error ? (
          <Text style={[styles.warn, { color: theme.textSecondary }]}>Couldn’t read the meter — {error}</Text>
        ) : null}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {loading && !windows ? (
            <ActivityIndicator color={theme.ember} style={{ paddingVertical: Spacing.three }} />
          ) : (
            <>
              <View style={styles.spendRow}>
                {WINDOWS.map((w) => (
                  <SpendCell key={w.key} label={w.label} totals={windows?.[w.key] ?? null} hero={w.key === 'month'} />
                ))}
              </View>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <View style={styles.spendRow}>
                <View style={styles.spendCell}>
                  <Text style={[styles.spendValue, { color: theme.text }]}>
                    {month ? formatLooks(looksUsed) : '—'}
                  </Text>
                  <Text style={[styles.cellLabel, { color: theme.textMuted }]}>looks · 30d</Text>
                </View>
                <View style={styles.spendCell}>
                  <Text style={[styles.spendValue, { color: theme.text }]}>{month ? month.billed : '—'}</Text>
                  <Text style={[styles.cellLabel, { color: theme.textMuted }]}>billed calls</Text>
                </View>
                <View style={styles.spendCell}>
                  <Text style={[styles.spendValue, { color: theme.text }]}>
                    {month ? `${((month.tokensIn + month.tokensOut) / 1000).toFixed(1)}k` : '—'}
                  </Text>
                  <Text style={[styles.cellLabel, { color: theme.textMuted }]}>tokens</Text>
                </View>
                <View style={styles.spendCell}>
                  <Text style={[styles.spendValue, { color: forecastUsd > 0 ? theme.ember : theme.text }]}>
                    {formatUsd(forecastUsd)}
                  </Text>
                  <Text style={[styles.cellLabel, { color: theme.textMuted }]}>forecast / mo</Text>
                </View>
              </View>
            </>
          )}
        </View>
        {month?.unrated ? (
          <Text style={[styles.warn, { color: theme.textSecondary }]}>
            Some runs used a model that isn’t in the rate card, so the real spend is higher than shown.
          </Text>
        ) : null}
      </View>

      {/* ------------------------------------------------ plans */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Plans</SectionLabel>
        <View style={styles.planRow}>
          {PLANS.map((p) => {
            const current = p.id === 'free';
            const recommended = needed !== 'none' && needed !== null && needed.id === p.id && !current;
            return (
              <View
                key={p.id}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: theme.card,
                    borderColor: recommended ? theme.emberDeep : theme.border,
                  },
                ]}>
                <View style={styles.planHead}>
                  <Text style={[styles.planName, { color: theme.text }]}>{p.label}</Text>
                  {current ? (
                    <View style={[styles.planBadge, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
                      <Text style={[styles.planBadgeText, { color: theme.textSecondary }]}>Current</Text>
                    </View>
                  ) : recommended ? (
                    <View style={[styles.planBadge, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                      <Text style={[styles.planBadgeText, { color: theme.ember }]}>Fits your config</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.planPrice, { color: theme.text }]}>
                  {p.usdPerMonth ? `$${p.usdPerMonth}` : '$0'}
                  <Text style={[styles.planPer, { color: theme.textMuted }]}>/mo</Text>
                </Text>
                <View style={{ gap: 5 }}>
                  <Text style={[styles.planLine, { color: theme.textSecondary }]}>
                    {formatLooks(p.looks)} Looks included
                  </Text>
                  <Text style={[styles.planLine, { color: theme.textSecondary }]}>
                    Cadence down to {p.floorMs / 1000}s
                  </Text>
                  <Text style={[styles.planLine, { color: theme.textSecondary }]}>
                    {p.models.length} of {MODELS.length} models
                  </Text>
                  <Text style={[styles.planLine, { color: theme.textSecondary }]}>
                    Local watches unlimited
                  </Text>
                </View>
                <View style={{ gap: 4, marginTop: 'auto' }}>
                  <UsageBar used={looksUsed} included={p.looks} />
                  <Text style={[styles.planUsage, { color: theme.textMuted }]}>
                    {formatLooks(looksUsed)} of {formatLooks(p.looks)} looks · last 30d
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        {needed === null ? (
          <Text style={[styles.warn, { color: theme.textSecondary }]}>
            One of your watches is configured beyond every plan — tune its cadence or model to bring it back.
          </Text>
        ) : null}
      </View>

      {/* ------------------------------------------------ per-watch: forecast vs meter */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>By watch — forecast vs metered (30d)</SectionLabel>
        {watches === null ? (
          <ActivityIndicator color={theme.ember} style={{ alignSelf: 'flex-start' }} />
        ) : watches.length === 0 ? (
          <Text style={[styles.warn, { color: theme.textMuted }]}>
            No watches yet — spend starts when the first cloud watch does.
          </Text>
        ) : (
          <View style={[styles.table, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.tr, styles.th, { borderBottomColor: theme.border }]}>
              <Text style={[styles.tdWatch, styles.thText, { color: theme.textMuted }]}>Watch</Text>
              <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>Forecast/mo</Text>
              <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>Metered</Text>
              <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>Looks</Text>
            </View>
            {rows.map(({ watch, quote }, i) => {
              const actual = perWatch[watch.id];
              const last = i === rows.length - 1;
              return (
                <Pressable
                  key={watch.id}
                  onPress={() => onOpenWatch(watch.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${watch.title}`}
                  style={({ pressed }) => [
                    styles.tr,
                    !last && { borderBottomWidth: 1, borderBottomColor: theme.border },
                    pressed && { backgroundColor: theme.backgroundElement },
                  ]}>
                  <View style={styles.tdWatch}>
                    <Text style={[styles.watchTitle, { color: theme.text }]} numberOfLines={1}>
                      {watch.title}
                    </Text>
                    <Text style={[styles.watchMeta, { color: theme.textMuted }]} numberOfLines={1}>
                      {quote?.local
                        ? 'local · runs on your hub · free'
                        : quote
                          ? `${quote.model} · ${quote.mode === 'interval' ? 'interval' : 'on event'}${quote.gated ? ' · gated' : ''}`
                          : 'not priceable'}
                    </Text>
                  </View>
                  <Text style={[styles.tdNum, styles.num, { color: quote?.local ? theme.textMuted : theme.text }]}>
                    {quote ? (quote.local ? '$0' : formatUsd(quote.usdPerMonth)) : '—'}
                  </Text>
                  <Text style={[styles.tdNum, styles.num, { color: actual?.usd ? theme.ember : theme.textMuted }]}>
                    {actual ? formatUsd(actual.usd) : loading ? '…' : '—'}
                  </Text>
                  <Text style={[styles.tdNum, styles.num, { color: theme.textMuted }]}>
                    {actual ? formatLooks(usdToLooks(actual.usd)) : loading ? '…' : '—'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={[styles.warn, { color: theme.textMuted }]}>
          Forecast is quoted from each watch’s configuration; metered is what its runs actually billed.
          Tap a watch to tune it.
        </Text>
      </View>

      {/* ------------------------------------------------ rate card */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Rate card</SectionLabel>
        <View style={[styles.table, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.tr, styles.th, { borderBottomColor: theme.border }]}>
            <Text style={[styles.tdWatch, styles.thText, { color: theme.textMuted }]}>Model</Text>
            <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>In /1M</Text>
            <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>Out /1M</Text>
            <Text style={[styles.tdNum, styles.thText, { color: theme.textMuted }]}>Per check</Text>
          </View>
          {MODELS.map((m, i) => {
            const rate = MODEL_RATES[m.id];
            const per = costPerCall(m.id);
            return (
              <View
                key={m.id}
                style={[
                  styles.tr,
                  i < MODELS.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                ]}>
                <View style={styles.tdWatch}>
                  <Text style={[styles.watchTitle, { color: theme.text }]}>{m.label}</Text>
                  <Text style={[styles.watchMeta, { color: theme.textMuted }]}>{m.note}</Text>
                </View>
                <Text style={[styles.tdNum, styles.num, { color: theme.text }]}>${rate.in.toFixed(2)}</Text>
                <Text style={[styles.tdNum, styles.num, { color: theme.text }]}>${rate.out.toFixed(2)}</Text>
                <Text style={[styles.tdNum, styles.num, { color: theme.text }]}>
                  {(per / BASELINE_LOOK_USD).toFixed(1)}{' '}
                  <Text style={{ color: theme.textMuted }}>looks</Text>
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[styles.warn, { color: theme.textMuted }]}>
          A Look is one check at the baseline — Qwen-VL, one VGA frame, two reference photos (
          {formatUsd(BASELINE_LOOK_USD)} at list price). Sharper models spend more looks per check,
          not more checks.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three, gap: Spacing.three },
  divider: { height: 1 },
  spendRow: { flexDirection: 'row' },
  spendCell: { flex: 1, alignItems: 'center', gap: 3 },
  spendHero: { fontFamily: Fonts?.mono, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  spendValue: { fontFamily: Fonts?.mono, fontSize: 17, fontWeight: '700' },
  cellLabel: {
    fontFamily: Fonts?.sans,
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  warn: { fontFamily: Fonts?.sans, fontSize: 12, lineHeight: 18 },

  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  planCard: {
    flexGrow: 1,
    flexBasis: 220,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    minHeight: 200,
  },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one },
  planName: { fontFamily: Fonts?.sans, fontSize: 16, fontWeight: '800' },
  planBadge: { borderWidth: 1, borderRadius: Radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  planBadgeText: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700' },
  planPrice: { fontFamily: Fonts?.sans, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  planPer: { fontSize: 14, fontWeight: '600', letterSpacing: 0 },
  planLine: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 17 },
  planUsage: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '600' },
  usageTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  usageFill: { height: 5, borderRadius: 3 },

  table: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
  },
  th: { paddingVertical: 9, borderBottomWidth: 1 },
  thText: {
    fontFamily: Fonts?.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tdWatch: { flex: 1, gap: 2, minWidth: 120 },
  tdNum: { width: 82, textAlign: 'right' },
  num: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },
  watchTitle: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '700' },
  watchMeta: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '600' },
});
