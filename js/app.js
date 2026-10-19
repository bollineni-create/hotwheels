/* Gridline app: hash-routed views over the in-memory market. */
(function () {
  'use strict';

  const { esc } = Charts;
  const CURRENT_YEAR = 2026;
  const PAGE = 24;

  /* ---------- Data + derived models ---------- */

  const DATA = MarketData.generateInventory({ currentYear: CURRENT_YEAR });
  const LISTINGS = DATA.listings;
  const BY_ID = new Map(LISTINGS.map((l) => [l.id, l]));
  const BY_VIN = new Map(LISTINGS.map((l) => [l.vin, l]));
  const fairValue = Market.buildFairValue(LISTINGS, CURRENT_YEAR);
  const expectedCache = new Map();
  const expected = (l) => {
    if (!expectedCache.has(l.id)) expectedCache.set(l.id, fairValue(l));
    return expectedCache.get(l.id);
  };
  const delta = (l) => {
    const e = expected(l);
    return e ? l.price / e - 1 : 0;
  };
  const rarity = Market.colorStats(LISTINGS);
  const CITY_NAMES = [...new Set(DATA.cities.map((c) => `${c[0]}, ${c[1]}`))].sort();
  const cityByName = (name) => DATA.cities.find((c) => `${c[0]}, ${c[1]}` === name);
  const CTX = { delta, cityByName };
  const MODEL_KEYS = DATA.models.map((m) => `${m.make} ${m.model}`);
  const modelOf = (key) => DATA.models.find((m) => `${m.make} ${m.model}` === key);

  /* ---------- Persistence ---------- */

  const STORE_KEY = 'gridline:v1';
  const store = (() => {
    let s = { saved: [], favs: {}, compare: [], recent: [], theme: null };
    try { s = Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) { /* private mode */ }
    return {
      get: () => s,
      update(fn) {
        fn(s);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
        updateNavCounts();
      },
    };
  })();

  /* ---------- Formatting ---------- */

  const money = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'));
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const miles = (n) => `${num(n)} mi`;
  const kMiles = (n) => (n < 1000 ? `${num(n)} mi` : `${Math.round(n / 1000)}k mi`);
  const pct = (v, digits) => `${(v * 100).toFixed(digits == null ? 0 : digits)}%`;
  const title = (l) => `${l.year} ${l.make} ${l.model}`;
  const days = (d) => (d === 0 ? 'Listed today' : d === 1 ? '1 day for sale' : `${d} days for sale`);
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

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

  /* ---------- Filters <-> URL ---------- */

  const ARRAY_KEYS = Market.FACETS;
  const NUM_KEYS = ['priceMin', 'priceMax', 'milesMax', 'radius'];
  const BOOL_KEYS = ['dropsOnly', 'belowMarket'];

  function filtersFromParams(params) {
    const f = Market.emptyFilters();
    for (const k of ARRAY_KEYS) f[k] = params.getAll(k);
    for (const k of NUM_KEYS) if (params.get(k)) f[k] = Number(params.get(k));
    for (const k of BOOL_KEYS) f[k] = params.get(k) === '1';
    f.q = params.get('q') || '';
    f.near = params.get('near') || null;
    f.sort = params.get('sort') || 'best';
    return f;
  }

  function paramsFromFilters(f) {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    for (const k of ARRAY_KEYS) for (const v of f[k] || []) p.append(k, v);
    for (const k of NUM_KEYS) if (f[k] != null && !(k === 'radius' && (f[k] === 150 || !f.near))) p.set(k, f[k]);
    for (const k of BOOL_KEYS) if (f[k]) p.set(k, '1');
    if (f.near) p.set('near', f.near);
    if (f.sort && f.sort !== 'best') p.set('sort', f.sort);
    return p;
  }

  const searchHref = (obj) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) [].concat(v).forEach((x) => p.append(k, x));
    return '#/search?' + p.toString();
  };

  function describeFilters(f) {
    const parts = [];
    if (f.condition.length) parts.push(f.condition.join('/'));
    if (f.year.length) parts.push(f.year.join(', '));
    if (f.model.length) parts.push(f.model.join(', '));
    else if (f.make.length) parts.push(f.make.join(', '));
    if (f.trim.length) parts.push(f.trim.join(', '));
    if (f.body.length) parts.push(f.body.join('/'));
    if (f.fuel.length) parts.push(f.fuel.join('/'));
    if (f.drivetrain.length) parts.push(f.drivetrain.join('/'));
    if (f.extColor.length) parts.push(f.extColor.join(', '));
    if (f.q) parts.push(`“${f.q}”`);
    if (f.priceMin != null) parts.push(`over ${money(f.priceMin)}`);
    if (f.priceMax != null) parts.push(`under ${money(f.priceMax)}`);
    if (f.milesMax != null) parts.push(`< ${kMiles(f.milesMax)}`);
    if (f.near) parts.push(`within ${f.radius} mi of ${f.near}`);
    if (f.state.length) parts.push(`in ${f.state.join(', ')}`);
    if (f.dropsOnly) parts.push('with price cuts');
    if (f.belowMarket) parts.push('below market');
    return parts.join(' · ') || 'All cars';
  }

  /* ---------- Shared UI bits ---------- */

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function updateNavCounts() {
    const s = store.get();
    const set = (id, n) => {
      const el = document.getElementById(id);
      el.hidden = !n;
      el.textContent = n;
    };
    set('saved-count', s.saved.length + Object.keys(s.favs).length);
    set('compare-count', s.compare.length);
  }

  function badge(text, cls) {
    return `<span class="badge ${cls || ''}">${esc(text)}</span>`;
  }

  function conditionBadge(l) {
    return badge(l.condition, 'b-' + l.condition.toLowerCase());
  }

  function deltaChip(l) {
    const m = marketText(l);
    if (!m) return '';
    return `<span class="mkt mkt-${m.tone}" title="Compared with similar ${esc(l.make + ' ' + l.model)}s, adjusted for year, mileage and trim. Expected ≈ ${money(m.expected)}">${esc(m.label)}</span>`;
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

  function listingCard(l, opts) {
    const cut = Market.lastChange(l);
    const sub = [l.trim, kMiles(l.miles), l.drivetrain].filter(Boolean).join(' · ');
    return `<article class="card listing-card">
      <a class="card-link" href="#/car/${l.id}" aria-label="${esc(title(l) + ' ' + l.trim + ', ' + money(l.price))}"></a>
      <div class="card-art" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex, { label: `${l.extColor} ${l.model}` })}
        <div class="card-art-top">${conditionBadge(l)}${l.status && l.status !== 'On lot' ? badge(l.status, 'b-status') : ''}</div>
        <div class="card-art-actions">${favButton(l)}</div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(title(l))}</h3>
        <p class="card-sub">${esc(sub)}</p>
        <div class="card-price-row">
          <span class="price">${money(l.price)}</span>
          ${deltaChip(l)}
        </div>
        <p class="card-meta">${esc(l.city)}, ${esc(l.state)} · ${esc(days(l.daysListed))}${cut && cut.delta < 0 ? ` · <span class="drop">↓ ${money(-cut.delta)} ${cut.daysAgo <= 1 ? 'today' : cut.daysAgo + 'd ago'}</span>` : ''}</p>
        ${opts && opts.noCompare ? '' : `<div class="card-foot">${compareButton(l)}<span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span></div>`}
      </div>
    </article>`;
  }

  /* ---------- Search box with typeahead ---------- */

  function suggestions(raw) {
    const q = raw.trim();
    const out = [];
    if (!q) {
      for (const s of store.get().saved.slice(0, 4)) out.push({ icon: '★', label: s.name, sub: 'Saved search', href: '#/search?' + s.params });
      for (const p of QUICK.slice(0, 5)) out.push({ icon: '↗', label: p.label, sub: 'Popular search', href: p.href });
      return out;
    }
    const compact = q.toUpperCase().replace(/[\s-]/g, '');
    if (/^[A-Z0-9]{11,17}$/.test(compact) && /\d/.test(compact)) {
      const hit = BY_VIN.get(compact) || LISTINGS.find((l) => l.vin.endsWith(compact) || l.vin.startsWith(compact));
      if (hit) out.push({ icon: '#', label: `${title(hit)} ${hit.trim}`, sub: `VIN ${hit.vin} · ${money(hit.price)}`, href: `#/car/${hit.id}` });
      if (compact.length === 17) out.push({ icon: '⌁', label: `Decode VIN ${compact}`, sub: 'Check digit, model year, manufacturer', href: `#/vin/${compact}` });
    }
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const yearTok = toks.find((t) => /^(19|20)\d\d$/.test(t));
    const words = toks.filter((t) => t !== yearTok);
    const hit = (s) => words.every((t) => s.toLowerCase().includes(t));
    if (words.length) {
      const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
      for (const key of MODEL_KEYS.filter(hit).slice(0, 5)) {
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
      const dealers = DATA.dealers.filter((d) => hit(`${d.name} ${d.city} ${d.state}`)).slice(0, 3);
      for (const d of dealers) {
        out.push({ icon: '⌂', label: d.name, sub: `Dealer · ${d.city}, ${d.state}`, href: searchHref({ q: d.name, state: d.state }) });
      }
      const cities = CITY_NAMES.filter((c) => hit(c)).slice(0, 2);
      for (const c of cities) out.push({ icon: '◎', label: `Cars near ${c}`, sub: 'Within 150 miles', href: searchHref({ near: c }) });
      for (const s of store.get().saved.filter((s) => hit(s.name)).slice(0, 2)) out.push({ icon: '★', label: s.name, sub: 'Saved search', href: '#/search?' + s.params });
    }
    out.push({ icon: '↵', label: `Search all listings for “${q}”`, sub: 'Matches model, trim, color, dealer, city or VIN', href: searchHref({ q }) });
    return out.slice(0, 9);
  }

  let searchBoxSeq = 0;
  function mountSearchBox(container, opts) {
    const id = 'sb' + ++searchBoxSeq;
    container.innerHTML = `<form class="searchbox ${opts.size || ''}" role="search" autocomplete="off">
      <svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="${id}" type="search" placeholder="${esc(opts.placeholder || 'Search models, VINs, dealers or cities')}" aria-label="Search cars"
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

  const QUICK = [
    { label: '4Runners under $35k', href: searchHref({ model: 'Toyota 4Runner', priceMax: 35000, sort: 'price-asc' }) },
    { label: 'Trucks priced below market', href: searchHref({ body: 'Truck', belowMarket: 1 }) },
    { label: 'EVs with recent price cuts', href: searchHref({ fuel: 'Electric', dropsOnly: 1, sort: 'newest' }) },
    { label: 'SUVs near Denver', href: searchHref({ body: 'SUV', near: 'Denver, CO' }) },
    { label: 'Certified Lexus', href: searchHref({ make: 'Lexus', condition: 'Certified' }) },
    { label: 'Under 30k miles, under $25k', href: searchHref({ milesMax: 30000, priceMax: 25000, sort: 'price-asc' }) },
  ];

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
      <div class="insight-grid">${arrivalsCard}${moverCard}${retentionCard}${dropsCard}${mapCard}${valueCard}</div>
      ${rareHtml}`;
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
          <p class="eyebrow">${num(LISTINGS.length)} cars · ${num(DATA.dealers.length)} dealers · ${states} states</p>
          <h1>See the whole market.<span>Not just pages of listings.</span></h1>
          <div id="hero-search"></div>
          <div class="quick"><span class="muted">Try</span>${QUICK.map((q) => `<a class="chip-link" href="${q.href}">${esc(q.label)}</a>`).join('')}</div>
        </div>
        <a class="hero-feature" href="#/car/${featured.id}" style="--paint:${esc(featured.extHex)}">
          ${Charts.car(featured.body, featured.extHex, { cls: 'hero-car' })}
          <span class="hero-caption"><b>${esc(title(featured))} in ${esc(featured.extColor)}</b><small>${money(featured.price)} · ${esc(featured.city)}, ${esc(featured.state)}</small></span>
        </a>
      </section>

      <section class="section" id="insights">${insightsHtml()}</section>

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
            <p class="muted">is built for <b>you</b>, the buyer</p>
            <ul class="feature-list">
              <li><span>🗺️</span><div><b>Search by distance, not ZIP code</b><p>Pick a city and a radius — state lines and lakes don’t matter.</p></div></li>
              <li><span>📊</span><div><b>The whole market on one chart</b><p>Every match plotted by price and miles, so outliers jump out.</p></div></li>
              <li><span>🧮</span><div><b>Transparent fair value</b><p>Each car is compared with the same model, adjusted for year, trim and mileage — with the dollar math shown.</p></div></li>
              <li><span>📈</span><div><b>Full price history</b><p>See every cut and how long a car has been sitting before you call.</p></div></li>
              <li><span>💡</span><div><b>Filters that know the inventory</b><p>Every option shows its live count. Zero-result choices never appear.</p></div></li>
              <li><span>🔎</span><div><b>VIN decoder, compare, saved searches</b><p>Check a VIN’s check digit and year, line cars up side by side, and keep searches — all stored only in your browser.</p></div></li>
            </ul>
          </div>
        </div>
      </section>

      <section class="section browse">
        <h2>Browse the market</h2>
        <div class="browse-grid">
          ${popular.map(([key, g]) => {
            const used = g.filter((l) => l.condition !== 'New');
            return `<a class="browse-item" href="${searchHref({ model: key })}"><b>${esc(key)}</b><small>${plural(g.length, 'car')} · used median ${money(Market.median(used.map((l) => l.price)))}</small></a>`;
          }).join('')}
        </div>
      </section>`);
    mountSearchBox(document.getElementById('hero-search'), { size: 'lg' });
    if (scrollTo) requestAnimationFrame(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' }));
    else window.scrollTo(0, 0);
  }

  /* ----- Search ----- */

  let S = null; // search view state

  function renderSearch(params) {
    S = { f: filtersFromParams(params), shown: PAGE, layout: S ? S.layout : 'grid', filtersOpen: false };
    setView('search', `
      <div class="search-layout">
        <aside class="filters" id="filters" aria-label="Filters"></aside>
        <section class="results-pane">
          <div class="results-top">
            <button class="btn ghost filters-toggle" type="button" data-action="toggle-filters">⚙ Filters</button>
            <div class="q-wrap"><svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
              <input id="q-input" type="search" placeholder="Refine: trim, color, dealer, city, VIN…" aria-label="Refine results" value="${esc(S.f.q)}"></div>
            <label class="sort"><span class="sr-only">Sort</span>
              <select id="sort-select">
                ${[['best', 'Best price for the car'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['miles-asc', 'Miles: low to high'], ['miles-desc', 'Miles: high to low'], ['year-desc', 'Year: newest'], ['newest', 'Recently listed'], ['oldest', 'Longest for sale']]
                  .map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
              </select></label>
            <div class="seg" role="group" aria-label="Layout">
              <button type="button" data-action="layout" data-layout="grid" aria-label="Grid view">▦</button>
              <button type="button" data-action="layout" data-layout="table" aria-label="Table view">☰</button>
            </div>
            <button class="btn primary" type="button" data-action="save-search">★ Save search</button>
          </div>
          <div id="results"></div>
        </section>
      </div>`);
    document.getElementById('sort-select').value = S.f.sort;
    const q = document.getElementById('q-input');
    let t;
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => updateFilters((f) => { f.q = q.value.trim(); }), 180);
    });
    document.getElementById('sort-select').addEventListener('change', (e) => updateFilters((f) => { f.sort = e.target.value; }));
    refreshSearch();
    window.scrollTo(0, 0);
  }

  function updateFilters(fn) {
    fn(S.f);
    S.shown = PAGE;
    const qs = paramsFromFilters(S.f).toString();
    history.replaceState(null, '', '#/search' + (qs ? '?' + qs : ''));
    refreshSearch();
  }

  function refreshSearch() {
    const active = document.activeElement;
    const focusKey = active && active.closest('#filters') ? active.dataset.focusKey || active.id : null;
    const { results, facets } = Market.search(LISTINGS, S.f, CTX);
    S.results = results;
    document.getElementById('filters').innerHTML = filtersHtml(facets);
    document.getElementById('filters').classList.toggle('open', S.filtersOpen);
    document.getElementById('results').innerHTML = resultsHtml(results);
    document.querySelectorAll('[data-action="layout"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === S.layout)));
    if (focusKey) {
      const el = document.querySelector(`#filters [data-focus-key="${CSS.escape(focusKey)}"], #filters #${CSS.escape(focusKey)}`);
      if (el) el.focus();
    }
  }

  function facetList(key, label, facets, opts) {
    const o = opts || {};
    let items = facets[key] || [];
    const sel = S.f[key];
    if (!items.length && !sel.length) return '';
    items = [...items].sort(o.sort || ((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))));
    const limit = o.limit || 8;
    const expanded = S[`more_${key}`];
    const visible = expanded ? items : items.filter((it, i) => i < limit || sel.includes(it.value));
    const body = visible.map((it) => {
      const checked = sel.includes(it.value);
      const fk = `${key}:${it.value}`;
      return `<label class="opt${it.count === 0 ? ' zero' : ''}">
        <input type="checkbox" data-facet="${key}" value="${esc(it.value)}" data-focus-key="${esc(fk)}" ${checked ? 'checked' : ''}>
        ${o.swatch ? `<i class="sw" style="background:${esc(o.swatch(it.value))}"></i>` : ''}
        <span class="opt-label">${esc(o.fmt ? o.fmt(it.value) : it.value)}</span><span class="opt-count">${num(it.count)}</span></label>`;
    }).join('');
    const more = items.length > limit ? `<button type="button" class="link-btn" data-action="more" data-key="${key}">${expanded ? 'Show less' : `Show all ${items.length}`}</button>` : '';
    return `<fieldset class="facet"><legend>${esc(label)}${sel.length ? ` <button type="button" class="link-btn" data-action="clear-facet" data-key="${key}">Clear</button>` : ''}</legend>${body}${more}</fieldset>`;
  }

  const HEX = (() => {
    const m = new Map();
    for (const l of LISTINGS) if (!m.has(l.extColor)) m.set(l.extColor, l.extHex);
    return m;
  })();

  function filtersHtml(facets) {
    const f = S.f;
    const singleModel = f.model.length === 1;
    return `
      <div class="filters-head"><h2>Filters</h2>
        <button type="button" class="link-btn" data-action="reset">Reset all</button>
        <button type="button" class="icon-btn filters-close" data-action="toggle-filters" aria-label="Close filters">✕</button></div>
      <div class="toggle-row">
        <label class="switch"><input type="checkbox" data-bool="belowMarket" data-focus-key="belowMarket" ${f.belowMarket ? 'checked' : ''}><span></span>Below market only</label>
        <label class="switch"><input type="checkbox" data-bool="dropsOnly" data-focus-key="dropsOnly" ${f.dropsOnly ? 'checked' : ''}><span></span>Has price cuts</label>
      </div>
      ${facetList('condition', 'Condition', facets, { sort: (a, b) => ['New', 'Certified', 'Used'].indexOf(a.value) - ['New', 'Certified', 'Used'].indexOf(b.value) })}
      ${facetList('make', 'Make', facets, { limit: 6 })}
      ${facetList('model', 'Model', facets, { limit: 6 })}
      ${singleModel || f.trim.length ? facetList('trim', 'Trim', facets) : ''}
      <fieldset class="facet"><legend>Price</legend>
        <div class="range">
          <label><span>Min</span><input type="number" inputmode="numeric" step="1000" min="0" id="price-min" data-num="priceMin" placeholder="No min" value="${f.priceMin ?? ''}"></label>
          <label><span>Max</span><input type="number" inputmode="numeric" step="1000" min="0" id="price-max" data-num="priceMax" placeholder="No max" value="${f.priceMax ?? ''}"></label>
        </div>
      </fieldset>
      <fieldset class="facet"><legend>Mileage</legend>
        <select id="miles-max" data-num="milesMax">
          <option value="">Any mileage</option>
          ${[10000, 30000, 50000, 75000, 100000, 150000].map((m) => `<option value="${m}" ${f.milesMax === m ? 'selected' : ''}>Under ${kMiles(m)}</option>`).join('')}
        </select>
      </fieldset>
      ${facetList('year', 'Model year', facets, { limit: 6, sort: (a, b) => b.value - a.value })}
      <fieldset class="facet"><legend>Location</legend>
        <select id="near" data-near>
          <option value="">Anywhere in the US</option>
          ${CITY_NAMES.map((c) => `<option ${f.near === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        ${f.near ? `<label class="radius"><span>Within <b>${f.radius} mi</b></span><input type="range" id="radius" min="25" max="1000" step="25" value="${f.radius}" data-num="radius"></label>` : ''}
      </fieldset>
      ${facetList('body', 'Body style', facets)}
      ${facetList('fuel', 'Fuel', facets)}
      ${facetList('drivetrain', 'Drivetrain', facets)}
      ${facetList('extColor', 'Exterior color', facets, { limit: 8, swatch: (v) => HEX.get(v) || '#999' })}
      ${facetList('state', 'State', facets, { limit: 6 })}`;
  }

  function activeChips() {
    const f = S.f;
    const chips = [];
    for (const k of ARRAY_KEYS) for (const v of f[k]) chips.push({ label: v, k, v });
    if (f.q) chips.push({ label: `“${f.q}”`, k: 'q' });
    if (f.priceMin != null) chips.push({ label: `Over ${money(f.priceMin)}`, k: 'priceMin' });
    if (f.priceMax != null) chips.push({ label: `Under ${money(f.priceMax)}`, k: 'priceMax' });
    if (f.milesMax != null) chips.push({ label: `Under ${kMiles(f.milesMax)}`, k: 'milesMax' });
    if (f.near) chips.push({ label: `${f.radius} mi of ${f.near}`, k: 'near' });
    if (f.dropsOnly) chips.push({ label: 'Has price cuts', k: 'dropsOnly' });
    if (f.belowMarket) chips.push({ label: 'Below market', k: 'belowMarket' });
    if (!chips.length) return '';
    return `<div class="active-chips">${chips.map((c) => `<button type="button" class="chip" data-action="remove-chip" data-k="${esc(c.k)}" data-v="${esc(c.v || '')}">${esc(c.label)} <span aria-hidden="true">✕</span><span class="sr-only">Remove filter</span></button>`).join('')}</div>`;
  }

  function overviewHtml(results) {
    const f = S.f;
    if (f.model.length !== 1) return '';
    const key = f.model[0];
    const all = LISTINGS.filter((l) => `${l.make} ${l.model}` === key);
    const m = modelOf(key);
    if (!m || !all.length) return '';
    const byYear = [...Market.groupBy(all, (l) => l.year).entries()].sort((a, b) => a[0] - b[0]);
    const trims = [...Market.groupBy(all, (l) => l.trim).entries()].sort((a, b) => b[1].length - a[1].length);
    const used = all.filter((l) => l.condition !== 'New');
    const avgDays = Market.mean(all.map((l) => l.daysListed));
    return `<section class="card overview">
      <div class="overview-head">
        <div><p class="eyebrow">Market overview · ${esc(m.seg)}</p><h2>${esc(key)}</h2></div>
        <dl class="kpis">
          <div><dt>For sale</dt><dd>${num(all.length)}</dd></div>
          <div><dt>Used median</dt><dd>${money(Market.median(used.map((l) => l.price)))}</dd></div>
          <div><dt>Avg. days listed</dt><dd>${Math.round(avgDays)}</dd></div>
          <div><dt>With price cuts</dt><dd>${pct(all.filter((l) => l.history.length > 1).length / all.length)}</dd></div>
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

  function resultsHtml(results) {
    const sum = Market.summarize(results);
    const head = `${activeChips()}
      <div class="results-summary" aria-live="polite">
        <h1>${num(sum.count)} ${sum.count === 1 ? 'car' : 'cars'} <span class="muted">· ${esc(describeFilters(S.f))}</span></h1>
      </div>`;
    if (!results.length) {
      return head + `<div class="empty card"><h3>No cars match all of those filters.</h3><p class="muted">Remove a filter above, widen the radius, or <button class="link-btn" data-action="reset">start over</button>.</p></div>`;
    }
    const stats = `<dl class="stats-strip">
      <div><dt>Median price</dt><dd>${money(sum.medianPrice)}</dd></div>
      <div><dt>Price range</dt><dd>${money(sum.minPrice)}–${money(sum.maxPrice)}</dd></div>
      <div><dt>Median miles</dt><dd>${kMiles(sum.medianMiles)}</dd></div>
      <div><dt>Avg. days listed</dt><dd>${Math.round(sum.avgDays)}</dd></div>
      <div><dt>Price cuts</dt><dd>${num(sum.withDrops)}</dd></div>
    </dl>`;

    // Chart: plot up to 600 matches; color by market position.
    const sample = results.length > 600 ? results.filter((_, i) => i % Math.ceil(results.length / 600) === 0) : results;
    const tones = { great: 'great', good: 'good', fair: 'fair', high: 'high', over: 'over' };
    const scatter = Charts.scatter({
      series: [{ points: sample.map((l) => ({ x: l.miles, y: l.price, id: l.id, cls: 'mk-' + tones[(marketText(l) || { tone: 'fair' }).tone], label: `${title(l)} ${l.trim} · ${money(l.price)} · ${kMiles(l.miles)}` })), cls: 'res' }],
      xLabel: 'Miles', aria: 'Matching cars plotted by price and mileage', height: 260, r: 3.6,
    });
    const byState = Market.groupBy(results, (l) => l.state);
    const map = Charts.tileMap((st) => {
      const g = byState.get(st);
      if (!g) return S.f.state.includes(st) ? { cls: 'cnt-0', value: 0, selected: true, title: st } : null;
      const n = g.length;
      const cls = n >= 60 ? 'cnt-4' : n >= 25 ? 'cnt-3' : n >= 10 ? 'cnt-2' : 'cnt-1';
      return { cls, value: n, title: `${st}: ${plural(n, 'car')}, median ${money(Market.median(g.map((l) => l.price)))}`, selected: S.f.state.includes(st) };
    }, { clickable: true, size: 40, aria: 'Matching cars by state' });

    const list = S.layout === 'table' ? tableHtml(results.slice(0, S.shown)) : `<div class="listing-grid">${results.slice(0, S.shown).map((l) => listingCard(l)).join('')}</div>`;
    const more = results.length > S.shown ? `<div class="more"><button class="btn" type="button" data-action="more-results">Show ${Math.min(PAGE, results.length - S.shown)} more <span class="muted">(${num(results.length - S.shown)} left)</span></button></div>` : '';

    return head + overviewHtml(results) + stats + `
      <div class="viz-row">
        <div class="card viz"><div class="viz-head"><h3>Price vs. miles</h3><div class="legend"><span><i class="key d-great"></i>Below</span><span><i class="key d-fair"></i>At</span><span><i class="key d-over"></i>Above market</span></div></div>
          <div class="scatter-wrap" data-action-zone="scatter">${scatter}</div><p class="muted small">Click a dot to open that car${results.length > 600 ? ` · showing ${sample.length} of ${num(results.length)}` : ''}.</p></div>
        <div class="card viz"><div class="viz-head"><h3>Where they are</h3><span class="muted small">Click a state to filter</span></div>${map}</div>
      </div>
      ${list}${more}`;
  }

  function tableHtml(rows) {
    return `<div class="table-wrap card"><table class="results-table">
      <thead><tr><th>Car</th><th class="num">Price</th><th>vs. market</th><th class="num">Miles</th><th>Color</th><th>Location</th><th class="num">Days</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((l) => `<tr>
        <td><a href="#/car/${l.id}"><b>${esc(title(l))}</b> <span class="muted">${esc(l.trim)}</span></a><div class="small">${conditionBadge(l)}${l.status && l.status !== 'On lot' ? ' ' + badge(l.status, 'b-status') : ''}</div></td>
        <td class="num"><b>${money(l.price)}</b></td><td>${deltaChip(l)}</td><td class="num">${num(l.miles)}</td>
        <td><span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span></td>
        <td>${esc(l.city)}, ${esc(l.state)}</td><td class="num">${l.daysListed}</td>
        <td>${compareButton(l)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ----- Listing detail ----- */

  function renderCar(id) {
    const l = BY_ID.get(id);
    if (!l) return renderNotFound('That listing is no longer available.');
    store.update((s) => { s.recent = [id, ...s.recent.filter((x) => x !== id)].slice(0, 12); });
    const m = marketText(l);
    const r = rarity(l);
    const cut = Market.lastChange(l);
    const firstPrice = l.history[0].price;
    const comps = LISTINGS.filter((x) => x.make === l.make && x.model === l.model && Math.abs(x.year - l.year) <= 1 && x.id !== l.id);
    const similar = [...comps].filter((x) => x.condition !== 'New' || l.condition === 'New').sort((a, b) => Math.abs(a.miles - l.miles) / 10000 + Math.abs(a.year - l.year) + delta(a) * 10 - (Math.abs(b.miles - l.miles) / 10000 + Math.abs(b.year - l.year) + delta(b) * 10)).slice(0, 6);
    const dec = VIN.decode(l.vin);
    const optionsTotal = r.optionsTotal;
    const gaugePos = m ? Math.max(0, Math.min(100, 50 + (m.d / 0.15) * 50)) : 50;

    setView('car', `
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/search">Search</a><span>›</span><a href="${searchHref({ model: l.make + ' ' + l.model })}">${esc(l.make)} ${esc(l.model)}</a><span>›</span><span aria-current="page">${l.year} ${esc(l.trim)}</span></nav>
      <section class="car-hero">
        <div class="car-stage" style="--paint:${esc(l.extHex)}">${Charts.car(l.body, l.extHex, { cls: 'big', label: `${l.extColor} ${title(l)}` })}
          <div class="stage-note">Illustration in ${esc(l.extColor)} · ${esc(l.intColor)} interior</div></div>
        <div class="car-summary">
          <div class="badges">${conditionBadge(l)}${l.status ? badge(l.status, 'b-status') : ''}${r.extCount <= 3 ? badge(`💎 1 of ${r.extCount} in this color`, 'b-rare') : ''}</div>
          <h1>${esc(title(l))} <span>${esc(l.trim)}</span></h1>
          <p class="muted">${miles(l.miles)} · ${esc(l.drivetrain)} · ${esc(l.fuel)} · ${esc(l.city)}, ${esc(l.state)}</p>
          <div class="big-price">${money(l.price)}${cut && cut.delta < 0 ? `<s>${money(firstPrice)}</s>` : ''}</div>
          ${m ? `<div class="gauge" aria-label="Price position versus market">
              <div class="gauge-bar"><span class="gauge-mark" style="left:${gaugePos}%"></span></div>
              <div class="gauge-scale"><span>15% below</span><span>Market</span><span>15% above</span></div>
              <p><b class="t-${m.tone}">${esc(m.label)}</b> expected ${money(m.expected)} for a ${l.year} ${esc(l.model)} ${esc(l.trim)} ${l.condition === 'New' ? 'at MSRP with these options' : `with ${kMiles(l.miles)}`}.</p>
            </div>` : ''}
          <div class="actions">${favButton(l)}${compareButton(l)}<button class="btn ghost" type="button" data-action="share" data-id="${l.id}">Copy link</button></div>
        </div>
      </section>

      <div class="car-grid">
        <div class="col">
          <section class="card">
            <h2>Price history</h2>
            <p class="muted">${esc(days(l.daysListed))}${l.history.length > 1 ? ` · ${plural(l.history.length - 1, 'price cut')} · ${money(firstPrice - l.price)} total` : ' · no price changes yet'}</p>
            ${l.history.length > 1 || l.daysListed > 0 ? Charts.priceHistory(l.history.length > 1 ? l.history : [{ daysAgo: l.daysListed, price: l.price }]) : ''}
            <ol class="timeline">${[...l.history].reverse().map((h, i, arr) => {
              const prev = arr[i + 1];
              return `<li><span>${h.daysAgo === 0 ? 'Today' : h.daysAgo + ' days ago'}</span><b>${money(h.price)}</b>${prev ? `<span class="drop">↓ ${money(prev.price - h.price)}</span>` : '<span class="muted">Listed</span>'}</li>`;
            }).join('')}</ol>
          </section>
          <section class="card">
            <h2>Against ${comps.length} similar ${esc(l.model)}s</h2>
            <p class="muted">${l.year - 1}–${l.year + 1} ${esc(l.make)} ${esc(l.model)} listings nationwide. This car is the ringed dot.</p>
            <div data-action-zone="scatter">${Charts.scatter({
              series: [
                { points: comps.map((x) => ({ x: x.miles, y: x.price, id: x.id, label: `${title(x)} ${x.trim} · ${money(x.price)}` })), cls: 'comp' },
                { points: [{ x: l.miles, y: l.price, r: 7, label: 'This car' }], cls: 'self' },
              ], xLabel: 'Miles', aria: 'This car compared with similar listings',
            })}</div>
          </section>
          <section>
            <h2 class="sec-title">Similar cars</h2>
            <div class="listing-grid compact">${similar.map((x) => listingCard(x)).join('')}</div>
          </section>
        </div>
        <aside class="col side">
          <section class="card">
            <h2>Details</h2>
            <dl class="spec">
              <div><dt>VIN</dt><dd class="mono">${esc(l.vin)} <button class="link-btn" data-action="copy" data-text="${esc(l.vin)}">Copy</button></dd></div>
              <div><dt>Mileage</dt><dd>${miles(l.miles)}</dd></div>
              <div><dt>Body</dt><dd>${esc(l.body)} · ${esc(l.segment)}</dd></div>
              <div><dt>Drivetrain</dt><dd>${esc(l.drivetrain)}</dd></div>
              <div><dt>Fuel</dt><dd>${esc(l.fuel)}</dd></div>
              <div><dt>Exterior</dt><dd><span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span> <span class="muted">1 of ${r.extCount} of ${r.total}</span></dd></div>
              <div><dt>Interior</dt><dd>${esc(l.intColor)} <span class="muted">1 of ${r.intCount}</span></dd></div>
              <div><dt>Original MSRP</dt><dd>${money(l.msrp)}</dd></div>
            </dl>
          </section>
          <section class="card">
            <h2>Installed options <span class="muted">${money(optionsTotal)}</span></h2>
            ${l.options.length ? `<ul class="opts">${l.options.map((o) => `<li><span>${esc(o.name)}</span><span class="muted">${money(o.price)}</span></li>`).join('')}</ul>
              <p class="muted small">${r.optionsVsAvg >= 0 ? pct(r.optionsVsAvg) + ' more' : pct(-r.optionsVsAvg) + ' less'} than the average ${esc(l.model)} for sale.</p>` : '<p class="muted">No factory options listed.</p>'}
          </section>
          <section class="card">
            <h2>Seller</h2>
            <p><b>${esc(l.dealer)}</b><br><span class="muted">${l.franchise ? 'Franchise dealer' : 'Independent dealer'} · ${esc(l.city)}, ${esc(l.state)}</span></p>
            <a class="btn ghost block" href="${searchHref({ q: l.dealer, state: l.state })}">More from this dealer</a>
            <p class="muted small">We never pass your details to a seller. Contact them directly when you’re ready.</p>
          </section>
          <section class="card" id="calc">
            <h2>Monthly payment</h2>
            <div class="calc">
              <label><span>Down payment</span><input type="number" id="c-down" value="${Math.round(l.price * 0.1 / 500) * 500}" step="500" min="0"></label>
              <label><span>APR %</span><input type="number" id="c-apr" value="${l.condition === 'New' ? 5.9 : 7.4}" step="0.1" min="0"></label>
              <label><span>Term</span><select id="c-term">${[36, 48, 60, 72, 84].map((t) => `<option ${t === 60 ? 'selected' : ''} value="${t}">${t} months</option>`).join('')}</select></label>
              <label><span>Sales tax %</span><input type="number" id="c-tax" value="7" step="0.25" min="0"></label>
            </div>
            <div class="calc-out" id="calc-out" aria-live="polite"></div>
          </section>
          <section class="card">
            <h2>VIN decode</h2>
            <dl class="spec">
              <div><dt>Check digit</dt><dd>${dec.valid ? '<span class="good">✓ Valid</span>' : '<span class="bad">✕ Invalid</span>'}</dd></div>
              <div><dt>Manufacturer</dt><dd>${esc(dec.make || 'Unknown')}</dd></div>
              <div><dt>Built in</dt><dd>${esc(dec.country || dec.region || 'Unknown')}</dd></div>
              <div><dt>Model year</dt><dd>${dec.year || '—'}</dd></div>
              <div><dt>Serial</dt><dd class="mono">${esc(dec.serial || '')}</dd></div>
            </dl>
          </section>
        </aside>
      </div>`);
    bindCalc(l);
    window.scrollTo(0, 0);
  }

  function bindCalc(l) {
    const ids = ['c-down', 'c-apr', 'c-term', 'c-tax'];
    const out = document.getElementById('calc-out');
    const calc = () => {
      const [down, apr, term, tax] = ids.map((i) => Number(document.getElementById(i).value) || 0);
      const principal = Math.max(0, l.price * (1 + tax / 100) - down);
      const r = apr / 100 / 12;
      const pay = r ? (principal * r) / (1 - Math.pow(1 + r, -term)) : principal / term;
      const interest = pay * term - principal;
      out.innerHTML = `<div class="pay">${money(pay)}<small>/month</small></div><p class="muted small">Financing ${money(principal)} · ${money(interest)} total interest · ${money(pay * term + down)} all-in</p>`;
    };
    ids.forEach((i) => document.getElementById(i).addEventListener('input', calc));
    calc();
  }

  /* ----- VIN page ----- */

  function renderVin(raw) {
    const d = VIN.decode(decodeURIComponent(raw));
    const match = BY_VIN.get(d.vin);
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
      ${match ? `<h2 class="sec-title">This VIN is for sale</h2><div class="listing-grid compact">${listingCard(match)}</div>` : `<p class="muted">No current listing matches this VIN.${d.make && d.year ? ` <a href="${searchHref({ make: d.make, year: d.year })}">See ${d.year} ${esc(d.make)}s for sale →</a>` : ''}</p>`}
    </section>`);
    window.scrollTo(0, 0);
  }

  /* ----- Compare ----- */

  function renderCompare() {
    const cars = store.get().compare.map((id) => BY_ID.get(id)).filter(Boolean);
    if (!cars.length) {
      setView('compare', `<section class="narrow empty-state"><h1>Compare cars</h1><p class="muted">Add up to four cars with <b>+ Compare</b> on any listing to line them up here.</p><a class="btn primary" href="#/search">Start searching</a></section>`);
      return;
    }
    const best = (vals, low) => {
      const target = low ? Math.min(...vals) : Math.max(...vals);
      return vals.map((v) => cars.length > 1 && v === target);
    };
    const rows = [
      ['Price', cars.map((l) => money(l.price)), best(cars.map((l) => l.price), true)],
      ['vs. market', cars.map((l) => deltaChip(l) || '—'), best(cars.map(delta), true), true],
      ['Expected value', cars.map((l) => money(expected(l))), []],
      ['Mileage', cars.map((l) => miles(l.miles)), best(cars.map((l) => l.miles), true)],
      ['Year', cars.map((l) => String(l.year)), best(cars.map((l) => l.year), false)],
      ['Trim', cars.map((l) => esc(l.trim)), []],
      ['Condition', cars.map((l) => conditionBadge(l)), [], true],
      ['Drivetrain', cars.map((l) => esc(l.drivetrain)), []],
      ['Fuel', cars.map((l) => esc(l.fuel)), []],
      ['Exterior', cars.map((l) => `<span class="swatch-line"><i style="background:${esc(l.extHex)}"></i>${esc(l.extColor)}</span>`), [], true],
      ['Interior', cars.map((l) => esc(l.intColor)), []],
      ['Options', cars.map((l) => money(l.options.reduce((s, o) => s + o.price, 0))), best(cars.map((l) => l.options.reduce((s, o) => s + o.price, 0)), false)],
      ['Days for sale', cars.map((l) => String(l.daysListed)), []],
      ['Price cuts', cars.map((l) => l.history.length > 1 ? `${l.history.length - 1} · ${money(l.history[0].price - l.price)}` : 'None'), []],
      ['Location', cars.map((l) => `${esc(l.city)}, ${esc(l.state)}`), []],
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

  /* ----- Saved ----- */

  function renderSaved() {
    const s = store.get();
    const favs = Object.keys(s.favs).map((id) => BY_ID.get(id)).filter(Boolean);
    const recent = s.recent.map((id) => BY_ID.get(id)).filter(Boolean);
    const searches = s.saved.map((x) => {
      const f = filtersFromParams(new URLSearchParams(x.params));
      const n = Market.search(LISTINGS, f, CTX).results.length;
      return { ...x, n };
    });
    setView('saved', `<section class="section">
      <h1>Saved</h1>
      <h2 class="sec-title">Searches</h2>
      ${searches.length ? `<ul class="saved-list">${searches.map((x) => `<li class="card">
        <a href="#/search?${esc(x.params)}"><b>${esc(x.name)}</b><small class="muted">Saved ${new Date(x.createdAt).toLocaleDateString()} · ${plural(x.n, 'match')} now${x.n !== x.count ? ` <span class="${x.n > x.count ? 'good' : 'drop'}">(${x.n > x.count ? '+' : ''}${x.n - x.count} since saved)</span>` : ''}</small></a>
        <button class="link-btn" type="button" data-action="delete-search" data-id="${esc(x.id)}">Delete</button></li>`).join('')}</ul>`
        : '<p class="muted">No saved searches yet. Use <b>★ Save search</b> on any results page.</p>'}
      <h2 class="sec-title">Favorites</h2>
      ${favs.length ? `<div class="listing-grid">${favs.map((l) => listingCard(l)).join('')}</div>` : '<p class="muted">Tap the heart on any car to keep it here.</p>'}
      ${recent.length ? `<h2 class="sec-title">Recently viewed</h2><div class="listing-grid compact">${recent.map((l) => listingCard(l)).join('')}</div>` : ''}
      <p class="muted small">Everything on this page is stored only in this browser.</p>
    </section>`);
    window.scrollTo(0, 0);
  }

  function renderNotFound(msg) {
    setView('404', `<section class="narrow empty-state"><h1>Not found</h1><p class="muted">${esc(msg || 'That page doesn’t exist.')}</p><a class="btn primary" href="#/">Go home</a></section>`);
  }

  /* ---------- Events ---------- */

  function rerenderCurrent() {
    if (view.name === 'search') refreshSearch();
    else route();
  }

  app.addEventListener('click', (e) => {
    const dot = e.target.closest('circle.dot[data-id]');
    if (dot) { location.hash = `#/car/${dot.dataset.id}`; return; }
    const tile = e.target.closest('[data-state]');
    if (tile) { onTile(tile.dataset.state); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === 'fav') {
      e.preventDefault();
      const l = BY_ID.get(id);
      store.update((s) => { if (s.favs[id]) delete s.favs[id]; else s.favs[id] = l.price; });
      const on = !!store.get().favs[id];
      document.querySelectorAll(`[data-action="fav"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      toast(on ? 'Saved to favorites' : 'Removed from favorites');
    } else if (a === 'compare') {
      e.preventDefault();
      let msg;
      store.update((s) => {
        if (s.compare.includes(id)) { s.compare = s.compare.filter((x) => x !== id); msg = 'Removed from compare'; }
        else if (s.compare.length >= 4) msg = 'You can compare up to 4 cars';
        else { s.compare.push(id); msg = `Added to compare (${s.compare.length}/4)`; }
      });
      toast(msg);
      if (view.name === 'compare') renderCompare();
      else document.querySelectorAll(`[data-action="compare"][data-id="${id}"]`).forEach((b) => { b.outerHTML = compareButton(BY_ID.get(id)); });
    } else if (a === 'share' || a === 'copy') {
      const text = a === 'share' ? location.href : el.dataset.text;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied'), () => toast(text));
    } else if (a === 'scroll') {
      document.getElementById('rare-scroller').scrollBy({ left: Number(el.dataset.dir) * 320, behavior: 'smooth' });
    } else if (a === 'jump') {
      e.preventDefault();
      document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth' });
    } else if (a === 'toggle-filters') {
      S.filtersOpen = !S.filtersOpen;
      document.getElementById('filters').classList.toggle('open', S.filtersOpen);
    } else if (a === 'reset') {
      updateFilters((f) => Object.assign(f, Market.emptyFilters(), { sort: f.sort }));
      document.getElementById('q-input').value = '';
    } else if (a === 'clear-facet') {
      updateFilters((f) => { f[el.dataset.key] = []; });
    } else if (a === 'more') {
      S[`more_${el.dataset.key}`] = !S[`more_${el.dataset.key}`];
      refreshSearch();
    } else if (a === 'remove-chip') {
      const k = el.dataset.k, v = el.dataset.v;
      updateFilters((f) => {
        if (ARRAY_KEYS.includes(k)) f[k] = f[k].filter((x) => x !== v);
        else if (BOOL_KEYS.includes(k)) f[k] = false;
        else if (k === 'q') { f.q = ''; document.getElementById('q-input').value = ''; }
        else f[k] = null;
      });
    } else if (a === 'more-results') {
      S.shown += PAGE;
      document.getElementById('results').innerHTML = resultsHtml(S.results);
    } else if (a === 'layout') {
      S.layout = el.dataset.layout;
      refreshSearch();
    } else if (a === 'pick-trim') {
      updateFilters((f) => { f.trim = [el.dataset.trim]; });
    } else if (a === 'save-search') {
      const name = prompt('Name this search', describeFilters(S.f));
      if (!name) return;
      const params = paramsFromFilters(S.f).toString();
      store.update((s) => { s.saved.unshift({ id: 's' + Date.now(), name: name.trim(), params, count: S.results.length, createdAt: Date.now() }); });
      toast('Search saved');
    } else if (a === 'delete-search') {
      store.update((s) => { s.saved = s.saved.filter((x) => x.id !== id); });
      renderSaved();
    } else if (a === 'clear-compare') {
      store.update((s) => { s.compare = []; });
      renderCompare();
    }
  });

  app.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-state]')) {
      e.preventDefault();
      onTile(e.target.dataset.state);
    }
  });

  function onTile(st) {
    if (view.name === 'search') {
      updateFilters((f) => { f.state = f.state.includes(st) ? f.state.filter((x) => x !== st) : [...f.state, st]; });
    } else {
      location.hash = searchHref({ state: st, condition: ['Used', 'Certified'], belowMarket: 1 });
    }
  }

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (view.name !== 'search' || !t.closest('#filters')) return;
    if (t.dataset.facet) {
      const k = t.dataset.facet;
      updateFilters((f) => {
        f[k] = t.checked ? [...f[k], t.value] : f[k].filter((x) => x !== t.value);
        // Dropping the last model makes trim choices meaningless.
        if (k === 'model' && f.model.length !== 1) f.trim = [];
      });
    } else if (t.dataset.bool) {
      updateFilters((f) => { f[t.dataset.bool] = t.checked; });
    } else if (t.dataset.num) {
      updateFilters((f) => { f[t.dataset.num] = t.value === '' ? null : Number(t.value); });
    } else if (t.hasAttribute('data-near')) {
      updateFilters((f) => { f.near = t.value || null; });
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'radius') e.target.previousElementSibling.querySelector('b').textContent = `${e.target.value} mi`;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select')) {
      const input = ['#hero-search input', '#q-input', '#header-search input']
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
    document.getElementById('header-search').hidden = !parts.length;
    if (!parts.length) return renderHome();
    if (parts[0] === 'insights') return renderHome('insights');
    if (parts[0] === 'search') return renderSearch(new URLSearchParams(qs || ''));
    if (parts[0] === 'car') return renderCar(parts[1]);
    if (parts[0] === 'vin') return renderVin(parts[1] || '');
    if (parts[0] === 'compare') return renderCompare();
    if (parts[0] === 'saved') return renderSaved();
    return renderNotFound();
  }

  function footerLinks() {
    const counts = Market.groupBy(LISTINGS, (l) => `${l.make} ${l.model}`);
    const top = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
    const segs = [...new Set(DATA.models.map((m) => m.seg))];
    document.getElementById('footer-links').innerHTML = `
      <div><h4>Popular searches</h4>${top.map(([k]) => `<a href="${searchHref({ model: k })}">${esc(k)}</a>`).join('')}</div>
      <div><h4>Used prices by segment</h4>${segs.map((s) => `<a href="${searchHref({ q: s, condition: ['Used', 'Certified'] })}">${esc(s)}</a>`).join('')}</div>
      <div><h4>Tools</h4><a href="#/insights">Market insights</a><a href="#/compare">Compare cars</a><a href="#/saved">Saved searches</a><a href="#/vin/${LISTINGS[0].vin}">VIN decoder</a></div>`;
  }

  applyTheme(store.get().theme);
  mountSearchBox(document.getElementById('header-search'), { size: 'sm', placeholder: 'Search…' });
  footerLinks();
  updateNavCounts();
  window.addEventListener('hashchange', route);
  route();
})();
