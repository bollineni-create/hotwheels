const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../js/geo.js');
const Market = require('../js/market.js');
const NLQ = require('../js/nlq.js');
const { generateInventory, MODELS, CITIES } = require('../js/data.js');

test('every 3-digit ZIP prefix puts a ZIP code on the map without a network request', () => {
  assert.ok(Geo.prefixCount() > 850);
  const la = Geo.lookup('90012');
  assert.equal(la.state, 'CA');
  assert.ok(Math.abs(la.lat - 34.05) < 0.3 && Math.abs(la.lng + 118.25) < 0.4, 'downtown LA is where it should be');
  assert.ok(la.approx, 'only the prefix area is known offline');
  assert.equal(Geo.label(la), `${la.place}, CA area`);
  assert.equal(Geo.label(la, { short: true }), `${la.place}, CA`);
  assert.deepEqual(Geo.place('02108').slice(0, 2), ['Boston', 'MA']);
  assert.equal(Geo.lookup('00000'), null, 'an unused prefix is not a ZIP');
  assert.equal(Geo.lookup('9402'), null);
  assert.ok(Geo.isZip('94022') && !Geo.isZip('94022-1') && !Geo.isZip('abcde'));
  assert.equal(Geo.zipIn('trucks near 80202-1234 please'), '80202');
  assert.equal(Geo.zipIn('2019 tacoma'), null);
});

test('the nearest ZIP area to a point is a real ZIP close by', () => {
  const n = Geo.nearest(37.38, -122.11); // Los Altos, CA
  assert.ok(Geo.isZip(n.zip) && Geo.lookup(n.zip), n.zip);
  assert.equal(n.state, 'CA');
  assert.ok(n.miles < 25, `${n.miles} miles`);
});

test('refine pins the exact place from the ZIP service and keeps it, or falls back quietly', async () => {
  Geo._setFetch(async (url) => {
    assert.match(url, /\/us\/94022$/);
    return { ok: true, json: async () => ({ places: [{ 'place name': 'Los Altos', 'state abbreviation': 'CA', latitude: '37.3852', longitude: '-122.1141' }] }) };
  });
  const exact = await Geo.refine('94022');
  assert.equal(exact.place, 'Los Altos');
  assert.equal(exact.approx, false);
  assert.equal(Geo.lookup('94022').place, 'Los Altos', 'remembered for later lookups');
  Geo._setFetch(async () => { throw new Error('offline'); });
  const fallback = await Geo.refine('10001');
  assert.equal(fallback.approx, true);
  assert.equal(fallback.state, 'NY');
});

test('plain-English search understands ZIP codes and a radius', () => {
  const vocab = NLQ.build({ models: MODELS, cities: CITIES, currentYear: 2026 });
  let p = NLQ.parse('4x4 trucks near 94022', vocab);
  assert.equal(p.filters.near, '94022');
  assert.deepEqual(p.filters.body, ['Truck']);
  p = NLQ.parse('within 50 miles of 80202 manual miata under 30k', vocab);
  assert.equal(p.filters.near, '80202');
  assert.equal(p.filters.radius, 50);
  assert.equal(p.filters.priceMax, 30000);
  assert.deepEqual(p.filters.transmission, ['Manual']);
  p = NLQ.parse('rav4 within 100 miles of denver', vocab);
  assert.equal(p.filters.near, 'Denver, CO');
  assert.equal(p.filters.radius, 100);
  p = NLQ.parse('2019 tacoma under 20000', vocab);
  assert.equal(p.filters.near, undefined, 'a price is not a ZIP');
  assert.deepEqual(p.filters.year, ['2019']);
});

test('search filters and sorts by distance from a ZIP code', () => {
  const { listings } = generateInventory({ currentYear: 2026 });
  const ctx = { cityByName: (n) => (Geo.isZip(n) ? Geo.place(n) : null), delta: () => 0 };
  const f = Object.assign(Market.emptyFilters(), { near: '94022', radius: 50 });
  const { results } = Market.search(listings, f, ctx);
  assert.ok(results.length > 0 && results.length < listings.length);
  const o = Geo.place('94022');
  for (const l of results) assert.ok(Market.haversineMiles(o[2], o[3], l.lat, l.lng) <= 50);
  Market.sortListings(results, 'distance', Object.assign({ origin: o }, ctx));
  const d = results.map((l) => Market.haversineMiles(o[2], o[3], l.lat, l.lng));
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1] - 1e-9);
});

