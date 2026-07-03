import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/context';
import { Dropdown, Option } from '@/components/demo/dropdown';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const REPO_URL = 'https://github.com/mattrickslauer/hearth';

/**
 * Header account control: a "Sign in" pill for guests, a user pill (email initial +
 * name) when signed in — either way opening a dropdown of quick links. Non-blocking;
 * used in both the landing nav and the demo TopBar.
 */
export function AuthMenu({ align = 'right', width = 210 }: { align?: 'left' | 'right'; width?: number }) {
  const theme = useTheme();
  const router = useRouter();
  const { status, account, signOut } = useAuth();
  const signedIn = status === 'signedIn';
  const username = account?.email?.split('@')[0] ?? 'Account';

  return (
    <Dropdown
      icon={signedIn ? '●' : '○'}
      label={signedIn ? 'Account' : 'Guest'}
      value={signedIn ? username : 'Sign in'}
      align={align}
      width={width}>
      {(close) => (
        <View style={{ gap: 2 }}>
          {signedIn && account?.email ? (
            <View style={styles.header}>
              <Text style={[styles.headerLabel, { color: theme.textMuted }]}>SIGNED IN</Text>
              <Text style={[styles.email, { color: theme.text }]} numberOfLines={1}>
                {account.email}
              </Text>
            </View>
          ) : (
            <Option icon="→" label="Sign in" onPress={() => { close(); router.push('/signin'); }} />
          )}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Option icon="🏠" label="Home" onPress={() => { close(); router.push('/'); }} />
          <Option icon="🔥" label="Live demo" onPress={() => { close(); router.push('/demo'); }} />
          <Option icon="↗" label="GitHub" onPress={() => { close(); void Linking.openURL(REPO_URL); }} />

          {signedIn ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <Option icon="⎋" label="Sign out" onPress={() => { close(); signOut(); }} />
            </>
          ) : null}
        </View>
      )}
    </Dropdown>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, gap: 2 },
  headerLabel: { fontFamily: Fonts?.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  email: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700' },
  divider: { height: 1, marginVertical: 4 },
});
