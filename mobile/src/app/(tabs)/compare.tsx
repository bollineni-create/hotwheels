import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CarArt } from '@/components/listing-card';
import { Screen } from '@/components/screen';
import { Card, Chip, T, toneColor } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { carById, distanceTo, kMiles, marketText, money, num, toggleCompare } from '@/lib/gridline';
import { Market, type Listing } from '@/lib/modules';
import { useAppState } from '@/lib/store';

const COL = 168;

// Up to four cars side by side; the best value in each row is highlighted.
export default function Compare() {
  const c = useTheme();
  const s = useAppState();
  const cars = s.compare.map(carById).filter(Boolean) as Listing[];
  if (!cars.length) {
    return (
      <Screen title="Compare">
        <Card>
          <T v="h3">No cars to compare</T>
          <T v="small">Open any car and tap Compare to add it here (up to 4).</T>
        </Card>
      </Screen>
    );
  }
  const rows: [string, (l: Listing) => number | null, (l: Listing) => string, 'low' | 'high' | null][] = [
    ['Price', (l) => l.price, (l) => money(l.price), 'low'],
    ['vs. fair value', (l) => marketText(l)?.d ?? null, (l) => marketText(l)?.label ?? '—', 'low'],
    ['Year', (l) => l.year, (l) => String(l.year), 'high'],
    ['Miles', (l) => l.miles, (l) => kMiles(l.miles), 'low'],
    ['Trim', () => null, (l) => l.trim || '—', null],
    ['Drivetrain', () => null, (l) => l.drivetrain || '—', null],
    ['Days listed', (l) => l.daysListed, (l) => String(l.daysListed), null],
    ['Last price cut', () => null, (l) => { const cut = Market.lastChange(l); return cut && cut.delta < 0 ? `↓ ${money(-cut.delta)}` : '—'; }, null],
    ['Distance', (l) => distanceTo(l), (l) => { const d = distanceTo(l); return d != null ? `${num(d)} mi` : `${l.city}, ${l.state}`; }, 'low'],
  ];
  return (
    <Screen title="Compare" sub="The best value in each row is highlighted.">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -Spacing.lg }} contentContainerStyle={{ paddingHorizontal: Spacing.lg }}>
        <View>
          <View style={{ flexDirection: 'row' }}>
            {cars.map((l) => (
              <Pressable key={l.id} style={{ width: COL, padding: 6, gap: 4 }} onPress={() => router.push({ pathname: '/car/[id]', params: { id: String(l.id) } })}>
                <View style={{ borderRadius: 10, overflow: 'hidden' }}><CarArt l={l} height={80} /></View>
                <T v="h3" numberOfLines={2}>{`${l.year} ${l.make} ${l.model}`}</T>
                <Chip label="Remove" onPress={() => toggleCompare(l)} />
              </Pressable>
            ))}
          </View>
          {rows.map(([label, val, fmt, best]) => {
            const vals = cars.map(val).filter((v): v is number => v != null);
            const target = best && vals.length > 1 ? (best === 'low' ? Math.min(...vals) : Math.max(...vals)) : null;
            return (
              <View key={label} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingVertical: 8 }}>
                <T v="eyebrow" style={{ paddingHorizontal: 6 }}>{label}</T>
                <View style={{ flexDirection: 'row' }}>
                  {cars.map((l) => {
                    const m = label === 'vs. fair value' ? marketText(l) : null;
                    const win = target != null && val(l) === target;
                    return (
                      <T key={l.id} v="body" style={{ width: COL, paddingHorizontal: 6, fontWeight: win ? '800' : '500', color: m ? toneColor(c, m.tone) : win ? c.accent : c.text }}>
                        {fmt(l)}
                      </T>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
