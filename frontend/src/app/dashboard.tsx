import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { BillingPanel } from '@/components/dashboard/billing';
import { RunLog } from '@/components/dashboard/run-log';
import { SettingsPanel } from '@/components/dashboard/settings';
import {
  CloudCameraCard,
  CloudCameraSheetBody,
  HubCameraCard,
  HubCameraSheetBody,
  useHubCamera,
} from '@/components/dashboard/camera';
import { ConnectHubBody, HubRow, HubSheetBody } from '@/components/dashboard/hubs';
import { SensorSheetBody, SensorTile } from '@/components/dashboard/sensors';
import { ConfirmPillButton, LiveIndicator, PillButton, SectionLabel, Stat } from '@/components/dashboard/shared';
import { WatchCard, WatchEditBody, WatchSheetBody } from '@/components/dashboard/watches';
import { GlowOrb, Wordmark, useResponsive } from '@/components/landing/ui';
import { TuneWatch } from '@/components/tune-watch';
import { ActionFab } from '@/components/ui/action-fab';
import { Rail, TabBar, type NavTab } from '@/components/ui/nav';
import { Sheet } from '@/components/ui/sheet';
import { Fonts, Layer, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/context';
import { useHubClaim } from '@/hooks/use-hub-claim';
import { useTheme } from '@/hooks/use-theme';
import { useWatchAuthoring } from '@/hooks/use-watch-authoring';
import { isTabKey, type SheetState, type TabKey } from '@/lib/dashboard-types';
import {
  describeHome,
  listCadences,
  listDesired,
  listEvents,
  listMemory,
  listWatches,
  newerReading,
  readInput,
  removeSensor,
  setCadence,
  setDesired,
  type Cadences,
  type DesiredStates,
  type HomeCapability,
  type HomeModel,
  type MemoryObject,
  type Reading,
  type RunEvent,
  type Watch,
} from '@/lib/home';
import { listHubs, type HubView } from '@/lib/hubs';
import { useHubLive } from '@/lib/live';
import { webFullHeight, webNoOutline } from '@/lib/web-style';

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
  const { status, account, token, signOut } = useAuth();

  // The tab IS the URL (?tab=billing) — no shadow state to fall out of sync. Pages are
  // deep-linkable and shareable, the AuthMenu can land anywhere on the dashboard from any
  // screen, and setParams replaces in place so tab clicks don't pile up history entries.
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: TabKey = isTabKey(params.tab) ? params.tab : 'home';
  const setTab = useCallback((k: TabKey) => router.setParams({ tab: k }), [router]);

  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const closeSheet = useCallback(() => setSheet({ kind: 'none' }), []);

  const [home, setHome] = useState<HomeModel | null>(null);
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading | null>>({});
  const [cadences, setCadences] = useState<Cadences>({});
  // The desired half of the device shadow — carries the camera's `power` switch (and any other
  // actuator the dashboard learns to drive). No entry for an input = never commanded = device default.
  const [desired, setDesiredMap] = useState<DesiredStates>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Removing a hub-reported device: the input id in flight, and what to say about it afterwards.
  const [removingSensor, setRemovingSensor] = useState<string | null>(null);
  const [sensorNotice, setSensorNotice] = useState<string | null>(null);

  const [memory, setMemory] = useState<MemoryObject[]>([]);

  const [hubs, setHubs] = useState<HubView[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, w, e, hb, cd, ds, mem] = await Promise.all([
        describeHome(token),
        listWatches(token),
        listEvents(20, token),
        listHubs(token).catch(() => [] as HubView[]),
        listCadences(token).catch(() => ({}) as Cadences),
        listDesired(token).catch(() => ({}) as DesiredStates),
        listMemory(token).catch(() => [] as MemoryObject[]),
      ]);
      setHome(h);
      setWatches(w);
      setEvents(e);
      setHubs(hb);
      setCadences(cd);
      setDesiredMap(ds);
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

  // Deferred a tick so the effect never sets state synchronously (load's first act is
  // setLoading) — same shape as the run log's fetch, minus the debounce it needs.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
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

  // Dedupe by id: a hub that reports the same capability twice (e.g. `hub-cam.cam.frame`
  // arriving both as a device capability and as the attached camera) would otherwise render
  // two cards with the same React key and duplicate/omit children on update.
  const allSensors = useMemo(() => {
    const seen = new Set<string>();
    return (home?.capabilities ?? []).filter(
      (c) => c.kind === 'sensor' && !seen.has(c.id) && !!seen.add(c.id),
    );
  }, [home]);
  // Camera (vision) sensors render as their own frame card, not a generic value tile.
  const visionSensors = useMemo(() => allSensors.filter((c) => c.vision), [allSensors]);
  const sensors = useMemo(() => allSensors.filter((c) => !c.vision), [allSensors]);
  // The LAN fallback only exists when the cloud path has no camera to show.
  const showHubCam = !visionSensors.length && !!HUB_URL;
  const hubCam = useHubCamera(showHubCam ? HUB_URL : '');

  // Watch authoring / edit / tune / memory-binding — state and handlers extracted to a hook. The
  // watch LIST stays here (many things read it); the hook mutates it through the setters we pass.
  const {
    wish,
    setWish,
    authoring,
    submitWish,
    suggestions,
    closeSuggest,
    pendingTuneId,
    setPendingTuneId,
    editText,
    setEditText,
    savingEdit,
    saveEdit,
    deletingId,
    removeWatch,
    watchError,
    setWatchError,
    savingTune,
    tuneError,
    setTuneError,
    saveTune,
    toggleWatchMemory,
  } = useWatchAuthoring({
    token,
    reload: load,
    setSheet,
    closeSheet,
    setTab,
    setWatches,
    setEvents,
    setError,
  });

  // Hub claim + unpair — likewise extracted; the hub list stays here.
  const { claimCode, setClaimCode, claiming, hubError, hubNotice, submitClaim, removeHub } = useHubClaim({
    token,
    reload: load,
    setHubs,
    closeSheet,
  });

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

  /**
   * The camera's capture switch, resolved from the home model: the `power` actuator on the
   * node that owns this vision sensor. Older hub firmware doesn't describe one — then this is
   * null and the camera renders without a toggle, rather than with a switch that does nothing.
   */
  const cameraPowerInput = useCallback(
    (cap: HomeCapability): string | null => {
      const node = home?.nodes.find((n) => n.capabilities.some((c) => c.id === cap.id));
      return node?.capabilities.find((c) => c.kind === 'actuator' && c.id === `${node.id}.power`)?.id ?? null;
    },
    [home],
  );

  // Command an actuator on/off (the camera's stop/start). Optimistic, same shape as
  // changeCadence: flip the shadow locally, POST it, roll back if the write is refused.
  const changeDesired = async (input: string, on: boolean) => {
    const prev = desired[input];
    setDesiredMap((d) => ({ ...d, [input]: on }));
    try {
      await setDesired(input, on, token);
    } catch {
      setDesiredMap((d) => {
        const next = { ...d };
        if (prev == null) delete next[input];
        else next[input] = prev;
        return next;
      });
    }
  };

  // The phone bar carries the four live destinations; the rail has room for the whole
  // platform, grouped the way a person thinks: the home first, the account around it.
  // Memoized so the arrays (and their identities) only change when a badge count does, rather
  // than being rebuilt on every render. Kept above the early returns to satisfy rules-of-hooks.
  const sensorCount = sensors.length;
  const watchCount = watches?.length ?? null;
  const tabs = useMemo<NavTab[]>(
    () => [
      { key: 'home', icon: '🏠', label: 'Home', section: 'Platform' },
      { key: 'sensors', icon: '📡', label: 'Sensors', badge: sensorCount || null, section: 'Platform' },
      { key: 'watches', icon: '👁', label: 'Watches', badge: watchCount, section: 'Platform' },
      { key: 'activity', icon: '📜', label: 'Activity', section: 'Platform' },
    ],
    [sensorCount, watchCount],
  );
  const railTabs = useMemo<NavTab[]>(
    () => [
      ...tabs,
      { key: 'billing', icon: '💳', label: 'Usage & billing', section: 'Account' },
      { key: 'settings', icon: '⚙️', label: 'Settings', section: 'Account' },
    ],
    [tabs],
  );

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
        {isWide ? <Rail tabs={railTabs} value={tab} onChange={(k) => setTab(k as TabKey)} /> : null}

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
                </View>

                {visionSensors.length ? (
                  <View style={styles.section}>
                    <SectionLabel>Camera</SectionLabel>
                    {visionSensors.map((c) => {
                      const power = cameraPowerInput(c);
                      return (
                        <CloudCameraCard
                          key={c.id}
                          cap={c}
                          token={token}
                          cadenceMs={cadences[c.id]}
                          powerOn={power ? (desired[power] ?? true) : true}
                          onTogglePower={power ? (on) => changeDesired(power, on) : undefined}
                          onPress={() => setSheet({ kind: 'camera', id: c.id })}
                        />
                      );
                    })}
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

            {/* The Activity tab is the run log: searchable, and priced with what we were
                actually billed rather than what the quote predicted. The Home tab keeps the
                unfiltered glance (ActivityList above) — this is the place you come to ask
                questions of it. */}
            {tab === 'activity' ? (
              <View style={styles.section}>
                <SectionLabel>Runs &amp; spend</SectionLabel>
                <RunLog token={token} />
              </View>
            ) : null}

            {/* Usage & billing: the meter, the forecast, the plans, the rate card. */}
            {tab === 'billing' ? (
              <>
                <View style={{ gap: Spacing.two }}>
                  <Text style={[styles.h1, { color: theme.text }]}>Usage &amp; billing</Text>
                  <Text style={[styles.sub, { color: theme.textMuted }]}>
                    measured from what your watches actually ran
                  </Text>
                </View>
                <BillingPanel
                  token={token}
                  watches={watches}
                  home={home}
                  onOpenWatch={(id) => setSheet({ kind: 'watch', id })}
                />
              </>
            ) : null}

            {/* Settings: profile, channels, session, the danger zone. */}
            {tab === 'settings' ? (
              <>
                <View style={{ gap: Spacing.two }}>
                  <Text style={[styles.h1, { color: theme.text }]}>Settings</Text>
                  <Text style={[styles.sub, { color: theme.textMuted }]} numberOfLines={1}>
                    {account?.email ?? 'account'}
                  </Text>
                </View>
                <SettingsPanel
                  account={account}
                  token={token}
                  hubs={hubs}
                  onSignOut={signOut}
                  onHubsRemoved={() => void load()}
                />
              </>
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
              <ConfirmPillButton
                label="Unpair"
                confirmLabel="Really unpair?"
                onConfirm={() => removeHub(sheetHub)}
              />
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
            <ConfirmPillButton
              label="Remove"
              confirmLabel="Remove the whole node?"
              grow
              busy={removingSensor === sheetSensor.id}
              onConfirm={() => removeSensorNode(sheetSensor)}
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
            <ConfirmPillButton
              label="Remove"
              confirmLabel="Remove this camera?"
              grow
              busy={removingSensor === sheetCamera.id}
              onConfirm={() => removeSensorNode(sheetCamera)}
            />
          ) : null
        }>
        {sheetCamera ? (
          (() => {
            const power = cameraPowerInput(sheetCamera);
            return (
              <CloudCameraSheetBody
                cadenceMs={cadences[sheetCamera.id]}
                powerOn={power ? (desired[power] ?? true) : true}
                onTogglePower={power ? (on) => changeDesired(power, on) : undefined}
                onChangeCadence={(ms) => changeCadence(sheetCamera.id, ms)}
              />
            );
          })()
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
              <ConfirmPillButton
                label="Delete"
                confirmLabel="Really delete?"
                busy={deletingId === sheetWatch.id}
                onConfirm={() => removeWatch(sheetWatch)}
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
