import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Layer, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface FabAction {
  icon: string;
  label: string;
  onPress: () => void;
}

/**
 * The one place you start something. Tapping the ember button dims the page and fans a stack of
 * labelled actions up out of it; picking one closes the stack and opens that action's sheet.
 *
 * This is the whole reason the page underneath can stay read-only: every "create" affordance
 * lives here, on the z-axis, instead of being a form permanently parked in the scroll.
 */
export function ActionFab({ actions, bottomInset = 0 }: { actions: FabAction[]; bottomInset?: number }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const a = Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 200 : 140,
      easing: open ? Easing.out(Easing.back(1.4)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [open, anim]);

  const pick = (action: FabAction) => {
    setOpen(false);
    action.onPress();
  };

  return (
    <>
      {/* Scrim: only present while the stack is open, so it never eats taps on the page. */}
      {open ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { zIndex: Layer.fab - 1, backgroundColor: '#000', opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) },
          ]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss actions"
          />
        </Animated.View>
      ) : null}

      <View style={[styles.dock, { bottom: Spacing.four + bottomInset, zIndex: Layer.fab }]} pointerEvents="box-none">
        {open ? (
          <View style={styles.stack} pointerEvents="box-none">
            {actions.map((a, i) => {
              // Stagger: the item nearest the button arrives first, so the stack reads as
              // unfolding out of the FAB rather than appearing all at once.
              const step = actions.length - i;
              return (
                <Animated.View
                  key={a.label}
                  style={{
                    opacity: anim,
                    transform: [
                      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12 * step, 0] }) },
                    ],
                  }}>
                  <Pressable
                    onPress={() => pick(a)}
                    accessibilityRole="button"
                    style={[styles.action, { backgroundColor: theme.cardElevated, borderColor: theme.borderStrong }]}>
                    <Text style={styles.actionIcon}>{a.icon}</Text>
                    <Text style={[styles.actionLabel, { color: theme.text }]}>{a.label}</Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        ) : null}

        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close actions' : 'Open actions'}
          style={[styles.fab, { backgroundColor: theme.ember, shadowColor: theme.emberDeep }]}>
          <Animated.Text
            style={[
              styles.fabIcon,
              {
                color: theme.onEmber,
                transform: [{ rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] }) }],
              },
            ]}>
            ＋
          </Animated.Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', right: Spacing.four, alignItems: 'flex-end', gap: Spacing.three },
  stack: { alignItems: 'flex-end', gap: Spacing.two, marginBottom: Spacing.two },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    minHeight: 44,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  actionIcon: { fontSize: 15 },
  actionLabel: { fontFamily: Fonts?.sans, fontSize: 14.5, fontWeight: '700' },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  fabIcon: { fontFamily: Fonts?.sans, fontSize: 28, fontWeight: '400', lineHeight: 32 },
});
