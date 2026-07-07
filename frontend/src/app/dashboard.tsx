import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
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
  listCadences,
  listEvents,
  listWatches,
  readInput,
  setCadence,
  updateWatch,
  type Cadences,
  type ContextSuggestion,
  type HomeCapability,
  type HomeModel,
  type Reading,
  type RunEvent,
  type Watch,
} from '@/lib/home';
import { claimHub, listHubs, unpairHub, type HubView } from '@/lib/hubs';
import { useHubLive, type LiveStatus } from '@/lib/live';

// The hub's LAN address (e.g. http://192.168.1.27:8899). When set, the dashboard shows a live
// camera tile that pulls the hub's latest snapped frame on demand. Frames are LAN-direct (the
// hub holds the pixels); the hosted/judge path surfaces them via the cloud in a follow-up.
const HUB_URL = process.env.EXPO_PUBLIC_HUB_URL?.replace(/\/$/, '') || '';

// Icon per context-suggestion kind (what Qwen recommends adding for a vision watch).
const SUGGEST_ICON: Record<string, string> = {
  reference_images: '🖼️',
  aim: '🎯',
  cadence: '⏱️',
  quality: '✨',
  lighting: '💡',
  placement: '📐',
  other: '•',
};

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

// Format a claim code as the user types (or pastes): strip anything that isn't alphanumeric —
// including any dashes they typed or that came in a paste — uppercase, cap at 8 chars, then
// re-insert a single dash after the 4th. So "abcd2345", "ABCD-2345", and "ab-cd-23-45" all
// converge on "ABCD-2345", and there's never a duplicate dash. Matches the backend's XXXX-XXXX.
const formatClaimCode = (raw: string): string => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};
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

// Slider snap points for a sensor's sample rate (ms). Bounds mirror the backend clamp
// (500ms–60s); log-ish spacing so the fast end isn't cramped.
const CADENCE_STOPS = [500, 1000, 2000, 5000, 10000, 30000, 60000];
// A sensor with no explicit cadence runs at the firmware default — assume it for the TTL bar.
const DEFAULT_CADENCE_MS = 5000;
const fmtRate = (ms: number): string => `${ms / 1000}s`;
const nearestStop = (ms: number): number => {
  let best = CADENCE_STOPS[0];
  for (const s of CADENCE_STOPS) if (Math.abs(s - ms) < Math.abs(best - ms)) best = s;
  return best;
};

