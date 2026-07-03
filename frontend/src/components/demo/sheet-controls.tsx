import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Simulation } from '@/demo/use-simulation';
import type { Visitor } from '@/demo/types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Full world controls for the mobile sheet — big, touch-friendly targets. */
export function SheetControls({ sim }: { sim: Simulation }) {
  const { world } = sim;
  const gtemp = Number(world.sensors['garage.temp']);
  const ltemp = Number(world.sensors['living.temp']);
  const motion = !!world.sensors['living.motion'];

  return (
    <View style={styles.wrap}>
      <Row label="Time of day">
        <Seg
          options={[
            { key: 'day', label: '☀ Day' },
            { key: 'night', label: '🌙 Night' },
          ]}
          value={world.timeOfDay}
          onChange={(k) => sim.setDay(k === 'day')}
        />
      </Row>

      <Row label="Network">
        <Seg
          options={[
            { key: 'online', label: '⛅ Online' },
            { key: 'offline', label: '✕ Offline' },
          ]}
          value={world.online ? 'online' : 'offline'}
          onChange={(k) => sim.setOnline(k === 'online')}
        />
      </Row>

      <Row label="Garage door">
        <Seg
          options={[
            { key: 'closed', label: 'Closed' },
            { key: 'open', label: 'Open' },
          ]}
          value={world.sensors['garage.door'] === 'open' ? 'open' : 'closed'}
          onChange={(k) => sim.setGarageDoor(k === 'open')}
        />
      </Row>

      <Row label={`Garage temperature · ${gtemp}°C`}>
        <Stepper value={gtemp} onDown={() => sim.setTemp(Math.max(-10, gtemp - 1))} onUp={() => sim.setTemp(Math.min(32, gtemp + 1))} cold={gtemp < 10} />
      </Row>

      <Row label="Living room motion">
        <Seg
          options={[
            { key: 'someone', label: '🚶 Someone' },
            { key: 'empty', label: '🛑 Empty' },
          ]}
          value={motion ? 'someone' : 'empty'}
          onChange={(k) => sim.setLivingMotion(k === 'someone')}
        />
      </Row>

      <Row label={`Living temperature · ${ltemp}°C`}>
        <Stepper value={ltemp} onDown={() => sim.setLivingTemp(Math.max(4, ltemp - 1))} onUp={() => sim.setLivingTemp(Math.min(30, ltemp + 1))} cold={ltemp < 18} />
      </Row>

      <Row label="At the front door">
        <View style={styles.chips}>
          <VChip label="Nobody" emoji="🚫" active={!world.visitor} onPress={() => sim.setVisitor(null)} />
          {sim.visitors.map((v: Visitor) => (
            <VChip
              key={v.id}
              emoji={v.emoji}
              label={v.household ? `${v.label} · family` : v.label}
              active={world.visitor?.id === v.id}
              onPress={() => sim.setVisitor(v)}
            />
          ))}
        </View>
      </Row>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

function Seg({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.segItem, active && { backgroundColor: theme.ember }]}>
            <Text style={[styles.segText, { color: active ? theme.onEmber : theme.textSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({ value, onDown, onUp, cold }: { value: number; onDown: () => void; onUp: () => void; cold: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onDown} style={[styles.stepBtn, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        <Text style={[styles.stepText, { color: theme.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepVal, { color: cold ? theme.info : theme.text }]}>{value}°C</Text>
      <Pressable onPress={onUp} style={[styles.stepBtn, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        <Text style={[styles.stepText, { color: theme.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

function VChip({ label, emoji, active, onPress }: { label: string; emoji: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.vChip, { borderColor: active ? theme.emberDeep : theme.border, backgroundColor: active ? theme.emberGlow : theme.codeBg }]}>
      <Text style={styles.vEmoji}>{emoji}</Text>
      <Text style={[styles.vLabel, { color: active ? theme.ember : theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.four },
  row: { gap: Spacing.two },
  label: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  seg: { flexDirection: 'row', borderRadius: Radius.md, borderWidth: 1, padding: 3, gap: 3 },
  segItem: { flex: 1, paddingVertical: 11, borderRadius: Radius.sm, alignItems: 'center' },
  segText: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepBtn: { width: 52, height: 44, borderRadius: Radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '700' },
  stepVal: { flex: 1, textAlign: 'center', fontFamily: Fonts?.sans, fontSize: 18, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  vChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: Radius.pill, borderWidth: 1 },
  vEmoji: { fontSize: 15 },
  vLabel: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '600' },
});
