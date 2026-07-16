import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isStale, type HomeCapability, type Reading } from '@/lib/home';
import type { LiveStatus } from '@/lib/live';

export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Render a reading — or '—' when there isn't one, or when it's too old to still be true.
 *
 * `cadenceMs` is REQUIRED, and that's the point. Nothing upstream expires a reading (`read_input`
 * agg 'latest' has no window), so a dead sensor serves its last value forever, pixel-identical to
 * a live one. Age is the only thing that separates them, so the formatter refuses to render a
 * value without being told the rate it should have arrived at — a new tile physically cannot
 * display a stale number by forgetting to check, because there is no overload that lets it.
 */
export function formatValue(r: Reading | null, cap: HomeCapability, cadenceMs: number): string {
  if (!r || isStale(r.ts, cadenceMs)) return '—';
  const v = r.value;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return `${v}${cap.unit ?? ''}`;
  return String(v);
}

// Slider snap points for a sensor's sample rate (ms). Bounds mirror the backend clamp
// (500ms–60s); log-ish spacing so the fast end isn't cramped.
export const CADENCE_STOPS = [500, 1000, 2000, 5000, 10000, 30000, 60000];
// Quality snap points (JPEG %), low→high — the detail/token tradeoff the hub maps to ffmpeg -q:v.
export const QUALITY_STOPS = [30, 50, 70, 85, 95];
// A sensor with no explicit cadence runs at the firmware default — assume it for the TTL bar.
export const DEFAULT_CADENCE_MS = 5000;
export const fmtRate = (ms: number): string => `${ms / 1000}s`;

// How each realtime WebSocket state reads in the chrome. `tone` drives colour + animation:
// live = connected & streaming, pending = negotiating/reconnecting, down = no live socket.
const LIVE_META: Record<LiveStatus, { label: string; tone: 'live' | 'pending' | 'down' }> = {
  live: { label: 'live', tone: 'live' },
  connecting: { label: 'connecting…', tone: 'pending' },
  offline: { label: 'hub offline', tone: 'down' },
  unconfigured: { label: 'realtime off', tone: 'down' },
  off: { label: 'disconnected', tone: 'down' },
};

/**
 * Pointer hover, as state. react-native-web passes `hovered` to Pressable's style callback but
 * react-native doesn't type it, so we drive it from the hover events instead — same approach as
 * EmberButton, and it simply never fires on touch.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) },
  };
}

/** Section header — one type size for every band of content on every tab. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{children}</Text>
      {right ?? null}
    </View>
  );
}

export function Tag({ on, text }: { on?: boolean; text: string }) {
  const theme = useTheme();
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

/** A single number that means something. Tapping one jumps to the tab that explains it. */
export function Stat({
  value,
  label,
  onPress,
}: {
  value: number | string;
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.stat,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: pressed ? theme.emberDeep : theme.border,
        },
      ]}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Realtime connection status, driven entirely by the WebSocket lifecycle (via useHubLive):
 * a green pulsing dot while the socket is open and streaming, an amber blink while it's
 * negotiating/reconnecting, and a steady muted dot when there's no live socket.
 */
export function LiveIndicator({ status }: { status: LiveStatus }) {
  const theme = useTheme();
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

/**
 * Generic stepped slider (snap points) — the sample-rate and quality knobs. Built on React
 * Native's built-in responder props (what PanResponder wraps): no refs, no worklets, so it
 * behaves identically on web and native. Commits the chosen stop on release.
 */
export function StepSlider({
  label,
  stops,
  value,
  format,
  onCommit,
}: {
  label?: string;
  stops: number[];
  value: number;
  format: (n: number) => string;
  onCommit: (v: number) => void;
}) {
  const theme = useTheme();
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
    <View style={styles.slider}>
      {label ? (
        <View style={styles.sliderLabelRow}>
          <Text style={[styles.sliderLabel, { color: theme.textSecondary }]}>{label}</Text>
          <Text style={[styles.sliderVal, { color: theme.ember }]}>{format(stops[idx])}</Text>
        </View>
      ) : null}
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
        <View
          style={[
            styles.sliderThumb,
            { backgroundColor: theme.ember, borderColor: theme.card, left: `${frac * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

/** Pill button — the one button shape, in the three tones the app actually needs. */
export function PillButton({
  label,
  onPress,
  tone = 'quiet',
  disabled,
  busy,
  grow,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  grow?: boolean;
}) {
  const theme = useTheme();
  const solid = tone === 'primary';
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        styles.pillBtn,
        grow ? { flex: 1 } : null,
        solid
          ? { backgroundColor: off ? theme.backgroundSelected : theme.ember }
          : { borderWidth: 1, borderColor: theme.border },
      ]}>
      <Text
        style={[
          styles.pillBtnText,
          {
            color: solid
              ? off
                ? theme.textMuted
                : theme.onEmber
              : tone === 'danger'
                ? theme.warn
                : theme.textSecondary,
          },
        ]}>
        {busy ? '…' : label}
      </Text>
    </Pressable>
  );
}

/**
 * A destructive PillButton that asks once. First press arms it — the label flips to
 * `confirmLabel` for a few seconds — and only a second press fires. Unpair/delete/remove
 * used to be one tap from done, which is fine for a demo and wrong for a product: the
 * confirm lives in the button itself, so no extra dialog joins the z-axis.
 */
export function ConfirmPillButton({
  label,
  confirmLabel = 'Tap again to confirm',
  onConfirm,
  disabled,
  busy,
  grow,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  grow?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Disarm on unmount so a stale timer never touches state after the sheet closes.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const press = () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };
  return (
    <PillButton
      label={armed ? confirmLabel : label}
      tone="danger"
      disabled={disabled}
      busy={busy}
      grow={grow}
      onPress={press}
    />
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 22 },
  sectionTitle: { flex: 1, fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  tag: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.pill, borderWidth: 1 },
  tagText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },

  stat: {
    minWidth: 88,
    flexGrow: 1,
    flexBasis: 88,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  statValue: { fontFamily: Fonts?.sans, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  slider: { flexGrow: 1, flexBasis: 200, gap: 5 },
  sliderLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  sliderLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sliderTrackWrap: { height: 30, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2 },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2, left: 0 },
  sliderThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2, marginLeft: -9 },
  sliderVal: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', minWidth: 34, textAlign: 'right' },

  pillBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
    minHeight: 44,
  },
  pillBtnText: { fontFamily: Fonts?.sans, fontSize: 14.5, fontWeight: '700' },
});
