import { View } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { Screen } from '@/components/screen';
import { Card, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { carById, money } from '@/lib/gridline';
import type { Listing } from '@/lib/modules';
import { useAppState } from '@/lib/store';

export default function Saved() {
  const c = useTheme();
  const s = useAppState();
  const favs = Object.entries(s.favs).map(([id, was]) => ({ l: carById(id), was })).filter((x): x is { l: Listing; was: number } => !!x.l);
  const recent = s.recent.filter((id) => s.favs[id] == null).map(carById).filter(Boolean).slice(0, 6) as Listing[];
  return (
    <Screen title="Saved" sub="Cars you’ve hearted, and what’s changed since.">
      {favs.length ? (
        <View style={{ gap: Spacing.md }}>
          {favs.map(({ l, was }) => (
            <View key={l.id} style={{ gap: 4 }}>
              <ListingCard l={l} />
              {l.price !== was ? (
                <T v="small" style={{ color: l.price < was ? c.good : c.warn, fontWeight: '700' }}>
                  {`${l.price < was ? '↓' : '↑'} ${money(Math.abs(l.price - was))} since you saved it (was ${money(was)})`}
                </T>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Card>
          <T v="h3">Nothing saved yet</T>
          <T v="small">Tap ♡ on any car to keep it here. Gridline remembers the price you saw, so you’ll know when it drops.</T>
        </Card>
      )}
      {recent.length ? (
        <Section title="Recently viewed">
          <View style={{ gap: Spacing.md }}>{recent.map((l) => <ListingCard key={l.id} l={l} />)}</View>
        </Section>
      ) : null}
    </Screen>
  );
}
