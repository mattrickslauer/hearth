import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EmberGradient, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { FlameMark } from './flame-mark';

const PHRASE = "Warn me if the garage is open after dark and it's cold — and turn on the heater.";

type Row = { icon: string; label: string; value: string; tag?: string };
const ROWS: Row[] = [
  { icon: '👁', label: 'Watches', value: 'Garage door · Garage temperature' },
  { icon: '🧠', label: 'Reasoning', value: 'A local rule on your hub', tag: 'no cloud needed' },
  { icon: '⚡', label: 'Action', value: 'Switch the heater on, then push you' },
  { icon: '💸', label: 'Cost', value: 'Low — this one spends no tokens' },
  { icon: '🔒', label: 'Privacy', value: 'Nothing about it leaves the house' },
];

const TYPE = 32; // ms per character
const AFTER_TYPE = 500;
const THINK = 1100;
const STAGGER = 430;
const HOLD = 3400;

type Phase = 'typing' | 'thinking' | 'revealing';

export function DescribeDemo() {
  const theme = useTheme();
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  const [revealed, setRevealed] = useState(0);
  const [caretOn, setCaretOn] = useState(true);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let alive = true;
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms));
    };
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    const cycle = () => {
      if (!alive) return;
      clearAll();
      setPhase('typing');
      setTyped(0);
      setRevealed(0);

      const len = PHRASE.length;
      for (let i = 1; i <= len; i++) at(i * TYPE, () => alive && setTyped(i));

      const typeEnd = len * TYPE + AFTER_TYPE;
      at(typeEnd, () => alive && setPhase('thinking'));

      const revealStart = typeEnd + THINK;
      at(revealStart, () => alive && setPhase('revealing'));
      for (let j = 1; j <= ROWS.length; j++) {
        at(revealStart + j * STAGGER, () => alive && setRevealed(j));
      }

      at(revealStart + ROWS.length * STAGGER + HOLD, cycle);
    };

    cycle();
    return () => {
      alive = false;
      clearAll();
    };
  }, []);

  // Blinking caret
  useEffect(() => {
    const id = setInterval(() => setCaretOn((c) => !c), 480);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={[styles.frame, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {/* window chrome */}
      <View style={[styles.chrome, { borderBottomColor: theme.border }]}>
        <FlameMark size={17} />
        <Text style={[styles.chromeTitle, { color: theme.textSecondary }]}>Describe</Text>
        <View style={styles.chromeDots}>
          <View style={[styles.chromeDot, { backgroundColor: theme.border }]} />
          <View style={[styles.chromeDot, { backgroundColor: theme.border }]} />
          <View style={[styles.chromeDot, { backgroundColor: theme.border }]} />
        </View>
      </View>

      <View style={styles.pad}>
        <Text style={[styles.prompt, { color: theme.textMuted }]}>What should your home watch for?</Text>

        {/* the input */}
        <View style={[styles.input, { backgroundColor: theme.codeBg, borderColor: theme.borderStrong }]}>
          <Text style={[styles.inputText, { color: theme.text }]}>
            {PHRASE.slice(0, typed)}
            {phase === 'typing' && (
              <Text style={{ color: caretOn ? theme.ember : 'transparent' }}>▍</Text>
            )}
          </Text>
        </View>

        {/* compiled output */}
        {phase !== 'typing' && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.compiled}>
            <View style={styles.compiledHeader}>
              <Text style={[styles.compiledLabel, { color: theme.ember }]}>QWEN COMPILED THIS</Text>
              {phase === 'thinking' ? <ThinkingDots color={theme.ember} /> : null}
            </View>

            {phase === 'revealing' &&
              ROWS.slice(0, revealed).map((row, i) => (
                <Animated.View
                  key={row.label}
                  entering={FadeInDown.duration(340).delay(i === revealed - 1 ? 0 : 0)}
                  style={[styles.row, { borderColor: theme.border }]}>
                  <Text style={styles.rowIcon}>{row.icon}</Text>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{row.label}</Text>
                    <Text style={[styles.rowValue, { color: theme.text }]}>{row.value}</Text>
                  </View>
                  {row.tag ? (
                    <View style={[styles.tag, { backgroundColor: theme.success + '20' }]}>
                      <Text style={[styles.tagText, { color: theme.success }]}>{row.tag}</Text>
                    </View>
                  ) : null}
                </Animated.View>
              ))}

            {phase === 'revealing' && revealed >= ROWS.length && (
              <Animated.View entering={FadeInDown.duration(360)}>
                <View style={styles.startBtn}>
                  <Text style={[styles.startText, { color: EmberGradient[2] }]}>
                    ✓ Looks right — start watching
                  </Text>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

function ThinkingDots({ color }: { color: string }) {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} color={color} delay={i * 180} />
      ))}
    </View>
  );
}

function Dot({ color, delay }: { color: string; delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withRepeat(
      withTiming(1, { duration: 560, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <Animated.View
      style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginLeft: 3 }, style]}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  chromeTitle: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '600', flex: 1 },
  chromeDots: { flexDirection: 'row', gap: 6 },
  chromeDot: { width: 8, height: 8, borderRadius: 4 },
  pad: { padding: Spacing.four, gap: Spacing.three },
  prompt: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '500' },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    minHeight: 76,
  },
  inputText: { fontFamily: Fonts?.sans, fontSize: 17, lineHeight: 26, fontWeight: '500' },
  compiled: { gap: Spacing.two, marginTop: Spacing.one },
  compiledHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  compiledLabel: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', letterSpacing: 1.6 },
  dots: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 11,
    borderTopWidth: 1,
  },
  rowIcon: { fontSize: 17, width: 22, textAlign: 'center' },
  rowBody: { flex: 1, gap: 1 },
  rowLabel: {
    fontFamily: Fonts?.sans,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rowValue: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '500', lineHeight: 21 },
  tag: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: Radius.sm },
  tagText: { fontFamily: Fonts?.sans, fontSize: 11.5, fontWeight: '700' },
  startBtn: { paddingTop: Spacing.three },
  startText: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
});
