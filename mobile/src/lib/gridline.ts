// The market the screens read from: the demo inventory or a live source, fair value,
// and the same derived numbers the website shows. Ported from js/app.js.
import { Geo, Live, Market, MarketData, NLQ, type Filters, type Listing } from '@/lib/modules';
import { getState, update } from '@/lib/store';

export const CURRENT_YEAR = 2026;
export const WIDE = 500; // the larger market around you, in miles
export const ON_PAGE = { priority: Live.PRIORITY.page };

/* ---------- Demo inventory, built the first time something reads it ---------- */

type Demo = { listings: Listing[]; sold: Listing[]; dealers: unknown };
let DEMO: Demo | null = null;
let BY_ID: Map<string, Listing> | null = null;
let FAIR: ((l: Listing) => number | null) | null = null;
const expectedCache = new Map<string, number | null>();

export function demo(): Demo {
  if (!DEMO) DEMO = MarketData.generateInventory({ currentYear: CURRENT_YEAR });
  return DEMO!;
}
const byId = () => BY_ID || (BY_ID = new Map(demo().listings.concat(demo().sold).map((l: Listing) => [l.id, l])));
const fairValue = () => FAIR || (FAIR = Market.buildFairValue(demo().listings.concat(demo().sold), CURRENT_YEAR));

/* ---------- Data source ---------- */

export const source = () => getState().prefs.dataSource || 'demo';
export function syncProvider() {
  if (source() !== 'demo') Live.setProvider(source());
}
export const isLive = () => source() !== 'demo' && !!Live.getKey(source());
export const sourceName = () => (isLive() ? Live.info().name : 'Demo market');

/* ---------- Fair value ---------- */

const LIVE_EXPECTED = new Map<string, number | null>();
const LIVE_SEEN = new Map<string, Listing>();

export function expected(l: Listing): number | null {
  if (l.live) return LIVE_EXPECTED.has(l.id) ? LIVE_EXPECTED.get(l.id)! : null;
  if (!expectedCache.has(l.id)) expectedCache.set(l.id, fairValue()(l));
  return expectedCache.get(l.id)!;
}
export const delta = (l: Listing) => {
  const e = expected(l);
  return e ? l.price / e - 1 : 0;
};
function priceLive(pool: Listing[]) {
  const fv = Live.fairValueFrom(pool, CURRENT_YEAR);
  for (const l of pool) {
    LIVE_EXPECTED.set(l.id, fv(l));
    LIVE_SEEN.set(l.id, l);
  }
}

export type Tone = 'great' | 'good' | 'fair' | 'high' | 'over';
export function marketText(l: Listing) {
  const e = expected(l);
  if (!e) return null;
  const diff = l.price - e;
  const d = l.price / e - 1;
  const tone: Tone = d <= -0.07 ? 'great' : d <= -0.03 ? 'good' : d < 0.03 ? 'fair' : d < 0.07 ? 'high' : 'over';
  const label = Math.abs(d) < 0.01 ? 'At market' : `${money(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'}`;
  return { diff, d, tone, label, expected: e };
}

/* ---------- Places ---------- */

export const homeZip = () => getState().prefs.homeZip || null;
export const homeRadius = () => Number(getState().prefs.homeRadius) || 100;
const cityByName = (name: string) => MarketData.CITIES.find((c: string[]) => `${c[0]}, ${c[1]}` === name);
export const placeOf = (near: string) => (Geo.isZip(near) ? Geo.place(near) : cityByName(near));
export const placeLabel = (near: string) => (Geo.isZip(near) ? `${Geo.label(Geo.lookup(near), { short: true })} ${near}` : near);
export const CTX = {
  delta,
  cityByName: placeOf,
  get origin() {
    const z = homeZip();
    return z ? Geo.place(z) : null;
  },
};
export function distanceTo(l: Listing): number | null {
  const o = CTX.origin;
  return o && l.lat != null ? Market.haversineMiles(o[2], o[3], l.lat, l.lng) : null;
}

/* ---------- Live vocabulary and context ---------- */

