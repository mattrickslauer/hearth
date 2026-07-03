import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthMenu } from '@/components/auth-menu';
import { Card, GlowOrb, Pill, Wordmark, useResponsive } from '@/components/landing/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/hooks/use-theme';
import {
  authorWatch,
  describeHome,
  listEvents,
  listWatches,
  readInput,
  type HomeCapability,
  type HomeModel,
  type Reading,
  type RunEvent,
  type Watch,
} from '@/lib/home';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function formatValue(r: Reading | null, cap: HomeCapability): string {
  if (!r) return '—';
  const v = r.value;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return `${v}${cap.unit ?? ''}`;
  return String(v);
}

const EVENT_TONE: Record<string, { icon: string; label: string }> = {
  authored: { icon: '✍️', label: 'Authored' },
  fired: { icon: '🔥', label: 'Fired' },
  held: { icon: '⏳', label: 'Held' },
  actuate: { icon: '⚡', label: 'Actuated' },
  notify: { icon: '📨', label: 'Notified' },
  offline: { icon: '📡', label: 'Offline' },
  reconnect: { icon: '🔌', label: 'Reconnected' },
};

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isNarrow, gutter } = useResponsive();
  const { status, account, token } = useAuth();

  const [home, setHome] = useState<HomeModel | null>(null);
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [wish, setWish] = useState('');
  const [authoring, setAuthoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, w, e] = await Promise.all([
        describeHome(token),
        listWatches(token),
        listEvents(20, token),
      ]);
      setHome(h);
      setWatches(w);
      setEvents(e);
      const sensors = h.capabilities.filter((c) => c.kind === 'sensor');
      const pairs = await Promise.all(
        sensors.map(async (c) => [c.id, await readInput(c.id, token).catch(() => null)] as const),
      );
      setReadings(Object.fromEntries(pairs));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (status === 'signedIn') void load();
  }, [status, load]);

  const submitWish = async () => {
    if (!wish.trim() || authoring) return;
    setAuthoring(true);
    setError(null);
    try {
      await authorWatch(wish.trim(), token);
      setWish('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthoring(false);
    }
  };

  if (status === 'loading') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.ember} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/signin" />;

  const sensors = home?.capabilities.filter((c) => c.kind === 'sensor') ?? [];
  const devices = home?.nodes.length ?? 0;
  const pad = { paddingHorizontal: gutter };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.six }}>
        <GlowOrb size={560} color={theme.emberGlow} intensity={0.7} style={styles.glow} />

        {/* nav */}
        <View style={[pad, styles.nav]}>
          <Pressable onPress={() => router.push('/')}>
            <Wordmark size={24} />
          </Pressable>
          <AuthMenu align="right" width={210} />
        </View>

        <View style={[pad, styles.body]}>
          {/* header */}
          <View style={styles.headRow}>
            <View style={{ flex: 1, gap: Spacing.two }}>
              <Pill dotColor={theme.success}>Signed in · {account?.email ?? 'account'}</Pill>
              <Text style={[styles.h1, { color: theme.text }]}>Your home</Text>
            </View>
            <Pressable
              onPress={load}
              style={[styles.refresh, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <Text style={[styles.refreshText, { color: theme.textSecondary }]}>
                {loading ? '…' : '↻ Refresh'}
              </Text>
            </Pressable>
          </View>

          {/* summary chips */}
          <View style={styles.chips}>
            <Stat theme={theme} value={home?.zones.length ?? '—'} label="zones" />
            <Stat theme={theme} value={devices || '—'} label="devices" />
            <Stat theme={theme} value={sensors.length || '—'} label="sensors" />
            <Stat theme={theme} value={watches?.length ?? '—'} label="watches" />
          </View>

          {error ? (
            <Card style={{ borderColor: theme.info }}>
              <Text style={[styles.errTitle, { color: theme.info }]}>Couldn’t reach the backend</Text>
              <Text style={[styles.errBody, { color: theme.textSecondary }]}>{error}</Text>
              <Text style={[styles.errHint, { color: theme.textMuted }]}>
                Check that the backend is running (cd backend && npm run dev → :9000) and that
                EXPO_PUBLIC_BACKEND_URL points at it.
              </Text>
            </Card>
          ) : null}

          {/* describe a new watch */}
          <Card glow style={{ gap: Spacing.three }}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Describe a new watch</Text>
            <View style={[styles.describeRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
              <TextInput
                value={wish}
                onChangeText={setWish}
                onSubmitEditing={submitWish}
                editable={!authoring}
                placeholder="Warn me if the garage is left open after dark…"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                  webNoOutline,
                ]}
              />
              <Pressable
                onPress={submitWish}
                disabled={!wish.trim() || authoring}
                style={[
                  styles.authorBtn,
                  { backgroundColor: wish.trim() && !authoring ? theme.ember : theme.backgroundSelected },
                ]}>
                {authoring ? (
                  <ActivityIndicator color={theme.onEmber} />
                ) : (
                  <Text
                    style={[
                      styles.authorText,
                      { color: wish.trim() ? theme.onEmber : theme.textMuted },
                    ]}>
                    Author →
                  </Text>
                )}
              </Pressable>
            </View>
          </Card>

          {/* sensors */}
          {sensors.length ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Sensors</Text>
              <View style={styles.tileGrid}>
                {sensors.map((c) => (
                  <View
                    key={c.id}
                    style={[styles.tile, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <Text style={styles.tileIcon}>{c.icon}</Text>
                    <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1}>
                      {formatValue(readings[c.id] ?? null, c)}
                    </Text>
                    <Text style={[styles.tileLabel, { color: theme.textMuted }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* watches */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Watches{watches ? ` (${watches.length})` : ''}
            </Text>
            {watches && watches.length ? (
              <View style={{ gap: Spacing.three }}>
                {watches.map((w) => (
                  <Card key={w.id} style={{ gap: Spacing.two }}>
                    <View style={styles.watchHead}>
                      <Text style={[styles.watchTitle, { color: theme.text }]}>{w.title}</Text>
                      <View style={styles.watchTags}>
                        <Tag theme={theme} on={w.runsLocally} text={w.runsLocally ? 'local' : 'cloud'} />
                        {w.usesVision ? <Tag theme={theme} on text="vision" /> : null}
                      </View>
                    </View>
                    <Text style={[styles.watchLine, { color: theme.textSecondary }]}>
                      <Text style={{ color: theme.textMuted }}>when </Text>
                      {w.trigger}
                      <Text style={{ color: theme.textMuted }}> → </Text>
                      {w.action}
                    </Text>
                  </Card>
                ))}
              </View>
            ) : (
              <Card>
                <Text style={[styles.empty, { color: theme.textMuted }]}>
                  {loading ? 'Loading…' : 'No watches yet — describe one above to deploy it.'}
                </Text>
              </Card>
            )}
          </View>

          {/* activity */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity</Text>
            <Card style={{ gap: Spacing.two }}>
              {events && events.length ? (
                events.map((ev) => {
                  const tone = EVENT_TONE[ev.kind] ?? { icon: '•', label: ev.kind };
                  return (
                    <View key={ev.id} style={styles.eventRow}>
                      <Text style={styles.eventIcon}>{tone.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.eventKind, { color: theme.text }]}>
                          {tone.label}
                          {ev.evaluatedBy ? (
                            <Text style={{ color: theme.textMuted }}> · {ev.evaluatedBy}</Text>
                          ) : null}
                        </Text>
                        {ev.reasoning ? (
                          <Text style={[styles.eventReason, { color: theme.textSecondary }]}>
                            {ev.reasoning}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.eventTime, { color: theme.textMuted }]}>{ago(ev.ts)}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={[styles.empty, { color: theme.textMuted }]}>
                  {loading ? 'Loading…' : 'Nothing has happened yet.'}
                </Text>
              )}
            </Card>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ theme, value, label }: { theme: ReturnType<typeof useTheme>; value: number | string; label: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function Tag({ theme, on, text }: { theme: ReturnType<typeof useTheme>; on?: boolean; text: string }) {
  return (
    <View
      style={[
        styles.tag,
        {
          borderColor: on ? theme.emberDeep : theme.border,
          backgroundColor: on ? theme.emberGlow : theme.backgroundElement,
        },
      ]}>
      <Text style={[styles.tagText, { color: on ? theme.ember : theme.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', top: -200, alignSelf: 'center' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.select({ web: Spacing.four, default: Spacing.three }),
    paddingBottom: Spacing.three,
    zIndex: 30,
  },
  body: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: Spacing.four },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  h1: { fontFamily: Fonts?.sans, fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  refresh: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1 },
  refreshText: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  stat: {
    minWidth: 96,
    flexGrow: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  statValue: { fontFamily: Fonts?.sans, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },

  cardTitle: { fontFamily: Fonts?.sans, fontSize: 17, fontWeight: '700' },
  describeRow: { gap: Spacing.two, alignItems: 'stretch' },
  input: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts?.sans,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 46,
  },
  authorBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, borderRadius: Radius.pill, minHeight: 46, minWidth: 110 },
  authorText: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },

  section: { gap: Spacing.three },
  sectionTitle: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    minWidth: 120,
    flexGrow: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: 4,
  },
  tileIcon: { fontSize: 18 },
  tileValue: { fontFamily: Fonts?.sans, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  tileLabel: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },

  watchHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  watchTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 16, fontWeight: '700' },
  watchTags: { flexDirection: 'row', gap: 6 },
  watchLine: { fontFamily: Fonts?.sans, fontSize: 14, lineHeight: 21 },

  tag: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.pill, borderWidth: 1 },
  tagText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },

  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: 6 },
  eventIcon: { fontSize: 15, width: 22, textAlign: 'center' },
  eventKind: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '700' },
  eventReason: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19, marginTop: 1 },
  eventTime: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },

  empty: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  errTitle: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  errBody: { fontFamily: Fonts?.mono, fontSize: 12.5, marginTop: 4 },
  errHint: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19, marginTop: 6 },
});
