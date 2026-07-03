import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Wordmark } from '@/components/landing/ui';
import { SPEEDS, type Simulation } from '@/demo/use-simulation';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ActivityFeed } from './activity-feed';
import { DescribeConsole } from './describe-console';
import { FloorPlan } from './floor-plan';
import { PushToast } from './push-toast';
import { SheetControls } from './sheet-controls';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const COLLAPSED = 96;

type Tab = 'describe' | 'activity' | 'controls';

/** The phone experience: a full-screen birds-eye house with a tap-toggle bottom
 *  sheet that overlays Describe / Activity / Controls. */
export function MobileDemo({ sim }: { sim: Simulation }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const fullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;

  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.background }, fullHeight]} edges={['top', 'left', 'right']}>
      <MobileTopBar sim={sim} />
      <View style={styles.stage}>
        <View style={[styles.homeWrap, { paddingBottom: COLLAPSED + Spacing.three }]}>
          <FloorPlan sim={sim} stacked />
        </View>
        <MobileSheet sim={sim} screenH={height} />
        <PushToast text={sim.push?.text ?? null} />
      </View>
    </SafeAreaView>
  );
}

function MobileTopBar({ sim }: { sim: Simulation }) {
  const theme = useTheme();
  const router = useRouter();
  const cycleSpeed = () => sim.setSpeed(SPEEDS[(SPEEDS.indexOf(sim.speed) + 1) % SPEEDS.length]);

  return (
    <View style={[styles.topbar, { borderBottomColor: theme.border }]}>
      <Pressable onPress={() => router.push('/')} hitSlop={8}>
        <Text style={[styles.back, { color: theme.textSecondary }]}>←</Text>
      </Pressable>
      <Wordmark size={18} />
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => sim.setRunning(!sim.running)}
        style={[styles.tBtn, { borderColor: theme.border, backgroundColor: sim.running ? theme.emberGlow : theme.card }]}>
        <Text style={{ color: sim.running ? theme.ember : theme.textSecondary, fontSize: 12, fontWeight: '700' }}>{sim.running ? '❚❚' : '▶'}</Text>
      </Pressable>
      <Pressable onPress={cycleSpeed} style={[styles.tChip, { borderColor: theme.border, backgroundColor: theme.codeBg }]}>
        <Text style={[styles.tChipText, { color: theme.text }]}>{sim.speed}×</Text>
      </Pressable>
      <Pressable onPress={() => sim.jump(5 * 60 * 1000)} style={[styles.tChip, { borderColor: theme.border }]}>
        <Text style={[styles.tChipText, { color: theme.textSecondary }]}>+5m</Text>
      </Pressable>
    </View>
  );
}

function MobileSheet({ sim, screenH }: { sim: Simulation; screenH: number }) {
  const theme = useTheme();
  const expanded = Math.min(screenH * 0.64, 540);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('describe');
  const v = useSharedValue(0);

  useEffect(() => {
    v.value = withTiming(open ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [open, v]);

  const sheetStyle = useAnimatedStyle(() => ({ height: COLLAPSED + (expanded - COLLAPSED) * v.value }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: v.value * 0.5 }));

  const latest = sim.activity[0];

  return (
    <>
      {open ? (
        <AnimatedPressable onPress={() => setOpen(false)} style={[styles.scrim, scrimStyle]} />
      ) : null}

      <Animated.View style={[styles.sheet, sheetStyle, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Pressable onPress={() => setOpen((o) => !o)} style={styles.handleWrap} hitSlop={10}>
          <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />
        </Pressable>

        {open ? (
          <View style={{ flex: 1 }}>
            <Tabs tab={tab} onChange={setTab} watches={sim.questions.length} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {tab === 'describe' ? <DescribeConsole sim={sim} /> : null}
              {tab === 'activity' ? <ActivityFeed events={sim.activity} /> : null}
              {tab === 'controls' ? <SheetControls sim={sim} /> : null}
            </ScrollView>
          </View>
        ) : (
          <Pressable onPress={() => { setTab('describe'); setOpen(true); }} style={styles.peek}>
            <View style={[styles.peekBtn, { backgroundColor: theme.ember }]}>
              <Text style={[styles.peekBtnText, { color: theme.onEmber }]}>＋ Describe</Text>
            </View>
            <View style={styles.peekInfo}>
              {latest?.judgment ? (
                <Text style={[styles.peekLine, { color: theme.text }]} numberOfLines={1}>
                  {latest.questionTitle}: {latest.judgment.verdict}
                </Text>
              ) : (
                <Text style={[styles.peekLine, { color: theme.textMuted }]} numberOfLines={1}>
                  Tap a room to poke the world · tap up for controls
                </Text>
              )}
              <Text style={[styles.peekSub, { color: theme.textMuted }]}>
                {sim.questions.length} watch{sim.questions.length === 1 ? '' : 'es'} · {sim.activity.length} events
              </Text>
            </View>
          </Pressable>
        )}
      </Animated.View>
    </>
  );
}

function Tabs({ tab, onChange, watches }: { tab: Tab; onChange: (t: Tab) => void; watches: number }) {
  const theme = useTheme();
  const items: { key: Tab; label: string }[] = [
    { key: 'describe', label: watches ? `Describe · ${watches}` : 'Describe' },
    { key: 'activity', label: 'Activity' },
    { key: 'controls', label: 'Controls' },
  ];
  return (
    <View style={[styles.tabs, { borderColor: theme.border, backgroundColor: theme.codeBg }]}>
      {items.map((it) => {
        const active = it.key === tab;
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} style={[styles.tab, active && { backgroundColor: theme.card }]}>
            <Text style={[styles.tabText, { color: active ? theme.ember : theme.textSecondary }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  back: { fontSize: 22, fontWeight: '600' },
  tBtn: { width: 32, height: 32, borderRadius: Radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tChip: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: Radius.sm, borderWidth: 1 },
  tChipText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700' },

  stage: { flex: 1, position: 'relative', overflow: 'hidden' },
  homeWrap: { flex: 1, padding: Spacing.three },

  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 5 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: -10 },
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  grabber: { width: 42, height: 5, borderRadius: 3 },
  content: { padding: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.six },

  peek: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  peekBtn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: Radius.pill },
  peekBtnText: { fontFamily: Fonts?.sans, fontSize: 14.5, fontWeight: '800' },
  peekInfo: { flex: 1, gap: 2 },
  peekLine: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '600' },
  peekSub: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '600' },

  tabs: { flexDirection: 'row', marginHorizontal: Spacing.four, borderRadius: Radius.md, borderWidth: 1, padding: 3, gap: 3 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, alignItems: 'center' },
  tabText: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700' },
});
