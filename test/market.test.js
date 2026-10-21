const test = require('node:test');
const assert = require('node:assert/strict');
const VIN = require('../js/vin.js');
const { generateInventory } = require('../js/data.js');
const Market = require('../js/market.js');

const { listings } = generateInventory();

test('VIN check digit and decoding', () => {
  // Textbook example VIN from 49 CFR 565
  assert.equal(VIN.checkDigit('1M8GDM9AXKP042788'), 'X');
  assert.ok(VIN.isValid('1M8GDM9AXKP042788'));
  assert.ok(!VIN.isValid('1M8GDM9A1KP042788'));
  const d = VIN.decode('1HGCM82633A004352');
  assert.equal(d.valid, true);
  assert.equal(d.make, 'Honda');
  assert.equal(d.year, 2003);
  assert.match(VIN.decode('1HGCM82633A00435').errors[0], /17 characters/);
  assert.match(VIN.decode('1HGCM8263OA004352').errors[0], /I, O or Q/);
});

test('inventory is deterministic and every VIN is valid for its year', () => {
  const again = generateInventory().listings;
  assert.deepEqual(again.slice(0, 20), listings.slice(0, 20));
  for (const l of listings) {
    assert.ok(VIN.isValid(l.vin), l.vin);
    assert.equal(VIN.modelYear(l.vin), l.year);
  }
});

test('price history ends at the current price and only goes down', () => {
  for (const l of listings) {
    const h = l.history;
    assert.equal(h[0].daysAgo, l.daysListed);
    assert.equal(h[h.length - 1].price, l.price);
    for (let i = 1; i < h.length; i++) {
      assert.ok(h[i].daysAgo < h[i - 1].daysAgo);
      assert.ok(h[i].price < h[i - 1].price);
    }
  }
});

test('facet counts equal the result count you get by picking that option', () => {
  const f = Market.emptyFilters();
  f.body = ['SUV'];
  f.priceMax = 40000;
  const { facets } = Market.search(listings, f, { delta: () => 0 });
  for (const { value, count } of facets.make) {
    const picked = Object.assign(Market.emptyFilters(), f, { make: [value] });
    assert.equal(Market.search(listings, picked, { delta: () => 0 }).results.length, count, value);
  }
});

test('fair value tracks prices closely for used cars', () => {
  const fv = Market.buildFairValue(listings, 2026);
  const deltas = listings.filter((l) => l.condition !== 'New').map((l) => l.price / fv(l) - 1);
  assert.ok(Math.abs(Market.median(deltas)) < 0.03);
  assert.ok(deltas.every((d) => Math.abs(d) < 0.6));
});

test('linear fit recovers a known line', () => {
  const fit = Market.linearFit([[0, 1], [1, 3], [2, 5]]);
  assert.equal(fit.slope, 2);
  assert.equal(fit.intercept, 1);
});

test('weekly insights produce content', () => {
  assert.ok(Market.arrivals(listings, 2026).total > 0);
  assert.ok(Market.priceMovers(listings, 20).length > 0);
  assert.ok(Market.retention(listings, 'Compact SUV', 2026).length >= 3);
  // The home page follows residual value over 3 years: one share of MSRP per year, best keeper first.
  const three = Market.retention(listings, 'Compact SUV', 2026, 3);
  assert.ok(three.length >= 3);
  for (const r of three) {
    assert.equal(r.byAge.length, 3);
    for (const v of r.byAge) assert.ok(v > 0 && v < 1.5);
    assert.ok(r.msrp > 0 && r.avgList > 0 && r.avgMiles > 0);
  }
  for (let i = 1; i < three.length; i++) assert.ok(three[i - 1].byAge[2] >= three[i].byAge[2], 'best 3-year keeper first');
  assert.ok(Market.rareSpecs(listings, Market.colorStats(listings), 8).length > 0);
});

const NLQ = require('../js/nlq.js');
const data = generateInventory();
const vocab = NLQ.build({ models: data.models, cities: data.cities, paints: [...new Set(listings.map((l) => l.extColor))], upfitters: ['Roush', 'Rocky Ridge'] });

