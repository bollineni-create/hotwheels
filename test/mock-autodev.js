// A stand-in for the auto.dev Listings API (free plan behaviour), backed by the
// synthetic market. Used by tests so the free live mode can be exercised
// without a key. Run: node test/mock-autodev.js [port]
const http = require('http');
const { generateInventory } = require('../js/data.js');

const KEY = 'ad_test_key';
const FREE_LIMIT = 20;
const BASE = 'https://api.auto.dev';
const { listings, sold } = generateInventory();
const now = Date.now();
const ts = (daysAgo) => new Date(now - daysAgo * 864e5).toISOString().replace('T', ' ').slice(0, 19);
const BODY = { SUV: 'SUV', Truck: 'Pickup', Sedan: 'Sedan', Coupe: 'Coupe', Convertible: 'Convertible', Wagon: 'Wagon', Minivan: 'Minivan' };
const FUEL = { Gas: 'Gasoline', 'Plug-in Hybrid': 'Plug-In Hybrid' };

function record(l, removed) {
  return {
    '@id': `${BASE}/listings/${l.vin}`, vin: l.vin, location: [l.lng, l.lat], createdAt: ts(l.daysListed),
    ...(removed ? { removedAt: ts(l.sold.daysAgo) } : {}),
    vehicle: { vin: l.vin, squishVin: l.vin.slice(0, 8) + l.vin.slice(9, 11), year: l.year, make: l.make, model: l.model, trim: l.trim,
      drivetrain: l.drivetrain, engine: null, fuel: FUEL[l.fuel] || l.fuel, transmission: 'Automatic', bodyStyle: BODY[l.body],
      exteriorColor: l.colorFamily, interiorColor: l.interiorFamily, doors: 4, seats: 5 },
    wholesaleListing: null,
    retailListing: { vdp: `https://dealer.example/${l.vin}`, price: l.price, miles: l.miles, used: l.condition !== 'New', cpo: l.condition === 'Certified',
      carfaxUrl: `https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=${l.vin}`, dealer: l.dealer, dealerId: l.dealerId, city: l.city, state: l.state,
      zip: '00000', primaryImage: `https://retail.photos.vin/${l.vin}-1.jpg`, photoCount: 6 },
    history: l.condition === 'New' ? null : { accidents: l.miles % 7 === 0, ownerCount: 1 + (l.miles % 3) },
  };
}
const ACTIVE = listings.map((l) => record(l));
const BY_VIN = new Map(ACTIVE.map((r) => [r.vin, r]));
for (const l of sold) if (!BY_VIN.has(l.vin)) BY_VIN.set(l.vin, record(l, true));

// Filter parameter -> how to read it from a record. Note: the drivetrain filter
// is 'drivetrain' here (not 'vehicle.drivetrain') to exercise parameter learning.
const FIELDS = {
  'vehicle.make': (r) => r.vehicle.make, 'vehicle.model': (r) => r.vehicle.model, 'vehicle.trim': (r) => r.vehicle.trim,
  'vehicle.bodyStyle': (r) => r.vehicle.bodyStyle, 'vehicle.fuel': (r) => r.vehicle.fuel, 'vehicle.exteriorColor': (r) => r.vehicle.exteriorColor,
  'vehicle.interiorColor': (r) => r.vehicle.interiorColor, drivetrain: (r) => r.vehicle.drivetrain, 'retailListing.state': (r) => r.retailListing.state,
};
const RANGES = { 'vehicle.year': (r) => r.vehicle.year, 'retailListing.price': (r) => r.retailListing.price, 'retailListing.miles': (r) => r.retailListing.miles };
const BOOLS = { 'retailListing.used': (r) => r.retailListing.used, 'retailListing.cpo': (r) => r.retailListing.cpo };
const OTHER = new Set(['limit', 'page', 'sort', 'includes', 'zip', 'distance', 'select', 'cursor', 'includeUnpriced']);
const GROUPS = { years: ['vehicle.year', (r) => r.vehicle.year], makes: ['vehicle.make', (r) => r.vehicle.make], models: ['vehicle.model', (r) => r.vehicle.model],
  trims: ['vehicle.trim', (r) => r.vehicle.trim], types: ['vehicle.bodyStyle', (r) => r.vehicle.bodyStyle], exteriorColor: ['vehicle.exteriorColor', (r) => r.vehicle.exteriorColor],
  interiorColor: ['vehicle.interiorColor', (r) => r.vehicle.interiorColor], fuel: ['vehicle.fuel', (r) => r.vehicle.fuel], drivetrain: ['drivetrain', (r) => r.vehicle.drivetrain],
  states: ['retailListing.state', (r) => r.retailListing.state] };

