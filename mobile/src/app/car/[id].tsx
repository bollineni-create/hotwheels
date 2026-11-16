import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, FlatList, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CarArt, CondBadge, ListingCard } from '@/components/listing-card';
import { SvgArt } from '@/components/svg-art';
import { Button, Card, ErrorNote, Loading, Row, Section, T, toneColor } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useTheme } from '@/hooks/use-theme';
import { ago, daysText, delta, distanceTo, kMiles, loadCar, markRecent, marketText, money, num, pct, plural, stateTax, title, toggleCompare, toggleFav } from '@/lib/gridline';
import { Charts, Market, VIN, type Listing } from '@/lib/modules';
import { useAppState } from '@/lib/store';

export default function Car() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { data, error } = useAsync(async () => {
    const d = await loadCar(String(id));
    markRecent(d.l.id);
    return d;
  }, String(id));

  return (
    <>
      <Stack.Screen options={{ title: data ? `${data.l.year} ${data.l.model}` : '' }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40, gap: Spacing.xl }} contentInsetAdjustmentBehavior="automatic">
        {error ? <ErrorNote error={error} /> : !data ? <Loading label="Loading listing…" /> : <CarBody l={data.l} comps={data.comps} />}
      </ScrollView>
    </>
  );
}

function CarBody({ l, comps }: { l: Listing; comps: Listing[] }) {
  const c = useTheme();
  const s = useAppState();
  const m = marketText(l);
  const cut = Market.lastChange(l);
  const d = distanceTo(l);
  const fav = s.favs[l.id] != null;
  const inCompare = s.compare.includes(l.id);
  const photos: string[] = (l.photos || []).filter(Boolean);
  const dec = VIN.decode(l.vin) || {};
  const gauge = m ? Math.max(0, Math.min(100, 50 + (m.d / 0.15) * 50)) : 50;
  const similar = comps
    .filter((x) => x.id !== l.id && !x.sold && (x.condition !== 'New' || l.condition === 'New'))
    .sort((a, b) => Math.abs(a.miles - l.miles) / 10000 + Math.abs(a.year - l.year) + delta(a) * 10 - (Math.abs(b.miles - l.miles) / 10000 + Math.abs(b.year - l.year) + delta(b) * 10))
    .slice(0, 6);

  return (
    <>
      <View style={{ borderRadius: 16, overflow: 'hidden', marginHorizontal: -Spacing.sm }}>
        {photos.length > 1 ? (
          <FlatList horizontal pagingEnabled data={photos.slice(0, 12)} keyExtractor={(u, i) => u + i} showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => <Image source={{ uri: item }} style={{ width: 360, height: 240 }} contentFit="cover" />} />
        ) : (
          <CarArt l={l} height={220} />
        )}
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}><CondBadge l={l} /></View>
        <T v="title">{title(l)}</T>
        <T v="small">{[l.trim, kMiles(l.miles), l.drivetrain, l.extColor].filter(Boolean).join(' · ')}</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.md, marginTop: 4 }}>
          <T v="price" style={{ fontSize: 30 }}>{money(l.sold ? l.sold.price : l.price)}</T>
          {m && !l.sold ? <T v="h3" style={{ color: toneColor(c, m.tone) }}>{m.label}</T> : null}
        </View>
        <T v="muted">
          {l.sold ? `Sold ${ago(l.sold.daysAgo)} after ${plural(l.sold.daysToSell, 'day')}` : daysText(l.daysListed)}
          {cut && cut.delta < 0 ? ` · cut ${money(-cut.delta)} ${cut.daysAgo <= 1 ? 'today' : cut.daysAgo + ' days ago'}` : ''}
          {` · ${l.city}, ${l.state}${d != null ? ` · ${num(d)} mi away` : ''}`}
        </T>
      </View>

      <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
        <Button label={fav ? '♥ Saved' : '♡ Save'} kind={fav ? 'primary' : 'ghost'} onPress={() => toggleFav(l)} />
        <Button label={inCompare ? 'In compare' : 'Compare'} kind={inCompare ? 'primary' : 'ghost'} onPress={() => { const msg = toggleCompare(l); if (/up to/.test(msg)) Alert.alert(msg); }} />
        {l.url ? <Button label="Open listing" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(l.url)} /> : null}
      </View>

      {m ? (
        <Card>
          <T v="h2">Price vs. fair value</T>
          <T v="small">{`Fair value for this ${l.year} ${l.model} ${l.trim} with ${kMiles(l.miles)} is about ${money(m.expected)}. It’s listed ${Math.abs(m.d) < 0.01 ? 'right at market' : `${pct(Math.abs(m.d), 1)} ${m.d < 0 ? 'below' : 'above'} that`}.`}</T>
          <View style={{ height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', marginTop: Spacing.sm }}>
            {[c.dGreat, c.dGood, c.dFair, c.dHigh, c.dOver].map((col) => <View key={col} style={{ flex: 1, backgroundColor: col }} />)}
          </View>
          <View style={{ height: 14 }}>
            <View style={{ position: 'absolute', left: `${gauge}%`, marginLeft: -7, top: -12, width: 14, height: 14, borderRadius: 7, backgroundColor: c.ink, borderWidth: 2, borderColor: c.surface }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="muted">Great deal</T><T v="muted">At market</T><T v="muted">Overpriced</T>
          </View>
        </Card>
      ) : null}

      {l.history && l.history.length ? (
        <Card>
          <T v="h2">Price history</T>
          <SvgArt xml={Charts.priceHistory(l.history, { width: 560, height: 200 })} aspect={560 / 200} />
          <T v="muted">{l.history.length > 1 ? `${plural(l.history.length - 1, 'price change')}, first listed at ${money(l.history[0].price)}.` : 'No price changes yet.'}</T>
        </Card>
      ) : null}

      <Card style={{ gap: 0 }}>
        <T v="h2" style={{ marginBottom: Spacing.sm }}>Details</T>
        {([
          ['Mileage', `${num(l.miles)} mi`], ['Trim', l.trim], ['Body', l.body], ['Drivetrain', l.drivetrain], ['Transmission', l.transmission], ['Fuel', l.fuel],
          ['Exterior', l.extColor], ['Interior', l.intColor], ['Seller', l.seller === 'Private' ? 'Private seller' : l.dealer],
          ['Accidents', l.history && l.accidents != null ? String(l.accidents) : null], ['Owners', l.owners != null ? String(l.owners) : null],
          ['Assembly', dec.plant || (l.assembly && [l.assembly.plant, l.assembly.country].filter(Boolean).join(', '))], ['VIN', l.vin],
        ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
      </Card>

      {l.features && l.features.length ? (
        <Card>
          <T v="h2">Features</T>
          <T v="small">{l.features.join(' · ')}</T>
        </Card>
      ) : null}

      {!l.live && l.pricing ? <Pricing l={l} /> : null}

      {similar.length ? (
        <Section title="Similar cars" sub="Same model, within a year, closest in miles and price.">
          <FlatList horizontal data={similar} keyExtractor={(x) => String(x.id)} showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.md }} renderItem={({ item }) => <ListingCard l={item} width={250} />} />
        </Section>
      ) : null}
    </>
  );
}

// What the car costs out the door: the advertised price plus fees, add-ons and tax.
function Pricing({ l }: { l: Listing }) {
  const c = useTheme();
  const p = l.pricing;
  const rate = stateTax(l.state);
  if (l.seller === 'Private') {
    return (
      <Card style={{ gap: 0 }}>
        <T v="h2">Pricing breakdown</T>
        <T v="muted" style={{ marginBottom: Spacing.sm }}>Private sale: no dealer fees or add-ons. You’ll pay tax and registration at the DMV.</T>
        <Row label="Asking price" value={money(l.price)} />
        <Row label={`Est. sales tax (${rate}%)`} value={money((l.price * rate) / 100)} />
        <Row strong label="Est. total" value={money(l.price * (1 + rate / 100))} />
      </Card>
    );
  }
  const conditional = p.incentives.filter((i: any) => i.conditional).reduce((sum: number, i: any) => sum + i.amount, 0);  
  const addOns = p.addOns.reduce((sum: number, a: any) => sum + a.price, 0);  
  const preTax = l.price + conditional + addOns + p.docFee;
  const tax = ((l.price + conditional + addOns) * rate) / 100;
  const gap = conditional + addOns + p.docFee;
  return (
    <Card style={{ gap: 0 }}>
      <T v="h2" style={{ marginBottom: Spacing.sm }}>Pricing breakdown</T>
      {l.condition === 'New' ? <Row label="MSRP" value={money(p.msrp)} /> : null}
      {l.condition === 'New' && p.discount ? <Row label="Dealer discount" value={`−${money(p.discount)}`} valueStyle={{ color: c.good }} /> : null}
      {l.condition === 'New' && p.marketAdjustment ? <Row label="Market adjustment" value={`+${money(p.marketAdjustment)}`} valueStyle={{ color: c.bad }} /> : null}
      <Row label="Advertised price" value={money(l.price)} />
      {p.incentives.map((i: any) => <Row key={i.name} label={`${i.name} (if you qualify)`} value={`+${money(i.amount)}`} valueStyle={{ color: c.warn }} />)  }
      {p.addOns.map((a: any) => <Row key={a.name} label={`${a.name} (add-on)`} value={`+${money(a.price)}`} />)  }
      <Row label="Doc fee" value={`+${money(p.docFee)}`} />
      <Row label={`Est. sales tax (${rate}%)`} value={`+${money(tax)}`} />
      <Row strong label="Est. out the door" value={money(preTax + tax)} />
      {gap > 0 ? <T v="small" style={{ marginTop: Spacing.sm }}>{`Possible price gap: ${money(gap)} on top of the advertised price before tax. Doc fees and add-ons are often negotiable.`}</T> : null}
    </Card>
  );
}