test('natural-language search understands common phrasing', () => {
  const r = NLQ.parse('red convertibles under 40k with leather seats', vocab);
  assert.deepEqual(r.filters.body, ['Convertible']);
  assert.deepEqual(r.filters.colorFamily, ['Red']);
  assert.deepEqual(r.filters.features, ['Leather Seats']);
  assert.equal(r.filters.priceMax, 40000);
  assert.equal(r.rest, '');

  const t = NLQ.parse('4x4 trucks under 50k miles near denver', vocab);
  assert.equal(t.filters.milesMax, 50000);
  assert.equal(t.filters.priceMax, undefined);
  assert.equal(t.filters.near, 'Denver, CO');
  assert.deepEqual(t.filters.drivetrain, ['4WD']);

  const x = NLQ.parse('used rav4 hybrid 2021+ without sunroof', vocab);
  assert.deepEqual(x.filters.model, ['Toyota RAV4']);
  assert.deepEqual(x.filters.ex.features, ['Sunroof/Moonroof']);
  assert.ok(x.filters.year.includes('2021') && !x.filters.year.includes('2020'));
});

test('VIN patterns support prefixes and single-character wildcards', () => {
  assert.ok(Market.vinMatches('5TFAB5DB1MX123456', '5TF'));
  assert.ok(Market.vinMatches('5TFAB5DB1MX123456', '5TF*B5D?'));
  assert.ok(!Market.vinMatches('5TFAB5DB1MX123456', '5TG'));
  assert.ok(Market.vinMatches('5TFAB5DB1MX123456', ''));
});

test('exclude filters drop matching cars and multi-value filters require all values', () => {
  const ctx = { delta: () => 0 };
  const all = Market.search(listings, Market.emptyFilters(), ctx).results.length;
  const f = Market.emptyFilters();
  f.ex = { features: ['Sunroof/Moonroof'] };
  const without = Market.search(listings, f, ctx).results;
  assert.ok(without.length < all && without.every((l) => !l.features.includes('Sunroof/Moonroof')));
  const g = Market.emptyFilters();
  g.features = ['Heated Seats', 'Navigation'];
  assert.ok(Market.search(listings, g, ctx).results.every((l) => l.features.includes('Heated Seats') && l.features.includes('Navigation')));
});

test('past-date snapshots and sold data are consistent', () => {
  const { sold } = data;
  assert.ok(sold.length > 0 && sold.every((l) => l.sold.daysToSell >= 1 && l.history[0].daysAgo === l.daysListed));
  const snap = Market.snapshot(listings, sold, 30);
  for (const l of snap) {
    assert.ok(l.daysListed >= 0);
    assert.equal(l.history[l.history.length - 1].price, l.price);
  }
  const series = Market.inventorySeries(listings, sold, Market.emptyFilters(), { delta: () => 0 }, 30).series;
  assert.equal(series[series.length - 1].count, listings.length);
  assert.equal(series[0].count, snap.length);
});

test('Deal Check totals a deal and flags a high doc fee', () => {
  const r = Market.dealCheck({ price: 30000, addOns: 1000, docFee: 999, otherFees: 0, taxRate: 10, tradeIn: 5000, tradeOwed: 0, down: 0, apr: 0, term: 60, tradeTaxCredit: true },
    { expected: 30000, compPrices: [], typicalDocFee: 300, isNew: false });
  assert.equal(r.tax, 2600);
  assert.equal(r.outTheDoor, 30000 + 1000 + 999 + 2600);
  assert.equal(Math.round(r.payment), Math.round((r.outTheDoor - 5000) / 60));
  assert.ok(r.flags.some((f) => /Doc fee/.test(f.text)));
});

const Live = require('../js/live.js');
global.Market = Market;

