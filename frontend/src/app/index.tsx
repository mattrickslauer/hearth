import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AuthMenu } from '@/components/auth-menu';
import { ArchDiagram } from '@/components/landing/arch-diagram';
import { DescribeDemo } from '@/components/landing/describe-demo';
import { FlameMark } from '@/components/landing/flame-mark';
import { ReasoningTrace } from '@/components/landing/reasoning-trace';
import {
  Card,
  EmberButton,
  Eyebrow,
  GlowOrb,
  Hairline,
  Pill,
  SectionHeading,
  Wordmark,
  useResponsive,
} from '@/components/landing/ui';
import { Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const REPO_URL = 'https://github.com/mattrickslauer/hearth';

const PILLARS = [
  {
    icon: '✍️',
    title: 'Describe it — it configures',
    body: 'You write a wish, not a rule. Qwen reads what your home can sense and do, then synthesizes the whole deployment: which sensors to bind, the logic, the action. That’s program synthesis — not a settings form.',
  },
  {
    icon: '🧠',
    title: 'It reasons about the real world',
    body: 'When something happens, Qwen judges the actual situation instead of firing a dumb threshold. With a camera, Qwen-VL understands the scene — open-vocabulary, no training, no fixed list of objects.',
  },
  {
    icon: '📡',
    title: 'It keeps running when the link dies',
    body: 'Simple watches are compiled to run locally on your hub, so they keep firing offline. Reconnect, and Hearth tells you exactly what happened while you were dark.',
  },
];

const WHY = [
  {
    tag: 'Authoring',
    title: 'Your words → a working deployment',
    body: '“Tell me if someone who isn’t family is at the door.” Qwen binds the camera and the RFID tags, writes the trigger, picks the action, decides when to escalate. A script can’t turn an open-ended wish into a config.',
  },
  {
    tag: 'Runtime',
    title: 'Judgment in the moment',
    body: 'Is this person a household member? Is this even worth interrupting you for? What does this mix of signals actually mean? Qwen-VL answers that from the live frame — something no local threshold can do.',
  },
];

const OLD_WAY = [
  'if-this-then-that',
  'YAML config',
  'threshold sliders',
  'automation “recipes”',
  'trigger / condition / action',
  'rule priorities',
];

export default function HomeScreen() {
  const theme = useTheme();
  const { isWide, isNarrow, gutter } = useResponsive();
  const scrollRef = useRef<ScrollView>(null);
  const [reasonY, setReasonY] = useState(0);

  const scrollToReason = () =>
    scrollRef.current?.scrollTo({ y: Math.max(0, reasonY - 40), animated: true });

  const h1 = isWide ? 62 : isNarrow ? 38 : 50;
  const h1lh = h1 + 6;
  const bandPad = isWide ? Spacing.six : Spacing.five;
  const isDark = theme.background === '#12100D';

  const content = {
    width: '100%' as const,
    maxWidth: MaxContentWidth,
    alignSelf: 'center' as const,
  };
  const pad = { paddingHorizontal: gutter };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ backgroundColor: theme.background }}
      showsVerticalScrollIndicator={false}>
      {/* ============================================================ NAV */}
      <View style={[pad, styles.navWrap]}>
        <View style={[content, styles.nav]}>
          <Wordmark size={26} />
          <View style={styles.navRight}>
            {isWide ? (
              <Pill dotColor={theme.ember} tone="ember">
                Built on Qwen Cloud
              </Pill>
            ) : null}
            <EmberButton label="Live demo" trailing="→" href="/demo" />
            <AuthMenu align="right" width={210} />
          </View>
        </View>
      </View>

      {/* =========================================================== HERO */}
      <View style={[pad, { paddingTop: isWide ? Spacing.five : Spacing.four, paddingBottom: bandPad }]}>
        {/* ambient ember glows */}
        <GlowOrb size={620} color={theme.emberGlow} intensity={isDark ? 1 : 0.85} style={styles.heroGlowA} />
        <GlowOrb size={420} color={theme.emberGlow} intensity={isDark ? 0.9 : 0.6} style={styles.heroGlowB} />

        <View
          style={[
            content,
            {
              flexDirection: isWide ? 'row' : 'column',
              gap: isWide ? Spacing.six : Spacing.five,
              alignItems: isWide ? 'center' : 'stretch',
            },
          ]}>
          {/* copy */}
          <View style={{ flex: isWide ? 1.05 : undefined, gap: Spacing.four }}>
            <Pill dotColor={theme.success}>Open-source · AI-native home</Pill>
            <Text style={[styles.h1, { color: theme.text, fontSize: h1, lineHeight: h1lh }]}>
              Describe your home in plain words.{'\n'}
              <Text style={{ color: theme.ember }}>It figures out the rest.</Text>
            </Text>
            <Text style={[styles.lead, { color: theme.textSecondary, maxWidth: 560 }]}>
              No rules. No YAML. No if-this-then-that. You say what you want — Hearth wires up your
              sensors, reasons about the real world as it runs, and acts. The 99% who never
              automated anything, finally can.
            </Text>
            <View style={[styles.ctaRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
              <EmberButton label="Try the live demo" trailing="→" href="/demo" size="lg" />
              <EmberButton
                label="Watch it reason"
                trailing="↓"
                variant="ghost"
                size="lg"
                onPress={scrollToReason}
              />
            </View>
            <Text style={[styles.trust, { color: theme.textMuted }]}>
              No sign-up · runs in your browser · zero hardware needed
            </Text>
          </View>

          {/* animated describe console */}
          <View style={{ flex: isWide ? 1 : undefined }}>
            <DescribeDemo />
          </View>
        </View>
      </View>

      {/* ======================================================== PROBLEM */}
      <View style={[pad, { paddingVertical: bandPad }]}>
        <View style={content}>
          <SectionHeading
            kicker="The problem"
            title="You shouldn’t have to"
            emberWord="program your home."
            subtitle="Automating anything today means becoming a part-time programmer. That’s why almost nobody does it. Hearth deletes the rule engine and replaces it with an agent that understands you."
            maxWidth={720}
          />
          <View style={[styles.contrast, { flexDirection: isNarrow ? 'column' : 'row' }]}>
            <Card style={{ flex: 1 }}>
              <Eyebrow color={theme.textMuted}>The old way</Eyebrow>
              <View style={styles.chipWrap}>
                {OLD_WAY.map((c) => (
                  <View
                    key={c}
                    style={[
                      styles.deadChip,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                    ]}>
                    <Text style={[styles.deadChipText, { color: theme.textMuted }]}>{c}</Text>
                  </View>
                ))}
              </View>
            </Card>
            <Card style={{ flex: 1 }} glow>
              <Eyebrow>The Hearth way</Eyebrow>
              <Text style={[styles.hearthWay, { color: theme.text }]}>
                “Warn me if the garage is open after dark and it’s cold — and turn on the heater.”
              </Text>
              <Text style={[styles.hearthWaySub, { color: theme.textSecondary }]}>
                That’s the whole configuration. You just say it.
              </Text>
            </Card>
          </View>
        </View>
      </View>

      {/* ======================================================== PILLARS */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="What makes it different"
            title="A home that understands,"
            emberWord="not one you configure."
            maxWidth={640}
          />
          <View style={[styles.pillars, { flexDirection: isWide ? 'row' : 'column' }]}>
            {PILLARS.map((p, i) => (
              <Animated.View
                key={p.title}
                entering={FadeInDown.duration(420).delay(i * 90)}
                style={{ flex: 1 }}>
                <Card style={{ flex: 1 }} elevated>
                  <View
                    style={[
                      styles.pillarIcon,
                      { backgroundColor: theme.emberGlow, borderColor: theme.border },
                    ]}>
                    <Text style={{ fontSize: 22 }}>{p.icon}</Text>
                  </View>
                  <Text style={[styles.pillarTitle, { color: theme.text }]}>{p.title}</Text>
                  <Text style={[styles.pillarBody, { color: theme.textSecondary }]}>{p.body}</Text>
                </Card>
              </Animated.View>
            ))}
          </View>
        </View>
      </View>

      {/* ====================================================== REASONING */}
      <View
        onLayout={(e: LayoutChangeEvent) => setReasonY(e.nativeEvent.layout.y)}
        style={[pad, { paddingVertical: bandPad }]}>
        <View
          style={[
            content,
            {
              flexDirection: isWide ? 'row' : 'column',
              gap: Spacing.six,
              alignItems: isWide ? 'center' : 'stretch',
            },
          ]}>
          <View style={{ flex: 1 }}>
            <SectionHeading
              kicker="The wow"
              title="It’s an agent,"
              emberWord="not a sensor."
              subtitle="Every alert carries Qwen’s plain-language reasoning — why it fired, and what it did to be sure. A motion alarm beeps. Hearth explains itself."
            />
          </View>
          <View style={{ flex: 1 }}>
            <ReasoningTrace />
          </View>
        </View>
      </View>

      {/* ================================================== ARCHITECTURE */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="How it works"
            title="Three tiers."
            emberWord="One conversation."
            subtitle="Cheap self-describing nodes sense and act. A hub on-site orchestrates them and guards your privacy. Qwen Cloud does the two things no rule engine can — and the raw video never leaves the house."
            maxWidth={760}
          />
          <View style={{ marginTop: Spacing.five }}>
            <ArchDiagram />
          </View>
        </View>
      </View>

      {/* ========================================================= WHY AI */}
      <View style={[pad, { paddingVertical: bandPad }]}>
        <View style={content}>
          <SectionHeading
            kicker="The test we hold every feature to"
            title="Why an AI, and not a"
            emberWord="50-line script?"
            subtitle="Would this be meaningfully worse if we deleted the AI and dropped in a script? For a rule engine, no. For Hearth — emphatically yes. Qwen is load-bearing in two places a script can’t touch."
            maxWidth={760}
          />
          <View style={[styles.whyRow, { flexDirection: isWide ? 'row' : 'column' }]}>
            {WHY.map((w) => (
              <Card key={w.tag} style={{ flex: 1 }} elevated>
                <View
                  style={[
                    styles.whyTag,
                    { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow },
                  ]}>
                  <Text style={[styles.whyTagText, { color: theme.ember }]}>{w.tag}</Text>
                </View>
                <Text style={[styles.pillarTitle, { color: theme.text }]}>{w.title}</Text>
                <Text style={[styles.pillarBody, { color: theme.textSecondary }]}>{w.body}</Text>
              </Card>
            ))}
          </View>
        </View>
      </View>

      {/* ======================================================== PRIVACY */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="Privacy by design"
            title="Your home’s raw senses"
            emberWord="never leave home."
            subtitle="The agent loop runs on your hub, so raw video and audio stay put. Only a minimized, redacted payload is ever sent — and only when something actually happens."
            maxWidth={720}
          />
          <View style={[styles.privacyRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
            <Card style={{ flex: 1 }}>
              <View style={styles.privacyHead}>
                <Text style={{ fontSize: 16 }}>🎥</Text>
                <Text style={[styles.privacyLabel, { color: theme.text }]}>Raw frame</Text>
                <View style={[styles.locChip, { backgroundColor: theme.success + '22' }]}>
                  <Text style={[styles.locChipText, { color: theme.success }]}>stays on hub</Text>
                </View>
              </View>
              <View style={[styles.frameStub, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
                <Text style={[styles.frameStubText, { color: theme.textMuted }]}>
                  1920×1080 · full scene · faces · plates · house number
                </Text>
              </View>
            </Card>

            <View style={styles.privacyArrow}>
              <Text style={{ color: theme.ember, fontSize: 22, fontWeight: '700' }}>
                {isNarrow ? '↓' : '→'}
              </Text>
            </View>

            <Card style={{ flex: 1 }} glow>
              <View style={styles.privacyHead}>
                <Text style={{ fontSize: 16 }}>🔒</Text>
                <Text style={[styles.privacyLabel, { color: theme.text }]}>Sent to cloud</Text>
                <View style={[styles.locChip, { backgroundColor: theme.emberGlow }]}>
                  <Text style={[styles.locChipText, { color: theme.ember }]}>minimized</Text>
                </View>
              </View>
              <View style={[styles.frameStub, { backgroundColor: theme.codeBg, borderColor: theme.borderStrong }]}>
                <Text style={[styles.frameStubText, { color: theme.textSecondary }]}>
                  cropped to the doorway · face box only · identities hashed
                </Text>
              </View>
            </Card>
          </View>
        </View>
      </View>

      {/* ============================================================ CTA */}
      <View style={[pad, { paddingVertical: isWide ? Spacing.six : Spacing.five }]}>
        <View style={content}>
          <View style={[styles.ctaPanel, { backgroundColor: theme.card, borderColor: theme.borderStrong }]}>
            <GlowOrb size={520} color={theme.emberGlow} style={styles.ctaGlow} />
            <FlameMark size={44} />
            <Text
              style={[
                styles.ctaTitle,
                { color: theme.text, fontSize: isNarrow ? 30 : 42, lineHeight: isNarrow ? 36 : 48 },
              ]}>
              Clone it, and go{'\n'}
              <Text style={{ color: theme.ember }}>talk to your house.</Text>
            </Text>
            <Text style={[styles.lead, { color: theme.textSecondary, textAlign: 'center', maxWidth: 540 }]}>
              Hearth is open source and runs in your browser against a simulated home. No hardware,
              no sign-up — just describe something and watch it wire itself up.
            </Text>
            <View
              style={[
                styles.ctaRow,
                { flexDirection: isNarrow ? 'column' : 'row', justifyContent: 'center' },
              ]}>
              <EmberButton label="Try the live demo" trailing="→" href="/demo" size="lg" />
              <EmberButton
                label="View on GitHub"
                variant="ghost"
                size="lg"
                onPress={() => Linking.openURL(REPO_URL)}
              />
            </View>
          </View>
        </View>
      </View>

      {/* ========================================================= FOOTER */}
      <View style={[pad, { paddingBottom: Spacing.six, paddingTop: Spacing.four }]}>
        <View style={content}>
          <Hairline style={{ marginBottom: Spacing.four }} />
          <View style={[styles.footer, { flexDirection: isNarrow ? 'column' : 'row' }]}>
            <View style={{ gap: Spacing.two, flex: 1 }}>
              <Wordmark size={22} />
              <Text style={[styles.footNote, { color: theme.textMuted }]}>
                Describe your home in plain words. It figures out the rest.
              </Text>
            </View>
            <View style={styles.footLinks}>
              <FooterLink label="Live demo" href="/demo" />
              <FooterLink label="GitHub" onPress={() => Linking.openURL(REPO_URL)} />
            </View>
          </View>
          <Text style={[styles.copyright, { color: theme.textMuted }]}>
            “Hearth” is a working name · Open source (MIT) · Built on Qwen Cloud for the EdgeAgent
            track.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function FooterLink({ label, onPress, href }: { label: string; onPress?: () => void; href?: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Text
      onPress={onPress ?? (() => href && router.push(href as never))}
      accessibilityRole="link"
      style={[styles.footLink, { color: theme.textSecondary }]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  navWrap: {
    paddingTop: Platform.select({ web: Spacing.four, default: Spacing.five }),
    paddingBottom: Spacing.three,
    // Own stacking context above later sections (hero, etc.) so the account
    // menu's popover opens over them instead of being painted/clicked through.
    zIndex: 30,
  },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  heroGlowA: { position: 'absolute', top: -180, right: -120 },
  heroGlowB: { position: 'absolute', top: 120, left: -160 },

  h1: { fontFamily: Fonts?.sans, fontWeight: '800', letterSpacing: -1.4 },
  lead: { fontFamily: Fonts?.sans, fontSize: 18, lineHeight: 28, fontWeight: '400' },
  ctaRow: { gap: Spacing.three, alignItems: 'stretch', flexWrap: 'wrap' },
  trust: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '500', letterSpacing: 0.2 },

  contrast: { gap: Spacing.four, marginTop: Spacing.five },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  deadChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.sm, borderWidth: 1 },
  deadChipText: {
    fontFamily: Fonts?.mono,
    fontSize: 12.5,
    fontWeight: '500',
    textDecorationLine: 'line-through',
  },
  hearthWay: {
    fontFamily: Fonts?.sans,
    fontSize: 21,
    lineHeight: 30,
    fontWeight: '600',
    marginTop: Spacing.three,
  },
  hearthWaySub: { fontFamily: Fonts?.sans, fontSize: 15, marginTop: Spacing.two },

  pillars: { gap: Spacing.four, marginTop: Spacing.five, alignItems: 'stretch' },
  pillarIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  pillarTitle: {
    fontFamily: Fonts?.sans,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  pillarBody: { fontFamily: Fonts?.sans, fontSize: 15, lineHeight: 23 },

  whyRow: { gap: Spacing.four, marginTop: Spacing.five, alignItems: 'stretch' },
  whyTag: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  whyTagText: {
    fontFamily: Fonts?.mono,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  privacyRow: { gap: Spacing.three, marginTop: Spacing.five, alignItems: 'center' },
  privacyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  privacyLabel: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', flex: 1 },
  locChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: Radius.pill },
  locChipText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  frameStub: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    padding: Spacing.three,
    minHeight: 74,
    justifyContent: 'center',
  },
  frameStubText: { fontFamily: Fonts?.mono, fontSize: 13, lineHeight: 20 },
  privacyArrow: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.one },

  ctaPanel: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    gap: Spacing.four,
    overflow: 'hidden',
  },
  ctaGlow: { position: 'absolute', top: -220, alignSelf: 'center' },
  ctaTitle: { fontFamily: Fonts?.sans, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },

  footer: { alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.four },
  footNote: { fontFamily: Fonts?.sans, fontSize: 14 },
  footLinks: { flexDirection: 'row', gap: Spacing.four, alignItems: 'center', flexWrap: 'wrap' },
  footLink: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '600' },
  copyright: { fontFamily: Fonts?.sans, fontSize: 13, marginTop: Spacing.four, lineHeight: 20 },
});