const DEMO_MAKES = [...new Set(MarketData.MODELS.map((m: Listing) => m.make))];
const UPFITTERS = [...new Set(Object.values(MarketData.UPFITTERS).flat().map((u: any) => u[0]))];  
const VOCAB = NLQ.build({
  models: MarketData.MODELS, cities: MarketData.CITIES, currentYear: CURRENT_YEAR,
  paints: [...new Set(Object.values(MarketData.PALETTES).flat().map((p: any) => p[0]))],  
  upfitters: UPFITTERS,
});
let LIVE_KNOWN: any = null;  
let LIVE_VOCAB: unknown = null;
const liveCtx = () => ({
  cityByName: placeOf,
  zipFor: (c: string) => (Geo.isZip(c) ? c : null),
  home: CTX.origin,
  makes: [...new Set(DEMO_MAKES.concat((LIVE_KNOWN && LIVE_KNOWN.makes) || []))],
  known: LIVE_KNOWN,
});
export const vocab = () => (isLive() && LIVE_VOCAB) || VOCAB;
async function ensureLiveVocab() {
  if (LIVE_KNOWN) return;
  try {
    LIVE_KNOWN = await Live.vocabulary(ON_PAGE);
    const keys = MarketData.MODELS.map((m: Listing) => `${m.make} ${m.model}`);
    LIVE_VOCAB = NLQ.build({
      models: MarketData.MODELS.concat(LIVE_KNOWN.models.filter((m: string) => !keys.some((k: string) => k.endsWith(' ' + m))).map((m: string) => ({ make: '', model: m, trims: [] }))),
      makes: LIVE_KNOWN.makes, cities: MarketData.CITIES, currentYear: CURRENT_YEAR, paints: [], upfitters: UPFITTERS,
    });
  } catch {
    LIVE_KNOWN = { makes: [], models: [], features: [], upfitters: [] };
  }
}

/* ---------- Cars ---------- */

export function carById(id: string): Listing | null {
  return LIVE_SEEN.get(id) || getState().liveCars[id] || (isLive() && !DEMO ? null : byId().get(id)) || null;
}

// Keep a slim copy of live cars you favorite or compare, so those screens work offline.
export function rememberLive(l: Listing) {
  if (!l || !l.live) return;
  LIVE_SEEN.set(l.id, l);
  const slim = { ...l, photos: (l.photos || []).slice(0, 1), history: l.history.slice(-6), livePricing: null };
  update((s) => {
    s.liveCars[l.id] = slim;
    const keep = new Set([...Object.keys(s.favs), ...s.compare, ...s.recent]);
    const ids = Object.keys(s.liveCars);
    if (ids.length > 80) for (const id of ids) if (!keep.has(id) && Object.keys(s.liveCars).length > 80) delete s.liveCars[id];
  });
}

export async function loadCar(id: string): Promise<{ l: Listing; comps: Listing[] }> {
  const known = carById(id);
  if (known && !known.live) return { l: known, comps: Market.comparables(known, demo().listings, { years: 1 }) };
  // Fetch the full listing; a slim saved copy stands in when offline.
  const l = await Live.listing(id).catch((e: unknown) => {
    if (known) return known;
    throw e;
  });
  const comps: Listing[] = await Live.comparables(l, liveCtx(), { years: 1, condition: 'same' }).catch(() => []);
  priceLive(comps.concat([l]));
  rememberLive(l);
  return { l, comps };
}

export function toggleFav(l: Listing) {
  rememberLive(l);
  update((s) => {
    if (s.favs[l.id] != null) delete s.favs[l.id];
    else s.favs[l.id] = l.price;
  });
}

export function toggleCompare(l: Listing): string {
  rememberLive(l);
  let msg = '';
  update((s) => {
    if (s.compare.includes(l.id)) {
      s.compare = s.compare.filter((x) => x !== l.id);
      msg = 'Removed from compare';
    } else if (s.compare.length >= 4) msg = 'You can compare up to 4 cars';
    else {
      s.compare.push(l.id);
      msg = `Added to compare (${s.compare.length}/4)`;
    }
  });
  return msg;
}

export function markRecent(id: string) {
  update((s) => { s.recent = [id, ...s.recent.filter((x) => x !== id)].slice(0, 12); });
}

/* ---------- Search ---------- */

export const emptyFilters = (): Filters => Market.emptyFilters();

// Fold a typed query ("white 4runner under 40k near 94022") into filters.
export function applyQuery(f: Filters, text: string): Filters {
  const parsed = NLQ.parse(text, vocab());
  const p = parsed.filters;
  const out = { ...f, ex: { ...f.ex } };
  for (const k of Market.FACETS) if (p[k]) out[k] = [...new Set([...(out[k] || []), ...p[k]])];
  for (const [k, vals] of Object.entries(p.ex || {})) out.ex[k] = [...new Set([...(out.ex[k] || []), ...(vals as string[])])];
  for (const k of ['priceMin', 'priceMax', 'milesMax', 'near', 'sort']) if (p[k] != null) out[k] = p[k];
  for (const k of ['dropsOnly', 'belowMarket', 'noAccidents', 'oneOwner']) if (p[k]) out[k] = true;
  out.q = parsed.understood.length ? parsed.rest : text.trim();
  return out;
}

export type SearchResult = { results: Listing[]; total: number; next: number | null; live: boolean };

export async function runSearch(f: Filters, offset = 0): Promise<SearchResult> {
  if (!isLive()) {
    const { results } = Market.search(demo().listings, f, CTX);
    return { results, total: results.length, next: null, live: false };
  }
  await ensureLiveVocab();
  const r = await Live.search(f, liveCtx(), { offset, ...ON_PAGE });
  priceLive(r.results);
  return { results: r.results, total: r.total ?? r.results.length, next: r.nextOffset ?? null, live: true };
}

