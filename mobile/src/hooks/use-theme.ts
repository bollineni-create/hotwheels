import { Colors, type Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppState } from '@/lib/store';

// The Settings theme choice wins; otherwise follow the phone.
export function useTheme(): Palette {
  const system = useColorScheme();
  const pref = useAppState().theme;
  return Colors[(pref || system) === 'dark' ? 'dark' : 'light'];
}

export function useIsDark() {
  const system = useColorScheme();
  const pref = useAppState().theme;
  return (pref || system) === 'dark';
}