test('live mode maps Gridline filters to Visor API parameters', () => {
  const ctx = { cityByName: (n) => (n === 'Denver, CO' ? ['Denver', 'CO', 39.74, -104.99] : null), makes: ['Toyota', 'Ford'], known: { bodies: ['SUV', 'Pickup Truck', 'Chassis Cab Truck'], features: ['heated_seats', 'leather_seats'] } };
  const f = Object.assign(Market.emptyFilters(), {
    condition: ['Used', 'Certified'], model: ['Toyota RAV4'], body: ['Truck'], features: ['Leather Seats'], fuel: ['Electric'], seller: ['Franchise'],
    assembly: ['Georgetown, KY', 'Woodstock, ON'], upfitter: ['Rocky Ridge'], priceMax: 30000, milesMax: 50000, msrpMin: 20000,
    vin: '5TF*B5D', near: 'Denver, CO', radius: 900, sort: 'discount', when: 'sold', ex: { features: ['Sunroof/Moonroof'], colorFamily: ['Red'] },
  });
  Live.setProvider('visor');
  const p = Live.toParams(f, ctx);
  assert.equal(p.inventory_type, 'used,certified');
  assert.equal(p.make, 'Toyota');
  assert.equal(p.model, 'RAV4');
  assert.equal(p.body_type, 'Pickup Truck,Chassis Cab Truck');
  assert.equal(p.features, 'leather_seats');
  assert.equal(p.fuel_type, 'Full Electric');
  assert.equal(p.dealer_type, 'franchise');
  assert.equal(p.assembly_location, 'Georgetown, KY|Woodstock, ON');
  assert.equal(p.upfitter, 'rocky_ridge');
  assert.equal(p.exclude_base_exterior_color, 'Red');
  assert.equal(p.vin_pattern, '5TF?B5D');
  assert.equal(p.radius, 500);
  assert.equal(p.latitude, 39.74);
  assert.equal(p.inventory_status, 'sold');
  assert.equal(p.max_price, 30000);
  assert.equal(p.max_mileage, 50000);
  assert.equal(p.min_msrp, 20000);
  const snap = Live.toParams(Object.assign(Market.emptyFilters(), { when: '30' }), ctx);
  assert.match(snap.snapshot_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('live mode turns Visor records into Gridline listings', () => {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().replace('T', ' ').replace('Z', '000');
  const l = Live.normalize({
    id: 'abc', vin: '5TFAB5DB1MX123456', year: 2021, make: 'Toyota', model: 'Tundra', trim: 'SR5', body_type: 'Pickup Truck', drivetrain: '4WD',
    fuel_type: 'Gas only', base_exterior_color: 'Red', exterior_color: 'Barcelona Red', msrp: 45000, discount_from_msrp: -0.1, price: 40500, miles: 30000,
    days_on_market: 20, status: 'active', availability_status: 'transit', inventory_type: 'certified', dealer_name: 'Denver Toyota', dealer_type: 'franchise',
    city: 'Denver', state: 'CO', latitude: 39.7, longitude: -105, photo_urls: ['https://x/1.jpg'], features: ['heated_seats'], upfitters: ['rocky_ridge'],
    price_history: [{ changed_at: day(10), price_before: 41500, price_after: 40500 }],
  });
  assert.equal(l.live, true);
  assert.equal(l.condition, 'Certified');
  assert.equal(l.status, 'In transit');
  assert.equal(l.body, 'Truck');
  assert.equal(l.fuel, 'Gas');
  assert.equal(l.seller, 'Franchise');
  assert.equal(l.upfitter.name, 'Rocky Ridge');
  assert.deepEqual(l.history.map((h) => h.price), [41500, 40500]);
  assert.equal(l.history[0].daysAgo, 20);
  assert.equal(l.history[1].daysAgo, 10);
  const sold = Live.normalize({ id: 's', vin: 'X', status: 'sold', sold_date: day(5).slice(0, 10), days_on_market: 12, price: 20000, inventory_type: 'used' });
  assert.equal(sold.sold.daysToSell, 12);
  assert.ok(sold.sold.daysAgo >= 4 && sold.sold.daysAgo <= 6);
  assert.deepEqual(Live.bucketsOf([{ value: 'Toyota', count: 5 }]).map((b) => b.value), ['Toyota']);
  assert.deepEqual(Live.bucketsOf({ Toyota: 5, Honda: 3 }).map((b) => b.count), [5, 3]);
});

test('mock Visor server rejects bad keys and filters like the real API', async () => {
  const http = require('http');
  const { handle, KEY } = require('./mock-visor.js');
  const server = http.createServer(handle).listen(0);
  const port = server.address().port;
  const get = (path, key) => new Promise((resolve) => http.get({ port, path, headers: key ? { Authorization: `Bearer ${key}` } : {} }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }));
  }));
  assert.equal((await get('/v1/listings?limit=1', 'nope')).status, 401);
  const r = await get('/v1/listings?make=Toyota&model=RAV4&max_price=25000&limit=100&sort=price', KEY);
  assert.equal(r.status, 200);
  assert.ok(r.json.data.length > 0 && r.json.data.every((x) => x.model === 'RAV4' && x.price <= 25000));
  assert.ok(r.json.data.every((x, i, a) => i === 0 || a[i - 1].price <= x.price));
  server.close();
});

