/**
 * Settings — who you are, how the platform reaches you, and the few destructive
 * things you can do to your own account. Everything here is real: the profile is
 * the verified session, the channels card writes through /notify/config, and the
 * danger zone only offers operations the backend actually has (unpair every hub,
 * sign out). No placeholder toggles — a switch that does nothing is a lie with
 * a nice thumb feel.
 */

import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { decodeSession, backendBase, type Account } from '@/auth/client';
import { NotifyChannelsCard } from '@/components/notify-channels-card';
import { Card } from '@/components/landing/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { unpairHub, type HubView } from '@/lib/hubs';

import { ConfirmPillButton, PillButton, SectionLabel } from './shared';

/** One "label: value" line in a card, value in mono because it's data. */
function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: muted ? theme.textMuted : theme.text }]}
        numberOfLines={1}
        selectable>
        {value}
      </Text>
    </View>
  );
}

const fmtDate = (ts?: number): string =>
  ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** Days until the session JWT self-expires — the honest half of "you're signed in". */
function sessionDaysLeft(token: string | null | undefined): number | null {
  const s = decodeSession(token);
  if (!s) return null;
  return Math.max(0, Math.ceil((s.exp * 1000 - Date.now()) / 86_400_000));
}

export function SettingsPanel({
  account,
  token,
  hubs,
  onSignOut,
  onHubsRemoved,
}: {
  account: Account | null;
  token?: string | null;
  hubs: HubView[] | null;
  onSignOut: () => void;
  /** All hubs were unpaired — the dashboard should reload its world. */
  onHubsRemoved: () => void;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [removingHubs, setRemovingHubs] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);

  const email = account?.email ?? '';
  const initial = (email[0] ?? '?').toUpperCase();
  const daysLeft = sessionDaysLeft(token);
  const backendHost = backendBase.replace(/^https?:\/\//, '');

  // Clipboard: web has a real API; native gets a selectable value instead of a dead button.
  const canCopy = Platform.OS === 'web' && !!globalThis.navigator?.clipboard;
  const copyId = async () => {
    if (!account?.id || !canCopy) return;
    try {
      await navigator.clipboard.writeText(account.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard permission denied — the id is selectable anyway */
    }
  };

  /** Unpair every hub, one honest DELETE at a time (there is no batch endpoint). */
  const removeAllHubs = async () => {
    if (removingHubs || !hubs?.length) return;
    setRemovingHubs(true);
    setDangerError(null);
    try {
      for (const h of hubs) await unpairHub(h.id, token);
      onHubsRemoved();
    } catch (e) {
      setDangerError((e as Error).message);
      onHubsRemoved(); // partial success still changed the world — reload it
    } finally {
      setRemovingHubs(false);
    }
  };

  return (
    <View style={{ gap: Spacing.four }}>
      {/* ------------------------------------------------ profile */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Profile</SectionLabel>
        <Card style={{ gap: Spacing.three }}>
          <View style={styles.profileRow}>
            <View style={[styles.avatar, { backgroundColor: theme.emberGlow, borderColor: theme.emberDeep }]}>
              <Text style={[styles.avatarText, { color: theme.ember }]}>{initial}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.email, { color: theme.text }]} numberOfLines={1}>
                {email || 'Signed in'}
              </Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                Member since {fmtDate(account?.createdAt)}
              </Text>
            </View>
          </View>
          <View style={{ gap: Spacing.two }}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: theme.textMuted }]}>Account ID</Text>
              <View style={styles.idWrap}>
                <Text style={[styles.rowValue, { color: theme.text }]} numberOfLines={1} selectable>
                  {account?.id ?? '—'}
                </Text>
                {canCopy && account?.id ? (
                  <Pressable onPress={copyId} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy account ID">
                    <Text style={[styles.copy, { color: copied ? theme.success : theme.ember }]}>
                      {copied ? 'Copied ✓' : 'Copy'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            <Row label="Last sign-in" value={fmtDate(account?.lastLoginAt)} />
          </View>
        </Card>
      </View>

      {/* ------------------------------------------------ notifications */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Notifications</SectionLabel>
        <NotifyChannelsCard token={token} />
      </View>

      {/* ------------------------------------------------ session & workspace */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Session</SectionLabel>
        <Card style={{ gap: Spacing.two }}>
          <Row label="Sign-in method" value="Email one-time code" />
          <Row
            label="Session expires"
            value={daysLeft === null ? '—' : daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
          />
          <Row label="Backend" value={backendHost} muted />
          <View style={styles.actions}>
            <PillButton label="Sign out" onPress={onSignOut} />
          </View>
        </Card>
      </View>

      {/* ------------------------------------------------ danger zone */}
      <View style={{ gap: Spacing.two }}>
        <SectionLabel>Danger zone</SectionLabel>
        <Card style={{ gap: Spacing.two, borderColor: theme.warn }}>
          <View style={styles.dangerRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.dangerTitle, { color: theme.text }]}>Disconnect all hubs</Text>
              <Text style={[styles.dangerWhy, { color: theme.textSecondary }]}>
                Unpairs {hubs?.length ?? 0} hub{hubs?.length === 1 ? '' : 's'} from this account. Their
                devices and readings stop syncing; watches stay authored but go quiet until a hub returns.
              </Text>
            </View>
            <ConfirmPillButton
              label="Disconnect"
              confirmLabel="Really disconnect?"
              busy={removingHubs}
              disabled={!hubs?.length}
              onConfirm={removeAllHubs}
            />
          </View>
          {dangerError ? <Text style={[styles.msg, { color: theme.info }]}>{dangerError}</Text> : null}
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts?.sans, fontSize: 22, fontWeight: '800' },
  email: { fontFamily: Fonts?.sans, fontSize: 17, fontWeight: '700' },
  meta: { fontFamily: Fonts?.mono, fontSize: 11.5, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 24,
  },
  rowLabel: {
    fontFamily: Fonts?.sans,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  rowValue: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  idWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  copy: { fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  dangerTitle: { fontFamily: Fonts?.sans, fontSize: 14.5, fontWeight: '700' },
  dangerWhy: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
  msg: { fontFamily: Fonts?.mono, fontSize: 12.5, lineHeight: 18 },
});
