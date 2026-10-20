/* Gridline geo: turns a US ZIP code into a place on the map, without a network request.
   The built-in table (js/zipdata.js) has every 3-digit ZIP prefix with its center point and main
   place, which puts any ZIP within a metro area. refine() asks a free ZIP service for the exact
   place of a full 5-digit ZIP when the network is there, and remembers the answer. */
(function (root) {
  'use strict';

  const rows = (typeof module !== 'undefined' && module.exports) ? require('./zipdata.js') : root.ZIP_ROWS;
  const PREFIX = new Map();
  for (const row of rows.split(';')) {
    const [p, lat, lng, place, state, tail] = row.split('|');
    PREFIX.set(p, { prefix: p, lat: Number(lat), lng: Number(lng), place, state, sample: p + tail });
  }

  const isZip = (s) => /^\d{5}$/.test(String(s || '').trim());
  // Pull a ZIP out of free text ("near 94022", "94022-1234").
  const zipIn = (text) => {
    const m = String(text || '').match(/(?:^|\D)(\d{5})(?:-\d{4})?(?!\d)/);
    return m ? m[1] : null;
  };

  const exact = new Map(); // zip -> { place, state, lat, lng } learned from the ZIP service
  const CACHE_KEY = 'gridline:zips';
  try {
    const saved = JSON.parse(root.localStorage && root.localStorage.getItem(CACHE_KEY)) || {};
    for (const [z, v] of Object.entries(saved)) exact.set(z, v);
  } catch (e) { /* no storage */ }
  function remember(zip, v) {
    exact.set(zip, v);
    try {
      const saved = JSON.parse(root.localStorage.getItem(CACHE_KEY)) || {};
      saved[zip] = v;
      const keys = Object.keys(saved);
      if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete saved[k];
      root.localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
    } catch (e) { /* ignore */ }
  }

  // Where a ZIP is: { zip, lat, lng, place, state, approx }. approx is true when only the
  // 3-digit prefix is known, so the point is the center of the area and the place its main town.
  function lookup(zip) {
    const z = String(zip || '').trim();
    if (!isZip(z)) return null;
    const e = exact.get(z);
    if (e) return Object.assign({ zip: z, approx: false }, e);
    const p = PREFIX.get(z.slice(0, 3));
    return p ? { zip: z, lat: p.lat, lng: p.lng, place: p.place, state: p.state, approx: true } : null;
  }

  // Ask api.zippopotam.us (free, no key) for the exact place. Resolves to lookup(zip) either way.
  let fetcher = typeof fetch === 'function' ? fetch.bind(root) : null;
  const pending = new Map();
  function refine(zip) {
    const z = String(zip || '').trim();
    const base = lookup(z);
    if (!base || !base.approx || !fetcher) return Promise.resolve(base);
    if (!pending.has(z)) {
      pending.set(z, fetcher(`https://api.zippopotam.us/us/${z}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
        const pl = j && j.places && j.places[0];
        if (!pl) return base;
        const v = { place: pl['place name'], state: pl['state abbreviation'], lat: Number(pl.latitude), lng: Number(pl.longitude) };
        if (!isFinite(v.lat) || !isFinite(v.lng)) return base;
        remember(z, v);
        return lookup(z);
      }).catch(() => base).finally(() => pending.delete(z)));
    }
    return pending.get(z);
  }

  function haversineMiles(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }

  // The ZIP area closest to a point (for "use my location"): a 5-digit ZIP made from the prefix.
  function nearest(lat, lng) {
    let best = null, bestD = Infinity;
    for (const p of PREFIX.values()) {
      const d = haversineMiles(lat, lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { zip: best.sample, lat: best.lat, lng: best.lng, place: best.place, state: best.state, approx: true, miles: bestD } : null;
  }

  // "Los Altos, CA" or "Mountain View, CA area" when only the prefix is known.
  const label = (g, opts) => (g ? `${g.place}, ${g.state}${g.approx && !(opts && opts.short) ? ' area' : ''}` : '');
  // The same shape as a demo city: [name, state, lat, lng, zip].
  const place = (zip) => { const g = lookup(zip); return g ? [g.place, g.state, g.lat, g.lng, g.zip] : null; };

  const api = { isZip, zipIn, lookup, refine, nearest, label, place, haversineMiles, prefixCount: () => PREFIX.size, _setFetch: (f) => { fetcher = f; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof window !== 'undefined' ? window : globalThis);