test('free auto.dev mode maps filters and records', () => {
  const ctx = { cityByName: () => ['Denver', 'CO', 39.7, -105], zipFor: () => '80202', makes: ['Toyota'], known: { bodies: ['SUV', 'Pickup', 'Sedan'] } };
  const p = Live.adToParams(Object.assign(Market.emptyFilters(), {
    model: ['Toyota RAV4'], body: ['Truck'], condition: ['Certified'], year: ['2020', '2021', '2022'], fuel: ['Gas'],
    priceMin: 10000, priceMax: 30000, milesMax: 60000, near: 'Denver, CO', radius: 900, sort: 'price-asc',
  }), ctx);
  assert.equal(p['vehicle.make'], 'Toyota');
  assert.equal(p['vehicle.model'], 'RAV4');
  assert.equal(p['vehicle.bodyStyle'], 'Pickup');
  assert.equal(p['retailListing.cpo'], 'true');
  assert.equal(p['vehicle.year'], '2020-2022');
  assert.equal(p['vehicle.fuel'], 'Gasoline');
  assert.equal(p['retailListing.price'], '10000-30000');
  assert.equal(p['retailListing.miles'], '0-60000');
  assert.equal(p.zip, '80202');
  assert.equal(p.distance, 500);
  assert.equal(p.sort, 'price.asc');
  assert.equal(Live.adToParams(Object.assign(Market.emptyFilters(), { condition: ['New'] }), ctx)['retailListing.used'], 'false');

  const l = Live.adNormalize({
    vin: '5TFAB5DB1MX123456', location: [-105, 39.7], createdAt: new Date(Date.now() - 5 * 864e5).toISOString().replace('T', ' ').slice(0, 19),
    vehicle: { year: 2021, make: 'Toyota', model: 'Tundra', trim: 'SR5', drivetrain: '4WD', fuel: 'Gasoline', bodyStyle: 'Pickup', exteriorColor: 'Super White' },
    retailListing: { price: 40500, miles: 30000, used: true, cpo: false, dealer: 'Denver Toyota', city: 'Denver', state: 'CO', zip: '80202',
      primaryImage: 'https://retail.photos.vin/x-1.jpg', photoCount: 12, vdp: 'https://dealer/x', carfaxUrl: 'https://carfax/x' },
    history: { accidents: false, ownerCount: 1 },
  });
  assert.equal(l.condition, 'Used');
  assert.equal(l.body, 'Truck');
  assert.equal(l.fuel, 'Gas');
  assert.equal(l.daysListed, 5);
  assert.equal(l.lat, 39.7);
  assert.equal(l.accidents, false);
  assert.equal(l.photoCount, 12);
  assert.deepEqual(Live.adBuckets({ 'Toyota (12)': 'u', 'Honda (3)': 'u' }), [{ value: 'Toyota', count: 12 }, { value: 'Honda', count: 3 }]);
});

test('mock auto.dev enforces the free plan page size and rejects unknown parameters', async () => {
  const http = require('http');
  const { handle, KEY } = require('./mock-autodev.js');
  const server = http.createServer(handle).listen(0);
  const port = server.address().port;
  const get = (path) => new Promise((resolve) => http.get({ port, path, headers: { Authorization: `Bearer ${KEY}` } }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }));
  }));
  const r = await get('/listings?vehicle.make=Toyota&limit=100&includes=total,facets');
  assert.equal(r.json.data.length, 20);
  assert.ok(r.json.total > 20 && r.json.facets.makes['Toyota (' + r.json.total + ')']);
  assert.equal((await get('/listings?make=Toyota')).status, 400);
  server.close();
});

test('transmission is a filter, and "manual" or "stick" in a search asks for it', () => {
  assert.ok(Market.FACETS.includes('transmission'));
  const ctx = { delta: () => 0 };
  const f = Object.assign(Market.emptyFilters(), { transmission: ['Manual'] });
  const { results, facets } = Market.search(listings, f, ctx);
  assert.ok(results.length > 0 && results.every((l) => l.transmission === 'Manual'));
  // A facet's own pick doesn't narrow its counts.
  assert.ok(facets.transmission.find((x) => x.value === 'Automatic').count > 0);
  // Hybrids and EVs never come with a manual; Civic Si and Type R always do.
  assert.ok(listings.every((l) => l.transmission !== 'Manual' || l.fuel === 'Gas'));
  assert.ok(listings.filter((l) => l.model === 'Civic' && ['Si', 'Type R'].includes(l.trim)).every((l) => l.transmission === 'Manual'));

  assert.deepEqual(NLQ.parse('manual miata under 30k', vocab).filters.transmission, ['Manual']);
  assert.deepEqual(NLQ.parse('6-speed manual mustang gt', vocab).filters.transmission, ['Manual']);
  const stick = NLQ.parse('stick shift wrangler', vocab);
  assert.deepEqual(stick.filters.transmission, ['Manual']);
  assert.deepEqual(stick.filters.model, ['Jeep Wrangler']);
  assert.equal(stick.rest, '');
  assert.deepEqual(NLQ.parse('subaru outback no cvt', vocab).filters.ex.transmission, ['CVT']);
});

