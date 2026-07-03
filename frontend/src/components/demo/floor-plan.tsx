import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlowOrb } from '@/components/landing/ui';
import { capability, formatClock, isActuatorActive, readCapability, VISITORS } from '@/demo/home';
import type { Simulation } from '@/demo/use-simulation';
import type { Capability, WorldState } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Pos = { left: DimensionValue; top: DimensionValue };
type Rect = { left: DimensionValue; top: DimensionValue; width: DimensionValue; height: DimensionValue };

const ROOMS: Record<'living' | 'garage' | 'entry', Rect> = {
  living: { left: '2.5%', top: '3%', width: '60%', height: '52%' },
  garage: { left: '2.5%', top: '59%', width: '60%', height: '38%' },
  entry: { left: '65%', top: '3%', width: '32.5%', height: '94%' },
};

// device id → position within its room (percent of the room box)
const PLACE: Record<string, Pos> = {
  'living.light': { left: '10%', top: '30%' },
  'living.thermostat': { left: '52%', top: '26%' },
  'living.temp': { left: '52%', top: '60%' },
  'garage.door': { left: '8%', top: '32%' },
  'garage.temp': { left: '44%', top: '30%' },
  'garage.heater': { left: '72%', top: '54%' },
  'camera.frame': { left: '16%', top: '14%' },
  'entry.pan': { left: '56%', top: '14%' },
  'entry.presence': { left: '16%', top: '44%' },
  'entry.rfid': { left: '56%', top: '44%' },
  'entry.lcd': { left: '34%', top: '74%' },
};

/** A top-down, Sims-style view of the home. Rooms are spatial; devices sit
 *  where they'd physically live and light up with their live state. Tap a room
 *  to poke it (open the garage, move in the living room, cycle who's at the door). */
export function FloorPlan({ sim }: { sim: Simulation }) {
  const theme = useTheme();
  const { world } = sim;
  const night = world.timeOfDay === 'night';

  const cycleVisitor = () => {
    const order = [null, ...VISITORS];
    const idx = order.findIndex((v) => (v?.id ?? null) === (world.visitor?.id ?? null));
    sim.setVisitor(order[(idx + 1) % order.length]);
  };

  const wall = night ? '#2A2620' : theme.borderStrong;
  const roomBg = night ? 'rgba(255,255,255,0.035)' : theme.card;

  return (
    <View style={[styles.wrap, { backgroundColor: night ? '#0E0C0A' : theme.backgroundElement, borderColor: theme.border }]}>
      <GlowOrb
        size={420}
        color={night ? 'rgba(120,140,220,0.12)' : 'rgba(255,196,120,0.28)'}
        style={styles.sky}
      />

      {/* status pill */}
      <View style={[styles.status, { backgroundColor: night ? 'rgba(0,0,0,0.4)' : theme.card, borderColor: theme.border }]}>
        <Text style={[styles.clock, { color: night ? '#E7E2D8' : theme.text }]}>
          {night ? '🌙' : '☀️'} {formatClock(world.clock)}
        </Text>
        <Text style={[styles.net, { color: world.online ? theme.success : theme.warn }]}>
          {world.online ? '⛅ cloud' : '✕ offline'}
        </Text>
      </View>

      <Room
        rect={ROOMS.living}
        name="Living room"
        icon="🛋"
        hint="tap: toggle motion"
        night={night}
        wall={wall}
        bg={roomBg}
        onPress={() => sim.setLivingMotion(!world.sensors['living.motion'])}>
        {world.sensors['living.motion'] ? <Avatar emoji="🧍" pos={{ left: '30%', top: '58%' }} label="motion" theme={theme} /> : null}
        {['living.light', 'living.thermostat', 'living.temp'].map((id) => (
          <Device key={id} cap={capability(id)!} world={world} night={night} />
        ))}
      </Room>

      <Room
        rect={ROOMS.garage}
        name="Garage"
        icon="🚗"
        hint="tap: open / close door"
        night={night}
        wall={wall}
        bg={roomBg}
        onPress={() => sim.setGarageDoor(world.sensors['garage.door'] !== 'open')}>
        {['garage.door', 'garage.temp', 'garage.heater'].map((id) => (
          <Device key={id} cap={capability(id)!} world={world} night={night} />
        ))}
      </Room>

      <Room
        rect={ROOMS.entry}
        name="Front door"
        icon="🚪"
        hint="tap: cycle visitor"
        night={night}
        wall={wall}
        bg={roomBg}
        onPress={cycleVisitor}>
        {world.visitor ? <Avatar emoji={world.visitor.emoji} pos={{ left: '36%', top: '2%' }} label={world.visitor.label} theme={theme} /> : null}
        {['camera.frame', 'entry.pan', 'entry.presence', 'entry.rfid', 'entry.lcd'].map((id) => (
          <Device key={id} cap={capability(id)!} world={world} night={night} />
        ))}
      </Room>
    </View>
  );
}

