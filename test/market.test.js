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