test('live modes send the transmission filter in each API’s own terms', () => {
  Live.setProvider('visor');
  const f = Object.assign(Market.emptyFilters(), { transmission: ['Manual'], ex: { transmission: ['CVT'] } });
  const p = Live.toParams(f, { makes: [], cityByName: () => null });
  assert.equal(p.transmission, 'Manual');
  assert.equal(p.exclude_transmission, 'CVT');
  const ad = Live.adToParams(f, { makes: [], cityByName: () => null, known: { transmissions: ['Automatic', '6-Speed Manual', '5-Speed Manual', 'Automatic CVT'] } });
  assert.equal(ad['vehicle.transmission'], '6-Speed Manual,5-Speed Manual');
  Live.setProvider('autodev');
});

test('a hunt reports new matches, price cuts and cars that are gone', () => {
  const car = (id, price) => ({ id, price });
  const seen = { a: 30000, b: 25000, c: 20000 };
  const d = Market.huntDiff(seen, [car('a', 30000), car('b', 23900), car('d', 27000)], { complete: true });
  assert.deepEqual(d.added.map((l) => l.id), ['d']);
  assert.deepEqual(d.cut.map((c) => [c.l.id, c.from, c.to]), [['b', 25000, 23900]]);
  assert.deepEqual(d.gone, ['c']);
  assert.deepEqual(d.seen, { a: 30000, b: 23900, d: 27000 });
  // One page of live results: a car not on it may be on the next page, so it isn't gone.
  const partial = Market.huntDiff(seen, [car('a', 29500)], { complete: false });
  assert.deepEqual(partial.gone, []);
  assert.equal(partial.cut.length, 1);
  assert.deepEqual(Object.keys(partial.seen).sort(), ['a', 'b', 'c']);
  // A price rise is not news.
  assert.equal(Market.huntDiff({ a: 100 }, [car('a', 120)], { complete: true }).cut.length, 0);
});

test('a demo hunt started a week ago finds that week’s new listings and sales', () => {
  const f = Object.assign(Market.emptyFilters(), { model: ['Mazda MX-5 Miata'] });
  const ctx = { delta: () => 0 };
  const weekAgo = Market.snapshot(listings, data.sold, 7);
  const seen = Object.fromEntries(Market.search(weekAgo, f, ctx).results.map((l) => [l.id, l.price]));
  const d = Market.huntDiff(seen, Market.search(listings, f, ctx).results, { complete: true });
  assert.ok(d.added.length > 0 && d.added.every((l) => l.daysListed < 7));
  assert.ok(d.gone.length > 0 && d.gone.every((id) => data.sold.find((l) => l.id === id).sold.daysAgo < 7));
  assert.ok(d.cut.every((c) => c.to < c.from));
});

test('hunt stats say how often a car comes up and how fast it sells', () => {
  const fv = Market.buildFairValue(listings, 2026);
  const ctx = { delta: (l) => { const e = fv(l); return e ? l.price / e - 1 : 0; } };
  const rare = Market.huntStats(listings, data.sold, Object.assign(Market.emptyFilters(), { model: ['Honda Civic'], trim: ['Type R'] }), ctx);
  const common = Market.huntStats(listings, data.sold, Object.assign(Market.emptyFilters(), { model: ['Ford F-150'] }), ctx);
  assert.ok(rare.perMonth < common.perMonth);
  assert.ok(common.forSale > 0 && common.sold > 0 && common.medianDaysToSell > 0);
  assert.equal(common.rarity, 'Common');
  assert.ok(common.best && ctx.delta(common.best) < 0);
  assert.equal(Market.rarityLabel(0.5), 'Very rare');
});

