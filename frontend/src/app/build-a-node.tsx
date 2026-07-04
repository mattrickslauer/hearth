import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
const FIRMWARE_URL = `${REPO_URL}/tree/main/firmware`;
const CONFIG_URL = `${REPO_URL}/blob/main/firmware/include/config.h`;
const README_URL = `${REPO_URL}/blob/main/firmware/README.md`;

const DESCRIBE_JSON = `DESCRIBE {"type":"hearth.node.describe",
  "id":"node-A1B2C3D4E5F6","fw":"0.1.0","board":"esp32-wroom-32",
  "sensors":[
    {"key":"board.temp","kind":"temperature","unit":"C","wiring":"builtin"},
    {"key":"dht.temp","kind":"temperature","unit":"C","pin":4},
    {"key":"dht.humidity","kind":"humidity","unit":"pct","pin":4}]}`;

const READING_JSON = `READING {"type":"hearth.node.reading",
  "id":"node-A1B2C3D4E5F6","uptime_ms":5021,
  "readings":{"board.temp":48.9,"dht.temp":null,"dht.humidity":null}}`;

const FLASH_DOCKER = `docker run --rm --device=/dev/ttyUSB0 -v "$PWD":/w -w /w \\
  -v hearth-pio:/root/.platformio python:3.13-slim \\
  bash -lc 'pip install -q platformio && pio run -t upload'`;

const FLASH_NATIVE = `pio run -t upload      # compile + flash
pio device monitor     # watch it talk (115200 baud)`;

const STEPS = [
  {
    n: '1',
    title: 'Get a board',
    body: 'Any ESP32-WROOM-32 dev board plus a USB cable. That is the entire bill of materials for a first real reading — no breadboard, no wiring.',
  },
  {
    n: '2',
    title: 'Flash the firmware',
    body: 'One Docker command builds and flashes it. The board reboots straight into the Hearth node — no Arduino IDE, no host toolchain to install.',
  },
  {
    n: '3',
    title: 'It introduces itself',
    body: 'On boot it prints a DESCRIBE doc — who it is and what it can measure — then streams a READING every few seconds. It works the instant it is flashed.',
  },
  {
    n: '4',
    title: 'It finds your hub',
    body: 'Set Wi-Fi in config.h and the node discovers the hub over mDNS, then POSTs its readings. No address to configure; absent sensors report null, which is itself signal.',
  },
];

