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