test('fair value learns what a manual is worth instead of calling it overpriced', () => {
  const pool = listings.concat(data.sold);
  const plain = (() => {
    // The old model: age and mileage only.
    const fv = Market.buildFairValue(pool, 2026);
    return (l) => fv.explain(l) && fv.explain(l).base;
  })();
  const fv = Market.buildFairValue(pool, 2026);
  const manuals = listings.filter((l) => l.condition !== 'New' && l.transmission === 'Manual' && ['Mustang', 'Tacoma'].includes(l.model));
  const before = Market.median(manuals.map((l) => l.price / plain(l) - 1));
  const after = Market.median(manuals.map((l) => l.price / fv(l) - 1));
  assert.ok(before > 0.02, `manuals looked ${before} over market`);
  assert.ok(Math.abs(after) < Math.abs(before) / 2, `still ${after} after spec premiums`);
  const e = fv.explain(manuals[0]);
  const adj = e.adjustments.find((a) => a.key === 'transmission');
  assert.equal(adj.value, 'Manual');
  assert.ok(adj.amount > 0 && adj.n >= 4);
  assert.equal(Math.round(e.base + e.adjustments.reduce((s, a) => s + a.amount, 0)), Math.round(e.expected));
  // Noise isn't a premium: a model with no real paint effect gets few or none.
  const paints = new Set(pool.filter((l) => l.condition !== 'New').flatMap((l) => (fv.explain(l) || { adjustments: [] }).adjustments).filter((a) => a.key === 'extColor').map((a) => a.value));
  assert.ok(paints.size <= 3, [...paints].join(', '));
});

test('live home page sizes the market near home, and a hunt, in one request each', async () => {
  const http = require('http');
  const { handle, KEY } = require('./mock-visor.js');
  const Live = require('../js/live.js');
  const server = http.createServer(handle).listen(0);
  const { cities } = generateInventory();
  const prevBase = Live.PROVIDERS.visor.base;
  Live.PROVIDERS.visor.base = `http://127.0.0.1:${server.address().port}`;
  globalThis.gridlineDesktop = { defaultKeys: { visor: KEY } }; // a built-in key, as in the desktop app
  try {
    Live.setProvider('visor');
    const ctx = { cityByName: (n) => cities.find((c) => `${c[0]}, ${c[1]}` === n) || null, makes: ['Toyota'], known: null };
    const near = await Live.summary(Object.assign(Market.emptyFilters(), { near: 'Denver, CO', radius: 150 }), ctx);
    const all = await Live.summary(Market.emptyFilters(), ctx);
    assert.ok(near.total > 0 && near.total < all.total, `${near.total} near Denver of ${all.total}`);
    assert.ok(near.medianPrice > 0 && near.medianDays >= 0 && near.medianMiles >= 0);
    assert.equal(all.total, listings.length);
    // A hunt's count matches counting the synthetic market by hand.
    const hunt = await Live.summary(Object.assign(Market.emptyFilters(), { model: ['Toyota RAV4'], priceMax: 30000 }), ctx);
    assert.equal(hunt.total, listings.filter((l) => l.make === 'Toyota' && l.model === 'RAV4' && l.price <= 30000).length);
    // Sold cars near home, for days of supply.
    const sold = await Live.summary(Object.assign(Market.emptyFilters(), { near: 'Denver, CO', radius: 150 }), ctx, { inventory_status: 'sold', sold_within_days: 30 });
    assert.ok(sold.total > 0 && sold.total < near.total);
  } finally {
    server.close();
    Live.PROVIDERS.visor.base = prevBase;
    delete globalThis.gridlineDesktop;
  }
});

test('make momentum compares the last 30 days of sales with the 30 before', () => {
  const { sold } = generateInventory();
  const rows = Market.makeMomentum(sold, 30, 20);
  assert.ok(rows.length > 3);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].change >= rows[i].change, 'sorted by change');
  const top = rows[0];
  const now = sold.filter((l) => l.make === top.make && l.sold.daysAgo < 30).length;
  const before = sold.filter((l) => l.make === top.make && l.sold.daysAgo >= 30 && l.sold.daysAgo < 60).length;
  assert.equal(top.now, now);
  assert.equal(top.before, before);
  assert.ok(Math.abs(top.change - (now / before - 1)) < 1e-9);
  assert.equal(top.models.reduce((s, m) => s + m.now, 0), now, 'models add up to the make');
  assert.equal(Object.values(top.byState).reduce((s, x) => s + x.now, 0), now, 'states add up to the make');
});

test('time capsules are older cars with a fraction of the usual miles', () => {
  const caps = Market.timeCapsuleCars(listings, 2026, 4);
  assert.equal(caps.length, 4);
  for (const { l, share, expectedMiles } of caps) {
    assert.ok(l.condition !== 'New' && 2026 - l.year >= 5, 'used and at least five years old');
    assert.ok(share <= 0.35 && Math.abs(share - l.miles / expectedMiles) < 1e-9);
    assert.equal(expectedMiles, (2026 - l.year) * 12000);
  }
  for (let i = 1; i < caps.length; i++) assert.ok(caps[i - 1].share <= caps[i].share, 'fewest miles for their age first');
  assert.ok(Market.rareSpecs(listings, Market.colorStats(listings), 4).length === 4);
});

