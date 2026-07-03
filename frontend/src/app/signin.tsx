import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlameMark } from '@/components/landing/flame-mark';
import { useAuth } from '@/auth/context';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const emailValid = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { requestCode, verifyCode, status, account, signOut } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const done = () => (router.canGoBack() ? router.back() : router.replace('/demo'));

  const sendCode = async () => {
    if (!emailValid(email) || busy) return;
    setBusy(true);
    setErr(null);
    const r = await requestCode(email);
    setBusy(false);
    if (r.ok) {
      setStep('code');
      setMsg(r.note?.includes('console') ? 'Dev mode: check the server console for your code.' : `We emailed a code to ${email.trim()}.`);
    } else {
      setErr(r.note ?? 'Could not send a code. Try again.');
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim()) || busy) return;
    setBusy(true);
    setErr(null);
    const r = await verifyCode(email, code);
    setBusy(false);
    if (r.ok) router.replace('/dashboard' as never);
    else setErr(r.error ?? 'Incorrect code.');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <Pressable onPress={done} hitSlop={8} style={styles.close}>
        <Text style={[styles.closeText, { color: theme.textMuted }]}>✕</Text>
      </Pressable>

      <View style={styles.center}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.brand}>
            <FlameMark size={26} />
            <Text style={[styles.title, { color: theme.text }]}>Sign in to Hearth</Text>
            <Text style={[styles.sub, { color: theme.textMuted }]}>
              {status === 'signedIn'
                ? `Signed in as ${account?.email}`
                : 'A one-time code — no password.'}
            </Text>
          </View>

          {status === 'signedIn' ? (
            <View style={{ gap: Spacing.two }}>
              <Pressable onPress={done} style={[styles.primary, { backgroundColor: theme.ember }]}>
                <Text style={[styles.primaryText, { color: theme.onEmber }]}>Back to the app</Text>
              </Pressable>
              <Pressable onPress={signOut} style={styles.ghost}>
                <Text style={[styles.ghostText, { color: theme.textSecondary }]}>Sign out</Text>
              </Pressable>
            </View>
          ) : step === 'email' ? (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={sendCode}
                placeholder="you@example.com"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                editable={!busy}
                style={[styles.input, { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text }, webNoOutline]}
              />
              <Pressable
                onPress={sendCode}
                disabled={!emailValid(email) || busy}
                style={[styles.primary, { backgroundColor: emailValid(email) && !busy ? theme.ember : theme.backgroundSelected }]}>
                {busy ? <ActivityIndicator color={theme.onEmber} /> : <Text style={[styles.primaryText, { color: emailValid(email) ? theme.onEmber : theme.textMuted }]}>Email me a code</Text>}
              </Pressable>
            </>
          ) : (
            <>
              {msg ? <Text style={[styles.info, { color: theme.textSecondary }]}>{msg}</Text> : null}
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                onSubmitEditing={confirm}
                placeholder="6-digit code"
                placeholderTextColor={theme.textMuted}
                keyboardType="number-pad"
                inputMode="numeric"
                editable={!busy}
                autoFocus
                style={[styles.input, styles.codeInput, { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text }, webNoOutline]}
              />
              <Pressable
                onPress={confirm}
                disabled={!/^\d{6}$/.test(code) || busy}
                style={[styles.primary, { backgroundColor: /^\d{6}$/.test(code) && !busy ? theme.ember : theme.backgroundSelected }]}>
                {busy ? <ActivityIndicator color={theme.onEmber} /> : <Text style={[styles.primaryText, { color: /^\d{6}$/.test(code) ? theme.onEmber : theme.textMuted }]}>Verify & sign in</Text>}
              </Pressable>
              <Pressable onPress={() => { setStep('email'); setCode(''); setErr(null); setMsg(null); }} style={styles.ghost}>
                <Text style={[styles.ghostText, { color: theme.textSecondary }]}>← Use a different email</Text>
              </Pressable>
            </>
          )}

          {err ? <Text style={[styles.err, { color: theme.info }]}>{err}</Text> : null}
        </View>

        <Text style={[styles.legal, { color: theme.textMuted }]}>The demo stays open without signing in.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  close: { position: 'absolute', top: Spacing.four, right: Spacing.four, zIndex: 10, padding: 6 },
  closeText: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.five,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  brand: { alignItems: 'center', gap: 6, marginBottom: Spacing.one },
  title: { fontFamily: Fonts?.sans, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 4 },
  sub: { fontFamily: Fonts?.sans, fontSize: 13.5, fontWeight: '500', textAlign: 'center' },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    fontFamily: Fonts?.sans,
    fontSize: 16,
    fontWeight: '500',
  },
  codeInput: { fontFamily: Fonts?.mono, fontSize: 22, fontWeight: '700', letterSpacing: 6, textAlign: 'center' },
  primary: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.pill, minHeight: 46 },
  primaryText: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  ghost: { alignItems: 'center', paddingVertical: 8 },
  ghostText: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '600' },
  info: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  err: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  legal: { fontFamily: Fonts?.sans, fontSize: 12, fontWeight: '500' },
});
