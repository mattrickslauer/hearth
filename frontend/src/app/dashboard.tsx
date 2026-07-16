import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMenu } from '@/components/auth-menu';
import { ActivityList } from '@/components/dashboard/activity';
import {
  CloudCameraCard,
  CloudCameraSheetBody,
  HubCameraCard,
  HubCameraSheetBody,
  useHubCamera,
} from '@/components/dashboard/camera';
import { ConnectHubBody, HubRow, HubSheetBody } from '@/components/dashboard/hubs';
import { SensorSheetBody, SensorTile } from '@/components/dashboard/sensors';
import { LiveIndicator, PillButton, SectionLabel, Stat } from '@/components/dashboard/shared';
import { WatchCard, WatchEditBody, WatchSheetBody } from '@/components/dashboard/watches';
import { GlowOrb, Wordmark, useResponsive } from '@/components/landing/ui';
import { NotifyChannelsCard } from '@/components/notify-channels-card';
import { TuneWatch, type TunePatch } from '@/components/tune-watch';
import { ActionFab } from '@/components/ui/action-fab';
import { Rail, TabBar, type NavTab } from '@/components/ui/nav';
import { Sheet } from '@/components/ui/sheet';
import { Fonts, Layer, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/hooks/use-theme';
import {
  authorWatch,
  configureWatch,
  deleteWatch,
  describeHome,
  linkWatchMemory,
  listCadences,
  listEvents,
  listMemory,
  listWatches,
  newerReading,
  readInput,
  removeSensor,
  setCadence,
  updateWatch,
  type Cadences,
  type ContextSuggestion,
  type HomeCapability,
  type HomeModel,
  type MemoryObject,
  type Reading,
  type RunEvent,
  type Watch,
} from '@/lib/home';
import { claimHub, listHubs, unpairHub, type HubView } from '@/lib/hubs';
import { useHubLive } from '@/lib/live';

// The hub's LAN address (e.g. http://192.168.1.27:8899). When set — and no cloud vision sensor
// exists — the dashboard falls back to pulling frames straight off the hub (local dev / LAN).
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
// Give the scroll frame a bounded height on web so the ScrollView actually scrolls
// (matches the pattern in demo.tsx). Native gets its height from flex.
const webFullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;

type TabKey = 'home' | 'sensors' | 'watches' | 'activity';

/**
 * Which overlay is on top, if any. One slot rather than a boolean per sheet: only one thing can
 * own the z-axis at a time, and saying so in the type makes the alternative unrepresentable.
 */
type SheetState =
  | { kind: 'none' }
  | { kind: 'describe' }
  | { kind: 'suggest' }
  | { kind: 'connectHub' }
  | { kind: 'hub'; id: string }
  | { kind: 'sensor'; id: string }
  | { kind: 'camera'; id: string }
  | { kind: 'hubCamera' }
  | { kind: 'watch'; id: string }
  | { kind: 'editWatch'; id: string }
  | { kind: 'tune'; id: string };

/**
 * The dashboard is three layers deep, on purpose.
 *
 *   base   — the page: one tab's worth of read-only status, scrollable, nothing to mis-tap.
 *   chrome — a top bar, navigation docked to whichever edge the device makes reachable, and
 *            the ember FAB that starts everything.
 *   sheets — every form, knob and destructive action, one tap above the page.
 *
 * It used to be one flat scroll, which gave a phone a mile of form to thumb past and a desktop
 * a narrow column with empty space either side. Now the page answers "what's happening?" and
 * the z-axis answers "what do I want to change?".
 */
export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isWide, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const { status, account, token } = useAuth();

  const [tab, setTab] = useState<TabKey>('home');
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const closeSheet = useCallback(() => setSheet({ kind: 'none' }), []);

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
  // (reference photos of household members, aim, cadence…). We surface that in its own sheet.
  const [suggestions, setSuggestions] = useState<{ title: string; items: ContextSuggestion[] } | null>(null);

  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  // Removing a hub-reported device: the input id in flight, and what to say about it afterwards.
  const [removingSensor, setRemovingSensor] = useState<string | null>(null);
  const [sensorNotice, setSensorNotice] = useState<string | null>(null);

  const [savingTune, setSavingTune] = useState(false);
  const [tuneError, setTuneError] = useState<string | null>(null);
  // Authoring can produce two things worth saying, and only one layer to say them on: Qwen's
  // context suggestions, and the budget of a cloud watch. When both apply we queue the tune
  // behind the suggestions rather than dropping either.
  const [pendingTuneId, setPendingTuneId] = useState<string | null>(null);

  const [memory, setMemory] = useState<MemoryObject[]>([]);

  const [hubs, setHubs] = useState<HubView[] | null>(null);
  const [claimCode, setClaimCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubNotice, setHubNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, w, e, hb, cd, mem] = await Promise.all([
        describeHome(token),
        listWatches(token),
        listEvents(20, token),
        listHubs(token).catch(() => [] as HubView[]),
        listCadences(token).catch(() => ({}) as Cadences),
        listMemory(token).catch(() => [] as MemoryObject[]),
      ]);
      setHome(h);
      setWatches(w);
      setEvents(e);
      setHubs(hb);
      setCadences(cd);
      setMemory(mem);
      const sensors = h.capabilities.filter((c) => c.kind === 'sensor');
      const pairs = await Promise.all(
        sensors.map(async (c) => [c.id, await readInput(c.id, token).catch(() => null)] as const),
      );
      // Merge by timestamp instead of replacing. These reads are N awaited round-trips, and
      // the live socket keeps delivering throughout — a blind replace threw away every frame
      // that landed during the window and could reinstate an older value than the one on
      // screen. Keying off the sensor list still prunes capabilities that went away.
      setReadings((prev) => {
        const next: Record<string, Reading | null> = {};
        for (const [id, fetched] of pairs) next[id] = newerReading(prev[id], fetched);
        return next;
      });
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
      setReadings((prev) => {
        const next = { ...prev };
        for (const [id, r] of Object.entries(updates)) next[id] = newerReading(prev[id], r);
        return next;
      });
    }, []),
  );

  const allSensors = useMemo(() => home?.capabilities.filter((c) => c.kind === 'sensor') ?? [], [home]);
  // Camera (vision) sensors render as their own frame card, not a generic value tile.
  const visionSensors = useMemo(() => allSensors.filter((c) => c.vision), [allSensors]);
  const sensors = useMemo(() => allSensors.filter((c) => !c.vision), [allSensors]);
  // The LAN fallback only exists when the cloud path has no camera to show.
  const showHubCam = !visionSensors.length && !!HUB_URL;
  const hubCam = useHubCamera(showHubCam ? HUB_URL : '');

  const submitWish = async () => {
    if (!wish.trim() || authoring) return;
    setAuthoring(true);
    setError(null);
    try {
      const { question } = await authorWatch(wish.trim(), token);
      const next = question.contextSuggestions?.length
        ? { title: question.title, items: question.contextSuggestions }
        : null;
      setSuggestions(next);
      setWish('');
      // A local watch is free and has no cloud knobs, so there's nothing to tune.
      const tuneable = question.compiledSpec?.kind === 'cloud';
      setTuneError(null);
      // Suggestions first when there are any — they're about making it work at all. The budget
      // follows on their heels (see pendingTuneId), while the wish is still in mind.
      setPendingTuneId(next && tuneable ? question.id : null);
      if (next) setSheet({ kind: 'suggest' });
      else if (tuneable) setSheet({ kind: 'tune', id: question.id });
      else {
        setSheet({ kind: 'none' });
        setTab('watches');
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthoring(false);
    }
  };

  // Persist the real program knobs (mode, rate, model). Expected activity isn't sent — it isn't
  // a property of the program, only of your guess at how busy the scene is.
  const saveTune = async (id: string, patch: TunePatch) => {
    if (savingTune) return;
    setSavingTune(true);
    setTuneError(null);
    try {
      const { question } = await configureWatch(id, patch, token);
      setWatches((prev) => (prev ? prev.map((w) => (w.id === question.id ? question : w)) : prev));
      await load();
      closeSheet();
    } catch (err) {
      setTuneError((err as Error).message);
    } finally {
      setSavingTune(false);
    }
  };

  // Leaving the suggestions hands the layer to the budget, if this watch has one to spend.
  const closeSuggest = () => {
    const next = pendingTuneId;
    setPendingTuneId(null);
    if (next) setSheet({ kind: 'tune', id: next });
    else closeSheet();
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim() || savingEdit) return;
    setSavingEdit(true);
    setWatchError(null);
    try {
      const { question } = await updateWatch(id, editText.trim(), token);
      // Recompiled in place — swap the updated watch into the list without a full reload.
      setWatches((prev) => (prev ? prev.map((w) => (w.id === question.id ? question : w)) : prev));
      setSheet({ kind: 'watch', id });
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
      closeSheet();
      listEvents(20, token).then(setEvents).catch(() => {});
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  // Attach or detach one reference-memory object from a watch. Optimistic: flip the link in place,
  // persist, and roll back to the server's authoritative list if the call fails.
  const toggleWatchMemory = async (w: Watch, memoryId: string) => {
    const current = w.memoryIds ?? [];
    const next = current.includes(memoryId)
      ? current.filter((id) => id !== memoryId)
      : [...current, memoryId];
    setWatchError(null);
    setWatches((prev) => (prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: next } : x)) : prev));
    try {
      const { question } = await linkWatchMemory(w.id, next, token);
      setWatches((prev) =>
        prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: question.memoryIds ?? [] } : x)) : prev,
      );
    } catch (err) {
      setWatchError((err as Error).message);
      setWatches((prev) => (prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: current } : x)) : prev));
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
      closeSheet();
    } catch (err) {
      setHubError((err as Error).message);
    }
  };

  /**
   * Forget a hub-reported device. Removal is by NODE, so every sensor on it goes at once —
   * a camera node is one sensor, but an ESP32 is usually several, and pruning one key while
   * leaving the node would just have the hub re-report it on the next sync.
   *
   * We reload rather than filter locally: the node is gone from the Home Model, and its
   * capabilities, readings and hub grouping all derive from that.
   */
  const removeSensorNode = async (cap: HomeCapability) => {
    if (removingSensor) return;
    setRemovingSensor(cap.id);
    setSensorNotice(null);
    try {
      const { node, snapshots } = await removeSensor(cap.id, token);
      closeSheet();
      await load();
      setSensorNotice(
        snapshots > 1
          ? `Removed “${node}” — it was being reported by ${snapshots} hubs, so the leftover copy is gone too.`
          : `Removed “${node}”. If it's still plugged in, it'll re-register on the next hub sync.`,
      );
    } catch (err) {
      setSensorNotice((err as Error).message);
    } finally {
      setRemovingSensor(null);
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

  const devices = home?.nodes.length ?? 0;
  const pad = { paddingHorizontal: gutter };

  const tabs: NavTab[] = [
    { key: 'home', icon: '🏠', label: 'Home' },
    { key: 'sensors', icon: '📡', label: 'Sensors', badge: sensors.length || null },
    { key: 'watches', icon: '👁', label: 'Watches', badge: watches?.length ?? null },
    { key: 'activity', icon: '📜', label: 'Activity' },
  ];

  const sheetWatch =
    sheet.kind === 'watch' || sheet.kind === 'editWatch'
      ? (watches?.find((w) => w.id === sheet.id) ?? null)
      : null;
  const sheetSensor = sheet.kind === 'sensor' ? allSensors.find((c) => c.id === sheet.id) : undefined;
  const sheetCamera = sheet.kind === 'camera' ? allSensors.find((c) => c.id === sheet.id) : undefined;
  const sheetHub = sheet.kind === 'hub' ? hubs?.find((h) => h.id === sheet.id) : undefined;
  const sheetTune = sheet.kind === 'tune' ? (watches?.find((w) => w.id === sheet.id) ?? null) : null;

  return (
    <SafeAreaView style={[styles.screen, webFullHeight, { backgroundColor: theme.background }]} edges={['top']}>
      {/* chrome: identity and realtime truth, always in the same place */}
      <View style={[pad, styles.topBar, { zIndex: Layer.raised, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.push('/')} accessibilityRole="link">
          <Wordmark size={22} />
        </Pressable>
        <View style={styles.topRight}>
          <LiveIndicator status={liveStatus} />
          <Pressable
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            style={[styles.iconBtn, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <Text style={[styles.iconBtnText, { color: theme.textSecondary }]}>{loading ? '…' : '↻'}</Text>
          </Pressable>
          <AuthMenu align="right" width={210} />
        </View>
      </View>

      <View style={styles.main}>
        {isWide ? <Rail tabs={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} /> : null}

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            // Clear the FAB and the tab bar so the last card is never trapped under chrome.
            paddingBottom: Spacing.six + (isWide ? 0 : 72) + insets.bottom,
          }}>
          <GlowOrb size={560} color={theme.emberGlow} intensity={0.7} style={styles.glow} />

          <View style={[pad, styles.body]}>
            {error ? (
              <View style={[styles.errCard, { borderColor: theme.info, backgroundColor: theme.card }]}>
                <Text style={[styles.errTitle, { color: theme.info }]}>Couldn’t reach the backend</Text>
                <Text style={[styles.errBody, { color: theme.textSecondary }]}>{error}</Text>
                <Text style={[styles.errHint, { color: theme.textMuted }]}>
                  Check that the backend is running (cd backend && npm run dev → :9000) and that
                  EXPO_PUBLIC_BACKEND_URL points at it.
                </Text>
              </View>
            ) : null}

            {/* Outcome of a device removal. Lives above the tabs because the camera you removed
                sits on 'home' and the sensor you removed sits on 'sensors' — same message either
                way. Tap to dismiss; it's an outcome, not a state. */}
            {sensorNotice ? (
              <Pressable
                onPress={() => setSensorNotice(null)}
                accessibilityRole="button"
                accessibilityLabel={`${sensorNotice}. Tap to dismiss.`}>
                <View style={[styles.noticeCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
                  <Text style={[styles.errBody, { color: theme.textSecondary }]}>{sensorNotice}</Text>
                </View>
              </Pressable>
            ) : null}

            {tab === 'home' ? (
              <>
                <View style={{ gap: Spacing.two }}>
                  <Text style={[styles.h1, { color: theme.text }]}>Your home</Text>
                  <Text style={[styles.sub, { color: theme.textMuted }]} numberOfLines={1}>
                    {account?.email ?? 'account'}
                  </Text>
                </View>

                {/* Each number is a door: tap it and you land on the tab that explains it. */}
                <View style={styles.chips}>
                  <Stat value={hubs?.length ?? '—'} label="hubs" />
                  <Stat value={devices || '—'} label="devices" />
                  <Stat value={sensors.length || '—'} label="sensors" onPress={() => setTab('sensors')} />
                  <Stat value={watches?.length ?? '—'} label="watches" onPress={() => setTab('watches')} />
                </View>

                <View style={styles.section}>
                  <SectionLabel>Hubs{hubs ? ` (${hubs.length})` : ''}</SectionLabel>
                  {hubs?.length ? (
                    hubs.map((h) => <HubRow key={h.id} hub={h} onPress={() => setSheet({ kind: 'hub', id: h.id })} />)
                  ) : (
                    <Pressable
                      onPress={() => setSheet({ kind: 'connectHub' })}
                      style={[styles.emptyCta, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                      <Text style={[styles.emptyCtaText, { color: theme.ember }]}>
                        ＋ Connect your first hub →
                      </Text>
                    </Pressable>
                  )}

                  {/* Where a fired "notify me" watch actually lands. Per-account, so it sits with
                      the hubs rather than inside any one of them. */}
                  <NotifyChannelsCard token={token} />
                </View>

                {visionSensors.length ? (
                  <View style={styles.section}>
                    <SectionLabel>Camera</SectionLabel>
                    {visionSensors.map((c) => (
                      <CloudCameraCard
                        key={c.id}
                        cap={c}
                        token={token}
                        cadenceMs={cadences[c.id]}
                        onPress={() => setSheet({ kind: 'camera', id: c.id })}
                      />
                    ))}
                  </View>
                ) : showHubCam ? (
                  <View style={styles.section}>
                    <SectionLabel>Camera</SectionLabel>
                    <HubCameraCard cam={hubCam} onPress={() => setSheet({ kind: 'hubCamera' })} />
                  </View>
                ) : null}

                <View style={styles.section}>
                  <SectionLabel
                    right={
                      <Pressable onPress={() => setTab('activity')} hitSlop={8}>
                        <Text style={[styles.seeAll, { color: theme.ember }]}>See all →</Text>
                      </Pressable>
                    }>
                    Recent activity
                  </SectionLabel>
                  <ActivityList events={events} loading={loading} limit={4} />
                </View>
              </>
            ) : null}

            {tab === 'sensors' ? (
              <View style={styles.section}>
                <SectionLabel right={<LiveIndicator status={liveStatus} />}>
                  Sensors{sensors.length ? ` (${sensors.length})` : ''}
                </SectionLabel>
                {sensors.length ? (
                  <View style={styles.tileGrid}>
                    {sensors.map((c) => (
                      <SensorTile
                        key={c.id}
                        cap={c}
                        reading={readings[c.id] ?? null}
                        active={cadences[c.id]}
                        onPress={() => setSheet({ kind: 'sensor', id: c.id })}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.empty, { color: theme.textMuted }]}>
                    {loading ? 'Loading…' : 'No sensors yet — connect a hub and its nodes will appear here.'}
                  </Text>
                )}
              </View>
            ) : null}

            {tab === 'watches' ? (
              <View style={styles.section}>
                <SectionLabel>Watches{watches ? ` (${watches.length})` : ''}</SectionLabel>
                {watchError ? <Text style={[styles.msg, { color: theme.info }]}>{watchError}</Text> : null}
                {watches?.length ? (
                  watches.map((w) => (
                    <WatchCard key={w.id} watch={w} onPress={() => setSheet({ kind: 'watch', id: w.id })} />
                  ))
                ) : (
                  <Pressable
                    onPress={() => setSheet({ kind: 'describe' })}
                    style={[styles.emptyCta, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                    <Text style={[styles.emptyCtaText, { color: theme.ember }]}>
                      {loading ? 'Loading…' : '＋ Describe your first watch →'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {tab === 'activity' ? (
              <View style={styles.section}>
                <SectionLabel>Activity</SectionLabel>
                <ActivityList events={events} loading={loading} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>

      {!isWide ? <TabBar tabs={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} /> : null}

      {/* Every "create" lives here, on the z-axis — never parked in the scroll. */}
      <ActionFab
        bottomInset={isWide ? 0 : 62 + insets.bottom}
        actions={[
          { icon: '◆', label: 'Reference memory', onPress: () => router.push('/memory') },
          { icon: '🔌', label: 'Connect a hub', onPress: () => setSheet({ kind: 'connectHub' }) },
          { icon: '✨', label: 'Describe a watch', onPress: () => setSheet({ kind: 'describe' }) },
        ]}
      />

      {/* ------------------------------------------------------------------ sheets */}

      <Sheet
        open={sheet.kind === 'describe'}
        onClose={closeSheet}
        title="Describe a new watch"
        subtitle="Plain language — Qwen compiles it into a trigger and an action."
        footer={
          <PillButton
            label="Author →"
            tone="primary"
            grow
            busy={authoring}
            disabled={!wish.trim()}
            onPress={submitWish}
          />
        }>
        <TextInput
          value={wish}
          onChangeText={setWish}
          onSubmitEditing={submitWish}
          editable={!authoring}
          multiline
          placeholder="Warn me if the garage is left open after dark…"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.wishInput,
            { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
            webNoOutline,
          ]}
        />
      </Sheet>

      {/* Qwen's context suggestions — the agent telling you what it needs to do the job well */}
      <Sheet
        open={sheet.kind === 'suggest'}
        onClose={closeSuggest}
        title={suggestions ? `To make “${suggestions.title}” work well` : 'Suggestions'}
        subtitle="Qwen suggests adding this context."
        footer={
          <>
            <PillButton label={pendingTuneId ? 'Next: tune →' : 'Not now'} onPress={closeSuggest} />
            <PillButton
              label="＋ Add photos →"
              tone="primary"
              grow
              onPress={() => {
                setPendingTuneId(null);
                closeSheet();
                router.push('/memory');
              }}
            />
          </>
        }>
        {suggestions?.items.map((s, i) => (
          <View key={i} style={styles.suggestRow}>
            <Text style={styles.suggestIcon}>{SUGGEST_ICON[s.kind] ?? '•'}</Text>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.suggestTitle, { color: theme.text }]}>{s.title}</Text>
              <Text style={[styles.suggestWhy, { color: theme.textSecondary }]}>{s.why}</Text>
            </View>
          </View>
        ))}
      </Sheet>

      <Sheet
        open={sheet.kind === 'connectHub'}
        onClose={closeSheet}
        title="Connect a hub"
        footer={
          <PillButton
            label="Connect →"
            tone="primary"
            grow
            busy={claiming}
            disabled={!claimCode.trim()}
            onPress={submitClaim}
          />
        }>
        <ConnectHubBody
          code={claimCode}
          onChangeCode={setClaimCode}
          onSubmit={submitClaim}
          claiming={claiming}
          error={hubError}
          notice={hubNotice}
        />
      </Sheet>

      <Sheet
        open={sheet.kind === 'hub' && !!sheetHub}
        onClose={closeSheet}
        title={sheetHub?.name ?? 'Hub'}
        subtitle={sheetHub?.online ? 'Online' : 'Offline'}
        footer={
          sheetHub ? (
            <>
              <PillButton label="Done" grow onPress={closeSheet} />
              <PillButton label="Unpair" tone="danger" onPress={() => removeHub(sheetHub)} />
            </>
          ) : null
        }>
        {sheetHub ? <HubSheetBody hub={sheetHub} /> : null}
        {hubError ? <Text style={[styles.msg, { color: theme.info }]}>{hubError}</Text> : null}
      </Sheet>

      <Sheet
        open={sheet.kind === 'sensor' && !!sheetSensor}
        onClose={closeSheet}
        title={sheetSensor?.label ?? 'Sensor'}
        subtitle={sheetSensor?.id}
        footer={
          sheetSensor ? (
            <PillButton
              label="Remove"
              tone="danger"
              grow
              busy={removingSensor === sheetSensor.id}
              onPress={() => removeSensorNode(sheetSensor)}
            />
          ) : null
        }>
        {sheetSensor ? (
          <SensorSheetBody
            cap={sheetSensor}
            reading={readings[sheetSensor.id] ?? null}
            active={cadences[sheetSensor.id]}
            onChange={(ms) => changeCadence(sheetSensor.id, ms)}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={sheet.kind === 'camera' && !!sheetCamera}
        onClose={closeSheet}
        title={sheetCamera?.label || 'Camera'}
        subtitle="Sampled, not streamed."
        footer={
          sheetCamera ? (
            <PillButton
              label="Remove"
              tone="danger"
              grow
              busy={removingSensor === sheetCamera.id}
              onPress={() => removeSensorNode(sheetCamera)}
            />
          ) : null
        }>
        {sheetCamera ? (
          <CloudCameraSheetBody
            cadenceMs={cadences[sheetCamera.id]}
            onChangeCadence={(ms) => changeCadence(sheetCamera.id, ms)}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={sheet.kind === 'hubCamera'}
        onClose={closeSheet}
        title="Doorway camera"
        subtitle="Sampled, not streamed.">
        <HubCameraSheetBody cam={hubCam} />
      </Sheet>

      <Sheet
        open={sheet.kind === 'watch' && !!sheetWatch}
        onClose={closeSheet}
        title={sheetWatch?.title ?? 'Watch'}
        footer={
          sheetWatch ? (
            <>
              {/* Only a cloud watch has knobs worth turning — a local one is free. */}
              {sheetWatch.compiledSpec?.kind === 'cloud' ? (
                <PillButton
                  label="Tune"
                  onPress={() => {
                    setTuneError(null);
                    setSheet({ kind: 'tune', id: sheetWatch.id });
                  }}
                />
              ) : null}
              <PillButton
                label="Edit"
                grow
                onPress={() => {
                  setWatchError(null);
                  setEditText(sheetWatch.text);
                  setSheet({ kind: 'editWatch', id: sheetWatch.id });
                }}
              />
              <PillButton
                label="Delete"
                tone="danger"
                busy={deletingId === sheetWatch.id}
                onPress={() => removeWatch(sheetWatch)}
              />
            </>
          ) : null
        }>
        {sheetWatch ? (
          <WatchSheetBody
            watch={sheetWatch}
            home={home}
            memory={memory}
            onToggleMemory={(id) => toggleWatchMemory(sheetWatch, id)}
            onAddMemory={() => {
              closeSheet();
              router.push('/memory');
            }}
          />
        ) : null}
        {watchError ? <Text style={[styles.msg, { color: theme.info }]}>{watchError}</Text> : null}
      </Sheet>

      <Sheet
        open={sheet.kind === 'editWatch' && !!sheetWatch}
        onClose={() => (sheetWatch ? setSheet({ kind: 'watch', id: sheetWatch.id }) : closeSheet())}
        title="Edit watch"
        footer={
          sheetWatch ? (
            <>
              <PillButton
                label="Cancel"
                disabled={savingEdit}
                onPress={() => setSheet({ kind: 'watch', id: sheetWatch.id })}
              />
              <PillButton
                label="Re-compile →"
                tone="primary"
                grow
                busy={savingEdit}
                disabled={!editText.trim()}
                onPress={() => saveEdit(sheetWatch.id)}
              />
            </>
          ) : null
        }>
        <WatchEditBody value={editText} onChange={setEditText} disabled={savingEdit} />
        {watchError ? <Text style={[styles.msg, { color: theme.info }]}>{watchError}</Text> : null}
      </Sheet>

      {/* Tune to a budget — opened right after authoring a cloud watch, and again from any of
          them. Keyed on the watch id so opening a different one remounts with fresh draft state. */}
      <TuneWatch
        key={sheetTune?.id ?? 'none'}
        watch={sheetTune}
        home={home}
        visible={sheet.kind === 'tune' && !!sheetTune}
        saving={savingTune}
        error={tuneError}
        onSave={(patch) => (sheetTune ? saveTune(sheetTune.id, patch) : undefined)}
        onClose={closeSheet}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  main: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1, width: '100%' },
  glow: { position: 'absolute', top: -240, alignSelf: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontFamily: Fonts?.mono, fontSize: 14, fontWeight: '700' },

  body: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: Spacing.four, paddingTop: Spacing.four },
  h1: { fontFamily: Fonts?.sans, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  sub: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '600' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { gap: Spacing.two },
  seeAll: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },

  emptyCta: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyCtaText: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  empty: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  msg: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 18 },

  wishInput: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts?.sans,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 96,
    textAlignVertical: 'top',
  },

  suggestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  suggestIcon: { fontSize: 16, width: 24, textAlign: 'center' },
  suggestTitle: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  suggestWhy: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19 },

  errCard: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three },
  noticeCard: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three },
  errTitle: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  errBody: { fontFamily: Fonts?.mono, fontSize: 12.5, marginTop: 4 },
  errHint: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19, marginTop: 6 },
});
