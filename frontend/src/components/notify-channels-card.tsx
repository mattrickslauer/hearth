/**
 * "Notify me" — where a fired watch actually reaches you.
 *
 * A watch authored with push:true has always fired on the hub; until now its only outlet was
 * env vars on the hub process, so a homeowner had no way to say where it should land. This is
 * that missing surface: a Telegram chat and/or an email address, saved per ACCOUNT (you have
 * one phone and one inbox, not one per hub — and a hub you unpair shouldn't take them with it).
 *
 * The bot token is write-only from here: we send it, and read back only a hint like
 * "12345678:…9Kf2". So the form starts collapsed showing what's saved, and only asks for a
 * token when you're adding or replacing one.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/landing/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getNotifyConfig,
  setNotifyConfig,
  testNotify,
  type DeliveryResult,
  type NotifyConfigView,
} from '@/lib/notify';
import { webNoOutline } from '@/lib/web-style';

/** Turn a delivery result set into one honest line: what landed, what didn't, and why. */
function summarize(channels: DeliveryResult[]): { text: string; ok: boolean } {
  if (!channels.length) return { text: 'No channels configured.', ok: false };
  const ok = channels.filter((c) => c.delivered).map((c) => c.channel);
  const bad = channels.filter((c) => !c.delivered);
  if (!bad.length) return { text: `Sent to ${ok.join(' and ')} — check your device.`, ok: true };
  const why = bad.map((c) => `${c.channel} failed${c.error ? ` (${c.error})` : c.status ? ` (${c.status})` : ''}`);
  return { text: [ok.length ? `Sent to ${ok.join(' and ')}` : null, ...why].filter(Boolean).join('; '), ok: ok.length > 0 };
}

