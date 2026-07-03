import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlowOrb } from '@/components/landing/ui';
import { formatClock, isActuatorActive, NODES, readCapability, ZONES } from '@/demo/home';
import type { Capability, WorldState, Zone } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function HomeView({ world }: { world: WorldState }) {
  const theme = useTheme();
  const night = world.timeOfDay === 'night';

  return (
    <View
      style={[
        styles.house,
        {
          backgroundColor: night ? '#0F0D0B' : theme.backgroundElement,
          borderColor: theme.border,
        },
      ]}>
      <GlowOrb
        size={340}
        color={night ? 'rgba(120,140,220,0.14)' : 'rgba(255,196,120,0.30)'}
        style={styles.sky}
      />

      {/* status strip */}
      <View style={styles.strip}>
        <Text style={[styles.clock, { color: night ? '#E7E2D8' : theme.text }]}>
          {night ? '🌙' : '☀️'} {formatClock(world.clock)}
        </Text>
        <View style={styles.stripRight}>
          <View
            style={[
              styles.net,
              {
                backgroundColor: (world.online ? theme.success : theme.warn) + '22',
              },
            ]}>
            <Text style={[styles.netText, { color: world.online ? theme.success : theme.warn }]}>
              {world.online ? '⛅ cloud online' : '✕ offline — hub only'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.zones}>
        {ZONES.map((zone) => (
          <ZoneCard key={zone.id} zone={zone} world={world} night={night} />
        ))}
      </View>
    </View>
  );
}

function ZoneCard({ zone, world, night }: { zone: Zone; world: WorldState; night: boolean }) {
  const theme = useTheme();
  const caps = NODES.filter((n) => n.zone === zone.id).flatMap((n) => n.capabilities);
  const visitorHere = zone.id === 'entry' && world.visitor;

  return (
    <View
      style={[
        styles.zone,
        {
          backgroundColor: night ? 'rgba(255,255,255,0.03)' : theme.card,
          borderColor: theme.border,
        },
      ]}>
      <View style={styles.zoneHead}>
        <Text style={styles.zoneIcon}>{zone.icon}</Text>
        <Text style={[styles.zoneName, { color: night ? '#E7E2D8' : theme.text }]}>{zone.name}</Text>
        {visitorHere ? (
          <Animated.Text entering={FadeIn} style={styles.visitor}>
            {world.visitor?.emoji}
          </Animated.Text>
        ) : null}
      </View>
      <View style={styles.tiles}>
        {caps.map((c) => (
          <CapabilityTile key={c.id} cap={c} world={world} night={night} />
        ))}
      </View>
    </View>
  );
}

function CapabilityTile({ cap, world, night }: { cap: Capability; world: WorldState; night: boolean }) {
  const theme = useTheme();
  const { text, tone } = readCapability(cap, world);
  const isActuator = cap.kind === 'actuator';
  const active = isActuator && isActuatorActive(cap.id, world);

  const accent =
    tone === 'hot'
      ? theme.ember
      : tone === 'lit'
        ? theme.warn
        : tone === 'cold'
          ? theme.info
          : tone === 'alert'
            ? theme.warn
            : tone === 'good'
              ? theme.success
              : night
                ? '#8A8072'
                : theme.textMuted;

  return (
    <View
      style={[
        styles.tile,
        {
          borderColor: active ? theme.emberDeep : night ? 'rgba(255,255,255,0.08)' : theme.border,
          backgroundColor: active ? theme.emberGlow : 'transparent',
        },
      ]}>
      <Text style={[styles.tileIcon, active && styles.tileIconActive]}>{cap.icon}</Text>
      <View style={styles.tileBody}>
        <Text style={[styles.tileLabel, { color: night ? '#9A9080' : theme.textMuted }]} numberOfLines={1}>
          {cap.label}
        </Text>
        <Text style={[styles.tileValue, { color: accent }]} numberOfLines={1}>
          {text}
        </Text>
      </View>
      {cap.vision ? (
        <View style={[styles.visionDot, { backgroundColor: theme.ember }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  house: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.four,
    overflow: 'hidden',
    minHeight: 300,
  },
  sky: { position: 'absolute', top: -140, right: -80 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  clock: { fontFamily: Fonts?.mono, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  stripRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  net: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: Radius.pill },
  netText: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  zone: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 180,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  zoneIcon: { fontSize: 18 },
  zoneName: { flex: 1, fontFamily: Fonts?.sans, fontSize: 14.5, fontWeight: '700', letterSpacing: -0.2 },
  visitor: { fontSize: 22 },
  tiles: { gap: Spacing.two },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  tileIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  tileIconActive: { transform: [{ scale: 1.1 }] },
  tileBody: { flex: 1, gap: 1 },
  tileLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tileValue: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  visionDot: { width: 6, height: 6, borderRadius: 3 },
});
