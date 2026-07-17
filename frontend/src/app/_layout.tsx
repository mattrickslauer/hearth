import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AuthProvider } from '@/auth/context';
import { Colors } from '@/constants/theme';

function navTheme(scheme: 'light' | 'dark') {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const c = Colors[scheme];
  return {
    ...base,
    colors: {
      ...base.colors,
      background: c.background,
      card: c.background,
      text: c.text,
      border: c.border,
      primary: c.ember,
    },
  };
}

export default function RootLayout() {
  // One shared default with use-theme: anything that isn't an explicit 'dark' is 'light', so the
  // nav chrome here and the content (via useTheme) agree on the first paint.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <AuthProvider>
      <ThemeProvider value={navTheme(scheme)}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors[scheme].background },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="build-a-node" />
          <Stack.Screen name="demo" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="memory" />
          <Stack.Screen name="signin" options={{ presentation: 'modal', animation: 'fade' }} />
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}
