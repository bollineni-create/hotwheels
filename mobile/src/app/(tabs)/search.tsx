import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/listing-card';
import { Button, Chip, ErrorNote, Loading, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useTheme } from '@/hooks/use-theme';
import { applyQuery, describeFilters, emptyFilters, homeZip, isLive, num, runSearch, sourceName, type SearchResult } from '@/lib/gridline';
import type { Filters, Listing } from '@/lib/modules';
import { useAppState } from '@/lib/store';

const PAGE = 24;
const SORTS: [string, string][] = [
  ['best', 'Best deal'], ['price-asc', 'Lowest price'], ['price-desc', 'Highest price'], ['miles-asc', 'Lowest miles'],
  ['year-desc', 'Newest year'], ['newest', 'Just listed'], ['distance', 'Closest'],
];
const TOGGLES: [string, string][] = [['belowMarket', 'Below market'], ['dropsOnly', 'Price cuts'], ['noAccidents', 'No accidents'], ['oneOwner', 'One owner']];
const CONDITIONS = ['New', 'Used', 'Certified'];

type Params = { q?: string; near?: string; radius?: string; belowMarket?: string; dropsOnly?: string };

// Filters from what another screen passed in: a typed query and/or a place.
function filtersFrom(p: Params): Filters {
  let f = emptyFilters();
  if (p.near) f = { ...f, near: p.near, radius: Number(p.radius) || f.radius };
  if (p.belowMarket === '1') f.belowMarket = true;
  if (p.dropsOnly === '1') f.dropsOnly = true;
  if (p.q) f = applyQuery(f, p.q);
  return f;
}

export default function Search() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Params>();
  const source = useAppState().prefs.dataSource;
  const key = JSON.stringify(params);
  // Filters follow what another screen passed in; a new set of params starts over.
  const [base, setBase] = useState(() => ({ key, f: filtersFrom(params) as Filters }));
  const [text, setText] = useState<string>(base.f.q || '');
  if (base.key !== key) {
    const next = filtersFrom(params);
    setBase({ key, f: next });
    setText(next.q || '');
  }
  const f = base.f;
  const setF = (fn: (prev: Filters) => Filters) => setBase((b) => ({ ...b, f: fn(b.f) }));

  const searchKey = JSON.stringify(f) + source + isLive();
  const first = useAsync<SearchResult>(() => runSearch(f), searchKey);
  // Later pages (live) or how many demo rows show, both reset by a new search.
  const [page, setPage] = useState<{ key: string; shown: number; extra: Listing[]; next: number | null | undefined; error?: unknown }>({ key: '', shown: PAGE, extra: [], next: undefined });
  const pg = page.key === searchKey ? page : { key: searchKey, shown: PAGE, extra: [] as Listing[], next: undefined, error: undefined };
  const [more, setMore] = useState(false);
  const res = first.data ? { ...first.data, results: first.data.results.concat(pg.extra), next: pg.next === undefined ? first.data.next : pg.next } : null;
  const error = first.error || pg.error;

  const loadMore = async () => {
    if (!res) return;
    if (!res.live) return setPage({ ...pg, shown: pg.shown + PAGE });
    if (res.next == null || more) return;
    setMore(true);
    try {
      const r = await runSearch(f, res.next);
      setPage({ ...pg, extra: pg.extra.concat(r.results), next: r.next });
    } catch (e) {
      setPage({ ...pg, error: e });
    } finally {
      setMore(false);
    }
  };

  const submit = () => setF((prev) => applyQuery({ ...prev, q: '' }, text));
  const toggle = (k: string) => setF((prev) => ({ ...prev, [k]: !prev[k] }));
  const toggleCond = (v: string) => setF((prev) => ({ ...prev, condition: prev.condition.includes(v) ? prev.condition.filter((x: string) => x !== v) : [...prev.condition, v] }));
  const sorts = useMemo(() => SORTS.filter(([k]) => k !== 'distance' || homeZip() || f.near), [f.near]);
  const rows: Listing[] = res ? (res.live ? res.results : res.results.slice(0, pg.shown)) : [];
  const canMore = res && (res.live ? res.next != null : pg.shown < res.results.length);

  const header = (
    <View style={{ gap: Spacing.md, paddingBottom: Spacing.md }}>
      <T v="title">Search</T>
      <TextInput value={text} onChangeText={setText} onSubmitEditing={submit} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing"
        placeholder="“white 4runner under 40k near 94022”" placeholderTextColor={c.muted}
        style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, fontSize: 16, color: c.text }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
        {sorts.map(([k, label]) => <Chip key={k} label={label} on={f.sort === k} onPress={() => setF((p) => ({ ...p, sort: k }))} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
        {CONDITIONS.map((v) => <Chip key={v} label={v} on={f.condition.includes(v)} onPress={() => toggleCond(v)} />)}
        {TOGGLES.map(([k, label]) => <Chip key={k} label={label} on={!!f[k]} onPress={() => toggle(k)} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm }}>
        <T v="small" style={{ flex: 1 }} numberOfLines={2}>{describeFilters(f)}</T>
        {JSON.stringify(f) !== JSON.stringify(emptyFilters()) ? <Chip label="Clear" onPress={() => { setText(''); setF(() => emptyFilters()); }} /> : null}
      </View>
      {res ? <T v="eyebrow">{`${num(res.total)} cars · ${res.live ? 'live from ' : ''}${sourceName()}`}</T> : null}
      {error ? <ErrorNote error={error} /> : null}
      {!res && !error ? <Loading label="Searching the market…" /> : null}
      {res && !rows.length ? <T v="muted">No cars match. Try removing a filter.</T> : null}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + 96, paddingHorizontal: Spacing.lg, gap: Spacing.md }}
      data={rows}
      keyExtractor={(l) => String(l.id)}
      renderItem={({ item }) => <ListingCard l={item} />}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.6}
      onEndReached={() => { if (res && !res.live) loadMore(); }}
      ListFooterComponent={canMore && res && res.live ? <Button kind="ghost" label={more ? 'Loading…' : 'Load more'} disabled={more} onPress={loadMore} /> : undefined}
    />
  );
}
