import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getSnapshot, isStale, type HomeCapability, type Snapshot } from '@/lib/home';

import {
  CADENCE_STOPS,
  DEFAULT_CADENCE_MS,
  PillButton,
  QUALITY_STOPS,
  StepSlider,
  Tag,
  ago,
  fmtRate,
  useHover,
} from './shared';

/* ----------------------------------------------------------------- frame */

/**
 * The frame box, shared by both camera paths: the picture, a stamp, or an explanation of why
 * there's no picture. Wrapped in a press target — the knobs live one layer up, in a sheet, so
 * the card itself is just the view.
 */
function CameraShell({
  title,
  tags,
  uri,
  stamp,
  waiting,
  power,
  onPress,
  onFrameLoad,
  onFrameError,
}: {
  title: string;
  tags: ReactNode;
  uri: string | null;
  stamp: string | null;
  waiting: string;
  /** The capture switch, when this camera has one — a Stop/Start pill on the glass, so
   *  stopping the camera is one tap on the card rather than a trip into the sheet. */
  power?: { on: boolean; toggle: () => void } | null;
  onPress: () => void;
  onFrameLoad: () => void;
  onFrameError: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Tap to tune.`}
      {...hoverProps}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: pressed || hovered ? theme.emberDeep : theme.border,
        },
      ]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.tags}>{tags}</View>
      </View>

      <View style={[styles.box, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.img}
            resizeMode="cover"
            onLoad={onFrameLoad}
            onError={onFrameError}
          />
        ) : null}
        {stamp ? (
          <View style={styles.stamp}>
            <View style={[styles.stampDot, { backgroundColor: theme.ember }]} />
            <Text style={styles.stampText}>{stamp}</Text>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={[styles.placeholderText, { color: theme.textMuted }]}>{waiting}</Text>
          </View>
        )}
        {/* The affordance, on the glass — says "there's more behind this" without a control bar. */}
        <View style={styles.tune}>
          <Text style={styles.tuneText}>⚙ Tune</Text>
        </View>
        {power ? (
          <Pressable
            onPress={power.toggle}
            accessibilityRole="button"
            accessibilityLabel={power.on ? 'Stop capture' : 'Start capture'}
            style={styles.power}>
            <Text style={styles.tuneText}>{power.on ? '⏹ Stop' : '▶ Start'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ----------------------------------------------------- cloud (OSS) camera */

/**
 * Cloud-brokered camera: the hub pushed its latest frame up to OSS, and get_snapshot hands us a
 * short-lived presigned URL for it. No hub address to configure — this works wherever the
 * dashboard runs, for any number of hubs, just like every other sensor. We re-pull on a cadence
 * (each call mints a fresh URL, so the browser never serves a stale cached frame).
 */
export function CloudCameraCard({
  cap,
  token,
  cadenceMs,
  powerOn,
  onTogglePower,
  onPress,
}: {
  cap: HomeCapability;
  token: string | null;
  /** The account's desired snap cadence for this camera (undefined → hub firmware default). */
  cadenceMs?: number;
  /** Desired capture state from the device shadow (undefined → never commanded → on). */
  powerOn?: boolean;
  /** Present only when the camera self-describes a `power` actuator — older hub firmware
   *  doesn't, and a switch that silently does nothing is worse than no switch. */
  onTogglePower?: (on: boolean) => void;
  onPress: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [frameOk, setFrameOk] = useState(false);
  // Re-render on a timer so a frame that stops arriving ages into "no data" on its own, instead of
  // sitting there looking current until something else happens to re-render the card.
  const [, setTick] = useState(0);

  const effectiveMs = cadenceMs ?? DEFAULT_CADENCE_MS;
  const on = powerOn !== false;

  const refresh = useCallback(() => {
    getSnapshot(cap.id, token)
      .then((s) => {
        setSnap(s);
        // Once the backend stops handing back a frame, drop the "we drew one" verdict with it —
        // otherwise the card keeps its last onLoad forever and still calls itself live. A frame
        // that's still there keeps the verdict, so re-pulls don't flicker; onFrameError clears it.
        setFrameOk((ok) => ok && !!s?.ossUrl);
      })
      .catch(() => setSnap(null));
  }, [cap.id, token]);

  useEffect(() => {
    if (on) refresh();
  }, [on, refresh]);
  // Re-pull on the snap cadence — a photo every few seconds, faithful to "sampled, not streamed".
  // A stopped camera pushes nothing, so polling it would just re-fetch the frame it went dark on;
  // flipping back on restarts the pulls (and the `on` dep fires an immediate refresh above).
  useEffect(() => {
    if (!on) return;
    const id = setInterval(refresh, Math.max(1000, effectiveMs));
    return () => clearInterval(id);
  }, [on, refresh, effectiveMs]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // A frame is only worth showing if the camera is still producing them. `capturedAt` is the
  // frame's real age from OSS — the stored key is a fixed `latest.jpg`, so a camera unplugged last
  // week still hands back a valid URL and a perfectly good JPEG. Showing that as the live view is
  // exactly the lie this card used to tell, so an aged-out frame is dropped for the placeholder.
  const stale = isStale(snap?.capturedAt, effectiveMs);
  // Stopped is a state we chose, not a failure — show it as such, never the last frame (which
  // would quietly re-tell the stale-frame-as-live lie the moment someone hits Stop).
  const uri = on && snap?.ossUrl && !stale ? snap.ossUrl : null;
  const waiting = !on
    ? 'Camera is stopped — no frames are being taken (and nothing is being spent). Press Start to resume.'
    : snap?.provisioned === false
      ? 'Cloud image store (OSS) isn’t configured on the backend yet.'
      : snap?.ossUrl && snap?.capturedAt == null
        ? // A frame IS stored but the backend didn’t say when it was captured — that response
          // shape predates the staleness gating this app ships with. Silent version skew
          // (frontend auto-deploys on merge, backend deploys by hand) blanked this card for a
          // day, twice; name the failure so the fix is obvious instead of archaeological.
          'A frame is stored, but the cloud backend is running an older build than this app (no capture time on frames). Redeploy the backend.'
        : snap?.capturedAt && stale
          ? `No data — the last frame arrived ${ago(snap.capturedAt)} and nothing has replaced it. Check the hub's camera is running.`
          : 'Waiting for a frame — the hub pushes one every few seconds once its camera is running.';

  return (
    <CameraShell
      title={cap.label || 'Camera'}
      tags={
        <>
          <Tag on text="vision" />
          {/* Driven by a frame we have actually drawn, not by holding a URL: the backend presigns
              happily for a key that holds nothing, which is how "live" once sat over a 404. */}
          <Tag on={frameOk && !!uri} text={!on ? 'stopped' : frameOk && uri ? 'live' : 'no frame'} />
        </>
      }
      uri={uri}
      stamp={
        // The capture time from OSS. This used to be Date.now() at onLoad — the moment the
        // browser finished the download — so any frame, at any age, read as just-snapped.
        frameOk && uri && snap?.capturedAt
          ? `snapped ${new Date(snap.capturedAt).toLocaleTimeString()} · every ${fmtRate(effectiveMs)}`
          : null
      }
      waiting={waiting}
      power={onTogglePower ? { on, toggle: () => onTogglePower(!on) } : null}
      onPress={onPress}
      onFrameLoad={() => setFrameOk(true)}
      onFrameError={() => setFrameOk(false)}
    />
  );
}

export function CloudCameraSheetBody({
  cadenceMs,
  powerOn,
  onTogglePower,
  onChangeCadence,
}: {
  cadenceMs?: number;
  powerOn?: boolean;
  onTogglePower?: (on: boolean) => void;
  onChangeCadence: (ms: number) => void;
}) {
  const theme = useTheme();
  const effectiveMs = cadenceMs ?? DEFAULT_CADENCE_MS;
  const on = powerOn !== false;
  return (
    <>
      {onTogglePower ? (
        <PillButton
          label={on ? '⏹ Stop capture' : '▶ Start capture'}
          tone={on ? 'danger' : 'primary'}
          grow
          onPress={() => onTogglePower(!on)}
        />
      ) : null}
      <StepSlider
        label="Snap rate"
        stops={CADENCE_STOPS}
        value={effectiveMs}
        format={fmtRate}
        onCommit={onChangeCadence}
      />
      <Text style={[styles.note, { color: theme.textMuted }]}>
        {on
          ? `The hub samples a frame every ${fmtRate(effectiveMs)} and pushes it to the cloud; Qwen-VL reads
        it only when a vision watch needs it — no video stream leaves the home.`
          : 'Capture is stopped: the hub takes no frames, pushes nothing, and vision watches on this camera spend nothing until you start it again.'}
      </Text>
    </>
  );
}

/* ------------------------------------------------------- LAN (direct) camera */

export interface CamConfig {
  id: string;
  source: string;
  width: number;
  quality: number;
  cadenceMs: number;
  /** Capture switch state. Optional: a hub on older firmware doesn't report it (always on). */
  enabled?: boolean;
  hasFrame: boolean;
  frameAt: number | null;
}

export interface HubCamera {
  cfg: CamConfig | null;
  reachable: boolean | null;
  cadenceMs: number;
  quality: number;
  /** False only when the hub says capture is stopped; unknown/older firmware reads as on. */
  enabled: boolean;
  uri: string;
  post: (patch: Record<string, number>) => void;
  hubUrl: string;
}

/**
 * The direct-to-hub camera (local dev / LAN). Its config lives on the hub, so it's a hook rather
 * than component state: the card and the sheet are rendered on different layers and both need it.
 */
export function useHubCamera(hubUrl: string): HubCamera {
  const [cfg, setCfg] = useState<CamConfig | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);

  const cadenceMs = cfg?.cadenceMs ?? DEFAULT_CADENCE_MS;
  const quality = cfg?.quality ?? 70;
  const enabled = cfg?.enabled !== false;

  // No LAN hub configured: stay inert. Hooks can't be called conditionally, so the caller
  // always calls this one and passes '' when there's nothing to talk to.
  useEffect(() => {
    if (!hubUrl) return;
    fetch(`${hubUrl}/camera`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: CamConfig) => {
        setCfg(c);
        setReachable(true);
      })
      .catch(() => setReachable(false));
  }, [hubUrl]);

  // Re-pull the frame on the snap cadence — a photo every N seconds, not a stream. A stopped
  // camera writes no new frames, so re-pulling would only re-download the one it stopped on.
  useEffect(() => {
    if (!hubUrl || !enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), Math.max(1000, cadenceMs));
    return () => clearInterval(id);
  }, [hubUrl, cadenceMs, enabled]);

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

  return { cfg, reachable, cadenceMs, quality, enabled, uri: `${hubUrl}/frame?t=${tick}`, post, hubUrl };
}

