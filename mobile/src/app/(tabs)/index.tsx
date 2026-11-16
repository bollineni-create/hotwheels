import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { CarArt, ListingCard } from '@/components/listing-card';
import { Screen } from '@/components/screen';
import { SearchBox } from '@/components/search-box';
import { Button, Card, Chip, ErrorNote, Loading, Row, Section, Seg, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useTheme } from '@/hooks/use-theme';
import { WIDE, isLive, kMiles, loadLocal, money, num, pct, plural, sourceName, title, type Cond, type Local } from '@/lib/gridline';
import { Geo, Market, type Listing } from '@/lib/modules';
import { setPrefs, useAppState } from '@/lib/store';

const RADII = [25, 50, 100, 200] as const;
const QUICK = ['Toyota 4Runner under 40k', 'Manual sports cars', 'Electric under 30k', 'Price cuts this week', 'One-owner trucks'];

export default function Home() {
  const s = useAppState();
  const zip = s.prefs.homeZip;
  const radius = Number(s.prefs.homeRadius) || 100;
  return (
    <Screen title="Gridline" sub="See the whole car market: every car for sale and where its price sits against fair value.">
      <SearchBox />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        {QUICK.map((q) => <Chip key={q} label={q} onPress={() => router.push({ pathname: '/search', params: { q } })} />)}
      </View>
      {zip ? <LocalMarket zip={zip} radius={radius} source={s.prefs.dataSource} /> : <ZipForm />}
    </Screen>
  );
}

function ZipForm() {
  const c = useTheme();
  const [zip, setZip] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    if (!Geo.isZip(zip) || !Geo.lookup(zip)) return setErr('Enter a 5-digit US ZIP code.');
    setPrefs({ homeZip: zip });
  };
  return (
    <Card>
      <T v="h2">Your market</T>
      <T v="small">Type your ZIP code to see the best deals near you, and the ones worth the drive.</T>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
        <TextInput value={zip} onChangeText={(t) => { setZip(t.replace(/\D/g, '').slice(0, 5)); setErr(''); }} keyboardType="number-pad" placeholder="ZIP code" placeholderTextColor={c.muted}
          onSubmitEditing={save} maxLength={5}
          style={{ flex: 1, borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17, color: c.text, backgroundColor: c.surface2 }} />
        <Button label="Show me" onPress={save} />
      </View>
      {err ? <T v="small" style={{ color: c.bad }}>{err}</T> : null}
    </Card>
  );
}

