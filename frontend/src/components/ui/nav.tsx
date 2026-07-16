import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Layer, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface NavTab {
  key: string;
  icon: string;
  label: string;
  /** Rendered as a small count next to the label. `null`/undefined shows nothing. */
  badge?: number | null;
  /**
   * Rail-only grouping. Consecutive tabs sharing a section render under one small
   * header; the phone TabBar ignores it (a bottom bar has no room for headings).
   */
  section?: string;
}

/**
 * The same four destinations, docked to whichever edge the device makes reachable: the bottom
 * of a phone (thumb) or the left of a desktop (pointer). Both sit on `Layer.nav`, above the
 * content, so the page scrolls under them and the app never loses its spine.
 */

/** Phone: a bottom tab bar. Sits in the thumb arc and clears the home indicator. */
export function TabBar({
  tabs,
  value,
  onChange,
}: {
  tabs: NavTab[];
  value: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          zIndex: Layer.nav,
          paddingBottom: insets.bottom || Spacing.two,
          backgroundColor: theme.card,
          borderTopColor: theme.border,
        },
      ]}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={styles.barItem}>
            <Text style={[styles.barIcon, { opacity: on ? 1 : 0.45 }]}>{t.icon}</Text>
            <Text style={[styles.barLabel, { color: on ? theme.ember : theme.textMuted }]} numberOfLines={1}>
              {t.label}
            </Text>
            {/* The active marker is a bar rather than a fill: it reads at a glance without
                boxing in the icon, and it's the only ember on the chrome. */}
            <View style={[styles.barMark, { backgroundColor: on ? theme.ember : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Desktop: a left rail. Labels always visible — there's room, so don't make people guess. */
export function Rail({
  tabs,
  value,
  onChange,
}: {
  tabs: NavTab[];
  value: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.rail, { zIndex: Layer.nav, borderRightColor: theme.border }]}>
      {tabs.map((t, i) => {
        const on = t.key === value;
        // A section header opens each new group — only where the section actually changes,
        // so ungrouped tab lists render exactly as before.
        const heading = t.section && t.section !== tabs[i - 1]?.section ? t.section : null;
        return (
          <Fragment key={t.key}>
            {heading ? (
              <Text style={[styles.railSection, { color: theme.textMuted }, i > 0 && styles.railSectionGap]}>
                {heading}
              </Text>
            ) : null}
          <Pressable
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              styles.railItem,
              {
                backgroundColor: on ? theme.emberGlow : 'transparent',
                borderColor: on ? theme.emberDeep : 'transparent',
              },
            ]}>
            <Text style={[styles.railIcon, { opacity: on ? 1 : 0.5 }]}>{t.icon}</Text>
            <Text
              style={[styles.railLabel, { color: on ? theme.ember : theme.textSecondary }]}
              numberOfLines={1}>
              {t.label}
            </Text>
            {t.badge != null ? (
              <Text style={[styles.railBadge, { color: on ? theme.ember : theme.textMuted }]}>{t.badge}</Text>
            ) : null}
          </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: Spacing.two,
  },
  barItem: { flex: 1, alignItems: 'center', gap: 2, paddingTop: 4, minHeight: 48 },
  barIcon: { fontSize: 18 },
  barLabel: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  barMark: { height: 2, width: 18, borderRadius: 1, marginTop: 3 },

  rail: {
    width: 196,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: 4,
    borderRightWidth: 1,
  },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    minHeight: 42,
  },
  railIcon: { fontSize: 15, width: 20, textAlign: 'center' },
  railLabel: { flex: 1, fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  railBadge: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '700' },
  railSection: {
    fontFamily: Fonts?.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  railSectionGap: { paddingTop: Spacing.three },
});
