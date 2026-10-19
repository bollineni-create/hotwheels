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
