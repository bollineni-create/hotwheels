// A stand-in for the Visor Public API, shaped like its OpenAPI spec and backed
// by the synthetic market. Used by tests so live mode can be exercised without
// a real key. Run: node test/mock-visor.js [port]
const http = require('http');
const { generateInventory } = require('../js/data.js');
const Market = require('../js/market.js');

const KEY = 'vis_test_key';
const { listings, sold } = generateInventory();
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * 864e5).toISOString().replace('T', ' ').replace('Z', '000');
const token = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const BODY = { SUV: 'SUV', Truck: 'Pickup Truck', Sedan: 'Sedan', Coupe: 'Coupe', Convertible: 'Convertible', Wagon: 'Wagon', Minivan: 'Minivan' };
const FUEL = { Gas: 'Gas only', Electric: 'Full Electric', Hybrid: 'Hybrid', 'Plug-in Hybrid': 'Plug-in Hybrid', Diesel: 'Diesel' };
const COLOR = (f) => (f === 'Beige' ? 'Tan' : f);

function record(l) {
  const isSold = !!l.sold;
  const changes = [];
  for (let i = 1; i < l.history.length; i++) {
    changes.push({ changed_at: iso(l.history[i].daysAgo), miles: l.miles, price_before: l.history[i - 1].price, price_after: l.history[i].price });
  }
  return {
    id: 'v-' + l.id.toLowerCase(), vin: l.vin, year: l.year, make: l.make, model: l.model, trim: l.trim, version: null,
    body_type: BODY[l.body], drivetrain: l.drivetrain, fuel_type: FUEL[l.fuel] || l.fuel, powertrain_type: null, transmission: l.transmission, engine: null,
    exterior_color: l.extColor, interior_color: l.intColor, base_exterior_color: COLOR(l.colorFamily), base_interior_color: l.interiorFamily,
    spec_source: 'legacy', msrp: l.msrp, discount_from_msrp: l.msrp ? l.price / l.msrp - 1 : null, price: l.price, miles: l.miles,
    days_on_market: isSold ? l.sold.daysToSell : l.daysListed, listed_at: iso(l.daysListed), last_checked_at: iso(0),
    status: isSold ? 'sold' : 'active', availability_status: { 'On lot': 'stock', 'In transit': 'transit', 'In production': 'build' }[l.status] || (isSold ? null : 'stock'),
    inventory_type: l.condition.toLowerCase(), sold_date: isSold ? iso(l.sold.daysAgo).slice(0, 10) : null,
    dealer_id: l.dealerId, dealer_name: l.dealer, dealer_type: l.franchise ? 'franchise' : 'independent', city: l.city, state: l.state,
    postal_code: '00000', latitude: l.lat, longitude: l.lng, distance_miles: null, vdp_url: `https://dealer.example/${l.vin}`,
    photo_urls: [], features: l.features.map(token), upfitters: l.upfitter ? [token(l.upfitter.name)] : [],
    options_packages: l.options.map((o) => token(o.name).toUpperCase().slice(0, 6)),
    _price_history: changes, _options: l.options.map((o) => ({ code: token(o.name).toUpperCase().slice(0, 6), name: o.name, msrp: o.price, slug: token(o.name) })),
    _assembly: l.assembly.plant, _base_msrp: l.msrpBase, _lat: l.lat, _lng: l.lng,
  };
}
const ACTIVE = listings.map(record);
const SOLD = sold.map(record);
const ALL = ACTIVE.concat(SOLD);

