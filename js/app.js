/* Gridline app: hash-routed views over the in-memory market. */
(function () {
  'use strict';

  const { esc } = Charts;
  const CURRENT_YEAR = 2026;
  const PAGE = 24;

  /* ---------- Data + derived models ---------- */

  // The demo market takes a few hundred milliseconds to build, which would hold up the first live
  // request on every load. So it, and everything derived from it, is built the first time something
  // reads it; with live data on, the home page often never does. `lazy` stands in for the value
  // (an array, a Map, an object or a function) and hands every use to the real one.
  function lazy(target, make) {
    let real = null;
    const get = () => real || (real = make());
    return new Proxy(target, {
      get(t, k) { const r = get(), v = r[k]; return typeof v === 'function' ? v.bind(r) : v; },
      apply: (t, self, args) => get()(...args),
      has: (t, k) => k in get(),
      ownKeys: () => Reflect.ownKeys(get()),
      getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(get(), k),
    });
  }
  let DEMO = null;
  const demo = () => DEMO || (DEMO = MarketData.generateInventory({ currentYear: CURRENT_YEAR }));
  const DATA = { models: MarketData.MODELS, cities: MarketData.CITIES, get dealers() { return demo().dealers; } };
  const LISTINGS = lazy([], () => demo().listings); // for sale today
  const SOLD = lazy([], () => demo().sold);         // sold in the last ~120 days
  const ALL = lazy([], () => demo().listings.concat(demo().sold));
  const BY_ID = lazy(new Map(), () => new Map(ALL.map((l) => [l.id, l])));
  const BY_VIN = lazy(new Map(), () => {
    const m = new Map(ALL.map((l) => [l.vin, l]));
    for (const l of LISTINGS) m.set(l.vin, l);
    return m;
  });
  // Trained on cars for sale and recently sold, so rare specs have enough examples.
  const fairValue = lazy(() => {}, () => Market.buildFairValue(ALL, CURRENT_YEAR));
  const expectedCache = new Map();
  const expected = (l) => {
    if (l.live) return LIVE_EXPECTED.has(l.id) ? LIVE_EXPECTED.get(l.id) : null;
    if (!expectedCache.has(l.id)) expectedCache.set(l.id, fairValue(l));
    return expectedCache.get(l.id);
  };
  // The parts of a car's expected price: base value plus any spec premiums.
  const explainValue = (l) => (l.live ? LIVE_EXPLAIN.get(l.id) || null : fairValue.explain(l));
  function setLiveValue(fv, l) {
    LIVE_EXPECTED.set(l.id, fv(l));
    if (fv.explain) LIVE_EXPLAIN.set(l.id, fv.explain(l));
  }
  const delta = (l) => {
    const e = expected(l);
    return e ? l.price / e - 1 : 0;
  };
  const rarity = lazy(() => {}, () => Market.colorStats(LISTINGS));
  const CITY_NAMES = [...new Set(DATA.cities.map((c) => `${c[0]}, ${c[1]}`))].sort();
  const cityByName = (name) => DATA.cities.find((c) => `${c[0]}, ${c[1]}` === name);
  const MODEL_KEYS = DATA.models.map((m) => `${m.make} ${m.model}`);
  const modelOf = (key) => DATA.models.find((m) => `${m.make} ${m.model}` === key);
  const UPFITTER_NAMES = [...new Set(Object.values(MarketData.UPFITTERS).flat().map((u) => u[0]))];
  const VOCAB = NLQ.build({
    models: DATA.models, cities: DATA.cities, currentYear: CURRENT_YEAR,
    paints: [...new Set(Object.values(MarketData.PALETTES).flat().map((p) => p[0]))], upfitters: UPFITTER_NAMES,
  });

  const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington, DC', FL: 'Florida',
    GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
    TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const stateName = (st) => STATE_NAMES[st] || st;

  // Typical sales tax by state, for out-the-door estimates.
  const STATE_TAX = { CA: 8.8, NY: 8.5, TX: 6.25, FL: 7, GA: 7, NC: 3, IL: 8.25, OH: 7.2, PA: 6, MI: 6, CO: 7.7, AZ: 8.4, WA: 9.3, MN: 6.9,
    OR: 0, MA: 6.25, NJ: 6.6, VA: 4.15, TN: 9.5, IN: 7, MO: 8.2, MD: 6, WI: 5.4, SC: 5, AL: 4, LA: 9.5, KY: 6, OK: 3.25, UT: 7.2, NV: 8.2 };
  const stateTax = (st) => (STATE_TAX[st] != null ? STATE_TAX[st] : 6.5);
  const DOC_FEE_TYPICAL = lazy({}, () => {
    const by = Market.groupBy(LISTINGS.filter((l) => l.seller === 'Dealer'), (l) => l.state);
    const out = {};
    for (const [st, g] of by) out[st] = Market.median(g.map((l) => l.pricing.docFee));
    return out;
  });

  /* ---------- Persistence ---------- */

  const CITY_ZIP = {
    'Haverhill, MA': '01830', 'Boston, MA': '02108', 'Elmsford, NY': '10523', 'Albany, NY': '12207', 'Pawtucket, RI': '02860', 'Hartford, CT': '06103',
    'Newark, NJ': '07102', 'Philadelphia, PA': '19107', 'Pittsburgh, PA': '15222', 'Baltimore, MD': '21202', 'Hampton, VA': '23669', 'Richmond, VA': '23219',
    'Raleigh, NC': '27601', 'Charlotte, NC': '28202', 'Charleston, SC': '29401', 'Buford, GA': '30518', 'Atlanta, GA': '30303', 'Orlando, FL': '32801',
    'Tampa, FL': '33602', 'Miami, FL': '33130', 'Nashville, TN': '37203', 'Birmingham, AL': '35203', 'Columbus, OH': '43215', 'Cleveland, OH': '44113',
    'Detroit, MI': '48226', 'Indianapolis, IN': '46204', 'Louisville, KY': '40202', 'Schaumburg, IL': '60173', 'Chicago, IL': '60601', 'Milwaukee, WI': '53202',
    'Minneapolis, MN': '55401', 'Des Moines, IA': '50309', 'St. Louis, MO': '63101', 'Kansas City, MO': '64106', 'Omaha, NE': '68102', 'Dallas, TX': '75201',
    'Houston, TX': '77002', 'Austin, TX': '78701', 'Amarillo, TX': '79101', 'Oklahoma City, OK': '73102', 'New Orleans, LA': '70112', 'Little Rock, AR': '72201',
    'Denver, CO': '80202', 'Salt Lake City, UT': '84101', 'Albuquerque, NM': '87102', 'Phoenix, AZ': '85004', 'Las Vegas, NV': '89101', 'Boise, ID': '83702',
    'Seattle, WA': '98101', 'Portland, OR': '97204', 'Sacramento, CA': '95814', 'San Jose, CA': '95113', 'Los Altos, CA': '94022', 'Thousand Oaks, CA': '91360',
    'San Diego, CA': '92101', 'Anchorage, AK': '99501', 'Honolulu, HI': '96813', 'Burlington, VT': '05401', 'Portland, ME': '04101', 'Billings, MT': '59101',
  };


  const STORE_KEY = 'gridline:v1';
  const store = (() => {
    let s = { saved: [], favs: {}, compare: [], recent: [], theme: null, prefs: {} };
    try { s = Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) { /* private mode */ }
    s.prefs = Object.assign({ homeCity: null, homeZip: null, homeRadius: 100, showDealer: false, compact: false, valueSort: 'count', dataSource: 'demo', huntEvery: 360 }, s.prefs);
    // Older saves kept a demo city as home; carry it over to that city's ZIP code.
    if (!s.prefs.homeZip && s.prefs.homeCity && CITY_ZIP[s.prefs.homeCity]) s.prefs.homeZip = CITY_ZIP[s.prefs.homeCity];
    if (!Geo.isZip(s.prefs.homeZip) || !Geo.lookup(s.prefs.homeZip)) s.prefs.homeZip = null;
    s.liveCars = s.liveCars || {};
    if (s.prefs.dataSource === 'live') s.prefs.dataSource = 'visor';
    // A desktop build with a built-in key starts on live data, preferring Visor (fuller data) over auto.dev.
    const builtIn = (window.gridlineDesktop && window.gridlineDesktop.defaultKeys) || {};
    if (!s.prefs.sourceChosen && (builtIn.visor || builtIn.autodev)) s.prefs.dataSource = builtIn.visor ? 'visor' : 'autodev';
    return {
      get: () => s,
      update(fn) {
        fn(s);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
        updateNavCounts();
      },
    };
  })();
  const prefs = () => store.get().prefs;
  // A place to measure from: a ZIP code ("94022") or a demo city ("Denver, CO"), as [name, state, lat, lng].
  const placeOf = (near) => (Geo.isZip(near) ? Geo.place(near) : cityByName(near));
  const placeLabel = (near) => (Geo.isZip(near) ? `${Geo.label(Geo.lookup(near), { short: true })} ${near}` : near);
  const homeZip = () => prefs().homeZip || null;
  const homeRadius = () => Number(prefs().homeRadius) || 100;
  const CTX = {
    delta, cityByName: placeOf,
    get origin() { return homeZip() ? Geo.place(homeZip()) : null; },
  };

  /* ---------- Live data (auto.dev or Visor API) ---------- */

  const SOURCE = () => prefs().dataSource || 'demo';
  const syncProvider = () => { if (SOURCE() !== 'demo') Live.setProvider(SOURCE()); };
  syncProvider();
  const isLive = () => SOURCE() !== 'demo' && !!Live.getKey(SOURCE());
  const srcName = () => Live.info().name;
  const srcLink = () => `<a href="${Live.info().site}" target="_blank" rel="noopener">${esc(srcName())}</a>`;
  // What the active live source can do (null in demo mode = everything).
  const liveCaps = () => (isLive() ? Live.caps() : null);
  const can = (cap) => { const c = liveCaps(); return !c || !!c[cap]; };
  const DEMO_MAKES = [...new Set(DATA.models.map((m) => m.make))];
  const LIVE_EXPECTED = new Map();
  const LIVE_EXPLAIN = new Map();
  const LIVE_SEEN = new Map();
  let LIVE_VOCAB = null, LIVE_KNOWN = null;
  const liveCtx = () => ({ cityByName: placeOf, zipFor: (c) => (Geo.isZip(c) ? c : CITY_ZIP[c] || null), home: CTX.origin, makes: [...new Set(DEMO_MAKES.concat((LIVE_KNOWN && LIVE_KNOWN.makes) || []))], known: LIVE_KNOWN });
  const vocab = () => (isLive() && LIVE_VOCAB) || VOCAB;

  async function ensureLiveVocab(opts) {
    if (LIVE_KNOWN) return;
    try {
      LIVE_KNOWN = await Live.vocabulary(opts);
      LIVE_VOCAB = NLQ.build({
        models: DATA.models.concat(LIVE_KNOWN.models.filter((m) => !MODEL_KEYS.some((k) => k.endsWith(' ' + m))).map((m) => ({ make: '', model: m, trims: [] }))),
        makes: LIVE_KNOWN.makes, cities: DATA.cities, currentYear: CURRENT_YEAR,
        paints: [], upfitters: UPFITTER_NAMES,
      });
    } catch (e) {
      LIVE_KNOWN = { makes: [], models: [], features: [], upfitters: [] };
    }
  }

  // Keep a slim copy of live cars you favorite, compare or view, so those
  // pages work without re-fetching.
  function rememberLive(l) {
    if (!l || !l.live) return;
    LIVE_SEEN.set(l.id, l);
    const slim = Object.assign({}, l, { photos: (l.photos || []).slice(0, 1), history: l.history.slice(-6), livePricing: null });
    store.update((s) => {
      s.liveCars[l.id] = slim;
      const ids = Object.keys(s.liveCars);
      const keep = new Set([...Object.keys(s.favs), ...s.compare, ...s.recent, ...s.saved.flatMap(huntNewsIds)]);
      if (ids.length > 80) for (const id of ids) if (!keep.has(id) && Object.keys(s.liveCars).length > 80) delete s.liveCars[id];
    });
  }
  const carById = (id) => BY_ID.get(id) || LIVE_SEEN.get(id) || store.get().liveCars[id] || null;

  function liveErrorHtml(e) {
    const tips = {
      no_key: `Open <a href="#/settings">Settings</a> and paste your API key.`,
      auth: `The data source rejected the API key. Check it in <a href="#/settings">Settings</a>.`,
      billing: `Your API balance or spending cap is used up. <a href="${Live.info().keyUrl}" target="_blank" rel="noopener">Top up your balance</a>.`,
      rate_limit: SOURCE() === 'autodev' ? 'Either this month’s 1,000 free auto.dev calls are used up (they reset on the 1st), or too many requests went out at once. Wait a few seconds and try again.' : 'Too many requests in a short time. Wait a few seconds and try again.',
      blocked: 'Live data works in the Gridline desktop app, or when you run <code>npm start</code> and open <a href="http://localhost:8080">localhost:8080</a>.',
      unsupported: 'That needs data the live source doesn’t provide.',
    };
    return `<div class="card live-error"><h3>Couldn’t load live listings</h3><p>${esc(e.message || String(e))}</p><p class="muted">${tips[e.code] || ''}</p>
      <p><button class="btn" type="button" data-action="use-demo">Switch to demo data</button></p></div>`;
  }
  const loadingHtml = (msg) => `<div class="card loading-card"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</div>`;

  /* ---------- Formatting ---------- */

  const money = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'));
  const moneyK = (n) => (n == null ? '—' : '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : Math.round(n)));
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const miles = (n) => `${num(n)} mi`;
  const kMiles = (n) => (n < 1000 ? `${num(n)} mi` : `${Math.round(n / 1000)}k mi`);
  const pct = (v, digits) => `${(v * 100).toFixed(digits == null ? 0 : digits)}%`;
  const title = (l) => `${l.year} ${l.make} ${l.model}`;
  const days = (d) => (d === 0 ? 'Listed today' : d === 1 ? '1 day for sale' : `${d} days for sale`);
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : /(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`;
  const ago = (d) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
  const distanceTo = (l) => {
    const o = CTX.origin;
    return o ? Market.haversineMiles(o[2], o[3], l.lat, l.lng) : null;
  };

  function marketText(l) {
    const e = expected(l);
    if (!e) return null;
    const diff = l.price - e;
    const d = l.price / e - 1;
    const tone = d <= -0.07 ? 'great' : d <= -0.03 ? 'good' : d < 0.03 ? 'fair' : d < 0.07 ? 'high' : 'over';
    const label = Math.abs(d) < 0.01 ? 'At market' : `${money(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'}`;
    return { diff, d, tone, label, expected: e };
  }

  const weekOf = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  })();
  const dateDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /* ---------- Filters <-> URL ---------- */

  const ARRAY_KEYS = Market.FACETS;
  const NUM_KEYS = ['priceMin', 'priceMax', 'msrpMin', 'msrpMax', 'milesMax', 'radius'];
  const BOOL_KEYS = ['dropsOnly', 'belowMarket', 'noAccidents', 'oneOwner'];
  const FACET_LABELS = {
    condition: 'Condition', make: 'Make', model: 'Model', trim: 'Trim', year: 'Model year', body: 'Body style', drivetrain: 'Drivetrain', transmission: 'Transmission',
    fuel: 'Fuel', colorFamily: 'Exterior color', extColor: 'Paint name', interiorFamily: 'Interior color', features: 'Top features',
    options: 'Installed options', upfitter: 'Upfitter', assembly: 'Assembly location', seller: 'Seller type', state: 'State',
  };
  const WHEN = [['0', 'for sale today'], ['7', 'for sale 1 week ago'], ['30', 'for sale 1 month ago'], ['90', 'for sale 3 months ago'], ['sold', 'sold in the last 120 days']];

  function filtersFromParams(params) {
    const f = Market.emptyFilters();
    for (const k of ARRAY_KEYS) {
      f[k] = params.getAll(k);
      const ex = params.getAll('x.' + k);
      if (ex.length) f.ex[k] = ex;
    }
    for (const k of NUM_KEYS) if (params.get(k)) f[k] = Number(params.get(k));
    for (const k of BOOL_KEYS) f[k] = params.get(k) === '1';
    f.q = params.get('q') || '';
    f.vin = params.get('vin') || '';
    f.near = params.get('near') || null;
    f.sort = params.get('sort') || 'best';
    f.when = params.get('when') || '0';
    return f;
  }

  function paramsFromFilters(f) {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    for (const k of ARRAY_KEYS) {
      for (const v of f[k] || []) p.append(k, v);
      for (const v of (f.ex && f.ex[k]) || []) p.append('x.' + k, v);
    }
    for (const k of NUM_KEYS) if (f[k] != null && !(k === 'radius' && (f[k] === 150 || !f.near))) p.set(k, f[k]);
    for (const k of BOOL_KEYS) if (f[k]) p.set(k, '1');
    if (f.vin) p.set('vin', f.vin);
    if (f.near) p.set('near', f.near);
    if (f.when && f.when !== '0') p.set('when', f.when);
    if (f.sort && f.sort !== 'best') p.set('sort', f.sort);
    return p;
  }

  const searchHref = (obj) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) [].concat(v).forEach((x) => p.append(k, x));
    return '#/search?' + p.toString();
  };

  // A parsed natural-language query, as a search URL.
  function nlHref(parsed) {
    const f = Object.assign(Market.emptyFilters(), parsed.filters, { q: parsed.rest || '' });
    f.ex = parsed.filters.ex || {};
    return '#/search?' + paramsFromFilters(f).toString();
  }

  function describeFilters(f) {
    const parts = [];
    const list = (k) => (f[k] && f[k].length ? f[k].join(', ') : null);
    if (f.condition.length) parts.push(f.condition.join('/'));
    if (f.year.length) parts.push(f.year.length > 2 ? `${f.year[0]}–${f.year[f.year.length - 1]}` : f.year.join(', '));
    if (f.model.length) parts.push(f.model.join(', '));
    else if (f.make.length) parts.push(f.make.join(', '));
    for (const k of ['trim', 'body', 'fuel', 'drivetrain', 'transmission', 'colorFamily', 'extColor', 'upfitter', 'assembly']) if (list(k)) parts.push(list(k));
    if (f.interiorFamily.length) parts.push(`${f.interiorFamily.join('/')} interior`);
    if (f.features.length) parts.push(`with ${f.features.join(', ')}`);
    if (f.options.length) parts.push(`with ${f.options.join(', ')}`);
    for (const [k, vals] of Object.entries(f.ex || {})) if (vals.length) parts.push(`without ${vals.join(', ')}`);
    if (f.seller.length) parts.push(f.seller.map((s) => (s === 'Private' ? 'private sellers' : 'dealers')).join('/'));
    if (f.q) parts.push(`“${f.q}”`);
    if (f.vin) parts.push(`VIN ${f.vin.toUpperCase()}`);
    if (f.priceMin != null) parts.push(`over ${money(f.priceMin)}`);
    if (f.priceMax != null) parts.push(`under ${money(f.priceMax)}`);
    if (f.msrpMin != null) parts.push(`MSRP over ${money(f.msrpMin)}`);
    if (f.msrpMax != null) parts.push(`MSRP under ${money(f.msrpMax)}`);
    if (f.milesMax != null) parts.push(`< ${kMiles(f.milesMax)}`);
    if (f.near) parts.push(`within ${f.radius} mi of ${placeLabel(f.near)}`);
    if (f.state.length) parts.push(`in ${f.state.join(', ')}`);
    if (f.dropsOnly) parts.push('with price cuts');
    if (f.belowMarket) parts.push('below market');
    if (f.noAccidents) parts.push('no accidents');
    if (f.oneOwner) parts.push('one owner');
    return parts.join(' · ') || 'All cars';
  }

  // Which listings a search runs over: today's market, a past date, or sold cars.
  const snapshots = new Map();
  function datasetFor(f) {
    if (f.when === 'sold') return SOLD;
    const n = Number(f.when) || 0;
    if (!n) return LISTINGS;
    if (!snapshots.has(n)) snapshots.set(n, Market.snapshot(LISTINGS, SOLD, n));
    return snapshots.get(n);
  }

  /* ---------- Shared UI bits ---------- */

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // In-page replacement for window.prompt(), which the desktop shell doesn't support.
  function askText(label, value, okLabel) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'ask';
      dlg.innerHTML = `<form method="dialog">
        <label><span>${esc(label)}</span><input name="v" required maxlength="120" value="${esc(value || '')}"></label>
        <div class="ask-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" value="ok">${esc(okLabel || 'OK')}</button></div>
      </form>`;
      document.body.appendChild(dlg);
      const input = dlg.querySelector('input');
      dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close('cancel'));
      dlg.addEventListener('close', () => {
        resolve(dlg.returnValue === 'ok' ? input.value.trim() || null : null);
        dlg.remove();
      });
      dlg.showModal();
      input.select();
    });
  }

  // Full-screen document viewer (window sticker, build sheet).
  function showDoc(html, label) {
    const dlg = document.createElement('dialog');
    dlg.className = 'doc-dialog';
    dlg.setAttribute('aria-label', label);
    dlg.innerHTML = `<div class="doc-bar"><b>${esc(label)}</b><span class="muted small">Reconstructed from listing data</span>
      <button class="btn ghost" type="button" data-print>Print</button><button class="icon-btn" type="button" data-close aria-label="Close">✕</button></div>
      <div class="doc-body">${html}</div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-print]').addEventListener('click', () => {
      document.body.classList.add('printing-doc');
      window.print();
      document.body.classList.remove('printing-doc');
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  function updateNavCounts() {
    const s = store.get();
    const set = (id, n) => {
      const el = document.getElementById(id);
      el.hidden = !n;
      el.textContent = n;
    };
    const news = s.saved.reduce((n, h) => n + huntNewCount(h), 0);
    set('saved-count', news > 99 ? '99+' : news || s.saved.length + Object.keys(s.favs).length);
    document.getElementById('saved-count').classList.toggle('pill-new', news > 0);
    document.getElementById('saved-count').title = news ? `${news} new in your hunts` : '';
    set('compare-count', s.compare.length);
  }

  function badge(text, cls, tip) {
    return `<span class="badge ${cls || ''}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(text)}</span>`;
  }

  function conditionBadge(l) {
    return badge(l.condition, 'b-' + l.condition.toLowerCase());
  }

  function upfitBadge(l) {
    if (!l.upfitter) return '';
    return badge(`🔧 ${l.upfitter.name}`, 'b-upfit', `${l.upfitter.name}: ${l.upfitter.category.toLowerCase()} builder. Typical upfit ≈ ${money(l.upfitter.cost)}.`);
  }

  // What the spec adds to (or takes off) a car's expected price, and why.
  function specBreakdownHtml(l) {
    const e = explainValue(l);
    if (!e || !e.adjustments.length) return '';
    const name = `${l.make} ${l.model}`;
    return `<ul class="spec-adj" aria-label="What the spec is worth">
      <li><span>Base value for its year and miles</span><b>${money(e.base)}</b></li>
      ${e.adjustments.map((a) => `<li><span>${esc(a.label)} <small class="muted">${a.pct > 0 ? '+' : ''}${pct(a.pct, 1)} vs. ${esc(a.vs)}, from ${plural(a.n, 'car')}</small></span><b class="${a.amount >= 0 ? 'good' : 'bad'}">${a.amount >= 0 ? '+' : '−'}${money(Math.abs(a.amount))}</b></li>`).join('')}
    </ul><p class="muted small">Spec premiums come from ${l.live ? 'the listings loaded' : 'cars for sale and sold'} in the ${esc(name)} market, counted only when the difference is clear of normal price noise.</p>`;
  }

  function deltaChip(l) {
    const m = marketText(l);
    if (!m) return '';
    const specs = (explainValue(l) || { adjustments: [] }).adjustments.map((a) => a.label.toLowerCase());
    return `<span class="mkt mkt-${m.tone}" title="Compared with similar ${esc(l.make + ' ' + l.model)}s, adjusted for year, mileage, trim${specs.length ? ' and ' + esc(specs.join(', ')) : ''}. Expected ≈ ${money(m.expected)}">${esc(m.label)}</span>`;
  }

  function favButton(l) {
    const on = !!store.get().favs[l.id];
    return `<button class="icon-btn fav${on ? ' on' : ''}" type="button" data-action="fav" data-id="${l.id}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} favorites">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></button>`;
  }

  function compareButton(l) {
    const on = store.get().compare.includes(l.id);
    return `<button class="chip-btn cmp${on ? ' on' : ''}" type="button" data-action="compare" data-id="${l.id}" aria-pressed="${on}">${on ? '✓ Comparing' : '+ Compare'}</button>`;
  }

  function whereText(l) {
    const d = distanceTo(l);
    const place = prefs().showDealer ? l.dealer : `${l.city}, ${l.state}`;
    return d != null ? `${place} · ${num(d)} mi` : place;
  }

  function listingCard(l, opts) {
    const cut = Market.lastChange(l);
    const sub = [l.trim, kMiles(l.miles), l.drivetrain, l.transmission === 'Manual' || /manual/i.test(l.transmission || '') ? 'Manual' : null].filter(Boolean).join(' · ');
    const href = `#/car/${l.id}${l.asOf ? '?asOf=' + l.asOf : ''}`;
    const meta = l.sold
      ? `${esc(whereText(l))} · <b>Sold ${ago(l.sold.daysAgo)}</b> after ${plural(l.sold.daysToSell, 'day')}`
      : `${esc(whereText(l))} · ${esc(days(l.daysListed))}${cut && cut.delta < 0 ? ` · <span class="drop">↓ ${money(-cut.delta)} ${cut.daysAgo <= 1 ? 'today' : cut.daysAgo + 'd ago'}</span>` : ''}`;
    return `<article class="card listing-card${l.sold ? ' is-sold' : ''}">
      <a class="card-link" href="${href}" aria-label="${esc(title(l) + ' ' + l.trim + ', ' + money(l.price))}"></a>
      <div class="card-art${l.photos && l.photos[0] ? ' has-photo' : ''}" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex, { label: `${l.extColor} ${l.model}` })}
        ${l.photos && l.photos[0] ? `<img class="card-photo" src="${esc(l.photos[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('has-photo');this.remove()">` : ''}
        ${opts && opts.ribbon ? `<span class="ribbon">${esc(opts.ribbon)}</span>` : ''}
        <div class="card-art-top">${conditionBadge(l)}${l.sold ? badge('Sold', 'b-sold') : ''}${l.status && l.status !== 'On lot' && !l.sold ? badge(l.status, 'b-status') : ''}${l.seller === 'Private' ? badge('Private', 'b-private') : ''}${upfitBadge(l)}</div>
        <div class="card-art-actions">${favButton(l)}</div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(title(l))}</h3>
        <p class="card-sub">${esc(sub)}</p>
        <div class="card-price-row">
          <span class="price">${l.sold ? '<small class="muted">Sold for</small> ' : ''}${money(l.price)}</span>
          ${l.sold ? '' : deltaChip(l)}
        </div>
        <p class="card-meta">${meta}</p>
        ${opts && opts.noCompare ? '' : `<div class="card-foot">${compareButton(l)}<span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span></div>`}
      </div>
    </article>`;
  }

  /* ---------- Search box with typeahead ---------- */

  function suggestions(raw) {
    const q = raw.trim();
    const out = [];
    if (!q) {
      for (const s of store.get().saved.slice(0, 4)) out.push({ icon: '🎯', label: s.name, sub: huntNewCount(s) ? `Hunt · ${huntNewCount(s)} new` : 'Hunt', href: '#/hunt/' + s.id });
      for (const p of quickFor().slice(0, 6)) out.push({ icon: '↗', label: p.label, sub: 'Try a plain-English search', href: p.href });
      return out;
    }
    const compact = q.toUpperCase().replace(/[\s-]/g, '');
    if (/[*?_]/.test(compact) && /^[A-Z0-9*?_.]{3,17}$/.test(compact)) {
      const n = ALL.filter((l) => !l.sold && Market.vinMatches(l.vin, compact)).length;
      out.push({ icon: '#', label: `VIN pattern ${compact}`, sub: `${plural(n, 'match')} · wildcards match any character`, href: searchHref({ vin: compact }) });
    } else if (/^[A-Z0-9]{11,17}$/.test(compact) && /\d/.test(compact)) {
      const hit = BY_VIN.get(compact) || ALL.find((l) => l.vin.endsWith(compact) || l.vin.startsWith(compact));
      if (hit) out.push({ icon: '#', label: `${title(hit)} ${hit.trim}`, sub: `VIN ${hit.vin} · ${money(hit.price)}${hit.sold ? ' · sold' : ''}`, href: `#/car/${hit.id}` });
      if (compact.length === 17) out.push({ icon: '⌁', label: `Decode VIN ${compact}`, sub: 'Check digit, model year, plant, manufacturer', href: `#/vin/${compact}` });
      else out.push({ icon: '#', label: `VINs starting ${compact}`, sub: 'Search by VIN prefix', href: searchHref({ vin: compact }) });
    }

    const zip = /^\d{5}(?:-\d{4})?$/.test(q) ? q.slice(0, 5) : null;
    const zg = zip && Geo.lookup(zip);
    if (zg) {
      out.push({ icon: '◎', label: `Cars near ${Geo.label(zg, { short: true })} ${zip}`, sub: `Within ${homeRadius()} miles of this ZIP code`, href: searchHref({ near: zip, radius: homeRadius() }) });
      out.push({ icon: '⌂', label: `Make ${zip} my market`, sub: 'Deals near you on the home page, distances on every car', href: `#/?zip=${zip}` });
    } else if (zip) out.push({ icon: '◎', label: `${zip} isn’t a US ZIP code`, sub: 'Check the number and try again', href: '#/' });

    // Plain-English: "red convertibles under 40k with leather seats"
    const parsed = NLQ.parse(q, vocab());
    if (parsed.understood.length >= 2 || (parsed.understood.length === 1 && !parsed.rest)) {
      const f = Object.assign(Market.emptyFilters(), parsed.filters, { q: parsed.rest });
      f.ex = parsed.filters.ex || {};
      const sub = isLive() ? 'Plain-English search · live listings' : `${plural(Market.search(LISTINGS, f, CTX).results.length, 'car')} match · plain-English search`;
      out.push({ icon: '✦', label: parsed.understood.join(' · ') + (parsed.rest ? ` · “${parsed.rest}”` : ''), sub, href: nlHref(parsed) });
    }

    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const yearTok = toks.find((t) => /^(19|20)\d\d$/.test(t));
    const words = toks.filter((t) => t !== yearTok);
    const hit = (s) => words.every((t) => s.toLowerCase().includes(t));
    if (words.length && !isLive()) {
      const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
      for (const key of MODEL_KEYS.filter(hit).slice(0, 4)) {
        const g = counts.get(key) || [];
        const gy = yearTok ? g.filter((l) => String(l.year) === yearTok) : g;
        if (!gy.length) continue;
        out.push({ icon: '⌕', label: yearTok ? `${yearTok} ${key}` : key, sub: `${plural(gy.length, 'car')} · median ${money(Market.median(gy.map((l) => l.price)))}`,
          href: searchHref(Object.assign({ model: key }, yearTok ? { year: yearTok } : {})) });
      }
      const makes = [...new Set(DATA.models.map((m) => m.make))].filter((mk) => hit(mk) && !out.some((o) => o.label === mk));
      for (const mk of makes.slice(0, 2)) {
        out.push({ icon: '⌕', label: `All ${mk}`, sub: plural(LISTINGS.filter((l) => l.make === mk).length, 'car'), href: searchHref({ make: mk }) });
      }
      const dealers = DATA.dealers.filter((d) => hit(`${d.name} ${d.city} ${d.state}`)).slice(0, 2);
      for (const d of dealers) {
        out.push({ icon: '⌂', label: d.name, sub: `Dealer · ${d.city}, ${d.state}`, href: searchHref({ q: d.name, state: d.state }) });
      }
      const cities = CITY_NAMES.filter((c) => hit(c)).slice(0, 2);
      for (const c of cities) out.push({ icon: '◎', label: `Cars near ${c}`, sub: 'Within 150 miles', href: searchHref({ near: c }) });
      for (const s of store.get().saved.filter((s) => hit(s.name)).slice(0, 2)) out.push({ icon: '🎯', label: s.name, sub: 'Hunt', href: '#/hunt/' + s.id });
    }
    out.push({ icon: '↵', label: `Search all listings for “${q}”`, sub: 'Matches model, trim, color, feature, dealer, city or VIN', href: searchHref({ q }) });
    return out.slice(0, 10);
  }

  // Show the longest of several placeholders that fits the box, so a narrow screen (a phone, the
  // folded iPhone Duo) gets a shorter hint instead of one cut off mid-word. Re-fits when the box resizes.
  const measureCtx = document.createElement('canvas').getContext('2d');
  function fitPlaceholder(input, options) {
    const fit = () => {
      const cs = getComputedStyle(input);
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (room <= 0) return;
      measureCtx.font = cs.font;
      input.placeholder = options.find((t) => measureCtx.measureText(t).width <= room) || options[options.length - 1];
    };
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(input);
    else addEventListener('resize', fit);
    // The web font swaps in after first paint without resizing the box; measure again once it has.
    if (document.fonts) { document.fonts.ready.then(fit); document.fonts.addEventListener?.('loadingdone', fit); }
    fit();
  }
  // Inputs drawn from templates list their shorter hints in data-placeholders ("a|b|c"), fitted as they appear.
  const fitNewPlaceholders = () => document.querySelectorAll('input[data-placeholders]:not([data-fitted])').forEach((el) => {
    el.dataset.fitted = '';
    fitPlaceholder(el, [el.placeholder, ...el.dataset.placeholders.split('|')]);
  });
  new MutationObserver(fitNewPlaceholders).observe(document.documentElement, { childList: true, subtree: true });

  let searchBoxSeq = 0;
  function mountSearchBox(container, opts) {
    const id = 'sb' + ++searchBoxSeq;
    container.innerHTML = `<form class="searchbox ${opts.size || ''}" role="search" autocomplete="off">
      <svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="${id}" type="search" placeholder="${esc(opts.placeholder || 'Try “red convertibles under 40k with leather seats”')}" aria-label="Search cars"
        role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-autocomplete="list" value="${esc(opts.value || '')}">
      ${opts.size === 'lg' ? '<kbd class="sb-kbd" aria-hidden="true">/</kbd>' : ''}
      <ul class="sb-list" id="${id}-list" role="listbox" hidden></ul>
    </form>`;
    const form = container.querySelector('form');
    const input = form.querySelector('input');
    const list = form.querySelector('ul');
    let items = [], active = -1;
    if (opts.placeholders) fitPlaceholder(input, [opts.placeholder, ...opts.placeholders]);

    function render() {
      items = suggestions(input.value);
      active = input.value.trim() ? 0 : -1;
      list.innerHTML = items.map((s, i) => `<li role="option" id="${id}-o${i}" class="${i === active ? 'active' : ''}" data-i="${i}">
        <span class="sb-i" aria-hidden="true">${esc(s.icon)}</span><span class="sb-t"><b>${esc(s.label)}</b><small>${esc(s.sub)}</small></span></li>`).join('');
      open(items.length > 0);
      setActive(active);
    }
    function open(v) {
      list.hidden = !v;
      input.setAttribute('aria-expanded', String(v));
    }
    function setActive(i) {
      active = i;
      [...list.children].forEach((li, k) => li.classList.toggle('active', k === i));
      if (i >= 0) input.setAttribute('aria-activedescendant', `${id}-o${i}`);
      else input.removeAttribute('aria-activedescendant');
    }
    function go(i) {
      const s = items[i];
      open(false);
      input.blur();
      if (s) location.hash = s.href;
      else if (input.value.trim()) location.hash = searchHref({ q: input.value.trim() });
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (e.key === 'Escape') { open(false); input.blur(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); go(active); });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (li) { e.preventDefault(); go(Number(li.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(() => open(false), 120));
    return input;
  }

  const nlQuick = (text) => nlHref(NLQ.parse(text, VOCAB));
  // The "near …" example uses your home city once one is set.
  const quickList = () => {
    const home = homeZip();
    const trucks = NLQ.parse('4x4 trucks under 50k miles', VOCAB);
    trucks.filters.near = home || 'Denver, CO';
    if (home) trucks.filters.radius = homeRadius();
    return [
      { label: 'Manual Miata under $30k', href: nlQuick('manual miata under 30k') },
      { label: 'Red convertibles under 40k with leather seats', href: nlQuick('red convertibles under 40k with leather seats') },
      { label: `4x4 trucks under 50k miles near ${home ? Geo.lookup(home).place : 'Denver'}`, href: nlHref(trucks) },
      { label: 'Used RAV4 hybrid 2021+ without sunroof', href: nlQuick('used rav4 hybrid 2021+ without sunroof') },
      { label: 'Third-row SUVs under $35k', href: nlQuick('suv with third row under 35k') },
      { label: 'Manual Civic under 60k miles', href: nlQuick('manual civic under 60k miles') },
      { label: 'Tacoma 4x4 with tow package', href: nlQuick('tacoma 4x4 with tow package') },
      { label: 'Wrangler under $35k', href: nlQuick('wrangler under 35k') },
      { label: 'AWD wagons with heated seats', href: nlQuick('awd wagons with heated seats') },
      { label: 'Black Model 3 under $30k', href: nlQuick('black model 3 under 30k') },
      { label: 'F-150 under 40k miles with CarPlay', href: nlQuick('f-150 under 40k miles with carplay') },
      { label: 'Plug-in hybrid SUVs 2022+', href: nlQuick('plug-in hybrid suv 2022+') },
      { label: 'Corvette, any year, under $60k', href: nlQuick('corvette under 60k') },
      { label: 'Minivans with 360° camera', href: nlQuick('minivan with 360 camera') },
      { label: 'Diesel trucks under 80k miles', href: nlQuick('diesel trucks under 80k miles') },
      { label: 'Blue Bronco with a manual', href: nlQuick('blue bronco manual') },
      { label: 'Outback under $25k with blind spot monitor', href: nlQuick('outback under 25k with blind spot monitor') },
      { label: 'Coupes with ventilated seats', href: nlQuick('coupes with ventilated seats') },
      { label: 'EVs with price drops', href: nlQuick('electric with price drops'), demoOnly: true },
      { label: 'Roush and RTR Mustangs', href: searchHref({ model: 'Ford Mustang', upfitter: ['Roush', 'RTR'] }), needs: 'upfitter' },
      { label: 'What sold last month', href: searchHref({ when: 'sold', sort: 'sold-recent' }), needs: 'sold' },
    ];
  };
  // Example searches the current data source can actually answer.
  const quickFor = () => quickList().filter((q) => !isLive() || (!q.demoOnly && (!q.needs || can(q.needs))));
  // A copy of the list in random order (Fisher–Yates), so the examples change on every visit.
  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /* ---------- Views ---------- */

  const app = document.getElementById('app');
  let view = { name: null };

  function setView(name, html) {
    view = { name };
    if (name !== 'home') stopPanelCycle();
    app.innerHTML = html;
    document.querySelectorAll('.main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
    document.body.dataset.view = name;
  }

  /* ----- Home: sections and the market carousel ----- */

  // The home page: one big search box, then a strip of tabs, then the one tab you picked. The first
  // three tabs are the panels of "What the market's doing": National Trends (the week's four callout
  // cards), Rare Specs and Time Capsules, a carousel the ‹ › pills turn in place. The rest are
  // sections of their own, each with its own heading. Only the selected tab is on the page.
  const HOME_CATS = [
    { id: 'insights', title: 'What the market’s doing', short: 'This Week' },
    { id: 'map', title: 'On the map', short: 'Map' },
    { id: 'local', title: 'Your market', short: 'Your Market' },
    { id: 'trends', title: 'The whole market', short: 'Whole Market' },
    { id: 'rewind', title: 'Rewind the market', short: 'Rewind' },
    { id: 'browse', title: 'Browse the market', short: 'Browse' },
  ];
  const PANELS = [
    { id: 'national', route: 'national', label: () => (isLive() && homeZip() ? 'Local Trends' : 'National Trends') },
    { id: 'rare', route: 'rare-specs', label: () => 'Rare Specs' },
    { id: 'capsules', route: 'capsules', label: () => 'Time Capsules' },
  ];
  const PANEL_MS = 9000; // how long a panel shows before the next comes around on its own
  const PANEL = { id: 'national', auto: true, hover: false, raf: 0 };

  // The sections the page can show right now: a live source skips the ones that need the demo's sales history.
  function homeCats() {
    return HOME_CATS.filter((c) => {
      if (c.id === 'local') return !!homeZip();
      if (c.id === 'trends') return !isLive() || SOURCE() === 'visor';
      if (c.id === 'rewind') return !isLive() || can('snapshots');
      return true;
    });
  }
  // The panels the carousel can show: Rare Specs and Time Capsules need colors, options and model counts,
  // which the demo market and Visor have; the free auto.dev plan has neither, so it shows the trends alone.
  function homePanels() {
    return PANELS.filter((p) => p.id === 'national' || !isLive() || SOURCE() === 'visor');
  }
  const panelById = (id) => homePanels().find((p) => p.id === id) || homePanels()[0];

  // The tab showing: a panel's id ('national', 'rare', 'capsules') shows the carousel on that panel;
  // a section's id ('map', 'local', 'trends', 'rewind', 'browse') shows that section alone.
  const TAB = { id: 'national' };
  const tabIsPanel = (id) => PANELS.some((p) => p.id === id);
  const tabRoute = (id) => (PANELS.find((p) => p.id === id) || {}).route || id;
  // The tab a request can actually show: 'insights' means the carousel on its current panel, and a
  // section or panel the data source can't fill falls back to the first panel.
  function tabFor(id) {
    if (id === 'insights') id = PANEL.id;
    if (tabIsPanel(id)) return panelById(id).id;
    return homeCats().some((c) => c.id === id && c.id !== 'insights') ? id : homePanels()[0].id;
  }

  // A section's heading row: title and eyebrow on the left, anything extra on the right.
  function catHead(cats, id, o) {
    const cat = cats.find((c) => c.id === id) || HOME_CATS.find((c) => c.id === id);
    return `<div class="insight-head cat-head">
        <div><h2>${(o && o.title) || esc(cat.title)}</h2>${o && o.eyebrow ? `<p class="eyebrow">${o.eyebrow}</p>` : ''}</div>
        ${o && o.extra ? `<div class="cat-switch">${o.extra}</div>` : ''}
      </div>`;
  }
  const catNavHtml = (cats) => `<nav class="cat-nav" aria-label="Home sections"><div class="cat-nav-inner">${
    homePanels().map((p) => `<a href="#/${p.route}" data-action="tab" data-tab="${p.id}">${esc(p.label())}</a>`).join('')
    + cats.filter((c) => c.id !== 'insights').map((c) => `<a href="#/${c.id}" data-action="tab" data-tab="${c.id}">${esc(c.short)}</a>`).join('')}</div></nav>`;

  // Highlight the tab showing in the strip (the carousel's current panel while you're on it).
  function syncCatNav() {
    const active = tabIsPanel(TAB.id) ? panelById(PANEL.id).id : TAB.id;
    document.querySelectorAll('.cat-nav a[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === active));
    document.querySelectorAll('.cat-nav-inner').forEach(keepActiveTabInView);
  }
  // Bring the highlighted tab into view (centred) when it's off the visible part of the strip.
  function keepActiveTabInView(strip) {
    const a = strip.querySelector('a.active');
    const off = a && (a.offsetLeft < strip.scrollLeft || a.offsetLeft + a.offsetWidth > strip.scrollLeft + strip.clientWidth);
    if (off) strip.scrollTo({ left: a.offsetLeft - (strip.clientWidth - a.offsetWidth) / 2 });
    catNavEdges(strip);
  }
  // Mark which ends of the strip have tabs scrolled past them, for the edge fades in the CSS.
  function catNavEdges(strip) {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.classList.toggle('more-l', strip.scrollLeft > 2);
    strip.classList.toggle('more-r', strip.scrollLeft < max - 2);
  }
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('cat-nav-inner')) catNavEdges(e.target); }, true);
  // Folding or rotating narrows the strip: keep the open tab visible, not just the fades current.
  addEventListener('resize', () => document.querySelectorAll('.cat-nav-inner').forEach(keepActiveTabInView));

  /* ----- The carousel: a heading with ‹ previous and next › pills, and the panel under it ----- */

  // The heading row. The pills name the panels either side of this one in the ring; while the next
  // panel is due to come around on its own, its pill wears a ring that fills up.
  function marketHeadHtml() {
    const panels = homePanels();
    const n = panels.length, i = panels.indexOf(panelById(PANEL.id));
    const pill = (p, dir) => `<a class="cat-pill${dir > 0 ? ' next' : ''}" href="#/${p.route}" data-action="panel" data-panel="${p.id}" aria-label="${dir < 0 ? 'Previous' : 'Next'}: ${esc(p.label())}">${dir < 0 ? '<span aria-hidden="true">‹</span> ' : ''}${esc(p.label())}${dir > 0 ? ' <span aria-hidden="true">›</span>' : ''}</a>`;
    const pills = (n > 2 ? pill(panels[(i + n - 1) % n], -1) : '') + (n > 1 ? pill(panels[(i + 1) % n], 1) : '');
    const eyebrow = isLive()
      ? `Live · ${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(homeZip() ? placeLabel(homeZip()) : 'nationwide')}`
      : `Week of ${esc(weekOf)}`;
    const extra = !isLive() ? '' : homeZip() ? radiusSegHtml() : '<p class="muted small">Type a ZIP code above to see the market near you.</p>';
    return `<div class="insight-head cat-head">
        <div><h2>What the market’s doing</h2><p class="eyebrow">${eyebrow}</p></div>
        <div class="cat-switch">${extra}${pills}</div>
      </div>`;
  }

  function marketPanelHtml() {
    const id = panelById(PANEL.id).id;
    if (id === 'rare') return isLive() ? `<div class="insight-grid spec-grid" id="live-rare">${loadingHtml(`Looking for rare specs ${scopeShort()}…`)}</div>` : rarePanelHtml();
    if (id === 'capsules') return isLive() ? `<div class="insight-grid spec-grid" id="live-capsules">${loadingHtml(`Looking for time capsules ${scopeShort()}…`)}</div>` : capsulePanelHtml();
    return isLive() ? `<div class="insight-grid" id="live-insights">${loadingHtml(`Loading the live market ${scopeShort()}…`)}</div>` : weeklyGridHtml();
  }

  // Show a panel in place, without touching the rest of the page.
  function showPanel(id) {
    PANEL.id = panelById(id).id;
    if (tabIsPanel(TAB.id)) TAB.id = PANEL.id;
    const head = document.getElementById('market-head'), body = document.getElementById('market-panel');
    if (!head || !body) return;
    head.innerHTML = marketHeadHtml();
    body.innerHTML = marketPanelHtml();
    fillPanelLive();
    fillTrimMapIfShown();
    syncCatNav();
    startPanelCycle();
  }
  // Live data fills whichever panel is showing (and the browse grid); repeats within 30 minutes are free.
  function fillPanelLive() {
    if (!isLive()) return;
    fillLiveInsights();
    if (document.getElementById('live-capsules')) fillLiveCapsules();
    if (document.getElementById('live-rare')) fillLiveRare();
  }

  // The next panel comes around on its own every PANEL_MS, a ring filling on its pill, until you pick
  // a panel yourself. The clock waits while the pointer or focus is on the section or the tab is
  // hidden, and never runs for people who asked for reduced motion.
  function startPanelCycle() {
    stopPanelCycle();
    if (!PANEL.auto || !document.getElementById('market-panel') || homePanels().length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let elapsed = 0, last = performance.now();
    const tick = (now) => {
      if (view.name !== 'home') return;
      if (!document.hidden && !PANEL.hover) elapsed += now - last;
      last = now;
      const pill = document.querySelector('#market-head .cat-pill.next');
      if (pill) { pill.classList.add('auto'); pill.style.setProperty('--ring', `${Math.min(100, (elapsed / PANEL_MS) * 100).toFixed(1)}%`); }
      // A panel still computing its cards stays until they're in.
      if (elapsed >= PANEL_MS && !document.querySelector('#market-panel .loading-card')) {
        const panels = homePanels();
        showPanel(panels[(panels.indexOf(panelById(PANEL.id)) + 1) % panels.length].id);
        return;
      }
      PANEL.raf = requestAnimationFrame(tick);
    };
    PANEL.raf = requestAnimationFrame(tick);
  }
  function stopPanelCycle() {
    if (PANEL.raf) cancelAnimationFrame(PANEL.raf);
    PANEL.raf = 0;
  }

  const signedPct = (v, digits) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(Math.abs(v), digits)}`;
  const soldLabel = (l) => (l.sold.daysAgo === 0 ? 'sold today' : `sold ${l.sold.daysAgo} days ago`);

  /* ----- What the market's doing: this week's four cards ----- */

  const RET_YEARS = 3; // residual value is followed over this many years
  let TRIM_MAP = null; // the state-scoped trim card's map, to redraw county by county once the counties load
  const fillTrimMapIfShown = () => { if (TRIM_MAP && document.getElementById('trim-map')) fillTrimMap(TRIM_MAP.st, TRIM_MAP.key, TRIM_MAP.paceClass); };
  const milesText = (n) => (n < 1000 ? `${num(n)} miles` : `${Math.round(n / 1000)}k miles`);

  // One track per model: the value lost in each year is a segment from the left (year 1 darkest), so
  // the empty remainder is what the car still asks, printed at the right end.
  function retTrack(r) {
    let floor = 1;
    const segs = r.byAge.map((v, k) => {
      const next = Math.min(floor, Math.max(0, v));
      const seg = `<i class="ret-${k + 1}" style="left:${((1 - floor) * 100).toFixed(2)}%;width:${((floor - next) * 100).toFixed(2)}%"><span class="sr-only">Year ${k + 1}: ${Math.round(v * 100)}%</span></i>`;
      floor = next;
      return seg;
    }).join('');
    return `<div class="ret-track" role="img" aria-label="${esc(r.make)} ${esc(r.model)}: ${r.byAge.map((v, k) => `year ${k + 1} ${Math.round(v * 100)}%`).join(', ')} of MSRP">
            <span class="ret-fill">${segs}</span>
            <b>${Math.round(r.byAge[r.byAge.length - 1] * 100)}%</b>
          </div>`;
  }

  // One state with its cities as dots, sized by sales and colored by pace.
  function stateDotMap(st, key, paceClass) {
    const where = stateName(st.state);
    return Charts.geoMap((s) => (s === st.state ? { cls: 'geo-state', title: `${where}: ${plural(st.n, 'sale')}, median ${plural(Math.round(st.days), 'day')} to sell` } : null), {
      focus: st.state, aria: `${where}, with each city's ${key} sales colored by how fast they sold`,
      dots: st.cities.map((c) => ({ city: c.city, lat: c.lat, lng: c.lng, count: c.n, cls: paceClass(c.days / st.days - 1), title: `${c.city}: ${plural(c.n, 'sale')}, median ${plural(Math.round(c.days), 'day')} to sell` })),
    });
  }
  // The same state county by county, like Visor's: each county with sales colored by its pace against
  // the state's. Null until js/uscounties.js has loaded.
  function stateCountyMap(st, key, paceClass) {
    if (!Charts.countiesLoaded(st.state)) return null;
    const by = new Map();
    for (const c of st.cities) {
      const county = Charts.countyAt(st.state, c.lat, c.lng);
      if (!county) continue;
      const v = by.get(county.id) || { n: 0, sum: 0 };
      v.n += c.n; v.sum += c.days * c.n;
      by.set(county.id, v);
    }
    const where = stateName(st.state);
    return Charts.countyMap(st.state, (c) => {
      const v = by.get(c.id);
      if (!v) return null;
      const days = v.sum / v.n;
      return { cls: paceClass(days / st.days - 1), title: `${c.name} County: ${plural(v.n, 'sale')}, ${plural(Math.round(days), 'day')} to sell`, href: searchHref({ model: key, state: st.state, when: 'sold', sort: 'sold-fastest' }) };
    }, { aria: `${where} county by county, colored by how fast ${key}s sold there` });
  }
  // Loads the county outlines once (a separate script, since the file is large and only this card needs it).
  let countiesLoading = null;
  function loadCounties() {
    if (!countiesLoading) countiesLoading = new Promise((resolve) => {
      if (typeof USCounties !== 'undefined') return resolve(true);
      const app = document.querySelector('script[src*="js/app.js"]');
      const v = app && /\?v=([^&"]+)/.exec(app.getAttribute('src'));
      const el = document.createElement('script');
      el.src = `js/uscounties.js${v ? `?v=${v[1]}` : ''}`;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    return countiesLoading;
  }
  // Once the counties are in, redraw the trim card's map county by county (if the card is still up).
  function fillTrimMap(st, key, paceClass) {
    loadCounties().then((ok) => {
      const box = document.getElementById('trim-map');
      if (!ok || !box || !box.isConnected) return;
      const map = stateCountyMap(st, key, paceClass);
      if (map) box.innerHTML = map;
    });
  }

  // The week's four cards. Each builder takes the numbers it draws, so the demo (computed from every
  // listing) and a live source (computed from facet requests around your market) share one look.
  // o.scope adds the market to every link, o.where names it ("nationwide" or "near Kissimmee, FL").
  const paceClass = (r) => (r <= -0.2 ? 'd-great' : r <= -0.08 ? 'd-good' : r < 0.08 ? 'd-fair' : r < 0.2 ? 'd-high' : 'd-over');

  // Residual value: ret is [{ make, model, byAge, msrp, avgList, avgMiles }], best keeper first.
  function retentionCardHtml(ret, o) {
    if (!ret.length) return '';
    const years = Array.from({ length: RET_YEARS }, (_, k) => CURRENT_YEAR - RET_YEARS + k);
    const shop = searchHref(Object.assign(o.models ? { model: ret.map((r) => `${r.make} ${r.model}`) } : { q: 'Compact SUV' }, { condition: ['Used', 'Certified'], year: years }, o.scope || {}));
    return `<article class="card insight">
      <header><h3>${esc(ret[0].make)} ${esc(ret[0].model)} leads compact SUVs in residual value over ${RET_YEARS} years</h3>
      <p class="muted">${years[0]} to ${years[years.length - 1]} <span class="sep">|</span> Under 75k miles${o.where ? ` <span class="sep">|</span> ${esc(o.where)}` : ''}</p></header>
      <div class="ret-bars">
        ${ret.map((r) => `<div class="ret-row">
          <div class="ret-label"><b>${esc(r.make)} ${esc(r.model)}</b><small>MSRP ${money(r.msrp)} <span class="sep">|</span> Avg list ${money(r.avgList)} <span class="sep">|</span> ${milesText(r.avgMiles)}</small></div>
          ${retTrack(r)}
        </div>`).join('')}
      </div>
      <div class="legend boxed">${years.map((_, k) => `<span><i class="key ret-${k + 1}"></i>Year ${k + 1}</span>`).join('')}</div>
      <a class="card-cta" href="${shop}">Shop ${years[0]}–${years[years.length - 1]} compact SUVs${o.near ? ` ${esc(o.near)}` : ''} →</a>
      ${openCorner(shop, 'Shop these compact SUVs')}
    </article>`;
  }

  // Which trim sells faster: t is { make, model, condition, sc: { n, fast, slow, gap }, where, aside,
  // map, mapId, scope }; sc is the market the headline is about (a state, your market or the country).
  function trimCardHtml(t) {
    const { sc } = t;
    const key = `${t.make} ${t.model}`;
    // A strip of pills across the model's range of days to sell, with each trim's pace marked: green up
    // to the fastest trim, yellow to orange between the two, red past the slowest.
    const N = 25, max = sc.slow.days * 1.12;
    const slot = (d) => Math.max(0, Math.min(N - 1, Math.round((d / max) * (N - 1))));
    const sf = slot(sc.fast.days), ss = Math.max(slot(sc.slow.days), sf + 1);
    const marks = new Map([[sf, { t: sc.fast, cls: 'mark-fast' }], [ss, { t: sc.slow, cls: 'mark-slow' }]]);
    const dots = Array.from({ length: N }, (_, k) => {
      const m = marks.get(k);
      if (m) return `<i class="${m.cls}" title="${esc(m.t.trim)}: ${plural(Math.round(m.t.days), 'day')}"></i>`;
      const f = (k - sf) / (ss - sf);
      return `<i class="${k < sf ? 'p1' : k > ss ? (k - ss <= 2 ? 'p5' : 'p6') : f < 0.34 ? 'p2' : f < 0.67 ? 'p3' : 'p4'}"></i>`;
    }).join('');
    const row = (x, cls) => `<div class="trim-row"><i class="key ${cls}"></i><span class="trim-name"><b>${esc(x.trim)}</b> <small>(${num(x.n)} sold)</small></span><b class="trim-days">${plural(Math.round(x.days), 'day')}</b></div>`;
    const all = searchHref(Object.assign({ model: key, when: 'sold', sort: 'sold-fastest' }, t.scope || {}));
    return `<article class="card insight">
      <header><h3>${badge(t.condition, t.condition === 'New' ? 'b-new' : 'b-used')} ${esc(key)} ${esc(/s$/i.test(sc.fast.trim) ? `${sc.fast.trim} models` : `${sc.fast.trim}s`)} sell ${Math.round(sc.gap)} days faster than ${esc(sc.slow.trim)} models ${esc(t.where)}</h3>
      <p class="muted">Median days from listing to sale over the last 120 days <span class="sep">|</span> ${plural(sc.n, 'sale')} ${esc(t.where)}</p></header>
      <div class="trim-layout">
        <div class="trim-vs">
          <p class="muted">Avg days to sell</p>
          <div class="days-dots" aria-hidden="true">${dots}</div>
          ${row(sc.fast, 'mark-fast')}
          ${row(sc.slow, 'mark-slow')}
          ${t.aside ? `<p class="muted small">${t.aside}</p>` : ''}
        </div>
        <div class="map-paper${t.mapId ? ' state-map' : ''}"${t.mapId ? ` id="${t.mapId}"` : ''}>${t.map}</div>
      </div>
      <div class="legend diverging"><span><i class="key d-great"></i>Sells faster than typical</span><span><i class="key d-fair"></i>Typical</span><span><i class="key d-over"></i>Slower</span></div>
      <a class="card-cta" href="${all}">Every ${esc(t.model)} sold ${esc(t.where)}, fastest first →</a>
      ${openCorner(all, `Every ${t.model} sold, fastest first`)}
    </article>`;
  }

  // A make whose sales climbed (or fell): mv is { make, now, before, change, models, byState }.
  function momentumCardHtml(mv, o) {
    const rose = mv.change >= 0;
    const lead = mv.models.filter((m) => m.change != null && m.now >= 5).sort((a, b) => (rose ? b.change - a.change : a.change - b.change))[0];
    const chgClass = (d) => (d == null ? 'up-2' : d >= 0.25 ? 'up-3' : d >= 0.1 ? 'up-2' : d > 0.02 ? 'up-1' : d > -0.02 ? 'flat' : d > -0.1 ? 'down-1' : d > -0.25 ? 'down-2' : 'down-3');
    const sales = `${plural(mv.now, 'sale')} in 30 days vs. ${num(mv.before)} the month before${o.where ? ` ${esc(o.where)}` : ''}`;
    const scope = o.scope || {};
    const all = searchHref(Object.assign({ make: mv.make, when: 'sold', sort: 'sold-recent' }, scope));
    return `<article class="card insight">
      <header><h3>${badge(o.condition || 'Used', 'b-used')} ${esc(mv.make)} sales${o.near ? ` ${esc(o.near)}` : ''} ${Math.abs(mv.change) < 0.005 ? 'held steady' : `${rose ? 'rose' : 'fell'} ${pct(Math.abs(mv.change))}`} in the last month</h3>
      <p class="muted">${lead ? `The ${esc(lead.model)} leads the ${rose ? 'climb' : 'slide'}, ${lead.change >= 0 ? 'up' : 'down'} ${pct(Math.abs(lead.change))} in a month` : sales}</p></header>
      <div class="split-map">
        <div class="momentum">
          <ul class="momentum-list">${mv.models.slice(0, 5).map((m) => `<li><a href="${searchHref(Object.assign({ model: `${mv.make} ${m.model}`, when: 'sold', sort: 'sold-recent' }, scope))}"><span>${esc(m.model)}</span><b>${num(m.now)}</b><i class="chg ${m.change == null || m.change >= 0 ? 'up' : 'down'}">${m.change == null ? 'new' : signedPct(m.change, 1)}</i></a></li>`).join('')}</ul>
          ${lead ? `<p class="muted small">${sales}</p>` : ''}
        </div>
        <div class="map-paper">${Charts.geoMap((st) => {
          const d = mv.byState[st];
          if (!d || d.now + d.before < 4) return null;
          return { cls: chgClass(d.change), title: `${st}: ${plural(d.now, 'sale')} this month vs. ${num(d.before)} before${d.change != null ? ` (${signedPct(d.change)})` : ''}`, href: searchHref({ make: mv.make, state: st, when: 'sold', sort: 'sold-recent' }) };
        }, { aria: `States shaded by the change in ${mv.make} sales` })}${o.mapNote ? `<p class="muted small map-note">${esc(o.mapNote)}</p>` : ''}</div>
      </div>
      <div class="legend diverging"><span><i class="key down-2"></i>Fewer sales</span><span><i class="key flat"></i>About the same</span><span><i class="key up-2"></i>More sales</span></div>
      <a class="card-cta" href="${all}">Every ${esc(mv.make)} sold this month${o.near ? ` ${esc(o.near)}` : ''} →</a>
      ${openCorner(all, `Every ${mv.make} sold this month`)}
    </article>`;
  }

  const ARRIVAL_ICON = {
    lot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>',
    transit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17h18l-2 4H5z"/><path d="M5 17V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8"/><path d="M12 6V3M9 3h6"/></svg>',
    production: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="9" width="20" height="7" rx="2"/><path d="M6 16v2M18 16v2M6 9l1.5-4h9L18 9M6 12.5h2M16 12.5h2"/></svg>',
  };
  // New-model arrivals: arr is { year, make, model, total, byStatus, recent }.
  function arrivalsCardHtml(arr, o) {
    const ICON = ARRIVAL_ICON;
    const statusChip = (st) => (st ? `<span class="chip status">${st === 'In transit' ? ICON.transit : st === 'In production' ? ICON.production : ICON.lot}${esc(st)}</span>` : '');
    const all = searchHref(Object.assign({ model: arr.make + ' ' + arr.model, year: arr.year, condition: 'New', sort: 'newest' }, o.scope || {}));
    return `<article class="card insight">
      <header><h3>${badge('New', 'b-new')} ${arr.year} ${esc(arr.make)} ${esc(arr.model)}s are arriving${o.near ? ` ${esc(o.near)}` : ''}</h3></header>
      <div class="arrivals">
        <dl class="stat-stack">
          <div class="stat-head">${num(arr.total)} for sale ${esc(o.where || 'nationwide')}</div>
          <div><dt>${ICON.lot} On lot</dt><dd>${num(arr.byStatus['On lot'])}</dd></div>
          <div><dt>${ICON.production} Production</dt><dd>${num(arr.byStatus['In production'])}</dd></div>
          <div><dt>${ICON.transit} Transit</dt><dd>${num(arr.byStatus['In transit'])}</dd></div>
        </dl>
        <div class="mini-list">
          <div class="mini-list-head"><span class="pulse-dots" aria-hidden="true"><i></i><i></i><i></i></span> Recent arrivals</div>
          <ul>${arr.recent.slice(0, 4).map((l) => `<li><a href="#/car/${esc(l.id)}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${badge('New', 'b-new')} <span class="sep">|</span> ${kMiles(l.miles)} <span class="sep">|</span> ${esc(l.city)}, ${esc(l.state)}</small></span><span class="r"><b>${money(l.price)}</b><small>${statusChip(l.status)}</small></span></a></li>`).join('')}</ul>
        </div>
      </div>
      <a class="card-cta" href="${all}">See all ${arr.year} ${esc(arr.model)}s${o.near ? ` ${esc(o.near)}` : ''} →</a>
      ${openCorner(all, `See all ${arr.year} ${arr.model}s`)}
    </article>`;
  }

  function weeklyGridHtml() {
    const arr = Market.arrivals(LISTINGS, CURRENT_YEAR);
    const ret = Market.retention(LISTINGS, 'Compact SUV', CURRENT_YEAR, RET_YEARS).slice(0, 3);
    const momentum = Market.makeMomentum(SOLD, 30, 20);
    const mv = momentum.find((m) => m.models.length >= 3 && m.now >= 50) || momentum[0];
    const tv = Market.trimVelocity(SOLD, 20)[0];

    let trimCard = '';
    TRIM_MAP = null;
    if (tv) {
      const key = `${tv.make} ${tv.model}`;
      // Like Visor's "in Texas": the state where the same two trims are furthest apart, when each sold
      // there at least five times; else the whole country.
      const st = tv.states[0] || null;
      const others = tv.trims.slice(1, -1);
      // The map: with a state, that state county by county, each colored by how fast the model sold
      // there (the counties load on first use; until then, and without them, the state's outline
      // with its cities as dots); else every state shaded by how fast the model sells there.
      TRIM_MAP = st ? { st, key, paceClass } : null;
      trimCard = trimCardHtml({
        make: tv.make, model: tv.model, condition: tv.condition, sc: st || tv,
        where: st ? `in ${stateName(st.state)}` : 'nationwide',
        aside: st
          ? `Nationwide: ${esc(tv.fast.trim)} ${Math.round(tv.fast.days)}d · ${esc(tv.slow.trim)} ${Math.round(tv.slow.days)}d`
          : others.map((t) => `${esc(t.trim)} ${Math.round(t.days)}d`).join(' · '),
        map: st ? (stateCountyMap(st, key, paceClass) || stateDotMap(st, key, paceClass)) : nationalPaceMap(tv.byState, tv.days, key),
        mapId: st ? 'trim-map' : null,
        scope: st ? { state: st.state } : {},
      });
    }

    return `<div class="insight-grid">${retentionCardHtml(ret, {})}${trimCard}${mv ? momentumCardHtml(mv, {}) : ''}${arrivalsCardHtml(arr, {})}</div>`;
  }

  // Every state shaded by how fast a model sells there against its pace nationwide.
  function nationalPaceMap(byState, days, key) {
    return Charts.geoMap((s) => {
      const d = byState[s];
      if (!d || d.n < 5 || d.days == null) return null;
      return { cls: paceClass(d.days / days - 1), title: `${s}: ${plural(d.n, 'sale')}, median ${plural(Math.round(d.days), 'day')} to sell`, href: searchHref({ model: key, state: s, when: 'sold', sort: 'sold-fastest' }) };
    }, { aria: `States shaded by how fast ${key}s sell` });
  }

  /* ----- National trends: the whole market, computed from every listing ----- */

  // The whole market's six cards. Each builder takes the numbers it draws, so the demo (every listing)
  // and Visor (facets, snapshots and samples of listings) share one look; o.where names the market.

  // The biggest 30-day price move: mv is { year, make, model, count, change, now, then, fNow, fThen, mid }.
  function moverCardHtml(mv, o) {
    const down = mv.change < 0;
    return `<article class="card insight">
      <header><h3>${badge('Used', 'b-used')} ${mv.year} ${esc(mv.make)} ${esc(mv.model)} prices ${down ? 'down' : 'up'} ${money(Math.abs(mv.change))} in 30 days</h3>
      <p class="muted">At ${kMiles(mv.mid)} (the median) · ${plural(mv.count, 'listing')} ${esc(o.where || 'nationwide')}</p></header>
      ${Charts.scatter({
        series: [
          { points: mv.then.map(([x, y]) => ({ x, y })), cls: 'then', fit: mv.fThen },
          { points: mv.now.map(([x, y]) => ({ x, y })), cls: 'now', fit: mv.fNow },
        ],
        annotations: [{ x: mv.mid, label: `${money(Math.abs(mv.change))} ${down ? 'less' : 'more'}` }],
        xLabel: 'Miles', aria: `Price versus mileage, 30 days ago and today, for ${mv.year} ${mv.make} ${mv.model}`,
      })}
      <div class="legend"><span><i class="key then"></i>Prices 30 days ago</span><span><i class="key now"></i>Prices today</span></div>
      <a class="card-cta" href="${searchHref({ model: mv.make + ' ' + mv.model, year: mv.year, condition: ['Used', 'Certified'] })}">Browse these ${esc(mv.model)}s →</a>
    </article>`;
  }

  // Price cuts: drops is [{ l, c }], biggest first; o.title and o.sub override the heading for a sample.
  function dropsCardHtml(drops, o) {
    return `<article class="card insight">
      <header><h3>${badge('Price cuts', 'b-drop')} ${o.title || `${num(drops.length)} cars got cheaper this week`}</h3>
      <p class="muted">${o.sub || 'Biggest reductions in the last 7 days'}</p></header>
      ${drops.length ? `<ul class="rank-list">${drops.slice(0, 5).map(({ l, c }) => `<li><a href="#/car/${esc(l.id)}">
        <span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
        <span class="r"><b>${money(c.to)}</b><small class="drop">↓ ${money(-c.delta)} from ${money(c.from)}</small></span></a></li>`).join('')}</ul>` : '<p class="muted">No price cuts in the last 7 days among these listings.</p>'}
      <a class="card-cta" href="${searchHref({ dropsOnly: 1, sort: 'newest' })}">All cars with price cuts →</a>
    </article>`;
  }

  // Where used cars price below market: states is { ST: { n, delta } }; o.min is the fewest cars a state needs.
  function stateMapCardHtml(states, o) {
    return `<article class="card insight">
      <header><h3>Where used cars are priced below market</h3>
      <p class="muted">${o.sub || 'Median price vs. expected value for the same car, by state. Tap a state to shop it.'}</p></header>
      ${Charts.geoMap((st) => {
        const d = states[st];
        if (!d || d.n < (o.min || 8) || d.delta == null) return null;
        return { cls: deltaClass(d.delta), title: `${st}: ${plural(d.n, 'used car')}, ${pct(Math.abs(d.delta), 1)} ${d.delta < 0 ? 'below' : 'above'} ${o.against || 'market'}` };
      }, { clickable: true, labels: true, aria: 'States shaded by how far used prices sit from market value' })}
      <div class="legend diverging"><span><i class="key d-great"></i>Below market</span><span><i class="key d-fair"></i>At market</span><span><i class="key d-over"></i>Above market</span></div>
    </article>`;
  }

  // Priced lowest for what they are: values is listings with an expected value, lowest against it first.
  function valueCardHtml(values, o) {
    return `<article class="card insight">
      <header><h3>Priced lowest for what they are</h3>
      <p class="muted">${o.sub || 'Recent model years under 80k miles, ranked by distance below expected value — not a “deal badge”, just the math.'}</p></header>
      ${values.length ? `<ul class="rank-list">${values.map((l) => {
        const m = marketText(l);
        return `<li><a href="#/car/${esc(l.id)}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
        <span class="r"><b>${money(l.price)}</b><small class="good">${money(-m.diff)} below (${pct(-m.d)})</small></span></a></li>`;
      }).join('')}</ul>` : '<p class="muted">Nothing priced clearly below its expected value right now.</p>'}
      <a class="card-cta" href="${searchHref({ belowMarket: 1, condition: ['Used', 'Certified'] })}">Everything below market →</a>
    </article>`;
  }

  // Selling fastest: fast is [{ k, n, med, supply, saleToList }], fastest first.
  function fastCardHtml(fast, o) {
    if (!fast.length) return '';
    return `<article class="card insight">
      <header><h3>${badge('Sold', 'b-sold')} ${esc(fast[0].k)}s are selling fastest</h3>
      <p class="muted">Median days from listing to sale, last 45 days · days of supply at the current sales pace${o.where ? ` · ${esc(o.where)}` : ''}</p></header>
      <ul class="rank-list">${fast.map(({ k, n, med, supply, saleToList }) => `<li><a href="${searchHref({ model: k, when: 'sold', sort: 'sold-fastest' })}">
        <span><b>${esc(k)}</b><small>${plural(n, 'sale')} · ${supply ? Math.round(supply) + ' days of supply' : '—'}</small></span>
        <span class="r"><b>${Math.round(med)} days</b><small>${saleToList ? pct(saleToList) + ' of first list price' : ''}</small></span></a></li>`).join('')}</ul>
      <a class="card-cta" href="${searchHref({ when: 'sold', sort: 'sold-recent' })}">Browse recently sold cars →</a>
    </article>`;
  }

  // Inventory over time: inv is { series: [{ daysAgo, count, median }], sold30 }, oldest first.
  function inventoryCardHtml(inv, o) {
    const first = inv.series[0].count, last = inv.series[inv.series.length - 1].count;
    return `<article class="card insight">
      <header><h3>Inventory is ${last >= first ? 'up' : 'down'} ${pct(Math.abs(last / Math.max(1, first) - 1))} over 90 days</h3>
      <p class="muted">Cars for sale nationwide ${o.daily === false ? 'every two weeks' : 'each day'}, with the median asking price · ${num(inv.sold30)} sold in the last 30 days</p></header>
      ${Charts.trend(inv.series, { aria: 'Cars for sale nationwide over the last 90 days' })}
      <div class="legend"><span><i class="key inv"></i>For sale</span><span><i class="key med"></i>Median price</span></div>
      <a class="card-cta" href="#/rewind" data-action="jump" data-target="rewind">Rewind the market to an earlier day →</a>
    </article>`;
  }

  function trendsHtml(cats) {
    if (isLive()) {
      return catHead(cats, 'trends', { eyebrow: `Every car for sale nationwide, live: inventory over 90 days, where prices sit, what moved, what sold and what got cut` }) +
        `<div class="insight-grid" id="live-trends">${['inv', 'map', 'mover', 'fast', 'drops', 'value'].map((k) => `<div class="weekly-slot" data-slot="${k}">${loadingHtml('Computing the whole market…')}</div>`).join('')}</div>`;
    }
    const mv = Market.priceMovers(LISTINGS, 20)[0];
    const drops = Market.recentDrops(LISTINGS, 7);
    const states = Market.stateDeltas(LISTINGS, delta);
    const values = LISTINGS.filter((l) => l.condition !== 'New' && l.miles < 80000 && l.year >= CURRENT_YEAR - 6)
      .sort((a, b) => delta(a) - delta(b)).slice(0, 5);

    // Velocity: which models are selling fastest right now.
    const soldBy = Market.groupBy(SOLD.filter((l) => l.sold.daysAgo < 45), (l) => `${l.make} ${l.model}`);
    const activeBy = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const fast = [...soldBy.entries()].filter(([, g]) => g.length >= 12)
      .map(([k, g]) => {
        const v = Market.velocity(activeBy.get(k) || [], SOLD.filter((l) => `${l.make} ${l.model}` === k));
        return { k, n: g.length, med: Market.median(g.map((l) => l.sold.daysToSell)), supply: v.daysOfSupply, saleToList: v.saleToList };
      })
      .sort((a, b) => a.med - b.med).slice(0, 5);

    const inv = Market.inventorySeries(LISTINGS, SOLD, Market.emptyFilters(), CTX, 90);
    const states_n = new Set(LISTINGS.map((l) => l.state)).size;
    return catHead(cats, 'trends', { eyebrow: `Every one of the ${num(LISTINGS.length)} cars for sale across ${states_n} states, and the ${num(SOLD.length)} that sold in the last 120 days` }) +
      `<div class="insight-grid">${inventoryCardHtml(inv, {})}${stateMapCardHtml(states, {})}${mv ? moverCardHtml(mv, {}) : ''}${fastCardHtml(fast, {})}${dropsCardHtml(drops, {})}${valueCardHtml(values, {})}</div>`;
  }

  // Visor: the whole market's six cards, each drawn as soon as its requests are in. They start once the
  // section is on (or near) the screen.
  function fillLiveTrends() {
    const grid = document.getElementById('live-trends');
    if (!grid || grid.dataset.started) return;
    const start = () => {
      if (grid.dataset.started || !grid.isConnected) return;
      grid.dataset.started = '1';
      const ctx = liveCtx();
      const fill = (k, make) => make().then((html) => {
        const slot = grid.querySelector(`[data-slot="${k}"]`);
        if (!slot || !slot.isConnected) return;
        if (html) slot.outerHTML = html; else slot.remove();
      }).catch((e) => {
        const slot = grid.querySelector(`[data-slot="${k}"]`);
        if (slot && slot.isConnected) slot.outerHTML = `<article class="card insight">${liveErrorHtml(e)}</article>`;
      });
      fill('inv', () => Live.inventoryTrend(Market.emptyFilters(), ctx, LATER).then((inv) => inventoryCardHtml(inv, { daily: false })));
      fill('map', liveStateMapCard);
      fill('mover', liveMoverCard);
      fill('fast', liveFastCard);
      fill('drops', liveDropsCard);
      fill('value', () => liveValueCard(ctx));
    };
    if (typeof IntersectionObserver === 'undefined') return start();
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      start();
    }, { rootMargin: '600px 0px' });
    io.observe(grid);
  }

  const USED_YEARS = () => Array.from({ length: 7 }, (_, k) => CURRENT_YEAR - k).join(','); // up to six years old

  // Where used cars price below market: used cars up to six years old, asking price as a share of MSRP
  // in each state against the country's (one facets request). It compares like with like better than
  // a plain median price, which follows each state's mix of cars.
  async function liveStateMapCard() {
    const r = await vfacet({ inventory_type: 'used,certified', year: USED_YEARS() }, 'state', { metrics: 'discount_from_msrp.mean' }, LATER);
    const rows = facetRows(r, 'state').filter((b) => metricOf(b, 'discount_from_msrp.mean') != null);
    if (!rows.length) return '';
    const share = (b) => 1 + metricOf(b, 'discount_from_msrp.mean');
    const n = rows.reduce((t, b) => t + b.count, 0);
    const nat = rows.reduce((t, b) => t + share(b) * b.count, 0) / n;
    const states = {};
    for (const b of rows) states[String(b.value).toUpperCase()] = { n: b.count, delta: share(b) / nat - 1 };
    return stateMapCardHtml(states, { min: 30, against: 'the national share of MSRP', sub: `Used cars up to six years old: what they ask as a share of their MSRP in each state, against the country’s ${pct(nat)}. Tap a state to shop it.` });
  }

  // The biggest 30-day price move: the most-listed used models of one model year, their median asking
  // price today and on the day 30 days ago (two requests), then for the biggest move every listing of it
  // on both days as price against miles (two).
  async function liveMoverCard() {
    const year = CURRENT_YEAR - 3;
    const base = { inventory_type: 'used,certified', year: String(year) };
    const snap = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [now, then] = await Promise.all([
      vfacet(base, 'model', { facet_value_limit: 25, metrics: 'price.median' }, LATER),
      vfacet(Object.assign({}, base, { snapshot_date: snap }), 'model', { facet_value_limit: 40, metrics: 'price.median' }, LATER),
    ]);
    const before = new Map(facetRows(then, 'model').map((b) => [String(b.value), b]));
    const moved = (min) => facetRows(now, 'model').filter((b) => b.count >= min && before.has(String(b.value)) && metricOf(b, 'price.median') && metricOf(before.get(String(b.value)), 'price.median'))
      .map((b) => ({ model: String(b.value), count: b.count, d: Math.abs(metricOf(b, 'price.median') / metricOf(before.get(String(b.value)), 'price.median') - 1) }))
      .sort((x, y) => y.d - x.d)[0];
    // Models with 40+ listings that year, or with fewer listings, 15+.
    const pick = moved(40) || moved(15);
    if (!pick) return '';
    const mp = Object.assign({}, base, { model: pick.model, limit: 100 });
    const [a, b] = await Promise.all([Live.request('/v1/listings', mp, null, LATER), Live.request('/v1/listings', Object.assign({}, mp, { snapshot_date: snap }), null, LATER)]);
    const pts = (r) => (r.data || []).map(Live.normalize).filter((l) => l.price > 0 && l.miles > 0).map((l) => [l.miles, l.price]);
    const nowPts = pts(a), thenPts = pts(b);
    const fNow = Market.linearFit(nowPts), fThen = Market.linearFit(thenPts);
    if (!fNow || !fThen || thenPts.length < 8) return '';
    const make = ((a.data || [])[0] && Live.normalize(a.data[0]).make) || '';
    const mid = Market.median(nowPts.map(([x]) => x));
    return moverCardHtml({ year, make, model: pick.model, count: pick.count, change: fNow.at(mid) - fThen.at(mid), now: nowPts, then: thenPts, fNow, fThen, mid }, {});
  }

  // Selling fastest: models sold in the last 45 days by median days to sell (one request) and how many
  // of each are for sale now (one), for days of supply.
  async function liveFastCard() {
    const [sold, active] = await Promise.all([
      vfacet(soldParams({}, 45), 'model', { facet_value_limit: 60, metrics: 'days_on_market.median' }, LATER),
      vfacet({}, 'model', { facet_value_limit: 100 }, LATER),
    ]);
    const forSale = new Map(facetRows(active, 'model').map((b) => [String(b.value), b.count]));
    const fast = facetRows(sold, 'model').filter((b) => b.count >= 100 && metricOf(b, 'days_on_market.median') != null)
      .map((b) => ({ k: String(b.value), n: b.count, med: metricOf(b, 'days_on_market.median'), supply: forSale.has(String(b.value)) ? forSale.get(String(b.value)) / (b.count / 45) : null }))
      .sort((x, y) => x.med - y.med).slice(0, 5);
    return fastCardHtml(fast, { where: 'models with 100+ sales nationwide' });
  }

  // Price cuts this week: used listings two to eight weeks old with their price history (one request,
  // the same one for an hour so repeats are free), the biggest cuts in the last 7 days among them.
  async function liveDropsCard() {
    const r = await Live.request('/v1/listings', { inventory_type: 'used,certified', listed_after: new Date(Date.now() - 56 * 864e5).toISOString().slice(0, 13) + ':00:00Z', sort: '-days_on_market', limit: 100, include: 'price_history' }, null, LATER);
    const cars = (r.data || []).map(Live.normalize);
    cars.forEach((l) => LIVE_SEEN.set(l.id, l));
    const drops = Market.recentDrops(cars, 7);
    return dropsCardHtml(drops, { title: `${num(drops.length)} of ${num(cars.length)} used listings got cheaper this week`, sub: 'Biggest reductions in the last 7 days, among used cars listed two to eight weeks ago' });
  }

  // Priced lowest for what they are: 100 listings each of the four most-listed recent used models under
  // 80k miles (one request to find them, one each), each priced against a fair value fit to its model.
  async function liveValueCard(ctx) {
    const base = { inventory_type: 'used,certified', year: USED_YEARS(), max_mileage: 80000 };
    const models = facetRows(await vfacet(base, 'model', { facet_value_limit: 4 }, LATER), 'model');
    const pages = await Promise.all(models.map((b) => Live.request('/v1/listings', Object.assign({}, base, { model: b.value, limit: 100 }), null, LATER)));
    const pool = pages.flatMap((r) => (r.data || []).map(Live.normalize)).filter((l) => l.price > 0);
    // Each car against its own trim (an F-150 XL against XLs, not Platinums): the fit runs on copies
    // keyed by model and trim, and trims with fewer than ten cars are left out.
    const byTrim = new Map(pool.map((l) => [l.id, Object.assign({}, l, { model: `${l.model} ${l.trim}` })]));
    const fv = Live.fairValueFrom([...byTrim.values()], CURRENT_YEAR);
    for (const l of pool) {
      LIVE_SEEN.set(l.id, l);
      const e = fv(byTrim.get(l.id));
      if (e) LIVE_EXPECTED.set(l.id, e);
    }
    // Over 30% under is more often a salvage title or a typo than a deal.
    const values = pool.filter((l) => LIVE_EXPECTED.get(l.id) && delta(l) < -0.03 && delta(l) > -0.3).sort((a, b) => delta(a) - delta(b)).slice(0, 5);
    return valueCardHtml(values, { sub: `The ${models.map((b) => esc(b.value)).join(', ')} under 80k miles, up to six years old, ranked by distance below the value of the same trim, year and miles among ${num(pool.length)} of them — not a “deal badge”, just the math.` });
  }

  /* ----- Rewind the market: as it stood on an earlier day ----- */

  const CAPSULES = [[7, '1 week ago'], [30, '1 month ago'], [90, '3 months ago']];

  function rewindHtml(cats) {
    const caps = CAPSULES.map(([d, label]) => Object.assign(Market.timeCapsule(LISTINGS, SOLD, d, { minGroup: 25 }), { label }));
    const cls = (v, lowGood) => (Math.abs(v) < 0.005 ? '' : (lowGood ? v < 0 : v > 0) ? 'good' : 'warn');
    const cards = caps.map((c) => {
      const cnt = c.now.count / c.then.count - 1, med = c.now.median / c.then.median - 1, used = c.now.usedMedian / c.then.usedMedian - 1;
      return `<article class="card insight capsule">
        <header><p class="capsule-when">${esc(c.label)}</p><h3>${esc(dateDaysAgo(c.daysAgo))}</h3></header>
        <dl class="capsule-stats">
          <div><dt>Cars for sale</dt><dd>${num(c.then.count)}<span class="arrow" aria-hidden="true">→</span>${num(c.now.count)}</dd><small class="${cls(cnt)}">${signedPct(cnt, 1)} since</small></div>
          <div><dt>Median asking</dt><dd>${money(c.then.median)}<span class="arrow" aria-hidden="true">→</span>${money(c.now.median)}</dd><small class="${cls(med, true)}">${signedPct(med, 1)}</small></div>
          <div><dt>Used median</dt><dd>${money(c.then.usedMedian)}<span class="arrow" aria-hidden="true">→</span>${money(c.now.usedMedian)}</dd><small class="${cls(used, true)}">${signedPct(used, 1)}</small></div>
        </dl>
        <p class="capsule-since"><span><b>${num(c.soldSince)}</b> sold since</span><span><b>${num(c.listedSince)}</b> listed since</span><span><b>${num(c.cutsSince)}</b> price cuts since</span></p>
        ${c.models.length ? `<ul class="rank-list">${c.models.slice(0, 3).map((m) => `<li><a href="${searchHref({ model: m.key, condition: ['Used', 'Certified'] })}"><span><b>${esc(m.key)}</b><small>used median was ${money(m.thenMedian)}</small></span><span class="r"><b>${money(m.nowMedian)}</b><small class="${cls(m.change, true)}">${signedPct(m.change, 1)}</small></span></a></li>`).join('')}</ul>` : ''}
        <a class="card-cta" href="${searchHref({ when: String(c.daysAgo) })}">Open the market as it was on ${esc(dateDaysAgo(c.daysAgo))} →</a>
      </article>`;
    }).join('');
    const long = caps[caps.length - 1];
    const movers = long.models.slice(0, 8);
    const vsCard = !movers.length ? '' : `<article class="card insight wide">
      <header><h3>Used prices then and now, by model</h3><p class="muted">Median asking price for each model on ${esc(dateDaysAgo(long.daysAgo))} vs. today, the biggest moves first. Models with 25+ cars both days.</p></header>
      <ul class="vs-list">${movers.map((m) => {
        const v = Math.max(-1, Math.min(1, m.change / 0.25));
        const c = m.change <= -0.03 ? 'good' : m.change >= 0.03 ? 'warn' : '';
        return `<li><a href="${searchHref({ model: m.key, condition: ['Used', 'Certified'] })}">
          <span class="vs-model"><b>${esc(m.key)}</b><small>${money(m.thenMedian)} then · ${money(m.nowMedian)} now · ${plural(m.nowCount, 'car')} today</small></span>
          <span class="vs-bar" aria-hidden="true"><i class="${c}" style="left:${v < 0 ? 50 + v * 50 : 50}%;width:${Math.abs(v) * 50}%"></i></span>
          <b class="vs-num ${c}">${signedPct(m.change)}</b></a></li>`;
      }).join('')}</ul>
    </article>`;
    return catHead(cats, 'rewind', { eyebrow: 'The whole market frozen as it stood 1 week, 1 month and 3 months ago: every car then for sale, at that day’s asking price. Any search can be run on any of those days.' }) +
      `<div class="capsule-grid">${cards}</div>${vsCard ? `<div class="insight-grid">${vsCard}</div>` : ''}`;
  }

  // With live data, the rewind cards are doors into the source's daily snapshots rather than numbers computed here.
  function liveRewindHtml(cats) {
    const scope = homeScope();
    return catHead(cats, 'rewind', { eyebrow: `A daily snapshot of every listing is kept. Open the market ${esc(scopeText())} as it stood on any of these days.` }) +
      `<div class="capsule-grid">${CAPSULES.map(([d, label]) => `<a class="card insight capsule link" href="${searchHref(Object.assign({ when: String(d) }, scope))}">
        <p class="capsule-when">${esc(label)}</p><h3>${esc(dateDaysAgo(d))}</h3>
        <p class="muted">Every car for sale ${esc(scopeText())} that day, at that day’s asking price.</p>
        <span class="card-cta">Open this capsule →</span></a>`).join('')}</div>`;
  }

  /* ----- Rare Specs and Time Capsules: a card per car ----- */

  const openCorner = (href, label) => `<a class="card-open" href="${href}" aria-label="${esc(label)}" title="${esc(label)}">↗</a>`;

  // A car card for those panels: the title, a line of facts, the car (its photos with live data, else
  // four drawn views), how many of the model are for sale, and three stat cells, the notable ones marked 💎.
  function specCard(l, kind, cells, note) {
    const href = `#/car/${l.id}`;
    const facts = [conditionBadge(l), esc(l.trim), `${num(l.miles)} miles`, money(l.price),
      l.daysListed == null ? null : l.daysListed < 1 ? 'Listed today' : `${plural(l.daysListed, 'day')} for sale`].filter(Boolean);
    const photos = (l.photos || []).slice(0, 4);
    const art = photos.length
      ? `<div class="spec-photos n${photos.length}">${photos.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join('')}</div>`
      : `<div class="spec-art" style="--paint:${esc(l.extHex)}">${Charts.carStrip(l)}</div>`;
    return `<article class="card spec-card">
      <header class="spec-head">
        <h3><a href="${href}">${esc(title(l))}</a></h3>
        <a class="spec-tag" href="${href}">${kind === 'rare' ? '💎 Rare Spec' : '🕰️ Time Capsule'}</a>
        <p class="spec-facts">${facts.join(' <span class="sep">|</span> ')}</p>
      </header>
      <a class="spec-media" href="${href}" aria-label="${esc(title(l))} ${esc(l.trim)}">${art}</a>
      <p class="spec-of">${note}</p>
      <dl class="spec-stats">${cells.map((c) => `<div${c.hi ? ' class="hi"' : ''}><dt>${esc(c.label)}${c.hi ? ' <span class="gem" aria-label="rare">💎</span>' : ''}</dt><dd>${c.value}</dd><small>${c.sub}</small></div>`).join('')}</dl>
      ${openCorner(href, `Open the ${title(l)}`)}
    </article>`;
  }
  // A count is rare at 7 or fewer and a tenth of the model.
  const rareCount = (c, total) => c != null && c <= 7 && c / Math.max(1, total) <= 0.1;
  // The three cells: paint and interior counts within the model, and the options value against the
  // model's average (demo) or, with live data, whether a factory package on the car is itself rare.
  function rarityCells(l, r) {
    const rare = (c) => rareCount(c, r.total);
    const n = (l.options || []).length;
    let optSub, optHi;
    if (r.optionsVsAvg != null) {
      optSub = !r.optionsTotal ? 'No factory options' : r.total < 5 ? 'Few comparable builds' : r.optionsVsAvg >= 0 ? `${pct(r.optionsVsAvg)} more than avg` : `${pct(-r.optionsVsAvg)} less than avg`;
      optHi = r.optionsTotal > 0 && r.optionsVsAvg >= 0.5;
    } else {
      optSub = r.rarePkg ? `${esc(r.rarePkg.name)}: on ${r.rarePkg.count} of ${num(r.total)}` : !n ? 'Options not available' : r.optionsTotal ? `${plural(n, 'factory package')}` : 'Package prices not available';
      optHi = !!r.rarePkg;
    }
    return [
      { label: 'Exterior Color', value: r.extCount == null ? '—' : `1 of ${num(r.extCount)}`, sub: esc(l.extColor), hi: rare(r.extCount) },
      { label: 'Interior Color', value: r.intCount == null ? '—' : `1 of ${num(r.intCount)}`, sub: esc(l.intColor), hi: rare(r.intCount) },
      { label: 'Installed options', value: r.optionsTotal || !n ? money(r.optionsTotal || 0) : plural(n, 'package'), sub: optSub, hi: optHi },
    ];
  }
  const specGrid = (cards, empty) => `<div class="insight-grid spec-grid">${cards.join('') || `<p class="muted">${empty}</p>`}</div>`;
  const usualMiles = (share) => `${pct(share)} of the usual miles`;

  function rarePanelHtml() {
    return specGrid(Market.rareSpecs(LISTINGS, rarity, 4).map(({ l, r }) => specCard(l, 'rare', rarityCells(l, r), `Of the ${num(r.total)} for sale nationwide`)), 'No rare specs right now.');
  }
  function capsulePanelHtml() {
    return specGrid(Market.timeCapsuleCars(LISTINGS, CURRENT_YEAR, 4).map(({ l, share }) => {
      const r = rarity(l);
      return specCard(l, 'capsules', rarityCells(l, r), `Of the ${num(r.total)} for sale nationwide <span class="sep">|</span> ${num(l.miles)} miles in ${plural(CURRENT_YEAR - l.year, 'year')}, ${usualMiles(share)}`);
    }), 'No time capsules right now.');
  }
  // How rare a live car's paint, interior and packages are among its model year nationwide: one
  // facets request per model year (cars of the same model year share it, and repeats are free).
  async function liveRarity(l) {
    const r = await Live.request('/v1/facets', { make: l.make, model: l.model, year: String(l.year), facets: 'exterior_color,base_interior_color,options_packages', facet_value_limit: 100 });
    const d = r.data || {}, fx = d.facets || {};
    const total = d.total || 0;
    const count = (name, v) => { const b = Live.bucketsOf(fx[name]).find((x) => String(x.value).toLowerCase() === String(v || '').toLowerCase()); return b ? b.count : null; };
    const codes = (l.options || []).map((o) => ({ key: String(o.code || o.name).toLowerCase(), name: o.name || o.code }));
    const rarePkg = Live.bucketsOf(fx.options_packages).map((b) => ({ b, o: codes.find((c) => c.key === String(b.value).toLowerCase()) }))
      .filter((x) => x.o && rareCount(x.b.count, total)).sort((a, b) => a.b.count - b.b.count)[0] || null;
    return {
      total, extCount: count('exterior_color', l.extColor), intCount: count('base_interior_color', l.interiorFamily),
      optionsTotal: (l.options || []).reduce((s, o) => s + (o.price || 0), 0), optionsVsAvg: null,
      rarePkg: rarePkg ? { name: rarePkg.o.name, count: rarePkg.b.count } : null,
    };
  }
  const liveSpecNote = (l, r) => `Of the ${num(r.total)} for sale nationwide`;

  // With Visor, rare specs are found among the newest used listings in your market (one request):
  // the model years with the most of them are checked for how common each car's paint, interior and
  // packages are nationwide (a request per model year), and the four rarest get their option prices
  // (a request each).
  async function fillLiveRare() {
    const grid = document.getElementById('live-rare');
    if (!grid) return;
    try {
      const bp = Live.toParams(Object.assign(Market.emptyFilters(), homeScope()), liveCtx());
      const res = await Live.request('/v1/listings', Object.assign({}, bp, { inventory_type: 'used', sort: 'days_on_market', limit: 100, fields: 'default,options_packages,photo_urls' }));
      if (!grid.isConnected) return;
      const cars = (res.data || []).map(Live.normalize).filter((l) => l.year && l.make && l.model);
      const groups = [...Market.groupBy(cars, (l) => `${l.make}|${l.model}|${l.year}`)].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
      const scored = [];
      await Promise.all(groups.map(async ([, g]) => {
        for (const l of g) {
          const r = await liveRarity(l).catch(() => null);
          if (!r || !r.total) continue;
          const score = (rareCount(r.extCount, r.total) ? 3 : 0) + (rareCount(r.intCount, r.total) ? 2 : 0) + (r.rarePkg ? 1 : 0) + (r.extCount ? 1 / r.extCount : 0);
          scored.push({ l, r, score });
        }
      }));
      if (!grid.isConnected) return;
      // The four rarest, one per model, the ones with a 💎 first.
      const picks = [];
      for (const x of scored.sort((a, b) => b.score - a.score)) {
        if (picks.length >= 4 || picks.some((p) => p.l.make === x.l.make && p.l.model === x.l.model)) continue;
        picks.push(x);
      }
      await Promise.all(picks.map(async (x) => {
        const full = await Live.listing(x.l.id).catch(() => null);
        if (full && (full.options || []).some((o) => o.price)) { x.l.options = full.options; x.r.optionsTotal = full.options.reduce((s, o) => s + (o.price || 0), 0); }
      }));
      if (!grid.isConnected) return;
      picks.forEach((x) => LIVE_SEEN.set(x.l.id, x.l));
      grid.innerHTML = picks.map((x) => specCard(x.l, 'rare', rarityCells(x.l, x.r), liveSpecNote(x.l, x.r))).join('')
        || `<p class="muted">No rare specs among the newest listings ${esc(scopeText())} right now${homeZip() ? ': widen the radius above to look further' : ''}.</p>`;
    } catch (e) {
      if (grid.isConnected) grid.innerHTML = liveErrorHtml(e);
    }
  }

  // With Visor, time capsules are the lowest-mileage older used cars listed in your market (one
  // request), with the same rarity cells as a rare spec (a request per car).
  async function fillLiveCapsules() {
    const grid = document.getElementById('live-capsules');
    if (!grid) return;
    try {
      const bp = Live.toParams(Object.assign(Market.emptyFilters(), homeScope()), liveCtx());
      const years = Array.from({ length: 32 }, (_, k) => CURRENT_YEAR - 5 - k); // model years 5 to 36 years old
      const res = await Live.request('/v1/listings', Object.assign({}, bp, { inventory_type: 'used', year: years.join(','), max_mileage: 60000, sort: 'miles', limit: 24, fields: 'default,options_packages,photo_urls' }));
      if (!grid.isConnected) return;
      const cars = (res.data || []).map(Live.normalize).filter((l) => l.year && l.miles > 0);
      cars.forEach((l) => LIVE_SEEN.set(l.id, l));
      const picks = cars.map((l) => { const age = Math.max(1, CURRENT_YEAR - l.year); return { l, age, share: l.miles / (age * 12000) }; })
        .filter((x) => x.share <= 0.35).sort((a, b) => a.share - b.share).slice(0, 4);
      const rar = await Promise.all(picks.map((x) => liveRarity(x.l).catch(() => null)));
      if (!grid.isConnected) return;
      grid.innerHTML = picks.map(({ l, age, share }, i) => {
        const r = rar[i];
        const miles = `${num(l.miles)} miles in ${plural(age, 'year')}, ${usualMiles(share)}`;
        const cells = r ? rarityCells(l, r) : [
          { label: 'Miles', value: num(l.miles), sub: usualMiles(share), hi: true },
          { label: 'Model year', value: String(l.year), sub: `${plural(age, 'year')} old`, hi: false },
          { label: 'Asking', value: money(l.price), sub: l.daysListed == null ? '' : l.daysListed < 1 ? 'Listed today' : `${plural(l.daysListed, 'day')} for sale`, hi: false },
        ];
        return specCard(l, 'capsules', cells, `${r ? `${liveSpecNote(l, r)} <span class="sep">|</span> ` : ''}${miles}`);
      }).join('')
        || `<p class="muted">No time capsules listed ${esc(scopeText())} right now${homeZip() ? ': widen the radius above to look further' : ''}.</p>`;
    } catch (e) {
      if (grid.isConnected) grid.innerHTML = liveErrorHtml(e);
    }
  }

  // Live cards cover the market around your home ZIP (the box at the top, or Settings) or, with none set, the whole country.
  const homeScope = () => (homeZip() ? { near: homeZip(), radius: homeRadius() } : {});
  const scopeText = () => (homeZip() ? `within ${homeRadius()} miles of ${placeLabel(homeZip())}` : 'nationwide');
  const scopeShort = () => (homeZip() ? 'near you' : 'nationwide');

  async function fillLiveInsights() {
    const grid = document.getElementById('live-insights');
    const ctx = liveCtx();
    if (SOURCE() === 'autodev') {
      try {
        const o = await Live.overview();
        if (!document.getElementById('live-insights')) return;
        const maxP = Math.max(1, ...o.prices.map((b) => b.count || 0));
        grid.innerHTML = `
          <article class="card insight"><header><h3>${badge('Live', 'b-live')} ${num(o.total)} cars for sale nationwide</h3>
            <p class="muted">Dealer listings tracked by auto.dev right now</p></header>
            <ul class="rank-list">${o.makes.map((b) => `<li><a href="${searchHref({ make: b.value })}"><span><b>${esc(b.value)}</b></span><span class="r"><b>${b.count != null ? num(b.count) : ''}</b><small>for sale</small></span></a></li>`).join('')}</ul></article>
          <article class="card insight"><header><h3>What cars cost right now</h3><p class="muted">Every listing nationwide, by asking price</p></header>
            <ul class="price-bars">${o.prices.map((b) => { const [lo, hi] = String(b.value).split('-').map(Number); return `<li><a href="${searchHref({ priceMin: lo, priceMax: hi })}"><span>${moneyK(lo)}–${moneyK(hi)}</span><i style="width:${Math.round(((b.count || 0) / maxP) * 100)}%"></i><b>${b.count != null ? num(b.count) : ''}</b></a></li>`; }).join('')}</ul></article>
          <article class="card insight wide"><header><h3>Most listed body styles</h3><p class="muted">Tap one to browse live listings</p></header>
            <div class="quick">${o.bodies.map((b) => `<a class="chip-link" href="${searchHref({ body: b.value })}">${esc(b.value)} <span class="muted">${b.count != null ? num(b.count) : ''}</span></a>`).join('')}</div>
            <p class="muted small">Sold-car trends, price drops and inventory history need a source with sales history. The free auto.dev plan covers cars for sale now.</p></article>`;
      } catch (e) {
        if (document.getElementById('live-insights')) grid.innerHTML = liveErrorHtml(e);
      }
      return;
    }
    // Visor: the same four cards as the demo, each computed from facet requests around your market
    // (or the whole country with no ZIP set) and drawn as soon as its numbers are in; the browse grid
    // takes one more request.
    const scope = homeScope();
    const bp = Live.toParams(Object.assign(Market.emptyFilters(), scope), ctx);
    const browseEl = document.getElementById('live-browse');
    if (grid) {
      grid.innerHTML = ['ret', 'trim', 'momentum', 'arrivals'].map((k) => `<div class="weekly-slot" data-slot="${k}">${loadingHtml(`Computing ${scopeShort() === 'near you' ? 'your market' : 'the market'}…`)}</div>`).join('');
      const fill = (k, make) => make().then((html) => {
        const slot = grid.querySelector(`[data-slot="${k}"]`);
        if (!slot || !slot.isConnected) return;
        if (html) slot.outerHTML = html; else slot.remove();
        if (k === 'trim') fillTrimMapIfShown();
      }).catch((e) => {
        const slot = grid.querySelector(`[data-slot="${k}"]`);
        if (slot && slot.isConnected) slot.outerHTML = `<article class="card insight">${liveErrorHtml(e)}</article>`;
      });
      fill('ret', () => liveRetentionCard(bp, scope, ctx));
      fill('trim', () => liveTrimCard(bp, scope, ctx));
      fill('momentum', () => liveMomentumCard(bp, scope, ctx));
      fill('arrivals', () => liveArrivalsCard(bp, scope));
    }
    if (browseEl) {
      try {
        const models = await Live.request('/v1/facets', Object.assign({}, bp, { facets: 'model', facet_value_limit: 12, metrics: 'price.median' }), null, ON_PAGE);
        const m = (x, k) => (x.metrics && Number.isFinite(x.metrics[k]) ? x.metrics[k] : null);
        const modelRows = Live.bucketsOf(models.data && models.data.facets && models.data.facets.model).filter((x) => x.count > 0).sort((x, y) => y.count - x.count);
        if (browseEl.isConnected) {
          browseEl.innerHTML = modelRows.map((x) => `<a class="browse-item" href="${searchHref(Object.assign({ model: x.value }, scope))}"><b>${esc(x.value)}</b><small>${plural(x.count, 'car')}${m(x, 'price.median') != null ? ` · median ${money(m(x, 'price.median'))}` : ''}</small></a>`).join('')
            || `<p class="muted">Nothing listed ${esc(scopeText())} right now.</p>`;
        }
      } catch (e) {
        if (browseEl.isConnected) browseEl.innerHTML = '<p class="muted">Live counts aren’t available right now.</p>';
      }
    }
  }

  /* ----- The week's four cards from Visor ----- */

  // Facet buckets with their metrics unwrapped, from a /v1/facets response.
  const facetRows = (r, name) => Live.bucketsOf(r && r.data && r.data.facets && r.data.facets[name]).filter((b) => b.count > 0);
  const metricOf = (b, k) => (b && b.metrics && Number.isFinite(b.metrics[k]) ? b.metrics[k] : null);
  const vfacet = (params, facet, extra, opts) => Live.request('/v1/facets', Object.assign({}, params, { facets: facet, facet_value_limit: 60 }, extra || {}), null, opts);
  // The whole-market section is a tab of its own, so when it shows nothing else competes for the screen.
  const LATER = { priority: Live.PRIORITY.page };
  const ON_PAGE = { priority: Live.PRIORITY.page };
  const soldParams = (bp, days) => Object.assign({}, bp, { inventory_status: 'sold', sold_within_days: days });
  // "near Kissimmee, FL" with a home ZIP, else "nationwide".
  const nearText = () => (homeZip() ? `near ${Geo.label(Geo.lookup(homeZip()), { short: true })}` : 'nationwide');

  // The compact SUVs the residual-value card compares (Visor has no segment, so they are named).
  const COMPACT_SUVS = [['Toyota', 'RAV4'], ['Honda', 'CR-V'], ['Mazda', 'CX-5'], ['Mazda', 'CX-50'], ['Nissan', 'Rogue'], ['Hyundai', 'Tucson'], ['Kia', 'Sportage'],
    ['Chevrolet', 'Equinox'], ['Subaru', 'Forester'], ['Ford', 'Escape'], ['Volkswagen', 'Tiguan'], ['Jeep', 'Compass'], ['Subaru', 'Crosstrek'], ['Ford', 'Bronco Sport']];

  // The markets a card can be about, narrowest first: your radius, your state, the country. A card
  // takes the first one with enough sales to say something, and names it.
  function liveLevels(bp, scope, ctx) {
    const out = [];
    const home = homeZip() ? Geo.lookup(homeZip()) : null;
    if (scope.near) out.push({ kind: 'near', params: bp, scope, where: nearText() });
    if (home && home.state) out.push({ kind: 'state', state: home.state, params: Live.toParams(Object.assign(Market.emptyFilters(), { state: [home.state] }), ctx), scope: { state: home.state }, where: `in ${stateName(home.state)}` });
    out.push({ kind: 'nation', params: Live.toParams(Market.emptyFilters(), ctx), scope: {}, where: 'nationwide' });
    return out;
  }
  // All the levels are asked at once (waiting on each in turn made a card that ends up nationwide
  // three round trips slower), except on the smallest usage tier, where the extra requests would
  // queue behind its rate limit and come out slower than asking one level at a time.
  async function firstLevel(levels, compute) {
    const tier = Live.tier();
    if (tier && tier.cap10 < 40) {
      for (const lv of levels) {
        const r = await compute(lv);
        if (r) return Object.assign(r, { lv });
      }
      return null;
    }
    const runs = levels.map((lv) => compute(lv));
    for (const run of runs) run.catch(() => { /* reported below if its level is the one used */ });
    for (let i = 0; i < levels.length; i++) {
      const r = await runs[i];
      if (r) return Object.assign(r, { lv: levels[i] });
    }
    return null;
  }

  // Residual value: used compact SUVs under 75k miles at 1, 2 and 3 years old, average asking over
  // average MSRP for each model (one facets request per model year), in the narrowest market with
  // three models to compare.
  async function liveRetentionCard(bp, scope, ctx) {
    const makes = [...new Set(COMPACT_SUVS.map(([mk]) => mk))].join(',');
    const found = await firstLevel(liveLevels(bp, scope, ctx), async (lv) => {
      const yearOf = (k) => vfacet(Object.assign({}, lv.params, {
        make: makes, year: String(CURRENT_YEAR - 1 - k), inventory_type: 'used,certified', max_mileage: 75000,
      }), 'model', { facet_value_limit: 100, metrics: 'price.mean,msrp.mean,miles.mean' });
      const priced = (b) => metricOf(b, 'price.mean') && metricOf(b, 'msrp.mean');
      // The oldest year first: a market without three of these models at that age can't make the
      // card, and finds out for one request instead of three.
      const oldest = await yearOf(RET_YEARS - 1);
      if (facetRows(oldest, 'model').filter((b) => priced(b) && COMPACT_SUVS.some(([, model]) => model.toLowerCase() === String(b.value).toLowerCase())).length < 3) return null;
      const byYear = (await Promise.all(Array.from({ length: RET_YEARS - 1 }, (_, k) => yearOf(k)))).concat([oldest]);
      const out = [];
      for (const [make, model] of COMPACT_SUVS) {
        const at = byYear.map((r) => facetRows(r, 'model').find((b) => String(b.value).toLowerCase() === model.toLowerCase()));
        const byAge = at.map((b) => (metricOf(b, 'price.mean') && metricOf(b, 'msrp.mean') ? metricOf(b, 'price.mean') / metricOf(b, 'msrp.mean') : null));
        if (byAge.some((v) => v == null || v <= 0 || v > 1.5)) continue;
        const oldest = at[RET_YEARS - 1];
        out.push({ make, model, byAge, msrp: metricOf(oldest, 'msrp.mean'), avgList: metricOf(oldest, 'price.mean'), avgMiles: metricOf(oldest, 'miles.mean') || 0 });
      }
      return out.length >= 3 ? { ret: out.sort((x, y) => y.byAge[RET_YEARS - 1] - x.byAge[RET_YEARS - 1]).slice(0, 3) } : null;
    });
    if (!found) return '';
    const { lv } = found;
    return retentionCardHtml(found.ret, { scope: lv.scope, where: lv.kind === 'nation' ? 'Nationwide' : lv.where.replace(/^in /, ''), near: lv.kind === 'nation' ? '' : lv.where, models: true });
  }

  // Which trim sells faster: the models sold most over 120 days (one request), their trims' median
  // days to sell (one request each for the top six), in the narrowest market where two trims of a
  // model each sold enough to measure. Then that model's sales there for the county map (one
  // request) and its trims nationwide (one); nationwide, its pace by state instead.
  async function liveTrimCard(bp, scope, ctx) {
    const found = await firstLevel(liveLevels(bp, scope, ctx), async (lv) => {
      const sold = soldParams(lv.params, 120);
      const minN = lv.kind === 'nation' ? 20 : 5;
      // Only models with enough sales for two trims to measure, so a small market costs one request, not seven.
      const models = facetRows(await vfacet(sold, 'model', { facet_value_limit: 12 }), 'model').filter((mb) => mb.count >= 2 * minN).slice(0, 6);
      const picks = await Promise.all(models.map(async (mb) => {
        const trims = facetRows(await vfacet(Object.assign({}, sold, { model: mb.value }), 'trim', { facet_value_limit: 20, metrics: 'days_on_market.median' }), 'trim')
          .map((b) => ({ trim: String(b.value), n: b.count, days: metricOf(b, 'days_on_market.median') }))
          .filter((x) => x.days != null && x.n >= minN).sort((x, y) => x.days - y.days);
        if (trims.length < 2) return null;
        const fast = trims[0], slow = trims[trims.length - 1];
        return slow.days - fast.days >= 1 ? { model: String(mb.value), trims, fast, slow, gap: slow.days - fast.days, n: trims.reduce((t, x) => t + x.n, 0) } : null;
      }));
      const tv = picks.filter(Boolean).sort((x, y) => y.gap - x.gap)[0];
      return tv ? { tv } : null;
    });
    if (!found) return '';
    const { tv, lv } = found;
    const mp = Object.assign(soldParams(lv.params, 120), { model: tv.model });
    const national = lv.kind !== 'nation';
    const [cars, nat, states] = await Promise.all([
      Live.request('/v1/listings', Object.assign({}, mp, { limit: 100 })),
      national ? vfacet(Object.assign(soldParams({}, 120), { model: tv.model }), 'trim', { facet_value_limit: 20, metrics: 'days_on_market.median' }) : null,
      national ? null : vfacet(mp, 'state', { metrics: 'days_on_market.median' }),
    ]);
    const list = (cars.data || []).map(Live.normalize).filter((l) => l.sold);
    const make = ([...Market.groupBy(list, (l) => l.make)].sort((x, y) => y[1].length - x[1].length)[0] || [''])[0];
    const condition = list.filter((l) => l.condition === 'New').length / Math.max(1, list.length) >= 0.5 ? 'New' : 'Used';
    const key = `${make} ${tv.model}`.trim();
    let map, mapId = null, aside = '';
    TRIM_MAP = null;
    if (national) {
      // The state county by county: each county with sales colored by its pace against the market's.
      const stCode = lv.state || Geo.lookup(homeZip()).state;
      const inState = list.filter((l) => l.state === stCode && l.lat != null);
      const st = {
        state: stCode, n: inState.length, days: Market.median(inState.map((l) => l.sold.daysToSell)) || tv.fast.days,
        cities: [...Market.groupBy(inState, (l) => l.city)].map(([city, g]) => ({ city, lat: g[0].lat, lng: g[0].lng, n: g.length, days: Market.median(g.map((l) => l.sold.daysToSell)) })),
      };
      TRIM_MAP = { st, key, paceClass };
      map = stateCountyMap(st, key, paceClass) || stateDotMap(st, key, paceClass);
      mapId = 'trim-map';
      const nt = facetRows(nat, 'trim');
      const nd = (t) => metricOf(nt.find((b) => String(b.value) === t), 'days_on_market.median');
      if (nd(tv.fast.trim) != null && nd(tv.slow.trim) != null) aside = `Nationwide: ${esc(tv.fast.trim)} ${Math.round(nd(tv.fast.trim))}d · ${esc(tv.slow.trim)} ${Math.round(nd(tv.slow.trim))}d`;
    } else {
      const byState = {};
      for (const b of facetRows(states, 'state')) byState[String(b.value).toUpperCase()] = { n: b.count, days: metricOf(b, 'days_on_market.median') };
      map = nationalPaceMap(byState, Market.median(Object.values(byState).map((d) => d.days).filter((d) => d != null)), key);
      aside = tv.trims.slice(1, -1).map((t) => `${esc(t.trim)} ${Math.round(t.days)}d`).join(' · ');
    }
    return trimCardHtml({ make, model: tv.model, condition, sc: tv, where: lv.where, aside, map, mapId, scope: lv.scope });
  }

  // A make whose used sales climbed most: used sales by make over the last 30 and 60 days (two
  // requests; the month before is the difference), in the narrowest market with enough sales, then
  // that make's models there (two) and, for the map, its sales by state across the country (two).
  async function liveMomentumCard(bp, scope, ctx) {
    const pair = (params, facet) => Promise.all([vfacet(soldParams(params, 30), facet), vfacet(soldParams(params, 60), facet)])
      .then(([a, b]) => {
        const now = new Map(facetRows(a, facet).map((x) => [String(x.value), x.count]));
        return facetRows(b, facet).map((x) => {
          const n = now.get(String(x.value)) || 0, before = x.count - n;
          return { value: String(x.value), now: n, before, change: before > 0 ? n / before - 1 : null };
        });
      });
    const usedOf = (params) => Object.assign({}, params, { inventory_type: 'used,certified' });
    const found = await firstLevel(liveLevels(bp, scope, ctx), async (lv) => {
      // Enough sales that a month's change means something, from a make that's a real share of the market.
      const rows = await pair(usedOf(lv.params), 'make');
      const total = rows.reduce((t, x) => t + x.now, 0);
      const min = Math.max(lv.kind === 'nation' ? 100 : 30, total * 0.02);
      const top = rows.filter((x) => x.now >= min && x.before >= min && x.change != null).sort((x, y) => y.change - x.change)[0];
      return top ? { top } : null;
    });
    if (!found) return '';
    const { top, lv } = found;
    const [models, states] = await Promise.all([pair(usedOf(Object.assign({}, lv.params, { make: top.value })), 'model'), pair(usedOf({ make: top.value }), 'state')]);
    const byState = {};
    for (const x of states) byState[x.value.toUpperCase()] = x;
    const mv = { make: top.value, now: top.now, before: top.before, change: top.change, models: models.map((x) => ({ model: x.value, now: x.now, before: x.before, change: x.change })).sort((x, y) => y.now - x.now), byState };
    return momentumCardHtml(mv, lv.kind === 'nation' ? {} : { scope: lv.scope, where: lv.where, near: lv.where, mapNote: `Used ${top.value} sales by state, nationwide` });
  }

  // New-model arrivals: next model year's new cars in your market by model (one request, this year's
  // when there are none yet), the top model's cars by status (one) and its newest listings (one).
  async function liveArrivalsCard(bp, scope) {
    const newP = Object.assign({}, bp, { inventory_type: 'new' });
    let year = CURRENT_YEAR + 1;
    let top = facetRows(await vfacet(Object.assign({}, newP, { year: String(year) }), 'model', { facet_value_limit: 5 }), 'model')[0];
    if (!top) {
      year = CURRENT_YEAR;
      top = facetRows(await vfacet(Object.assign({}, newP, { year: String(year) }), 'model', { facet_value_limit: 5 }), 'model')[0];
    }
    if (!top) return '';
    const mp = Object.assign({}, newP, { year: String(year), model: top.value });
    const [status, recent] = await Promise.all([
      vfacet(mp, 'availability_status'),
      Live.request('/v1/listings', Object.assign({}, mp, { limit: 4, fields: 'default,photo_urls' })),
    ]);
    const byStatus = { 'On lot': 0, 'In transit': 0, 'In production': 0 };
    for (const b of facetRows(status, 'availability_status')) {
      const k = { stock: 'On lot', transit: 'In transit', build: 'In production' }[String(b.value).toLowerCase()];
      if (k) byStatus[k] += b.count;
    }
    const cars = (recent.data || []).map(Live.normalize);
    cars.forEach((l) => LIVE_SEEN.set(l.id, l));
    const make = (cars[0] && cars[0].make) || '';
    return arrivalsCardHtml({ year, make, model: String(top.value), total: top.count, byStatus, recent: cars }, { scope, where: scope.near ? nearText() : 'nationwide', near: scope.near ? nearText() : '' });
  }

  function deltaClass(d) {
    if (d == null) return 'tile-empty';
    return d <= -0.025 ? 'd-great' : d <= -0.008 ? 'd-good' : d < 0.008 ? 'd-fair' : d < 0.025 ? 'd-high' : 'd-over';
  }

  /* ----- Home: your market, from a ZIP code ----- */

  const RADII = [25, 50, 100, 250];
  const radiusSegHtml = (radius) => `<div class="radius-seg" role="group" aria-label="Radius">${RADII.map((r) => `<button type="button" data-action="radius" data-r="${r}" aria-pressed="${r === (radius || homeRadius())}">${r} mi</button>`).join('')}</div>`;
  const WIDE = 500; // the larger market around you, in miles
  const POPULAR_MARKETS = [['Los Angeles', '90012'], ['New York', '10001'], ['Chicago', '60601'], ['Dallas', '75201'], ['Houston', '77002'], ['Atlanta', '30303'],
    ['Miami', '33130'], ['Phoenix', '85004'], ['Seattle', '98101'], ['Denver', '80202'], ['Boston', '02108'], ['Bay Area', '94022']];
  const HOME = { cond: 'All', seq: 0 };

  // Save a ZIP as home. Returns false (with a toast) when it isn't a US ZIP code.
  function setHomeZip(raw, opts) {
    const zip = String(raw || '').trim().slice(0, 5);
    const g = Geo.lookup(zip);
    if (!g) {
      toast(zip ? `${zip} isn’t a US ZIP code` : 'Type a 5-digit ZIP code');
      return false;
    }
    const changed = zip !== homeZip();
    store.update((s) => { s.prefs.homeZip = zip; });
    if (changed && !(opts && opts.quiet)) toast(`Your market is now ${Geo.label(g, { short: true })}`);
    // Pin the exact place when the network is there; the built-in table knows the area.
    Geo.refine(zip).then((exact) => {
      if (!exact || exact.approx || homeZip() !== zip) return;
      document.querySelectorAll('[data-home-place]').forEach((el) => { el.textContent = Geo.label(exact, { short: true }); });
      if (view.name === 'home' && Math.abs(exact.lat - g.lat) + Math.abs(exact.lng - g.lng) > 0.05) renderLocal();
    });
    return true;
  }

  function zipFormHtml(kind) {
    const zip = homeZip();
    const g = zip ? Geo.lookup(zip) : null;
    return `<form class="zip-form" data-zip-form="${kind}" aria-label="Your ZIP code">
      <label class="zip-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>
        <input id="zip-input" type="text" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP code" aria-label="ZIP code" value="${esc(zip || '')}">
        <span class="zip-place" data-home-place>${g ? esc(Geo.label(g, { short: true })) : ''}</span>
      </label>
      <button class="btn primary" type="submit">${zip ? 'Update' : 'Show my market'}</button>
      <button class="btn ghost" type="button" data-action="locate" title="Use my current location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>Near me</button>
    </form>`;
  }

  const dealCond = (c) => (c === 'New' ? 'New' : c === 'Used' ? 'Used' : 'All');

  // Everything the local section shows, from a pool of cars (demo inventory or live results).
  function localData(zip, radius, pool, wide) {
    const origin = Geo.place(zip);
    const lm = Market.localMarket(pool, origin, radius, expected);
    const all = wide ? pool.concat(wide.filter((l) => !pool.includes(l))) : pool;
    return {
      origin, lm,
      deals: Market.bestDeals(lm.local, expected, { limit: 10, condition: HOME.cond, currentYear: CURRENT_YEAR }),
      drive: Market.worthTheDrive(all, origin, radius, WIDE, expected, { limit: 6, currentYear: CURRENT_YEAR }),
      vs: Market.localVsNational(all, origin, radius, { limit: 8 }),
      cities: Market.marketCities(all, origin, radius, expected).filter((c) => c.miles != null && c.miles <= WIDE),
      cuts: Market.recentDrops(lm.local, 7).slice(0, 6),
    };
  }

  const compareLine = (local, nat, fmt, lowIsGood) => {
    if (local == null || nat == null) return '';
    const d = local / nat - 1;
    if (Math.abs(d) < 0.015) return `<small>About the US ${fmt}</small>`;
    const good = lowIsGood ? d < 0 : d > 0;
    return `<small class="${good ? 'good' : 'warn'}">${pct(Math.abs(d))} ${d < 0 ? 'under' : 'over'} the US ${fmt}</small>`;
  };

  function dealsScrollerHtml(d, zip, radius) {
    const conds = ['All', 'Used', 'New'];
    return `<div class="row-head">
        <div class="seg" role="group" aria-label="Condition">${conds.map((c) => `<button type="button" data-action="deal-cond" data-cond="${c}" aria-pressed="${HOME.cond === c}">${c}</button>`).join('')}</div>
        <div class="scroller-btns"><button class="icon-btn" type="button" data-action="scroll" data-target="deals-scroller" data-dir="-1" aria-label="Scroll left">‹</button><button class="icon-btn" type="button" data-action="scroll" data-target="deals-scroller" data-dir="1" aria-label="Scroll right">›</button></div>
      </div>
      ${d.deals.length ? `<div class="scroller deals-scroller" id="deals-scroller">${d.deals.map((x, i) => `<div class="reveal" style="--i:${i}">${listingCard(x.l, { noCompare: true, ribbon: `#${i + 1} · ${money(x.saving)} below fair value` })}</div>`).join('')}</div>`
        : `<p class="muted empty-note">No ${HOME.cond === 'All' ? '' : HOME.cond.toLowerCase() + ' '}cars priced clearly below fair value within ${radius} miles right now. Widen the radius or check “Worth the drive”.</p>`}`;
  }

  function localHtml(d, zip, radius, live) {
    const { lm, origin } = d;
    const st = lm.stats, nat = lm.national;
    const g = Geo.lookup(zip);
    const head = catHead(homeCats(), 'local', {
      title: `Your market: <span class="place" data-home-place>${esc(Geo.label(g, { short: true }))}</span>`,
      eyebrow: `${live ? 'Live · ' : ''}within ${radius} miles of ${esc(zip)} · ${plural(live && lm.total != null ? lm.total : st.count, 'car')}${st.dealers ? ` · ${plural(st.dealers, 'seller')}` : ''}${g.approx ? ' · <span title="Only the ZIP’s area is known offline; the exact place loads when online.">approximate</span>' : ''}`,
      extra: radiusSegHtml(radius),
    });
    const strip = `<dl class="market-strip reveal">
        <div><dt>Cars for sale</dt><dd>${num(live && lm.total != null ? lm.total : st.count)}</dd>${nat.count ? `<small>${pct(((live && lm.total != null ? lm.total : st.count) / nat.count), 1)} of the US market</small>` : ''}</div>
        <div><dt>Median asking</dt><dd>${money(st.medianPrice)}</dd>${compareLine(st.medianPrice, nat.medianPrice, 'median', true)}</div>
        <div><dt>Median days listed</dt><dd>${st.medianDays != null ? plural(Math.round(st.medianDays), 'day') : '—'}</dd>${compareLine(st.medianDays, nat.medianDays, 'pace', true)}</div>
        <div><dt>Priced below market</dt><dd>${st.belowShare != null ? pct(st.belowShare) : '—'}</dd>${nat.belowShare != null ? `<small>US: ${pct(nat.belowShare)}</small>` : ''}</div>
        <div><dt>Price cuts this week</dt><dd>${num(st.cuts)}</dd><small>${live ? 'In the newest listings' : `Across ${plural(st.dealers, 'seller')}`}</small></div>
      </dl>`;
    const dealsCard = `<article class="card insight local-deals wide reveal">
        <header><h3>${badge('Deals', 'b-deal')} Best deals near you</h3><p class="muted">Cars priced furthest below their fair value within ${radius} miles. Fair value counts the year, miles, trim and spec of ${live ? 'the cars for sale near you' : 'every car on the market'}, not a dealer’s badge.</p></header>
        <div id="deals-body">${dealsScrollerHtml(d, zip, radius)}</div>
        <a class="card-cta" href="${searchHref(Object.assign({ near: zip, radius, sort: 'best' }, live ? {} : { belowMarket: 1 }))}">See every car near you, best price first →</a>
      </article>`;
    const groups = d.cities.map((c) => ({
      city: c.city, lat: c.lat, lng: c.lng, count: c.count, cls: `${deltaClass(c.delta)}${c.inside ? ' inside' : ' outside'}`,
      title: `${c.city}: ${plural(c.count, 'car')}, ${Math.round(c.miles)} mi away${c.delta != null ? `, prices ${pct(Math.abs(c.delta), 1)} ${c.delta < 0 ? 'below' : 'above'} fair value` : ''}`,
    }));
    const mapCard = `<article class="card insight local-map reveal">
        <header><h3>Where the cars are</h3><p class="muted">Inside your ${radius}-mile radius, and the ${num(WIDE)}-mile market around it. Color is how a city prices against fair value; click one to search there.</p></header>
        ${Charts.localMap(groups.map((g, i) => Object.assign(g, { inside: d.cities[i].inside })), { center: [origin[2], origin[3]], rings: [radius, WIDE], aria: `Map of cars for sale around ${zip}` })}
        <div class="legend"><span><i class="key d-great"></i>Below market</span><span><i class="key d-fair"></i>At market</span><span><i class="key d-over"></i>Above market</span><span><i class="key home"></i>You</span></div>
      </article>`;
    const vsCard = `<article class="card insight local-vs reveal">
        <header><h3>What your market charges</h3><p class="muted">Median used asking price near you vs. ${live ? 'the wider market' : 'the whole US'}, for the models with the most cars nearby.</p></header>
        ${d.vs.length ? `<ul class="vs-list">${d.vs.map((r) => {
          const v = Math.max(-1, Math.min(1, r.diff / 0.25));
          const cls = r.diff <= -0.03 ? 'good' : r.diff >= 0.03 ? 'warn' : '';
          return `<li><a href="${searchHref({ model: r.model, near: zip, radius, condition: ['Used', 'Certified'] })}">
            <span class="vs-model"><b>${esc(r.model)}</b><small>${plural(r.local, 'car')} near you · ${money(r.localMedian)} vs ${money(r.nationalMedian)}</small></span>
            <span class="vs-bar" aria-hidden="true"><i class="${cls}" style="left:${v < 0 ? 50 + v * 50 : 50}%;width:${Math.abs(v) * 50}%"></i></span>
            <b class="vs-num ${cls}">${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${pct(Math.abs(r.diff))}</b></a></li>`;
        }).join('')}</ul>` : '<p class="muted">Not enough cars of one model nearby to compare yet. Widen the radius.</p>'}
      </article>`;
    const driveCard = `<article class="card insight local-drive wide reveal">
        <header><h3>${badge(`${radius}–${num(WIDE)} mi`, 'b-status')} Worth the drive</h3><p class="muted">Cars outside your radius that still come out ahead after the round-trip fuel (about ${Math.round(Market.FUEL_PER_MILE * 100)}¢ a mile) and the best deal on the same model near you.</p></header>
        ${d.drive.length ? `<ol class="drive-list">${d.drive.map((x, i) => `<li class="reveal" style="--i:${i}"><a href="#/car/${x.l.id}">
            <span class="drive-art" style="--paint:${esc(x.l.extHex)}">${Charts.car(x.l.body, x.l.extHex, { label: `${x.l.extColor} ${x.l.model}` })}</span>
            <span class="drive-main"><b>${esc(title(x.l))} ${esc(x.l.trim)}</b><small>${esc(x.l.city)}, ${esc(x.l.state)} · ${num(x.miles)} mi away · ${kMiles(x.l.miles)} · ${money(x.l.price)}</small></span>
            <span class="drive-math"><b class="good">${money(x.saving)} below fair value</b><small>− ${money(x.fuel)} fuel there and back${x.nearbyBest ? ` − ${money(x.nearbyBest)} best nearby` : ''}</small><b class="net">${money(x.net)} ahead</b></span>
          </a></li>`).join('')}</ol>` : `<p class="muted empty-note">Nothing between ${radius} and ${num(WIDE)} miles beats what you can already get nearby.</p>`}
      </article>`;
    const cutsCard = `<article class="card insight local-cuts reveal">
        <header><h3>${badge('↓', 'b-drop')} Price cuts near you this week</h3></header>
        ${d.cuts.length ? `<ul class="rank-list">${d.cuts.map(({ l, c }) => `<li><a href="#/car/${l.id}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${esc(l.city)}, ${esc(l.state)}${lm.distance.get(l.id) != null ? ` · ${num(lm.distance.get(l.id))} mi` : ''} · ${c.daysAgo <= 1 ? 'today' : c.daysAgo + ' days ago'}</small></span>
            <span class="r"><b class="drop">↓ ${money(-c.delta)}</b><small>now ${money(c.to)}</small></span></a></li>`).join('')}</ul>` : '<p class="muted">No cuts in the last 7 days within your radius.</p>'}
        <a class="card-cta" href="${searchHref({ near: zip, radius, dropsOnly: 1, sort: 'newest' })}">All price cuts near you →</a>
      </article>`;
    return `${head}${strip}<div class="local-grid">${dealsCard}${mapCard}${vsCard}${driveCard}${cutsCard}</div>`;
  }

  /* ----- Home: the market on a map ----- */

  // The whole country on one map: every city with cars for sale as a dot sized by how many and colored
  // by how they price against fair value. Click a city to search around it; the link under it opens
  // the search page in its map view. With a live source the counts come from the source, by state.
  function homeMapGroups(pool, o) {
    return [...Market.groupBy(pool, (l) => `${l.city}, ${l.state}`).entries()].filter(([, g]) => g[0].lat != null).map(([city, g]) => {
      const d = o && o.noDelta ? null : Market.median(g.map(delta));
      return {
        city, lat: g[0].lat, lng: g[0].lng, count: g.length, cls: deltaClass(d),
        title: `${city}: ${plural(g.length, 'car')}, median ${money(Market.median(g.map((l) => l.price)))}${d != null ? `, ${pct(Math.abs(d), 1)} ${d < 0 ? 'below' : 'above'} market` : ''}`,
      };
    });
  }
  const mapLegend = `<div class="legend"><span><i class="key d-great"></i>Below market</span><span><i class="key d-fair"></i>At market</span><span><i class="key d-over"></i>Above market</span></div>`;

  function mapSectionHtml() {
    const zip = homeZip(), radius = homeRadius();
    const cats = homeCats();
    const full = searchHref(Object.assign({ layout: 'map' }, zip ? { near: zip, radius: WIDE } : {}));
    const cta = `<a class="card-cta" href="${full}">Open the full map view${zip ? `, ${num(WIDE)} miles around ${esc(zip)}` : ''} →</a>`;
    if (isLive()) {
      return `<section class="section cat" id="map">${catHead(cats, 'map', { eyebrow: `Where the listings are. Click a state or city to shop it.` })}
        <article class="card insight home-map"><div id="home-map-body">${loadingHtml('Counting listings by state…')}</div>${cta}</article></section>`;
    }
    const groups = homeMapGroups(LISTINGS);
    const states = new Set(LISTINGS.map((l) => l.state)).size;
    return `<section class="section cat" id="map">${catHead(cats, 'map', { eyebrow: `${num(LISTINGS.length)} cars for sale in ${num(groups.length)} ${groups.length === 1 ? 'city' : 'cities'} across ${plural(states, 'state')}. Circle size is the number of cars; color is how the city prices against fair value. Click a city to shop it.` })}
      <article class="card insight home-map">
        ${Charts.usMap(groups, Object.assign({ aria: 'Map of cars for sale by city' }, zip && CTX.origin ? { center: [CTX.origin[2], CTX.origin[3]], radius } : {}))}
        ${mapLegend}${cta}
      </article></section>`;
  }

  // Live: counts by state from the source (one facets request). A source without facet metrics
  // (the free auto.dev plan) gets the cities of the newest listings instead.
  async function fillLiveMap() {
    const body = () => document.getElementById('home-map-body');
    if (!body()) return;
    const ctx = liveCtx();
    ensureLiveVocab(ON_PAGE); // for the search box; the map's own requests don't need it
    try {
      let html;
      try {
        const rows = (await Live.facetMetrics(Market.emptyFilters(), ctx, 'state', ON_PAGE)).filter((r) => r.value && r.count);
        const by = new Map(rows.map((r) => [String(r.value).toUpperCase(), r]));
        const hi = Math.max(1, ...rows.map((r) => r.count));
        html = Charts.geoMap((st) => {
          const r = by.get(st);
          if (!r) return null;
          const n = r.count;
          const cls = n >= hi * 0.5 ? 'cnt-4' : n >= hi * 0.2 ? 'cnt-3' : n >= hi * 0.07 ? 'cnt-2' : 'cnt-1';
          return { cls, value: n >= 10000 ? Math.round(n / 1000) + 'k' : n, title: `${st}: ${plural(n, 'car')}${r.avgPrice ? `, average ${money(r.avgPrice)}` : ''}`, href: searchHref({ state: st, layout: 'map' }) };
        }, { clickable: true, labels: true, aria: 'Cars for sale by state' }) +
          `<div class="legend"><span><i class="key cnt-1"></i>Fewer</span><span><i class="key cnt-4"></i>More cars for sale</span></div>`;
      } catch (e) {
        const zip = homeZip();
        const f = Object.assign(Market.emptyFilters(), { sort: 'newest' }, zip ? { near: zip, radius: WIDE } : {});
        const r = await Live.search(f, ctx, { lite: true });
        const groups = homeMapGroups(r.results, { noDelta: true });
        html = Charts.usMap(groups, { aria: 'Map of the newest cars for sale by city' }) +
          `<p class="muted small">The ${plural(r.results.length, 'newest listing')}${zip ? ` within ${num(WIDE)} miles of ${esc(zip)}` : ''}; the full count by state needs a source with sales history.</p>`;
      }
      if (body()) body().innerHTML = html;
    } catch (e) {
      if (body()) body().innerHTML = `<p class="muted">Couldn’t load the map: ${esc(e.message || String(e))}</p>`;
    }
  }

  function localSectionHtml() {
    const zip = homeZip(), radius = homeRadius();
    if (!zip) return '';
    if (isLive()) return `<section class="section cat local" id="local"><div id="local-body">${loadingHtml(`Loading the market around ${zip}…`)}</div></section>`;
    return `<section class="section cat local" id="local"><div id="local-body">${localHtml(localData(zip, radius, LISTINGS), zip, radius, false)}</div></section>`;
  }

  // Redraw the local section in place (radius change, exact location found).
  function renderLocal() {
    const sec = document.getElementById('local');
    if (!sec) return showTab('local');
    sec.outerHTML = localSectionHtml();
    if (isLive()) fillLiveLocal();
  }

  async function fillLiveLocal() {
    const zip = homeZip(), radius = homeRadius();
    const seq = ++HOME.seq;
    const body = () => document.getElementById('local-body');
    if (!zip || !body()) return;
    const ctx = liveCtx();
    const near = (r) => Object.assign(Market.emptyFilters(), { near: zip, radius: r, sort: 'newest' });
    ensureLiveVocab(ON_PAGE); // for the search box; a radius search doesn't need it
    try {
      const [local, wide, national] = await Promise.all([
        Live.search(near(radius), ctx, ON_PAGE),
        Live.search(near(Math.min(WIDE, 500)), ctx, Object.assign({ lite: true }, ON_PAGE)).catch(() => ({ results: [] })),
        Live.count({ ex: {} }, ctx, null, ON_PAGE).catch(() => null),
      ]);
      if (seq !== HOME.seq || !body()) return;
      const pool = [...new Map(local.results.concat(wide.results).map((l) => [l.id, l])).values()];
      for (const l of pool) LIVE_SEEN.set(l.id, l);
      const fv = Live.fairValueFrom(pool, CURRENT_YEAR);
      for (const l of pool) setLiveValue(fv, l);
      const d = localData(zip, radius, local.results, wide.results);
      d.lm.total = local.total;
      if (local.stats) {
        if (local.stats.medianPrice) d.lm.stats.medianPrice = local.stats.medianPrice;
        if (local.stats.avgDays != null) d.lm.stats.medianDays = local.stats.avgDays;
      }
      d.lm.national = { count: national, medianPrice: null, medianDays: null, belowShare: null };
      body().innerHTML = localHtml(d, zip, radius, true);
    } catch (e) {
      if (seq === HOME.seq && body()) body().innerHTML = liveErrorHtml(e);
    }
  }

  function locateMe(btn) {
    if (!navigator.geolocation) return toast('This browser can’t share your location. Type your ZIP code instead.');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Locating…';
    const done = () => { btn.disabled = false; btn.innerHTML = label; };
    navigator.geolocation.getCurrentPosition((pos) => {
      done();
      const g = Geo.nearest(pos.coords.latitude, pos.coords.longitude);
      if (!g) return toast('Couldn’t match your location to a US ZIP code.');
      setHomeZip(g.zip, { quiet: true });
      toast(`You’re near ${Geo.label(g, { short: true })}`);
      renderHome('local');
    }, (err) => {
      done();
      toast(err.code === 1 ? 'Location access was denied. Type your ZIP code instead.' : 'Couldn’t get your location. Type your ZIP code instead.');
    }, { timeout: 8000, maximumAge: 600000 });
  }

  // The "Try" row under the search box: six examples, different on every load. One local
  // example (when you have a home market) always leads so the row stays grounded in your
  // area; the rest are a fresh draw from everything else.
  function tryChips(localQuick) {
    const local = shuffle(localQuick);
    const lead = local.slice(0, 1);
    const rest = shuffle(local.slice(1).concat(quickFor()));
    return lead.concat(rest).slice(0, 6);
  }

  // The top of the home page: one big search box, then where your market is.
  function homeTopHtml() {
    const zip = homeZip(), radius = homeRadius();
    const g = zip ? Geo.lookup(zip) : null;
    const eyebrow = isLive() ? 'Live listings' : `${num(LISTINGS.length)} cars · ${num(DATA.dealers.length)} dealers · ${new Set(LISTINGS.map((l) => l.state)).size} states · ${num(SOLD.length)} recent sales · demo data`;
    const localQuick = zip ? [
      { label: `Best deals within ${radius} mi`, href: searchHref(Object.assign({ near: zip, radius, sort: 'best' }, isLive() ? {} : { belowMarket: 1 })) },
      { label: 'Trucks near me', href: searchHref({ near: zip, radius, body: 'Truck' }) },
      { label: 'Price cuts near me', href: searchHref({ near: zip, radius, dropsOnly: 1, sort: 'newest' }), demoOnly: true },
    ].filter((q) => !isLive() || !q.demoOnly) : [];
    const market = zip
      ? `<div class="home-market" id="home-market">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>
          <span>Your market is <b data-home-place>${esc(Geo.label(g, { short: true }))}</b> <span class="muted">${esc(zip)} · within ${radius} mi</span></span>
          <button class="link-btn" type="button" data-action="edit-zip">Change</button>
          <a class="link-btn" href="#/local" data-action="jump" data-target="local">Best deals near you →</a>
        </div>`
      : `<div class="home-market open" id="home-market">
          ${zipFormHtml('home')}
          <div class="market-chips"><span class="muted small">Or start from a big market:</span>${POPULAR_MARKETS.map(([n, z]) => `<button class="chip-link" type="button" data-action="set-zip" data-zip="${z}">${esc(n)} <span class="muted">${z}</span></button>`).join('')}</div>
          <p class="muted small">Your ZIP stays on this device. It sets the home page, the distance on every car and the “Distance from home” sort.</p>
        </div>`;
    return `<section class="home-top">
        <div class="home-top-inner">
          <p class="eyebrow">${eyebrow}</p>
          <div id="hero-search" class="home-search"></div>
          ${market}
          <div class="quick"><span class="muted">Try</span>${tryChips(localQuick).map((q) => `<a class="chip-link" href="${q.href}">${esc(q.label)}</a>`).join('')}</div>
        </div>
      </section>`;
  }

  function browseHtml(cats) {
    const zip = homeZip();
    const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const popular = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
    return catHead(cats, 'browse', { eyebrow: isLive() ? `The most-listed models ${esc(scopeText())}, with live counts and median asking prices.` : 'The most-listed models, with how many are for sale and the median used asking price.' }) +
      (isLive() ? `<div class="browse-grid" id="live-browse">${loadingHtml('Counting live listings…')}</div>` : `<div class="browse-grid">
        ${popular.map(([key, g]) => {
          const used = g.filter((l) => l.condition !== 'New');
          return `<a class="browse-item" href="${searchHref(Object.assign({ model: key }, zip ? { near: zip, radius: WIDE } : {}))}"><b>${esc(key)}</b><small>${plural(g.length, 'car')} · used median ${money(Market.median(used.map((l) => l.price)))}</small></a>`;
        }).join('')}
      </div>`);
  }

  // The selected tab's section: the carousel for a panel tab, else the section itself.
  function tabHtml() {
    const cats = homeCats(), id = TAB.id;
    if (tabIsPanel(id)) return `<section class="section cat" id="insights"><div id="market-head">${marketHeadHtml()}</div><div id="market-panel">${marketPanelHtml()}</div></section>`;
    if (id === 'map') return mapSectionHtml();
    if (id === 'local') return localSectionHtml();
    if (id === 'trends') return `<section class="section cat" id="trends">${trendsHtml(cats)}</section>`;
    if (id === 'rewind') return `<section class="section cat" id="rewind">${isLive() ? liveRewindHtml(cats) : rewindHtml(cats)}</section>`;
    return `<section class="section cat" id="browse">${browseHtml(cats)}</section>`;
  }
  // Wire up the tab just put on the page: pause the carousel under the pointer, fill it with live data, start the clock.
  function mountTab() {
    const carousel = document.getElementById('insights');
    if (carousel) for (const [ev, on] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false]]) carousel.addEventListener(ev, () => { PANEL.hover = on; });
    fillPanelLive(); // the carousel's panel, or the browse grid
    fillTrimMapIfShown();
    if (isLive()) { fillLiveMap(); fillLiveTrends(); if (homeZip()) fillLiveLocal(); }
    syncCatNav();
    startPanelCycle();
  }
  // Show a tab in place: the search box and the strip stay, the section under them changes.
  function showTab(id) {
    TAB.id = tabFor(id);
    if (tabIsPanel(TAB.id)) PANEL.id = TAB.id;
    const host = document.getElementById('home-tab');
    if (!host) return renderHome(TAB.id);
    stopPanelCycle();
    host.innerHTML = tabHtml();
    mountTab();
    history.replaceState(null, '', `#/${tabRoute(TAB.id)}`);
    // If you'd scrolled down into the old section, bring the new one up under the strip.
    const sec = host.firstElementChild;
    if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView();
  }

  function renderHome(tab, params) {
    if (params && params.get('zip')) {
      setHomeZip(params.get('zip'), { quiet: true });
      history.replaceState(null, '', '#/');
      tab = tab || 'local';
    }
    const zip = homeZip();
    PANEL.id = panelById(PANEL.id).id;
    TAB.id = tabFor(tab || TAB.id);
    if (tab && location.hash.replace(/\?.*/, '') !== `#/${tabRoute(TAB.id)}`) history.replaceState(null, '', `#/${tabRoute(TAB.id)}`);
    setView('home', `
      ${homeTopHtml()}
      ${catNavHtml(homeCats())}
      <div id="home-tab">${tabHtml()}</div>`);
    mountSearchBox(document.getElementById('hero-search'), { size: 'lg', placeholder: 'Search models, VINs, dealers, or saved searches…', placeholders: ['Search models, VINs or dealers…', 'Search cars or VINs…', 'Search cars…'] });
    mountTab();
    if (!zip) requestAnimationFrame(() => { const i = document.getElementById('zip-input'); if (i && matchMedia('(min-width: 861px)').matches) i.focus(); });
    window.scrollTo(0, 0);
  }

  /* ----- Search ----- */

  let S = null; // search view state

  const SORTS = [['best', 'Best price for the car'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'],
    ['discount', 'Biggest discount from MSRP'], ['msrp-desc', 'MSRP: high to low'], ['msrp-asc', 'MSRP: low to high'],
    ['miles-asc', 'Miles: low to high'], ['miles-desc', 'Miles: high to low'], ['year-desc', 'Year: newest'],
    ['newest', 'Recently listed'], ['oldest', 'Longest for sale'], ['distance', 'Distance from home'],
    ['sold-recent', 'Recently sold'], ['sold-fastest', 'Sold fastest']];

  function renderSearch(params) {
    S = { f: filtersFromParams(params), shown: PAGE, layout: ['grid', 'table', 'map'].includes(params.get('layout')) ? params.get('layout') : S ? S.layout : 'grid', filtersOpen: false, exMode: {}, finder: '' };
    setView('search', `
      <div class="search-layout">
        <aside class="filters" id="filters" aria-label="Filters"></aside>
        <section class="results-pane">
          <div class="results-top">
            <button class="btn ghost filters-toggle" type="button" data-action="toggle-filters">⚙ Filters</button>
            <form class="q-wrap" id="q-form" role="search"><svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
              <input id="q-input" type="search" placeholder="Refine, or type a whole search: “white 4runner with tow package”" data-placeholders="Refine, or type a whole search…|Refine or search again…|Refine…" aria-label="Refine results" value="${esc(S.f.q)}"></form>
            <label class="sort"><span class="sr-only">Sort</span><select id="sort-select"></select></label>
            <div class="seg" role="group" aria-label="Layout">
              <button type="button" data-action="layout" data-layout="grid" aria-label="Grid view" title="Grid">▦<span class="seg-label"> Grid</span></button>
              <button type="button" data-action="layout" data-layout="table" aria-label="Table view" title="Table">☰<span class="seg-label"> Table</span></button>
              <button type="button" data-action="layout" data-layout="map" aria-label="Map view" title="Map">◎<span class="seg-label"> Map</span></button>
            </div>
            <button class="btn primary" type="button" data-action="save-search" title="Save this search and get notified when a new match is listed or one drops its price">🎯 Hunt this</button>
          </div>
          <p class="nl-hint" id="nl-hint" hidden></p>
          <div id="results"></div>
        </section>
      </div>`);
    const q = document.getElementById('q-input');
    let t;
    q.addEventListener('input', () => {
      clearTimeout(t);
      const parsed = NLQ.parse(q.value, vocab());
      const hint = document.getElementById('nl-hint');
      hint.hidden = !parsed.understood.length;
      hint.innerHTML = parsed.understood.length ? `Press <kbd>Enter</kbd> to apply: <b>${esc(parsed.understood.join(' · '))}</b>${parsed.rest ? ` and search “${esc(parsed.rest)}”` : ''}` : '';
      t = setTimeout(() => { if (!parsed.understood.length) updateFilters((f) => { f.q = q.value.trim(); }); }, 200);
    });
    document.getElementById('q-form').addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(t);
      const parsed = NLQ.parse(q.value, vocab());
      updateFilters((f) => {
        mergeParsed(f, parsed);
        f.q = parsed.understood.length ? parsed.rest : q.value.trim();
      });
      q.value = S.f.q;
      document.getElementById('nl-hint').hidden = true;
    });
    document.getElementById('sort-select').addEventListener('change', (e) => updateFilters((f) => { f.sort = e.target.value; }));
    refreshSearch();
    window.scrollTo(0, 0);
  }

  function mergeParsed(f, parsed) {
    const p = parsed.filters;
    for (const k of ARRAY_KEYS) if (p[k]) f[k] = [...new Set([...f[k], ...p[k]])];
    for (const [k, vals] of Object.entries(p.ex || {})) f.ex[k] = [...new Set([...(f.ex[k] || []), ...vals])];
    for (const k of ['priceMin', 'priceMax', 'milesMax', 'near', 'sort']) if (p[k] != null) f[k] = p[k];
    for (const k of BOOL_KEYS) if (p[k]) f[k] = true;
  }

  function updateFilters(fn) {
    fn(S.f);
    S.shown = PAGE;
    const qs = paramsFromFilters(S.f).toString();
    history.replaceState(null, '', '#/search' + (qs ? '?' + qs : ''));
    refreshSearch();
  }

  function refreshSearch() {
    if (isLive()) return refreshSearchLive();
    S.live = false;
    const data = datasetFor(S.f);
    const { results, facets } = Market.search(data, S.f, CTX);
    S.results = results;
    S.facets = facets;
    renderSearchParts();
  }

  let liveSeq = 0;
  async function refreshSearchLive(append) {
    const seq = ++liveSeq;
    const resultsEl = document.getElementById('results');
    if (append) {
      const btn = resultsEl.querySelector('[data-action="live-more"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    } else {
      resultsEl.classList.add('is-loading');
      if (!S.results || !S.live) resultsEl.innerHTML = loadingHtml('Searching live listings…');
    }
    try {
      await ensureLiveVocab();
      const r = await Live.search(S.f, liveCtx(), { offset: append ? S.liveNext : 0 });
      if (seq !== liveSeq) return;
      S.live = true;
      if (append) S.results = S.results.concat(r.results);
      else {
        S.results = r.results;
        S.facets = r.facets || {};
        S.total = r.total;
        S.liveStats = r.stats;
        S.liveTrend = null;
        S.dropped = r.dropped || null;
      }
      S.liveNext = r.nextOffset;
      for (const l of r.results) LIVE_SEEN.set(l.id, l);
      // Fair value from the cars on hand, grouped by model.
      const fv = Live.fairValueFrom(S.results, CURRENT_YEAR);
      for (const l of S.results) setLiveValue(fv, l);
      if (!append && prefs().valueSort !== 'count' && can('metrics')) await addLiveMetrics(seq);
      if (seq !== liveSeq) return;
      S.shown = S.results.length;
      renderSearchParts();
    } catch (e) {
      if (seq !== liveSeq) return;
      resultsEl.innerHTML = liveErrorHtml(e);
      document.getElementById('filters').innerHTML = '';
    } finally {
      if (seq === liveSeq) resultsEl.classList.remove('is-loading');
    }
  }

  // Per-value averages for "sort filter values by", one request per filter group.
  async function addLiveMetrics(seq) {
    const keys = ['condition', 'make', 'model', 'trim', 'year', 'body', 'fuel', 'drivetrain', 'colorFamily'].filter((k) => (S.facets[k] || []).length);
    const got = await Promise.all(keys.map((k) => Live.facetMetrics(S.f, liveCtx(), k).catch(() => null)));
    if (seq !== liveSeq) return;
    keys.forEach((k, i) => { if (got[i]) S.facets[k] = got[i]; });
  }

  function renderSearchParts() {
    const active = document.activeElement;
    const focusKey = active && active.closest('#filters') ? active.dataset.focusKey || active.id : null;
    const results = S.results;
    const facets = S.facets;
    const sortSel = document.getElementById('sort-select');
    const sold = S.f.when === 'sold';
    sortSel.innerHTML = SORTS.filter(([v]) => (v.startsWith('sold') ? sold : true) && (v !== 'distance' || CTX.origin || S.f.near) && (!S.live || v === 'best' || Live.SORT[v]))
      .map(([v, t]) => `<option value="${v}">${S.live && v === 'best' ? 'Newest listings' : t}</option>`).join('');
    sortSel.value = S.f.sort;
    if (sortSel.value !== S.f.sort) sortSel.value = 'best';
    document.getElementById('filters').innerHTML = filtersHtml(facets);
    document.getElementById('filters').classList.toggle('open', S.filtersOpen);
    document.getElementById('results').innerHTML = resultsHtml(results);
    if (S.live && S.f.model.length === 1 && can('velocity')) fillLiveOverview();
    document.querySelectorAll('[data-action="layout"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === S.layout)));
    if (S.finder) renderFinder();
    if (focusKey) {
      const el = document.querySelector(`#filters [data-focus-key="${CSS.escape(focusKey)}"], #filters #${CSS.escape(focusKey)}`);
      if (el) {
        el.focus();
        if (el.id === 'finder-input') el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  const VALUE_SORTS = {
    count: { label: 'Listing count', cmp: (a, b) => b.count - a.count, stat: () => '' },
    price: { label: 'Average list price', cmp: (a, b) => (a.avgPrice ?? 1e12) - (b.avgPrice ?? 1e12), stat: (it) => (it.avgPrice ? moneyK(it.avgPrice) : '') },
    days: { label: 'Days for sale', cmp: (a, b) => (a.avgDays ?? 1e9) - (b.avgDays ?? 1e9), stat: (it) => (it.avgDays != null ? `${Math.round(it.avgDays)}d` : '') },
    discount: { label: 'Discount from MSRP', cmp: (a, b) => (b.avgDiscount ?? -1) - (a.avgDiscount ?? -1), stat: (it) => (it.avgDiscount != null ? `-${pct(it.avgDiscount)}` : '') },
  };

  function facetList(key, facets, opts) {
    const o = opts || {};
    let items = facets[key] || [];
    const sel = S.f[key];
    const ex = S.f.ex[key] || [];
    const exMode = S.exMode[key] || (ex.length > 0 && !sel.length);
    if (!items.length && !sel.length && !ex.length) return '';
    const vs = VALUE_SORTS[prefs().valueSort] || VALUE_SORTS.count;
    const sorter = prefs().valueSort === 'count' && o.sort ? o.sort : (a, b) => vs.cmp(a, b) || String(a.value).localeCompare(String(b.value));
    items = [...items].sort(sorter);
    const limit = o.limit || 8;
    const expanded = S[`more_${key}`];
    const picked = exMode ? ex : sel;
    const visible = expanded ? items : items.filter((it, i) => i < limit || picked.includes(it.value));
    const body = visible.map((it) => {
      const checked = picked.includes(it.value);
      const fk = `${key}:${it.value}`;
      const stat = vs.stat(it);
      return `<label class="opt${it.count === 0 && !checked ? ' zero' : ''}${exMode ? ' ex' : ''}">
        <input type="checkbox" data-facet="${key}" data-mode="${exMode ? 'ex' : 'in'}" value="${esc(it.value)}" data-focus-key="${esc(fk)}" ${checked ? 'checked' : ''}>
        ${o.swatch ? `<i class="sw" style="background:${esc(o.swatch(it.value))}"></i>` : ''}
        <span class="opt-label">${esc(o.fmt ? o.fmt(it.value) : it.value)}</span>${stat ? `<span class="opt-stat">${stat}</span>` : ''}<span class="opt-count">${it.count == null ? '' : num(it.count)}</span></label>`;
    }).join('');
    const more = items.length > limit ? `<button type="button" class="link-btn" data-action="more" data-key="${key}">${expanded ? 'Show less' : `Show all ${items.length}`}</button>` : '';
    const hint = o.hint ? `<p class="facet-hint">${o.hint}</p>` : '';
    return `<fieldset class="facet" id="facet-${key}"><legend><span>${esc(FACET_LABELS[key])}</span>
      <span class="legend-actions">${sel.length || ex.length ? `<button type="button" class="link-btn" data-action="clear-facet" data-key="${key}">Clear</button>` : ''}
      ${S.live && !can('exclude') ? '' : `<button type="button" class="mode-btn${exMode ? ' on' : ''}" data-action="ex-mode" data-key="${key}" aria-pressed="${exMode}" title="Exclude mode: checked values are left out">${exMode ? 'Excluding' : 'Exclude'}</button>`}</span></legend>${hint}${body}${more}</fieldset>`;
  }

  const HEX = lazy(new Map(), () => {
    const m = new Map();
    for (const l of ALL) if (!m.has(l.extColor)) m.set(l.extColor, l.extHex);
    return m;
  });
  const FAMILY_HEX = { White: '#f4f4f2', Black: '#151515', Gray: '#6b6e72', Silver: '#b9bcc0', Blue: '#2f4a6b', Red: '#a3141d', Green: '#3e5a3e',
    Brown: '#7a5a3a', Beige: '#c9bfa8', Orange: '#d2691e', Yellow: '#e3b51b', Purple: '#5b3d72', Other: '#999' };

  function filtersHtml(facets) {
    const f = S.f;
    const singleModel = f.model.length === 1;
    const group = (name, inner) => (inner.trim() ? `<div class="f-group"><h3 class="f-group-title">${name}</h3>${inner}</div>` : '');
    return `
      <div class="filters-head"><h2>Filters</h2>
        <button type="button" class="link-btn" data-action="reset">Reset all</button>
        <button type="button" class="icon-btn filters-close" data-action="toggle-filters" aria-label="Close filters">✕</button></div>
      <div class="finder">
        <input id="finder-input" type="search" placeholder="Search filters: “brown interior”, “without sunroof”" data-placeholders="Search filters: “brown interior”…|Search filters…" aria-label="Search filters" value="${esc(S.finder)}" autocomplete="off">
        <ul class="finder-list" id="finder-list" role="listbox" hidden></ul>
      </div>
      ${S.live && can('historyFilters') ? `<div class="toggle-row">
        <label class="switch"><input type="checkbox" data-bool="noAccidents" data-focus-key="noAccidents" ${f.noAccidents ? 'checked' : ''}><span></span>No accidents reported</label>
        <label class="switch"><input type="checkbox" data-bool="oneOwner" data-focus-key="oneOwner" ${f.oneOwner ? 'checked' : ''}><span></span>One owner</label>
      </div>` : ''}
      ${S.live ? '' : `<div class="toggle-row">
        <label class="switch"><input type="checkbox" data-bool="belowMarket" data-focus-key="belowMarket" ${f.belowMarket ? 'checked' : ''}><span></span>Below market only</label>
        <label class="switch"><input type="checkbox" data-bool="dropsOnly" data-focus-key="dropsOnly" ${f.dropsOnly ? 'checked' : ''}><span></span>Has price cuts</label>
      </div>`}
      ${S.live && !can('metrics') ? '' : `<label class="value-sort"><span>Sort filter values by</span>
        <select id="value-sort">${Object.entries(VALUE_SORTS).map(([k, v]) => `<option value="${k}" ${prefs().valueSort === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>`}
      ${group('Condition & price', `
        ${facetList('condition', facets, { sort: (a, b) => ['New', 'Certified', 'Used'].indexOf(a.value) - ['New', 'Certified', 'Used'].indexOf(b.value) })}
        <fieldset class="facet"><legend><span>Price</span></legend>
          <div class="range">
            <label><span>Min</span><input type="number" inputmode="numeric" step="1000" min="0" id="price-min" data-num="priceMin" placeholder="No min" value="${f.priceMin ?? ''}"></label>
            <label><span>Max</span><input type="number" inputmode="numeric" step="1000" min="0" id="price-max" data-num="priceMax" placeholder="No max" value="${f.priceMax ?? ''}"></label>
          </div>
        </fieldset>
        ${S.live && !can('msrp') ? '' : `<fieldset class="facet"><legend><span>Original MSRP</span></legend>
          <div class="range">
            <label><span>Min</span><input type="number" inputmode="numeric" step="1000" min="0" id="msrp-min" data-num="msrpMin" placeholder="No min" value="${f.msrpMin ?? ''}"></label>
            <label><span>Max</span><input type="number" inputmode="numeric" step="1000" min="0" id="msrp-max" data-num="msrpMax" placeholder="No max" value="${f.msrpMax ?? ''}"></label>
          </div>
        </fieldset>`}
        <fieldset class="facet"><legend><span>Mileage</span></legend>
          <select id="miles-max" data-num="milesMax">
            <option value="">Any mileage</option>
            ${[10000, 30000, 50000, 75000, 100000, 150000].map((m) => `<option value="${m}" ${f.milesMax === m ? 'selected' : ''}>Under ${kMiles(m)}</option>`).join('')}
          </select>
        </fieldset>
        ${facetList('year', facets, { limit: 6, sort: (a, b) => b.value - a.value })}
        <fieldset class="facet"><legend><span>Location</span></legend>
          <form class="zip-mini" data-zip-form="search"><input type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP code" aria-label="ZIP code" value="${Geo.isZip(f.near) ? esc(f.near) : ''}" data-focus-key="zip-near"><button class="btn" type="submit">Go</button></form>
          ${Geo.isZip(f.near) ? `<p class="f-note">${esc(Geo.label(Geo.lookup(f.near)))}</p>` : homeZip() && !f.near ? `<button type="button" class="link-btn f-note" data-action="near-home">Near me · ${esc(Geo.label(Geo.lookup(homeZip()), { short: true }))} ${esc(homeZip())}</button>` : ''}
          <select id="near" data-near aria-label="Demo market">
            <option value="">${S.live ? 'Anywhere in the US' : 'Or pick a demo market'}</option>
            ${CITY_NAMES.map((c) => `<option ${f.near === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          ${f.near ? `<label class="radius"><span>Within <b>${f.radius} mi</b></span><input type="range" id="radius" min="25" max="1000" step="25" value="${f.radius}" data-num="radius"></label>` : ''}
        </fieldset>`)}
      ${group('Vehicle', `
        ${facetList('make', facets, { limit: 6 })}
        ${facetList('model', facets, { limit: 6 })}
        ${singleModel || f.trim.length ? facetList('trim', facets) : ''}
        ${facetList('body', facets)}
        ${facetList('fuel', facets)}
        ${facetList('drivetrain', facets)}
        ${facetList('transmission', facets, { hint: S.live ? null : 'Type “manual” or “stick” in any search box.' })}`)}
      ${group('Colors', `
        ${facetList('colorFamily', facets, { swatch: (v) => FAMILY_HEX[v] || '#999' })}
        ${S.live && !can('extColor') ? '' : facetList('extColor', facets, { limit: 6, swatch: (v) => HEX.get(v) || '#999' })}
        ${facetList('interiorFamily', facets, { swatch: (v) => FAMILY_HEX[v] || '#999' })}`)}
      ${S.live && !can('features') && !can('options') && !can('upfitter') ? '' : group('Equipment', `
        ${facetList('features', facets, { limit: 8, hint: 'Cars must have every feature you check.', fmt: S.live ? Live.titleCase : null })}
        ${facetList('options', facets, { limit: 8, hint: S.live ? 'Manufacturer option and package codes.' : 'Factory options and packages installed on the car.' })}
        ${facetList('upfitter', facets, { limit: 8, hint: 'Aftermarket builders like Roush, Rocky Ridge or BraunAbility.', fmt: S.live ? Live.titleCase : null })}`)}
      ${group('Origin & seller', `
        ${facetList('assembly', facets, { limit: 6 })}
        ${facetList('seller', facets, { hint: S.live ? 'Franchise or independent dealer. Live data covers dealer listings only.' : null })}
        ${facetList('state', facets, { limit: 6 })}
        ${S.live && !can('vinPattern') ? '' : `<fieldset class="facet"><legend><span>VIN pattern</span></legend>
          <input type="text" id="vin-pattern" data-text="vin" class="mono-input" maxlength="17" placeholder="e.g. 5TF*B5D or JTE??????N" value="${esc(f.vin)}" spellcheck="false" autocapitalize="characters">
          <p class="facet-hint">Prefix, with <code>?</code> for any single character${S.live ? '' : ' (or <code>*</code>)'}. Position 10 is the model year; 11 is the plant.</p>
        </fieldset>`}`)}`;
  }

  function renderFinder() {
    const list = document.getElementById('finder-list');
    if (!list) return;
    const matches = NLQ.findFilters(S.finder, S.facets, FACET_LABELS);
    S.finderItems = matches;
    S.finderActive = Math.min(S.finderActive || 0, Math.max(0, matches.length - 1));
    list.hidden = !S.finder.trim();
    list.innerHTML = matches.length ? matches.map((m, i) => `<li role="option" class="${i === S.finderActive ? 'active' : ''}" data-i="${i}">
        <span class="fl-key">${esc(m.label)}</span><span class="fl-val">${m.exclude ? '<b class="bad">without</b> ' : ''}${esc(prettyValue(m.key, m.value))}</span><span class="opt-count">${num(m.count)}</span></li>`).join('')
      : '<li class="empty">No matching filter values</li>';
  }

  function applyFinder(i, keepOpen) {
    const m = S.finderItems && S.finderItems[i];
    if (!m) return;
    if (!keepOpen) S.finder = '';
    updateFilters((f) => {
      if (m.exclude) f.ex[m.key] = [...new Set([...(f.ex[m.key] || []), m.value])];
      else f[m.key] = [...new Set([...f[m.key], m.value])];
    });
    toast(`${m.exclude ? 'Excluding' : 'Added'} ${m.label}: ${prettyValue(m.key, m.value)}`);
    const input = document.getElementById('finder-input');
    if (input) input.focus();
  }

  // Visor sends some values as tokens (e.g. heated_seats); show them as words.
  const prettyValue = (key, v) => (S && S.live && (key === 'features' || key === 'upfitter') && /_|^[a-z0-9]+$/.test(v) ? Live.titleCase(v) : v);

  function activeChips() {
    const f = S.f;
    const chips = [];
    for (const k of ARRAY_KEYS) for (const v of f[k]) chips.push({ label: k === 'interiorFamily' ? `${v} interior` : prettyValue(k, v), k, v });
    for (const [k, vals] of Object.entries(f.ex)) for (const v of vals) chips.push({ label: `without ${prettyValue(k, v)}`, k: 'x.' + k, v, ex: true });
    if (f.q) chips.push({ label: `“${f.q}”`, k: 'q' });
    if (f.vin) chips.push({ label: `VIN ${f.vin.toUpperCase()}`, k: 'vin' });
    if (f.priceMin != null) chips.push({ label: `Over ${money(f.priceMin)}`, k: 'priceMin' });
    if (f.priceMax != null) chips.push({ label: `Under ${money(f.priceMax)}`, k: 'priceMax' });
    if (f.msrpMin != null) chips.push({ label: `MSRP over ${money(f.msrpMin)}`, k: 'msrpMin' });
    if (f.msrpMax != null) chips.push({ label: `MSRP under ${money(f.msrpMax)}`, k: 'msrpMax' });
    if (f.milesMax != null) chips.push({ label: `Under ${kMiles(f.milesMax)}`, k: 'milesMax' });
    if (f.near) chips.push({ label: `${f.radius} mi of ${placeLabel(f.near)}`, k: 'near' });
    if (f.dropsOnly) chips.push({ label: 'Has price cuts', k: 'dropsOnly' });
    if (f.belowMarket) chips.push({ label: 'Below market', k: 'belowMarket' });
    if (f.noAccidents) chips.push({ label: 'No accidents', k: 'noAccidents' });
    if (f.oneOwner) chips.push({ label: 'One owner', k: 'oneOwner' });
    if (!chips.length) return '';
    return `<div class="active-chips">${chips.map((c) => `<button type="button" class="chip${c.ex ? ' chip-ex' : ''}" data-action="remove-chip" data-k="${esc(c.k)}" data-v="${esc(c.v || '')}">${esc(c.label)} <span aria-hidden="true">✕</span><span class="sr-only">Remove filter</span></button>`).join('')}</div>`;
  }

  function velocityFor(filterFn) {
    return Market.velocity(LISTINGS.filter(filterFn), SOLD.filter(filterFn));
  }

  function overviewHtml() {
    const f = S.f;
    if (f.model.length !== 1) return '';
    if (S.live) {
      const vel = can('velocity');
      const yrs = (S.facets.year || []).filter((y) => y.count).sort((a, b) => a.value - b.value);
      return `<section class="card overview"><div class="overview-head"><div><p class="eyebrow">Market overview · live</p><h2>${esc(f.model[0])}</h2></div>
        <dl class="kpis" id="live-kpis"><div><dt>For sale</dt><dd>${num(S.total)}</dd></div>${vel ? '<div><dt>Sold, 30 days</dt><dd class="muted">…</dd></div><div><dt>Median days to sell</dt><dd class="muted">…</dd></div><div><dt>Days of supply</dt><dd class="muted">…</dd></div>' : ''}</dl></div>
        <div class="overview-grid"><div><h4>${vel ? 'Median price by model year' : 'Listings by model year'}</h4><div id="live-years" class="muted small">${vel ? 'Loading…' : yrs.length ? Charts.columns(yrs.map((y) => ({ label: String(y.value).slice(2).padStart(3, "'"), value: y.count, display: num(y.count), title: `${y.value}: ${plural(y.count, 'car')}` })), { aria: 'Listings by model year' }) : ''}</div></div>
        <div><h4>Trims</h4><ul class="trim-list">${(S.facets.trim || []).slice(0, 8).map((t) => `<li><button type="button" class="link-row" data-action="pick-trim" data-trim="${esc(t.value)}"><span>${esc(t.value)}</span><span class="muted">${num(t.count)}</span><span></span></button></li>`).join('')}</ul></div></div></section>`;
    }
    const key = f.model[0];
    const all = LISTINGS.filter((l) => `${l.make} ${l.model}` === key);
    const m = modelOf(key);
    if (!m || !all.length) return '';
    const byYear = [...Market.groupBy(all, (l) => l.year).entries()].sort((a, b) => a[0] - b[0]);
    const trims = [...Market.groupBy(all, (l) => l.trim).entries()].sort((a, b) => b[1].length - a[1].length);
    const used = all.filter((l) => l.condition !== 'New');
    const v = velocityFor((l) => `${l.make} ${l.model}` === key);
    return `<section class="card overview">
      <div class="overview-head">
        <div><p class="eyebrow">Market overview · ${esc(m.seg)}</p><h2>${esc(key)}</h2></div>
        <dl class="kpis">
          <div><dt>For sale</dt><dd>${num(all.length)}</dd></div>
          <div><dt>Used median</dt><dd>${money(Market.median(used.map((l) => l.price)))}</dd></div>
          <div><dt>Sold, 30 days</dt><dd>${num(v.sold30)}</dd></div>
          <div><dt>Median days to sell</dt><dd>${v.medianDaysToSell != null ? Math.round(v.medianDaysToSell) : '—'}</dd></div>
          <div><dt>Days of supply</dt><dd>${v.daysOfSupply ? Math.round(v.daysOfSupply) : '—'}</dd></div>
          <div><dt>Sale vs. first list</dt><dd>${v.saleToList ? pct(v.saleToList) : '—'}</dd></div>
        </dl>
      </div>
      <div class="overview-grid">
        <div><h4>Median price by model year</h4>
          ${Charts.columns(byYear.map(([y, g]) => {
            const med = Market.median(g.map((l) => l.price));
            return { label: String(y).slice(2).padStart(3, "'"), value: med, display: '$' + Math.round(med / 1000) + 'k', title: `${y}: ${plural(g.length, 'car')}, median ${money(med)}` };
          }), { aria: `Median ${key} price by model year` })}
        </div>
        <div><h4>Trims</h4>
          <ul class="trim-list">${trims.map(([t, g]) => `<li><button type="button" class="link-row" data-action="pick-trim" data-trim="${esc(t)}"><span>${esc(t)}</span><span class="muted">${num(g.length)}</span><span>${money(Market.median(g.map((l) => l.price)))}</span></button></li>`).join('')}</ul>
        </div>
      </div>
    </section>`;
  }

  function sentenceHtml(count) {
    const f = S.f;
    return `<h1 class="sentence"><b>${num(count)}</b>
      <label class="inline-select"><span class="sr-only">When</span><select id="when-select">${WHEN.filter(([v]) => !S.live || v === '0' || (v === 'sold' ? can('sold') : can('snapshots'))).map(([v, t]) => `<option value="${v}" ${f.when === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="inline-select"><span class="sr-only">Where</span><select id="where-select"><option value="">nationwide</option>${CITY_NAMES.map((c) => `<option value="${esc(c)}" ${f.near === c ? 'selected' : ''}>near ${esc(c)}</option>`).join('')}</select></label>
    </h1>`;
  }

  function resultsHtml(results) {
    const live = S.live;
    const sum = live ? Object.assign({ count: S.total, withDrops: null }, S.liveStats || {}) : Market.summarize(results);
    if (live && sum.medianPrice == null && results.length) Object.assign(sum, Market.summarize(results), { count: S.total, withDrops: null });
    const sold = S.f.when === 'sold';
    const when = Number(S.f.when) || 0;
    const liveNotes = live ? [
      S.f.q ? `Live search doesn’t support free-text search, so “${esc(S.f.q)}” isn’t applied. Try describing it in the main search box.` : '',
      S.dropped ? `Live search doesn’t support one of these filters (<code>${esc(S.dropped)}</code>), so it was skipped.` : '',
      S.f.belowMarket || S.f.dropsOnly ? '“Below market only” and “Has price cuts” apply to demo data only.' : '',
    ].filter(Boolean) : [];
    const head = `${activeChips()}
      <div class="results-summary" aria-live="polite">${sentenceHtml(sum.count)}
        <p class="muted">${esc(describeFilters(S.f))}${when ? ` · as of ${dateDaysAgo(when)}` : ''}${live ? ` · <span class="live-src">Live listings</span>` : ''}</p>
        ${liveNotes.map((n) => `<p class="live-note">${n}</p>`).join('')}
      </div>`;
    if (!results.length) {
      return head + `<div class="empty card"><h3>No cars match all of those filters.</h3><p class="muted">Remove a filter above, widen the radius, or <button class="link-btn" data-action="reset">start over</button>.</p></div>`;
    }
    const stats = `<dl class="stats-strip">
      <div><dt>${sold ? 'Median sold price' : 'Median price'}</dt><dd>${money(sum.medianPrice)}</dd></div>
      <div><dt>Price range</dt><dd>${money(sum.minPrice)}–${money(sum.maxPrice)}</dd></div>
      <div><dt>Median miles</dt><dd>${kMiles(sum.medianMiles)}</dd></div>
      <div><dt>${sold ? 'Avg. days to sell' : 'Avg. days listed'}</dt><dd>${sum.avgDays != null ? Math.round(sum.avgDays) : '—'}</dd></div>
      <div><dt>${live ? 'Showing' : 'Price cuts'}</dt><dd>${live ? `${num(results.length)} of ${num(sum.count)}` : num(sum.withDrops)}</dd></div>
    </dl>`;

    // Chart: plot up to 600 matches; color by market position.
    const sample = results.length > 600 ? results.filter((_, i) => i % Math.ceil(results.length / 600) === 0) : results;
    const scatter = Charts.scatter({
      series: [{ points: sample.map((l) => ({ x: l.miles, y: l.price, id: l.id, cls: sold ? 'mk-sold' : 'mk-' + (marketText(l) || { tone: 'fair' }).tone, label: `${title(l)} ${l.trim} · ${money(l.price)} · ${kMiles(l.miles)}` })), cls: 'res' }],
      xLabel: 'Miles', aria: 'Matching cars plotted by price and mileage', height: 260, r: 3.6,
    });
    const byState = Market.groupBy(results, (l) => l.state);
    const liveStates = live ? new Map((S.facets.state || []).map((x) => [x.value, x.count])) : null;
    const tiles = Charts.geoMap((st) => {
      const g = byState.get(st);
      const n = live ? liveStates.get(st) || 0 : g ? g.length : 0;
      if (!n) return S.f.state.includes(st) ? { cls: 'cnt-0', value: 0, selected: true, title: st } : null;
      const hi = live ? Math.max(1, ...liveStates.values()) : 60;
      const cls = n >= hi * (live ? 0.5 : 1) ? 'cnt-4' : n >= hi * (live ? 0.2 : 25 / 60) ? 'cnt-3' : n >= hi * (live ? 0.07 : 10 / 60) ? 'cnt-2' : 'cnt-1';
      return { cls, value: n >= 10000 ? Math.round(n / 1000) + 'k' : n, title: `${st}: ${plural(n, 'car')}${g && !live ? `, median ${money(Market.median(g.map((l) => l.price)))}` : ''}`, selected: S.f.state.includes(st) };
    }, { clickable: true, aria: 'Matching cars by state' });

    let trendCard;
    if (!live) {
      const inv = Market.inventorySeries(LISTINGS, SOLD, Object.assign({}, S.f, { when: '0' }), CTX, 90);
      trendCard = `<div class="card viz trend-card"><div class="viz-head"><h3>Inventory over time</h3>
          <span class="muted small">${num(inv.sold30)} sold in 30 days · ${num(inv.sold90)} in 90</span></div>
        ${Charts.trend(inv.series, { width: 1100, height: 200, aria: 'Matching cars for sale over the last 90 days' })}
        <div class="legend"><span><i class="key inv"></i>For sale</span><span><i class="key med"></i>Median price</span><span class="muted">Hover for any day · use the “for sale today” menu to rewind</span></div></div>`;
    } else if (!can('trend')) {
      trendCard = '';
    } else if (S.liveTrend) {
      trendCard = `<div class="card viz trend-card"><div class="viz-head"><h3>Inventory over time</h3><span class="muted small">${num(S.liveTrend.sold30)} sold in the last 30 days</span></div>
        ${Charts.trend(S.liveTrend.series, { width: 1100, height: 200, aria: 'Matching cars for sale over the last 90 days' })}
        <div class="legend"><span><i class="key inv"></i>For sale</span><span><i class="key med"></i>Median price</span></div></div>`;
    } else {
      trendCard = `<div class="card viz trend-card trend-cta"><div><h3>Inventory over time</h3><p class="muted small">See how many of these cars were for sale over the last 90 days and how many sold. Uses 9 requests (about 3¢).</p></div>
        <button class="btn" type="button" data-action="live-trend">Load 90-day trend</button></div>`;
    }

    let list;
    if (S.layout === 'table') list = tableHtml(results.slice(0, S.shown));
    else if (S.layout === 'map') list = mapHtml(results);
    else list = `<div class="listing-grid${prefs().compact ? ' compact' : ''}">${results.slice(0, S.shown).map((l) => listingCard(l)).join('')}</div>`;
    const more = live
      ? (S.layout !== 'map' && S.liveNext != null ? `<div class="more"><button class="btn" type="button" data-action="live-more">Load ${Live.PAGE} more <span class="muted">(${num(results.length)} of ${num(S.total)} shown)</span></button></div>` : '')
      : (S.layout !== 'map' && results.length > S.shown ? `<div class="more"><button class="btn" type="button" data-action="more-results">Show ${Math.min(PAGE, results.length - S.shown)} more <span class="muted">(${num(results.length - S.shown)} left)</span></button></div>` : '');

    return head + overviewHtml() + stats + `
      <div class="viz-row">
        <div class="card viz"><div class="viz-head"><h3>Price vs. miles</h3>${sold ? '<span class="muted small">Sold prices</span>' : '<div class="legend"><span><i class="key d-great"></i>Below</span><span><i class="key d-fair"></i>At</span><span><i class="key d-over"></i>Above market</span></div>'}</div>
          <div class="scatter-wrap">${scatter}</div><p class="muted small">Click a dot to open that car${live ? ` · ${num(results.length)} loaded of ${num(S.total)}` : results.length > 600 ? ` · showing ${sample.length} of ${num(results.length)}` : ''}.</p></div>
        <div class="card viz"><div class="viz-head"><h3>Where they are</h3><span class="muted small">Click a state to filter</span></div>${tiles}</div>
      </div>
      ${trendCard}
      ${list}${more}`;
  }

  async function fillLiveOverview() {
    const seq = liveSeq;
    const base = Object.assign({}, S.f, { when: '0', trim: [], year: [] });
    try {
      const [v, years] = await Promise.all([
        Live.velocity(base, liveCtx()),
        Live.request('/v1/facets', Object.assign(Live.toParams(base, liveCtx()), { facets: 'year', facet_value_limit: 15, metrics: 'price.median' })),
      ]);
      if (seq !== liveSeq || !document.getElementById('live-kpis')) return;
      document.getElementById('live-kpis').innerHTML = `<div><dt>For sale</dt><dd>${num(v.active)}</dd></div><div><dt>Sold, 30 days</dt><dd>${num(v.sold30)}</dd></div>
        <div><dt>Median days to sell</dt><dd>${v.medianDaysToSell != null ? Math.round(v.medianDaysToSell) : '—'}</dd></div><div><dt>Days of supply</dt><dd>${v.daysOfSupply ? Math.round(v.daysOfSupply) : '—'}</dd></div>`;
      const ys = Live.bucketsOf(years.data && years.data.facets && years.data.facets.year)
        .map((b) => ({ y: Number(b.value), n: b.count, med: b.metrics ? b.metrics['price.median'] : null })).filter((x) => x.med).sort((a, b) => a.y - b.y);
      document.getElementById('live-years').innerHTML = ys.length ? Charts.columns(ys.map((x) => ({ label: String(x.y).slice(2).padStart(3, "'"), value: x.med, display: '$' + Math.round(x.med / 1000) + 'k', title: `${x.y}: ${plural(x.n, 'car')}, median ${money(x.med)}` })), { aria: 'Median price by model year' }) : 'Not enough data.';
    } catch (e) {
      const el = document.getElementById('live-years');
      if (el) el.textContent = e.message;
    }
  }

  function mapHtml(results) {
    const groups = [...Market.groupBy(results, (l) => `${l.city}, ${l.state}`).entries()].map(([city, g]) => {
      const meds = g.map(delta);
      const d = Market.median(meds);
      return {
        city, lat: g[0].lat, lng: g[0].lng, count: g.length, cls: S.f.when === 'sold' ? 'mp-sold' : deltaClass(d),
        title: `${city}: ${plural(g.length, 'car')}, median ${money(Market.median(g.map((l) => l.price)))}`,
      };
    });
    const c = S.f.near ? placeOf(S.f.near) : null;
    return `<div class="card map-card"><div class="viz-head"><h3>Map</h3><span class="muted small">Circle size is the number of cars; color is the median price vs. market. Click a city to search around it.</span></div>
      ${Charts.usMap(groups, { center: c ? [c[2], c[3]] : null, radius: S.f.near ? S.f.radius : null, aria: 'Map of matching cars by city' })}
      <div class="legend"><span><i class="key d-great"></i>Below market</span><span><i class="key d-fair"></i>At market</span><span><i class="key d-over"></i>Above market</span></div></div>
      <div class="listing-grid compact">${results.slice(0, 12).map((l) => listingCard(l)).join('')}</div>`;
  }

  function tableHtml(rows) {
    const sold = S.f.when === 'sold';
    return `<div class="table-wrap card"><table class="results-table">
      <thead><tr><th>Car</th><th class="num">${sold ? 'Sold for' : 'Price'}</th><th>${sold ? 'Sold' : 'vs. market'}</th><th class="num">MSRP</th><th class="num">Miles</th><th>Color</th><th>${prefs().showDealer ? 'Seller' : 'Location'}</th><th class="num">Days</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((l) => `<tr>
        <td><a href="#/car/${l.id}"><b>${esc(title(l))}</b> <span class="muted">${esc(l.trim)}</span></a><div class="small">${conditionBadge(l)}${l.status && l.status !== 'On lot' && !l.sold ? ' ' + badge(l.status, 'b-status') : ''} ${upfitBadge(l)}</div></td>
        <td class="num"><b>${money(l.price)}</b></td><td>${sold ? ago(l.sold.daysAgo) : deltaChip(l)}</td><td class="num">${money(l.msrp)}</td><td class="num">${num(l.miles)}</td>
        <td><span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span></td>
        <td>${esc(whereText(l))}</td><td class="num">${sold ? l.sold.daysToSell : l.daysListed}</td>
        <td>${compareButton(l)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ----- Listing detail ----- */

  let C = null; // car view state

  const COMPARE_DEFAULTS = { trim: 'any', years: 1, condition: 'same', radius: null, msrpBand: null, rankBy: 'value', includeSold: false, msrpAdjusted: false };

  function renderCar(id, params) {
    const base = BY_ID.get(id);
    if (!base) {
      if (isLive()) return loadLiveCar(id);
      return renderNotFound('That listing is no longer available.');
    }
    const asOf = Number(params.get('asOf')) || 0;
    const l = asOf ? (datasetFor({ when: String(asOf) }).find((x) => x.id === id) || base) : base;
    renderCarView(l, { asOf });
  }

  async function loadLiveCar(id) {
    setView('car', `<section class="narrow">${loadingHtml('Loading listing…')}</section>`);
    try {
      const l = await Live.listing(id);
      const comps = await Live.comparables(l, liveCtx(), { years: 1, condition: 'same' });
      const fv = Live.fairValueFrom(comps.concat([l]), CURRENT_YEAR);
      for (const x of comps.concat([l])) setLiveValue(fv, x);
      rememberLive(l);
      if (location.hash.replace(/\?.*/, '') !== `#/car/${id}`) return;
      renderCarView(l, { live: true, comps });
    } catch (e) {
      setView('car', `<section class="narrow">${liveErrorHtml(e)}</section>`);
    }
  }

  function renderCarView(l, o) {
    const id = l.id;
    const asOf = (o && o.asOf) || 0;
    const live = !!l.live;
    store.update((s) => { s.recent = [id, ...s.recent.filter((x) => x !== id)].slice(0, 12); });
    C = { l, live, comps: (o && o.comps) || null, soldComps: null, opts: Object.assign({}, COMPARE_DEFAULTS) };
    const m = marketText(l);
    const r = live ? null : rarity(l);
    const cut = Market.lastChange(l);
    const firstPrice = l.history[0].price;
    const dec = VIN.decode(l.vin);
    const gaugePos = m ? Math.max(0, Math.min(100, 50 + (m.d / 0.15) * 50)) : 50;
    const key = `${l.make} ${l.model}`;
    const v = live ? null : velocityFor((x) => `${x.make} ${x.model}` === key && Math.abs(x.year - l.year) <= 1);
    const similar = (live ? C.comps.filter((x) => !x.sold) : Market.comparables(l, LISTINGS, { years: 1 }))
      .filter((x) => x.condition !== 'New' || l.condition === 'New')
      .sort((a, b) => Math.abs(a.miles - l.miles) / 10000 + Math.abs(a.year - l.year) + delta(a) * 10 - (Math.abs(b.miles - l.miles) / 10000 + Math.abs(b.year - l.year) + delta(b) * 10)).slice(0, 6);
    const photos = (l.photos || []).filter(Boolean);

    const soldBanner = l.sold ? `<div class="banner sold-banner">Sold ${ago(l.sold.daysAgo)} for <b>${money(l.sold.price)}</b> after ${plural(l.sold.daysToSell, 'day')} on the market${l.history.length > 1 ? `, ${money(firstPrice - l.sold.price)} below its first asking price` : ''}.</div>` : '';
    const asOfBanner = asOf ? `<div class="banner">Viewing this listing as of ${dateDaysAgo(asOf)} (${asOf} days ago). <a href="#/car/${id}">See it today →</a></div>` : '';

    setView('car', `
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/search">Search</a><span>›</span><a href="${searchHref({ model: key })}">${esc(key)}</a><span>›</span><span aria-current="page">${l.year} ${esc(l.trim)}</span></nav>
      <div class="banners">${soldBanner}${asOfBanner}</div>
      <section class="car-hero">
        ${photos.length ? `<div class="car-gallery"><img class="gallery-main" id="gallery-main" src="${esc(photos[0])}" alt="${esc(title(l))}" referrerpolicy="no-referrer" onerror="this.closest('.car-gallery').classList.add('no-photo')">
          ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.slice(0, 12).map((src, i) => `<button type="button" class="thumb${i === 0 ? ' on' : ''}" data-action="photo" data-src="${esc(src)}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></button>`).join('')}</div>` : ''}
          <div class="stage-note">Photos from the dealer · ${esc(l.extColor)} · ${esc(l.intColor)} interior</div></div>`
        : `<div class="car-stage" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex, { cls: 'big', label: `${l.extColor} ${title(l)}` })}
          <div class="stage-note">Illustration in ${esc(l.extColor)} · ${esc(l.intColor)} interior</div></div>`}
        <div class="car-summary">
          <div class="badges">${conditionBadge(l)}${l.sold ? badge('Sold', 'b-sold') : ''}${l.status && !l.sold ? badge(l.status, 'b-status') : ''}${l.seller === 'Private' ? badge('Private seller', 'b-private') : ''}${upfitBadge(l)}${r && r.extCount <= 3 ? badge(`💎 1 of ${r.extCount} in this color`, 'b-rare') : ''}${l.windowStickerVerified ? badge('✓ Window sticker verified', 'b-verified') : ''}${live ? badge('Live', 'b-live') : ''}</div>
          <h1>${esc(title(l))} <span>${esc(l.trim)}</span></h1>
          <p class="muted">${miles(l.miles)} · ${esc(l.drivetrain)}${l.transmission ? ` · ${esc(l.transmission)}` : ''} · ${esc(l.fuel)} · ${esc(l.city)}, ${esc(l.state)}${distanceTo(l) != null ? ` · ${num(distanceTo(l))} mi from home` : ''}</p>
          <div class="big-price">${money(l.price)}${cut && cut.delta < 0 ? `<s>${money(firstPrice)}</s>` : ''}</div>
          ${m ? `<div class="gauge" aria-label="Price position versus market">
              <div class="gauge-bar"><span class="gauge-mark" style="left:${gaugePos}%"></span></div>
              <div class="gauge-scale"><span>15% below</span><span>Market</span><span>15% above</span></div>
              <p><b class="t-${m.tone}">${esc(m.label)}</b> expected ${money(m.expected)} for a ${l.year} ${esc(l.model)} ${esc(l.trim)} ${l.condition === 'New' ? 'at MSRP with these options' : `with ${kMiles(l.miles)}`}${l.upfitter ? ` and its ${esc(l.upfitter.name)} upfit` : ''}.</p>
              ${specBreakdownHtml(l)}
            </div>` : ''}
          <div class="actions">${favButton(l)}${compareButton(l)}${l.vdpUrl ? `<a class="btn primary" href="${esc(l.vdpUrl)}" target="_blank" rel="noopener noreferrer">View listing ↗</a>` : ''}<button class="btn ghost" type="button" data-action="share" data-id="${l.id}">Copy link</button>
            <button class="btn ghost" type="button" data-action="doc" data-doc="sticker">📄 Window sticker</button><button class="btn ghost" type="button" data-action="doc" data-doc="build">🧾 Build sheet</button></div>
        </div>
      </section>

      <div class="car-grid">
        <div class="col">
          <section class="card">
            <h2>Price history</h2>
            <p class="muted">${esc(l.sold ? `Listed ${l.daysListed} days ago, sold ${ago(l.sold.daysAgo)}` : days(l.daysListed))}${l.history.length > 1 ? ` · ${plural(l.history.length - 1, 'price cut')} · ${money(firstPrice - l.price)} total` : ' · no price changes'}</p>
            ${Charts.priceHistory(l.history.length > 1 ? l.history : [{ daysAgo: Math.max(1, l.daysListed), price: l.price }, { daysAgo: l.sold ? l.sold.daysAgo : 0, price: l.price }])}
            <ol class="timeline">${l.sold ? `<li><span>${esc(ago(l.sold.daysAgo))}</span><b>${money(l.sold.price)}</b><span class="muted">Sold</span></li>` : ''}${[...l.history].reverse().map((h, i, arr) => {
              const prev = arr[i + 1];
              return `<li><span>${h.daysAgo === 0 ? 'Today' : h.daysAgo + ' days ago'}</span><b>${money(h.price)}</b>${prev ? `<span class="drop">↓ ${money(prev.price - h.price)}</span>` : '<span class="muted">Listed</span>'}</li>`;
            }).join('')}</ol>
          </section>

          <section class="card" id="market-compare">
            <div class="mc-head"><h2>Against the market</h2><p class="muted">Pick which cars count as this one’s peers. The leaderboard and chart both follow.</p></div>
            <div class="mc-controls" id="mc-controls">
              <label><span>Trim</span><select data-copt="trim"><option value="any">Any trim</option><option value="same">${esc(l.trim)} only</option></select></label>
              <label><span>Years</span><select data-copt="years"><option value="0">${l.year} only</option><option value="1" selected>±1 year</option><option value="2">±2 years</option></select></label>
              <label><span>Condition</span><select data-copt="condition"><option value="same" selected>${l.condition === 'New' ? 'New only' : 'Used & certified'}</option><option value="any">Any</option></select></label>
              <label><span>Distance</span><select data-copt="radius"><option value="">Nationwide</option><option value="250">Within 250 mi</option><option value="500">Within 500 mi</option><option value="1000">Within 1,000 mi</option></select></label>
              ${can('msrp') ? `<label><span>MSRP match</span><select data-copt="msrpBand"><option value="">Any MSRP</option><option value="0.05">Within 5%</option><option value="0.1">Within 10%</option></select></label>` : ''}
              <label><span>Rank by</span><select data-copt="rankBy"><option value="value">Price vs. market</option><option value="price">Price</option><option value="miles">Mileage</option><option value="days">Newest listing</option>${can('msrp') ? '<option value="discount">Discount from MSRP</option>' : ''}</select></label>
              ${can('sold') ? `<label class="check"><input type="checkbox" data-copt="includeSold"> Show sold cars on chart${live ? ' <span class="muted">(1 request)</span>' : ''}</label>` : ''}
              ${can('msrp') ? '<label class="check"><input type="checkbox" data-copt="msrpAdjusted"> Plot as % of MSRP</label>' : ''}
            </div>
            <div id="mc-body"></div>
          </section>

          <section>
            <h2 class="sec-title">Similar cars for sale</h2>
            <div class="listing-grid compact">${similar.map((x) => listingCard(x)).join('')}</div>
          </section>
        </div>
        <aside class="col side">
          ${pricingHtml(l)}
          ${dealCheckHtml(l)}
          ${l.accidents != null || l.ownerCount != null ? `<section class="card"><h2>History</h2><dl class="spec">
            ${l.accidents != null ? `<div><dt>Accidents reported</dt><dd class="${l.accidents ? 'bad' : 'good'}">${l.accidents ? (l.accidentCount ? plural(l.accidentCount, 'accident') : 'Yes') : 'None reported'}</dd></div>` : ''}
            ${l.ownerCount != null ? `<div><dt>Owners</dt><dd>${num(l.ownerCount)}${l.oneOwner ? ' <span class="good">· one owner</span>' : ''}</dd></div>` : ''}
            ${l.usageType ? `<div><dt>Use</dt><dd>${esc(l.usageType)}</dd></div>` : ''}</dl>
            ${l.vhrUrl ? `<a class="link-btn" href="${esc(l.vhrUrl)}" target="_blank" rel="noopener noreferrer">Full history report ↗</a>` : ''}</section>` : ''}
          <section class="card" id="recalls"><h2>Recalls & complaints</h2><div id="recalls-body" class="muted small">Checking NHTSA…</div></section>
          ${live && !can('velocity') ? '' : `<section class="card">
            <h2>Market velocity</h2>
            <p class="muted small">${l.year - 1}–${l.year + 1} ${esc(key)}, nationwide</p>
            ${live ? '<div id="live-velocity" class="muted small">Loading…</div>' : `<dl class="spec">
              <div><dt>For sale now</dt><dd>${num(v.active)}</dd></div>
              <div><dt>Sold, last 30 days</dt><dd>${num(v.sold30)}</dd></div>
              <div><dt>Median days to sell</dt><dd>${v.medianDaysToSell != null ? Math.round(v.medianDaysToSell) + ' days' : '—'}</dd></div>
              <div><dt>Days of supply</dt><dd>${v.daysOfSupply ? Math.round(v.daysOfSupply) + ' days' : '—'}</dd></div>
              <div><dt>Sold vs. first ask</dt><dd>${v.saleToList ? pct(v.saleToList, 1) : '—'}</dd></div>
            </dl>
            ${!l.sold && v.medianDaysToSell ? `<p class="muted small">This car has been listed ${plural(l.daysListed, 'day')}${l.daysListed > v.medianDaysToSell * 1.5 ? ' — well past the typical time to sell, which can mean room to negotiate.' : '.'}</p>` : ''}`}
          </section>`}
          <section class="card">
            <h2>Top features</h2>
            ${l.features.length ? `<ul class="feature-chips">${l.features.map((x) => `<li><a href="${searchHref({ model: key, features: x })}">${esc(live ? Live.titleCase(x) : x)}</a></li>`).join('')}</ul>` : '<p class="muted">None listed.</p>'}
          </section>
          <section class="card">
            <h2>Details</h2>
            <dl class="spec">
              <div><dt>VIN</dt><dd class="mono">${esc(l.vin)} <button class="link-btn" data-action="copy" data-text="${esc(l.vin)}">Copy</button></dd></div>
              <div><dt>Mileage</dt><dd>${miles(l.miles)}</dd></div>
              <div><dt>Body</dt><dd>${esc(live ? l.bodyLabel || l.body : `${l.body} · ${l.segment}`)}</dd></div>
              <div><dt>Drivetrain</dt><dd>${esc(l.drivetrain)}</dd></div>
              <div><dt>Fuel</dt><dd>${esc(l.fuel)}</dd></div>
              ${l.series ? `<div><dt>Version</dt><dd>${esc(l.series)}</dd></div>` : ''}
              ${l.engine ? `<div><dt>Engine</dt><dd>${esc(l.engine)}</dd></div>` : ''}
              ${l.transmission ? `<div><dt>Transmission</dt><dd>${live ? esc(l.transmission) : `<a href="${searchHref({ model: key, transmission: l.transmission })}">${esc(l.transmission)}</a>`}</dd></div>` : ''}
              <div><dt>Exterior</dt><dd><span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span>${r ? ` <span class="muted">1 of ${r.extCount} of ${r.total}</span>` : ''}</dd></div>
              <div><dt>Interior</dt><dd>${esc(l.intColor)}${r ? ` <span class="muted">1 of ${r.intCount}</span>` : ''}</dd></div>
              ${l.titleStatus ? `<div><dt>Title</dt><dd class="${l.titleStatus === 'clean' ? 'good' : l.titleStatus === 'unknown' ? '' : 'bad'}">${esc(Live.titleCase(l.titleStatus))}</dd></div>` : ''}
              ${l.certification && l.certification.program ? `<div><dt>Certified program</dt><dd>${esc(l.certification.program.name)}</dd></div>` : ''}
              ${l.assembly.plant && l.assembly.plant !== 'Unknown' ? `<div><dt>Assembled in</dt><dd><a href="${searchHref({ model: key, assembly: l.assembly.plant })}">${esc(l.assembly.plant)}</a> <span class="muted">${esc(l.assembly.country)}</span></dd></div>` : ''}
              ${l.upfitter ? `<div><dt>Upfitter</dt><dd>${esc(l.upfitter.name)} <span class="muted">${esc(l.upfitter.category)}</span></dd></div>` : ''}
              <div><dt>Original MSRP</dt><dd>${money(l.msrp)}</dd></div>
            </dl>
          </section>
          <section class="card">
            <h2>Installed options <span class="muted">${money(l.options.reduce((sum, x) => sum + (x.price || 0), 0))}</span></h2>
            ${l.options.length ? `<ul class="opts">${l.options.map((x) => `<li><a href="${searchHref({ model: key, options: x.code || x.name })}">${esc(x.name)}${x.code && x.code !== x.name ? ` <span class="muted mono small">${esc(x.code)}</span>` : ''}</a><span class="muted">${x.price ? money(x.price) : ''}</span></li>`).join('')}</ul>
              ${r ? `<p class="muted small">${r.optionsVsAvg >= 0 ? pct(r.optionsVsAvg) + ' more' : pct(-r.optionsVsAvg) + ' less'} than the average ${esc(l.model)} for sale. Click an option to find others with it.</p>` : '<p class="muted small">Click an option to find others with it.</p>'}` : '<p class="muted">No factory options listed.</p>'}
          </section>
          <section class="card">
            <h2>Seller</h2>
            <p><b>${esc(l.dealer)}</b><br><span class="muted">${l.seller === 'Private' ? 'Private party' : l.franchise ? 'Franchise dealer' : 'Independent dealer'} · ${esc(l.city)}, ${esc(l.state)}</span>${l.dealerPhone ? `<br><a href="tel:${esc(l.dealerPhone)}">${esc(l.dealerPhone)}</a>` : ''}</p>
            ${l.vdpUrl ? `<a class="btn primary block" href="${esc(l.vdpUrl)}" target="_blank" rel="noopener noreferrer">View the full listing ↗</a>` : ''}
            ${l.vhrUrl ? `<a class="btn ghost block" href="${esc(l.vhrUrl)}" target="_blank" rel="noopener noreferrer">Vehicle history report ↗</a>` : ''}
            ${l.seller === 'Dealer' && !live ? `<a class="btn ghost block" href="${searchHref({ q: l.dealer, state: l.state })}">More from this dealer</a>` : ''}
            <p class="muted small">We never pass your details to a seller. Contact them directly when you’re ready.</p>
          </section>
          ${live ? '' : `<section class="card">
            <h2>Seller history</h2>
            <p class="muted small">Every time this VIN has been listed for sale.</p>
            <ol class="seller-history">
              <li class="${l.sold ? '' : 'current'}"><b>${esc(l.dealer)}</b><span class="muted">${esc(l.city)}, ${esc(l.state)} · ${l.sold ? `${ago(l.daysListed)} → sold ${ago(l.sold.daysAgo)}` : `since ${ago(l.daysListed)}`}</span><span>${money(l.history[0].price)} → ${money(l.price)} · ${kMiles(l.miles)}</span></li>
              ${l.previous.map((p) => `<li><b>${esc(p.dealer)}</b><span class="muted">${esc(p.city)}, ${esc(p.state)} · ${p.startedDaysAgo} → ${p.endedDaysAgo} days ago</span><span>Last asked ${money(p.lastPrice)} · ${kMiles(p.miles)}</span></li>`).join('')}
            </ol>
            ${l.previous.length ? `<p class="muted small">Listed ${plural(l.previous.length, 'time')} before by other sellers. A car that changes hands between dealers is often an auction flip — worth asking about.</p>` : '<p class="muted small">No earlier listings found for this VIN.</p>'}
          </section>`}
          <section class="card">
            <h2>VIN decode</h2>
            <dl class="spec">
              <div><dt>Check digit</dt><dd>${dec.valid ? '<span class="good">✓ Valid</span>' : '<span class="bad">✕ Invalid</span>'}</dd></div>
              <div><dt>Manufacturer</dt><dd>${esc(dec.make || 'Unknown')}</dd></div>
              <div><dt>Built in</dt><dd>${esc(dec.country || dec.region || 'Unknown')}</dd></div>
              <div><dt>Model year</dt><dd>${dec.year || '—'}</dd></div>
              <div><dt>Plant code</dt><dd class="mono">${esc(dec.plant || '')}</dd></div>
              <div><dt>Serial</dt><dd class="mono">${esc(dec.serial || '')}</dd></div>
            </dl>
            <a class="link-btn" href="${searchHref({ vin: l.vin.slice(0, 8) + '?' + l.vin.slice(9, 11) })}">Find cars from the same line and plant →</a>
          </section>
        </aside>
      </div>`);
    bindDealCheck(l);
    renderMarketCompare();
    if (live && can('velocity')) fillLiveVelocity(l);
    if (live && can('photosApi') && l.photoCount > 1 && (l.photos || []).length < 2) fillLivePhotos(l);
    fillRecalls(l);
    window.scrollTo(0, 0);
  }

  async function fillLivePhotos(l) {
    try {
      const photos = await Live.photos(l.vin);
      if (C.l !== l || photos.length < 2) return;
      l.photos = photos;
      const gal = document.querySelector('.car-gallery');
      if (!gal) return;
      gal.querySelector('.gallery-thumbs')?.remove();
      gal.querySelector('.stage-note').insertAdjacentHTML('beforebegin', `<div class="gallery-thumbs">${photos.slice(0, 16).map((src, i) => `<button type="button" class="thumb${i === 0 ? ' on' : ''}" data-action="photo" data-src="${esc(src)}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></button>`).join('')}</div>`);
    } catch (e) { /* the primary photo is enough */ }
  }

  // Recalls and owner complaints from NHTSA: free, public, and allowed from any site.
  const nhtsaCache = new Map();
  function nhtsa(kind, l) {
    const model = l.model.replace(/ 1500$/, '');
    const url = `https://api.nhtsa.gov/${kind}/${kind === 'recalls' ? 'recallsByVehicle' : 'complaintsByVehicle'}?make=${encodeURIComponent(l.make)}&model=${encodeURIComponent(model)}&modelYear=${l.year}`;
    if (!nhtsaCache.has(url)) nhtsaCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : { results: [] })).catch(() => null));
    return nhtsaCache.get(url);
  }
  async function fillRecalls(l) {
    const [rec, comp] = await Promise.all([nhtsa('recalls', l), nhtsa('complaints', l)]);
    const el = document.getElementById('recalls-body');
    if (!el || C.l !== l) return;
    if (!rec && !comp) { el.textContent = 'Couldn’t reach NHTSA right now.'; return; }
    const recalls = (rec && (rec.results || [])) || [];
    const complaints = (comp && (comp.results || [])) || [];
    const byComp = new Map();
    for (const c of complaints) for (const part of String(c.components || 'Other').split(',')) byComp.set(part.trim(), (byComp.get(part.trim()) || 0) + 1);
    const topComp = [...byComp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    el.classList.remove('muted', 'small');
    el.innerHTML = `<p class="small"><b>${plural(recalls.length, 'recall')}</b> and <b>${plural(complaints.length, 'owner complaint')}</b> on file for the ${l.year} ${esc(l.make)} ${esc(l.model)}.</p>
      ${recalls.length ? `<ul class="recall-list">${recalls.slice(0, 5).map((r) => `<li><b>${esc(Live.titleCase(String(r.Component || '').toLowerCase()))}</b><span class="muted small">${esc(r.ReportReceivedDate || '')} · ${esc(r.NHTSACampaignNumber || '')}${r.parkIt ? ' · <span class="bad">Do not drive</span>' : ''}</span><p class="small">${esc(String(r.Summary || '').slice(0, 220))}${String(r.Summary || '').length > 220 ? '…' : ''}</p></li>`).join('')}</ul>` : ''}
      ${topComp.length ? `<p class="muted small">Most complaints: ${topComp.map(([k, n]) => `${esc(Live.titleCase(k.toLowerCase()))} (${n})`).join(', ')}.</p>` : ''}
      <p class="small">${l.live ? `<a href="https://www.nhtsa.gov/recalls?vin=${esc(l.vin)}" target="_blank" rel="noopener">Check open recalls for this exact VIN at NHTSA ↗</a>` : `Model-year data from <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener">NHTSA</a>.`}</p>`;
  }

  async function fillLiveVelocity(l) {
    const years = [l.year - 1, l.year, l.year + 1].map(String);
    try {
      const v = await Live.velocity({ make: [l.make], model: [l.model], year: years, ex: {} }, liveCtx());
      const el = document.getElementById('live-velocity');
      if (!el || C.l !== l) return;
      el.outerHTML = `<dl class="spec">
        <div><dt>For sale now</dt><dd>${num(v.active)}</dd></div>
        <div><dt>Sold, last 30 days</dt><dd>${num(v.sold30)}</dd></div>
        <div><dt>Median days to sell</dt><dd>${v.medianDaysToSell != null ? Math.round(v.medianDaysToSell) + ' days' : '—'}</dd></div>
        <div><dt>Days of supply</dt><dd>${v.daysOfSupply ? Math.round(v.daysOfSupply) + ' days' : '—'}</dd></div></dl>
        ${!l.sold && v.medianDaysToSell ? `<p class="muted small">This car has been listed ${plural(l.daysListed, 'day')}${l.daysListed > v.medianDaysToSell * 1.5 ? ' — well past the typical time to sell, which can mean room to negotiate.' : '.'}</p>` : ''}`;
    } catch (e) {
      const el = document.getElementById('live-velocity');
      if (el) el.textContent = e.message;
    }
  }

  async function renderMarketCompare() {
    const { l, opts } = C;
    const compOpts = { trim: opts.trim, years: Number(opts.years), condition: opts.condition, radius: opts.radius ? Number(opts.radius) : null, msrpBand: opts.msrpBand ? Number(opts.msrpBand) : null };
    let comps, soldComps;
    if (C.live) {
      const body = document.getElementById('mc-body');
      const scopeKey = JSON.stringify([compOpts.trim, compOpts.years, compOpts.condition, compOpts.radius]);
      try {
        if (C.scopeKey !== scopeKey) {
          if (C.scopeKey !== undefined) body.innerHTML = loadingHtml('Loading comparable listings…');
          if (C.scopeKey !== undefined || !C.comps) C.comps = await Live.comparables(l, liveCtx(), compOpts);
          C.scopeKey = scopeKey;
          C.soldComps = null;
        }
        if (opts.includeSold && !C.soldComps) C.soldComps = await Live.comparables(l, liveCtx(), Object.assign({}, compOpts, { sold: true }));
      } catch (e) {
        body.innerHTML = liveErrorHtml(e);
        return;
      }
      if (C.l !== l) return;
      const fv = Live.fairValueFrom(C.comps.concat([l]), CURRENT_YEAR);
      for (const x of C.comps) setLiveValue(fv, x);
      const band = (x) => !compOpts.msrpBand || !x.msrp || !l.msrp || Math.abs(x.msrp / l.msrp - 1) <= compOpts.msrpBand;
      comps = C.comps.filter(band);
      soldComps = opts.includeSold ? (C.soldComps || []).filter(band) : [];
      for (const x of comps.concat(soldComps)) LIVE_SEEN.set(x.id, x);
    } else {
      comps = Market.comparables(l, LISTINGS, compOpts);
      soldComps = opts.includeSold ? Market.comparables(l, SOLD, compOpts) : [];
    }
    const lb = Market.leaderboard(l, comps, opts.rankBy, delta);
    const rankLabel = { value: 'price vs. market', price: 'lowest price', miles: 'lowest miles', days: 'newest listing', discount: 'discount from MSRP' }[opts.rankBy];
    const statOf = (x) => ({
      value: deltaChip(x), price: money(x.price), miles: kMiles(x.miles), days: days(x.daysListed), discount: x.msrp ? `-${pct(Market.discountOf(x))}` : '—',
    }[opts.rankBy]);
    const top = lb.rows.slice(0, 10);
    const rows = top.includes(l) ? top : [...top, null, l];
    const y = (x) => (opts.msrpAdjusted ? (x.price / x.msrp) * 100 : x.price);
    const plotable = (x) => x.price && (!opts.msrpAdjusted || x.msrp);
    soldComps = soldComps.filter(plotable);
    const chart = Charts.scatter({
      series: [
        { points: soldComps.map((x) => ({ x: x.miles, y: y(x), id: x.id, label: `Sold: ${title(x)} ${x.trim} · ${money(x.price)}` })), cls: 'comp sold' },
        { points: comps.filter(plotable).map((x) => ({ x: x.miles, y: y(x), id: x.id, label: `${title(x)} ${x.trim} · ${money(x.price)}` })), cls: 'comp' },
        { points: plotable(l) ? [{ x: l.miles, y: y(l), r: 7, label: 'This car' }] : [], cls: 'self' },
      ], xLabel: 'Miles', yFmt: opts.msrpAdjusted ? (v) => Math.round(v) + '%' : undefined,
      aria: 'This car compared with similar listings',
    });
    document.getElementById('mc-body').innerHTML = `
      <div class="mc-grid">
        <div class="leaderboard">
          <p class="lb-rank"><b>#${lb.rank}</b> of ${num(lb.total)} by ${rankLabel}</p>
          <ol class="lb-list">${rows.map((x, i) => x === null ? '<li class="gap">…</li>' : `<li class="${x === l ? 'me' : ''}">
            <span class="lb-pos">${lb.rows.indexOf(x) + 1}</span>
            <a href="#/car/${x.id}"><b>${x.year} ${esc(x.trim)}</b><small>${kMiles(x.miles)} · ${esc(x.city)}, ${esc(x.state)}</small></a>
            <span class="lb-stat">${x === l ? '<b>This car</b>' : ''}<span>${money(x.price)}</span>${opts.rankBy !== 'price' ? `<small>${statOf(x)}</small>` : ''}</span></li>`).join('')}</ol>
        </div>
        <div class="mc-chart" data-action-zone="scatter">${chart}
          <div class="legend"><span><i class="key self"></i>This car</span><span><i class="key comp"></i>For sale (${num(comps.length)})</span>${opts.includeSold ? `<span><i class="key sold"></i>Sold (${num(soldComps.length)})</span>` : ''}</div>
        </div>
      </div>`;
  }

  function livePricingHtml(l) {
    const p = l.livePricing;
    const taxRate = stateTax(l.state);
    const items = p && p.line_items ? [...p.line_items].sort((a, b) => (a.row_order ?? 99) - (b.row_order ?? 99)) : [];
    const sign = (x) => (x.direction === 'subtract' ? -1 : x.direction === 'add' ? 1 : 0);
    const conditional = items.filter((x) => x.applicability && x.applicability !== 'all_buyers' && sign(x) < 0);
    const before = p && p.seller_total_before_taxes_and_registration_usd;
    const base = before || l.price;
    const gap = before && l.price ? before - l.price : null;
    return `<section class="card">
      <h2>Pricing breakdown</h2>
      ${items.length ? `<dl class="spec pricing">
        ${items.map((x) => `<div class="${x.role === 'displayed_price' ? 'sub' : ''}"><dt>${esc(x.raw_label || Live.titleCase(x.role || 'Item'))}${x.applicability && x.applicability !== 'all_buyers' ? ` <span class="tag warn">${esc(Live.titleCase(x.applicability))}</span>` : x.role === 'seller_add_on' ? ' <span class="tag">add-on</span>' : x.role === 'seller_fee' ? ' <span class="tag">fee</span>' : ''}</dt>
          <dd class="${sign(x) < 0 ? 'good' : ''}">${x.amount_usd == null ? '—' : (sign(x) > 0 ? '+' : sign(x) < 0 ? '−' : '') + money(Math.abs(x.amount_usd))}</dd></div>`).join('')}
        ${before ? `<div class="sub"><dt>Seller total before tax</dt><dd>${money(before)}</dd></div>` : ''}
        <div><dt>Est. sales tax (${taxRate}%)</dt><dd>+${money(base * taxRate / 100)}</dd></div>
        <div class="total"><dt>Est. out the door</dt><dd>${money(base * (1 + taxRate / 100))}</dd></div>
      </dl>
      ${gap > 0 ? `<p class="price-gap">Possible price gap: <b>${money(gap)}</b> on top of the advertised price before tax.</p>` : ''}
      ${conditional.length ? `<p class="muted small">Discounts marked “${esc(Live.titleCase(conditional[0].applicability))}” only apply if you qualify.</p>` : ''}`
      : `<p class="muted small">This dealer’s fee and add-on details aren’t available. Ask for an out-the-door price in writing.</p>
        <dl class="spec pricing"><div class="sub"><dt>Advertised price</dt><dd>${money(l.price)}</dd></div>
        <div><dt>Est. sales tax (${taxRate}%)</dt><dd>+${money(l.price * taxRate / 100)}</dd></div>
        <div class="total"><dt>Est. before fees</dt><dd>${money(l.price * (1 + taxRate / 100))}</dd></div></dl>`}
    </section>`;
  }

  function pricingHtml(l) {
    if (l.live) return livePricingHtml(l);
    const p = l.pricing;
    const conditional = p.incentives.filter((i) => i.conditional).reduce((s, i) => s + i.amount, 0);
    const addOns = p.addOns.reduce((s, a) => s + a.price, 0);
    const taxRate = stateTax(l.state);
    const preTax = l.price + conditional + addOns + p.docFee;
    const tax = (l.price + conditional + addOns) * taxRate / 100;
    const gap = conditional + addOns + p.docFee;
    if (l.seller === 'Private') {
      return `<section class="card"><h2>Pricing breakdown</h2>
        <p class="muted small">Private sale: no dealer fees or add-ons. You'll pay tax and registration at the DMV.</p>
        <dl class="spec"><div><dt>Asking price</dt><dd>${money(l.price)}</dd></div><div><dt>Est. sales tax (${taxRate}%)</dt><dd>${money(l.price * taxRate / 100)}</dd></div>
        <div class="total"><dt>Est. total</dt><dd>${money(l.price * (1 + taxRate / 100))}</dd></div></dl></section>`;
    }
    return `<section class="card">
      <h2>Pricing breakdown</h2>
      <dl class="spec pricing">
        ${l.condition === 'New' ? `<div><dt>MSRP</dt><dd>${money(p.msrp)}</dd></div>
          ${p.discount ? `<div><dt>Dealer discount</dt><dd class="good">−${money(p.discount)}</dd></div>` : ''}
          ${p.marketAdjustment ? `<div><dt>Market adjustment</dt><dd class="bad">+${money(p.marketAdjustment)}</dd></div>` : ''}` : ''}
        <div class="sub"><dt>Advertised price</dt><dd>${money(l.price)}</dd></div>
        ${p.incentives.map((i) => `<div><dt>${esc(i.name)} <span class="tag warn">if you qualify</span></dt><dd class="warn-text">+${money(i.amount)}</dd></div>`).join('')}
        ${p.addOns.map((a) => `<div><dt>${esc(a.name)} <span class="tag">add-on</span></dt><dd>+${money(a.price)}</dd></div>`).join('')}
        <div><dt>Doc fee</dt><dd>+${money(p.docFee)}</dd></div>
        <div class="sub"><dt>Before tax</dt><dd>${money(preTax)}</dd></div>
        <div><dt>Est. sales tax (${taxRate}%)</dt><dd>+${money(tax)}</dd></div>
        <div class="total"><dt>Est. out the door</dt><dd>${money(preTax + tax)}</dd></div>
      </dl>
      ${gap > 0 ? `<p class="price-gap">Possible price gap: <b>${money(gap)}</b> on top of the advertised price before tax.</p>` : ''}
      ${p.notes.length ? `<ul class="notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="muted small">Doc fees and add-ons are often negotiable. Typical doc fee in ${esc(l.state)}: ${money(DOC_FEE_TYPICAL[l.state] || p.docFee)}.</p>
    </section>`;
  }

  function dealCheckHtml(l) {
    const p = l.pricing;
    const liveItems = l.live && l.livePricing && l.livePricing.line_items ? l.livePricing.line_items : [];
    const addOns = l.live ? liveItems.filter((x) => x.role === 'seller_add_on').reduce((sum, x) => sum + (x.amount_usd || 0), 0) : p.addOns.reduce((sum, a) => sum + a.price, 0);
    const docFee = l.live ? liveItems.filter((x) => x.role === 'seller_fee').reduce((sum, x) => sum + (x.amount_usd || 0), 0) : p.docFee;
    const field = (id, label, value, step) => `<label><span>${label}</span><input type="number" id="dc-${id}" value="${value}" step="${step || 100}" min="0"></label>`;
    return `<section class="card" id="deal-check">
      <h2>Deal Check</h2>
      <p class="muted small">Enter the numbers from the dealer’s worksheet. We’ll total it and compare it with the market.</p>
      <div class="calc">
        ${field('price', 'Selling price', l.price)}
        ${field('addOns', 'Add-ons', addOns)}
        ${field('docFee', l.live ? 'Dealer fees' : 'Doc fee', docFee, 1)}
        ${field('otherFees', 'Title, registration & other', 350)}
        ${field('taxRate', 'Sales tax %', stateTax(l.state), 0.05)}
        ${field('tradeIn', 'Trade-in value', 0)}
        ${field('tradeOwed', 'Still owed on trade', 0)}
        ${field('down', 'Cash down', Math.round(l.price * 0.1 / 500) * 500, 500)}
        ${field('apr', 'APR %', l.condition === 'New' ? 5.9 : 7.4, 0.1)}
        <label><span>Term</span><select id="dc-term">${[36, 48, 60, 72, 84].map((t) => `<option ${t === 60 ? 'selected' : ''} value="${t}">${t} months</option>`).join('')}</select></label>
      </div>
      <label class="check small"><input type="checkbox" id="dc-tradeTaxCredit" checked> Trade-in reduces taxable amount</label>
      <div class="deal-out" id="dc-out" aria-live="polite"></div>
    </section>`;
  }

  function bindDealCheck(l) {
    const ids = ['price', 'addOns', 'docFee', 'otherFees', 'taxRate', 'tradeIn', 'tradeOwed', 'down', 'apr', 'term', 'tradeTaxCredit'];
    const out = document.getElementById('dc-out');
    const comps = (l.live ? (C.comps || []) : Market.comparables(l, LISTINGS, { years: 1, condition: 'same' })).map((x) => x.price).filter(Boolean);
    const calc = () => {
      const input = {};
      for (const id of ids) {
        const el = document.getElementById('dc-' + id);
        input[id] = el.type === 'checkbox' ? el.checked : el.value;
      }
      const r = Market.dealCheck(input, { expected: expected(l), compPrices: comps, typicalDocFee: l.live ? null : DOC_FEE_TYPICAL[l.state], isNew: l.condition === 'New' });
      out.innerHTML = `<dl class="spec pricing">
          <div><dt>Price + add-ons</dt><dd>${money(r.price + r.addOns)}</dd></div>
          <div><dt>Fees</dt><dd>${money(r.fees)}</dd></div>
          <div><dt>Sales tax</dt><dd>${money(r.tax)}</dd></div>
          <div class="total"><dt>Out the door</dt><dd>${money(r.outTheDoor)}</dd></div>
          <div><dt>Trade equity</dt><dd class="${r.tradeEquity < 0 ? 'bad' : ''}">${money(r.tradeEquity)}</dd></div>
          <div><dt>Amount financed</dt><dd>${money(r.financed)}</dd></div>
        </dl>
        <div class="pay">${money(r.payment)}<small>/month for ${r.term} months · ${money(r.interest)} interest</small></div>
        <ul class="flags">${r.flags.map((x) => `<li class="flag-${x.level}">${esc(x.text)}</li>`).join('')}</ul>`;
    };
    ids.forEach((i) => document.getElementById('dc-' + i).addEventListener('input', calc));
    ids.forEach((i) => document.getElementById('dc-' + i).addEventListener('change', calc));
    calc();
  }

  /* ----- Vehicle documents ----- */

  function stickerHtml(l) {
    const optTotal = l.options.reduce((sum, x) => sum + (x.price || 0), 0);
    const eco = l.economy || null;
    const ev = eco && !Array.isArray(eco);
    const combined = !eco ? null : ev ? eco.mpge : Math.round(2 / (1 / eco[0] + 1 / eco[1]));
    const annual = !eco ? null : ev ? Math.round((15000 / eco.mpge) * 33.7 * 0.17) : Math.round((15000 / combined) * 3.6);
    const standard = l.features.filter((f) => !l.options.some((o) => (o.name.includes('Roof') && f.includes('roof')) || o.name === f));
    return `<article class="sticker">
      <header class="st-head"><div><h2>${l.year} ${esc(l.make.toUpperCase())} ${esc(l.model.toUpperCase())}</h2><p>${esc(l.trim)} · ${esc(l.drivetrain)} · ${esc(l.fuel)}</p></div>
        <dl><div><dt>Exterior</dt><dd>${esc(l.extColor)}</dd></div><div><dt>Interior</dt><dd>${esc(l.intColor)}</dd></div><div><dt>VIN</dt><dd class="mono">${esc(l.vin)}</dd></div></dl></header>
      <div class="st-grid">
        <section><h3>Standard & featured equipment</h3><ul class="st-list">${standard.map((f) => `<li>${esc(f)}</li>`).join('') || '<li>Per trim specification</li>'}</ul></section>
        <section><h3>Price information</h3>
          <table class="st-price"><tbody>
            ${l.msrpBase ? `<tr><td>Base price</td><td>${money(l.msrpBase)}</td></tr>` : ''}
            ${l.options.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.price ? money(x.price) : '—'}</td></tr>`).join('')}
            ${optTotal ? `<tr class="st-sub"><td>Total options</td><td>${money(optTotal)}</td></tr>` : ''}
            ${l.destination ? `<tr><td>Destination charge</td><td>${money(l.destination)}</td></tr>` : ''}
            <tr class="st-total"><td>Total MSRP</td><td>${l.msrp ? money(l.msrp + (l.destination || 0)) : '—'}</td></tr>
          </tbody></table>
        </section>
        <section class="st-eco"><h3>Fuel economy</h3>
          ${eco ? `<div class="eco-big">${combined}<small>${ev ? 'MPGe' : 'MPG'} combined</small></div>
            <p>${ev ? `${eco.range} mi range` : `${eco[0]} city / ${eco[1]} highway`}</p>
            <p>About <b>$${annual.toLocaleString('en-US')}</b> a year to fuel at 15,000 miles.</p>` : '<p>Not available</p>'}
        </section>
        <section><h3>Origin</h3>
          <p>Final assembly point: <b>${esc(l.assembly.plant)}</b>${l.assembly.country ? `<br>Country of assembly: ${esc(l.assembly.country)}` : ''}</p>
          ${l.windowStickerVerified ? `<p class="st-note">This VIN was verified against its original window sticker.</p>` : ''}
          ${l.upfitter ? `<p class="st-note">Upfitted after delivery by <b>${esc(l.upfitter.name)}</b> (${esc(l.upfitter.category.toLowerCase())}). Upfit content is not part of the factory MSRP.</p>` : ''}
        </section>
      </div>
      <p class="st-foot">Reconstructed from listing data for reference. Confirm with the original Monroney label from the seller.</p>
    </article>`;
  }

  function buildSheetHtml(l) {
    const d = VIN.decode(l.vin);
    const rows = [['VIN', l.vin], ['World manufacturer (1–3)', `${l.vin.slice(0, 3)} · ${d.make || 'Unknown'}`], ['Vehicle descriptor (4–8)', l.vin.slice(3, 8)],
      ['Check digit (9)', `${l.vin[8]} · ${d.valid ? 'valid' : 'invalid'}`], ['Model year (10)', `${l.vin[9]} · ${d.year}`], ['Plant (11)', `${l.vin[10]} · ${l.assembly.plant}`],
      ['Serial (12–17)', l.vin.slice(11)], ['Body', l.live ? l.bodyLabel || l.body : `${l.body} · ${l.segment}`], ['Engine', l.engine || '—'], ['Transmission', l.transmission || '—'], ['Trim', l.trim], ['Drivetrain', l.drivetrain], ['Fuel', l.fuel],
      ['Exterior paint', l.extColor], ['Interior', l.intColor]];
    return `<article class="sticker build">
      <header class="st-head"><div><h2>Build sheet</h2><p>${esc(title(l))} ${esc(l.trim)}</p></div></header>
      <table class="st-price"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>
      <h3>Factory options</h3>
      <table class="st-price"><tbody>${l.options.map((x, i) => `<tr><td><span class="mono">${esc(x.code || l.make.slice(0, 2).toUpperCase() + String(100 + i * 7))}</span> ${esc(x.name)}</td><td>${x.price ? money(x.price) : '—'}</td></tr>`).join('') || '<tr><td>None</td><td></td></tr>'}</tbody></table>
      <p class="st-foot">${l.live && l.options.length ? 'Option codes from the listing.' : 'Option codes are illustrative.'} Reconstructed from listing data.</p>
    </article>`;
  }

  /* ----- VIN page ----- */

  function renderVin(raw) {
    const d = VIN.decode(decodeURIComponent(raw));
    const match = isLive() ? null : BY_VIN.get(d.vin);
    if (isLive() && d.wellFormed) {
      Live.vin(d.vin).then((l) => {
        const el = document.getElementById('vin-live');
        if (!el) return;
        if (!l) { el.innerHTML = '<p class="muted">No live listing for this VIN.</p>'; return; }
        rememberLive(l);
        el.innerHTML = `<h2 class="sec-title">${l.sold ? 'This VIN sold recently' : 'This VIN is for sale'}</h2><div class="listing-grid compact">${listingCard(l)}</div>`;
      }, (e) => { const el = document.getElementById('vin-live'); if (el) el.innerHTML = e.code === 'not_found' ? '<p class="muted">This VIN hasn’t been seen in live listings.</p>' : liveErrorHtml(e); });
    }
    setView('vin', `<section class="narrow">
      <h1>VIN <span class="mono">${esc(d.vin)}</span></h1>
      <div class="card">
        <dl class="spec">
          <div><dt>Format</dt><dd>${d.wellFormed ? '<span class="good">✓ 17 valid characters</span>' : '<span class="bad">✕ Not a well-formed VIN</span>'}</dd></div>
          <div><dt>Check digit</dt><dd>${d.expectedCheckDigit == null ? '—' : d.valid ? '<span class="good">✓ Matches</span>' : `<span class="bad">✕ Expected ${esc(d.expectedCheckDigit)}</span>`}</dd></div>
          <div><dt>Manufacturer</dt><dd>${esc(d.make || 'Not in our WMI table')}</dd></div>
          <div><dt>Region / country</dt><dd>${esc([d.country, d.region].filter(Boolean).join(' · ') || '—')}</dd></div>
          <div><dt>Model year</dt><dd>${d.year || '—'}</dd></div>
          <div><dt>Plant code</dt><dd>${esc(d.plant || '—')}</dd></div>
          <div><dt>Serial</dt><dd class="mono">${esc(d.serial || '—')}</dd></div>
        </dl>
        ${d.errors.length ? `<ul class="errors">${d.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      </div>
      ${isLive() && d.wellFormed ? `<div id="vin-live">${loadingHtml('Looking up this VIN…')}</div>` : match ? `<h2 class="sec-title">${match.sold ? 'This VIN sold recently' : 'This VIN is for sale'}</h2><div class="listing-grid compact">${listingCard(match)}</div>` : `<p class="muted">No current listing matches this VIN.${d.make && d.year ? ` <a href="${searchHref({ make: d.make, year: d.year })}">See ${d.year} ${esc(d.make)}s for sale →</a>` : ''}</p>`}
      ${d.wellFormed ? `<p><a href="${searchHref({ vin: d.vin.slice(0, 8) })}">Find other cars with the same first 8 characters →</a></p>` : ''}
    </section>`);
    window.scrollTo(0, 0);
  }

  /* ----- Compare ----- */

  function renderCompare() {
    const cars = store.get().compare.map(carById).filter(Boolean);
    if (!cars.length) {
      setView('compare', `<section class="narrow empty-state"><h1>Compare cars</h1><p class="muted">Add up to four cars with <b>+ Compare</b> on any listing to line them up here.</p><a class="btn primary" href="#/search">Start searching</a></section>`);
      return;
    }
    const best = (vals, low) => {
      const target = low ? Math.min(...vals) : Math.max(...vals);
      return vals.map((v) => cars.length > 1 && v === target);
    };
    const optTotal = (l) => l.options.reduce((s, o) => s + o.price, 0);
    const rows = [
      ['Price', cars.map((l) => money(l.price) + (l.sold ? ' <span class="muted">sold</span>' : '')), best(cars.map((l) => l.price), true)],
      ['vs. market', cars.map((l) => deltaChip(l) || '—'), best(cars.map(delta), true)],
      ['Expected value', cars.map((l) => money(expected(l))), []],
      ['Original MSRP', cars.map((l) => money(l.msrp)), []],
      ['Discount from MSRP', cars.map((l) => pct(Market.discountOf(l))), best(cars.map(Market.discountOf), false)],
      ['Mileage', cars.map((l) => miles(l.miles)), best(cars.map((l) => l.miles), true)],
      ['Year', cars.map((l) => String(l.year)), best(cars.map((l) => l.year), false)],
      ['Trim', cars.map((l) => esc(l.trim)), []],
      ['Condition', cars.map((l) => conditionBadge(l)), []],
      ['Drivetrain', cars.map((l) => esc(l.drivetrain)), []],
      ['Transmission', cars.map((l) => esc(l.transmission || '—')), []],
      ['Fuel', cars.map((l) => esc(l.fuel)), []],
      ['Exterior', cars.map((l) => `<span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span>`), []],
      ['Interior', cars.map((l) => esc(l.intColor)), []],
      ['Top features', cars.map((l) => `${l.features.length} <span class="muted small">${esc(l.features.slice(0, 4).join(', '))}${l.features.length > 4 ? '…' : ''}</span>`), best(cars.map((l) => l.features.length), false)],
      ['Options', cars.map((l) => money(optTotal(l))), best(cars.map(optTotal), false)],
      ['Upfitter', cars.map((l) => (l.upfitter ? esc(l.upfitter.name) : '—')), []],
      ['Assembled in', cars.map((l) => esc(l.assembly.plant)), []],
      ['Data', cars.map((l) => (l.live ? badge('Live', 'b-live') : badge('Demo', 'b-status'))), []],
      ['Days for sale', cars.map((l) => String(l.daysListed)), []],
      ['Price cuts', cars.map((l) => l.history.length > 1 ? `${l.history.length - 1} · ${money(l.history[0].price - l.price)}` : 'None'), []],
      ['Est. out the door', cars.map((l) => {
        if (l.live) return l.livePricing && l.livePricing.seller_total_before_taxes_and_registration_usd ? money(l.livePricing.seller_total_before_taxes_and_registration_usd * (1 + stateTax(l.state) / 100)) : '—';
        const p = l.pricing;
        const pre = l.price + p.addOns.reduce((s, a) => s + a.price, 0) + p.incentives.reduce((s, i) => s + i.amount, 0);
        return money(pre * (1 + stateTax(l.state) / 100) + p.docFee);
      }), []],
      ['Location', cars.map((l) => esc(whereText(l))), []],
      ['Seller', cars.map((l) => esc(l.dealer)), []],
    ];
    setView('compare', `<section class="section">
      <div class="page-head"><h1>Compare ${cars.length} cars</h1><button class="btn ghost" type="button" data-action="clear-compare">Clear all</button></div>
      <div class="table-wrap card"><table class="compare-table">
        <thead><tr><th></th>${cars.map((l) => `<th><a href="#/car/${l.id}" class="cmp-head" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex)}<b>${esc(title(l))}</b><span class="muted">${esc(l.trim)}</span></a>
          <button class="link-btn" type="button" data-action="compare" data-id="${l.id}">Remove</button></th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, vals, wins]) => `<tr><th scope="row">${label}</th>${vals.map((v, i) => `<td class="${wins[i] ? 'win' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Highlighted cells are the best value in each row.</p>
    </section>`);
    window.scrollTo(0, 0);
  }

  /* ---------- Hunts: saved searches that keep watching the market ---------- */

  // A hunt remembers the price of every car it matched at its last check, and
  // collects what changed since you last looked: new matches, price cuts, and
  // cars that sold or were delisted.
  const HUNT_EVERY = [[0, 'Never (check by hand)'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Once a day']];
  // Roughly how many of auto.dev's 1,000 free monthly requests the hunts use.
  function huntBudgetText() {
    const every = prefs().huntEvery;
    const n = store.get().saved.filter((h) => h.hunt && h.hunt.watch).length;
    if (!every || !n) return '';
    const perMonth = Math.round(n * (30 * 24 * 60) / Math.max(every, 30));
    return ` (at most about ${num(perMonth)} a month for ${plural(n, 'watched hunt')}, of 1,000 free; fewer while Gridline is closed)`;
  }
  const emptyNews = () => ({ added: [], cut: [], gone: [] });
  const newHunt = () => ({ watch: true, seen: null, source: null, checkedAt: null, lookedAt: Date.now(), news: emptyNews(), error: null });
  const huntOf = (h) => h.hunt || (h.hunt = Object.assign(newHunt(), { watch: false }));
  const huntNewCount = (h) => (h.hunt ? h.hunt.news.added.length + h.hunt.news.cut.length + h.hunt.news.gone.length : 0);
  const huntNewsIds = (h) => (h.hunt ? [...h.hunt.news.added, ...h.hunt.news.cut, ...h.hunt.news.gone].map((x) => x.id) : []);
  const huntFilters = (h) => Object.assign(filtersFromParams(new URLSearchParams(h.params)), { when: '0' });
  const LIVE_SEEN_CAP = 1000;

  // The cars a hunt matches right now. Demo: every match. Live: the newest
  // listings, one page, in one request.
  async function huntMatches(h) {
    const f = huntFilters(h);
    if (!isLive()) {
      const results = Market.search(LISTINGS, f, CTX).results;
      return { results, complete: true, total: results.length };
    }
    await ensureLiveVocab();
    const r = await Live.search(Object.assign({}, f, { sort: 'newest' }), liveCtx(), { lite: true, fresh: true });
    for (const l of r.results) LIVE_SEEN.set(l.id, l);
    const fv = Live.fairValueFrom(r.results, CURRENT_YEAR);
    for (const l of r.results) if (!LIVE_EXPECTED.has(l.id)) setLiveValue(fv, l);
    return { results: r.results, complete: r.total <= r.results.length, total: r.total };
  }

  // The demo market never changes, so a new demo hunt starts from the market as
  // it stood a week ago: its first check shows what a week of hunting finds.
  function demoBaseline(f) {
    const snap = Market.snapshot(LISTINGS, SOLD, 7);
    return Object.fromEntries(Market.search(snap, f, CTX).results.map((l) => [l.id, l.price]));
  }

  async function checkHunt(id) {
    const h = store.get().saved.find((x) => x.id === id);
    if (!h) return null;
    const hunt = huntOf(h);
    const { results, complete, total } = await huntMatches(h);
    // Ids from a different data source mean nothing here: start over.
    let seen = hunt.source === SOURCE() ? hunt.seen : null;
    const first = !seen;
    if (!seen && !isLive()) seen = demoBaseline(huntFilters(h));
    const d = seen
      ? Market.huntDiff(seen, results, { complete })
      : { added: [], cut: [], gone: [], seen: Object.fromEntries(results.map((l) => [l.id, l.price])) };
    const at = Date.now();
    for (const x of [...d.added, ...d.cut.map((c) => c.l)]) rememberLive(x);
    store.update((s) => {
      const x = s.saved.find((y) => y.id === id);
      if (!x) return;
      const n = x.hunt.source === SOURCE() ? x.hunt.news : emptyNews();
      const ids = Object.keys(d.seen);
      x.hunt.seen = ids.length > LIVE_SEEN_CAP ? Object.fromEntries(ids.slice(-LIVE_SEEN_CAP).map((k) => [k, d.seen[k]])) : d.seen;
      x.hunt.source = SOURCE();
      x.hunt.checkedAt = at;
      x.hunt.error = null;
      x.count = total;
      for (const l of d.added) {
        if (n.added.some((y) => y.id === l.id)) continue;
        n.gone = n.gone.filter((y) => y.id !== l.id);
        n.added.push({ id: l.id, price: l.price, at, below: delta(l) < -0.03 });
      }
      for (const c of d.cut) {
        const was = n.cut.find((y) => y.id === c.l.id);
        if (was) Object.assign(was, { to: c.to, at });
        else if (!n.added.some((y) => y.id === c.l.id)) n.cut.push({ id: c.l.id, from: c.from, to: c.to, at });
        const add = n.added.find((y) => y.id === c.l.id);
        if (add) add.price = c.to;
      }
      for (const gid of d.gone) {
        n.added = n.added.filter((y) => y.id !== gid);
        n.cut = n.cut.filter((y) => y.id !== gid);
        n.gone.push({ id: gid, price: seen[gid], at });
      }
      x.hunt.news = n;
    });
    return Object.assign(d, { first });
  }

  let huntsRunning = null;
  // Checks every watched hunt that's due (or all of them, or one, when forced).
  function checkDueHunts(force, onlyId) {
    if (huntsRunning) return huntsRunning;
    const every = prefs().huntEvery;
    const due = store.get().saved.filter((h) => {
      if (onlyId) return h.id === onlyId;
      const hunt = h.hunt;
      if (!hunt || !hunt.watch) return false;
      if (force || hunt.source !== SOURCE()) return true;
      return every > 0 && (!hunt.checkedAt || Date.now() - hunt.checkedAt >= every * 60000);
    });
    if (!due.length) return Promise.resolve();
    huntsRunning = (async () => {
      for (const h of due) {
        try {
          const d = await checkHunt(h.id);
          if (d && !d.first && (d.added.length || d.cut.length)) notifyHunt(h, d);
        } catch (e) {
          store.update((s) => { const x = s.saved.find((y) => y.id === h.id); if (x) { x.hunt.error = e.message; x.hunt.checkedAt = Date.now(); } });
          // Out of requests, a bad key, or no route to the API: the rest would fail too.
          if (['rate_limit', 'billing', 'auth', 'blocked', 'no_key'].includes(e.code)) break;
        }
      }
    })().finally(() => {
      huntsRunning = null;
      updateNavCounts();
      if (view.name === 'saved') renderSaved();
    });
    return huntsRunning;
  }

  function notifyHunt(h, d) {
    const parts = [];
    if (d.added.length) parts.push(d.added.length === 1 ? '1 new car' : `${d.added.length} new cars`);
    if (d.cut.length) parts.push(d.cut.length === 1 ? '1 price cut' : `${d.cut.length} price cuts`);
    const lead = [...d.added].sort((a, b) => delta(a) - delta(b))[0];
    let body;
    if (lead) {
      const m = marketText(lead);
      body = `${title(lead)} ${lead.trim} · ${money(lead.price)}${m && m.d < -0.01 ? ` · ${m.label} market` : ''} · ${lead.city}, ${lead.state}`;
    } else {
      const c = d.cut[0];
      body = `${title(c.l)} ${c.l.trim} dropped ${money(c.from - c.to)} to ${money(c.to)}`;
    }
    notify(`${h.name}: ${parts.join(', ')}`, body, '#/hunt/' + h.id);
  }

  // Desktop apps show a native notification; a browser tab uses the Notification API.
  function notify(titleText, body, href) {
    const d = window.gridlineDesktop;
    if (d && d.notify) { d.notify({ title: titleText, body, href }); return; }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(titleText, { body, tag: href, icon: 'assets/icons/icon-192.png' });
    n.onclick = () => { window.focus(); location.hash = href; n.close(); };
  }
  const notifyState = () => (window.gridlineDesktop && window.gridlineDesktop.notify ? 'desktop' : !('Notification' in window) ? 'unsupported' : Notification.permission);
  function askNotifyPermission() {
    if (notifyState() !== 'default') return Promise.resolve(notifyState());
    try { return Promise.resolve(Notification.requestPermission()).catch(() => 'denied'); } catch (e) { return Promise.resolve('denied'); }
  }

  const sinceText = (t) => {
    if (!t) return 'never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };

  function huntCard(x) {
    const h = huntOf(x);
    const n = huntNewCount(x);
    const status = h.error ? `<span class="bad">Last check failed: ${esc(h.error)}</span>`
      : `${x.count != null ? `${num(x.count)} for sale` : ''}${h.checkedAt ? ` · checked ${sinceText(h.checkedAt)}` : ''}`;
    return `<li class="card hunt-row">
      <a href="#/hunt/${esc(x.id)}"><span><b>${esc(x.name)}</b>${n ? ` <span class="pill-count pill-new">${num(n)} new</span>` : ''}</span><small class="muted">${status}</small></a>
      <span class="hunt-actions">
        <button class="chip-btn${h.watch ? ' on' : ''}" type="button" data-action="hunt-watch" data-id="${esc(x.id)}" aria-pressed="${h.watch}" title="${h.watch ? 'Notifications on. Click to pause.' : 'Paused. Click to watch again.'}">${h.watch ? '● Watching' : '○ Paused'}</button>
        <a class="link-btn" href="#/search?${esc(x.params)}">Open search</a>
        <button class="link-btn" type="button" data-action="delete-search" data-id="${esc(x.id)}">Delete</button>
      </span></li>`;
  }

  function newsHtml(x) {
    const n = huntOf(x).news;
    const cars = (list) => list.map((y) => ({ y, l: carById(y.id) })).filter((c) => c.l);
    const added = cars(n.added).sort((a, b) => delta(a.l) - delta(b.l));
    const cut = cars(n.cut);
    const gone = cars(n.gone);
    if (!added.length && !cut.length && !gone.length) {
      return `<p class="muted">Nothing new since you last looked${x.hunt.lookedAt ? ` (${sinceText(x.hunt.lookedAt)})` : ''}. ${x.hunt.watch && prefs().huntEvery ? 'Gridline keeps checking while it’s open and notifies you when something turns up.' : ''}</p>`;
    }
    return `${added.length ? `<h3 class="news-title">New listings <span class="muted">${num(added.length)}</span></h3>
        <div class="listing-grid compact">${added.map(({ l }) => listingCard(l)).join('')}</div>` : ''}
      ${cut.length ? `<h3 class="news-title">Price cuts <span class="muted">${num(cut.length)}</span></h3>
        <ul class="rank-list">${cut.map(({ y, l }) => `<li><a href="#/car/${esc(l.id)}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
          <span class="r"><b>${money(y.to)}</b><small class="drop">↓ ${money(y.from - y.to)} from ${money(y.from)}</small></span></a></li>`).join('')}</ul>` : ''}
      ${gone.length ? `<h3 class="news-title">Gone <span class="muted">${num(gone.length)}</span></h3>
        <ul class="rank-list">${gone.map(({ y, l }) => `<li><a href="#/car/${esc(l.id)}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
          <span class="r"><b>${money(l.sold ? l.sold.price : y.price)}</b><small class="muted">${l.sold ? `sold after ${plural(l.sold.daysToSell, 'day')}` : 'sold or delisted'}</small></span></a></li>`).join('')}</ul>` : ''}
      <p><button class="btn" type="button" data-action="hunt-seen" data-id="${esc(x.id)}">Mark all as seen</button></p>`;
  }

  function renderHunt(id) {
    const x = store.get().saved.find((y) => y.id === id);
    if (!x) return renderNotFound('That hunt doesn’t exist. It may have been deleted.');
    const h = huntOf(x);
    const f = huntFilters(x);
    setView('hunt', `<section class="section hunt-page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/saved">Hunts</a><span>›</span><span aria-current="page">${esc(x.name)}</span></nav>
      <div class="page-head"><div><p class="eyebrow">Hunt</p><h1>${esc(x.name)}</h1>${describeFilters(f) !== x.name ? `<p class="muted">${esc(describeFilters(f))}</p>` : ''}</div>
        <div class="actions">
          <button class="chip-btn${h.watch ? ' on' : ''}" type="button" data-action="hunt-watch" data-id="${esc(x.id)}" aria-pressed="${h.watch}">${h.watch ? '● Watching' : '○ Paused'}</button>
          <button class="btn ghost" type="button" data-action="hunt-check" data-id="${esc(x.id)}">Check now</button>
          <a class="btn" href="#/search?${esc(x.params)}">Open search</a>
          <button class="link-btn" type="button" data-action="delete-search" data-id="${esc(x.id)}">Delete</button></div></div>
      <p class="muted small">${h.error ? `<span class="bad">Last check failed: ${esc(h.error)}</span> · ` : ''}Checked ${sinceText(h.checkedAt)}${!isLive() && h.source === 'demo' ? ' · The demo market doesn’t change, so this hunt started from the market a week ago.' : ''}${isLive() ? ` · Each check looks at the newest ${Live.PAGE} matches (1 request).` : ''}</p>
      <section class="card"><h2>Since you last looked</h2><div id="hunt-news">${newsHtml(x)}</div></section>
      <div id="hunt-market">${isLive() ? loadingHtml('Sizing up this market…') : huntMarketHtml(Market.huntStats(LISTINGS, SOLD, f, CTX), f)}</div>
    </section>`);
    if (isLive()) fillHuntMarketLive(x);
    window.scrollTo(0, 0);
  }

  /* How rare the hunted car is, how fast it goes, and the best one for sale now.
     st: { forSale, perMonth, perMonthAtLeast, sold, sold30, medianDaysToSell, medianPrice, medianSoldPrice, rarity, best } */
  function huntMarketHtml(st, f, trendHtml) {
    const every = st.daysBetween || (st.perMonth ? 30 / st.perMonth : null);
    const pace = st.perMonth == null ? 'Not enough data yet to say how often one comes up.'
      : st.perMonth < 1 ? `Fewer than one a month comes up${every ? `, about one every ${Math.round(every)} days` : ''}.`
      : `About ${num(st.perMonth)}${st.perMonthAtLeast ? ' or more' : ''} a month come up, one every ${every < 2 ? 'day or two' : `${Math.round(every)} days`}.`;
    const speed = st.medianDaysToSell != null ? ` Half of them sell within ${plural(Math.round(st.medianDaysToSell), 'day')} of being listed${st.medianDaysToSell <= 21 ? ', so move quickly on a good one' : ''}.` : '';
    const supply = !st.forSale ? ' None are for sale right now, so this is one to watch.'
      : st.rarity === 'Common' && st.forSale >= 10 ? ' There’s plenty to choose from: you can afford to be picky.' : '';
    const best = st.best;
    const m = best && marketText(best);
    return `<section class="card hunt-market">
        <div class="overview-head"><div><p class="eyebrow">This market</p><h2>${st.rarity ? `${esc(st.rarity)}` : 'How rare is it?'}</h2></div>
        <dl class="kpis">
          <div><dt>For sale now</dt><dd>${num(st.forSale)}</dd></div>
          <div><dt>New listings a month</dt><dd>${st.perMonth == null ? '—' : `${st.perMonth < 1 ? '<1' : num(st.perMonth)}${st.perMonthAtLeast ? '+' : ''}`}</dd></div>
          ${st.sold != null ? `<div><dt>Sold, ${st.soldWindow || '120 days'}</dt><dd>${num(st.sold)}</dd></div>` : ''}
          ${st.medianDaysToSell != null ? `<div><dt>Median days to sell</dt><dd>${Math.round(st.medianDaysToSell)}</dd></div>` : ''}
          ${st.medianPrice != null ? `<div><dt>Median asking</dt><dd>${money(st.medianPrice)}</dd></div>` : ''}
          ${st.medianSoldPrice != null ? `<div><dt>Median sold</dt><dd>${money(st.medianSoldPrice)}</dd></div>` : ''}
        </dl></div>
        <p class="hunt-verdict">${esc(pace + speed + supply)}</p>
      </section>
      ${best ? `<section class="card hunt-best"><h2>Best one for sale now</h2>
        <p class="muted">${m && m.d < -0.005 ? `Priced ${money(-m.diff)} below what Gridline expects for this car (${money(m.expected)}).` : 'The closest to its expected price among these matches.'} <a href="#/car/${esc(best.id)}">See how that’s worked out →</a></p>
        <div class="listing-grid compact">${listingCard(best)}</div></section>` : ''}
      ${trendHtml != null ? trendHtml : (() => {
        const inv = Market.inventorySeries(LISTINGS, SOLD, f, CTX, 90);
        return `<section class="card viz trend-card"><div class="viz-head"><h3>For sale over the last 90 days</h3><span class="muted small">${num(inv.sold30)} sold in 30 days · ${num(inv.sold90)} in 90</span></div>
          ${Charts.trend(inv.series, { width: 1100, height: 200, aria: 'Matching cars for sale over the last 90 days' })}
          <div class="legend"><span><i class="key inv"></i>For sale</span><span><i class="key med"></i>Median price</span></div></section>`;
      })()}`;
  }

  // Live: the newest page of matches (usually cached from the last check) and, with Visor, sales velocity.
  async function fillHuntMarketLive(x) {
    const el = () => (view.name === 'hunt' ? document.getElementById('hunt-market') : null);
    try {
      const f = huntFilters(x);
      const { results, complete, total } = await huntMatches(x);
      const recent = results.filter((l) => l.daysListed <= 30).length;
      const st = { forSale: total, perMonth: complete ? recent : recent || null, perMonthAtLeast: !complete, sold: null, medianDaysToSell: null,
        medianPrice: complete ? Market.median(results.map((l) => l.price)) : null, medianSoldPrice: null };
      if (can('velocity')) {
        const v = await Live.velocity(f, liveCtx()).catch(() => null);
        if (v) {
          Object.assign(st, { sold: v.sold30, soldWindow: '30 days', medianDaysToSell: v.medianDaysToSell });
          st.perMonth = Math.max(st.perMonth || 0, v.sold30);
          st.perMonthAtLeast = false;
        }
      }
      st.rarity = Market.rarityLabel(st.perMonth);
      st.best = results.filter((l) => expected(l)).sort((a, b) => delta(a) - delta(b))[0] || null;
      const note = `<p class="muted small">From ${complete ? 'all' : `the newest ${num(results.length)} of`} ${plural(total, 'match')}${can('velocity') ? '' : '. Sales history needs a source that has it (see Settings)'}.</p>`;
      if (el()) el().innerHTML = huntMarketHtml(st, f, note);
    } catch (e) {
      if (el()) el().innerHTML = liveErrorHtml(e);
    }
  }

  /* ----- Saved ----- */

  function renderSaved() {
    const s = store.get();
    const favs = Object.keys(s.favs).map(carById).filter(Boolean);
    const recent = s.recent.map(carById).filter(Boolean);
    const news = s.saved.reduce((n, h) => n + huntNewCount(h), 0);
    setView('saved', `<section class="section">
      <h1>Saved</h1>
      <div class="sec-head"><h2 class="sec-title">Hunts${news ? ` <span class="pill-count pill-new">${num(news)} new</span>` : ''}</h2>
        ${s.saved.length ? `<button class="btn ghost" type="button" data-action="hunt-check">Check all now</button>` : ''}</div>
      ${s.saved.length ? `<ul class="saved-list">${s.saved.map(huntCard).join('')}</ul>
        <p class="muted small">${prefs().huntEvery ? `Watched hunts are checked ${esc(HUNT_EVERY.find(([v]) => v === prefs().huntEvery)?.[1].toLowerCase() || 'regularly')} while Gridline is open.` : 'Automatic checks are off.'} <a href="#/settings">Change in Settings</a>.</p>`
        : '<p class="muted">No hunts yet. Search for the car you want, then press <b>🎯 Hunt this</b>. Gridline keeps checking and notifies you when a new one is listed or one drops its price.</p>'}
      <h2 class="sec-title">Favorites</h2>
      ${favs.length ? `<div class="listing-grid">${favs.map((l) => listingCard(l)).join('')}</div>` : '<p class="muted">Tap the heart on any car to keep it here.</p>'}
      ${recent.length ? `<h2 class="sec-title">Recently viewed</h2><div class="listing-grid compact">${recent.map((l) => listingCard(l)).join('')}</div>` : ''}
      <p class="muted small">Everything on this page is stored only on this device.</p>
    </section>`);
    window.scrollTo(0, 0);
  }

  /* ----- Settings ----- */

  function renderSettings() {
    const p = prefs();
    const src = SOURCE();
    const ad = Live.usage('autodev');
    const vz = Live.usage('visor');
    const keyRow = (prov, label, help) => {
      const saved = (() => { try { return localStorage.getItem('gridline:key:' + prov) || ''; } catch (e) { return ''; } })();
      const key = saved;
      const builtIn = !saved && Live.builtInKey(prov);
      return `<div class="set-row key-row"><span><b>${label}</b><small>${builtIn ? 'Using the key built into this app. Paste a different one to override it.' : help}</small></span>
        <form class="key-form" data-provider="${prov}"><input type="password" id="api-key-${prov}" placeholder="Paste API key" autocomplete="off" spellcheck="false" value="${esc(key)}">
          <button class="btn primary" type="submit">Save</button>${key ? `<button class="btn ghost" type="button" data-action="clear-key" data-provider="${prov}">Remove</button>` : ''}</form></div>`;
    };
    setView('settings', `<section class="narrow">
      <h1>Settings</h1>
      <h2 class="sec-title">Listing data</h2>
      <div class="card settings">
        <div class="set-row"><span><b>Data source</b><small>Demo is a built-in sample. auto.dev and Visor search real cars for sale, using your own API key.</small></span>
          <div class="seg-choice" role="radiogroup" aria-label="Data source">
            <label><input type="radio" name="ds" data-pref="dataSource" value="demo" ${src === 'demo' ? 'checked' : ''}> Demo</label>
            <label><input type="radio" name="ds" data-pref="dataSource" value="autodev" ${src === 'autodev' ? 'checked' : ''}> auto.dev <span class="tag free">Free</span></label>
            <label><input type="radio" name="ds" data-pref="dataSource" value="visor" ${src === 'visor' ? 'checked' : ''}> Visor</label>
          </div></div>
        <div class="set-row"><span><b>Connection</b><small id="conn-status">${isLive() ? 'Not tested yet.' : src === 'demo' ? 'Using demo data.' : `Add your ${esc(Live.info(src).name)} key below.`}</small></span>
          <button class="btn ghost" type="button" data-action="test-key" ${isLive() ? '' : 'disabled'}>Test connection</button></div>
      </div>
      <div class="card settings provider-card${src === 'autodev' ? ' active' : ''}">
        <div class="set-row"><span><b>auto.dev</b> <span class="tag free">Free plan</span><small>1,000 free requests a month, no credit card. It stops at the limit, so you are never charged. Covers cars for sale now with photos; no sold history, options or dealer fees.</small></span>
          <a class="btn ghost" href="https://auto.dev/pricing" target="_blank" rel="noopener">Get a free key ↗</a></div>
        ${keyRow('autodev', 'auto.dev API key', 'Sign up free at auto.dev, then copy the key from your dashboard. Stored only on this device.')}
        <div class="set-row"><span><b>Free requests used</b><small>On this device, this month. A search uses 1; opening a car uses 2–3. Repeats within 30 minutes are free.</small></span>
          <span class="spend"><b>${num(ad.calls)}</b> of 1,000<br><span class="meter"><i style="width:${Math.min(100, ad.calls / 10)}%"></i></span></span></div>
      </div>
      <div class="card settings provider-card${src === 'visor' ? ' active' : ''}">
        <div class="set-row"><span><b>Visor</b> <span class="tag">Pay per use</span><small>Everything: sold cars, past dates, installed options, upfitters, dealer fees and velocity. About $0.002–$0.04 per request after starter credit.</small></span>
          <a class="btn ghost" href="https://visor.vin/account/api" target="_blank" rel="noopener">Get a key ↗</a></div>
        ${keyRow('visor', 'Visor API key', 'Stored only on this device; never uploaded.')}
        <div class="set-row"><span><b>Spending</b><small>Visor bills per request; repeats within 30 minutes are free.</small></span>
          <span class="spend"><b>$${vz.session.toFixed(3)}</b> this session<br><b>$${vz.total.toFixed(3)}</b> total on this device</span></div>
      </div>
      <p class="muted small">Live data works in the desktop app or with <code>npm start</code>. Both services only accept browser requests from their own websites, so the public web version stays on demo data. Recalls and complaints come from NHTSA and work everywhere.</p>
      <h2 class="sec-title">Hunts</h2>
      <div class="card settings">
        <label class="set-row"><span><b>Check watched hunts</b><small>While Gridline is open, including in the background. ${isLive() ? `Each check uses 1 request per hunt${SOURCE() === 'autodev' ? huntBudgetText() : ''}.` : 'Demo checks are free.'}</small></span>
          <select data-pref="huntEvery">${HUNT_EVERY.map(([v, t]) => `<option value="${v}" ${p.huntEvery === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="set-row"><span><b>Notifications</b><small>${{ desktop: 'Native notifications from the desktop app. You can turn them off in your system’s notification settings.', granted: 'This browser will show notifications from Gridline.', denied: 'Blocked in this browser. Allow notifications for this site in its settings to get them.', unsupported: 'This browser can’t show notifications. Use the desktop app.' }[notifyState()] || 'Allow notifications to hear about new matches and price cuts.'}</small></span>
          ${notifyState() === 'default' ? '<button class="btn ghost" type="button" data-action="notify-allow">Allow notifications</button>' : ''}</div>
      </div>
      <h2 class="sec-title">Display</h2>
      <div class="card settings">
        <div class="set-row"><span><b>Home ZIP code</b><small>Sets your market on the home page, the distance on every listing and the “Distance from home” sort.${homeZip() ? ` Now <b data-home-place>${esc(Geo.label(Geo.lookup(homeZip()), { short: true }))}</b> ${esc(homeZip())}.` : ' Stays on this device.'}</small></span>
          <form class="zip-mini" data-zip-form="settings"><input type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP code" aria-label="Home ZIP code" value="${esc(homeZip() || '')}"><button class="btn primary" type="submit">Save</button>${homeZip() ? '<button class="btn ghost" type="button" data-action="clear-zip">Clear</button>' : ''}</form></div>
        <label class="set-row"><span><b>Market radius</b><small>How far around your ZIP the home page looks for deals. “Worth the drive” looks out to ${num(WIDE)} miles.</small></span>
          <select data-pref="homeRadius">${RADII.map((r) => `<option value="${r}" ${homeRadius() === r ? 'selected' : ''}>${r} miles</option>`).join('')}</select></label>
        <label class="set-row"><span><b>Show on listings</b><small>Seller name or the car’s location.</small></span>
          <select data-pref="showDealer"><option value="0" ${!p.showDealer ? 'selected' : ''}>Location</option><option value="1" ${p.showDealer ? 'selected' : ''}>Seller name</option></select></label>
        <label class="set-row"><span><b>Compact cards</b><small>Fit more cars on screen.</small></span>
          <input type="checkbox" data-pref="compact" ${p.compact ? 'checked' : ''}></label>
        <label class="set-row"><span><b>Sort filter values by</b><small>How options are ordered inside each filter.</small></span>
          <select data-pref="valueSort">${Object.entries(VALUE_SORTS).map(([k, v]) => `<option value="${k}" ${p.valueSort === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <div class="set-row"><span><b>Saved data</b><small>${plural(store.get().saved.length, 'hunt')}, ${plural(Object.keys(store.get().favs).length, 'favorite')}, ${plural(store.get().compare.length, 'car')} in compare.</small></span>
          <button class="btn ghost" type="button" data-action="clear-data">Clear everything</button></div>
      </div>
    </section>`);
    window.scrollTo(0, 0);
  }

  async function testLiveConnection() {
    const out = document.getElementById('conn-status');
    out.textContent = 'Testing…';
    const route = await Live.transport();
    try {
      const n = await Live.count({ ex: {} }, liveCtx());
      out.innerHTML = `<span class="good">✓ Connected</span> · ${num(n)} cars for sale nationwide · via ${route === 'desktop' ? 'the desktop app' : route === 'proxy' ? 'the local server' : 'direct browser request'}`;
    } catch (e) {
      out.innerHTML = `<span class="bad">✕ ${esc(e.message)}</span>`;
    }
  }

  function applyModeUi() {
    const live = isLive();
    document.documentElement.classList.toggle('mode-live', live);
    const pill = document.getElementById('mode-pill');
    if (pill) {
      pill.textContent = live ? 'Live' : 'Demo';
      pill.title = live ? 'Searching live listings' : 'Showing sample data. Switch to live data in Settings.';
    }
    const att = document.getElementById('data-attribution');
    if (att) att.innerHTML = live
      ? `Live listing data from ${srcLink()}, provided “as is” without warranty. Confirm details and availability with the seller. Recalls from NHTSA.`
      : 'This build is showing a synthetic, deterministic sample of the national market. Prices, dealers and VINs are generated for demonstration. Add a free auto.dev key in <a href="#/settings">Settings</a> to search real listings.';
  }

  function renderNotFound(msg) {
    setView('404', `<section class="narrow empty-state"><h1>Not found</h1><p class="muted">${esc(msg || 'That page doesn’t exist.')}</p><a class="btn primary" href="#/">Go home</a></section>`);
  }

  /* ---------- Events ---------- */

  app.addEventListener('click', (e) => {
    const dot = e.target.closest('circle.dot[data-id]');
    if (dot) { location.hash = `#/car/${dot.dataset.id}`; return; }
    const tile = e.target.closest('[data-state]');
    if (tile) { onTile(tile.dataset.state, tile.dataset.href); return; }
    const pt = e.target.closest('.map-pt[data-city]');
    if (pt) { onMapCity(pt.dataset.city); return; }
    const fl = e.target.closest('#finder-list li[data-i]');
    if (fl) { applyFinder(Number(fl.dataset.i)); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === 'fav') {
      e.preventDefault();
      const l = carById(id);
      rememberLive(l);
      store.update((s) => { if (s.favs[id]) delete s.favs[id]; else s.favs[id] = l.price; });
      const on = !!store.get().favs[id];
      document.querySelectorAll(`[data-action="fav"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      toast(on ? 'Saved to favorites' : 'Removed from favorites');
    } else if (a === 'compare') {
      e.preventDefault();
      let msg;
      rememberLive(carById(id));
      store.update((s) => {
        if (s.compare.includes(id)) { s.compare = s.compare.filter((x) => x !== id); msg = 'Removed from compare'; }
        else if (s.compare.length >= 4) msg = 'You can compare up to 4 cars';
        else { s.compare.push(id); msg = `Added to compare (${s.compare.length}/4)`; }
      });
      toast(msg);
      if (view.name === 'compare') renderCompare();
      else document.querySelectorAll(`[data-action="compare"][data-id="${id}"]`).forEach((b) => { b.outerHTML = compareButton(carById(id)); });
    } else if (a === 'share' || a === 'copy') {
      const text = a === 'share' ? location.href : el.dataset.text;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied'), () => toast(text));
    } else if (a === 'photo') {
      document.getElementById('gallery-main').src = el.dataset.src;
      document.querySelectorAll('.thumb').forEach((b) => b.classList.toggle('on', b === el));
    } else if (a === 'doc') {
      const l = C.l;
      if (el.dataset.doc === 'sticker') showDoc(stickerHtml(l), `Window sticker · ${title(l)} ${l.trim}`);
      else showDoc(buildSheetHtml(l), `Build sheet · ${title(l)} ${l.trim}`);
    } else if (a === 'scroll') {
      document.getElementById(el.dataset.target || 'rare-scroller')?.scrollBy({ left: Number(el.dataset.dir) * 320, behavior: 'smooth' });
    } else if (a === 'radius') {
      store.update((s) => { s.prefs.homeRadius = Number(el.dataset.r); });
      if (isLive()) showTab(TAB.id);
      else renderLocal();
    } else if (a === 'deal-cond') {
      HOME.cond = dealCond(el.dataset.cond);
      const zip = homeZip(), radius = homeRadius();
      const bodyEl = document.getElementById('deals-body');
      if (bodyEl && zip) {
        const pool = isLive() ? [...LIVE_SEEN.values()].filter((l) => !l.sold) : LISTINGS;
        bodyEl.innerHTML = dealsScrollerHtml(localData(zip, radius, pool), zip, radius);
      }
    } else if (a === 'locate') {
      locateMe(el);
    } else if (a === 'set-zip') {
      if (setHomeZip(el.dataset.zip)) renderHome('local');
    } else if (a === 'edit-zip') {
      const box = document.getElementById('home-market');
      if (!box) return;
      box.classList.add('open');
      box.innerHTML = `${zipFormHtml('home')}<button class="link-btn" type="button" data-action="cancel-zip">Keep ${esc(Geo.label(Geo.lookup(homeZip()), { short: true }))}</button>`;
      box.querySelector('#zip-input')?.focus();
    } else if (a === 'cancel-zip') {
      renderHome();
    } else if (a === 'clear-zip') {
      store.update((s) => { s.prefs.homeZip = null; s.prefs.homeCity = null; });
      toast('Home ZIP cleared');
      renderSettings();
    } else if (a === 'near-home') {
      updateFilters((f) => { f.near = homeZip(); f.radius = homeRadius(); });
    } else if (a === 'tab') {
      e.preventDefault();
      if (tabIsPanel(el.dataset.tab)) PANEL.auto = false;
      showTab(el.dataset.tab);
    } else if (a === 'panel') {
      e.preventDefault();
      PANEL.auto = false;
      showPanel(el.dataset.panel);
    } else if (a === 'jump') {
      e.preventDefault();
      showTab(el.dataset.target);
    } else if (a === 'toggle-filters') {
      S.filtersOpen = !S.filtersOpen;
      document.getElementById('filters').classList.toggle('open', S.filtersOpen);
    } else if (a === 'reset') {
      updateFilters((f) => Object.assign(f, Market.emptyFilters(), { sort: f.sort, when: f.when }));
      document.getElementById('q-input').value = '';
    } else if (a === 'clear-facet') {
      updateFilters((f) => { f[el.dataset.key] = []; delete f.ex[el.dataset.key]; });
    } else if (a === 'ex-mode') {
      const k = el.dataset.key;
      const now = S.exMode[k] || ((S.f.ex[k] || []).length > 0 && !S.f[k].length);
      S.exMode[k] = !now;
      // Moving the checked values across keeps what you picked when you flip modes.
      updateFilters((f) => {
        if (S.exMode[k]) { f.ex[k] = [...new Set([...(f.ex[k] || []), ...f[k]])]; f[k] = []; }
        else { f[k] = [...new Set([...f[k], ...(f.ex[k] || [])])]; delete f.ex[k]; }
      });
    } else if (a === 'more') {
      S[`more_${el.dataset.key}`] = !S[`more_${el.dataset.key}`];
      refreshSearch();
    } else if (a === 'remove-chip') {
      const k = el.dataset.k, v = el.dataset.v;
      updateFilters((f) => {
        if (k.startsWith('x.')) f.ex[k.slice(2)] = (f.ex[k.slice(2)] || []).filter((x) => x !== v);
        else if (ARRAY_KEYS.includes(k)) f[k] = f[k].filter((x) => x !== v);
        else if (BOOL_KEYS.includes(k)) f[k] = false;
        else if (k === 'q') { f.q = ''; document.getElementById('q-input').value = ''; }
        else if (k === 'vin') f.vin = '';
        else f[k] = null;
      });
    } else if (a === 'live-more') {
      refreshSearchLive(true);
    } else if (a === 'live-trend') {
      el.disabled = true;
      el.textContent = 'Loading…';
      Live.inventoryTrend(S.f, liveCtx()).then((t) => { S.liveTrend = t; renderSearchParts(); }, (e) => { el.outerHTML = `<p class="bad small">${esc(e.message)}</p>`; });
    } else if (a === 'use-demo') {
      store.update((s) => { s.prefs.dataSource = 'demo'; });
      applyModeUi();
      route();
    } else if (a === 'more-results') {
      S.shown += PAGE;
      document.getElementById('results').innerHTML = resultsHtml(S.results);
    } else if (a === 'layout') {
      S.layout = el.dataset.layout;
      refreshSearch();
    } else if (a === 'pick-trim') {
      updateFilters((f) => { f.trim = [el.dataset.trim]; });
    } else if (a === 'save-search') {
      const params = paramsFromFilters(Object.assign({}, S.f, { when: '0' })).toString();
      const count = S.live ? S.total : S.results.length;
      askText('Name this hunt', describeFilters(S.f), 'Start hunting').then((name) => {
        if (!name) return;
        const hid = 's' + Date.now();
        store.update((s) => { s.saved.unshift({ id: hid, name, params, count, createdAt: Date.now(), hunt: newHunt() }); });
        askNotifyPermission();
        checkHunt(hid).catch(() => null).then(() => {
          updateNavCounts();
          toast(prefs().huntEvery ? 'Hunting. You’ll get a notification when a new one is listed or drops its price.' : 'Hunt saved. Turn on checks in Settings to get notifications.');
        });
      });
    } else if (a === 'delete-search') {
      store.update((s) => { s.saved = s.saved.filter((x) => x.id !== id); });
      if (view.name === 'hunt') location.hash = '#/saved';
      else renderSaved();
    } else if (a === 'hunt-watch') {
      store.update((s) => { const h = s.saved.find((x) => x.id === id); if (h) h.hunt.watch = !h.hunt.watch; });
      route();
    } else if (a === 'hunt-seen') {
      store.update((s) => { const h = s.saved.find((x) => x.id === id); if (h) { h.hunt.news = emptyNews(); h.hunt.lookedAt = Date.now(); } });
      route();
    } else if (a === 'hunt-check') {
      el.disabled = true;
      el.textContent = 'Checking…';
      checkDueHunts(true, id).then(() => route());
    } else if (a === 'notify-allow') {
      askNotifyPermission().then(() => renderSettings());
    } else if (a === 'clear-compare') {
      store.update((s) => { s.compare = []; });
      renderCompare();
    } else if (a === 'test-key') {
      testLiveConnection();
    } else if (a === 'clear-key') {
      Live.setKey('', el.dataset.provider);
      if (SOURCE() === el.dataset.provider) store.update((s) => { s.prefs.dataSource = 'demo'; });
      applyModeUi();
      renderSettings();
      toast('API key removed');
    } else if (a === 'clear-data') {
      askText('Type CLEAR to delete hunts, favorites, compare and history', '', 'Delete').then((v) => {
        if (v !== 'CLEAR') return;
        store.update((s) => { s.saved = []; s.favs = {}; s.compare = []; s.recent = []; });
        toast('Saved data cleared');
        renderSettings();
      });
    }
  });

  app.addEventListener('submit', (e) => {
    const zipForm = e.target.dataset && e.target.dataset.zipForm;
    if (zipForm) {
      e.preventDefault();
      const raw = e.target.querySelector('input').value;
      if (zipForm === 'search') {
        const zip = raw.trim();
        if (!zip) return updateFilters((f) => { if (Geo.isZip(f.near)) f.near = null; });
        if (!Geo.lookup(zip)) return toast(`${zip} isn’t a US ZIP code`);
        return updateFilters((f) => { f.near = zip; f.radius = f.radius && f.radius !== 150 ? f.radius : homeRadius(); });
      }
      if (!setHomeZip(raw)) return;
      if (zipForm === 'settings') renderSettings();
      else renderHome('local');
      return;
    }
    const prov = e.target.dataset && e.target.dataset.provider;
    if (!prov) return;
    e.preventDefault();
    const k = document.getElementById('api-key-' + prov).value.trim();
    Live.setKey(k, prov);
    LIVE_KNOWN = null;
    if (k) store.update((s) => { s.prefs.dataSource = prov; });
    syncProvider();
    applyModeUi();
    renderSettings();
    toast(k ? `${Live.info(prov).name} key saved · live data on` : 'Key removed');
    if (k) testLiveConnection();
  });

  app.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-state]')) {
      e.preventDefault();
      onTile(e.target.dataset.state, e.target.dataset.href);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.map-pt[data-city]')) {
      e.preventDefault();
      onMapCity(e.target.dataset.city);
    } else if (e.target.id === 'finder-input') {
      const n = (S.finderItems || []).length;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.finderActive = Math.min(n - 1, (S.finderActive || 0) + 1); renderFinder(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); S.finderActive = Math.max(0, (S.finderActive || 0) - 1); renderFinder(); }
      else if (e.key === 'Enter') { e.preventDefault(); applyFinder(S.finderActive || 0, e.metaKey || e.ctrlKey); }
      else if (e.key === 'Escape') { S.finder = ''; e.target.value = ''; renderFinder(); }
    }
  });

  function onTile(st, href) {
    if (href) location.hash = href;
    else if (view.name === 'search') {
      updateFilters((f) => { f.state = f.state.includes(st) ? f.state.filter((x) => x !== st) : [...f.state, st]; });
    } else {
      location.hash = searchHref({ state: st, condition: ['Used', 'Certified'], belowMarket: 1 });
    }
  }

  function onMapCity(city) {
    if (view.name !== 'search') { location.hash = searchHref({ near: city, radius: 100 }); return; }
    updateFilters((f) => {
      f.near = city;
      f.radius = f.radius && f.radius !== 150 ? f.radius : 100;
    });
  }

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pref) {
      const k = t.dataset.pref;
      store.update((s) => {
        s.prefs[k] = t.type === 'checkbox' ? t.checked : k === 'showDealer' ? t.value === '1' : k === 'huntEvery' || k === 'homeRadius' ? Number(t.value) : t.value || null;
        if (k === 'dataSource') s.prefs.sourceChosen = true;
      });
      if (k === 'dataSource') {
        syncProvider();
        LIVE_KNOWN = null;
        applyModeUi();
        renderSettings();
        toast(t.value === 'demo' ? 'Using demo data' : isLive() ? 'Using live data' : 'Add your API key to use live data');
      } else toast('Saved');
      return;
    }
    if (t.dataset.copt && C) {
      C.opts[t.dataset.copt] = t.type === 'checkbox' ? t.checked : t.value;
      renderMarketCompare();
      return;
    }
    if (view.name !== 'search') return;
    if (t.id === 'when-select') {
      updateFilters((f) => {
        f.when = t.value;
        if (t.value === 'sold') f.sort = 'sold-recent';
        else if (f.sort.startsWith('sold')) f.sort = 'best';
      });
      return;
    }
    if (t.id === 'where-select') {
      updateFilters((f) => { f.near = t.value || null; });
      return;
    }
    if (t.id === 'value-sort') {
      store.update((s) => { s.prefs.valueSort = t.value; });
      refreshSearch();
      return;
    }
    if (!t.closest('#filters')) return;
    if (t.dataset.facet) {
      const k = t.dataset.facet;
      const ex = t.dataset.mode === 'ex';
      updateFilters((f) => {
        if (ex) f.ex[k] = t.checked ? [...(f.ex[k] || []), t.value] : (f.ex[k] || []).filter((x) => x !== t.value);
        else f[k] = t.checked ? [...f[k], t.value] : f[k].filter((x) => x !== t.value);
        // Dropping the last model makes trim choices meaningless.
        if (k === 'model' && f.model.length !== 1) f.trim = [];
      });
    } else if (t.dataset.bool) {
      updateFilters((f) => { f[t.dataset.bool] = t.checked; });
    } else if (t.dataset.num) {
      updateFilters((f) => { f[t.dataset.num] = t.value === '' ? null : Number(t.value); });
    } else if (t.dataset.text) {
      updateFilters((f) => { f[t.dataset.text] = t.value.trim(); });
    } else if (t.hasAttribute('data-near')) {
      updateFilters((f) => { f.near = t.value || null; });
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'radius') e.target.previousElementSibling.querySelector('b').textContent = `${e.target.value} mi`;
    if (e.target.id === 'finder-input') {
      S.finder = e.target.value;
      S.finderActive = 0;
      renderFinder();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select')) {
      const input = ['#finder-input', '#hero-search input', '#q-input', '#header-search input']
        .map((sel) => document.querySelector(sel))
        .find((el) => el && el.offsetParent !== null && !el.closest('[hidden]'));
      if (input) { e.preventDefault(); input.focus(); }
    }
  });

  /* ---------- Theme ---------- */

  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.update((s) => { s.theme = next; });
  });

  /* ---------- Router ---------- */

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(qs || '');
    const home = !parts.length || (parts.length === 1 && (PANELS.some((p) => p.route === parts[0]) || HOME_CATS.some((c) => c.id === parts[0])));
    document.getElementById('header-search').hidden = home;
    if (!parts.length) return renderHome(null, params);
    if (parts.length === 1 && PANELS.some((p) => p.route === parts[0])) {
      PANEL.id = PANELS.find((p) => p.route === parts[0]).id;
      PANEL.auto = false;
      return renderHome('insights');
    }
    if (parts.length === 1 && HOME_CATS.some((c) => c.id === parts[0])) return renderHome(parts[0]);
    if (parts[0] === 'search') return renderSearch(params);
    if (parts[0] === 'car') return renderCar(parts[1], params);
    if (parts[0] === 'vin') return renderVin(parts[1] || '');
    if (parts[0] === 'compare') return renderCompare();
    if (parts[0] === 'saved') return renderSaved();
    if (parts[0] === 'hunt') return renderHunt(parts[1]);
    if (parts[0] === 'settings') return renderSettings();
    return renderNotFound();
  }

  // The most listed models, by the share of the market each has (the weights the demo market is drawn from).
  function footerLinks() {
    const top = [...DATA.models].sort((a, b) => b.weight - a.weight).slice(0, 12).map((m) => [`${m.make} ${m.model}`]);
    const segs = [...new Set(DATA.models.map((m) => m.seg))];
    document.getElementById('footer-links').innerHTML = `
      <div><h4>Popular searches</h4>${top.map(([k]) => `<a href="${searchHref({ model: k })}">${esc(k)}</a>`).join('')}</div>
      <div><h4>Used prices by segment</h4>${segs.map((s) => `<a href="${searchHref({ q: s, condition: ['Used', 'Certified'] })}">${esc(s)}</a>`).join('')}</div>
      <div><h4>Tools</h4><a href="#/insights">Market insights</a><a href="${searchHref({ when: 'sold', sort: 'sold-recent' })}">Recently sold</a><a href="#/compare">Compare cars</a><a href="#/saved">Hunts</a><a href="#/vin">VIN decoder</a><a href="#/settings">Settings</a></div>`;
  }

  applyTheme(store.get().theme);
  applyModeUi();
  mountSearchBox(document.getElementById('header-search'), { size: 'sm', placeholder: 'Search…' });
  footerLinks();
  updateNavCounts();
  window.addEventListener('hashchange', route);
  route();

  // Hunts: check what's due shortly after opening, then every few minutes and
  // whenever the window comes back. The desktop apps also call gridlineHuntTick.
  window.gridlineHuntTick = () => checkDueHunts();
  setTimeout(() => checkDueHunts(), 4000);
  setInterval(() => checkDueHunts(), 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueHunts(); });
})();