test('your market: local stats, best deals, worth-the-drive math and local vs national prices', () => {
  const { listings, sold } = generateInventory({ currentYear: 2026 });
  const fv = Market.buildFairValue(listings.concat(sold), 2026);
  const expected = (l) => fv(l);
  const origin = Geo.place('94022');
  const lm = Market.localMarket(listings, origin, 100, expected);
  assert.ok(lm.stats.count > 0 && lm.stats.count < lm.national.count);
  assert.equal(lm.local.length, lm.stats.count);
  for (const l of lm.local) assert.ok(lm.distance.get(l.id) <= 100);
  assert.ok(lm.stats.medianPrice > 5000 && lm.stats.belowShare > 0 && lm.stats.belowShare < 1);
  const wider = Market.localMarket(listings, origin, 250, expected);
  assert.ok(wider.stats.count >= lm.stats.count);

  const deals = Market.bestDeals(lm.local, expected, { limit: 5, currentYear: 2026 });
  assert.ok(deals.length > 0 && deals.length <= 5);
  for (let i = 1; i < deals.length; i++) assert.ok(deals[i].delta >= deals[i - 1].delta, 'deepest discount first');
  for (const x of deals) {
    assert.ok(x.delta <= -0.03);
    assert.ok(Math.abs(x.saving - (x.expected - x.l.price)) < 1e-6);
    assert.ok(lm.local.includes(x.l));
  }
  const newOnly = Market.bestDeals(lm.local, expected, { condition: 'New', currentYear: 2026 });
  for (const x of newOnly) assert.equal(x.l.condition, 'New');
  const usedOnly = Market.bestDeals(lm.local, expected, { condition: 'Used', currentYear: 2026 });
  for (const x of usedOnly) assert.notEqual(x.l.condition, 'New');

  const drive = Market.worthTheDrive(listings, origin, 100, 500, expected, { limit: 6, currentYear: 2026 });
  assert.ok(drive.length > 0);
  for (const x of drive) {
    assert.ok(x.miles > 100 && x.miles <= 500, `${x.miles} miles is outside the radius but inside the wider market`);
    assert.ok(Math.abs(x.fuel - x.miles * 2 * Market.FUEL_PER_MILE) < 1e-6, 'fuel is a round trip');
    assert.ok(Math.abs(x.net - (x.saving - x.fuel - x.nearbyBest)) < 1e-6);
    assert.ok(x.net > 250, 'only cars that clearly beat the local best');
  }
  for (let i = 1; i < drive.length; i++) assert.ok(drive[i].net <= drive[i - 1].net);

  const vs = Market.localVsNational(listings, origin, 100, { limit: 5 });
  assert.ok(vs.length > 0 && vs.length <= 5);
  for (const r of vs) {
    assert.ok(r.local >= 4 && r.national >= r.local);
    assert.ok(Math.abs(r.diff - (r.localMedian / r.nationalMedian - 1)) < 1e-9);
  }
  const cities = Market.marketCities(listings, origin, 100, expected);
  assert.ok(cities.some((c) => c.inside) && cities.some((c) => !c.inside));
  assert.ok(cities.every((c, i) => i === 0 || c.miles >= cities[i - 1].miles), 'nearest first');
});

test('live listings without coordinates still count as local, and ones with only a reported distance rank by it', () => {
  const origin = Geo.place('94022');
  const mk = (id, extra) => Object.assign({ id, price: 20000, condition: 'Used', miles: 30000, year: 2022, make: 'Honda', model: 'Civic', trim: 'EX', dealer: 'D' + id, daysListed: 10, history: [{ daysAgo: 10, price: 20000 }], lat: null, lng: null, distance: null, city: 'X', state: 'CA' }, extra);
  const pool = [mk('a', {}), mk('b', { distance: 40 }), mk('c', { distance: 300, price: 15000 })];
  const expected = () => 20000;
  const lm = Market.localMarket(pool, origin, 100, expected);
  assert.deepEqual(lm.local.map((l) => l.id), ['a', 'b'], 'no distance means local; 300 miles is not');
  const drive = Market.worthTheDrive(pool, origin, 100, 500, expected, { limit: 3, currentYear: 2026 });
  assert.deepEqual(drive.map((x) => x.l.id), ['c']);
  assert.equal(drive[0].miles, 300);
});