export function NotifyChannelsCard({ token }: { token?: string | null }) {
  const theme = useTheme();

  const [config, setConfig] = useState<NotifyConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Draft fields. `botToken` stays empty unless the user is (re)entering one — an empty box
  // on save means "keep the token you already have", which is what the backend does too.
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [email, setEmail] = useState('');
  const [editingToken, setEditingToken] = useState(false);

  const hydrate = useCallback((c: NotifyConfigView) => {
    setConfig(c);
    setChatId(c.telegram?.chatId ?? '');
    setEmail(c.email ?? '');
    setBotToken('');
    setEditingToken(false);
  }, []);

  useEffect(() => {
    let alive = true;
    getNotifyConfig(token)
      .then((r) => {
        if (alive) hydrate(r.config);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, hydrate]);

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const r = await setNotifyConfig(
        {
          // Clearing the chat id turns Telegram OFF but keeps the bot token — getting one means
          // a trip through @BotFather, so pausing notifications must not destroy the credential.
          // Only a user with no bot at all sends null.
          telegram: chatId.trim()
            ? { chatId: chatId.trim(), ...(botToken.trim() ? { botToken: botToken.trim() } : {}) }
            : config?.telegram
              ? { chatId: null }
              : null,
          email: email.trim() || null,
        },
        token,
      );
      hydrate(r.config);
      setNotice(r.channels.length ? `Saved — notifying ${r.channels.join(' and ')}.` : 'Saved — no channels on, so pushes stay in the app.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const r = await testNotify(token);
      const s = summarize(r.channels);
      if (s.ok) setNotice(s.text);
      else setError(s.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // A saved bot token with no chat id is registered, not ON — don't count it as a live channel.
  const savedChannels = [config?.telegram?.chatId ? 'Telegram' : null, config?.email ? 'Email' : null].filter(
    Boolean,
  ) as string[];
  // A test only proves something once there's a SAVED channel — testing an unsaved draft would
  // send to the old config and read as a false pass.
  const canTest = savedChannels.length > 0;
  const dirty =
    (chatId.trim() || '') !== (config?.telegram?.chatId ?? '') ||
    (email.trim() || '') !== (config?.email ?? '') ||
    botToken.trim().length > 0;

  return (
    <Card style={{ gap: Spacing.two }}>
      <View style={styles.head}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Notify me</Text>
        {loading ? null : (
          <View style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.dot, { backgroundColor: savedChannels.length ? theme.success : theme.textMuted }]} />
            <Text style={[styles.badgeText, { color: theme.textSecondary }]}>
              {savedChannels.length ? savedChannels.join(' + ') : 'Off'}
            </Text>
          </View>
        )}
      </View>

      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        Where watches that say “notify me” reach you. Saved for your account — every hub you pair uses it.
      </Text>

      {loading ? (
        <ActivityIndicator color={theme.ember} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <>
          {/* Telegram */}
          <View style={{ gap: Spacing.one }}>
            <Text style={[styles.label, { color: theme.text }]}>Telegram</Text>
            <TextInput
              value={chatId}
              onChangeText={setChatId}
              placeholder="Chat ID (e.g. 12345678)"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="text"
              style={[
                styles.input,
                { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                webNoOutline,
              ]}
            />

            {config?.telegram && !editingToken ? (
              <View style={styles.tokenRow}>
                <Text style={[styles.tokenHint, { color: theme.textMuted }]} numberOfLines={1}>
                  Bot token saved · {config.telegram.botTokenHint}
                </Text>
                <Pressable onPress={() => setEditingToken(true)}>
                  <Text style={[styles.link, { color: theme.ember }]}>Replace</Text>
                </Pressable>
              </View>
            ) : (
              <TextInput
                value={botToken}
                onChangeText={setBotToken}
                placeholder="Bot token from @BotFather"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[
                  styles.input,
                  { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                  webNoOutline,
                ]}
              />
            )}

            <Text style={[styles.help, { color: theme.textMuted }]}>
              Create a bot with{' '}
              <Text onPress={() => Linking.openURL('https://t.me/BotFather')} style={{ color: theme.ember, fontWeight: '600' }}>
                @BotFather
              </Text>
              , then message it once and get your chat ID from{' '}
              <Text onPress={() => Linking.openURL('https://t.me/userinfobot')} style={{ color: theme.ember, fontWeight: '600' }}>
                @userinfobot
              </Text>
              . Clearing the chat ID turns Telegram off and keeps your bot token.
            </Text>
          </View>

          {/* Email */}
          <View style={{ gap: Spacing.one }}>
            <Text style={[styles.label, { color: theme.text }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
              style={[
                styles.input,
                { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                webNoOutline,
              ]}
            />
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={save}
              disabled={!dirty || busy !== null}
              // Stays ember while saving — greying it out mid-save leaves a white spinner on
              // light beige, which reads as a dead tap rather than progress.
              style={[styles.btn, { backgroundColor: dirty ? theme.ember : theme.backgroundSelected }]}>
              {busy === 'save' ? (
                <ActivityIndicator color={theme.onEmber} />
              ) : (
                <Text style={[styles.btnText, { color: dirty ? theme.onEmber : theme.textMuted }]}>Save</Text>
              )}
            </Pressable>

            <Pressable
              onPress={test}
              disabled={!canTest || busy !== null}
              style={[styles.btnGhost, { borderColor: theme.border, opacity: canTest && !busy ? 1 : 0.5 }]}>
              {busy === 'test' ? (
                <ActivityIndicator color={theme.textSecondary} />
              ) : (
                <Text style={[styles.btnGhostText, { color: theme.textSecondary }]}>Send test</Text>
              )}
            </Pressable>
          </View>

          {dirty && canTest ? (
            <Text style={[styles.help, { color: theme.textMuted }]}>Save first — the test sends to what’s saved, not what’s typed.</Text>
          ) : null}
          {error ? <Text style={[styles.msg, { color: theme.info }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.msg, { color: theme.success }]}>{notice}</Text> : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cardTitle: { fontFamily: Fonts?.sans, fontSize: 17, fontWeight: '700' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { fontFamily: Fonts?.mono, fontSize: 11, fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  hint: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  label: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontFamily: Fonts?.sans,
    fontSize: 14.5,
  },
  tokenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  tokenHint: { fontFamily: Fonts?.mono, fontSize: 12, flex: 1 },
  link: { fontFamily: Fonts?.sans, fontSize: 12.5, fontWeight: '700' },
  help: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  btn: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: Radius.pill, alignItems: 'center', minWidth: 96 },
  btnText: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', minWidth: 104 },
  btnGhostText: { fontFamily: Fonts?.sans, fontSize: 14, fontWeight: '700' },
  msg: { fontFamily: Fonts?.sans, fontSize: 13, lineHeight: 19 },
});
