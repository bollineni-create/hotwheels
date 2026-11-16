import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A tab's scrolling page with a large title, like the site's page headers.
export function Screen({ title, sub, children, onRefresh, refreshing }: { title?: string; sub?: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + 96, paddingHorizontal: Spacing.lg, gap: Spacing.xl }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined}>
      {title ? (
        <View style={{ gap: 4 }}>
          <T v="title">{title}</T>
          {sub ? <T v="small">{sub}</T> : null}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}
