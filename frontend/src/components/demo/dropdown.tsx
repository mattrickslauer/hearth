import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A lightweight dropdown menu for the world-settings bar. Trigger shows the
 * current value; pressing it opens a popover below. A full-viewport backdrop
 * catches outside clicks so the menu closes cleanly.
 */
export function Dropdown({
  icon,
  label,
  value,
  align = 'left',
  width = 220,
  children,
}: {
  icon?: string;
  label: string;
  value: string;
  align?: 'left' | 'right';
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <View style={{ zIndex: open ? 1000 : 1 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[
          styles.trigger,
          { borderColor: open ? theme.ember : theme.border, backgroundColor: theme.card },
        ]}>
        {icon ? <Text style={styles.triggerIcon}>{icon}</Text> : null}
        <View style={styles.triggerText}>
          <Text style={[styles.triggerLabel, { color: theme.textMuted }]}>{label}</Text>
          <Text style={[styles.triggerValue, { color: theme.text }]} numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Text style={[styles.caret, { color: open ? theme.ember : theme.textMuted }]}>▾</Text>
      </Pressable>

      {open ? (
        <>
          <Pressable onPress={close} style={backdrop} />
          <View
            style={[
              styles.popover,
              align === 'right' ? { right: 0 } : { left: 0 },
              { width, borderColor: theme.borderStrong, backgroundColor: theme.cardElevated },
            ]}>
            {children(close)}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** A single selectable row inside a dropdown. */
export function Option({
  icon,
  label,
  active,
  onPress,
}: {
  icon?: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, active ? { backgroundColor: theme.emberGlow } : null]}>
      {icon ? <Text style={styles.optIcon}>{icon}</Text> : null}
      <Text style={[styles.optLabel, { color: active ? theme.ember : theme.text }]}>{label}</Text>
      {active ? <Text style={[styles.check, { color: theme.ember }]}>✓</Text> : null}
    </Pressable>
  );
}

const backdrop =
  Platform.OS === 'web'
    ? ({ position: 'fixed', inset: 0, zIndex: 900 } as object)
    : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900 };

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: Radius.md,
    borderWidth: 1,
    minWidth: 116,
  },
  triggerIcon: { fontSize: 15 },
  triggerText: { flex: 1, gap: 1 },
  triggerLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  triggerValue: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  caret: { fontSize: 11, fontWeight: '700' },
  popover: {
    position: 'absolute',
    top: '100%',
    marginTop: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.one,
    zIndex: 1001,
    gap: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
  },
  optIcon: { fontSize: 15, width: 20, textAlign: 'center' },
  optLabel: { flex: 1, fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '600' },
  check: { fontSize: 13, fontWeight: '700' },
});
