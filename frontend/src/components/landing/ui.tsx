import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { EmberGradient, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { FlameMark } from './flame-mark';

/** Landing-wide responsive breakpoints. */
export function useResponsive() {
  const { width } = useWindowDimensions();
  return {
    width,
    isWide: width >= 900,
    isMid: width >= 640,
    isNarrow: width < 640,
    gutter: width < 640 ? Spacing.four : Spacing.five,
  };
}

/* ------------------------------------------------------------------ Glow */

/**
 * A soft ember glow. On web it's a true radial gradient; on native we fake the
 * falloff with concentric translucent rings (no blur dependency).
 */
export function GlowOrb({
  size,
  color,
  style,
  intensity = 1,
}: {
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  if (Platform.OS === 'web') {
    return (
      <View
        pointerEvents="none"
        style={[
          { width: size, height: size, borderRadius: size / 2 },
          {
            backgroundImage: `radial-gradient(closest-side, ${color}, transparent)`,
            opacity: intensity,
          } as object,
          style,
        ]}
      />
    );
  }
  const rings = [1, 0.62, 0.34];
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, styles.center, style]}>
      {rings.map((r, i) => (
        <View
          key={i}
          style={[
            styles.absCenter,
            {
              width: size * r,
              height: size * r,
              borderRadius: (size * r) / 2,
              backgroundColor: color,
              opacity: (0.16 + i * 0.14) * intensity,
            },
          ]}
        />
      ))}
    </View>
  );
}

/* --------------------------------------------------------------- Eyebrow */

export function Eyebrow({
  children,
  color,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text style={[styles.eyebrow, { color: color ?? theme.ember }, style]}>{children}</Text>
  );
}

/* ------------------------------------------------------------------ Pill */

export function Pill({
  children,
  dotColor,
  tone = 'default',
}: {
  children: ReactNode;
  dotColor?: string;
  tone?: 'default' | 'ember';
}) {
  const theme = useTheme();
  const isEmber = tone === 'ember';
  return (
    <View
      style={[
        styles.pill,
        {
          borderColor: isEmber ? theme.emberDeep : theme.border,
          backgroundColor: isEmber ? theme.emberGlow : theme.backgroundElement,
        },
      ]}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <Text
        style={[
          styles.pillText,
          { color: isEmber ? theme.ember : theme.textSecondary },
        ]}>
        {children}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Button */

type ButtonProps = {
  label: string;
  onPress?: () => void;
  href?: string;
  variant?: 'solid' | 'ghost';
  trailing?: string;
  size?: 'md' | 'lg';
};

export function EmberButton({
  label,
  onPress,
  href,
  variant = 'solid',
  trailing,
  size = 'md',
}: ButtonProps) {
  const theme = useTheme();
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handle = () => {
    if (onPress) return onPress();
    if (href) router.push(href as never);
  };

  const padV = size === 'lg' ? 16 : 13;
  const padH = size === 'lg' ? 28 : 22;
  const fontSize = size === 'lg' ? 17 : 15;
  const scale = pressed ? 0.97 : hovered ? 1.02 : 1;

  const inner = (
    <View style={styles.btnRow}>
      <Text
        style={[
          styles.btnLabel,
          { fontSize, color: variant === 'solid' ? theme.onEmber : theme.text },
        ]}>
        {label}
      </Text>
      {trailing ? (
        <Text
          style={[
            styles.btnLabel,
            { fontSize, color: variant === 'solid' ? theme.onEmber : theme.ember },
          ]}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Pressable
      onPress={handle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{ transform: [{ scale }], borderRadius: Radius.pill }}>
      {variant === 'solid' ? (
        <LinearGradient
          colors={EmberGradient as unknown as readonly [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.btnBase,
            {
              paddingVertical: padV,
              paddingHorizontal: padH,
              shadowColor: theme.emberDeep,
              shadowOpacity: hovered ? 0.55 : 0.4,
              shadowRadius: hovered ? 22 : 16,
              shadowOffset: { width: 0, height: 8 },
            },
          ]}>
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.btnBase,
            {
              paddingVertical: padV,
              paddingHorizontal: padH,
              borderWidth: 1,
              borderColor: hovered ? theme.ember : theme.borderStrong,
              backgroundColor: hovered ? theme.emberGlow : 'transparent',
            },
          ]}>
          {inner}
        </View>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  style,
  elevated,
  glow,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  glow?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? theme.cardElevated : theme.card,
          borderColor: theme.border,
          shadowColor: glow ? theme.emberDeep : '#000',
          shadowOpacity: glow ? 0.22 : 0.14,
          shadowRadius: glow ? 28 : 18,
          shadowOffset: { width: 0, height: 12 },
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/* -------------------------------------------------------------- Headings */

export function SectionHeading({
  kicker,
  title,
  emberWord,
  subtitle,
  align = 'left',
  maxWidth,
}: {
  kicker?: string;
  title: string;
  emberWord?: string;
  subtitle?: string;
  align?: 'left' | 'center';
  maxWidth?: number;
}) {
  const theme = useTheme();
  const { isNarrow } = useResponsive();
  const centered = align === 'center';
  return (
    <View style={{ alignItems: centered ? 'center' : 'flex-start', maxWidth, gap: Spacing.three }}>
      {kicker ? <Eyebrow>{kicker}</Eyebrow> : null}
      <Text
        style={[
          styles.heading,
          isNarrow && { fontSize: 29, lineHeight: 34, letterSpacing: -0.5 },
          { color: theme.text, textAlign: centered ? 'center' : 'left' },
        ]}>
        {title}
        {emberWord ? <Text style={{ color: theme.ember }}> {emberWord}</Text> : null}
      </Text>
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            isNarrow && { fontSize: 16, lineHeight: 24 },
            { color: theme.textSecondary, textAlign: centered ? 'center' : 'left' },
          ]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- Wordmark */

export function Wordmark({ size = 26 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={styles.wordmark}>
      <FlameMark size={size} />
      <Text style={[styles.wordmarkText, { color: theme.text, fontSize: size * 0.82 }]}>
        Hearth
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------- Hairline rule */

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.border }, style]} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  absCenter: { position: 'absolute' },
  eyebrow: {
    fontFamily: Fonts?.sans,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: {
    fontFamily: Fonts?.sans,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  btnBase: {
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  btnLabel: {
    fontFamily: Fonts?.sans,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.four,
  },
  heading: {
    fontFamily: Fonts?.sans,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontFamily: Fonts?.sans,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '400',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wordmarkText: {
    fontFamily: Fonts?.sans,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
