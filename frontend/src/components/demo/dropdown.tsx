import { useRef, useState, type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Gap between the trigger and the menu, and the minimum breathing room at a screen edge. */
const GAP = 6;
const EDGE = 8;
/** Below this, "there's room underneath" stops being true enough to be worth it. */
const MIN_ROOM = 140;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the menu goes, in window coords, plus how tall it may grow before scrolling. */
function place(r: Rect, width: number, align: 'left' | 'right') {
  const win = Dimensions.get('window');

  // Keep the menu on screen horizontally even when the trigger sits near an edge.
  const wanted = align === 'right' ? r.x + r.w - width : r.x;
  const left = Math.max(EDGE, Math.min(wanted, win.width - width - EDGE));

  const roomBelow = win.height - (r.y + r.h) - GAP - EDGE;
  const roomAbove = r.y - GAP - EDGE;
  // Prefer opening downward, but flip up rather than run off the bottom of the
  // screen — the case that made the model picker unusable.
  if (roomBelow >= MIN_ROOM || roomBelow >= roomAbove) {
    return { top: r.y + r.h + GAP, left, maxHeight: Math.max(MIN_ROOM, roomBelow) };
  }
  return { bottom: win.height - r.y + GAP, left, maxHeight: Math.max(MIN_ROOM, roomAbove) };
}

/**
 * A lightweight dropdown menu for the world-settings bar. Trigger shows the
 * current value; pressing it opens a popover next to it, with a full-viewport
 * backdrop to catch outside clicks.
 *
 * The menu is measured and placed in window coords inside a Modal, rather than
 * laid out inline beneath the trigger. Inline it could only ever open downward,
 * so a trigger near the bottom of the screen — the deployment card's model
 * picker is the last control on the card — pushed its options off the bottom
 * edge, leaving the model unchangeable. Placing it explicitly lets it flip up
 * when there's no room below; the Modal also portals it out of the subtree, so
 * an ancestor's `overflow: 'hidden'` (the demo console's frame sets it) can't
 * clip it and no `zIndex` juggling is needed.
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
  const triggerRef = useRef<View>(null);
  // The measured trigger doubles as the open flag: there is no sensible place to
  // draw the menu until we know where the trigger is.
  const [rect, setRect] = useState<Rect | null>(null);
  const open = rect !== null;
  const close = () => setRect(null);

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, w, h) => setRect({ x, y, w, h }));
  };

  return (
    <View>
      <Pressable
        ref={triggerRef}
        onPress={() => (open ? close() : openMenu())}
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

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          {rect ? (
            /* Swallow taps inside the menu so only the backdrop dismisses. */
            <Pressable
              style={[
                styles.popover,
                place(rect, width, align),
                { width, borderColor: theme.borderStrong, backgroundColor: theme.cardElevated },
              ]}
              onPress={() => {}}>
              <ScrollView style={styles.menu} contentContainerStyle={styles.menuContent}>
                {children(close)}
              </ScrollView>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
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

const styles = StyleSheet.create({
  // The Modal already covers the viewport, so the backdrop is just a full-bleed
  // click target; the menu is positioned against it in window coords.
  backdrop: { flex: 1 },
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
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.one,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  // flexShrink is 0 by default in React Native, so without it a long list would
  // push past the popover's maxHeight on native instead of scrolling inside it.
  menu: { flexGrow: 0, flexShrink: 1 },
  menuContent: { gap: 2 },
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
