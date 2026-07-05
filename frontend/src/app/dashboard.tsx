import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMenu } from '@/components/auth-menu';
import { Card, GlowOrb, Pill, Wordmark, useResponsive } from '@/components/landing/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/hooks/use-theme';
import {
  authorWatch,
  deleteWatch,
  describeHome,
  listEvents,
  listWatches,
  readInput,
  updateWatch,
  type HomeCapability,
  type HomeModel,
  type Reading,
  type RunEvent,
  type Watch,
} from '@/lib/home';
import { claimHub, listHubs, unpairHub, type HubView } from '@/lib/hubs';
import { useHubLive } from '@/lib/live';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
// Give the scroll frame a bounded height on web so the ScrollView actually scrolls
// (matches the pattern in demo.tsx). Native gets its height from flex.
const webFullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;

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
  edited: { icon: '✏️', label: 'Edited' },
  removed: { icon: '🗑️', label: 'Removed' },
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
  const insets = useSafeAreaInsets();
  const { status, account, token } = useAuth();

  const [home, setHome] = useState<HomeModel | null>(null);
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [wish, setWish] = useState('');
  const [authoring, setAuthoring] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  const [hubs, setHubs] = useState<HubView[] | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubNotice, setHubNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, w, e, hb] = await Promise.all([
        describeHome(token),
        listWatches(token),
        listEvents(20, token),
        listHubs(token).catch(() => [] as HubView[]),
      ]);
      setHome(h);
      setWatches(w);
      setEvents(e);
      setHubs(hb);
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

  // Realtime: auto-discovers the account's hub and opens a secure, cloud-brokered
  // WebSocket (via Alibaba API Gateway) that streams readings and patches tiles in place.
  // Degrades silently to the load-on-mount + manual refresh path when realtime isn't
  // provisioned or the hub is offline.
  const liveStatus = useHubLive(
    token,
    useCallback((updates: Record<string, Reading>) => {
      setReadings((prev) => ({ ...prev, ...updates }));
    }, []),
  );

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

  const startEdit = (w: Watch) => {
    setWatchError(null);
    setEditingId(w.id);
    setEditText(w.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async () => {
    if (!editingId || !editText.trim() || savingEdit) return;
    setSavingEdit(true);
    setWatchError(null);
    try {
      const { question } = await updateWatch(editingId, editText.trim(), token);
      // Recompiled in place — swap the updated watch into the list without a full reload.
      setWatches((prev) => (prev ? prev.map((w) => (w.id === question.id ? question : w)) : prev));
      setEditingId(null);
      setEditText('');
      listEvents(20, token).then(setEvents).catch(() => {});
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const removeWatch = async (w: Watch) => {
    if (deletingId) return;
    setWatchError(null);
    setDeletingId(w.id);
    try {
      await deleteWatch(w.id, token);
      setWatches((prev) => (prev ? prev.filter((x) => x.id !== w.id) : prev));
      if (editingId === w.id) cancelEdit();
      listEvents(20, token).then(setEvents).catch(() => {});
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const submitClaim = async () => {
    const code = claimCode.trim();
    if (!code || claiming) return;
    setClaiming(true);
    setHubError(null);
    setHubNotice(null);
    try {
      const hub = await claimHub(code, token);
      setClaimCode('');
      setHubNotice(`Connected “${hub.name}”. It’ll come online once it checks in.`);
      await load();
    } catch (err) {
      setHubError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const removeHub = async (hub: HubView) => {
    setHubError(null);
    setHubNotice(null);
    try {
      await unpairHub(hub.id, token);
      setHubs((prev) => (prev ? prev.filter((h) => h.id !== hub.id) : prev));
    } catch (err) {
      setHubError((err as Error).message);
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
    <SafeAreaView style={[styles.screen, webFullHeight, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Spacing.six + insets.bottom }}>
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
              <Text style={[styles.h1, isNarrow && styles.h1Narrow, { color: theme.text }]}>Your home</Text>
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
            <Stat theme={theme} value={hubs?.length ?? '—'} label="hubs" />
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

          {/* hubs */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Hubs{hubs ? ` (${hubs.length})` : ''}
            </Text>

            {hubs && hubs.length ? (
              <View style={{ gap: Spacing.two }}>
                {hubs.map((h) => (
                  <Card key={h.id} style={styles.hubRow}>
                    <View style={[styles.hubDot, { backgroundColor: h.online ? theme.success : theme.textMuted }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.hubName, { color: theme.text }]} numberOfLines={1}>
                        {h.name}
                      </Text>
                      <Text style={[styles.hubMeta, { color: theme.textMuted }]} numberOfLines={1}>
                        {h.online
                          ? 'Online'
                          : h.lastSeenAt
                            ? `Offline · last seen ${ago(h.lastSeenAt)}`
                            : 'Waiting for first check-in…'}
                        {h.fw ? ` · fw ${h.fw}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeHub(h)}
                      style={[styles.unpairBtn, { borderColor: theme.border }]}>
                      <Text style={[styles.unpairText, { color: theme.textSecondary }]}>Unpair</Text>
                    </Pressable>
                  </Card>
                ))}
              </View>
            ) : null}

            <Card glow={!hubs?.length} style={{ gap: Spacing.two }}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Connect a hub</Text>
              <Text style={[styles.hubHint, { color: theme.textSecondary }]}>
                Power on your Hearth hub and enter the 8-character code it displays.
              </Text>
              <View style={[styles.describeRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
                <TextInput
                  value={claimCode}
                  onChangeText={setClaimCode}
                  onSubmitEditing={submitClaim}
                  editable={!claiming}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="ABCD-2345"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    styles.codeInput,
                    { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                    webNoOutline,
                  ]}
                />
                <Pressable
                  onPress={submitClaim}
                  disabled={!claimCode.trim() || claiming}
                  style={[
                    styles.authorBtn,
                    { backgroundColor: claimCode.trim() && !claiming ? theme.ember : theme.backgroundSelected },
                  ]}>
                  {claiming ? (
                    <ActivityIndicator color={theme.onEmber} />
                  ) : (
                    <Text style={[styles.authorText, { color: claimCode.trim() ? theme.onEmber : theme.textMuted }]}>
                      Connect →
                    </Text>
                  )}
                </Pressable>
              </View>
              {hubError ? <Text style={[styles.hubMsg, { color: theme.info }]}>{hubError}</Text> : null}
              {hubNotice ? <Text style={[styles.hubMsg, { color: theme.success }]}>{hubNotice}</Text> : null}
              <Text style={[styles.hubHint, { color: theme.textMuted }]}>
                Don’t have a hub yet?{' '}
                <Text
                  onPress={() =>
                    Linking.openURL('https://github.com/mattrickslauer/hearth/tree/main/hub')
                  }
                  style={{ color: theme.ember, fontWeight: '600' }}>
                  Install it on any machine →
                </Text>
              </Text>
            </Card>
          </View>

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
              <View style={styles.sensorsHead}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Sensors</Text>
                {liveStatus === 'live' ? (
                  <View style={styles.liveBadge}>
                    <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
                    <Text style={[styles.liveText, { color: theme.success }]}>live</Text>
                  </View>
                ) : liveStatus === 'connecting' ? (
                  <Text style={[styles.liveText, { color: theme.textMuted }]}>connecting…</Text>
                ) : liveStatus === 'offline' ? (
                  <Text style={[styles.liveText, { color: theme.textMuted }]}>hub offline</Text>
                ) : null}
              </View>
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
            {watchError ? (
              <Text style={[styles.hubMsg, { color: theme.info }]}>{watchError}</Text>
            ) : null}
            {watches && watches.length ? (
              <View style={{ gap: Spacing.three }}>
                {watches.map((w) =>
                  editingId === w.id ? (
                    <Card key={w.id} glow style={{ gap: Spacing.two }}>
                      <Text style={[styles.cardTitle, { color: theme.text }]}>Edit watch</Text>
                      <Text style={[styles.hubHint, { color: theme.textMuted }]}>
                        Saving re-compiles the watch from your description — the trigger, action
                        and bindings are re-derived.
                      </Text>
                      <TextInput
                        value={editText}
                        onChangeText={setEditText}
                        editable={!savingEdit}
                        multiline
                        placeholder="Describe what this watch should do…"
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.input,
                          styles.editInput,
                          { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                          webNoOutline,
                        ]}
                      />
                      <View style={styles.watchActions}>
                        <Pressable
                          onPress={cancelEdit}
                          disabled={savingEdit}
                          style={[styles.watchBtn, { borderColor: theme.border }]}>
                          <Text style={[styles.watchBtnText, { color: theme.textSecondary }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={saveEdit}
                          disabled={!editText.trim() || savingEdit}
                          style={[
                            styles.watchBtnPrimary,
                            { backgroundColor: editText.trim() && !savingEdit ? theme.ember : theme.backgroundSelected },
                          ]}>
                          {savingEdit ? (
                            <ActivityIndicator color={theme.onEmber} />
                          ) : (
                            <Text style={[styles.watchBtnText, { color: editText.trim() ? theme.onEmber : theme.textMuted }]}>
                              Re-compile →
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </Card>
                  ) : (
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
                      <View style={styles.watchActions}>
                        <Pressable
                          onPress={() => startEdit(w)}
                          disabled={deletingId === w.id}
                          style={[styles.watchBtn, { borderColor: theme.border }]}>
                          <Text style={[styles.watchBtnText, { color: theme.textSecondary }]}>Edit</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => removeWatch(w)}
                          disabled={deletingId === w.id}
                          style={[styles.watchBtn, { borderColor: theme.border }]}>
                          {deletingId === w.id ? (
                            <ActivityIndicator color={theme.warn} />
                          ) : (
                            <Text style={[styles.watchBtnText, { color: theme.warn }]}>Delete</Text>
                          )}
                        </Pressable>
                      </View>
                    </Card>
                  ),
                )}
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
  screen: { flex: 1 },
  scroll: { flex: 1, width: '100%' },
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
  h1Narrow: { fontSize: 27, letterSpacing: -0.6 },
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

  hubHint: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  codeInput: { fontFamily: Fonts?.mono, letterSpacing: 2, textTransform: 'uppercase' },
  hubMsg: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 18 },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  hubDot: { width: 10, height: 10, borderRadius: 5 },
  hubName: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  hubMeta: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '600' },
  unpairBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1 },
  unpairText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },

  section: { gap: Spacing.three },
  sectionTitle: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  sensorsHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

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
  watchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 2 },
  watchBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
    minHeight: 38,
  },
  watchBtnPrimary: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 118,
    minHeight: 38,
  },
  watchBtnText: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },
  editInput: { minHeight: 72, textAlignVertical: 'top' },

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
