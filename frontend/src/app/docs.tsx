import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMenu } from '@/components/auth-menu';
import {
  Card,
  EmberButton,
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
const DOCS_URL = `${REPO_URL}/tree/main/docs`;

/** Top-level docs, each pointing at the canonical source under /docs on GitHub. */
const SECTIONS = [
  {
    icon: '🧭',
    title: 'Capabilities',
    body: 'What Hearth is, the problem it deletes, and the bar every feature has to clear — “would this be worse if we swapped the AI for a script?”',
    href: `${REPO_URL}/blob/main/docs/00-capabilities.md`,
  },
  {
    icon: '☁️',
    title: 'Infrastructure',
    body: 'How the three tiers run on Alibaba Cloud — the Function Compute backend, Qwen Cloud, and the on-site hub that never lets raw video leave the house.',
    href: `${REPO_URL}/blob/main/docs/01-infra-alibaba-cloud.md`,
  },
  {
    icon: '🗂️',
    title: 'Data model',
    body: 'The objects the whole system is built on — homes, hubs, self-describing nodes, sensors, watches, and the run log that meters every Look.',
    href: `${REPO_URL}/blob/main/docs/02-data-model.md`,
  },
  {
    icon: '🧠',
    title: 'Agent & MCP surface',
    body: 'The tools Qwen is handed, how a plain-language wish is compiled into a deployment, and the MCP surface the agent reasons over.',
    href: `${REPO_URL}/blob/main/docs/03-agent-mcp-surface.md`,
  },
  {
    icon: '⚙️',
    title: 'Rule engine',
    body: 'How a described watch is compiled to something that keeps firing locally on your hub when the cloud link dies — and reconciles when it comes back.',
    href: `${REPO_URL}/blob/main/docs/04-rule-engine.md`,
  },
  {
    icon: '🎨',
    title: 'UX',
    body: 'The design language — describe-first authoring, reasoning traces on every alert, and the privacy-by-design flow from raw frame to minimized payload.',
    href: `${REPO_URL}/blob/main/docs/05-ux.md`,
  },
];

/** Fast paths people usually want first. */
const QUICKSTART = [
  {
    tag: 'Run it',
    title: 'Try the live demo',
    body: 'No sign-up, no hardware — describe something in your browser and watch it wire itself up against a simulated home.',
    label: 'Open the demo',
    href: '/demo',
    trailing: '→',
  },
  {
    tag: 'Build it',
    title: 'Flash a real node',
    body: 'Any ESP32 and a USB cable. One Docker command and the board boots straight into a self-describing Hearth node.',
    label: 'Build a node',
    href: '/build-a-node',
    trailing: '→',
  },
];

export default function DocsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isWide, isNarrow, gutter } = useResponsive();
  const insets = useSafeAreaInsets();

  const isDark = theme.background === '#12100D';
  const bandPad = isWide ? Spacing.six : Spacing.five;
  const navPadTop = (Platform.OS === 'web' ? Spacing.four : Spacing.five) + insets.top;

  const content = {
    width: '100%' as const,
    maxWidth: MaxContentWidth,
    alignSelf: 'center' as const,
  };
  const pad = { paddingHorizontal: gutter };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ backgroundColor: theme.background }}
      showsVerticalScrollIndicator={false}>
      {/* ============================================================ NAV */}
      <View style={[pad, styles.navWrap, { paddingTop: navPadTop }]}>
        <View style={[content, styles.nav]}>
          <Pressable onPress={() => router.push('/' as never)} accessibilityRole="link">
            <Wordmark size={isNarrow ? 22 : 26} />
          </Pressable>
          <View style={styles.navRight}>
            {isWide ? (
              <Pill dotColor={theme.ember} tone="ember">
                Docs
              </Pill>
            ) : null}
            {!isNarrow ? <EmberButton label="Live demo" trailing="→" href="/demo" /> : null}
            <AuthMenu align="right" width={210} />
          </View>
        </View>
      </View>

      {/* ========================================================== HEADER */}
      <View style={[pad, { paddingTop: isWide ? Spacing.five : Spacing.four, paddingBottom: bandPad, overflow: 'hidden' }]}>
        <GlowOrb
          size={isNarrow ? 340 : 560}
          color={theme.emberGlow}
          intensity={isDark ? 1 : 0.85}
          style={styles.headerGlow}
        />
        <View style={content}>
          <Pill dotColor={theme.success}>Open source · MIT</Pill>
          <Text style={[styles.h1, { color: theme.text, fontSize: isWide ? 52 : isNarrow ? 34 : 44 }]}>
            Documentation
          </Text>
          <Text style={[styles.lead, { color: theme.textSecondary, maxWidth: 620 }]}>
            Everything behind Hearth — the architecture, the data model, and the agent that turns a
            plain-language wish into a working home. Start with the demo, then read how it works.
          </Text>
          <View style={[styles.ctaRow, { flexDirection: isNarrow ? 'column' : 'row', marginTop: Spacing.two }]}>
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

      {/* ====================================================== QUICKSTART */}
      <View style={[pad, { paddingVertical: bandPad }]}>
        <View style={content}>
          <SectionHeading kicker="Start here" title="Get running in" emberWord="a minute." maxWidth={640} />
          <View style={[styles.grid2, { flexDirection: isWide ? 'row' : 'column', marginTop: Spacing.five }]}>
            {QUICKSTART.map((q) => (
              <Card key={q.tag} style={{ flex: 1 }} glow>
                <View style={[styles.tag, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                  <Text style={[styles.tagText, { color: theme.ember }]}>{q.tag}</Text>
                </View>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{q.title}</Text>
                <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{q.body}</Text>
                <View style={{ marginTop: Spacing.four, alignItems: 'flex-start' }}>
                  <EmberButton label={q.label} trailing={q.trailing} href={q.href} />
                </View>
              </Card>
            ))}
          </View>
        </View>
      </View>

      {/* ======================================================= REFERENCE */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="Reference"
            title="Read how it"
            emberWord="actually works."
            subtitle="Each section links to the canonical design doc in the repo. They’re the same docs the system was built from."
            maxWidth={720}
          />
          <View style={[styles.grid3, { marginTop: Spacing.five }]}>
            {SECTIONS.map((s) => (
              <Card key={s.title} style={styles.gridItem} elevated>
                <View style={[styles.iconWrap, { backgroundColor: theme.emberGlow, borderColor: theme.border }]}>
                  <Text style={{ fontSize: 22 }}>{s.icon}</Text>
                </View>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{s.title}</Text>
                <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{s.body}</Text>
                <Text
                  onPress={() => Linking.openURL(s.href)}
                  accessibilityRole="link"
                  style={[styles.readLink, { color: theme.ember }]}>
                  Read the doc →
                </Text>
              </Card>
            ))}
          </View>
          <View style={{ marginTop: Spacing.five, alignItems: 'flex-start' }}>
            <EmberButton
              label="Browse all docs on GitHub"
              trailing="→"
              variant="ghost"
              onPress={() => Linking.openURL(DOCS_URL)}
            />
          </View>
        </View>
      </View>

      {/* ========================================================= FOOTER */}
      <View style={[pad, { paddingBottom: Spacing.six, paddingTop: bandPad }]}>
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
              <FooterLink label="Home" href="/" />
              <FooterLink label="Live demo" href="/demo" />
              <FooterLink label="Build a node" href="/build-a-node" />
              <FooterLink label="GitHub" href={REPO_URL} />
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

function FooterLink({ label, href }: { label: string; href: string }) {
  const theme = useTheme();
  const router = useRouter();
  const external = href.startsWith('http');
  return (
    <Text
      onPress={() => (external ? Linking.openURL(href) : router.push(href as never))}
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
    zIndex: 30,
  },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  headerGlow: { position: 'absolute', top: -200, right: -120 },

  h1: {
    fontFamily: Fonts?.sans,
    fontWeight: '800',
    letterSpacing: -1.4,
    marginTop: Spacing.three,
    marginBottom: Spacing.three,
  },
  lead: { fontFamily: Fonts?.sans, fontSize: 18, lineHeight: 28, fontWeight: '400' },
  ctaRow: { gap: Spacing.three, alignItems: 'stretch', flexWrap: 'wrap' },

  grid2: { gap: Spacing.four, alignItems: 'stretch' },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  gridItem: { flexGrow: 1, flexBasis: 300, minWidth: 260 },

  tag: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  tagText: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  cardTitle: {
    fontFamily: Fonts?.sans,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardBody: { fontFamily: Fonts?.sans, fontSize: 15, lineHeight: 23 },
  readLink: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700', marginTop: Spacing.three },

  footer: { alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.four },
  footNote: { fontFamily: Fonts?.sans, fontSize: 14 },
  footLinks: { flexDirection: 'row', gap: Spacing.four, alignItems: 'center', flexWrap: 'wrap' },
  footLink: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '600' },
  copyright: { fontFamily: Fonts?.sans, fontSize: 13, marginTop: Spacing.four, lineHeight: 20 },
});