function LocalMarket({ zip, radius, source }: { zip: string; radius: number; source: string }) {
  const c = useTheme();
  const [cond, setCond] = useState<Cond>('All');
  const { data: d, error } = useAsync<Local>(() => loadLocal(zip, radius, cond), [zip, radius, cond, source, isLive()].join('|'));

  const g = Geo.lookup(zip);
  const head = (
    <View style={{ gap: Spacing.sm }}>
      <T v="eyebrow">{`${d && d.live ? 'Live · ' : ''}${sourceName()} · within ${radius} miles of ${zip}`}</T>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="h2" style={{ flex: 1 }}>{`Your market: ${Geo.label(g, { short: true })}`}</T>
        <Pressable onPress={() => setPrefs({ homeZip: null })} hitSlop={8}><T v="small" style={{ color: c.link }}>Change</T></Pressable>
      </View>
      <Seg options={RADII} value={(RADII as readonly number[]).includes(radius) ? (radius as (typeof RADII)[number]) : 100} onChange={(r) => setPrefs({ homeRadius: r })} format={(r) => `${r} mi`} />
    </View>
  );
  if (error) return <View style={{ gap: Spacing.md }}>{head}<ErrorNote error={error} /></View>;
  if (!d) return <View style={{ gap: Spacing.md }}>{head}<Loading label="Reading the market near you…" /></View>;

  const st = d.lm.stats;
  const count = d.total != null ? d.total : st.count;
  return (
    <View style={{ gap: Spacing.xl }}>
      {head}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
        <Stat label="Cars for sale" value={num(count)} />
        <Stat label="Median asking" value={money(st.medianPrice)} />
        <Stat label="Median days listed" value={st.medianDays != null ? plural(Math.round(st.medianDays), 'day') : '—'} />
        <Stat label="Below market" value={st.belowShare != null ? pct(st.belowShare) : '—'} />
      </View>

      <Section title="Best deals near you" sub={`Priced furthest below fair value within ${radius} miles.`}>
        <Seg options={['All', 'Used', 'New'] as const} value={cond} onChange={setCond} />
        {d.deals.length ? (
          <FlatList
            horizontal
            data={d.deals}
            keyExtractor={(x: { l: Listing; saving: number }) => String(x.l.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.md, paddingRight: Spacing.lg }}
            style={{ marginHorizontal: -Spacing.lg, paddingLeft: Spacing.lg }}
            renderItem={({ item, index }: { item: { l: Listing; saving: number }; index: number }) => (
              <ListingCard l={item.l} width={260} ribbon={`#${index + 1} · ${money(item.saving)} below`} />
            )}
          />
        ) : (
          <T v="muted">{`No ${cond === 'All' ? '' : cond.toLowerCase() + ' '}cars priced clearly below fair value within ${radius} miles right now. Widen the radius or check “Worth the drive”.`}</T>
        )}
        <Button kind="ghost" label="See every car near you, best price first" onPress={() => router.push({ pathname: '/search', params: { near: zip, radius: String(radius), belowMarket: d.live ? '' : '1' } })} />
      </Section>

      <Section title="Worth the drive" sub={`Cars ${radius}–${num(WIDE)} miles away that still come out ahead after round-trip fuel (about ${Math.round(Market.FUEL_PER_MILE * 100)}¢ a mile) and the best deal on the same model nearby.`}>
        {d.drive.length ? d.drive.map((x: any) => (  
          <Pressable key={x.l.id} onPress={() => router.push({ pathname: '/car/[id]', params: { id: String(x.l.id) } })}>
            <Card style={{ flexDirection: 'row', gap: Spacing.md, alignItems: 'center' }}>
              <View style={{ width: 96, borderRadius: 10, overflow: 'hidden' }}><CarArt l={x.l} height={64} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="h3" numberOfLines={1}>{`${title(x.l)} ${x.l.trim}`}</T>
                <T v="muted" numberOfLines={1}>{`${x.l.city}, ${x.l.state} · ${num(x.miles)} mi · ${kMiles(x.l.miles)} · ${money(x.l.price)}`}</T>
                <T v="small" style={{ color: c.good, fontWeight: '700' }}>{`${money(x.net)} ahead`}</T>
                <T v="muted">{`${money(x.saving)} below fair value − ${money(x.fuel)} fuel${x.nearbyBest ? ` − ${money(x.nearbyBest)} best nearby` : ''}`}</T>
              </View>
            </Card>
          </Pressable>
        )) : <T v="muted">{`Nothing between ${radius} and ${num(WIDE)} miles beats what you can already get nearby.`}</T>}
      </Section>

      {d.vs.length ? (
        <Section title="What your market charges" sub={`Median used asking price near you vs. ${d.live ? 'the wider market' : 'the whole US'}.`}>
          <Card style={{ gap: 0 }}>
            {d.vs.map((r: any) => (  
              <Row key={r.model} label={`${r.model} · ${plural(r.local, 'car')}`} value={`${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${pct(Math.abs(r.diff))}`}
                valueStyle={{ color: r.diff <= -0.03 ? c.good : r.diff >= 0.03 ? c.warn : c.text }} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Price cuts near you this week">
        {d.cuts.length ? (
          <Card style={{ gap: 0 }}>
            {d.cuts.map(({ l, c: cut }: any) => (  
              <Pressable key={l.id} onPress={() => router.push({ pathname: '/car/[id]', params: { id: String(l.id) } })}>
                <Row label={`${title(l)} ${l.trim} · ${l.city}`} value={`↓ ${money(-cut.delta)}`} valueStyle={{ color: c.good }} />
              </Pressable>
            ))}
          </Card>
        ) : <T v="muted">No cuts in the last 7 days within your radius.</T>}
      </Section>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: '45%', padding: Spacing.md, gap: 2 }}>
      <T v="eyebrow">{label}</T>
      <T v="price">{value}</T>
    </Card>
  );
}
