import '@/lib/modules';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useIsDark, useTheme } from '@/hooks/use-theme';
import { syncProvider } from '@/lib/gridline';

syncProvider();

export default function RootLayout() {
  const dark = useIsDark();
  const c = useTheme();
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: c.bg, card: c.surface, text: c.text, border: c.border, primary: c.accent } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="car/[id]" options={{ title: '', headerBackTitle: 'Back' }} />
      </Stack>
    </ThemeProvider>
  );
}
