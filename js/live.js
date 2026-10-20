/* Live data: Gridline filters <-> the Visor Public API (https://api.visor.vin/docs).
   Your API key stays on this device. Visor only accepts browser requests from
   visor.vin, so requests go through the desktop app or the local server. */
(function (root) {
  'use strict';

  const PROVIDERS = {
    visor: { name: 'Visor', site: 'https://visor.vin', base: 'https://api.visor.vin', keyUrl: 'https://visor.vin/account/api', free: false },
    autodev: { name: 'auto.dev', site: 'https://www.auto.dev', base: 'https://api.auto.dev', keyUrl: 'https://auto.dev/dashboard', free: true, monthlyCalls: 1000 },
  };
  const CACHE_TTL = 30 * 60 * 1000; // identical requests within 30 minutes are free
  const PAGE = 100;

  const memCache = new Map();
  let current = 'autodev';
  let sessionMicros = 0;

  class LiveError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  /* ---------- Provider, keys, transport, usage ---------- */

  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const setProvider = (p) => { if (PROVIDERS[p]) current = p; };
  const provider = () => current;
  const info = (p) => PROVIDERS[p || current];
  const keyStore = (p) => 'gridline:key:' + p;
  // A key saved in Settings wins; otherwise use one built into this desktop app.
  const builtInKey = (prov) => (root.gridlineDesktop && root.gridlineDesktop.defaultKeys && root.gridlineDesktop.defaultKeys[prov]) || '';
  const getKey = (p) => {
    const prov = p || current;
    return safe(() => localStorage.getItem(keyStore(prov)) || (prov === 'visor' ? localStorage.getItem('gridline:visorKey') : null), null) || builtInKey(prov);
  };
  const setKey = (k, p) => safe(() => (k ? localStorage.setItem(keyStore(p || current), k.trim()) : localStorage.removeItem(keyStore(p || current))));
  const monthKey = (p) => `gridline:calls:${p}:${new Date().toISOString().slice(0, 7)}`;
  const totalMicros = () => Number(safe(() => localStorage.getItem('gridline:visorCost'), 0)) || 0;
  function track(p, micros) {
    safe(() => localStorage.setItem(monthKey(p), String((Number(localStorage.getItem(monthKey(p))) || 0) + 1)));
    if (micros) {
      sessionMicros += micros;
      safe(() => localStorage.setItem('gridline:visorCost', String(totalMicros() + micros)));
    }
  }
  const usage = (p) => ({ calls: Number(safe(() => localStorage.getItem(monthKey(p || current)), 0)) || 0, session: sessionMicros / 1e6, total: totalMicros() / 1e6 });
  const costs = () => usage('visor');

  let proxyChecked = null;
  async function hasLocalProxy() {
    if (proxyChecked !== null) return proxyChecked;
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return (proxyChecked = false);
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      proxyChecked = r.ok && (await r.text()).includes('gridline-api-proxy');
    } catch (e) {
      proxyChecked = false;
    }
    return proxyChecked;
  }

  // Which route requests will take, for the Settings page.
  async function transport() {
    if (root.gridlineDesktop && root.gridlineDesktop.apiFetch) return 'desktop';
    if (await hasLocalProxy()) return 'proxy';
    return 'direct';
  }

  async function rawFetch(prov, path, query, key) {
    const t = await transport();
    if (t === 'desktop') return root.gridlineDesktop.apiFetch({ provider: prov, path, query, key });
    let url, headers;
    if (t === 'proxy') {
      url = `/api/${prov}${path}${query ? '?' + query : ''}`;
      headers = { 'X-Api-Key': key };
    } else {
      url = `${PROVIDERS[prov].base}${path}${query ? '?' + query : ''}`;
      headers = { Authorization: `Bearer ${key}` };
    }
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      throw new LiveError('blocked', `${PROVIDERS[prov].name} only accepts browser requests from its own website. Use the Gridline desktop app, or run \`npm start\` and open http://localhost:8080.`);
    }
    return { status: res.status, body: await res.text(), cost: Number(res.headers.get('x-usage-cost-micros')) || 0 };
  }

  async function request(path, params, prov) {
    const p = prov || current;
    const key = getKey(p);
    if (!key) throw new LiveError('no_key', `Add your ${PROVIDERS[p].name} API key in Settings to use live data.`);
    const query = params ? new URLSearchParams(params).toString() : '';
    const cacheKey = p + path + '?' + query;
    const hit = memCache.get(cacheKey) || safe(() => JSON.parse(sessionStorage.getItem('gv:' + cacheKey)), null);
    if (hit && Date.now() - hit.t < CACHE_TTL) return hit.json;

    const r = await rawFetch(p, path, query, key);
    if (r.status !== 401 && r.status !== 403) track(p, r.cost);
    let json = null;
    try { json = JSON.parse(r.body); } catch (e) { /* non-JSON error */ }
    if (r.status < 200 || r.status >= 300) {
      const err = (json && (typeof json.error === 'object' ? json.error : { message: json.error, code: json.code })) || {};
      const code = r.status === 401 || r.status === 403 ? 'auth' : r.status === 402 ? 'billing' : r.status === 429 ? 'rate_limit' : r.status === 404 ? 'not_found' : r.status === 400 ? 'bad_request' : 'api';
      const e = new LiveError(code, err.message || `${PROVIDERS[p].name} API error (${r.status})`, r.status);
      e.apiCode = err.code;
      throw e;
    }
    const entry = { t: Date.now(), json };
    memCache.set(cacheKey, entry);
    safe(() => sessionStorage.setItem('gv:' + cacheKey, JSON.stringify(entry)));
    return json;
  }

  const vreq = (path, params) => request(path, params, 'visor');

  /* ---------- Visor: filter mapping ---------- */

  const CONDITION = { New: 'new', Used: 'used', Certified: 'certified' };
  const FUEL_OUT = { Gas: 'Gas only', Electric: 'Full Electric', Hybrid: 'Hybrid', 'Plug-in Hybrid': 'Plug-in Hybrid', Diesel: 'Diesel' };
  const FUEL_IN = { 'Gas only': 'Gas', 'Full Electric': 'Electric' };
  const SORT = {
    'price-asc': 'price', 'price-desc': '-price', 'miles-asc': 'miles', 'miles-desc': '-miles', 'msrp-desc': '-msrp', 'msrp-asc': 'msrp',
    discount: 'discount', distance: 'distance', newest: 'days_on_market', oldest: '-days_on_market', 'sold-fastest': 'days_on_market',
  };
  // Gridline facet key -> Visor parameter / facet name
  const PARAM = {
    condition: 'inventory_type', make: 'make', model: 'model', trim: 'trim', year: 'year', body: 'body_type', drivetrain: 'drivetrain', transmission: 'transmission',
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
  // Every known value that matches the word or a synonym, e.g. "Truck" -> "Pickup Truck", "Pickup".
  const SYNONYMS = { truck: ['truck', 'pickup'], suv: ['suv', 'sport utility', 'crossover'], minivan: ['minivan', 'van'],
    convertible: ['convertible', 'cabriolet', 'roadster'], sedan: ['sedan'], coupe: ['coupe'], wagon: ['wagon'] };
  function matchAll(v, known) {
    if (!known || !known.length) return [v];
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nv = norm(v);
    const exact = known.filter((k) => norm(k) === nv);
    if (exact.length) return exact;
    const words = SYNONYMS[nv] || [nv];
    const hits = known.filter((k) => words.some((w) => norm(k).includes(w)));
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

  const FACET_NAMES = ['inventory_type', 'make', 'model', 'trim', 'year', 'body_type', 'fuel_type', 'drivetrain', 'transmission', 'base_exterior_color', 'exterior_color',
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

  async function visorSearch(f, ctx, opts) {
    const o = opts || {};
    const base = toParams(f, ctx);
    const listParams = Object.assign({}, base, { limit: PAGE, offset: o.offset || 0, fields: 'default,features,upfitters,options_packages,dealer_type,photo_urls' });
    if (SORT[f.sort]) listParams.sort = SORT[f.sort];
    if (listParams.sort === 'distance' && listParams.latitude == null) delete listParams.sort;
    const facetParams = Object.assign({}, base, { facets: FACET_NAMES.concat(['price', 'miles', 'days_on_market']).join(','), facet_value_limit: 60 });
    const [list, fac] = await Promise.all([vreq('/v1/listings', listParams), o.offset || o.lite ? Promise.resolve(null) : vreq('/v1/facets', facetParams)]);
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
        const r = await vreq('/v1/facets', pp);
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
  async function visorFacetMetrics(f, ctx, key) {
    const pp = Object.assign(toParams(f, ctx, { skip: key }), { facets: PARAM[key], facet_value_limit: 60, metrics: 'price.mean,days_on_market.mean,discount_from_msrp.mean' });
    const r = await vreq('/v1/facets', pp);
    return bucketsOf(r.data && r.data.facets && r.data.facets[PARAM[key]]).map((b) => {
      const m = b.metrics || {};
      return { value: valueIn(key, b.value), count: b.count, avgPrice: m['price.mean'] ?? null, avgDays: m['days_on_market.mean'] ?? null, avgDiscount: m['discount_from_msrp.mean'] != null ? -m['discount_from_msrp.mean'] : null };
    });
  }

  async function visorCount(f, ctx, extra) {
    const pp = Object.assign(toParams(f, ctx), extra || {}, { facets: 'inventory_type', facet_value_limit: 1 });
    const r = await vreq('/v1/facets', pp);
    return (r.data && r.data.total) || 0;
  }

  // How many cars match, and the median price, miles and days listed, in one request.
  async function visorSummary(f, ctx, extra) {
    const pp = Object.assign(toParams(f, ctx), extra || {}, { facets: 'price,miles,days_on_market', facet_value_limit: 1 });
    const r = await vreq('/v1/facets', pp);
    const stats = r.data && r.data.stats;
    return {
      total: (r.data && r.data.total) || 0,
      medianPrice: statOf(stats, 'price', ['median', 'p50', 'mean']),
      medianMiles: statOf(stats, 'miles', ['median', 'p50', 'mean']),
      medianDays: statOf(stats, 'days_on_market', ['median', 'p50', 'mean']),
    };
  }

  // Cars for sale on a handful of past dates, for the inventory-over-time chart.
  async function visorInventoryTrend(f, ctx) {
    const days = [90, 75, 60, 45, 30, 15, 7, 0];
    const counts = await Promise.all(days.map((d) => {
      const g = Object.assign({}, f, { when: d ? String(d) : '0' });
      const pp = Object.assign(toParams(g, ctx), { facets: 'price', facet_value_limit: 1 });
      return vreq('/v1/facets', pp).then((r) => ({ daysAgo: d, count: (r.data && r.data.total) || 0, median: statOf(r.data && r.data.stats, 'price', ['median', 'p50', 'mean']) }));
    }));
    const sold30 = await visorCount(Object.assign({}, f, { when: '0' }), ctx, { inventory_status: 'sold', sold_within_days: 30 });
    return { series: counts, sold30 };
  }

  async function visorVelocity(f, ctx) {
    const active = Object.assign({}, f, { when: '0' });
    const [nActive, soldStats] = await Promise.all([
      visorCount(active, ctx),
      vreq('/v1/facets', Object.assign(toParams(active, ctx), { inventory_status: 'sold', sold_within_days: 30, facets: 'days_on_market', facet_value_limit: 1 })),
    ]);
    const sold30 = (soldStats.data && soldStats.data.total) || 0;
    const medianDays = statOf(soldStats.data && soldStats.data.stats, 'days_on_market', ['median', 'p50', 'mean']);
    return { active: nActive, sold30, medianDaysToSell: medianDays, avgDaysToSell: medianDays, daysOfSupply: sold30 ? nActive / (sold30 / 30) : null, saleToList: null };
  }

  async function visorListing(id) {
    const r = await vreq(`/v1/listings/${encodeURIComponent(id)}`, { include: 'price_history,options' });
    return normalize(r.data);
  }

  async function visorVin(v) {
    const r = await vreq(`/v1/vins/${encodeURIComponent(v)}`, { include: 'price_history,options' });
    const d = r.data || {};
    if (!d.latest_listing) return null;
    return normalize(Object.assign({}, d.latest_listing, { vin: d.vin, status: d.status, build: d.build, vehicle: { build: d.build } }));
  }

  async function visorComparables(l, ctx, opts) {
    const o = opts || {};
    const years = [];
    for (let y = l.year - (o.years ?? 1); y <= l.year + (o.years ?? 1); y++) years.push(String(y));
    const f = { make: [l.make], model: [l.model], year: years, ex: {}, when: o.sold ? 'sold' : '0' };
    if (o.trim === 'same' && l.trim) f.trim = [l.trim];
    if (o.condition === 'same') f.condition = l.condition === 'New' ? ['New'] : ['Used', 'Certified'];
    const pp = Object.assign(toParams(f, ctx), { limit: PAGE, fields: 'default,options_packages' });
    if (o.radius && l.lat != null) Object.assign(pp, { latitude: l.lat, longitude: l.lng, radius: Math.min(500, o.radius) });
    const r = await vreq('/v1/listings', pp);
    return (r.data || []).map(normalize).filter((x) => x.id !== l.id);
  }

  // Lists the values Visor knows for a few facets (makes, models, features), for search vocabulary.
  async function visorVocabulary() {
    const r = await vreq('/v1/facets', { facets: 'make,model,features,upfitter,body_type', facet_value_limit: 100 });
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
    const specs = new Map();
    const baseOf = (c, l) => Math.exp(c[0] + c[1] * (currentYear - l.year + 0.5) + c[2] * (l.miles / 1000));
    for (const [k, g] of by) {
      if (g.length < 10) continue;
      let c = null;
      let lifts = new Map();
      for (let pass = 0; pass < 3; pass++) {
        const next = root.Market.fit2(g.map((x) => [currentYear - x.year + 0.5, x.miles / 1000, Math.log(x.price) - root.Market.liftOf(x, lifts)]));
        if (!next || !isFinite(next[0])) break;
        c = next;
        lifts = root.Market.specModel(g, (x) => baseOf(c, x));
      }
      if (!c) continue;
      coef.set(k, c);
      specs.set(k, lifts);
    }
    const explain = (l) => {
      if (l.condition === 'New') return l.msrp ? { base: l.msrp, adjustments: [], upfit: 0, expected: l.msrp } : null;
      const k = l.make + '|' + l.model;
      const c = coef.get(k);
      if (!c) return null;
      const base = baseOf(c, l);
      const s = root.Market.applySpecs(l, specs.get(k), base);
      return { base, adjustments: s.adjustments, upfit: 0, expected: s.value };
    };
    const expected = (l) => { const e = explain(l); return e ? e.expected : null; };
    expected.explain = explain;
    return expected;
  }

  /* ---------- auto.dev (free plan: 1,000 calls/month, 20 cars per call) ---------- */

  const AD_PAGE = 20;
  const areq = (path, params) => request(path, params, 'autodev');
  // Facet group -> Gridline filter key, and the query parameter that filters it.
  const AD_GROUP = { years: 'year', makes: 'make', models: 'model', trims: 'trim', types: 'body', exteriorColor: 'colorFamily',
    interiorColor: 'interiorFamily', fuel: 'fuel', drivetrain: 'drivetrain', states: 'state', transmissions: 'transmission' };
  const AD_PARAM_DEFAULT = { year: 'vehicle.year', make: 'vehicle.make', model: 'vehicle.model', trim: 'vehicle.trim', body: 'vehicle.bodyStyle',
    colorFamily: 'vehicle.exteriorColor', interiorFamily: 'vehicle.interiorColor', fuel: 'vehicle.fuel', drivetrain: 'vehicle.drivetrain',
    state: 'retailListing.state', transmission: 'vehicle.transmission' };
  const AD_LEARNED = 'gridline:autodev:params:v2';
  // auto.dev's facet links carry the real parameter names; remember them.
  const adParams = () => Object.assign({}, AD_PARAM_DEFAULT, safe(() => JSON.parse(localStorage.getItem(AD_LEARNED)), {}) || {});
  const AD_UNSUPPORTED = 'gridline:autodev:unsupported';
  const adUnsupported = () => new Set(safe(() => JSON.parse(localStorage.getItem(AD_UNSUPPORTED)), []) || []);
  const AD_FUEL_OUT = { Gas: 'Gasoline' };
  const AD_FUEL_IN = { Gasoline: 'Gas', 'Plug-In Hybrid': 'Plug-in Hybrid' };
  // Body styles auto.dev files under vehicle.type rather than vehicle.bodyStyle.
  const AD_TYPE_BODIES = ['Convertible', 'Wagon'];
  const AD_SORT = { 'price-asc': 'price.asc', 'price-desc': 'price.desc', 'miles-asc': 'miles.asc', 'miles-desc': 'miles.desc', 'year-desc': 'year.desc', newest: 'createdAt.desc', oldest: 'createdAt.asc' };

  // A bucket's link adds the parameter whose value is the bucket's own label,
  // e.g. "AWD (26079)" -> ...&vehicle.drivetrain=AWD. Match on that value.
  function learnParams(facets) {
    const learned = safe(() => JSON.parse(localStorage.getItem(AD_LEARNED)), {}) || {};
    for (const [group, buckets] of Object.entries(facets || {})) {
      const key = AD_GROUP[group];
      if (!key || !buckets || typeof buckets !== 'object') continue;
      for (const [label, url] of Object.entries(buckets).slice(0, 3)) {
        const value = label.replace(/ \(\d+\)$/, '').toLowerCase();
        try {
          const hit = [...new URL(url).searchParams].find(([name, val]) => !['includes', 'page', 'limit', 'sort'].includes(name) && val.toLowerCase() === value);
          if (hit) { learned[key] = hit[0]; break; }
        } catch (e) { /* not a URL */ }
      }
    }
    safe(() => localStorage.setItem(AD_LEARNED, JSON.stringify(learned)));
  }

  function adBuckets(group) {
    return Object.keys(group || {}).map((label) => {
      const m = label.match(/^(.*) \((\d+)\)$/);
      return m ? { value: m[1], count: Number(m[2]) } : { value: label, count: null };
    }).filter((b) => b.value !== '' && b.value !== 'null');
  }

  const range = (lo, hi) => `${lo != null ? lo : 0}-${hi != null ? hi : 9999999}`;

  function adToParams(f, ctx) {
    const P = adParams();
    const bad = adUnsupported();
    const p = {};
    const makes = ctx.makes || [];
    const put = (key, vals) => { if (vals.length && !bad.has(P[key])) p[P[key]] = vals.join(','); };
    const cond = f.condition || [];
    if (cond.length === 1 && cond[0] === 'Certified') p['retailListing.cpo'] = 'true';
    else if (cond.length && !cond.includes('New')) p['retailListing.used'] = 'true';
    else if (cond.length === 1 && cond[0] === 'New') p['retailListing.used'] = 'false';
    const modelMakes = [];
    const models = (f.model || []).map((v) => {
      const mk = makes.find((m) => v.toLowerCase().startsWith(m.toLowerCase() + ' '));
      if (mk) modelMakes.push(mk);
      return mk ? v.slice(mk.length + 1) : v;
    });
    put('make', [...new Set((f.make || []).concat(modelMakes))]);
    put('model', models);
    put('trim', f.trim || []);
    const years = (f.year || []).map(Number).sort((a, b) => a - b);
    if (years.length) p[P.year] = years.length > 1 && years[years.length - 1] - years[0] === years.length - 1 ? `${years[0]}-${years[years.length - 1]}` : years.join(',');
    const bodies = f.body || [];
    if (bodies.length && bodies.every((b) => AD_TYPE_BODIES.includes(b))) p['vehicle.type'] = bodies.join(',');
    else put('body', [...new Set(bodies.filter((b) => !AD_TYPE_BODIES.includes(b)).flatMap((v) => matchAll(v, ctx.known && ctx.known.bodies)))]);
    if (f.noAccidents) p['history.accidentCount'] = '0';
    if (f.oneOwner) p['history.ownerCount'] = '1';
    put('fuel', (f.fuel || []).map((v) => AD_FUEL_OUT[v] || v));
    put('drivetrain', f.drivetrain || []);
    // auto.dev's transmission names vary ("6-Speed Manual"); pick every one that matches.
    put('transmission', [...new Set((f.transmission || []).flatMap((v) => matchAll(v, ctx.known && ctx.known.transmissions)))]);
    put('colorFamily', f.colorFamily || []);
    put('interiorFamily', f.interiorFamily || []);
    put('state', f.state || []);
    if (f.priceMin != null || f.priceMax != null) p['retailListing.price'] = range(f.priceMin || 1, f.priceMax);
    if (f.milesMax != null) p['retailListing.miles'] = range(0, f.milesMax);
    const origin = f.near ? ctx.cityByName(f.near) : null;
    if (origin && ctx.zipFor) {
      const zip = ctx.zipFor(f.near);
      if (zip) { p.zip = zip; p.distance = Math.min(500, f.radius || 150); }
    }
    if (AD_SORT[f.sort]) p.sort = AD_SORT[f.sort];
    return p;
  }

  const COLOR_WORDS = [['white', 'White'], ['pearl', 'White'], ['black', 'Black'], ['ebony', 'Black'], ['silver', 'Silver'], ['gray', 'Gray'], ['grey', 'Gray'],
    ['graphite', 'Gray'], ['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['brown', 'Brown'], ['bronze', 'Brown'], ['beige', 'Beige'], ['tan', 'Tan'],
    ['gold', 'Gold'], ['orange', 'Orange'], ['yellow', 'Yellow'], ['purple', 'Purple'], ['burgundy', 'Burgundy']];
  const familyOf = (name) => {
    const n = String(name || '').toLowerCase();
    const hit = COLOR_WORDS.find(([w]) => n.includes(w));
    return hit ? hit[1] : null;
  };

  function adNormalize(r) {
    const v = r.vehicle || {};
    const rl = r.retailListing || {};
    const loc = Array.isArray(r.location) ? r.location : [];
    const fam = familyOf(v.exteriorColor) || 'Gray';
    const h = r.history || {};
    const typeBody = AD_TYPE_BODIES.includes(v.type) ? v.type : null;
    const dom = daysSince(r.createdAt) || 0;
    const price = rl.price || 0;
    const removed = r.removedAt ? daysSince(r.removedAt) : null;
    return {
      live: true, provider: 'autodev',
      id: r.vin || v.vin, vin: r.vin || v.vin,
      year: v.year, make: v.make || '', model: v.model || '',
      trim: v.trim || (v.series ? (v.series.match(/^(.*?)\s+\d+dr\b/) || [])[1] || '' : ''),
      body: bodyShape(typeBody || v.bodyStyle || v.type || ''), bodyLabel: [v.style || v.bodyStyle, v.type].filter(Boolean).join(' · '), segment: v.type || v.bodyStyle || '',
      series: v.series || null,
      drivetrain: v.drivetrain || '—', fuel: AD_FUEL_IN[v.fuel] || v.fuel || '—', engine: v.engine || null, transmission: v.transmission || null,
      seats: v.seats || null, doors: v.doors || null,
      condition: rl.cpo ? 'Certified' : rl.used === false ? 'New' : 'Used', status: null,
      miles: rl.miles || 0, price, msrp: v.baseMsrp || null, msrpBase: v.baseMsrp || null,
      discount: v.baseMsrp && price && rl.used === false ? 1 - price / v.baseMsrp : null,
      options: [], features: [],
      extColor: v.exteriorColor || '—', extHex: FAMILY_HEX[fam] || '#888', intColor: v.interiorColor || '—',
      colorFamily: v.exteriorColor || fam, interiorFamily: v.interiorColor || '—',
      dealer: rl.dealer || 'Dealer', dealerId: rl.dealerId || null, franchise: false, seller: 'Dealer', dealerPhone: null,
      city: rl.city || '', state: rl.state || '', zip: rl.zip || null, lat: loc[1], lng: loc[0], distance: null,
      daysListed: removed != null ? Math.max(0, dom - removed) : dom,
      history: [{ daysAgo: dom, price }].concat(removed != null ? [{ daysAgo: removed, price }] : []),
      sold: removed != null ? { daysAgo: removed, price, daysToSell: Math.max(0, dom - removed) } : null,
      upfitter: null, assembly: { plant: 'Unknown', country: '' }, windowStickerVerified: false, titleStatus: null, certification: null,
      photos: rl.primaryImage ? [rl.primaryImage] : [], photoCount: rl.photoCount || 0,
      vdpUrl: rl.vdp || null, vhrUrl: rl.carfaxUrl || null,
      accidents: r.history ? h.accidents : null, accidentCount: h.accidentCount != null ? h.accidentCount : null,
      ownerCount: r.history ? h.ownerCount : null, oneOwner: h.oneOwner != null ? h.oneOwner : null, usageType: h.usageType || null,
      livePricing: null, previous: [],
      pricing: { advertised: price, msrp: null, discount: 0, marketAdjustment: 0, incentives: [], addOns: [], docFee: 0, notes: [] },
    };
  }

  // Runs a request; if auto.dev rejects a filter parameter we guessed, drop it, remember, and retry once.
  async function adGet(path, params) {
    try {
      return await areq(path, params);
    } catch (e) {
      const m = e.code === 'bad_request' && /parameter[^:]*:\s*([\w.]+)/i.exec(e.message);
      if (!m || params[m[1]] === undefined) throw e;
      const bad = adUnsupported();
      bad.add(m[1]);
      safe(() => localStorage.setItem(AD_UNSUPPORTED, JSON.stringify([...bad])));
      const next = Object.assign({}, params);
      delete next[m[1]];
      const r = await areq(path, next);
      r._dropped = m[1];
      return r;
    }
  }

  async function adSearch(f, ctx, opts) {
    const o = opts || {};
    const params = Object.assign(adToParams(f, ctx), { limit: AD_PAGE, page: Math.floor((o.offset || 0) / AD_PAGE) + 1 });
    // opts.lite (hunt checks): just the cars and the total, no filter counts.
    if (!o.offset) params.includes = o.lite ? 'total' : 'total,facets';
    const r = await adGet('/listings', params);
    const results = (r.data || []).map(adNormalize);
    let facets = null;
    if (r.facets) {
      learnParams(r.facets);
      facets = { condition: ['New', 'Used', 'Certified'].map((value) => ({ value, count: null })) };
      for (const [group, buckets] of Object.entries(r.facets)) {
        const key = AD_GROUP[group];
        if (!key) continue;
        facets[key] = adBuckets(buckets).map((b) => ({ value: key === 'fuel' ? AD_FUEL_IN[b.value] || b.value : b.value, count: b.count, avgPrice: null, avgDays: null, avgDiscount: null }));
      }
    }
    const offset = o.offset || 0;
    return {
      results, facets, total: r.total != null ? r.total : offset + results.length,
      nextOffset: r.links && r.links.next && results.length ? offset + results.length : null,
      stats: null, dropped: r._dropped || null,
    };
  }

  async function adListing(vinOrId) {
    const r = await adGet(`/listings/${encodeURIComponent(vinOrId)}`, {});
    return adNormalize(r.data || {});
  }

  async function adPhotos(vin) {
    const r = await areq(`/photos/${encodeURIComponent(vin)}`, {});
    return (r.data && r.data.retail) || [];
  }

  async function adComparables(l, ctx, opts) {
    const o = opts || {};
    const y = o.years ?? 1;
    const f = { make: [l.make], model: [l.model], year: [], ex: {} };
    for (let yr = l.year - y; yr <= l.year + y; yr++) f.year.push(String(yr));
    if (o.trim === 'same' && l.trim) f.trim = [l.trim];
    if (o.condition === 'same') f.condition = l.condition === 'New' ? ['New'] : ['Used', 'Certified'];
    const params = Object.assign(adToParams(f, ctx), { limit: AD_PAGE });
    if (o.radius && l.zip) Object.assign(params, { zip: l.zip, distance: Math.min(500, o.radius) });
    const r = await adGet('/listings', params);
    return (r.data || []).map(adNormalize).filter((x) => x.id !== l.id);
  }

  async function adCount(f, ctx) {
    const r = await adGet('/listings', Object.assign(adToParams(f, ctx), { limit: 1, includes: 'total' }));
    return r.total || 0;
  }

  // One call gives the makes, models, body styles and transmissions auto.dev knows; kept for a week.
  const AD_VOCAB = 'gridline:autodev:vocab:v2';
  async function adVocabulary() {
    const cached = safe(() => JSON.parse(localStorage.getItem(AD_VOCAB)), null);
    if (cached && Date.now() - cached.t < 7 * 864e5) return cached.v;
    const r = await adGet('/listings', { limit: 1, includes: 'facets' });
    learnParams(r.facets || {});
    const fx = r.facets || {};
    const v = {
      makes: adBuckets(fx.makes).map((b) => b.value), models: adBuckets(fx.models).map((b) => b.value),
      bodies: adBuckets(fx.types).map((b) => b.value), transmissions: adBuckets(fx.transmissions).map((b) => b.value), features: [], upfitters: [],
      overview: { makes: adBuckets(fx.makes).slice(0, 12), prices: adBuckets(fx.prices), states: adBuckets(fx.states) },
    };
    safe(() => localStorage.setItem(AD_VOCAB, JSON.stringify({ t: Date.now(), v })));
    return v;
  }

  // Nationwide snapshot for the home page: total plus make and price buckets (1 call).
  async function adOverview() {
    const r = await adGet('/listings', { limit: 1, includes: 'total,facets' });
    const fx = r.facets || {};
    return { total: r.total || 0, makes: adBuckets(fx.makes).slice(0, 12), prices: adBuckets(fx.prices), states: adBuckets(fx.states), bodies: adBuckets(fx.types).slice(0, 8) };
  }

  const unsupported = (what) => async () => { throw new LiveError('unsupported', `${what} isn't available from ${PROVIDERS[current].name}.`); };

  /* ---------- Providers ---------- */

  const MODULES = {
    visor: {
      caps: { exclude: true, sold: true, snapshots: true, velocity: true, metrics: true, trend: true, features: true, options: true, upfitter: true,
        assembly: true, msrp: true, vinPattern: true, sellerType: true, pricing: true, facetCounts: true, extColor: true, photosApi: false },
      search: visorSearch, facetMetrics: visorFacetMetrics, count: visorCount, summary: visorSummary, inventoryTrend: visorInventoryTrend, velocity: visorVelocity,
      listing: visorListing, vin: visorVin, comparables: visorComparables, vocabulary: visorVocabulary, photos: unsupported('Photo galleries'),
      overview: unsupported('Overview'), toParams, SORT, PAGE,
    },
    autodev: {
      caps: { exclude: false, sold: false, snapshots: false, velocity: false, metrics: false, trend: false, features: false, options: false, upfitter: false,
        assembly: false, msrp: false, vinPattern: false, sellerType: false, pricing: false, facetCounts: true, extColor: false, photosApi: true, history: true, historyFilters: true },
      search: adSearch, facetMetrics: unsupported('Per-value price stats'), count: adCount, summary: unsupported('Market summary'), inventoryTrend: unsupported('Inventory history'),
      velocity: unsupported('Sales velocity'), listing: adListing, vin: adListing, comparables: adComparables, vocabulary: adVocabulary,
      photos: adPhotos, overview: adOverview, toParams: adToParams, SORT: AD_SORT, PAGE: AD_PAGE,
    },
  };
  const mod = () => MODULES[current];
  const call = (name) => (...args) => mod()[name](...args);

  const api = {
    PROVIDERS, setProvider, provider, info, getKey, setKey, builtInKey, usage, costs, request, transport, LiveError,
    caps: () => mod().caps, get SORT() { return mod().SORT; }, get PAGE() { return mod().PAGE; },
    toParams: (...a) => mod().toParams(...a),
    search: call('search'), facetMetrics: call('facetMetrics'), count: call('count'), summary: call('summary'), inventoryTrend: call('inventoryTrend'),
    velocity: call('velocity'), listing: call('listing'), vin: call('vin'), comparables: call('comparables'), vocabulary: call('vocabulary'),
    photos: call('photos'), overview: call('overview'),
    normalize, adNormalize, adBuckets, adToParams, bucketsOf, fairValueFrom, titleCase, FAMILY_HEX, PARAM, FACET_NAMES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Live = api;
})(typeof window !== 'undefined' ? window : globalThis);