export function describeFilters(f: Filters): string {
  const parts: string[] = [];
  const list = (k: string) => (f[k] && f[k].length ? f[k].join(', ') : null);
  if (f.condition.length) parts.push(f.condition.join('/'));
  if (f.year.length) parts.push(f.year.length > 2 ? `${f.year[0]}–${f.year[f.year.length - 1]}` : f.year.join(', '));
  if (f.model.length) parts.push(f.model.join(', '));
  else if (f.make.length) parts.push(f.make.join(', '));
  for (const k of ['trim', 'body', 'fuel', 'drivetrain', 'transmission', 'colorFamily', 'extColor']) { const v = list(k); if (v) parts.push(v); }
  if (f.features.length) parts.push(`with ${f.features.join(', ')}`);
  if (f.q) parts.push(`“${f.q}”`);
  if (f.priceMin != null) parts.push(`over ${money(f.priceMin)}`);
  if (f.priceMax != null) parts.push(`under ${money(f.priceMax)}`);
  if (f.milesMax != null) parts.push(`< ${kMiles(f.milesMax)}`);
  if (f.near) parts.push(`within ${f.radius} mi of ${placeLabel(f.near)}`);
  if (f.state.length) parts.push(`in ${f.state.join(', ')}`);
  if (f.dropsOnly) parts.push('with price cuts');
  if (f.belowMarket) parts.push('below market');
  if (f.noAccidents) parts.push('no accidents');
  if (f.oneOwner) parts.push('one owner');
  return parts.join(' · ') || 'All cars';
}

/* ---------- Your local market ---------- */

export type Cond = 'All' | 'Used' | 'New';

function localData(zip: string, radius: number, pool: Listing[], wide: Listing[] | null, cond: Cond) {
  const origin = Geo.place(zip);
  const lm = Market.localMarket(pool, origin, radius, expected);
  const all = wide ? pool.concat(wide.filter((l) => !pool.includes(l))) : pool;
  return {
    origin, lm,
    deals: Market.bestDeals(lm.local, expected, { limit: 10, condition: cond, currentYear: CURRENT_YEAR }),
    drive: Market.worthTheDrive(all, origin, radius, WIDE, expected, { limit: 6, currentYear: CURRENT_YEAR }),
    vs: Market.localVsNational(all, origin, radius, { limit: 8 }),
    cuts: Market.recentDrops(lm.local, 7).slice(0, 6),
  };
}
export type Local = ReturnType<typeof localData> & { live: boolean; total: number | null };

export async function loadLocal(zip: string, radius: number, cond: Cond): Promise<Local> {
  if (!isLive()) return { ...localData(zip, radius, demo().listings, null, cond), live: false, total: null };
  const ctx = liveCtx();
  const near = (r: number) => ({ ...Market.emptyFilters(), near: zip, radius: r, sort: 'newest' });
  const [local, wide] = await Promise.all([
    Live.search(near(radius), ctx, ON_PAGE),
    Live.search(near(WIDE), ctx, { lite: true, ...ON_PAGE }).catch(() => ({ results: [] })),
  ]);
  const pool = [...new Map(local.results.concat(wide.results).map((l: Listing) => [l.id, l])).values()];
  priceLive(pool);
  const d = localData(zip, radius, local.results, wide.results, cond);
  if (local.stats) {
    if (local.stats.medianPrice) d.lm.stats.medianPrice = local.stats.medianPrice;
    if (local.stats.avgDays != null) d.lm.stats.medianDays = local.stats.avgDays;
  }
  return { ...d, live: true, total: local.total ?? null };
}

/* ---------- Out-the-door estimate ---------- */

const STATE_TAX: Record<string, number> = { CA: 8.8, NY: 8.5, TX: 6.25, FL: 7, GA: 7, NC: 3, IL: 8.25, OH: 7.2, PA: 6, MI: 6, CO: 7.7, AZ: 8.4, WA: 9.3, MN: 6.9,
  OR: 0, MA: 6.25, NJ: 6.6, VA: 4.15, TN: 9.5, IN: 7, MO: 8.2, MD: 6, WI: 5.4, SC: 5, AL: 4, LA: 9.5, KY: 6, OK: 3.25, UT: 7.2, NV: 8.2 };
export const stateTax = (st: string) => (STATE_TAX[st] != null ? STATE_TAX[st] : 6.5);

/* ---------- Formatting ---------- */

export const money = (n: number | null | undefined) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'));
export const num = (n: number) => Math.round(n).toLocaleString('en-US');
export const kMiles = (n: number) => (n < 1000 ? `${num(n)} mi` : `${Math.round(n / 1000)}k mi`);
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const title = (l: Listing) => `${l.year} ${l.make} ${l.model}`;
export const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? '' : /(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`;
export const ago = (d: number) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
export const daysText = (d: number) => (d === 0 ? 'Listed today' : d === 1 ? '1 day for sale' : `${d} days for sale`);