const list = (q, k) => (q.get(k) ? q.get(k).split(k === 'assembly_location' ? '|' : ',').map((s) => s.trim().toLowerCase()) : null);
function filter(q) {
  let pool;
  if (q.get('inventory_status') === 'sold') {
    const w = Number(q.get('sold_within_days')) || 120;
    pool = SOLD.filter((r) => (now - Date.parse(r.sold_date)) / 864e5 <= w);
  } else if (q.get('snapshot_date')) {
    const d = Math.round((now - Date.parse(q.get('snapshot_date'))) / 864e5);
    pool = Market.snapshot(listings, sold, d).map(record);
  } else pool = ACTIVE;
  const eq = { inventory_type: 'inventory_type', make: 'make', model: 'model', trim: 'trim', body_type: 'body_type', fuel_type: 'fuel_type', drivetrain: 'drivetrain', transmission: 'transmission',
    base_exterior_color: 'base_exterior_color', exterior_color: 'exterior_color', base_interior_color: 'base_interior_color', state: 'state', dealer_type: 'dealer_type', assembly_location: '_assembly', availability_status: 'availability_status' };
  for (const [p, field] of Object.entries(eq)) {
    const inc = list(q, p), exc = list(q, 'exclude_' + p);
    if (inc) pool = pool.filter((r) => inc.includes(String(r[field]).toLowerCase()));
    if (exc) pool = pool.filter((r) => !exc.includes(String(r[field]).toLowerCase()));
  }
  if (list(q, 'year')) pool = pool.filter((r) => list(q, 'year').includes(String(r.year)));
  for (const [p, field] of [['features', 'features'], ['upfitter', 'upfitters'], ['options_packages', 'options_packages']]) {
    const inc = list(q, p), exc = list(q, 'exclude_' + p);
    if (inc) pool = pool.filter((r) => (p === 'upfitter' ? inc.some((v) => r[field].includes(v)) : inc.every((v) => r[field].map((x) => x.toLowerCase()).includes(v))));
    if (exc) pool = pool.filter((r) => !exc.some((v) => r[field].map((x) => x.toLowerCase()).includes(v)));
  }
  const num = (k) => (q.get(k) != null ? Number(q.get(k)) : null);
  if (num('min_price') != null) pool = pool.filter((r) => r.price >= num('min_price'));
  if (num('max_price') != null) pool = pool.filter((r) => r.price <= num('max_price'));
  if (num('min_msrp') != null) pool = pool.filter((r) => r.msrp >= num('min_msrp'));
  if (num('max_msrp') != null) pool = pool.filter((r) => r.msrp <= num('max_msrp'));
  if (num('max_mileage') != null) pool = pool.filter((r) => r.miles <= num('max_mileage'));
  if (q.get('vin_pattern')) {
    const pats = q.get('vin_pattern').split(',');
    pool = pool.filter((r) => pats.some((p) => Market.vinMatches(r.vin, p.replace(/\*$/, ''))));
  }
  if (num('latitude') != null) {
    const lat = num('latitude'), lng = num('longitude');
    pool = pool.map((r) => Object.assign({}, r, { distance_miles: Math.round(Market.haversineMiles(lat, lng, r._lat, r._lng)) }));
    if (num('radius') != null) pool = pool.filter((r) => r.distance_miles <= num('radius'));
  }
  return pool;
}

