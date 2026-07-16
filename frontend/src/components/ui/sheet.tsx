import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResponsive } from '@/components/landing/ui';
import { Fonts, Layer, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One overlay primitive, two faces. On a phone it's a sheet that slides up from the bottom
 * edge and can be flung back down by its handle; on a desktop it's a dialog that scales up in
 * the middle of the screen. Same props, same mental model — content that lives above the page
 * rather than pushing it around.
 *
 * Deliberately not react-native's <Modal>: this renders as an absolutely-positioned layer
 * inside the screen, which behaves identically on web and native and keeps the whole z-axis
 * under our control (see `Layer` in constants/theme).
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned below the scrolling body — put the commit/destructive actions here. */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const { isWide } = useResponsive();
  const insets = useSafeAreaInsets();

  // Stay mounted through the exit animation, then unmount so closed sheets cost nothing.
  const [mounted, setMounted] = useState(open);
  const [height, setHeight] = useState(560);
  const [anim] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const dragY = useRef(0);
  const grabY = useRef(0);

  // Mount on the same render that `open` flips, not in an effect: the panel must exist before
  // the entrance animation starts, and doing it here costs one re-render instead of a frame of
  // nothing. (Unmounting is the effect's job — it has to wait for the exit to finish.)
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const a = Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: open ? 260 : 170,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    a.start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        drag.setValue(0);
      }
    });
    return () => a.stop();
  }, [open, anim, drag]);

  // Escape closes on web — the keyboard equivalent of tapping the scrim.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const settle = useCallback(() => {
    Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    dragY.current = 0;
  }, [drag]);

  if (!mounted) return null;

  const scrimOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });
  // Phone: rise from just below the bottom edge, and follow the finger on drag-down.
  const rise = Animated.add(
    anim.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
    drag,
  );
  // Desktop: a dialog doesn't slide, it settles — a short lift plus a hair of scale.
  const lift = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: Layer.scrim }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
        />
      </Animated.View>

      <View style={isWide ? styles.dockCenter : styles.dockBottom} pointerEvents="box-none">
        <Animated.View
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
          style={[
            styles.panel,
            isWide ? styles.panelWide : styles.panelPhone,
            {
              zIndex: Layer.sheet,
              backgroundColor: theme.cardElevated,
              borderColor: theme.border,
              shadowColor: '#000',
              paddingBottom: isWide ? Spacing.four : Spacing.four + insets.bottom,
              opacity: anim,
              transform: isWide
                ? [{ translateY: lift }, { scale }]
                : [{ translateY: rise }],
            },
          ]}>
          {/* Grab handle — the phone's drag-to-dismiss target. It owns the gesture so the
              body below it keeps its own scrolling. */}
          {!isWide ? (
            <View
              style={styles.handleZone}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => {
                grabY.current = e.nativeEvent.pageY;
              }}
              onResponderMove={(e) => {
                const dy = Math.max(0, e.nativeEvent.pageY - grabY.current);
                dragY.current = dy;
                drag.setValue(dy);
              }}
              onResponderRelease={() => {
                if (dragY.current > 90) onClose();
                else settle();
              }}
              onResponderTerminate={settle}>
              <View style={[styles.handle, { backgroundColor: theme.borderStrong }]} />
            </View>
          ) : null}

          <View style={styles.head}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.close, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.closeText, { color: theme.textSecondary }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>

          {footer ? (
            <View style={[styles.footer, { borderTopColor: theme.border }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: '#000' },
  dockBottom: { flex: 1, justifyContent: 'flex-end' },
  dockCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  panel: {
    borderWidth: 1,
    shadowOpacity: 0.4,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  // A phone sheet is anchored to the bottom edge: square below, rounded above, never full-height
  // so the page stays visible behind it and the overlay reads as a layer, not a navigation.
  panelPhone: {
    width: '100%',
    maxHeight: '88%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderBottomWidth: 0,
  },
  panelWide: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    borderRadius: Radius.lg,
    paddingTop: Spacing.four,
    shadowOffset: { width: 0, height: 18 },
  },
  handleZone: { paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  handle: { width: 42, height: 4, borderRadius: 2 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  title: { fontFamily: Fonts?.sans, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  close: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  // flexGrow keeps a short sheet hugging its content; flexShrink lets a tall one scroll instead
  // of pushing its own footer past maxHeight. Web gets flexShrink: 1 free from react-native-web's
  // ScrollView base style, but Yoga defaults it to 0, so on native it has to be said out loud.
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, gap: Spacing.three },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderTopWidth: 1,
  },
});
