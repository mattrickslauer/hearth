/**
 * The run log — every consequential thing your compiled watches did, what it cost, and
 * a way to find it again.
 *
 * This is the counterpart to the cost quote on a watch. The quote is a FORECAST from the
 * configuration ("this watch will cost ~$0.64/mo"); this is the METER ("it has actually
 * cost $0.41, across 940 looks"). Both are on screen for the same reason a thermostat
 * shows target and actual: the gap is the interesting part.
 *
 * Search runs server-side (`search_runs`), not over a client-side slice, so the totals
 * describe every matching run rather than the page we happen to be showing. A filter that
 * silently totalled only the visible rows would be worse than no total at all.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchRuns, type RunEvent, type RunQuery, type RunSearch } from '@/lib/home';

import { ActivityList, fmtRunUsd } from './activity';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** Time windows worth having one tap away. */
const WINDOWS = [
  { key: '24h', label: 'Today', ms: 86_400_000 },
  { key: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { key: '365d', label: 'All', ms: 365 * 86_400_000 },
] as const;

/** Kind filters, grouped the way a person thinks about them rather than by row kind. */
const KINDS = [
  { key: 'all', label: 'Everything', kinds: undefined as string[] | undefined },
  { key: 'looks', label: 'Looks', kinds: ['judged'] },
  { key: 'fired', label: 'Fired', kinds: ['fired', 'actuate', 'notify'] },
  { key: 'authoring', label: 'Authoring', kinds: ['authored', 'edited', 'removed'] },
] as const;

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? theme.emberDeep : theme.border,
          backgroundColor: on ? theme.emberGlow : theme.backgroundElement,
        },
      ]}>
      <Text style={[styles.chipText, { color: on ? theme.ember : theme.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** One number from the rollup. */
function Cell({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.cell}>
      <Text style={[styles.cellValue, { color: tone ?? theme.text }]}>{value}</Text>
      <Text style={[styles.cellLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

export function RunLog({ token, questionId }: { token?: string | null; questionId?: string }) {
  const theme = useTheme();
  const [win, setWin] = useState<(typeof WINDOWS)[number]['key']>('7d');
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all');
  const [billedOnly, setBilledOnly] = useState(false);
  const [text, setText] = useState('');
  const [res, setRes] = useState<RunSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<RunQuery>(
    () => ({
      sinceMs: WINDOWS.find((w) => w.key === win)!.ms,
      kinds: KINDS.find((k) => k.key === kind)!.kinds?.slice(),
      ...(billedOnly ? { billedOnly: true } : {}),
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(questionId ? { questionId } : {}),
      limit: 100,
    }),
    [win, kind, billedOnly, text, questionId],
  );

  /* Debounced, and last-write-wins. Typing fires a query per keystroke otherwise, and
   * out-of-order replies would let a stale result overwrite a newer one — the same race
   * `newerReading` guards for live sensor values. */
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      // Spinner starts when the request does, not when the keystroke lands — a debounced
      // window that flickers "loading" on every letter reads as jank, not as progress.
      setLoading(true);
      searchRuns(query, token)
        .then((r) => {
          if (seq.current !== mine) return;
          setRes(r);
          setError(null);
        })
        .catch((e: Error) => {
          if (seq.current !== mine) return;
          setError(e.message);
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query, token]);

  const totals = res?.totals;
  const runs: RunEvent[] | null = res?.runs ?? null;

  return (
    <View style={{ gap: Spacing.two }}>
      {/* Spend rollup — the answer to "what is this costing me", before the detail. */}
      <View style={[styles.rollup, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Cell value={totals ? fmtRunUsd(totals.usd) : '—'} label="spent" tone={theme.ember} />
        <Cell value={totals ? String(totals.billed) : '—'} label="billed calls" />
        <Cell value={totals ? String(totals.rows) : '—'} label="runs" />
        <Cell
          value={totals ? `${((totals.tokensIn + totals.tokensOut) / 1000).toFixed(1)}k` : '—'}
          label="tokens"
        />
      </View>
      {totals?.unrated ? (
        <Text style={[styles.warn, { color: theme.textSecondary }]}>
          Some runs used a model that isn’t in the rate card, so the real spend is higher than this.
        </Text>
      ) : null}

      <View style={styles.chipRow}>
        {WINDOWS.map((w) => (
          <Chip key={w.key} label={w.label} on={win === w.key} onPress={() => setWin(w.key)} />
        ))}
      </View>
      <View style={styles.chipRow}>
        {KINDS.map((k) => (
          <Chip key={k.key} label={k.label} on={kind === k.key} onPress={() => setKind(k.key)} />
        ))}
        <Chip label="Cost only" on={billedOnly} onPress={() => setBilledOnly((v) => !v)} />
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Search runs — a watch, a verdict, a model…"
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          { backgroundColor: theme.card, borderColor: theme.border, color: theme.text },
          webNoOutline,
        ]}
      />

      {error ? (
        <Text style={[styles.warn, { color: theme.textSecondary }]}>Couldn’t load runs — {error}</Text>
      ) : null}

      {loading && !runs ? (
        <View style={[styles.empty, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <ActivityIndicator color={theme.ember} />
        </View>
      ) : (
        <ActivityList events={runs} loading={loading} />
      )}

      {/* The page is capped; say so rather than let the row count read as the whole story. */}
      {res?.truncated ? (
        <Text style={[styles.warn, { color: theme.textMuted }]}>
          Showing the {runs?.length} most recent of {totals?.rows} matching runs. The totals above
          cover all {totals?.rows}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rollup: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  cell: { flex: 1, alignItems: 'center', gap: 3 },
  cellValue: { fontFamily: Fonts?.mono, fontSize: 16, fontWeight: '700' },
  cellLabel: { fontFamily: Fonts?.sans, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: Radius.pill, borderWidth: 1 },
  chipText: { fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '600' },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    fontFamily: Fonts?.sans,
    fontSize: 13.5,
  },
  empty: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.five,
    alignItems: 'center',
  },
  warn: { fontFamily: Fonts?.sans, fontSize: 12, lineHeight: 18 },
});
