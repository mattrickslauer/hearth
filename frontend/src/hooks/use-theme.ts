/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  // RN returns 'light' | 'dark' | null. Anything that isn't an explicit 'dark' falls back to
  // 'light' — null used to index Colors[null] (undefined) and throw on every theme.* access.
  const theme = scheme === 'dark' ? 'dark' : 'light';

  return Colors[theme];
}