test('trim velocity pairs the fastest and slowest trims of a model', () => {
  const { sold } = generateInventory();
  const rows = Market.trimVelocity(sold, 20);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.fast.n >= 20 && r.slow.n >= 20);
    assert.ok(r.slow.days > r.fast.days);
    assert.ok(Math.abs(r.gap - (r.slow.days - r.fast.days)) < 1e-9);
    assert.ok(['New', 'Used'].includes(r.condition));
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].gap >= rows[i].gap, 'biggest gap first');
  const r = rows[0];
  const pool = sold.filter((l) => l.make === r.make && l.model === r.model && l.trim === r.fast.trim);
  assert.equal(Market.median(pool.map((l) => l.sold.daysToSell)), r.fast.days);
});

test('trim velocity scopes the same two trims to the states where both sold enough', () => {
  const { sold } = generateInventory();
  const rows = Market.trimVelocity(sold, 20, 5);
  assert.ok(rows.some((r) => r.states.length > 0), 'at least one model has a state with both trims');
  for (const r of rows) {
    for (const st of r.states) {
      assert.equal(st.fast.trim, r.fast.trim);
      assert.equal(st.slow.trim, r.slow.trim);
      assert.ok(st.fast.n >= 5 && st.slow.n >= 5);
      assert.ok(st.gap >= 1 && Math.abs(st.gap - (st.slow.days - st.fast.days)) < 1e-9);
      const inState = sold.filter((l) => l.make === r.make && l.model === r.model && l.state === st.state);
      assert.equal(st.n, inState.length);
      assert.equal(st.cities.reduce((s, c) => s + c.n, 0), inState.length, 'every sale in the state sits in a city');
      assert.ok(st.cities.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)));
    }
    for (let i = 1; i < r.states.length; i++) assert.ok(r.states[i - 1].gap >= r.states[i].gap, 'widest gap first');
  }
});

test('a time capsule matches a snapshot of the same day', () => {
  const { sold } = generateInventory();
  for (const d of [7, 30, 90]) {
    const c = Market.timeCapsule(listings, sold, d, { minGroup: 25 });
    const snap = Market.snapshot(listings, sold, d);
    assert.equal(c.then.count, snap.length);
    assert.equal(c.then.median, Market.median(snap.map((l) => l.price)));
    assert.equal(c.now.count, listings.length);
    assert.equal(c.soldSince, sold.filter((l) => l.sold.daysAgo < d).length);
    assert.equal(c.listedSince, listings.filter((l) => l.daysListed < d).length);
    assert.ok(c.cutsSince <= listings.length);
    for (const m of c.models) {
      assert.ok(m.thenCount >= 25 && m.nowCount >= 25);
      assert.ok(Math.abs(m.change - (m.nowMedian / m.thenMedian - 1)) < 1e-9);
    }
    for (let i = 1; i < c.models.length; i++) assert.ok(Math.abs(c.models[i - 1].change) >= Math.abs(c.models[i].change));
  }
  assert.equal(Market.timeCapsule(listings, sold, 0).then.count, listings.length, 'today is today');
});