export function HubCameraCard({ cam, onPress }: { cam: HubCamera; onPress: () => void }) {
  const [frameOk, setFrameOk] = useState(false);
  const [snappedAt, setSnappedAt] = useState<number | null>(null);
  const sourceTag =
    cam.reachable === false
      ? 'hub offline'
      : !cam.enabled
        ? 'stopped'
        : cam.cfg?.source === 'test'
          ? 'test source'
          : 'OBS';

  return (
    <CameraShell
      title="Doorway camera"
      tags={
        <>
          <Tag on text="vision" />
          <Tag on={cam.reachable === true && cam.enabled} text={sourceTag} />
        </>
      }
      uri={cam.reachable !== false && cam.enabled ? cam.uri : null}
      stamp={
        frameOk && cam.reachable && cam.enabled
          ? `snapped ${snappedAt ? new Date(snappedAt).toLocaleTimeString() : ''} · every ${fmtRate(cam.cadenceMs)}`
          : null
      }
      waiting={
        cam.reachable === false
          ? `Can’t reach the hub at ${cam.hubUrl}. Is it running with HEARTH_CAM=1?`
          : !cam.enabled
            ? 'Camera is stopped — no frames are being taken. Press Start to resume.'
            : 'Waiting for a frame — start OBS streaming to the hub, or run with HEARTH_CAM_SOURCE=test.'
      }
      power={
        cam.reachable
          ? { on: cam.enabled, toggle: () => cam.post({ enabled: cam.enabled ? 0 : 1 }) }
          : null
      }
      onPress={onPress}
      onFrameLoad={() => {
        setFrameOk(true);
        setSnappedAt(Date.now());
      }}
      onFrameError={() => setFrameOk(false)}
    />
  );
}

