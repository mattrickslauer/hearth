import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getSnapshot, type HomeCapability, type Snapshot } from '@/lib/home';

import {
  CADENCE_STOPS,
  DEFAULT_CADENCE_MS,
  QUALITY_STOPS,
  StepSlider,
  Tag,
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
  onPress,
  onFrameLoad,
  onFrameError,
}: {
  title: string;
  tags: ReactNode;
  uri: string | null;
  stamp: string | null;
  waiting: string;
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
  onPress,
}: {
  cap: HomeCapability;
  token: string | null;
  /** The account's desired snap cadence for this camera (undefined → hub firmware default). */
  cadenceMs?: number;
  onPress: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [frameOk, setFrameOk] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const effectiveMs = cadenceMs ?? DEFAULT_CADENCE_MS;

  const refresh = useCallback(() => {
    getSnapshot(cap.id, token)
      .then(setSnap)
      .catch(() => setSnap(null));
  }, [cap.id, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // Re-pull on the snap cadence — a photo every few seconds, faithful to "sampled, not streamed".
  useEffect(() => {
    const id = setInterval(refresh, Math.max(1000, effectiveMs));
    return () => clearInterval(id);
  }, [refresh, effectiveMs]);

  const uri = snap?.ossUrl ?? null;
  const waiting =
    snap?.provisioned === false
      ? 'Cloud image store (OSS) isn’t configured on the backend yet.'
      : 'Waiting for a frame — the hub pushes one every few seconds once its camera is running.';

  return (
    <CameraShell
      title={cap.label || 'Camera'}
      tags={
        <>
          <Tag on text="vision" />
          <Tag on={!!uri} text={uri ? 'live' : 'no frame'} />
        </>
      }
      uri={uri}
      stamp={
        frameOk && uri
          ? `snapped ${loadedAt ? new Date(loadedAt).toLocaleTimeString() : ''} · every ${fmtRate(effectiveMs)}`
          : null
      }
      waiting={waiting}
      onPress={onPress}
      onFrameLoad={() => {
        setFrameOk(true);
        setLoadedAt(Date.now());
      }}
      onFrameError={() => setFrameOk(false)}
    />
  );
}

export function CloudCameraSheetBody({
  cadenceMs,
  onChangeCadence,
}: {
  cadenceMs?: number;
  onChangeCadence: (ms: number) => void;
}) {
  const theme = useTheme();
  const effectiveMs = cadenceMs ?? DEFAULT_CADENCE_MS;
  return (
    <>
      <StepSlider
        label="Snap rate"
        stops={CADENCE_STOPS}
        value={effectiveMs}
        format={fmtRate}
        onCommit={onChangeCadence}
      />
      <Text style={[styles.note, { color: theme.textMuted }]}>
        The hub samples a frame every {fmtRate(effectiveMs)} and pushes it to the cloud; Qwen-VL reads
        it only when a vision watch needs it — no video stream leaves the home.
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
  hasFrame: boolean;
  frameAt: number | null;
}

export interface HubCamera {
  cfg: CamConfig | null;
  reachable: boolean | null;
  cadenceMs: number;
  quality: number;
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

  // Re-pull the frame on the snap cadence — a photo every N seconds, not a stream.
  useEffect(() => {
    if (!hubUrl) return;
    const id = setInterval(() => setTick((t) => t + 1), Math.max(1000, cadenceMs));
    return () => clearInterval(id);
  }, [hubUrl, cadenceMs]);

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

  return { cfg, reachable, cadenceMs, quality, uri: `${hubUrl}/frame?t=${tick}`, post, hubUrl };
}

export function HubCameraCard({ cam, onPress }: { cam: HubCamera; onPress: () => void }) {
  const [frameOk, setFrameOk] = useState(false);
  const [snappedAt, setSnappedAt] = useState<number | null>(null);
  const sourceTag =
    cam.reachable === false ? 'hub offline' : cam.cfg?.source === 'test' ? 'test source' : 'OBS';

  return (
    <CameraShell
      title="Doorway camera"
      tags={
        <>
          <Tag on text="vision" />
          <Tag on={cam.reachable === true} text={sourceTag} />
        </>
      }
      uri={cam.reachable !== false ? cam.uri : null}
      stamp={
        frameOk && cam.reachable
          ? `snapped ${snappedAt ? new Date(snappedAt).toLocaleTimeString() : ''} · every ${fmtRate(cam.cadenceMs)}`
          : null
      }
      waiting={
        cam.reachable === false
          ? `Can’t reach the hub at ${cam.hubUrl}. Is it running with HEARTH_CAM=1?`
          : 'Waiting for a frame — start OBS streaming to the hub, or run with HEARTH_CAM_SOURCE=test.'
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
        Frames are pulled on demand from the hub and read by Qwen-VL only when a vision watch needs
        them — no video stream leaves the home.
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
  tuneText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  note: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
});