export default function BuildANodeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isWide, isNarrow, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const isDark = theme.background === '#12100D';
  const navPadTop = (Platform.OS === 'web' ? Spacing.four : Spacing.five) + insets.top;
  const bandPad = isWide ? Spacing.six : Spacing.five;
  const h1 = isWide ? 54 : isNarrow ? 34 : 44;

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
      <View style={[pad, styles.navWrap, { paddingTop: navPadTop }]}>
        <View style={[content, styles.nav]}>
          <Text onPress={() => router.push('/')} accessibilityRole="link">
            <Wordmark size={isNarrow ? 22 : 26} />
          </Text>
          <View style={styles.navRight}>
            {isWide ? <Pill dotColor={theme.success}>Open hardware</Pill> : null}
            <EmberButton
              label="Firmware on GitHub"
              trailing="↗"
              variant="ghost"
              onPress={() => Linking.openURL(FIRMWARE_URL)}
            />
          </View>
        </View>
      </View>

      {/* =========================================================== HERO */}
      <View style={[pad, { paddingTop: isWide ? Spacing.five : Spacing.four, paddingBottom: bandPad, overflow: 'hidden' }]}>
        <GlowOrb size={isNarrow ? 360 : 600} color={theme.emberGlow} intensity={isDark ? 1 : 0.85} style={styles.heroGlow} />
        <View style={[content, { gap: Spacing.four }]}>
          <Pill dotColor={theme.ember} tone="ember">
            Build your own node
          </Pill>
          <Text style={[styles.h1, { color: theme.text, fontSize: h1, lineHeight: h1 + 6, maxWidth: 780 }]}>
            A $6 board that{'\n'}
            <Text style={{ color: theme.ember }}>describes itself.</Text>
          </Text>
          <Text style={[styles.lead, { color: theme.textSecondary, maxWidth: 620 }]}>
            Hearth nodes are open-source ESP32 firmware. Flash one and it announces what it is and
            what it can measure, then streams readings as line-delimited JSON — over USB, and
            (optionally) to your hub. It gives a real reading on a bare board with nothing wired,
            using the ESP32&rsquo;s built-in chip-temperature sensor.
          </Text>
          <View style={[styles.ctaRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
            <EmberButton
              label="Get the firmware"
              trailing="↗"
              size="lg"
              onPress={() => Linking.openURL(FIRMWARE_URL)}
            />
            <EmberButton
              label="Read the full guide"
              trailing="↗"
              variant="ghost"
              size="lg"
              onPress={() => Linking.openURL(README_URL)}
            />
          </View>
        </View>
      </View>

      {/* ========================================================== STEPS */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="From box to first reading"
            title="Four steps,"
            emberWord="no soldering."
            maxWidth={640}
          />
          <View style={[styles.grid, { flexDirection: isWide ? 'row' : 'column' }]}>
            {STEPS.map((s) => (
              <Card key={s.n} style={{ flex: 1 }} elevated>
                <View style={[styles.stepNum, { backgroundColor: theme.emberGlow, borderColor: theme.border }]}>
                  <Text style={[styles.stepNumText, { color: theme.ember }]}>{s.n}</Text>
                </View>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{s.title}</Text>
                <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{s.body}</Text>
              </Card>
            ))}
          </View>
        </View>
      </View>

      {/* ====================================================== WHAT IT EMITS */}
      <View style={[pad, { paddingVertical: bandPad }]}>
        <View style={content}>
          <SectionHeading
            kicker="The self-describe contract"
            title="It tells the network"
            emberWord="what it is."
            subtitle="No central registry of device types. On boot a node announces its own sensor menu; the hub and the agent learn what a home can sense straight from the wire."
            maxWidth={720}
          />
          <View style={[styles.grid, { flexDirection: isWide ? 'row' : 'column', marginTop: Spacing.five }]}>
            <View style={{ flex: 1, gap: Spacing.two }}>
              <Text style={[styles.codeLabel, { color: theme.textMuted }]}>On boot — a self-description</Text>
              <CodeBlock text={DESCRIBE_JSON} />
            </View>
            <View style={{ flex: 1, gap: Spacing.two }}>
              <Text style={[styles.codeLabel, { color: theme.textMuted }]}>Every few seconds — a reading</Text>
              <CodeBlock text={READING_JSON} />
            </View>
          </View>
        </View>
      </View>

      {/* ======================================================== HARDWARE */}
      <View style={[pad, { paddingVertical: bandPad, backgroundColor: theme.backgroundElement }]}>
        <View style={content}>
          <SectionHeading
            kicker="Hardware"
            title="One board is"
            emberWord="the whole kit."
            maxWidth={640}
          />
          <View style={[styles.grid, { flexDirection: isWide ? 'row' : 'column', marginTop: Spacing.five }]}>
            <Card style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Required</Text>
              <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
                An <Text style={{ color: theme.text }}>ESP32-WROOM-32</Text> dev board and a USB cable.
                A real reading needs nothing more — the built-in chip-temperature sensor works on a
                bare board.
              </Text>
            </Card>
            <Card style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Optional — a DHT11</Text>
              <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
                Add temperature + humidity: data &rarr; <Text style={{ color: theme.text }}>GPIO4</Text>,
                {' '}+ &rarr; 3V3, &minus; &rarr; GND. A 4.7&ndash;10 k&Omega; pull-up between data and
                3V3 improves reliability. Set the pin to <Text style={{ color: theme.text }}>-1</Text> to
                disable it.
              </Text>
            </Card>
          </View>
        </View>
      </View>

      {/* ==================================================== BUILD & FLASH */}
      <View style={[pad, { paddingVertical: bandPad }]}>
        <View style={content}>
          <SectionHeading
            kicker="Build &amp; flash"
            title="Reproducible,"
            emberWord="zero host toolchain."
            subtitle="Flash it through Docker with the board on /dev/ttyUSB0 — the hearth-pio named volume caches the toolchain so re-flashes are fast."
            maxWidth={720}
          />
          <View style={{ marginTop: Spacing.five, gap: Spacing.four }}>
            <View style={{ gap: Spacing.two }}>
              <Text style={[styles.codeLabel, { color: theme.textMuted }]}>Via Docker — nothing to install</Text>
              <CodeBlock text={FLASH_DOCKER} />
            </View>
            <View style={{ gap: Spacing.two }}>
              <Text style={[styles.codeLabel, { color: theme.textMuted }]}>
                Natively, if you have PlatformIO
              </Text>
              <CodeBlock text={FLASH_NATIVE} />
            </View>
          </View>
          <Card style={{ marginTop: Spacing.five }} glow>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Configure once, in one file</Text>
            <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
              Everything you would change — Wi-Fi SSID/password, the hub endpoint fallback, the DHT
              pin, the sample interval — lives in{' '}
              <Text
                onPress={() => Linking.openURL(CONFIG_URL)}
                style={{ color: theme.ember, fontFamily: Fonts?.mono }}
                accessibilityRole="link">
                include/config.h
              </Text>
              . Out of the box Wi-Fi is empty, so it runs serial-only — no network or account needed
              for a first reading. The node discovers the hub automatically over mDNS; you never
              configure an address.
            </Text>
          </Card>
        </View>
      </View>

      {/* ============================================================ CTA */}
      <View style={[pad, { paddingVertical: isWide ? Spacing.six : Spacing.five }]}>
        <View style={content}>
          <View style={[styles.ctaPanel, { backgroundColor: theme.card, borderColor: theme.borderStrong }]}>
            <GlowOrb size={480} color={theme.emberGlow} style={styles.ctaGlow} />
            <SectionHeading
              title="Flash one, and watch it"
              emberWord="join your home."
              align="center"
              maxWidth={560}
            />
            <Text style={[styles.lead, { color: theme.textSecondary, textAlign: 'center', maxWidth: 540 }]}>
              The firmware is open source (MIT). Clone it, flash a spare ESP32, and it shows up on
              your hub — describing itself and streaming readings within seconds.
            </Text>
            <View style={[styles.ctaRow, { flexDirection: isNarrow ? 'column' : 'row', justifyContent: 'center' }]}>
              <EmberButton label="Get the firmware" trailing="↗" size="lg" onPress={() => Linking.openURL(FIRMWARE_URL)} />
              <EmberButton label="Run your own hub" trailing="→" variant="ghost" size="lg" href="/" />
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
                Cheap, self-describing nodes sense and act. This is how you make one.
              </Text>
            </View>
            <View style={styles.footLinks}>
              <Text
                onPress={() => router.push('/')}
                accessibilityRole="link"
                style={[styles.footLink, { color: theme.textSecondary }]}>
                Home
              </Text>
              <Text
                onPress={() => Linking.openURL(FIRMWARE_URL)}
                accessibilityRole="link"
                style={[styles.footLink, { color: theme.textSecondary }]}>
                Firmware source
              </Text>
              <Text
                onPress={() => Linking.openURL(REPO_URL)}
                accessibilityRole="link"
                style={[styles.footLink, { color: theme.textSecondary }]}>
                GitHub
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function CodeBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.codeBlock, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      <Text selectable style={[styles.codeText, { color: theme.textSecondary }]}>
        {text}
      </Text>
    </View>
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

  heroGlow: { position: 'absolute', top: -180, right: -120 },

  h1: { fontFamily: Fonts?.sans, fontWeight: '800', letterSpacing: -1.2 },
  lead: { fontFamily: Fonts?.sans, fontSize: 18, lineHeight: 28, fontWeight: '400' },
  ctaRow: { gap: Spacing.three, alignItems: 'stretch', flexWrap: 'wrap' },

  grid: { gap: Spacing.four, marginTop: Spacing.five, alignItems: 'stretch' },
  stepNum: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  stepNumText: { fontFamily: Fonts?.mono, fontSize: 18, fontWeight: '800' },
  cardTitle: {
    fontFamily: Fonts?.sans,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardBody: { fontFamily: Fonts?.sans, fontSize: 15, lineHeight: 23 },

  codeLabel: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  codeBlock: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    padding: Spacing.three,
  },
  codeText: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 19 },

  ctaPanel: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    gap: Spacing.four,
    overflow: 'hidden',
  },
  ctaGlow: { position: 'absolute', top: -200, alignSelf: 'center' },

  footer: { alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.four },
  footNote: { fontFamily: Fonts?.sans, fontSize: 14, maxWidth: 360 },
  footLinks: { flexDirection: 'row', gap: Spacing.four, alignItems: 'center', flexWrap: 'wrap' },
  footLink: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '600' },
});