export function HubCameraSheetBody({ cam }: { cam: HubCamera }) {
  const theme = useTheme();
  if (!cam.reachable) {
    return (
      <Text style={[styles.note, { color: theme.textMuted }]}>
        The hub at {cam.hubUrl} isn’t reachable, so there’s nothing to tune yet.
      </Text>
    );
  }
  return (
    <>
      <PillButton
        label={cam.enabled ? '⏹ Stop capture' : '▶ Start capture'}
        tone={cam.enabled ? 'danger' : 'primary'}
        grow
        onPress={() => cam.post({ enabled: cam.enabled ? 0 : 1 })}
      />
      <StepSlider
        label="Snap rate"
        stops={CADENCE_STOPS}
        value={cam.cadenceMs}
        format={fmtRate}
        onCommit={(v) => cam.post({ cadenceMs: v })}
      />
      <StepSlider
        label="Quality"
        stops={QUALITY_STOPS}
        value={cam.quality}
        format={(q) => `${q}%`}
        onCommit={(v) => cam.post({ quality: v })}
      />
      <Text style={[styles.note, { color: theme.textMuted }]}>
        {cam.enabled
          ? 'Frames are pulled on demand from the hub and read by Qwen-VL only when a vision watch needs them — no video stream leaves the home.'
          : 'Capture is stopped: ffmpeg is down on the hub and no frames are taken until you start it again.'}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.three, gap: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontFamily: Fonts?.sans, fontSize: 16, fontWeight: '700' },
  tags: { flexDirection: 'row', gap: 6 },
  box: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  placeholderText: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
  stamp: {
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
  stampDot: { width: 6, height: 6, borderRadius: 3 },
  stampText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  tune: {
    position: 'absolute',
    right: 10,
    top: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  // The capture switch, mirroring the tune pill on the opposite corner of the glass.
  power: {
    position: 'absolute',
    left: 10,
    top: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  tuneText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  note: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
});
