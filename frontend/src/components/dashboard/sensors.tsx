import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isStale, type HomeCapability, type Reading } from '@/lib/home';

import {
  CADENCE_STOPS,
  DEFAULT_CADENCE_MS,
  StepSlider,
  ago,
  fmtRate,
  formatValue,
  useHover,
} from './shared';

/**
 * A sensor at a glance: icon, value, heartbeat, and a bar that drains toward the next expected
 * reading. Nothing you can *change* — the knobs moved into the sheet this tile opens, so the
 * grid stays scannable and a stray thumb on a scroll can't retune a sensor.
 */
export function SensorTile({
  cap,
  reading,
  active,
  onPress,
}: {
  cap: HomeCapability;
  reading: Reading | null;
  active?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  // The interval this sensor is actually running at (falls back to the firmware default).
  const effectiveMs = active ?? DEFAULT_CADENCE_MS;
  const [pulse] = useState(() => new Animated.Value(0));
  const [ttl] = useState(() => new Animated.Value(0));
  const ts = reading?.ts;
  // Re-render as the reading ages so a sensor that goes quiet reaches "no data" by itself.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // A reading that stopped being refreshed is not a reading. Nothing upstream expires one — the
  // series just keeps returning the last sample — so a dead sensor used to show its final value
  // forever, pixel-identical to a live one. Past its cadence we show "no data" and say how old it
  // is: a number nobody can date is worse than no number. (formatValue applies the same rule.)
  const live = !!reading && !isStale(ts, effectiveMs);

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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${cap.label}: ${formatValue(reading, cap, effectiveMs)}. Tap to tune.`}
      {...hoverProps}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.card,
          borderColor: pressed || hovered ? theme.emberDeep : theme.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}>
      <View style={styles.tileTop}>
        <Text style={styles.tileIcon}>{cap.icon}</Text>
        <View style={styles.pulseWrap}>
          <Animated.View style={[styles.pulseRing, { borderColor: theme.ember }, ring]} />
          <View style={[styles.pulseDot, { backgroundColor: live ? theme.ember : theme.textMuted }]} />
        </View>
      </View>
      <Text style={[styles.tileValue, { color: live ? theme.text : theme.textMuted }]} numberOfLines={1}>
        {formatValue(reading, cap, effectiveMs)}
      </Text>
      <Text style={[styles.tileLabel, { color: theme.textMuted }]} numberOfLines={1}>
        {cap.label}
      </Text>
      <Text style={[styles.tileStale, { color: theme.textMuted }]} numberOfLines={1}>
        {live ? '' : ts != null ? `no data · last ${ago(ts)}` : 'no data'}
      </Text>
      {/* TTL: full on each receive, drains toward the next expected reading */}
      <View style={[styles.ttlTrack, { backgroundColor: theme.backgroundElement }]}>
        <Animated.View style={[styles.ttlFill, { backgroundColor: theme.ember, width: ttlWidth }]} />
      </View>
      <Text style={[styles.tileRate, { color: active != null ? theme.ember : theme.textMuted }]}>
        every {fmtRate(effectiveMs)}
      </Text>
    </Pressable>
  );
}

/** The body of a sensor's sheet: what it reads, and the one knob that changes it. */
export function SensorSheetBody({
  cap,
  reading,
  active,
  onChange,
}: {
  cap: HomeCapability;
  reading: Reading | null;
  active?: number;
  onChange: (ms: number) => void;
}) {
  const theme = useTheme();
  const effectiveMs = active ?? DEFAULT_CADENCE_MS;
  return (
    <>
      <View style={[styles.readout, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        <Text style={styles.readoutIcon}>{cap.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.readoutValue, { color: theme.text }]} numberOfLines={1}>
            {formatValue(reading, cap, effectiveMs)}
          </Text>
          <Text style={[styles.readoutMeta, { color: theme.textMuted }]}>
            {reading ? `updated ${ago(reading.ts)}` : 'no reading yet'}
          </Text>
        </View>
      </View>

      <StepSlider
        label="Sample rate"
        stops={CADENCE_STOPS}
        value={effectiveMs}
        format={fmtRate}
        onCommit={onChange}
      />

      <Text style={[styles.note, { color: theme.textMuted }]}>
        The hub relays this down to the node — readings speed up within a few seconds.
        {active == null ? ' This sensor is on the firmware default until you set a rate.' : ''}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  tile: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: 150,
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
  // Reserves its line whether or not it has text, so a tile doesn't resize as it goes stale.
  tileStale: { fontFamily: Fonts?.mono, fontSize: 9, fontWeight: '600', minHeight: 12 },
  tileRate: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700', marginTop: 5 },

  // pulse — a heartbeat ping in the tile corner on every fresh reading
  pulseWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },

  // TTL — a bar that refills on receive and drains toward the next expected reading
  ttlTrack: { height: 3, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  ttlFill: { height: 3, borderRadius: 2 },

  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  readoutIcon: { fontSize: 26 },
  readoutValue: { fontFamily: Fonts?.sans, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  readoutMeta: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '600' },
  note: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
});