function Room({
  rect,
  name,
  icon,
  hint,
  night,
  wall,
  bg,
  onPress,
  children,
}: {
  rect: Rect;
  name: string;
  icon: string;
  hint: string;
  night: boolean;
  wall: string;
  bg: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.room, rect, { backgroundColor: bg, borderColor: wall }]}>
      <View style={styles.roomHead}>
        <Text style={styles.roomIcon}>{icon}</Text>
        <Text style={[styles.roomName, { color: night ? '#CFC7B9' : theme.textSecondary }]}>{name}</Text>
      </View>
      {children}
      <Text style={[styles.hint, { color: night ? '#6E665A' : theme.textMuted }]}>{hint}</Text>
    </Pressable>
  );
}

function Device({ cap, world, night }: { cap: Capability; world: WorldState; night: boolean }) {
  const theme = useTheme();
  const pos = PLACE[cap.id];
  if (!pos) return null;
  const { text, tone } = readCapability(cap, world);
  const active = cap.kind === 'actuator' && isActuatorActive(cap.id, world);

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
    <View style={[styles.device, { left: pos.left, top: pos.top }]}>
      <View
        style={[
          styles.token,
          {
            backgroundColor: active ? theme.emberGlow : night ? 'rgba(255,255,255,0.06)' : theme.background,
            borderColor: active ? theme.ember : night ? 'rgba(255,255,255,0.12)' : theme.border,
          },
        ]}>
        <Text style={styles.tokenIcon}>{cap.icon}</Text>
        {cap.vision ? <View style={[styles.visionDot, { backgroundColor: theme.ember }]} /> : null}
      </View>
      <Text style={[styles.devLabel, { color: night ? '#9A9080' : theme.textMuted }]} numberOfLines={1}>
        {cap.label}
      </Text>
      <Text style={[styles.devValue, { color: accent }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function Avatar({ emoji, pos, label, theme }: { emoji: string; pos: Pos; label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <Animated.View entering={FadeIn} style={[styles.avatar, { left: pos.left, top: pos.top }]}>
      <Text style={styles.avatarEmoji}>{emoji}</Text>
      <View style={[styles.avatarTag, { backgroundColor: theme.ember }]}>
        <Text style={[styles.avatarTagText, { color: theme.onEmber }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 440, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  sky: { position: 'absolute', top: -120, alignSelf: 'center' },
  status: {
    position: 'absolute',
    top: Spacing.three,
    alignSelf: 'center',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  clock: { fontFamily: Fonts?.mono, fontSize: 13, fontWeight: '700' },
  net: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  room: {
    position: 'absolute',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    padding: Spacing.two,
  },
  roomHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roomIcon: { fontSize: 15 },
  roomName: {
    fontFamily: Fonts?.mono,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hint: {
    position: 'absolute',
    bottom: 7,
    left: 10,
    fontFamily: Fonts?.mono,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  device: { position: 'absolute', alignItems: 'center', width: 76 },
  token: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenIcon: { fontSize: 21 },
  visionDot: { position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3 },
  devLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 4,
    textAlign: 'center',
  },
  devValue: { fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '800', textAlign: 'center', marginTop: 1 },
  avatar: { position: 'absolute', alignItems: 'center', zIndex: 4 },
  avatarEmoji: { fontSize: 30 },
  avatarTag: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill, marginTop: 2, maxWidth: 90 },
  avatarTagText: { fontFamily: Fonts?.sans, fontSize: 9.5, fontWeight: '700' },
});
