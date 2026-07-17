import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HubView } from '@/lib/hubs';
import { webNoOutline } from '@/lib/web-style';

import { ago, useHover } from './shared';

/**
 * Format a claim code as the user types (or pastes): strip anything that isn't alphanumeric —
 * including any dashes they typed or that came in a paste — uppercase, cap at 8 chars, then
 * re-insert a single dash after the 4th. So "abcd2345", "ABCD-2345", and "ab-cd-23-45" all
 * converge on "ABCD-2345", and there's never a duplicate dash. Matches the backend's XXXX-XXXX.
 */
export const formatClaimCode = (raw: string): string => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

export function hubStatusLine(h: HubView): string {
  const base = h.online
    ? 'Online'
    : h.lastSeenAt
      ? `Offline · last seen ${ago(h.lastSeenAt)}`
      : 'Waiting for first check-in…';
  return `${base}${h.fw ? ` · fw ${h.fw}` : ''}`;
}

/** A hub as a row: a dot you can read across the room, and a name. Unpair lives in its sheet. */
export function HubRow({ hub, onPress }: { hub: HubView; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${hub.name}. ${hubStatusLine(hub)}. Tap to manage.`}
      {...hoverProps}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.card,
          borderColor: pressed || hovered ? theme.emberDeep : theme.border,
        },
      ]}>
      <View style={[styles.dot, { backgroundColor: hub.online ? theme.success : theme.textMuted }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {hub.name}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {hubStatusLine(hub)}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
    </Pressable>
  );
}

/** The body of the "Connect a hub" sheet. */
export function ConnectHubBody({
  code,
  onChangeCode,
  onSubmit,
  claiming,
  error,
  notice,
}: {
  code: string;
  onChangeCode: (t: string) => void;
  onSubmit: () => void;
  claiming: boolean;
  error: string | null;
  notice: string | null;
}) {
  const theme = useTheme();
  return (
    <>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        Power on your Hearth hub and enter the 8-character code it displays.
      </Text>
      <TextInput
        value={code}
        onChangeText={(t) => onChangeCode(formatClaimCode(t))}
        onSubmitEditing={onSubmit}
        editable={!claiming}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        placeholder="ABCD-2345"
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          styles.codeInput,
          { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
          webNoOutline,
        ]}
      />
      {error ? <Text style={[styles.msg, { color: theme.info }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.msg, { color: theme.success }]}>{notice}</Text> : null}
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        Don’t have a hub yet?{' '}
        <Text
          onPress={() => Linking.openURL('https://github.com/mattrickslauer/hearth/tree/main/hub')}
          style={{ color: theme.ember, fontWeight: '600' }}>
          Install it on any machine →
        </Text>
      </Text>
    </>
  );
}

/** The body of a paired hub's sheet. */
export function HubSheetBody({ hub }: { hub: HubView }) {
  const theme = useTheme();
  return (
    <View style={[styles.detail, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
      <DetailRow label="Status" value={hub.online ? 'Online' : 'Offline'} />
      <DetailRow label="Last seen" value={hub.lastSeenAt ? ago(hub.lastSeenAt) : 'never'} />
      <DetailRow label="Firmware" value={hub.fw || 'unknown'} />
      <DetailRow label="ID" value={hub.id} />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    minHeight: 60,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  meta: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '600' },
  chevron: { fontFamily: Fonts?.sans, fontSize: 22, fontWeight: '400' },

  hint: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  msg: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 18 },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts?.sans,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 50,
  },
  codeInput: { fontFamily: Fonts?.mono, letterSpacing: 2, textTransform: 'uppercase', fontSize: 18 },

  detail: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three, gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  detailLabel: {
    flex: 1,
    fontFamily: Fonts?.mono,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { flexShrink: 1, fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '600' },
});
