import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FlameMark } from '@/components/landing/flame-mark';
import type { Simulation } from '@/demo/use-simulation';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { webNoOutline } from '@/lib/web-style';

import { DeploymentCard } from './deployment-card';

const EXAMPLES = [
  "Warn me if the garage is open after dark and it's cold — turn on the heater.",
  "Tell me if someone who isn't family is at the front door.",
  'Ping me if the garage door gets left open.',
];

export function DescribeConsole({ sim }: { sim: Simulation }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const thinking = sim.authorPhase === 'thinking';

  const submit = (value?: string) => {
    const wish = (value ?? text).trim();
    if (!wish || thinking) return;
    setText('');
    void sim.describe(wish);
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={[styles.chrome, { borderBottomColor: theme.border }]}>
        <FlameMark size={17} />
        <Text style={[styles.chromeTitle, { color: theme.textSecondary }]}>Describe</Text>
        <View style={[styles.brainPill, { borderColor: theme.border, backgroundColor: theme.emberGlow }]}>
          <View style={[styles.brainDot, { backgroundColor: theme.ember }]} />
          <Text style={[styles.brainText, { color: theme.ember }]}>{sim.brainLabel}</Text>
        </View>
      </View>

      <View style={styles.pad}>
        <Text style={[styles.prompt, { color: theme.textMuted }]}>What should your home watch for?</Text>

        <View style={[styles.inputWrap, { backgroundColor: theme.codeBg, borderColor: theme.borderStrong }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => submit()}
            editable={!thinking}
            placeholder="Describe it in plain words…"
            placeholderTextColor={theme.textMuted}
            multiline
            style={[styles.input, { color: theme.text }, webNoOutline]}
          />
          <Pressable
            onPress={() => submit()}
            disabled={thinking || !text.trim()}
            style={[
              styles.send,
              {
                backgroundColor: text.trim() && !thinking ? theme.ember : theme.backgroundSelected,
              },
            ]}>
            <Text style={[styles.sendText, { color: text.trim() && !thinking ? theme.onEmber : theme.textMuted }]}>
              {thinking ? '…' : 'Compile ↵'}
            </Text>
          </Pressable>
        </View>

        {/* example chips */}
        {sim.authorPhase === 'idle' && sim.questions.length === 0 ? (
          <View style={styles.examples}>
            <Text style={[styles.tryLabel, { color: theme.textMuted }]}>Try —</Text>
            {EXAMPLES.map((ex) => (
              <Pressable
                key={ex}
                onPress={() => submit(ex)}
                style={[styles.exChip, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <Text style={[styles.exText, { color: theme.textSecondary }]} numberOfLines={1}>
                  {ex}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {thinking ? (
          <Animated.View entering={FadeInDown.duration(240)} style={styles.thinking}>
            <Text style={[styles.compiledLabel, { color: theme.ember }]}>QWEN IS COMPILING</Text>
            <ThinkingDots color={theme.ember} />
          </Animated.View>
        ) : null}

        {/* active deployments */}
        {sim.questions.length > 0 ? (
          <View style={styles.list}>
            <Text style={[styles.listLabel, { color: theme.textMuted }]}>
              {sim.questions.length} active watch{sim.questions.length > 1 ? 'es' : ''}
            </Text>
            {sim.questions.map((dep, i) => (
              <Animated.View key={dep.id} entering={FadeInDown.duration(320).delay(i === sim.questions.length - 1 ? 60 : 0)}>
                <DeploymentCard
                  dep={dep}
                  onRemove={() => sim.removeQuestion(dep.id)}
                  onConfigure={(patch) => sim.configureQuestion(dep.id, patch)}
                  active
                />
              </Animated.View>
            ))}
          </View>
        ) : null}
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
      style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginLeft: 4 }, style]}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
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
  brainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  brainDot: { width: 6, height: 6, borderRadius: 3 },
  brainText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  pad: { padding: Spacing.four, gap: Spacing.three },
  prompt: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '500' },
  inputWrap: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  input: {
    fontFamily: Fonts?.sans,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    minHeight: 52,
  },
  send: { alignSelf: 'flex-end', paddingVertical: 9, paddingHorizontal: 16, borderRadius: Radius.pill },
  sendText: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '700' },
  examples: { gap: Spacing.two },
  tryLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  exChip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: Radius.sm, borderWidth: 1 },
  exText: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '500' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  compiledLabel: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700', letterSpacing: 1.6 },
  dots: { flexDirection: 'row', alignItems: 'center' },
  list: { gap: Spacing.two, marginTop: Spacing.one },
  listLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
