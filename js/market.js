/* Market analytics: filtering, live facet counts, fair-value model and the
   weekly insight cards. Pure functions over the listings array. */
(function (root) {
  'use strict';

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const groupBy = (arr, keyFn) => {
    const m = new Map();
    for (const x of arr) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };

  function linearFit(points) {
    const n = points.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = n * sxx - sx * sx;
    if (!den) return null;
    const slope = (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;
    return { slope, intercept, at: (x) => intercept + slope * x };
  }

  // Solve least squares y = b0 + b1*x1 + b2*x2 via 3x3 normal equations.
  function fit2(rows) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const B = [0, 0, 0];
    for (const [x1, x2, y] of rows) {
      const v = [1, x1, x2];
      for (let i = 0; i < 3; i++) {
        B[i] += v[i] * y;
        for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j];
      }
    }
    // Gaussian elimination with partial pivoting
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-9) return null;
      [A[c], A[p]] = [A[p], A[c]];
      [B[c], B[p]] = [B[p], B[c]];
      for (let r = c + 1; r < 3; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 3; k++) A[r][k] -= f * A[c][k];
        B[r] -= f * B[c];
      }
    }
    const x = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
      let s = B[r];
      for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  }

  /* Fair value: for each make/model, regress log retained value (price / base MSRP)
     on age and mileage across all used listings. That separates "cheap because
     it has 90k miles" from "cheap for what it is". */
  function buildFairValue(listings, currentYear) {
    const coef = new Map();
    const used = listings.filter((l) => l.condition !== 'New');
    for (const [key, group] of groupBy(used, (l) => l.make + '|' + l.model)) {
      if (group.length < 8) continue;
      const c = fit2(group.map((l) => [currentYear - l.year + 0.5, l.miles / 1000, Math.log(l.price / l.msrpBase)]));
      if (c) coef.set(key, c);
    }
    return function expected(l) {
      if (l.condition === 'New') return l.msrp;
      const c = coef.get(l.make + '|' + l.model);
      if (!c) return null;
      const ratio = Math.exp(c[0] + c[1] * (currentYear - l.year + 0.5) + c[2] * (l.miles / 1000));
      return Math.max(3000, l.msrpBase * ratio * (l.condition === 'Certified' ? 1.02 : 1));
    };
  }

  function priceOn(l, daysAgo) {
    if (l.daysListed < daysAgo) return null;
    let p = l.history[0].price;
    for (const h of l.history) if (h.daysAgo >= daysAgo) p = h.price;
    return p;
  }

  function lastChange(l) {
    if (l.history.length < 2) return null;
    const a = l.history[l.history.length - 2];
    const b = l.history[l.history.length - 1];
    return { daysAgo: b.daysAgo, from: a.price, to: b.price, delta: b.price - a.price };
  }

  function haversineMiles(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }

  /* ---------- Search ---------- */

  const FACETS = ['condition', 'make', 'model', 'trim', 'year', 'body', 'drivetrain', 'fuel', 'extColor', 'state'];
  const facetValue = {
    model: (l) => l.make + ' ' + l.model,
    year: (l) => String(l.year),
  };
  const valueOf = (key, l) => (facetValue[key] ? facetValue[key](l) : l[key]);

  function emptyFilters() {
    return {
      q: '', condition: [], make: [], model: [], trim: [], year: [], body: [], drivetrain: [], fuel: [], extColor: [], state: [],
      priceMin: null, priceMax: null, milesMax: null, near: null, radius: 150, dropsOnly: false, belowMarket: false, sort: 'best',
    };
  }

  function haystack(l) {
    if (!l._hay) {
      l._hay = [l.year, l.make, l.model, l.trim, l.body, l.segment, l.drivetrain, l.fuel, l.condition, l.extColor, l.intColor, l.dealer, l.city, l.state, l.vin]
        .join(' ').toLowerCase();
    }
    return l._hay;
  }

  function matches(l, f, skip, ctx) {
    if (f.q) {
      const hay = haystack(l);
      for (const tok of f.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!hay.includes(tok)) return false;
    }
    for (const key of FACETS) {
      if (key === skip) continue;
      const sel = f[key];
      if (sel && sel.length && !sel.includes(valueOf(key, l))) return false;
    }
    if (f.priceMin != null && l.price < f.priceMin) return false;
    if (f.priceMax != null && l.price > f.priceMax) return false;
    if (f.milesMax != null && l.miles > f.milesMax) return false;
    if (f.dropsOnly && l.history.length < 2) return false;
    if (f.belowMarket && ctx && !(ctx.delta(l) < -0.03)) return false;
    if (f.near && ctx && ctx.cityByName) {
      const c = ctx.cityByName(f.near);
      if (c && haversineMiles(c[2], c[3], l.lat, l.lng) > f.radius) return false;
    }
    return true;
  }

  function search(listings, f, ctx) {
    const results = listings.filter((l) => matches(l, f, null, ctx));
    const facets = {};
    for (const key of FACETS) {
      const counts = new Map();
      // A facet's own selection doesn't narrow its counts, so every option
      // shows how many cars you'd get by picking it. Zero-count options are hidden.
      const base = f[key] && f[key].length ? listings.filter((l) => matches(l, f, key, ctx)) : results;
      for (const l of base) {
        const v = valueOf(key, l);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      for (const v of f[key] || []) if (!counts.has(v)) counts.set(v, 0);
      facets[key] = [...counts.entries()].map(([value, count]) => ({ value, count }));
    }
    sortListings(results, f.sort, ctx);
    return { results, facets };
  }

  function sortListings(arr, sort, ctx) {
    const by = {
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      'miles-asc': (a, b) => a.miles - b.miles,
      'miles-desc': (a, b) => b.miles - a.miles,
      'year-desc': (a, b) => b.year - a.year || a.price - b.price,
      'newest': (a, b) => a.daysListed - b.daysListed,
      'oldest': (a, b) => b.daysListed - a.daysListed,
      'best': (a, b) => ctx.delta(a) - ctx.delta(b),
    }[sort] || ((a, b) => a.price - b.price);
    arr.sort(by);
  }

  function summarize(results) {
    const prices = results.map((l) => l.price);
    return {
      count: results.length,
      medianPrice: median(prices),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      medianMiles: median(results.map((l) => l.miles)),
      avgDays: mean(results.map((l) => l.daysListed)),
      withDrops: results.filter((l) => l.history.length > 1).length,
    };
  }

  /* ---------- Weekly insights ---------- */

  function arrivals(listings, currentYear) {
    const next = listings.filter((l) => l.condition === 'New' && l.year > currentYear);
    const pool = next.length ? next : listings.filter((l) => l.condition === 'New' && l.year === currentYear);
    const byModel = groupBy(pool, (l) => `${l.year}|${l.make}|${l.model}`);
    const [key, group] = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const [year, make, model] = key.split('|');
    const byStatus = { 'On lot': 0, 'In transit': 0, 'In production': 0 };
    for (const l of group) byStatus[l.status]++;
    const recent = [...group].sort((a, b) => a.daysListed - b.daysListed).slice(0, 10);
    return { year: +year, make, model, total: group.length, byStatus, recent };
  }

  function priceMovers(listings, minGroup) {
    const used = listings.filter((l) => l.condition !== 'New');
    const out = [];
    for (const [key, group] of groupBy(used, (l) => `${l.year}|${l.make}|${l.model}`)) {
      if (group.length < (minGroup || 25)) continue;
      const now = group.map((l) => [l.miles, l.price]);
      const then = group.filter((l) => l.daysListed >= 30).map((l) => [l.miles, priceOn(l, 30)]);
      if (then.length < 8) continue;
      const fNow = linearFit(now);
      const fThen = linearFit(then);
      if (!fNow || !fThen) continue;
      const mid = median(group.map((l) => l.miles));
      const change = fNow.at(mid) - fThen.at(mid);
      const [year, make, model] = key.split('|');
      out.push({ year: +year, make, model, count: group.length, change, now, then, fNow, fThen, mid,
        maxMiles: Math.max(...group.map((l) => l.miles)) });
    }
    return out.sort((a, b) => a.change - b.change);
  }

  function retention(listings, segment, currentYear) {
    const pool = listings.filter((l) => l.segment === segment && l.condition !== 'New' && l.miles < 75000);
    const rows = [];
    for (const [key, group] of groupBy(pool, (l) => l.make + '|' + l.model)) {
      const [make, model] = key.split('|');
      const byAge = [];
      for (let age = 1; age <= 4; age++) {
        const g = group.filter((l) => currentYear - l.year === age);
        byAge.push(g.length >= 3 ? mean(g.map((l) => l.price / l.msrpBase)) : null);
      }
      if (byAge.some((v) => v == null)) continue;
      const four = group.filter((l) => currentYear - l.year === 4);
      rows.push({ make, model, byAge, n: group.length,
        msrp: mean(four.map((l) => l.msrpBase)), avgList: mean(four.map((l) => l.price)), avgMiles: mean(four.map((l) => l.miles)) });
    }
    return rows.sort((a, b) => b.byAge[3] - a.byAge[3]);
  }

  function stateDeltas(listings, delta) {
    const used = listings.filter((l) => l.condition !== 'New');
    const out = {};
    for (const [st, group] of groupBy(used, (l) => l.state)) {
      const ds = group.map(delta).filter((d) => d != null && isFinite(d));
      out[st] = { n: group.length, delta: median(ds) };
    }
    return out;
  }

  function colorStats(listings) {
    const ext = new Map();
    const int = new Map();
    const opts = new Map();
    const totals = new Map();
    for (const l of listings) {
      const mk = l.make + '|' + l.model;
      totals.set(mk, (totals.get(mk) || 0) + 1);
      ext.set(mk + '|' + l.extColor, (ext.get(mk + '|' + l.extColor) || 0) + 1);
      int.set(mk + '|' + l.intColor, (int.get(mk + '|' + l.intColor) || 0) + 1);
      if (!opts.has(mk)) opts.set(mk, []);
      opts.get(mk).push(l.options.reduce((s, o) => s + o.price, 0));
    }
    const avgOpts = new Map([...opts].map(([k, v]) => [k, mean(v)]));
    return function rarity(l) {
      const mk = l.make + '|' + l.model;
      const optionsTotal = l.options.reduce((s, o) => s + o.price, 0);
      const avg = avgOpts.get(mk) || 0;
      return {
        total: totals.get(mk),
        extCount: ext.get(mk + '|' + l.extColor),
        intCount: int.get(mk + '|' + l.intColor),
        optionsTotal,
        optionsVsAvg: avg ? optionsTotal / avg - 1 : 0,
      };
    };
  }

  function rareSpecs(listings, rarity, limit) {
    return listings
      .filter((l) => l.condition !== 'New')
      .map((l) => ({ l, r: rarity(l) }))
      .filter(({ r }) => r.extCount <= 3 && r.optionsVsAvg > 0.3)
      .map((x) => ({ ...x, score: (4 - x.r.extCount) * 2 + (x.r.intCount <= 3 ? 2 : 0) + x.r.optionsVsAvg }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 8);
  }

  function recentDrops(listings, withinDays) {
    return listings
      .map((l) => ({ l, c: lastChange(l) }))
      .filter(({ c }) => c && c.delta < 0 && c.daysAgo <= withinDays)
      .sort((a, b) => a.c.delta - b.c.delta);
  }

  const api = {
    median, mean, groupBy, linearFit, fit2, buildFairValue, priceOn, lastChange, haversineMiles,
    FACETS, valueOf, emptyFilters, search, summarize, sortListings,
    arrivals, priceMovers, retention, stateDeltas, colorStats, rareSpecs, recentDrops,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Market = api;
})(typeof window !== 'undefined' ? window : globalThis);