test('live requests are paced: a few in flight, duplicates shared, a rate-limit reply retried', async () => {
  const http = require('http');
  const { handle, KEY } = require('./mock-visor.js');
  const Live = require('../js/live.js');
  let open = 0, maxOpen = 0, hits = 0, limited = 0;
  const server = http.createServer((req, res) => {
    hits++;
    open++; maxOpen = Math.max(maxOpen, open);
    res.on('finish', () => { open--; });
    // The first request for sold cars is refused, the way Visor refuses a burst.
    if (req.url.includes('inventory_status=sold') && !limited) {
      limited++;
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded. Retry after 1 seconds.' } }));
    }
    setTimeout(() => handle(req, res), 30);
  }).listen(0);
  const prevBase = Live.PROVIDERS.visor.base;
  Live.PROVIDERS.visor.base = `http://127.0.0.1:${server.address().port}`;
  globalThis.gridlineDesktop = { defaultKeys: { visor: KEY } };
  try {
    Live.setProvider('visor');
    const facet = (n, extra) => Live.request('/v1/facets', Object.assign({ facets: n, facet_value_limit: 5 }, extra || {}));
    const t0 = Date.now();
    const results = await Promise.all([
      facet('make'), facet('model'), facet('body_type'), facet('price'), facet('trim'), facet('year'),
      facet('make'), // identical to the first: shares its fetch
      facet('model', { inventory_status: 'sold', sold_within_days: 30 }),
    ]);
    assert.equal(results.length, 8);
    assert.ok(results.every((r) => r.data && r.data.total > 0));
    assert.ok(maxOpen <= 4, `at most 4 in flight, saw ${maxOpen}`);
    assert.equal(hits, 8, 'seven distinct requests plus one retry');
    assert.equal(limited, 1);
    assert.ok(Date.now() - t0 >= 1000, 'waited out the retry-after');
    // The real API computes metrics for one facet per request; the mock enforces it so the pages stay within it.
    await assert.rejects(facet('make,model', { metrics: 'price.median' }), (e) => e.code === 'bad_request' && /exactly one facet/.test(e.message));
    const one = await facet('make', { metrics: 'price.median' });
    assert.ok(Live.bucketsOf(one.data.facets.make).some((b) => b.metrics['price.median'] != null));
  } finally {
    server.close();
    Live.PROVIDERS.visor.base = prevBase;
    delete globalThis.gridlineDesktop;
  }
});

test('live requests go out by priority, the tier is learned from a refusal, and replies survive a restart', async () => {
  const http = require('http');
  const { handle, KEY } = require('./mock-visor.js');
  // A localStorage like the browser's, so the tier and the cache can be kept.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    get length() { return store.size; }, key: (i) => [...store.keys()][i],
  };
  Object.defineProperty(globalThis.localStorage, 'keys', { value: () => [...store.keys()] });
  const origKeys = Object.keys;
  Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : origKeys(o));
  const fresh = () => { delete require.cache[require.resolve('../js/live.js')]; return require('../js/live.js'); };
  let Live = fresh();
  const seen = [];
  let refuse = false;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.searchParams.get('facets'));
    if (refuse && seen.length === 12) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded. Retry after 1 seconds.' } }));
    }
    setTimeout(() => handle(req, res), 120);
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  Live.PROVIDERS.visor.base = base;
  globalThis.gridlineDesktop = { defaultKeys: { visor: KEY } };
  try {
    Live.setProvider('visor');
    const facet = (n, prio, extra) => Live.request('/v1/facets', Object.assign({ facets: n, facet_value_limit: 5 }, extra || {}), null, { priority: prio });
    // Six off-screen requests, then two for what's on screen: the first leaves at once, and the on-screen pair goes before the rest of the queue.
    const later = ['make', 'model', 'body_type', 'trim', 'year', 'fuel_type'].map((n) => facet(n, Live.PRIORITY.later));
    const first = ['state', 'drivetrain'].map((n) => facet(n, Live.PRIORITY.first));
    await Promise.all(later.concat(first));
    assert.deepEqual(seen, ['make', 'state', 'drivetrain', 'model', 'body_type', 'trim', 'year', 'fuel_type']);
    assert.equal(Live.tier('visor'), null, 'no refusal yet, so no tier assumed');
    // The twelfth request within ten seconds is refused: that's Tier 1 (10 per 10 s), remembered on the device.
    refuse = true;
    await Promise.all(['transmission', 'exterior_color', 'base_interior_color', 'dealer_type'].map((n) => facet(n, Live.PRIORITY.first)));
    assert.equal(seen.length, 13, 'the refused request was sent again');
    assert.deepEqual([Live.tier('visor').cap10, Live.tier('visor').cap60], [10, 60]);
    assert.deepEqual(JSON.parse(store.get('gridline:tier:visor')).cap10, 10);
    // Replies are on disk: a fresh client (a restart) answers from them without a request, and starts at the learned tier.
    const before = seen.length;
    Live = fresh();
    Live.PROVIDERS.visor.base = base;
    Live.setProvider('visor');
    const again = await Live.request('/v1/facets', { facets: 'make', facet_value_limit: 5 });
    assert.ok(again.data && again.data.total > 0);
    assert.equal(seen.length, before, 'served from the cache');
    assert.equal(Live.tier('visor').cap10, 10);
  } finally {
    server.close();
    Object.keys = origKeys;
    delete globalThis.localStorage;
    delete globalThis.gridlineDesktop;
    fresh().PROVIDERS.visor.base = 'https://api.visor.vin';
  }
});
