import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

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
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';

  return (
    <ThemeProvider value={navTheme(scheme)}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors[scheme].background },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="demo" />
      </Stack>
    </ThemeProvider>
  );
}