const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
const pctl = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (arr) => (arr.length ? { min: Math.min(...arr), max: Math.max(...arr), mean: arr.reduce((a, b) => a + b, 0) / arr.length, median: pctl(arr, 0.5) } : null);
const FACET_FIELD = { inventory_type: 'inventory_type', make: 'make', model: 'model', trim: 'trim', year: 'year', body_type: 'body_type', fuel_type: 'fuel_type',
  drivetrain: 'drivetrain', transmission: 'transmission', base_exterior_color: 'base_exterior_color', exterior_color: 'exterior_color', base_interior_color: 'base_interior_color',
  features: 'features', options_packages: 'options_packages', upfitter: 'upfitters', assembly_location: '_assembly', dealer_type: 'dealer_type', state: 'state',
  availability_status: 'availability_status' };

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Usage-Cost-Micros': status === 200 ? '2000' : '0' });
    res.end(JSON.stringify(body));
  };
  if ((req.headers.authorization || '') !== `Bearer ${KEY}`) {
    return send(401, { error: { type: 'authentication_error', code: 'invalid_api_key', message: 'Invalid API key.' } });
  }
  const q = url.searchParams;
  const p = url.pathname;
  if (p === '/v1/listings') {
    let pool = filter(q);
    const sort = q.get('sort') || 'days_on_market';
    const desc = sort.startsWith('-');
    const field = { days_on_market: 'days_on_market', price: 'price', miles: 'miles', msrp: 'msrp', discount: 'discount_from_msrp', distance: 'distance_miles', listed_at: 'listed_at' }[sort.replace('-', '')];
    pool = [...pool].sort((a, b) => ((a[field] ?? 0) > (b[field] ?? 0) ? 1 : (a[field] ?? 0) < (b[field] ?? 0) ? -1 : 0) * (desc ? -1 : 1));
    const limit = Math.min(100, Number(q.get('limit')) || 50), offset = Number(q.get('offset')) || 0;
    const page = pool.slice(offset, offset + limit).map(strip);
    return send(200, { data: page, pagination: { limit, offset, total: pool.length, next_offset: offset + limit < pool.length ? offset + limit : null }, meta: {} });
  }
  if (p === '/v1/facets') {
    const pool = filter(q);
    const names = (q.get('facets') || '').split(',').filter(Boolean);
    const limit = Number(q.get('facet_value_limit')) || 20;
    const metrics = q.get('metrics') ? q.get('metrics').split(',') : null;
    if (metrics && names.length !== 1) return send(400, { error: { type: 'invalid_request', code: 'bad_request', message: 'metric other than count requires exactly one facet.' } });
    const facets = {}, stats = {}, range_facets = {};
    for (const n of names) {
      if (['price', 'miles', 'days_on_market', 'msrp'].includes(n)) {
        const vals = pool.map((r) => r[n]).filter((v) => v != null);
        stats[n] = stat(vals);
        // Fixed-width buckets, like the real API's numeric range facets.
        if (vals.length) {
          const lo = Math.min(...vals), hi = Math.max(...vals), interval = Math.max(1, Math.round((hi - lo) / 10));
          const buckets = [];
          for (let b = lo; b < hi; b += interval) buckets.push({ min: b, max: b + interval, count: vals.filter((v) => v >= b && v < b + interval).length });
          range_facets[n] = { buckets, interval, min: lo, max: hi };
        }
        continue;
      }
      const field = FACET_FIELD[n];
      if (!field) continue;
      const by = new Map();
      for (const r of pool) for (const v of [].concat(r[field])) { if (v == null) continue; if (!by.has(v)) by.set(v, []); by.get(v).push(r); }
      facets[n] = [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, limit).map(([value, rs]) => {
        const b = { value, count: rs.length };
        if (metrics) {
          b.metrics = {};
          for (const m of metrics) {
            const [measure, agg] = m.split('.');
            const vals = rs.map((r) => r[measure]).filter((v) => v != null);
            // Same envelope as the real API: { value } with null below ten samples.
            const v = vals.length >= 10 ? (agg === 'mean' ? vals.reduce((x, y) => x + y, 0) / vals.length : pctl(vals, agg === 'median' ? 0.5 : 0.5)) : null;
            b.metrics[m] = v == null ? { value: null, null_reason: 'insufficient_sample' } : { value: v };
          }
        }
        return b;
      });
    }
    return send(200, { data: { total: pool.length, facets, range_facets, stats }, meta: { facets: names, metric: 'count' } });
  }
  let m;
  if ((m = p.match(/^\/v1\/listings\/([^/]+)$/))) {
    const r = ALL.find((x) => x.id === decodeURIComponent(m[1]));
    if (!r) return send(404, { error: { type: 'not_found', message: 'Listing not found' } });
    const inc = q.get('include') || '';
    return send(200, { data: Object.assign(strip(r), {
      price_history: inc.includes('price_history') ? r._price_history : null, pricing: null, inventory_date: r.listed_at.slice(0, 10),
      dealer: { dealer_id: r.dealer_id, name: r.dealer_name, city: r.city, state: r.state, postal_code: r.postal_code, latitude: r._lat, longitude: r._lng, phone: '(555) 010-0000' },
      vehicle: { vin: r.vin, status: r.status, build: { year: r.year, make: r.make, model: r.model, trim: r.trim, body_type: r.body_type, drivetrain: r.drivetrain,
        fuel_type: r.fuel_type, exterior_color: r.exterior_color, interior_color: r.interior_color, base_exterior_color: r.base_exterior_color, base_interior_color: r.base_interior_color,
        spec_source: 'legacy', assembly_location: r._assembly, window_sticker_verified: false, base_msrp: r._base_msrp, combined_msrp: r.msrp,
        options: inc.includes('options') ? r._options : null } },
    }), meta: {} });
  }
  if ((m = p.match(/^\/v1\/vins\/([^/]+)$/))) {
    const r = ALL.find((x) => x.vin === decodeURIComponent(m[1]).toUpperCase());
    if (!r) return send(404, { error: { type: 'not_found', message: 'VIN not found' } });
    return send(200, { data: { vin: r.vin, status: r.status, latest_listing: Object.assign(strip(r), { dealer: { name: r.dealer_name, city: r.city, state: r.state } }),
      build: { year: r.year, make: r.make, model: r.model, trim: r.trim, assembly_location: r._assembly, base_msrp: r._base_msrp, combined_msrp: r.msrp } }, meta: {} });
  }
  return send(404, { error: { type: 'not_found', message: 'Unknown endpoint' } });
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8799;
  http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`Mock Visor API on http://127.0.0.1:${port} (key: ${KEY})`));
}
module.exports = { handle, KEY };