function filter(q) {
  let pool = ACTIVE;
  for (const [name, val] of q) {
    if (OTHER.has(name)) continue;
    if (FIELDS[name]) {
      const set = val.toLowerCase().split(',');
      pool = pool.filter((r) => set.includes(String(FIELDS[name](r)).toLowerCase()));
    } else if (RANGES[name]) {
      if (val.includes('-')) {
        const [lo, hi] = val.split('-').map(Number);
        pool = pool.filter((r) => RANGES[name](r) >= lo && RANGES[name](r) <= hi);
      } else {
        const set = val.split(',').map(Number);
        pool = pool.filter((r) => set.includes(RANGES[name](r)));
      }
    } else if (BOOLS[name]) {
      pool = pool.filter((r) => String(BOOLS[name](r)) === val);
    } else {
      return { error: name };
    }
  }
  return { pool };
}

function facets(pool, q) {
  const out = {};
  for (const [group, [param, get]] of Object.entries(GROUPS)) {
    const counts = new Map();
    for (const r of pool) { const v = get(r); if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
    out[group] = {};
    for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      const link = new URLSearchParams(q);
      link.delete('page'); link.delete('limit');
      link.set(param, v);
      out[group][`${v} (${n})`] = `${BASE}/listings?${link.toString()}`;
    }
  }
  const prices = pool.map((r) => r.retailListing.price).sort((a, b) => a - b);
  out.prices = {};
  for (let i = 0; i < 5 && prices.length; i++) {
    const lo = prices[Math.floor((i / 5) * prices.length)], hi = prices[Math.min(prices.length - 1, Math.floor(((i + 1) / 5) * prices.length) - 1)];
    out.prices[`${lo}-${hi} (${pool.filter((r) => r.retailListing.price >= lo && r.retailListing.price <= hi).length})`] = `${BASE}/listings?prices=${lo}-${hi}`;
  }
  return out;
}

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if ((req.headers.authorization || '') !== `Bearer ${KEY}`) return send(401, { status: 401, error: 'Invalid API key', code: 'UNAUTHORIZED' });
  const q = url.searchParams;
  let m;
  if (url.pathname === '/listings') {
    const r = filter(q);
    if (r.error) return send(400, { status: 400, error: `Invalid parameter provided: ${r.error}. This parameter does not exist in this endpoint.`, code: 'INVALID_PARAMETER' });
    let pool = r.pool;
    const sort = q.get('sort');
    if (sort) {
      const [field, dir] = sort.split('.');
      const get = { price: (x) => x.retailListing.price, miles: (x) => x.retailListing.miles, year: (x) => x.vehicle.year, createdAt: (x) => x.createdAt, updatedAt: (x) => x.createdAt }[field];
      if (get) pool = [...pool].sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Math.min(FREE_LIMIT, Number(q.get('limit')) || FREE_LIMIT);
    const page = Number(q.get('page')) || 1;
    const data = pool.slice((page - 1) * limit, page * limit);
    const inc = (q.get('includes') || '').split(',');
    const body = { data, links: { self: `${BASE}/listings?page=${page}&limit=${limit}`, first: `${BASE}/listings` } };
    if (page * limit < pool.length) body.links.next = `${BASE}/listings?page=${page + 1}&limit=${limit}`;
    if (inc.includes('total')) body.total = pool.length;
    if (inc.includes('facets')) body.facets = facets(pool, q);
    return send(200, body);
  }
  if ((m = url.pathname.match(/^\/listings\/([A-Z0-9]{17})$/i))) {
    const r = BY_VIN.get(m[1].toUpperCase());
    return r ? send(200, { data: r }) : send(404, { status: 404, error: `Resource "${m[1]}" not found`, code: 'RESOURCE_NOT_FOUND' });
  }
  if ((m = url.pathname.match(/^\/photos\/([A-Z0-9]{17})$/i))) {
    return send(200, { data: { retail: [1, 2, 3, 4, 5, 6].map((i) => `https://retail.photos.vin/${m[1]}-${i}.jpg`) } });
  }
  return send(404, { status: 404, error: 'Not found', code: 'RESOURCE_NOT_FOUND' });
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8798;
  http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`Mock auto.dev API on http://127.0.0.1:${port} (key: ${KEY})`));
}
module.exports = { handle, KEY };
