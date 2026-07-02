import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useResponsive } from './ui';

type Tier = {
  icon: string;
  name: string;
  role: string;
  desc: string;
};

const TIERS: Tier[] = [
  {
    icon: '🔌',
    name: 'Nodes',
    role: 'perceive + act',
    desc: 'Self-describing ESP32 sensors and actuators — temperature, doors, motion, RFID, relays, servos. Each keeps a local safety veto.',
  },
  {
    icon: '🍓',
    name: 'The hub',
    role: 'orchestrate on-site',
    desc: 'A Raspberry Pi runs the node registry, the live deployments, the privacy filter and the offline fallback — and holds the camera and mic.',
  },
  {
    icon: '☁️',
    name: 'Qwen Cloud',
    role: 'author + reason',
    desc: 'Turns your plain words into a working deployment, and reasons about the messy real world — including seeing the scene with Qwen-VL.',
  },
];

const LINKS = ['mesh / Wi-Fi', 'minimized events · frames on demand'];

export function ArchDiagram() {
  const { isWide } = useResponsive();
  return (
    <View style={[styles.wrap, { flexDirection: isWide ? 'row' : 'column' }]}>
      {TIERS.map((tier, i) => (
        <View key={tier.name} style={[styles.cell, { flexDirection: isWide ? 'row' : 'column' }]}>
          <TierCard tier={tier} />
          {i < TIERS.length - 1 ? <Connector label={LINKS[i]} horizontal={isWide} /> : null}
        </View>
      ))}
    </View>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <Text style={styles.icon}>{tier.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: theme.text }]}>{tier.name}</Text>
          <Text style={[styles.role, { color: theme.ember }]}>{tier.role}</Text>
        </View>
      </View>
      <Text style={[styles.desc, { color: theme.textSecondary }]}>{tier.desc}</Text>
    </View>
  );
}

function Connector({ label, horizontal }: { label: string; horizontal: boolean }) {
  const theme = useTheme();
  if (horizontal) {
    return (
      <View style={styles.connH}>
        <View style={[styles.lineH, { backgroundColor: theme.borderStrong }]} />
        <Text style={[styles.connLabel, { color: theme.textMuted }]} numberOfLines={2}>
          {label}
        </Text>
        <View style={[styles.lineH, { backgroundColor: theme.borderStrong }]} />
      </View>
    );
  }
  return (
    <View style={styles.connV}>
      <View style={[styles.lineV, { backgroundColor: theme.borderStrong }]} />
      <Text style={[styles.connLabel, { color: theme.textMuted }]}>{label}</Text>
      <View style={[styles.lineV, { backgroundColor: theme.borderStrong }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'stretch', gap: 0 },
  cell: { alignItems: 'center', flex: 1 },
  card: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    minWidth: 0,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { fontSize: 26 },
  name: { fontFamily: Fonts?.sans, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  role: {
    fontFamily: Fonts?.mono,
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  desc: { fontFamily: Fonts?.sans, fontSize: 14.5, lineHeight: 22 },
  connH: { alignItems: 'center', width: 92, paddingHorizontal: Spacing.one, gap: 4 },
  connV: { alignItems: 'center', height: 68, paddingVertical: Spacing.two, gap: 6 },
  lineH: { height: 2, alignSelf: 'stretch', borderRadius: 1 },
  lineV: { width: 2, flex: 1, borderRadius: 1 },
  connLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 14,
  },
});
