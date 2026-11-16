import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SvgArt } from '@/components/svg-art';
import { Badge, T, toneColor } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysText, distanceTo, kMiles, marketText, money, num, plural, ago, title, toggleFav } from '@/lib/gridline';
import { Charts, Market, type Listing } from '@/lib/modules';
import { useAppState } from '@/lib/store';

// The car's photo when the source has one, otherwise the drawn car in its paint color.
export function CarArt({ l, height = 120 }: { l: Listing; height?: number }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const photo = !failed && l.photos && l.photos[0];
  return (
    <View style={{ height, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setFailed(true)} transition={150} />
      ) : (
        <View style={{ width: '82%' }}>
          <SvgArt xml={Charts.car(l.body, l.extHex)} aspect={210 / 84} />
        </View>
      )}
    </View>
  );
}

export function CondBadge({ l }: { l: Listing }) {
  const c = useTheme();
  if (l.condition === 'New') return <Badge label="NEW" bg={c.newBg} fg={c.newText} />;
  if (l.condition === 'Certified') return <Badge label="CPO" bg={c.cert} fg="#fff" />;
  return <Badge label="USED" bg={c.used} fg="#fff" />;
}

export function DeltaChip({ l }: { l: Listing }) {
  const c = useTheme();
  const m = marketText(l);
  if (!m) return null;
  return <Text style={{ color: toneColor(c, m.tone), fontWeight: '700', fontSize: 13 }}>{m.label}</Text>;
}

function whereText(l: Listing, showDealer: boolean) {
  const d = distanceTo(l);
  const place = showDealer ? l.dealer : `${l.city}, ${l.state}`;
  return d != null ? `${place} · ${num(d)} mi` : place;
}

export function ListingCard({ l, ribbon, width }: { l: Listing; ribbon?: string; width?: number }) {
  const c = useTheme();
  const s = useAppState();
  const fav = s.favs[l.id] != null;
  const cut = Market.lastChange(l);
  const sub = [l.trim, kMiles(l.miles), l.drivetrain, /manual/i.test(l.transmission || '') ? 'Manual' : null].filter(Boolean).join(' · ');
  const meta = l.sold
    ? `${whereText(l, s.prefs.showDealer)} · Sold ${ago(l.sold.daysAgo)} after ${plural(l.sold.daysToSell, 'day')}`
    : `${whereText(l, s.prefs.showDealer)} · ${daysText(l.daysListed)}`;
  return (
    <Link href={{ pathname: '/car/[id]', params: { id: String(l.id) } }} asChild>
      <Pressable style={({ pressed }) => [styles.card, { width, backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
        accessibilityLabel={`${title(l)} ${l.trim}, ${money(l.price)}`}>
        <View>
          <CarArt l={l} />
          <View style={styles.badges}>
            <CondBadge l={l} />
            {l.seller === 'Private' ? <Badge label="PRIVATE" bg={c.surface} fg={c.text} /> : null}
          </View>
          <Pressable hitSlop={10} onPress={() => toggleFav(l)} accessibilityLabel={fav ? 'Remove from favorites' : 'Add to favorites'} style={[styles.fav, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 16, color: fav ? c.bad : c.muted }}>{fav ? '♥' : '♡'}</Text>
          </Pressable>
          {ribbon ? <View style={[styles.ribbon, { backgroundColor: c.accent }]}><Text style={{ color: c.onInk, fontSize: 11, fontWeight: '800' }}>{ribbon}</Text></View> : null}
        </View>
        <View style={{ padding: Spacing.md, gap: 3 }}>
          <T v="h3" numberOfLines={1}>{title(l)}</T>
          <T v="small" numberOfLines={1}>{sub}</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.sm, marginTop: 2 }}>
            <T v="price">{money(l.price)}</T>
            {l.sold ? null : <DeltaChip l={l} />}
          </View>
          <T v="muted" numberOfLines={2}>
            {meta}
            {cut && cut.delta < 0 && !l.sold ? <Text style={{ color: c.good, fontWeight: '700' }}>{` · ↓ ${money(-cut.delta)}`}</Text> : null}
          </T>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  badges: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', gap: 4 },
  fav: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  ribbon: { position: 'absolute', bottom: 8, left: 8, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
});
