/* Live data: Gridline filters <-> the Visor Public API (https://api.visor.vin/docs).
   Your API key stays on this device. Visor only accepts browser requests from
   visor.vin, so requests go through the desktop app or the local server. */
(function (root) {
  'use strict';

  const API_BASE = 'https://api.visor.vin';
  const KEY_STORE = 'gridline:visorKey';
  const COST_STORE = 'gridline:visorCost';
  const CACHE_TTL = 30 * 60 * 1000; // identical requests within 30 minutes are free
  const PAGE = 100;

  const memCache = new Map();
  let sessionMicros = 0;

  class LiveError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  /* ---------- Key, transport, cost ---------- */

  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const getKey = () => safe(() => localStorage.getItem(KEY_STORE), null) || '';
  const setKey = (k) => safe(() => (k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE)));
  const totalMicros = () => Number(safe(() => localStorage.getItem(COST_STORE), 0)) || 0;
  function addCost(micros) {
    if (!micros) return;
    sessionMicros += micros;
    safe(() => localStorage.setItem(COST_STORE, String(totalMicros() + micros)));
  }
  const costs = () => ({ session: sessionMicros / 1e6, total: totalMicros() / 1e6 });

  let proxyChecked = null;
  async function hasLocalProxy() {
    if (proxyChecked !== null) return proxyChecked;
    if (!/^https?:$/.test(location.protocol)) return (proxyChecked = false);
    try {
      const r = await fetch('/visor/health', { cache: 'no-store' });
      proxyChecked = r.ok && (await r.text()).includes('gridline-visor-proxy');
    } catch (e) {
      proxyChecked = false;
    }
    return proxyChecked;
  }

  // Which route requests will take, for the Settings page.
  async function transport() {
    if (root.gridlineDesktop && root.gridlineDesktop.visorFetch) return 'desktop';
    if (await hasLocalProxy()) return 'proxy';
    return 'direct';
  }

  async function rawFetch(path, query, key) {
    const t = await transport();
    if (t === 'desktop') return root.gridlineDesktop.visorFetch({ path, query, key });
    let url, headers;
    if (t === 'proxy') {
      url = `/visor${path}${query ? '?' + query : ''}`;
      headers = { 'X-Visor-Key': key };
    } else {
      url = `${API_BASE}${path}${query ? '?' + query : ''}`;
      headers = { Authorization: `Bearer ${key}` };
    }
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      throw new LiveError('blocked', 'Visor only accepts browser requests from visor.vin. Use the Gridline desktop app, or run `npm start` and open http://localhost:8080.');
    }
    return { status: res.status, body: await res.text(), cost: Number(res.headers.get('x-usage-cost-micros')) || 0 };
  }

  async function request(path, params) {
    const key = getKey();
    if (!key) throw new LiveError('no_key', 'Add your Visor API key in Settings to use live data.');
    const query = params ? new URLSearchParams(params).toString() : '';
    const cacheKey = path + '?' + query;
    const hit = memCache.get(cacheKey) || safe(() => JSON.parse(sessionStorage.getItem('gv:' + cacheKey)), null);
    if (hit && Date.now() - hit.t < CACHE_TTL) return hit.json;

    const r = await rawFetch(path, query, key);
    addCost(r.cost);
    let json = null;
    try { json = JSON.parse(r.body); } catch (e) { /* non-JSON error */ }
    if (r.status < 200 || r.status >= 300) {
      const err = (json && json.error) || {};
      const code = r.status === 401 ? 'auth' : r.status === 402 ? 'billing' : r.status === 429 ? 'rate_limit' : r.status === 404 ? 'not_found' : 'api';
      throw new LiveError(code, err.message || `Visor API error (${r.status})`, r.status);
    }
    const entry = { t: Date.now(), json };
    memCache.set(cacheKey, entry);
    safe(() => sessionStorage.setItem('gv:' + cacheKey, JSON.stringify(entry)));
    return json;
  }

  /* ---------- Filter mapping ---------- */

  const CONDITION = { New: 'new', Used: 'used', Certified: 'certified' };
  const FUEL_OUT = { Gas: 'Gas only', Electric: 'Full Electric', Hybrid: 'Hybrid', 'Plug-in Hybrid': 'Plug-in Hybrid', Diesel: 'Diesel' };
  const FUEL_IN = { 'Gas only': 'Gas', 'Full Electric': 'Electric' };
  const SORT = {
    'price-asc': 'price', 'price-desc': '-price', 'miles-asc': 'miles', 'miles-desc': '-miles', 'msrp-desc': '-msrp', 'msrp-asc': 'msrp',
    discount: 'discount', distance: 'distance', newest: 'days_on_market', oldest: '-days_on_market', 'sold-fastest': 'days_on_market',
  };
  // Gridline facet key -> Visor parameter / facet name
  const PARAM = {
    condition: 'inventory_type', make: 'make', model: 'model', trim: 'trim', year: 'year', body: 'body_type', drivetrain: 'drivetrain',
    fuel: 'fuel_type', colorFamily: 'base_exterior_color', extColor: 'exterior_color', interiorFamily: 'base_interior_color',
    features: 'features', options: 'options_packages', upfitter: 'upfitter', assembly: 'assembly_location', seller: 'dealer_type', state: 'state',
  };
  const SELLER_OUT = { Franchise: 'franchise', Independent: 'independent' };
  const SELLER_IN = { franchise: 'Franchise', independent: 'Independent' };

  const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  function valueOut(key, v, makes) {
    if (key === 'condition') return CONDITION[v] || v.toLowerCase();
    if (key === 'fuel') return FUEL_OUT[v] || v;
    if (key === 'seller') return SELLER_OUT[v] || v.toLowerCase();
    if (key === 'model') {
      // Demo-mode keys are "Make Model"; Visor wants the model name.
      const mk = (makes || []).find((m) => v.toLowerCase().startsWith(m.toLowerCase() + ' '));
      return mk ? v.slice(mk.length + 1) : v;
    }
    if (key === 'upfitter') return v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^sca_?/, '').replace(/^black_widow$/, 'sca_black_widow');
    return v;
  }

  // Values Visor knows for a facet, used to translate plain-English picks
  // ("leather seats") into Visor's feature tokens.
  // Every known value that contains the word, e.g. "Truck" -> "Pickup Truck".
  function matchAll(v, known) {
    if (!known || !known.length) return [v];
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nv = norm(v);
    const exact = known.filter((k) => norm(k) === nv);
    if (exact.length) return exact;
    const hits = known.filter((k) => norm(k).split(' ').includes(nv) || norm(k).includes(nv));
    return hits.length ? hits : [v];
  }

  function matchToken(v, known) {
    if (!known || !known.length) return v;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nv = norm(v);
    return known.find((k) => norm(k) === nv) || known.find((k) => norm(k).includes(nv) || nv.includes(norm(k))) || v;
  }

  function toParams(f, ctx, opts) {
    const o = opts || {};
    const p = {};
    const makes = ctx.makes || [];
    const makesFromModels = [];
    for (const [key, param] of Object.entries(PARAM)) {
      if (key === o.skip) continue;
      let vals = (f[key] || []).map((v) => valueOut(key, v, makes));
      if (key === 'features') vals = vals.map((v) => matchToken(v, ctx.known && ctx.known.features));
      if (key === 'body') vals = [...new Set(vals.flatMap((v) => matchAll(v, ctx.known && ctx.known.bodies)))];
      if (key === 'model') {
        for (const v of f.model || []) {
          const mk = makes.find((m) => v.toLowerCase().startsWith(m.toLowerCase() + ' '));
          if (mk && !(f.make || []).includes(mk)) makesFromModels.push(mk);
        }
      }
      const sep = key === 'assembly' ? '|' : ',';
      if (vals.length) p[param] = vals.join(sep);
      const ex = ((f.ex && f.ex[key]) || []).map((v) => valueOut(key, v, makes));
      if (ex.length && key !== 'model' && key !== 'condition') p['exclude_' + param] = ex.join(sep);
      if (ex.length && key === 'model') p.exclude_model = ex.join(',');
      if (ex.length && key === 'condition') p.exclude_inventory_type = ex.join(',');
    }
    if (makesFromModels.length && !p.make) p.make = [...new Set(makesFromModels)].join(',');
    if (f.priceMin != null) p.min_price = f.priceMin;
    if (f.priceMax != null) p.max_price = f.priceMax;
    if (f.msrpMin != null) p.min_msrp = f.msrpMin;
    if (f.msrpMax != null) p.max_msrp = f.msrpMax;
    if (f.milesMax != null) p.max_mileage = f.milesMax;
    if (f.vin) {
      // Visor allows '*' only at the end; '?' is a single position.
      const v = f.vin.toUpperCase().replace(/[\s-]/g, '');
      p.vin_pattern = v.replace(/\*(?=.)/g, '?').replace(/[_.]/g, '?');
    }
    const origin = f.near ? ctx.cityByName(f.near) : null;
    if (origin) {
      p.latitude = origin[2];
      p.longitude = origin[3];
      p.radius = Math.min(500, f.radius || 150);
    } else if (ctx.home && (f.sort === 'distance' || o.withDistance)) {
      p.latitude = ctx.home[2];
      p.longitude = ctx.home[3];
    }
    if (f.when === 'sold') {
      p.inventory_status = 'sold';
      p.sold_within_days = 120;
    } else if (Number(f.when)) {
      p.snapshot_date = isoDaysAgo(Number(f.when));
    }
    return p;
  }

  /* ---------- Normalizing Visor records to Gridline listings ---------- */

  const FAMILY_HEX = { White: '#f4f4f2', Black: '#151515', Gray: '#6b6e72', Silver: '#b9bcc0', Blue: '#2f4a6b', Red: '#a3141d', Burgundy: '#6d1a2a',
    Green: '#3e5a3e', Brown: '#7a5a3a', Tan: '#c2a878', Beige: '#c9bfa8', Gold: '#c9a646', Orange: '#d2691e', Yellow: '#e3b51b', Purple: '#5b3d72' };
  const daysSince = (ts) => (ts ? Math.max(0, Math.round((Date.now() - Date.parse(ts.replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1') + (/[zZ+]/.test(ts.slice(10)) ? '' : 'Z'))) / 864e5)) : null);
  const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  function bodyShape(t) {
    const s = String(t || '').toLowerCase();
    if (/pickup|truck|chassis/.test(s)) return 'Truck';
    if (/van/.test(s)) return 'Minivan';
    if (/convertible|roadster|cabrio/.test(s)) return 'Convertible';
    if (/coupe/.test(s)) return 'Coupe';
    if (/wagon/.test(s)) return 'Wagon';
    if (/suv|crossover|sport utility/.test(s)) return 'SUV';
    return 'Sedan';
  }

  function historyFrom(raw, price, dom, soldAgo) {
    const changes = (raw || []).filter((h) => h.price_after != null).map((h) => ({ daysAgo: daysSince(h.changed_at), before: h.price_before, price: h.price_after }))
      .sort((a, b) => b.daysAgo - a.daysAgo);
    const start = (soldAgo || 0) + (dom || 0);
    const first = changes.length && changes[0].before != null ? changes[0].before : price;
    const out = [{ daysAgo: start, price: first }];
    for (const c of changes) {
      if (c.daysAgo >= start) { out[0].price = c.price; continue; }
      if (out[out.length - 1].price !== c.price) out.push({ daysAgo: c.daysAgo, price: c.price });
    }
    if (price != null && out[out.length - 1].price !== price) out.push({ daysAgo: soldAgo || 0, price });
    return out;
  }

  function normalize(r) {
    const build = r.vehicle ? r.vehicle.build : r.build || {};
    const src = Object.assign({}, build, r);
    const dealer = r.dealer || {};
    const sold = (r.status || src.status) === 'sold';
    const soldAgo = sold ? daysSince(src.sold_date) || 0 : null;
    const dom = src.days_on_market != null ? src.days_on_market : src.inventory_date ? daysSince(src.inventory_date) - (soldAgo || 0) : 0;
    const price = src.price;
    const fam = src.base_exterior_color || 'Gray';
    const inv = String(src.inventory_type || 'used').toLowerCase();
    const condition = inv === 'new' ? 'New' : inv === 'certified' || inv === 'cpo' ? 'Certified' : 'Used';
    const options = (build.options || r.options || []).map((o) => ({ name: o.name || o.code, price: o.msrp || 0, code: o.code }));
    const l = {
      live: true,
      id: r.id || r.requested_listing_id || src.vin,
      vin: src.vin,
      year: src.year, make: src.make || '', model: src.model || '', trim: src.trim || src.version || '',
      body: bodyShape(src.body_type), bodyLabel: src.body_type || '', segment: src.body_type || '',
      drivetrain: src.drivetrain || '—', fuel: FUEL_IN[src.fuel_type] || src.fuel_type || '—',
      engine: src.engine || null, transmission: src.transmission || null,
      condition,
      status: sold ? null : ({ stock: 'On lot', transit: 'In transit', build: 'In production' }[src.availability_status] || null),
      miles: src.miles || 0, price: price || 0,
      msrp: src.msrp || build.combined_msrp || null, msrpBase: build.base_msrp || null,
      discount: src.discount_from_msrp != null ? -src.discount_from_msrp : null,
      options: options.length ? options : (src.options_packages || []).map((c) => ({ name: c, price: 0, code: c })),
      features: src.features || [],
      extColor: src.exterior_color || fam, extHex: FAMILY_HEX[fam] || '#888', intColor: src.interior_color || src.base_interior_color || '—',
      colorFamily: fam, interiorFamily: src.base_interior_color || '—',
      dealer: src.dealer_name || dealer.name || 'Dealer', dealerId: src.dealer_id || dealer.dealer_id || null,
      franchise: (src.dealer_type || '') === 'franchise', seller: SELLER_IN[src.dealer_type] || 'Dealer',
      dealerPhone: dealer.phone || null,
      city: src.city || dealer.city || '', state: src.state || dealer.state || '',
      lat: src.latitude != null ? src.latitude : dealer.latitude, lng: src.longitude != null ? src.longitude : dealer.longitude,
      distance: src.distance_miles != null ? src.distance_miles : null,
      daysListed: dom || 0,
      history: historyFrom(r.price_history || src.price_history, price, dom, soldAgo),
      sold: sold ? { daysAgo: soldAgo, price: price || 0, daysToSell: dom || 0 } : null,
      upfitter: (src.upfitters && src.upfitters[0]) ? { name: titleCase(src.upfitters[0].replace(/^sca_/, 'SCA ')), category: 'Upfitter', cost: 0 } : null,
      assembly: { plant: build.assembly_location || src.assembly_location || 'Unknown', country: '' },
      windowStickerVerified: !!build.window_sticker_verified,
      titleStatus: src.title_status || null,
      certification: src.certification || null,
      photos: src.photo_urls || (src.photo_url_primary ? [src.photo_url_primary] : []),
      vdpUrl: src.vdp_url || null, vhrUrl: src.vhr_url || null,
      livePricing: r.pricing || null,
      previous: [],
      pricing: { advertised: price, msrp: src.msrp, discount: 0, marketAdjustment: 0, incentives: [], addOns: [], docFee: 0, notes: [] },
    };
    return l;
  }

  /* ---------- Facets ---------- */

  const FACET_NAMES = ['inventory_type', 'make', 'model', 'trim', 'year', 'body_type', 'fuel_type', 'drivetrain', 'base_exterior_color', 'exterior_color',
    'base_interior_color', 'features', 'options_packages', 'upfitter', 'assembly_location', 'dealer_type', 'state'];
  const FACET_IN = Object.fromEntries(Object.entries(PARAM).map(([k, v]) => [v, k]));
  function valueIn(key, v) {
    if (key === 'condition') return { new: 'New', used: 'Used', certified: 'Certified' }[String(v).toLowerCase()] || titleCase(v);
    if (key === 'fuel') return FUEL_IN[v] || v;
    if (key === 'seller') return SELLER_IN[v] || titleCase(v);
    if (key === 'year') return String(v);
    return String(v);
  }

  // Facet buckets come back keyed by facet name; accept array or map shapes.
  function bucketsOf(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw.buckets) ? raw.buckets : Object.entries(raw).map(([value, count]) => (typeof count === 'object' ? Object.assign({ value }, count) : { value, count }));
    return arr.map((b) => ({ value: b.value != null ? b.value : b.key != null ? b.key : b.name, label: b.label || b.display_name || null, count: b.count != null ? b.count : b.doc_count || 0, metrics: b.metrics || null, metric: b.metric != null ? b.metric : null }))
      .filter((b) => b.value != null && b.value !== '');
  }

  function statOf(stats, name, which) {
    const s = stats && stats[name];
    if (!s) return null;
    for (const k of which) if (s[k] != null) return s[k];
    return null;
  }

  /* ---------- Queries ---------- */

  async function search(f, ctx, opts) {
    const o = opts || {};
    const base = toParams(f, ctx);
    const listParams = Object.assign({}, base, { limit: PAGE, offset: o.offset || 0, fields: 'default,features,upfitters,options_packages,dealer_type,photo_urls' });
    if (SORT[f.sort]) listParams.sort = SORT[f.sort];
    if (listParams.sort === 'distance' && listParams.latitude == null) delete listParams.sort;
    const facetParams = Object.assign({}, base, { facets: FACET_NAMES.concat(['price', 'miles', 'days_on_market']).join(','), facet_value_limit: 60 });
    const [list, fac] = await Promise.all([request('/v1/listings', listParams), o.offset ? Promise.resolve(null) : request('/v1/facets', facetParams)]);
    const results = (list.data || []).map(normalize);
    let facets = null, stats = null, total = list.pagination ? list.pagination.total : results.length;
    if (fac) {
      facets = {};
      for (const [name, raw] of Object.entries((fac.data && fac.data.facets) || {})) {
        const key = FACET_IN[name];
        if (!key) continue;
        facets[key] = bucketsOf(raw).map((b) => ({ value: valueIn(key, b.value), label: b.label, count: b.count, avgPrice: null, avgDays: null, avgDiscount: null }));
      }
      // Counts for a facet you've already picked from ignore that pick, so the
      // other options still show how many cars you'd get (one call per facet).
      const own = Object.keys(PARAM).filter((k) => !['features', 'options'].includes(k) && (f[k] || []).length).slice(0, 4);
      await Promise.all(own.map(async (k) => {
        const pp = Object.assign(toParams(f, ctx, { skip: k }), { facets: PARAM[k], facet_value_limit: 60 });
        const r = await request('/v1/facets', pp);
        facets[k] = bucketsOf(r.data && r.data.facets && r.data.facets[PARAM[k]]).map((b) => ({ value: valueIn(k, b.value), label: b.label, count: b.count, avgPrice: null, avgDays: null, avgDiscount: null }));
      }));
      stats = fac.data && fac.data.stats;
      if (fac.data && fac.data.total != null) total = fac.data.total;
    }
    return {
      results, facets, total, nextOffset: list.pagination ? list.pagination.next_offset : null,
      stats: stats ? {
        medianPrice: statOf(stats, 'price', ['median', 'p50', 'mean', 'avg']), minPrice: statOf(stats, 'price', ['min', 'p5']), maxPrice: statOf(stats, 'price', ['max', 'p95']),
        medianMiles: statOf(stats, 'miles', ['median', 'p50', 'mean']), avgDays: statOf(stats, 'days_on_market', ['mean', 'avg', 'median']),
      } : null,
    };
  }

  // Per-value averages (price, days, discount) for one facet, for "sort values by".
  async function facetMetrics(f, ctx, key) {
    const pp = Object.assign(toParams(f, ctx, { skip: key }), { facets: PARAM[key], facet_value_limit: 60, metrics: 'price.mean,days_on_market.mean,discount_from_msrp.mean' });
    const r = await request('/v1/facets', pp);
    return bucketsOf(r.data && r.data.facets && r.data.facets[PARAM[key]]).map((b) => {
      const m = b.metrics || {};
      return { value: valueIn(key, b.value), count: b.count, avgPrice: m['price.mean'] ?? null, avgDays: m['days_on_market.mean'] ?? null, avgDiscount: m['discount_from_msrp.mean'] != null ? -m['discount_from_msrp.mean'] : null };
    });
  }

  async function count(f, ctx, extra) {
    const pp = Object.assign(toParams(f, ctx), extra || {}, { facets: 'inventory_type', facet_value_limit: 1 });
    const r = await request('/v1/facets', pp);
    return (r.data && r.data.total) || 0;
  }

  // Cars for sale on a handful of past dates, for the inventory-over-time chart.
  async function inventoryTrend(f, ctx) {
    const days = [90, 75, 60, 45, 30, 15, 7, 0];
    const counts = await Promise.all(days.map((d) => {
      const g = Object.assign({}, f, { when: d ? String(d) : '0' });
      const pp = Object.assign(toParams(g, ctx), { facets: 'price', facet_value_limit: 1 });
      return request('/v1/facets', pp).then((r) => ({ daysAgo: d, count: (r.data && r.data.total) || 0, median: statOf(r.data && r.data.stats, 'price', ['median', 'p50', 'mean']) }));
    }));
    const sold30 = await count(Object.assign({}, f, { when: '0' }), ctx, { inventory_status: 'sold', sold_within_days: 30 });
    return { series: counts, sold30 };
  }

  async function velocity(f, ctx) {
    const active = Object.assign({}, f, { when: '0' });
    const [nActive, soldStats] = await Promise.all([
      count(active, ctx),
      request('/v1/facets', Object.assign(toParams(active, ctx), { inventory_status: 'sold', sold_within_days: 30, facets: 'days_on_market', facet_value_limit: 1 })),
    ]);
    const sold30 = (soldStats.data && soldStats.data.total) || 0;
    const medianDays = statOf(soldStats.data && soldStats.data.stats, 'days_on_market', ['median', 'p50', 'mean']);
    return { active: nActive, sold30, medianDaysToSell: medianDays, avgDaysToSell: medianDays, daysOfSupply: sold30 ? nActive / (sold30 / 30) : null, saleToList: null };
  }

  async function listing(id) {
    const r = await request(`/v1/listings/${encodeURIComponent(id)}`, { include: 'price_history,options' });
    return normalize(r.data);
  }

  async function vin(v) {
    const r = await request(`/v1/vins/${encodeURIComponent(v)}`, { include: 'price_history,options' });
    const d = r.data || {};
    if (!d.latest_listing) return null;
    return normalize(Object.assign({}, d.latest_listing, { vin: d.vin, status: d.status, build: d.build, vehicle: { build: d.build } }));
  }

  async function comparables(l, ctx, opts) {
    const o = opts || {};
    const years = [];
    for (let y = l.year - (o.years ?? 1); y <= l.year + (o.years ?? 1); y++) years.push(String(y));
    const f = { make: [l.make], model: [l.model], year: years, ex: {}, when: o.sold ? 'sold' : '0' };
    if (o.trim === 'same' && l.trim) f.trim = [l.trim];
    if (o.condition === 'same') f.condition = l.condition === 'New' ? ['New'] : ['Used', 'Certified'];
    const pp = Object.assign(toParams(f, ctx), { limit: PAGE, fields: 'default,options_packages' });
    if (o.radius && l.lat != null) Object.assign(pp, { latitude: l.lat, longitude: l.lng, radius: Math.min(500, o.radius) });
    const r = await request('/v1/listings', pp);
    return (r.data || []).map(normalize).filter((x) => x.id !== l.id);
  }

  // Lists the values Visor knows for a few facets (makes, models, features), for search vocabulary.
  async function vocabulary() {
    const r = await request('/v1/facets', { facets: 'make,model,features,upfitter,body_type', facet_value_limit: 100 });
    const fx = (r.data && r.data.facets) || {};
    return {
      makes: bucketsOf(fx.make).map((b) => b.value),
      models: bucketsOf(fx.model).map((b) => b.value),
      features: bucketsOf(fx.features).map((b) => b.value),
      upfitters: bucketsOf(fx.upfitter).map((b) => b.value),
      bodies: bucketsOf(fx.body_type).map((b) => b.value),
    };
  }

  // Fair value from live comparables: log(price) on age and mileage.
  function fairValueFrom(pool, currentYear) {
    const by = new Map();
    for (const x of pool) {
      if (!x.price || x.condition === 'New' || x.sold) continue;
      const k = x.make + '|' + x.model;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(x);
    }
    const coef = new Map();
    for (const [k, g] of by) {
      if (g.length < 10) continue;
      const c = root.Market.fit2(g.map((x) => [currentYear - x.year + 0.5, x.miles / 1000, Math.log(x.price)]));
      if (c && isFinite(c[0])) coef.set(k, c);
    }
    return (l) => {
      if (l.condition === 'New') return l.msrp || null;
      const c = coef.get(l.make + '|' + l.model);
      return c ? Math.exp(c[0] + c[1] * (currentYear - l.year + 0.5) + c[2] * (l.miles / 1000)) : null;
    };
  }

  const api = {
    getKey, setKey, request, transport, costs, LiveError, toParams, normalize, bucketsOf,
    search, facetMetrics, count, inventoryTrend, velocity, listing, vin, comparables, vocabulary, fairValueFrom,
    PARAM, SORT, FACET_NAMES, titleCase, FAMILY_HEX, PAGE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Live = api;
})(typeof window !== 'undefined' ? window : globalThis);
