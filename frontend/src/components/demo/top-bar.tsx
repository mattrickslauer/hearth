import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Wordmark } from '@/components/landing/ui';
import { useAuth } from '@/auth/context';
import type { Simulation } from '@/demo/use-simulation';
import { SPEEDS } from '@/demo/use-simulation';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Dropdown, Option } from './dropdown';

const TEMP_PRESETS = [
  { label: 'Freezing · 2°C', v: 2 },
  { label: 'Cold · 7°C', v: 7 },
  { label: 'Mild · 15°C', v: 15 },
  { label: 'Warm · 21°C', v: 21 },
];

export function TopBar({ sim, compact }: { sim: Simulation; compact?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const { world } = sim;
  const temp = Number(world.sensors['garage.temp']);
  const doorOpen = world.sensors['garage.door'] === 'open';
  const livingTemp = Number(world.sensors['living.temp']);
  const motion = !!world.sensors['living.motion'];

  return (
    <View style={[styles.bar, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
      <Pressable onPress={() => router.push('/')} hitSlop={8} style={styles.back}>
        <Text style={[styles.backText, { color: theme.textSecondary }]}>←</Text>
      </Pressable>
      {!compact ? <Wordmark size={19} /> : null}

      <TimeControl sim={sim} />

      <View style={styles.settings}>
        <Dropdown icon={world.timeOfDay === 'day' ? '☀️' : '🌙'} label="Time" value={world.timeOfDay === 'day' ? 'Day' : 'Night'} width={180}>
          {(close) => (
            <>
              <Option icon="☀️" label="Day" active={world.timeOfDay === 'day'} onPress={() => { sim.setDay(true); close(); }} />
              <Option icon="🌙" label="Night" active={world.timeOfDay === 'night'} onPress={() => { sim.setDay(false); close(); }} />
            </>
          )}
        </Dropdown>

        <Dropdown icon={world.online ? '⛅' : '✕'} label="Network" value={world.online ? 'Online' : 'Offline'} width={190}>
          {(close) => (
            <>
              <Option icon="⛅" label="Cloud online" active={world.online} onPress={() => { sim.setOnline(true); close(); }} />
              <Option icon="✕" label="Offline — hub only" active={!world.online} onPress={() => { sim.setOnline(false); close(); }} />
            </>
          )}
        </Dropdown>

        <Dropdown icon="🚪" label="Garage door" value={doorOpen ? 'Open' : 'Closed'} width={180}>
          {(close) => (
            <>
              <Option label="Closed" active={!doorOpen} onPress={() => { sim.setGarageDoor(false); close(); }} />
              <Option label="Open" active={doorOpen} onPress={() => { sim.setGarageDoor(true); close(); }} />
            </>
          )}
        </Dropdown>

        <Dropdown icon="🌡" label="Garage temp" value={`${temp}°C`} width={210}>
          {() => (
            <View style={{ gap: Spacing.one }}>
              <View style={styles.stepper}>
                <Step label="−" onPress={() => sim.setTemp(Math.max(-10, temp - 1))} theme={theme} />
                <Text style={[styles.tempVal, { color: temp < 10 ? theme.info : theme.text }]}>{temp}°C</Text>
                <Step label="+" onPress={() => sim.setTemp(Math.min(32, temp + 1))} theme={theme} />
              </View>
              {TEMP_PRESETS.map((p) => (
                <Option key={p.v} label={p.label} active={temp === p.v} onPress={() => sim.setTemp(p.v)} />
              ))}
            </View>
          )}
        </Dropdown>

        <Dropdown icon="🛋" label="Living room" value={`${motion ? 'Someone' : 'Empty'} · ${livingTemp}°`} width={230}>
          {() => (
            <View style={{ gap: 2 }}>
              <Option icon="🚶" label="Someone moving" active={motion} onPress={() => sim.setLivingMotion(true)} />
              <Option icon="🛑" label="Empty / still" active={!motion} onPress={() => sim.setLivingMotion(false)} />
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <View style={styles.stepper}>
                <Step label="−" onPress={() => sim.setLivingTemp(Math.max(4, livingTemp - 1))} theme={theme} />
                <Text style={[styles.tempVal, { color: livingTemp < 18 ? theme.info : theme.text }]}>{livingTemp}°C</Text>
                <Step label="+" onPress={() => sim.setLivingTemp(Math.min(30, livingTemp + 1))} theme={theme} />
              </View>
            </View>
          )}
        </Dropdown>

        <Dropdown icon={world.visitor?.emoji ?? '🚶'} label="At the door" value={world.visitor ? world.visitor.label : 'Nobody'} align="right" width={230}>
          {(close) => (
            <>
              <Option icon="🚫" label="Nobody" active={!world.visitor} onPress={() => { sim.setVisitor(null); close(); }} />
              {sim.visitors.map((v) => (
                <Option
                  key={v.id}
                  icon={v.emoji}
                  label={v.household ? `${v.label} · family` : v.label}
                  active={world.visitor?.id === v.id}
                  onPress={() => { sim.setVisitor(v); close(); }}
                />
              ))}
            </>
          )}
        </Dropdown>
      </View>

      <Pressable onPress={sim.reset} hitSlop={6} style={[styles.reset, { borderColor: theme.border }]}>
        <Text style={[styles.resetText, { color: theme.textSecondary }]}>reset ↺</Text>
      </Pressable>

      <AuthPill />
    </View>
  );
}

/** Non-blocking account affordance: "Sign in" for guests, the account when signed in. */
function AuthPill() {
  const theme = useTheme();
  const router = useRouter();
  const { status, account } = useAuth();
  const label = status === 'signedIn' ? (account?.email?.split('@')[0] ?? 'Account') : 'Sign in';
  return (
    <Pressable
      onPress={() => router.push('/signin')}
      hitSlop={6}
      style={[styles.auth, { borderColor: status === 'signedIn' ? theme.ember : theme.border, backgroundColor: status === 'signedIn' ? theme.emberGlow : 'transparent' }]}>
      <Text style={[styles.authIcon, { color: status === 'signedIn' ? theme.ember : theme.textSecondary }]}>{status === 'signedIn' ? '●' : '○'}</Text>
      <Text style={[styles.authText, { color: status === 'signedIn' ? theme.ember : theme.textSecondary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function TimeControl({ sim }: { sim: Simulation }) {
  const theme = useTheme();
  return (
    <View style={styles.time}>
      <Pressable
        onPress={() => sim.setRunning(!sim.running)}
        style={[styles.play, { borderColor: theme.border, backgroundColor: sim.running ? theme.emberGlow : theme.card }]}>
        <Text style={{ color: sim.running ? theme.ember : theme.textSecondary, fontSize: 12, fontWeight: '700' }}>
          {sim.running ? '❚❚' : '▶'}
        </Text>
      </Pressable>
      <View style={[styles.speedRow, { borderColor: theme.border, backgroundColor: theme.codeBg }]}>
        {SPEEDS.map((s) => (
          <Pressable key={s} onPress={() => sim.setSpeed(s)} style={[styles.speedItem, sim.speed === s && { backgroundColor: theme.ember }]}>
            <Text style={[styles.speedText, { color: sim.speed === s ? theme.onEmber : theme.textSecondary }]}>{s}×</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => sim.jump(5 * 60 * 1000)} style={[styles.jump, { borderColor: theme.border }]}>
        <Text style={[styles.jumpText, { color: theme.textSecondary }]}>+5m</Text>
      </Pressable>
    </View>
  );
}

function Step({ label, onPress, theme }: { label: string; onPress: () => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <Pressable onPress={onPress} style={[styles.step, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      <Text style={[styles.stepText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    zIndex: 50,
  },
  back: { paddingHorizontal: 4 },
  backText: { fontSize: 20, fontWeight: '600' },
  settings: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, justifyContent: 'center', flexWrap: 'wrap' },
  reset: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: 1 },
  resetText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },
  auth: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: 1, maxWidth: 160 },
  authIcon: { fontSize: 9 },
  authText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  play: { width: 30, height: 30, borderRadius: Radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  speedRow: { flexDirection: 'row', borderRadius: Radius.sm, borderWidth: 1, padding: 2, gap: 2 },
  speedItem: { paddingVertical: 4, paddingHorizontal: 7, borderRadius: Radius.sm - 3 },
  speedText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  jump: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: Radius.sm, borderWidth: 1 },
  jumpText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 4 },
  step: {
    width: 40,
    height: 34,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 18, fontWeight: '700' },
  tempVal: { fontFamily: Fonts?.sans, fontSize: 17, fontWeight: '800' },
  divider: { height: 1, marginVertical: 4 },
});
