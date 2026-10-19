/* Gridline app: hash-routed views over the in-memory market. */
(function () {
  'use strict';

  const { esc } = Charts;
  const CURRENT_YEAR = 2026;
  const PAGE = 24;

  /* ---------- Data + derived models ---------- */

  const DATA = MarketData.generateInventory({ currentYear: CURRENT_YEAR });
  const LISTINGS = DATA.listings; // for sale today
  const SOLD = DATA.sold;         // sold in the last ~120 days
  const ALL = LISTINGS.concat(SOLD);
  const BY_ID = new Map(ALL.map((l) => [l.id, l]));
  const BY_VIN = new Map(ALL.map((l) => [l.vin, l]));
  for (const l of LISTINGS) BY_VIN.set(l.vin, l);
  // Trained on cars for sale and recently sold, so rare specs have enough examples.
  const fairValue = Market.buildFairValue(ALL, CURRENT_YEAR);
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
  const rarity = Market.colorStats(LISTINGS);
  const CITY_NAMES = [...new Set(DATA.cities.map((c) => `${c[0]}, ${c[1]}`))].sort();
  const cityByName = (name) => DATA.cities.find((c) => `${c[0]}, ${c[1]}` === name);
  const MODEL_KEYS = DATA.models.map((m) => `${m.make} ${m.model}`);
  const modelOf = (key) => DATA.models.find((m) => `${m.make} ${m.model}` === key);
  const UPFITTER_NAMES = [...new Set(Object.values(MarketData.UPFITTERS).flat().map((u) => u[0]))];
  const VOCAB = NLQ.build({
    models: DATA.models, cities: DATA.cities, currentYear: CURRENT_YEAR,
    paints: [...new Set(ALL.map((l) => l.extColor))], upfitters: UPFITTER_NAMES,
  });

  // Typical sales tax by state, for out-the-door estimates.
  const STATE_TAX = { CA: 8.8, NY: 8.5, TX: 6.25, FL: 7, GA: 7, NC: 3, IL: 8.25, OH: 7.2, PA: 6, MI: 6, CO: 7.7, AZ: 8.4, WA: 9.3, MN: 6.9,
    OR: 0, MA: 6.25, NJ: 6.6, VA: 4.15, TN: 9.5, IN: 7, MO: 8.2, MD: 6, WI: 5.4, SC: 5, AL: 4, LA: 9.5, KY: 6, OK: 3.25, UT: 7.2, NV: 8.2 };
  const stateTax = (st) => (STATE_TAX[st] != null ? STATE_TAX[st] : 6.5);
  const DOC_FEE_TYPICAL = (() => {
    const by = Market.groupBy(LISTINGS.filter((l) => l.seller === 'Dealer'), (l) => l.state);
    const out = {};
    for (const [st, g] of by) out[st] = Market.median(g.map((l) => l.pricing.docFee));
    return out;
  })();

  /* ---------- Persistence ---------- */

  const STORE_KEY = 'gridline:v1';
  const store = (() => {
    let s = { saved: [], favs: {}, compare: [], recent: [], theme: null, prefs: {} };
    try { s = Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) { /* private mode */ }
    s.prefs = Object.assign({ homeCity: null, showDealer: false, compact: false, valueSort: 'count', dataSource: 'demo', huntEvery: 360 }, s.prefs);
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
  const CTX = {
    delta, cityByName,
    get origin() { return prefs().homeCity ? cityByName(prefs().homeCity) : null; },
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
  const DEMO_MAKES = [...new Set(DATA.models.map((m) => m.make))];
  const LIVE_EXPECTED = new Map();
  const LIVE_EXPLAIN = new Map();
  const LIVE_SEEN = new Map();
  let LIVE_VOCAB = null, LIVE_KNOWN = null;
  const liveCtx = () => ({ cityByName, zipFor: (c) => CITY_ZIP[c] || null, home: CTX.origin, makes: [...new Set(DEMO_MAKES.concat((LIVE_KNOWN && LIVE_KNOWN.makes) || []))], known: LIVE_KNOWN });
  const vocab = () => (isLive() && LIVE_VOCAB) || VOCAB;

  async function ensureLiveVocab() {
    if (LIVE_KNOWN) return;
    try {
      LIVE_KNOWN = await Live.vocabulary();
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
      no_key: `Open <a href="#/settings">Settings</a> and paste your ${esc(srcName())} API key.`,
      auth: `${esc(srcName())} rejected the API key. Check it in <a href="#/settings">Settings</a>.`,
      billing: 'Your Visor API balance or spending cap is used up. Top up at <a href="https://visor.vin/account/api" target="_blank" rel="noopener">visor.vin/account/api</a>.',
      rate_limit: SOURCE() === 'autodev' ? 'Either this month’s 1,000 free auto.dev calls are used up (they reset on the 1st), or too many requests went out at once. Wait a few seconds and try again.' : 'Too many requests in a short time. Wait a few seconds and try again.',
      blocked: 'Live data works in the Gridline desktop app, or when you run <code>npm start</code> and open <a href="http://localhost:8080">localhost:8080</a>.',
      unsupported: `That needs data ${esc(srcName())} doesn’t provide.`,
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
    if (f.near) parts.push(`within ${f.radius} mi of ${f.near}`);
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
  const QUICK = [
    { label: 'Manual Miata under $30k', href: nlQuick('manual miata under 30k') },
    { label: 'Red convertibles under 40k with leather seats', href: nlQuick('red convertibles under 40k with leather seats') },
    { label: '4x4 trucks under 50k miles near Denver', href: nlQuick('4x4 trucks under 50k miles near denver') },
    { label: 'Used RAV4 hybrid 2021+ without sunroof', href: nlQuick('used rav4 hybrid 2021+ without sunroof') },
    { label: 'Third-row SUVs under $35k', href: nlQuick('suv with third row under 35k') },
    { label: 'EVs with price drops', href: nlQuick('electric with price drops'), demoOnly: true },
    { label: 'Roush and RTR Mustangs', href: searchHref({ model: 'Ford Mustang', upfitter: ['Roush', 'RTR'] }), needs: 'upfitter' },
    { label: 'What sold last month', href: searchHref({ when: 'sold', sort: 'sold-recent' }), needs: 'sold' },
  ];
  // Example searches the current data source can actually answer.
  const quickFor = () => QUICK.filter((q) => !isLive() || (!q.demoOnly && (!q.needs || can(q.needs))));

  /* ---------- Views ---------- */

  const app = document.getElementById('app');
  let view = { name: null };

  function setView(name, html) {
    view = { name };
    app.innerHTML = html;
    document.querySelectorAll('.main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
    document.body.dataset.view = name;
  }

  /* ----- Home + insights ----- */

  function insightsHtml() {
    const arr = Market.arrivals(LISTINGS, CURRENT_YEAR);
    const movers = Market.priceMovers(LISTINGS, 20);
    const mv = movers[0];
    const ret = Market.retention(LISTINGS, 'Compact SUV', CURRENT_YEAR).slice(0, 4);
    const drops = Market.recentDrops(LISTINGS, 7);
    const states = Market.stateDeltas(LISTINGS, delta);
    const values = LISTINGS.filter((l) => l.condition !== 'New' && l.miles < 80000 && l.year >= CURRENT_YEAR - 6)
      .sort((a, b) => delta(a) - delta(b)).slice(0, 5);

    const arrivalsCard = `<article class="card insight">
      <header><h3>${badge('New', 'b-new')} ${arr.year} ${esc(arr.make)} ${esc(arr.model)}s are arriving</h3></header>
      <div class="arrivals">
        <dl class="stat-stack">
          <div class="stat-head">${num(arr.total)} for sale nationwide</div>
          <div><dt>On lot</dt><dd>${num(arr.byStatus['On lot'])}</dd></div>
          <div><dt>In transit</dt><dd>${num(arr.byStatus['In transit'])}</dd></div>
          <div><dt>In production</dt><dd>${num(arr.byStatus['In production'])}</dd></div>
        </dl>
        <div class="mini-list">
          <div class="mini-list-head"><span class="pulse" aria-hidden="true"></span> Recent arrivals</div>
          <ul>${arr.recent.slice(0, 6).map((l) => `<li><a href="#/car/${l.id}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${esc(l.city)}, ${esc(l.state)}</small></span><span class="r"><b>${money(l.price)}</b><small>${esc(l.status)}</small></span></a></li>`).join('')}</ul>
        </div>
      </div>
      <a class="card-cta" href="${searchHref({ model: arr.make + ' ' + arr.model, year: arr.year, sort: 'newest' })}">See all ${arr.year} ${esc(arr.model)}s →</a>
    </article>`;

    let moverCard = '';
    if (mv) {
      const down = mv.change < 0;
      moverCard = `<article class="card insight">
        <header><h3>${badge('Used', 'b-used')} ${mv.year} ${esc(mv.make)} ${esc(mv.model)} prices ${down ? 'down' : 'up'} ${money(Math.abs(mv.change))} in 30 days</h3>
        <p class="muted">At ${kMiles(mv.mid)} (the median) · ${plural(mv.count, 'listing')} nationwide</p></header>
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

    const retentionCard = ret.length ? `<article class="card insight">
      <header><h3>${esc(ret[0].make)} ${esc(ret[0].model)} leads compact SUVs in value kept over 4 years</h3>
      <p class="muted">${CURRENT_YEAR - 4} to ${CURRENT_YEAR - 1} model years · under 75k miles · average list price vs. original MSRP</p></header>
      ${Charts.retentionBars(ret.map((r) => ({ title: `${r.make} ${r.model}`, sub: `MSRP ${money(r.msrp)} → avg ${money(r.avgList)}`, values: r.byAge })))}
      <div class="legend">${[1, 2, 3, 4].map((y) => `<span><i class="key ret-${y}"></i>Year ${y}</span>`).join('')}</div>
    </article>` : '';

    const dropsCard = `<article class="card insight">
      <header><h3>${badge('Price cuts', 'b-drop')} ${num(drops.length)} cars got cheaper this week</h3>
      <p class="muted">Biggest reductions in the last 7 days</p></header>
      <ul class="rank-list">${drops.slice(0, 5).map(({ l, c }) => `<li><a href="#/car/${l.id}">
        <span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
        <span class="r"><b>${money(c.to)}</b><small class="drop">↓ ${money(-c.delta)} from ${money(c.from)}</small></span></a></li>`).join('')}</ul>
      <a class="card-cta" href="${searchHref({ dropsOnly: 1, sort: 'newest' })}">All cars with price cuts →</a>
    </article>`;

    const mapCard = `<article class="card insight">
      <header><h3>Where used cars are priced below market</h3>
      <p class="muted">Median price vs. expected value for the same car, by state. Tap a state to shop it.</p></header>
      ${Charts.tileMap((st) => {
        const d = states[st];
        if (!d || d.n < 8) return null;
        return { cls: deltaClass(d.delta), value: `${d.delta > 0 ? '+' : ''}${(d.delta * 100).toFixed(1)}%`, title: `${st}: ${plural(d.n, 'used car')}, median ${pct(Math.abs(d.delta), 1)} ${d.delta < 0 ? 'below' : 'above'} market` };
      }, { clickable: true, aria: 'States shaded by how far used prices sit from market value' })}
      <div class="legend diverging"><span><i class="key d-great"></i>Below market</span><span><i class="key d-fair"></i>At market</span><span><i class="key d-over"></i>Above market</span></div>
    </article>`;

    const valueCard = `<article class="card insight">
      <header><h3>Priced lowest for what they are</h3>
      <p class="muted">Recent model years under 80k miles, ranked by distance below expected value — not a “deal badge”, just the math.</p></header>
      <ul class="rank-list">${values.map((l) => {
        const m = marketText(l);
        return `<li><a href="#/car/${l.id}"><span><b>${esc(title(l))} ${esc(l.trim)}</b><small>${kMiles(l.miles)} · ${esc(l.city)}, ${esc(l.state)}</small></span>
        <span class="r"><b>${money(l.price)}</b><small class="good">${money(-m.diff)} below (${pct(-m.d)})</small></span></a></li>`;
      }).join('')}</ul>
      <a class="card-cta" href="${searchHref({ belowMarket: 1, condition: ['Used', 'Certified'] })}">Everything below market →</a>
    </article>`;

    // Velocity: which models are selling fastest right now.
    const soldBy = Market.groupBy(SOLD.filter((l) => l.sold.daysAgo < 45), (l) => `${l.make} ${l.model}`);
    const activeBy = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const fast = [...soldBy.entries()].filter(([, g]) => g.length >= 12)
      .map(([k, g]) => ({ k, g, med: Market.median(g.map((l) => l.sold.daysToSell)), v: Market.velocity(activeBy.get(k) || [], SOLD.filter((l) => `${l.make} ${l.model}` === k)) }))
      .sort((a, b) => a.med - b.med).slice(0, 5);
    const fastCard = !fast.length ? '' : `<article class="card insight">
      <header><h3>${badge('Sold', 'b-sold')} ${esc(fast[0].k)}s are selling fastest</h3>
      <p class="muted">Median days from listing to sale, last 45 days · days of supply at the current sales pace</p></header>
      <ul class="rank-list">${fast.map(({ k, g, med, v }) => `<li><a href="${searchHref({ model: k, when: 'sold', sort: 'sold-fastest' })}">
        <span><b>${esc(k)}</b><small>${plural(g.length, 'sale')} · ${v.daysOfSupply ? Math.round(v.daysOfSupply) + ' days of supply' : '—'}</small></span>
        <span class="r"><b>${Math.round(med)} days</b><small>${v.saleToList ? pct(v.saleToList) + ' of first list price' : ''}</small></span></a></li>`).join('')}</ul>
      <a class="card-cta" href="${searchHref({ when: 'sold', sort: 'sold-recent' })}">Browse recently sold cars →</a>
    </article>`;

    const inv = Market.inventorySeries(LISTINGS, SOLD, Market.emptyFilters(), CTX, 90);
    const first = inv.series[0].count, last = inv.series[inv.series.length - 1].count;
    const trendCard = `<article class="card insight">
      <header><h3>Inventory is ${last >= first ? 'up' : 'down'} ${pct(Math.abs(last / first - 1))} over 90 days</h3>
      <p class="muted">Cars for sale nationwide each day, with the median asking price · ${num(inv.sold30)} sold in the last 30 days</p></header>
      ${Charts.trend(inv.series, { aria: 'Cars for sale nationwide over the last 90 days' })}
      <div class="legend"><span><i class="key inv"></i>For sale</span><span><i class="key med"></i>Median price</span></div>
      <a class="card-cta" href="${searchHref({ when: '90' })}">See the market as it was 3 months ago →</a>
    </article>`;

    const rare = Market.rareSpecs(LISTINGS, rarity, 10);
    const rareHtml = `<div class="rare-head" id="rare-specs"><h3>💎 Rare specs</h3><p class="muted">Unusual color and option combinations — few exist anywhere in the country.</p>
      <div class="scroller-btns"><button class="icon-btn" type="button" data-action="scroll" data-dir="-1" aria-label="Scroll left">‹</button><button class="icon-btn" type="button" data-action="scroll" data-dir="1" aria-label="Scroll right">›</button></div></div>
      <div class="scroller" id="rare-scroller">${rare.map(({ l, r }) => `<article class="card rare-card">
        <a class="card-link" href="#/car/${l.id}" aria-label="${esc(title(l))}"></a>
        <div class="card-art" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex)}</div>
        <div class="card-body">
          <h4>${esc(title(l))}</h4>
          <p class="card-sub">${conditionBadge(l)} ${esc(l.trim)} · ${kMiles(l.miles)}</p>
          <p class="price">${money(l.price)} <small class="muted">· ${esc(days(l.daysListed))}</small></p>
          <p class="muted small">Of the ${num(r.total)} ${esc(l.model)}s for sale nationwide</p>
          <dl class="rarity">
            <div><dt>Exterior</dt><dd><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</dd><span class="of">1 of ${r.extCount}</span></div>
            <div><dt>Interior</dt><dd>${esc(l.intColor)}</dd><span class="of">1 of ${r.intCount}</span></div>
            <div><dt>Options</dt><dd>${money(r.optionsTotal)}</dd><span class="of">${pct(r.optionsVsAvg)} above avg</span></div>
          </dl>
        </div></article>`).join('')}</div>`;

    return `<div class="insight-head">
        <div><h2>What the market's doing</h2><p class="eyebrow">Week of ${esc(weekOf)}</p></div>
        <a class="chip-link" href="#rare-specs" data-action="jump" data-target="rare-specs">💎 Rare specs</a>
      </div>
      <div class="insight-grid">${arrivalsCard}${moverCard}${fastCard}${trendCard}${retentionCard}${dropsCard}${mapCard}${valueCard}</div>
      ${rareHtml}`;
  }

  function liveInsightsShell() {
    return `<div class="insight-head"><div><h2>What the market's doing</h2><p class="eyebrow">Live from ${esc(srcName())} · ${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</p></div></div>
      <div class="insight-grid" id="live-insights">${loadingHtml('Loading the live market…')}</div>`;
  }

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
            <p class="muted small">Sold-car trends, price drops and inventory history need a source with sales history (Visor). The free auto.dev plan covers cars for sale now.</p></article>`;
      } catch (e) {
        if (document.getElementById('live-insights')) grid.innerHTML = liveErrorHtml(e);
      }
      return;
    }
    try {
      const [active, sold30, fast, deals, makes] = await Promise.all([
        Live.count({ ex: {} }, ctx),
        Live.count({ ex: {} }, ctx, { inventory_status: 'sold', sold_within_days: 30 }),
        Live.request('/v1/facets', { inventory_status: 'sold', sold_within_days: 30, facets: 'model', facet_value_limit: 60, metrics: 'days_on_market.median,price.median' }),
        Live.request('/v1/listings', { inventory_type: 'new', sort: 'discount', limit: 8, min_msrp: 20000 }),
        Live.request('/v1/facets', { facets: 'make', facet_value_limit: 12, metrics: 'price.median,days_on_market.median' }),
      ]);
      if (!document.getElementById('live-insights')) return;
      const fastest = Live.bucketsOf(fast.data && fast.data.facets && fast.data.facets.model)
        .filter((b) => b.count >= 50 && b.metrics && b.metrics['days_on_market.median'] != null)
        .sort((a, b) => a.metrics['days_on_market.median'] - b.metrics['days_on_market.median']).slice(0, 6);
      const discountCars = (deals.data || []).map(Live.normalize);
      discountCars.forEach((l) => LIVE_SEEN.set(l.id, l));
      const makeRows = Live.bucketsOf(makes.data && makes.data.facets && makes.data.facets.make);
      grid.innerHTML = `
        <article class="card insight"><header><h3>${badge('Live', 'b-live')} ${num(active)} cars for sale nationwide</h3>
          <p class="muted">${num(sold30)} sold in the last 30 days, about ${num(sold30 / 30)} a day · ${active && sold30 ? Math.round(active / (sold30 / 30)) + ' days of supply' : ''}</p></header>
          <ul class="rank-list">${makeRows.map((b) => `<li><a href="${searchHref({ make: b.value })}"><span><b>${esc(b.value)}</b><small>${b.metrics && b.metrics['days_on_market.median'] != null ? Math.round(b.metrics['days_on_market.median']) + ' median days listed' : ''}</small></span>
            <span class="r"><b>${num(b.count)}</b><small>${b.metrics && b.metrics['price.median'] ? 'median ' + money(b.metrics['price.median']) : ''}</small></span></a></li>`).join('')}</ul></article>
        <article class="card insight"><header><h3>${badge('Sold', 'b-sold')} Selling fastest right now</h3><p class="muted">Median days from listing to sale, last 30 days (models with 50+ sales)</p></header>
          <ul class="rank-list">${fastest.map((b) => `<li><a href="${searchHref({ model: b.value, when: 'sold' })}"><span><b>${esc(b.value)}</b><small>${plural(b.count, 'sale')}</small></span>
            <span class="r"><b>${Math.round(b.metrics['days_on_market.median'])} days</b><small>${b.metrics['price.median'] ? 'median ' + money(b.metrics['price.median']) : ''}</small></span></a></li>`).join('') || '<li class="muted">Not enough sales data.</li>'}</ul></article>
        <article class="card insight wide"><header><h3>${badge('New', 'b-new')} Biggest discounts off MSRP on new cars</h3><p class="muted">Live listings, MSRP over $20,000</p></header>
          <div class="listing-grid compact">${discountCars.map((l) => listingCard(l)).join('')}</div>
          <a class="card-cta" href="${searchHref({ condition: 'New', sort: 'discount', msrpMin: 20000 })}">See all new-car discounts →</a></article>`;
    } catch (e) {
      if (document.getElementById('live-insights')) grid.innerHTML = liveErrorHtml(e);
    }
  }

  function deltaClass(d) {
    if (d == null) return 'tile-empty';
    return d <= -0.025 ? 'd-great' : d <= -0.008 ? 'd-good' : d < 0.008 ? 'd-fair' : d < 0.025 ? 'd-high' : 'd-over';
  }

  function renderHome(scrollTo) {
    const states = new Set(LISTINGS.map((l) => l.state)).size;
    const featured = (Market.rareSpecs(LISTINGS, rarity, 1)[0] || { l: LISTINGS[0] }).l;
    const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const popular = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
    setView('home', `
      <section class="hero">
        <div class="hero-grid" aria-hidden="true"></div>
        <div class="hero-inner">
          <p class="eyebrow">${isLive() ? `Live listings from ${esc(srcName())}` : `${num(LISTINGS.length)} cars · ${num(DATA.dealers.length)} dealers · ${states} states · ${num(SOLD.length)} recent sales · demo data`}</p>
          <h1>See the whole market.<span>Not just pages of listings.</span></h1>
          <div id="hero-search"></div>
          <div class="quick"><span class="muted">Try</span>${quickFor().slice(0, 6).map((q) => `<a class="chip-link" href="${q.href}">${esc(q.label)}</a>`).join('')}</div>
        </div>
        ${isLive() ? `<div class="hero-feature" aria-hidden="true">${Charts.car('Coupe', '#2367b2', { cls: 'hero-car' })}</div>` : `<a class="hero-feature" href="#/car/${featured.id}" style="--paint:${esc(featured.extHex)}">
          ${Charts.car(featured.body, featured.extHex, { cls: 'hero-car' })}
          <span class="hero-caption"><b>${esc(title(featured))} in ${esc(featured.extColor)}</b><small>${money(featured.price)} · ${esc(featured.city)}, ${esc(featured.state)}</small></span>
        </a>`}
      </section>

      <section class="section" id="insights">${isLive() ? liveInsightsShell() : insightsHtml()}</section>

      <section class="section pitch">
        <h2 class="center">Built to help you buy a car, not to help a dealer sell one.</h2>
        <div class="pitch-grid">
          <div class="card pitch-them">
            <h3>Typical listing sites</h3>
            <p class="muted">are built for <b>dealers</b>, by</p>
            <ul class="x-list">
              <li>Selling your contact info as “leads”</li>
              <li>Ranking paid placements above better cars</li>
              <li>Hiding price history and time on the lot</li>
              <li>Opaque “great deal” badges you can’t check</li>
              <li>Filters that happily return zero results</li>
            </ul>
          </div>
          <div class="card pitch-us">
            <h3>Gridline</h3>
            <p class="muted">is built for <b>you</b>, the buyer — every pro tool included</p>
            <ul class="feature-list">
              <li><span>💬</span><div><b>Search the way you talk</b><p>“4x4 trucks under 50k miles near Denver” or “RAV4 hybrid without sunroof”.</p></div></li>
              <li><span>🧩</span><div><b>Filter by what’s actually on the car</b><p>Installed options, top features, upfitter, assembly plant, MSRP and VIN patterns — include or exclude.</p></div></li>
              <li><span>⏳</span><div><b>Sold cars and the market over time</b><p>See what sold and how fast, or rewind the market a week, a month or three months.</p></div></li>
              <li><span>🧮</span><div><b>Transparent fair value & Deal Check</b><p>Every price compared with the same car, and any deal broken into price, fees, add-ons and trade.</p></div></li>
              <li><span>🏁</span><div><b>Leaderboard & comparables</b><p>Where a car ranks among its true peers — same trim, nearby, similar MSRP.</p></div></li>
              <li><span>📄</span><div><b>Window sticker, seller history, pricing breakdown</b><p>What it left the factory with, where it was listed before, and what the ad leaves out.</p></div></li>
            </ul>
          </div>
        </div>
      </section>

      <section class="section browse">
        <h2>Browse the market</h2>${isLive() ? '<p class="muted small">Counts below are from the demo sample; each link searches live listings.</p>' : ''}
        <div class="browse-grid">
          ${popular.map(([key, g]) => {
            const used = g.filter((l) => l.condition !== 'New');
            return `<a class="browse-item" href="${searchHref({ model: key })}"><b>${esc(key)}</b><small>${plural(g.length, 'car')} · used median ${money(Market.median(used.map((l) => l.price)))}</small></a>`;
          }).join('')}
        </div>
      </section>`);
    mountSearchBox(document.getElementById('hero-search'), { size: 'lg' });
    if (isLive()) fillLiveInsights();
    if (scrollTo) requestAnimationFrame(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' }));
    else window.scrollTo(0, 0);
  }

  /* ----- Search ----- */

  let S = null; // search view state

  const SORTS = [['best', 'Best price for the car'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'],
    ['discount', 'Biggest discount from MSRP'], ['msrp-desc', 'MSRP: high to low'], ['msrp-asc', 'MSRP: low to high'],
    ['miles-asc', 'Miles: low to high'], ['miles-desc', 'Miles: high to low'], ['year-desc', 'Year: newest'],
    ['newest', 'Recently listed'], ['oldest', 'Longest for sale'], ['distance', 'Distance from home'],
    ['sold-recent', 'Recently sold'], ['sold-fastest', 'Sold fastest']];

  function renderSearch(params) {
    S = { f: filtersFromParams(params), shown: PAGE, layout: S ? S.layout : 'grid', filtersOpen: false, exMode: {}, finder: '' };
    setView('search', `
      <div class="search-layout">
        <aside class="filters" id="filters" aria-label="Filters"></aside>
        <section class="results-pane">
          <div class="results-top">
            <button class="btn ghost filters-toggle" type="button" data-action="toggle-filters">⚙ Filters</button>
            <form class="q-wrap" id="q-form" role="search"><svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
              <input id="q-input" type="search" placeholder="Refine, or type a whole search: “white 4runner with tow package”" aria-label="Refine results" value="${esc(S.f.q)}"></form>
            <label class="sort"><span class="sr-only">Sort</span><select id="sort-select"></select></label>
            <div class="seg" role="group" aria-label="Layout">
              <button type="button" data-action="layout" data-layout="grid" aria-label="Grid view" title="Grid">▦</button>
              <button type="button" data-action="layout" data-layout="table" aria-label="Table view" title="Table">☰</button>
              <button type="button" data-action="layout" data-layout="map" aria-label="Map view" title="Map">◎</button>
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
      if (!S.results || !S.live) resultsEl.innerHTML = loadingHtml(`Searching live listings from ${srcName()}…`);
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

  const HEX = (() => {
    const m = new Map();
    for (const l of ALL) if (!m.has(l.extColor)) m.set(l.extColor, l.extHex);
    return m;
  })();
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
        <input id="finder-input" type="search" placeholder="Search filters: “brown interior”, “without sunroof”" aria-label="Search filters" value="${esc(S.finder)}" autocomplete="off">
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
          <select id="near" data-near>
            <option value="">Anywhere in the US</option>
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
        ${facetList('seller', facets, { hint: S.live ? `Franchise or independent dealer. ${esc(srcName())} covers dealer listings only.` : null })}
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
    if (f.near) chips.push({ label: `${f.radius} mi of ${f.near}`, k: 'near' });
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
      S.f.q ? `${esc(srcName())} doesn’t support free-text search, so “${esc(S.f.q)}” isn’t applied. Try describing it in the main search box.` : '',
      S.dropped ? `${esc(srcName())} doesn’t support one of these filters (<code>${esc(S.dropped)}</code>), so it was skipped.` : '',
      S.f.belowMarket || S.f.dropsOnly ? '“Below market only” and “Has price cuts” apply to demo data only.' : '',
    ].filter(Boolean) : [];
    const head = `${activeChips()}
      <div class="results-summary" aria-live="polite">${sentenceHtml(sum.count)}
        <p class="muted">${esc(describeFilters(S.f))}${when ? ` · as of ${dateDaysAgo(when)}` : ''}${live ? ` · <span class="live-src">Live listings from ${srcLink()}</span>` : ''}</p>
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
    const tiles = Charts.tileMap((st) => {
      const g = byState.get(st);
      const n = live ? liveStates.get(st) || 0 : g ? g.length : 0;
      if (!n) return S.f.state.includes(st) ? { cls: 'cnt-0', value: 0, selected: true, title: st } : null;
      const hi = live ? Math.max(1, ...liveStates.values()) : 60;
      const cls = n >= hi * (live ? 0.5 : 1) ? 'cnt-4' : n >= hi * (live ? 0.2 : 25 / 60) ? 'cnt-3' : n >= hi * (live ? 0.07 : 10 / 60) ? 'cnt-2' : 'cnt-1';
      return { cls, value: n >= 10000 ? Math.round(n / 1000) + 'k' : n, title: `${st}: ${plural(n, 'car')}${g && !live ? `, median ${money(Market.median(g.map((l) => l.price)))}` : ''}`, selected: S.f.state.includes(st) };
    }, { clickable: true, size: 40, aria: 'Matching cars by state' });

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
      trendCard = `<div class="card viz trend-card trend-cta"><div><h3>Inventory over time</h3><p class="muted small">See how many of these cars were for sale over the last 90 days and how many sold. Uses 9 Visor requests (about 3¢).</p></div>
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
    const c = S.f.near ? cityByName(S.f.near) : null;
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
    setView('car', `<section class="narrow">${loadingHtml(`Loading listing from ${srcName()}…`)}</section>`);
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
      <p class="muted small">Listing data from ${srcLink()}.</p>
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
          ${l.windowStickerVerified ? `<p class="st-note">${esc(srcName())} verified this VIN against its original window sticker.</p>` : ''}
          ${l.upfitter ? `<p class="st-note">Upfitted after delivery by <b>${esc(l.upfitter.name)}</b> (${esc(l.upfitter.category.toLowerCase())}). Upfit content is not part of the factory MSRP.</p>` : ''}
        </section>
      </div>
      <p class="st-foot">Reconstructed from listing data${l.live ? ` (${esc(srcName())})` : ''} for reference. Confirm with the original Monroney label from the seller.</p>
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
      <p class="st-foot">${l.live && l.options.length ? `Option codes from ${esc(srcName())}.` : 'Option codes are illustrative.'} Reconstructed from listing data.</p>
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
        if (!l) { el.innerHTML = `<p class="muted">${esc(srcName())} has no listing for this VIN.</p>`; return; }
        rememberLive(l);
        el.innerHTML = `<h2 class="sec-title">${l.sold ? 'This VIN sold recently' : 'This VIN is for sale'}</h2><div class="listing-grid compact">${listingCard(l)}</div>`;
      }, (e) => { const el = document.getElementById('vin-live'); if (el) el.innerHTML = e.code === 'not_found' ? `<p class="muted">${esc(srcName())} hasn’t seen this VIN.</p>` : liveErrorHtml(e); });
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
      ${isLive() && d.wellFormed ? `<div id="vin-live">${loadingHtml(`Looking up this VIN on ${srcName()}…`)}</div>` : match ? `<h2 class="sec-title">${match.sold ? 'This VIN sold recently' : 'This VIN is for sale'}</h2><div class="listing-grid compact">${listingCard(match)}</div>` : `<p class="muted">No current listing matches this VIN.${d.make && d.year ? ` <a href="${searchHref({ make: d.make, year: d.year })}">See ${d.year} ${esc(d.make)}s for sale →</a>` : ''}</p>`}
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
    const r = await Live.search(Object.assign({}, f, { sort: 'newest' }), liveCtx(), { lite: true });
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
      const note = `<p class="muted small">From ${complete ? 'all' : `the newest ${num(results.length)} of`} ${plural(total, 'match')} on ${esc(srcName())}${can('velocity') ? '' : '. Sales history needs a Visor key'}.</p>`;
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
        <label class="set-row"><span><b>Check watched hunts</b><small>While Gridline is open, including in the background. ${isLive() ? `Each check uses 1 ${esc(srcName())} request per hunt${SOURCE() === 'autodev' ? huntBudgetText() : ''}.` : 'Demo checks are free.'}</small></span>
          <select data-pref="huntEvery">${HUNT_EVERY.map(([v, t]) => `<option value="${v}" ${p.huntEvery === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="set-row"><span><b>Notifications</b><small>${{ desktop: 'Native notifications from the desktop app. You can turn them off in your system’s notification settings.', granted: 'This browser will show notifications from Gridline.', denied: 'Blocked in this browser. Allow notifications for this site in its settings to get them.', unsupported: 'This browser can’t show notifications. Use the desktop app.' }[notifyState()] || 'Allow notifications to hear about new matches and price cuts.'}</small></span>
          ${notifyState() === 'default' ? '<button class="btn ghost" type="button" data-action="notify-allow">Allow notifications</button>' : ''}</div>
      </div>
      <h2 class="sec-title">Display</h2>
      <div class="card settings">
        <label class="set-row"><span><b>Home location</b><small>Used for distances on every listing and the “Distance from home” sort.</small></span>
          <select data-pref="homeCity"><option value="">Not set</option>${CITY_NAMES.map((c) => `<option ${p.homeCity === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
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
      out.innerHTML = `<span class="good">✓ Connected to ${esc(srcName())}</span> · ${num(n)} cars for sale nationwide · via ${route === 'desktop' ? 'the desktop app' : route === 'proxy' ? 'the local server' : 'direct browser request'}`;
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
      pill.title = live ? `Searching live listings from ${srcName()}` : 'Showing sample data. Switch to live data in Settings.';
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
    if (tile) { onTile(tile.dataset.state); return; }
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
      document.getElementById('rare-scroller').scrollBy({ left: Number(el.dataset.dir) * 320, behavior: 'smooth' });
    } else if (a === 'jump') {
      e.preventDefault();
      document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth' });
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
      onTile(e.target.dataset.state);
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

  function onTile(st) {
    if (view.name === 'search') {
      updateFilters((f) => { f.state = f.state.includes(st) ? f.state.filter((x) => x !== st) : [...f.state, st]; });
    } else {
      location.hash = searchHref({ state: st, condition: ['Used', 'Certified'], belowMarket: 1 });
    }
  }

  function onMapCity(city) {
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
        s.prefs[k] = t.type === 'checkbox' ? t.checked : k === 'showDealer' ? t.value === '1' : k === 'huntEvery' ? Number(t.value) : t.value || null;
        if (k === 'dataSource') s.prefs.sourceChosen = true;
      });
      if (k === 'dataSource') {
        syncProvider();
        LIVE_KNOWN = null;
        applyModeUi();
        renderSettings();
        toast(t.value === 'demo' ? 'Using demo data' : isLive() ? `Live data from ${srcName()}` : `Add your ${Live.info(t.value).name} API key to use live data`);
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
    document.getElementById('header-search').hidden = !parts.length;
    if (!parts.length) return renderHome();
    if (parts[0] === 'insights') return renderHome('insights');
    if (parts[0] === 'search') return renderSearch(params);
    if (parts[0] === 'car') return renderCar(parts[1], params);
    if (parts[0] === 'vin') return renderVin(parts[1] || '');
    if (parts[0] === 'compare') return renderCompare();
    if (parts[0] === 'saved') return renderSaved();
    if (parts[0] === 'hunt') return renderHunt(parts[1]);
    if (parts[0] === 'settings') return renderSettings();
    return renderNotFound();
  }

  function footerLinks() {
    const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const top = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
    const segs = [...new Set(DATA.models.map((m) => m.seg))];
    document.getElementById('footer-links').innerHTML = `
      <div><h4>Popular searches</h4>${top.map(([k]) => `<a href="${searchHref({ model: k })}">${esc(k)}</a>`).join('')}</div>
      <div><h4>Used prices by segment</h4>${segs.map((s) => `<a href="${searchHref({ q: s, condition: ['Used', 'Certified'] })}">${esc(s)}</a>`).join('')}</div>
      <div><h4>Tools</h4><a href="#/insights">Market insights</a><a href="${searchHref({ when: 'sold', sort: 'sold-recent' })}">Recently sold</a><a href="#/compare">Compare cars</a><a href="#/saved">Hunts</a><a href="#/vin/${LISTINGS[0].vin}">VIN decoder</a><a href="#/settings">Settings</a></div>`;
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
