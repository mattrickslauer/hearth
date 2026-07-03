import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityFeed } from '@/components/demo/activity-feed';
import { DescribeConsole } from '@/components/demo/describe-console';
import { FloorPlan } from '@/components/demo/floor-plan';
import { HomeView } from '@/components/demo/home-view';
import { MobileDemo } from '@/components/demo/mobile-demo';
import { PushToast } from '@/components/demo/push-toast';
import { TopBar } from '@/components/demo/top-bar';
import { GlowOrb } from '@/components/landing/ui';
import { Spacing } from '@/constants/theme';
import { useSimulation } from '@/demo/use-simulation';
import { useTheme } from '@/hooks/use-theme';

const LEFT_W = 360;
const RIGHT_W = 360;
const GUT = Spacing.four;

export default function DemoScreen() {
  const theme = useTheme();
  const sim = useSimulation();
  const { width } = useWindowDimensions();

  // Phone: full-screen floor plan + a tap-toggle bottom sheet.
  const mobile = width < 760;
  // Overlay ("HUD") layout needs room for both side panels + a legible home.
  const overlay = width >= 1120;
  const isDark = theme.background === '#12100D';
  const fullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;

  if (mobile) return <MobileDemo sim={sim} />;

  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.background }, fullHeight]}>
      <TopBar sim={sim} compact={!overlay} />

      {overlay ? (
        <View style={styles.stage}>
          <GlowOrb size={620} color={theme.emberGlow} intensity={isDark ? 0.9 : 0.6} style={styles.glow} />

          {/* the home — a birds-eye floor plan the panels float over */}
          <View style={styles.homeWrap}>
            <FloorPlan sim={sim} />
          </View>

          {/* floating overlays */}
          <View style={[styles.panel, styles.leftPanel]}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.panelScroll}>
              <DescribeConsole sim={sim} />
            </ScrollView>
          </View>

          <View style={[styles.panel, styles.rightPanel]}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.panelScroll}>
              <ActivityFeed events={sim.activity} />
            </ScrollView>
          </View>

          <PushToast text={sim.push?.text ?? null} />
        </View>
      ) : (
        // Narrow fallback: stacked + scrollable (settings still live in the TopBar).
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: GUT, gap: GUT, paddingBottom: Spacing.six }}
            showsVerticalScrollIndicator={false}>
            <DescribeConsole sim={sim} />
            <HomeView world={sim.world} />
            <ActivityFeed events={sim.activity} />
          </ScrollView>
          <PushToast text={sim.push?.text ?? null} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, position: 'relative', overflow: 'hidden' },
  scroll: { flex: 1 },
  glow: { position: 'absolute', top: -160, alignSelf: 'center' },
  homeWrap: {
    position: 'absolute',
    top: GUT,
    bottom: GUT,
    left: LEFT_W + GUT * 2,
    right: RIGHT_W + GUT * 2,
  },
  panel: { position: 'absolute', top: GUT, bottom: GUT },
  leftPanel: { left: GUT, width: LEFT_W },
  rightPanel: { right: GUT, width: RIGHT_W },
  panelScroll: { paddingBottom: Spacing.two },
});