// How each realtime WebSocket state reads in the header. `tone` drives colour + animation:
// live = connected & streaming, pending = negotiating/reconnecting, down = no live socket.
const LIVE_META: Record<LiveStatus, { label: string; tone: 'live' | 'pending' | 'down' }> = {
  live: { label: 'live', tone: 'live' },
  connecting: { label: 'connecting…', tone: 'pending' },
  offline: { label: 'hub offline', tone: 'down' },
  unconfigured: { label: 'realtime off', tone: 'down' },
  off: { label: 'disconnected', tone: 'down' },
};

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
  const [cadences, setCadences] = useState<Cadences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [wish, setWish] = useState('');
  const [authoring, setAuthoring] = useState(false);
  // When Qwen compiles a vision wish it recommends the context that would make it work well
  // (reference photos of household members, aim, cadence…). We surface that right after authoring.
  const [suggestions, setSuggestions] = useState<{ title: string; items: ContextSuggestion[] } | null>(null);

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
      const [h, w, e, hb, cd] = await Promise.all([
        describeHome(token),
        listWatches(token),
        listEvents(20, token),
        listHubs(token).catch(() => [] as HubView[]),
        listCadences(token).catch(() => ({}) as Cadences),
      ]);
      setHome(h);
      setWatches(w);
      setEvents(e);
      setHubs(hb);
      setCadences(cd);
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
      const { question } = await authorWatch(wish.trim(), token);
      setSuggestions(
        question.contextSuggestions?.length
          ? { title: question.title, items: question.contextSuggestions }
          : null,
      );
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

  // Ask one sensor to sample faster/slower. Optimistic: reflect the choice at once, then let
  // the hub relay it to the node — that sensor's readings speed up within a few seconds.
  const changeCadence = async (input: string, ms: number) => {
    const prev = cadences[input];
    setCadences((c) => ({ ...c, [input]: ms }));
    try {
      await setCadence(input, ms, token);
    } catch {
      setCadences((c) => {
        const next = { ...c };
        if (prev == null) delete next[input];
        else next[input] = prev;
        return next;
      });
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
            <View style={styles.headBtns}>
              <Pressable
                onPress={() => router.push('/memory')}
                style={[styles.refresh, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <Text style={[styles.refreshText, { color: theme.textSecondary }]}>◆ Memory</Text>
              </Pressable>
              <Pressable
                onPress={load}
                style={[styles.refresh, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <Text style={[styles.refreshText, { color: theme.textSecondary }]}>
                  {loading ? '…' : '↻ Refresh'}
                </Text>
              </Pressable>
            </View>
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
                  onChangeText={(t) => setClaimCode(formatClaimCode(t))}
                  onSubmitEditing={submitClaim}
                  editable={!claiming}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={9}
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

          {/* Qwen's context suggestions — the agent telling you what it needs to solve the wish well */}
          {suggestions ? (
            <Card glow style={{ gap: Spacing.two, borderColor: theme.emberDeep }}>
              <View style={styles.suggestHead}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  ✨ To make “{suggestions.title}” work well, Qwen suggests
                </Text>
                <Pressable onPress={() => setSuggestions(null)} hitSlop={8}>
                  <Text style={[styles.suggestDismiss, { color: theme.textMuted }]}>Dismiss</Text>
                </Pressable>
              </View>
              {suggestions.items.map((s, i) => (
                <View key={i} style={styles.suggestRow}>
                  <Text style={styles.suggestIcon}>{SUGGEST_ICON[s.kind] ?? '•'}</Text>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[styles.suggestTitle, { color: theme.text }]}>{s.title}</Text>
                    <Text style={[styles.suggestWhy, { color: theme.textSecondary }]}>{s.why}</Text>
                  </View>
                </View>
              ))}
              <Pressable
                onPress={() => router.push('/memory')}
                style={[styles.suggestCta, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                <Text style={[styles.suggestCtaText, { color: theme.ember }]}>＋ Add reference photos →</Text>
              </Pressable>
            </Card>
          ) : null}

          {/* camera — a sensor that snaps a frame on a cadence (shown when a hub URL is set) */}
          {HUB_URL ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Camera</Text>
              <CameraCard theme={theme} hubUrl={HUB_URL} />
            </View>
          ) : null}

          {/* sensors */}
          {sensors.length ? (
            <View style={styles.section}>
              <View style={styles.sensorsHead}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Sensors</Text>
                <LiveIndicator theme={theme} status={liveStatus} />
              </View>
              <View style={styles.tileGrid}>
                {sensors.map((c) => (
                  <SensorTile
                    key={c.id}
                    theme={theme}
                    cap={c}
                    reading={readings[c.id] ?? null}
                    active={cadences[c.id]}
                    onChange={(ms) => changeCadence(c.id, ms)}
                  />
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

// Quality snap points (JPEG %), low→high — the detail/token tradeoff the hub maps to ffmpeg -q:v.
const QUALITY_STOPS = [30, 50, 70, 85, 95];

interface CamConfig {
  id: string;
  source: string;
  width: number;
  quality: number;
  cadenceMs: number;
  hasFrame: boolean;
  frameAt: number | null;
}

// The camera is just another sensor: it snaps a frame on a cadence. This tile pulls the hub's
// latest frame on demand (never a stream) and exposes the two sensor knobs — snap rate + quality.
function CameraCard({ theme, hubUrl }: { theme: ReturnType<typeof useTheme>; hubUrl: string }) {
  const [cfg, setCfg] = useState<CamConfig | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  const [frameOk, setFrameOk] = useState(false);
  const [snappedAt, setSnappedAt] = useState<number | null>(null);

  const cadenceMs = cfg?.cadenceMs ?? DEFAULT_CADENCE_MS;
  const quality = cfg?.quality ?? 70;

  const loadConfig = useCallback(() => {
    fetch(`${hubUrl}/camera`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: CamConfig) => {
        setCfg(c);
        setReachable(true);
      })
      .catch(() => setReachable(false));
  }, [hubUrl]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Re-pull the frame on the snap cadence — a photo every N seconds, faithful to "sampled, not streamed".
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), Math.max(1000, cadenceMs));
    return () => clearInterval(id);
  }, [cadenceMs]);

  const post = useCallback(
    (patch: Record<string, number>) => {
      fetch(`${hubUrl}/camera`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
        .then((r) => r.json())
        .then((c: CamConfig) => setCfg(c))
        .catch(() => {});
    },
    [hubUrl],
  );

  const uri = `${hubUrl}/frame?t=${tick}`;
  const sourceTag = reachable === false ? 'hub offline' : cfg?.source === 'test' ? 'test source' : 'OBS';

  return (
    <Card style={{ gap: Spacing.three }}>
      <View style={styles.camHead}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Doorway camera</Text>
        <View style={styles.watchTags}>
          <Tag theme={theme} on text="vision" />
          <Tag theme={theme} on={reachable === true} text={sourceTag} />
        </View>
      </View>

      <View style={[styles.camBox, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        {reachable !== false ? (
          <Image
            source={{ uri }}
            style={styles.camImg}
            resizeMode="cover"
            onLoad={() => {
              setFrameOk(true);
              setSnappedAt(Date.now());
            }}
            onError={() => setFrameOk(false)}
          />
        ) : null}
        {frameOk && reachable ? (
          <View style={styles.camStamp}>
            <View style={[styles.camStampDot, { backgroundColor: theme.ember }]} />
            <Text style={styles.camStampText}>
              snapped {snappedAt ? new Date(snappedAt).toLocaleTimeString() : ''} · every {fmtRate(cadenceMs)}
            </Text>
          </View>
        ) : (
          <View style={styles.camPlaceholder}>
            <Text style={[styles.camPlaceholderText, { color: theme.textMuted }]}>
              {reachable === false
                ? `Can’t reach the hub at ${hubUrl}. Is it running with HEARTH_CAM=1?`
                : 'Waiting for a frame — start OBS streaming to the hub, or run with HEARTH_CAM_SOURCE=test.'}
            </Text>
          </View>
        )}
      </View>

      {reachable ? (
        <View style={styles.camControls}>
          <StepSlider
            theme={theme}
            label="Snap rate"
            stops={CADENCE_STOPS}
            value={cadenceMs}
            format={fmtRate}
            onCommit={(v) => post({ cadenceMs: v })}
          />
          <StepSlider
            theme={theme}
            label="Quality"
            stops={QUALITY_STOPS}
            value={quality}
            format={(q) => `${q}%`}
            onCommit={(v) => post({ quality: v })}
          />
        </View>
      ) : null}

      <Text style={[styles.camCaption, { color: theme.textMuted }]}>
        Frames are pulled on demand from the hub and read by Qwen-VL only when a vision watch needs
        them — no video stream leaves the home.
      </Text>
    </Card>
  );
}

// Generic stepped slider (snap points) — used for the camera's rate + quality knobs. Same
// interaction model as the per-sensor CadenceSlider, commits the chosen stop on release.
function StepSlider({
  theme,
  label,
  stops,
  value,
  format,
  onCommit,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  stops: number[];
  value: number;
  format: (n: number) => string;
  onCommit: (v: number) => void;
}) {
  const [w, setW] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const nearest = (v: number): number => {
    let b = 0;
    for (let i = 0; i < stops.length; i++) if (Math.abs(stops[i] - v) < Math.abs(stops[b] - v)) b = i;
    return b;
  };
  const idx = dragIdx ?? nearest(value);
  const frac = idx / (stops.length - 1);
  const posToIdx = (x: number): number => {
    if (w <= 0) return idx;
    const f = Math.max(0, Math.min(1, x / w));
    return Math.round(f * (stops.length - 1));
  };

  return (
    <View style={styles.camSlider}>
      <View style={styles.camSliderLabelRow}>
        <Text style={[styles.camSliderLabel, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[styles.sliderVal, { color: theme.ember }]}>{format(stops[idx])}</Text>
      </View>
      <View
        style={styles.sliderTrackWrap}
        onLayout={(ev) => setW(ev.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDragIdx(posToIdx(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDragIdx(posToIdx(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          const i = posToIdx(e.nativeEvent.locationX);
          setDragIdx(null);
          onCommit(stops[i]);
        }}
        onResponderTerminate={() => setDragIdx(null)}>
        <View style={[styles.sliderTrack, { backgroundColor: theme.backgroundElement }]} />
        <View style={[styles.sliderFill, { backgroundColor: theme.emberDeep, width: `${frac * 100}%` }]} />
        <View style={[styles.sliderThumb, { backgroundColor: theme.ember, borderColor: theme.card, left: `${frac * 100}%` }]} />
      </View>
    </View>
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

// Realtime connection status, driven entirely by the WebSocket lifecycle (via useHubLive):
// a green pulsing dot while the socket is open and streaming, an amber blink while it's
// negotiating/reconnecting, and a steady muted dot when there's no live socket.
function LiveIndicator({ theme, status }: { theme: ReturnType<typeof useTheme>; status: LiveStatus }) {
  const meta = LIVE_META[status];
  const tone = meta.tone;
  const color = tone === 'live' ? theme.success : tone === 'pending' ? theme.warn : theme.textMuted;
  const [pulse] = useState(() => new Animated.Value(0.9));
  useEffect(() => {
    if (tone === 'down') {
      pulse.stopAnimation();
      pulse.setValue(0.9);
      return;
    }
    const dur = tone === 'live' ? 1100 : 480; // slow breathe when live, quick blink when connecting
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: dur, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: dur, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tone, pulse]);
  return (
    <View style={styles.liveBadge}>
      <Animated.View style={[styles.liveDot, { backgroundColor: color, opacity: pulse }]} />
      <Text style={[styles.liveText, { color }]}>{meta.label}</Text>
    </View>
  );
}

function SensorTile({
  theme,
  cap,
  reading,
  active,
  onChange,
}: {
  theme: ReturnType<typeof useTheme>;
  cap: HomeCapability;
  reading: Reading | null;
  active?: number;
  onChange: (ms: number) => void;
}) {
  // The interval this sensor is actually running at (falls back to the firmware default).
  const effectiveMs = active ?? DEFAULT_CADENCE_MS;
  const [pulse] = useState(() => new Animated.Value(0));
  const [ttl] = useState(() => new Animated.Value(0));
  const ts = reading?.ts;

  // Every fresh reading (its timestamp changes) fires a pulse and refills the TTL bar, which
  // then drains over the sensor's own interval — a visible heartbeat you can watch speed up.
  useEffect(() => {
    if (ts == null) return;
    pulse.setValue(1);
    Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }).start();
    ttl.setValue(1);
    const drain = Animated.timing(ttl, { toValue: 0, duration: effectiveMs, useNativeDriver: false });
    drain.start();
    return () => drain.stop();
  }, [ts, effectiveMs, pulse, ttl]);

  const ring = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [2.6, 1] }) }],
  };
  const ttlWidth = ttl.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={[styles.tile, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.tileTop}>
        <Text style={styles.tileIcon}>{cap.icon}</Text>
        <View style={styles.pulseWrap}>
          <Animated.View style={[styles.pulseRing, { borderColor: theme.ember }, ring]} />
          <View style={[styles.pulseDot, { backgroundColor: reading ? theme.ember : theme.textMuted }]} />
        </View>
      </View>
      <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1}>
        {formatValue(reading, cap)}
      </Text>
      <Text style={[styles.tileLabel, { color: theme.textMuted }]} numberOfLines={1}>
        {cap.label}
      </Text>
      {/* TTL: full on each receive, drains toward the next expected reading */}
      <View style={[styles.ttlTrack, { backgroundColor: theme.backgroundElement }]}>
        <Animated.View style={[styles.ttlFill, { backgroundColor: theme.ember, width: ttlWidth }]} />
      </View>
      <CadenceSlider theme={theme} valueMs={effectiveMs} isSet={active != null} onChange={onChange} />
    </View>
  );
}

// A tiny stepped slider (500ms–60s) on React Native's built-in responder props (what
// PanResponder wraps) — no refs, no worklets, so it behaves identically on web and native.
// Commits the chosen rate on release.
function CadenceSlider({
  theme,
  valueMs,
  isSet,
  onChange,
}: {
  theme: ReturnType<typeof useTheme>;
  valueMs: number;
  isSet: boolean;
  onChange: (ms: number) => void;
}) {
  const [w, setW] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const baseIdx = Math.max(0, CADENCE_STOPS.indexOf(nearestStop(valueMs)));
  const idx = dragIdx ?? baseIdx;
  const frac = idx / (CADENCE_STOPS.length - 1);

  const posToIdx = (x: number): number => {
    if (w <= 0) return idx;
    const f = Math.max(0, Math.min(1, x / w));
    return Math.round(f * (CADENCE_STOPS.length - 1));
  };

  const lit = isSet || dragIdx != null;
  return (
    <View style={styles.sliderRow}>
      <View
        style={styles.sliderTrackWrap}
        onLayout={(ev) => setW(ev.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDragIdx(posToIdx(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDragIdx(posToIdx(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          const i = posToIdx(e.nativeEvent.locationX);
          setDragIdx(null);
          onChange(CADENCE_STOPS[i]);
        }}
        onResponderTerminate={() => setDragIdx(null)}>
        <View style={[styles.sliderTrack, { backgroundColor: theme.backgroundElement }]} />
        <View style={[styles.sliderFill, { backgroundColor: theme.emberDeep, width: `${frac * 100}%` }]} />
        <View
          style={[styles.sliderThumb, { backgroundColor: theme.ember, borderColor: theme.card, left: `${frac * 100}%` }]}
        />
      </View>
      <Text style={[styles.sliderVal, { color: lit ? theme.ember : theme.textMuted }]}>{fmtRate(CADENCE_STOPS[idx])}</Text>
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
    minWidth: 168,
    flexGrow: 1,
    flexBasis: 168,
    maxWidth: 260,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: 4,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileIcon: { fontSize: 18 },
  tileValue: { fontFamily: Fonts?.sans, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  tileLabel: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },

  // pulse — a heartbeat ping in the tile corner on every fresh reading
  pulseWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },

  // TTL — a bar that refills on receive and drains toward the next expected reading
  ttlTrack: { height: 3, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  ttlFill: { height: 3, borderRadius: 2 },

  // slider — stepped sample-rate control per sensor
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 8 },
  sliderTrackWrap: { flex: 1, height: 22, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2 },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2, left: 0 },
  sliderThumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginLeft: -7 },
  sliderVal: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', minWidth: 34, textAlign: 'right' },

  // Qwen context-suggestion card — the agent telling you what it needs
  suggestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  suggestDismiss: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  suggestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: 3 },
  suggestIcon: { fontSize: 16, width: 24, textAlign: 'center' },
  suggestTitle: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  suggestWhy: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19 },
  suggestCta: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  suggestCtaText: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '700' },
  headBtns: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },

  // camera tile — a frame snapped on a cadence, plus rate + quality knobs
  camHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  camBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  camPlaceholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  camPlaceholderText: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
  camStamp: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  camStampDot: { width: 6, height: 6, borderRadius: 3 },
  camStampText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  camControls: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  camSlider: { flexGrow: 1, flexBasis: 200, gap: 5 },
  camSliderLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  camSliderLabel: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  camCaption: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },

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
