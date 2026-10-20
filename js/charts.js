/* Small dependency-free SVG chart builders. Each returns an SVG string;
   colors come from CSS custom properties so charts follow the theme. */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / (count || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  const kFmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));
  const moneyK = (v) => '$' + kFmt(v);

  /* Scatter with optional linear fits.
     series: [{ points: [{x, y, id?, label?}], cls, fit?: {at}, label }] */
  function scatter(opts) {
    const W = opts.width || 560, H = opts.height || 240;
    const m = { t: 12, r: 14, b: 30, l: 50 };
    const all = opts.series.flatMap((s) => s.points);
    if (!all.length) return `<div class="chart-empty">No data to chart</div>`;
    const xMax = opts.xMax || Math.max(...all.map((p) => p.x)) * 1.04 || 1;
    const ys = all.map((p) => p.y);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.08 || yMax * 0.1;
    yMin = Math.max(0, yMin - pad); yMax += pad;
    const sx = (x) => m.l + (x / xMax) * (W - m.l - m.r);
    const sy = (y) => H - m.b - ((y - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    let g = '';
    for (const t of niceTicks(yMin, yMax, 4)) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${(opts.yFmt || moneyK)(t)}</text>`;
    }
    for (const t of niceTicks(0, xMax, 5)) {
      g += `<text class="tick" x="${sx(t)}" y="${H - 10}" text-anchor="middle">${(opts.xFmt || kFmt)(t)}</text>`;
    }
    let dots = '', fits = '';
    for (const s of opts.series) {
      for (const p of s.points) {
        const attrs = p.id ? ` data-id="${esc(p.id)}" tabindex="-1"` : '';
        dots += `<circle class="dot ${s.cls || ''} ${p.cls || ''}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.r || opts.r || 3.2}"${attrs}>${p.label ? `<title>${esc(p.label)}</title>` : ''}</circle>`;
      }
      if (s.fit) {
        const x0 = 0, x1 = opts.fitMax || xMax;
        fits += `<line class="fit ${s.cls || ''}" x1="${sx(x0)}" y1="${sy(s.fit.at(x0))}" x2="${sx(x1)}" y2="${sy(s.fit.at(x1))}"/>`;
      }
    }
    const ann = (opts.annotations || []).map((a) =>
      `<line class="ann" x1="${sx(a.x)}" x2="${sx(a.x)}" y1="${m.t}" y2="${H - m.b}"/>` +
      (a.label ? `<g class="ann-label" transform="translate(${Math.min(sx(a.x) + 6, W - 96)},${m.t + 4})"><rect width="88" height="20" rx="4"/><text x="44" y="14" text-anchor="middle">${esc(a.label)}</text></g>` : '')
    ).join('');
    return `<svg class="chart scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'Scatter chart')}">${g}${ann}${dots}${fits}<text class="axis-label" x="${W - m.r}" y="${H - 1}" text-anchor="end">${esc(opts.xLabel || '')}</text></svg>`;
  }

  /* Nested retention bars: one row per model, a shade per year of ownership. */
  function retentionBars(rows, opts) {
    const W = opts && opts.width || 560;
    const rowH = 46, labelW = 180, barW = W - labelW - 50;
    const H = rows.length * rowH + 6;
    let out = '';
    rows.forEach((r, i) => {
      const y = i * rowH + 6;
      out += `<text class="row-title" x="0" y="${y + 14}">${esc(r.title)}</text><text class="row-sub" x="0" y="${y + 30}">${esc(r.sub)}</text>`;
      out += `<rect class="track" x="${labelW}" y="${y + 6}" width="${barW}" height="22" rx="5"/>`;
      r.values.forEach((v, k) => {
        out += `<rect class="ret ret-${k + 1}" x="${labelW}" y="${y + 6}" width="${(Math.min(1, v) * barW).toFixed(1)}" height="22" rx="5"><title>Year ${k + 1}: ${Math.round(v * 100)}% of MSRP</title></rect>`;
      });
      out += `<text class="row-val" x="${W}" y="${y + 22}" text-anchor="end">${Math.round(r.values[r.values.length - 1] * 100)}%</text>`;
    });
    return `<svg class="chart bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Value retained by year of ownership">${out}</svg>`;
  }

  const TILES = {
    AK: [0, 0], ME: [11, 0], VT: [10, 1], NH: [11, 1],
    WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], WI: [6, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IL: [6, 3], IN: [7, 3], OH: [8, 3], PA: [9, 3], NJ: [10, 3], CT: [11, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
    OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
    HI: [0, 7], TX: [4, 7], FL: [9, 7],
  };

  /* State tile map. cell(state) -> { cls, value, title, selected } or null. */
  function tileMap(cell, opts) {
    const s = (opts && opts.size) || 40, gap = 4;
    const W = 12 * (s + gap), H = 8 * (s + gap);
    let out = '';
    for (const [st, [c, r]] of Object.entries(TILES)) {
      const d = cell(st);
      const x = c * (s + gap), y = r * (s + gap);
      const cls = d ? d.cls : 'tile-empty';
      const interactive = d && opts && opts.clickable ? ` data-state="${st}" role="button" tabindex="0" aria-label="${esc(d.title || st)}"` : '';
      out += `<g class="tile ${cls}${d && d.selected ? ' selected' : ''}"${interactive}><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6"/>` +
        `<text class="tile-st" x="${x + s / 2}" y="${y + (d && d.value != null ? s / 2 - 2 : s / 2 + 4)}" text-anchor="middle">${st}</text>` +
        (d && d.value != null ? `<text class="tile-val" x="${x + s / 2}" y="${y + s / 2 + 11}" text-anchor="middle">${esc(d.value)}</text>` : '') +
        (d && d.title ? `<title>${esc(d.title)}</title>` : '') + `</g>`;
    }
    return `<svg class="chart tilemap" viewBox="-2 -2 ${W + 2} ${H + 2}" role="img" aria-label="${esc((opts && opts.aria) || 'Map of states')}">${out}</svg>`;
  }

  /* Step chart of a listing's price over time. history oldest first, {daysAgo, price}. */
  function priceHistory(history, opts) {
    const W = (opts && opts.width) || 560, H = (opts && opts.height) || 180;
    const m = { t: 16, r: 16, b: 28, l: 56 };
    const start = history[0].daysAgo || 1;
    const prices = history.map((h) => h.price);
    let yMin = Math.min(...prices), yMax = Math.max(...prices);
    const pad = Math.max(500, (yMax - yMin) * 0.25);
    yMin -= pad; yMax += pad;
    const sx = (d) => m.l + ((start - d) / start) * (W - m.l - m.r);
    const sy = (p) => H - m.b - ((p - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    let path = `M${sx(history[0].daysAgo)},${sy(history[0].price)}`;
    for (let i = 1; i < history.length; i++) {
      path += ` H${sx(history[i].daysAgo)} V${sy(history[i].price)}`;
    }
    path += ` H${sx(0)}`;
    const area = `${path} V${H - m.b} H${sx(history[0].daysAgo)} Z`;
    let g = '';
    const fine = yMax - yMin < 6000;
    for (const t of niceTicks(yMin, yMax, 3)) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fine ? '$' + (t / 1000).toFixed(1) + 'k' : moneyK(t)}</text>`;
    }
    g += `<text class="tick" x="${m.l}" y="${H - 8}">${start} days ago</text><text class="tick" x="${W - m.r}" y="${H - 8}" text-anchor="end">Today</text>`;
    const pts = history.map((h, i) => `<circle class="hist-pt${i === history.length - 1 ? ' last' : ''}" cx="${sx(h.daysAgo)}" cy="${sy(h.price)}" r="4"><title>$${h.price.toLocaleString()} · ${h.daysAgo === 0 ? 'today' : h.daysAgo + ' days ago'}</title></circle>`).join('');
    return `<svg class="chart history" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history">${g}<path class="hist-area" d="${area}"/><path class="hist-line" d="${path}"/>${pts}</svg>`;
  }

  /* Simple vertical bars: [{label, value, title}] */
  function columns(items, opts) {
    const W = (opts && opts.width) || 560, H = (opts && opts.height) || 160;
    const m = { t: 18, b: 22 };
    const max = Math.max(...items.map((d) => d.value)) || 1;
    const bw = W / items.length;
    return `<svg class="chart columns" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((opts && opts.aria) || 'Bar chart')}">` +
      items.map((d, i) => {
        const h = (d.value / max) * (H - m.t - m.b);
        const x = i * bw + bw * 0.15;
        return `<g><rect class="col" x="${x}" y="${H - m.b - h}" width="${bw * 0.7}" height="${h}" rx="4"><title>${esc(d.title || d.label)}</title></rect>` +
          `<text class="col-val" x="${x + bw * 0.35}" y="${H - m.b - h - 5}" text-anchor="middle">${esc(d.display || '')}</text>` +
          `<text class="tick" x="${x + bw * 0.35}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text></g>`;
      }).join('') + `</svg>`;
  }

  /* Side-profile vehicle illustration tinted with the listing's paint color. */
  const BODIES = {
    Sedan: 'M14 60 C14 52 18 49 30 47 L58 44 L80 29 C86 25 94 24 104 24 L128 24 C138 24 144 27 152 33 L164 43 L184 46 C192 47 196 51 196 58 L196 64 L14 64 Z',
    Coupe: 'M12 60 C12 53 16 50 28 48 L64 44 L88 30 C94 27 102 26 112 26 L128 27 C138 28 146 33 156 41 L184 45 C192 46 196 51 196 58 L196 64 L12 64 Z',
    Convertible: 'M12 60 C12 53 16 50 28 48 L70 44 L86 36 L92 44 L150 43 L184 45 C192 46 196 51 196 58 L196 64 L12 64 Z',
    SUV: 'M12 60 L12 46 C12 41 15 39 22 38 L44 36 L62 18 C65 15 69 14 74 14 L150 14 C156 14 160 16 163 20 L176 36 L186 38 C192 39 196 43 196 50 L196 64 L12 64 Z',
    Wagon: 'M12 60 L12 48 C12 43 15 41 22 40 L48 38 L68 22 C71 19 75 18 80 18 L162 18 C168 18 172 21 174 26 L182 38 L188 40 C193 41 196 45 196 51 L196 64 L12 64 Z',
    Truck: 'M10 62 L10 44 C10 40 13 38 18 38 L44 36 L58 16 C60 13 63 12 67 12 L106 12 C110 12 113 14 114 18 L118 36 L196 36 L198 40 L198 64 L10 64 Z',
    Minivan: 'M12 60 L12 44 C12 39 15 37 22 36 L36 34 L58 14 C62 11 66 10 72 10 L168 10 C176 10 180 14 182 20 L188 36 C193 38 196 42 196 50 L196 64 L12 64 Z',
  };
  const WINDOWS = {
    Sedan: 'M66 43 L84 31 C89 28 95 27 103 27 L104 43 Z M108 27 L127 27 C135 27 141 30 147 35 L154 43 L108 43 Z',
    Coupe: 'M72 43 L91 32 C96 29 103 29 110 29 L112 43 Z M116 29 L127 30 C136 31 142 35 148 41 Z',
    Convertible: 'M90 41 L94 43 L100 43 Z',
    SUV: 'M50 36 L66 20 C68 18 70 17 74 17 L102 17 L102 36 Z M106 17 L136 17 L136 36 L106 36 Z M140 17 L150 17 C154 17 156 18 158 21 L170 36 L140 36 Z',
    Wagon: 'M56 38 L71 25 C73 23 76 22 80 22 L108 22 L108 38 Z M112 22 L142 22 L142 38 L112 38 Z M146 22 L161 22 C165 22 168 24 169 27 L175 38 L146 38 Z',
    Truck: 'M50 36 L61 19 C62 17 64 16 67 16 L84 16 L84 36 Z M88 16 L105 16 C108 16 110 18 110 20 L113 36 L88 36 Z',
    Minivan: 'M42 34 L61 17 C63 15 66 14 70 14 L98 14 L98 34 Z M102 14 L140 14 L140 34 L102 34 Z M144 14 L168 14 C173 14 176 16 177 20 L182 34 L144 34 Z',
  };
  function car(body, hex, opts) {
    const b = BODIES[body] ? body : 'Sedan';
    const front = b === 'Truck' ? 48 : 52;
    const rear = b === 'Truck' ? 164 : 160;
    return `<svg class="car-art${opts && opts.cls ? ' ' + opts.cls : ''}" viewBox="0 0 210 84" role="img" aria-label="${esc((opts && opts.label) || b)}">` +
      `<ellipse class="car-shadow" cx="105" cy="74" rx="92" ry="5"/>` +
      `<path d="${BODIES[b]}" fill="${esc(hex)}" class="car-body"/>` +
      `<path d="${WINDOWS[b]}" class="car-glass"/>` +
      `<path d="${BODIES[b]}" class="car-shine"/>` +
      [front, rear].map((x) => `<circle cx="${x}" cy="64" r="13" class="car-tire"/><circle cx="${x}" cy="64" r="6.5" class="car-rim"/>`).join('') +
      `</svg>`;
  }

  /* Area chart of a count over the last N days, with optional median price line. */
  function trend(series, opts) {
    const W = (opts && opts.width) || 560, H = (opts && opts.height) || 170;
    const m = { t: 14, r: 52, b: 24, l: 44 };
    const n = series.length - 1 || 1;
    const maxC = Math.max(1, ...series.map((s) => s.count));
    const meds = series.filter((s) => s.median != null);
    const mn = meds.length ? Math.min(...meds.map((s) => s.median)) * 0.97 : 0;
    const mx = meds.length ? Math.max(...meds.map((s) => s.median)) * 1.03 : 1;
    const sx = (i) => m.l + (i / n) * (W - m.l - m.r);
    const sy = (c) => H - m.b - (c / (maxC * 1.1)) * (H - m.t - m.b);
    const sp = (p) => H - m.b - ((p - mn) / (mx - mn || 1)) * (H - m.t - m.b);
    let line = '';
    series.forEach((s, i) => { line += `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(s.count).toFixed(1)}`; });
    const area = `${line}L${sx(n)},${H - m.b}L${sx(0)},${H - m.b}Z`;
    let g = '';
    for (const t of niceTicks(0, maxC * 1.1, 3)) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${kFmt(t)}</text>`;
    let med = '';
    if (meds.length > 1) {
      let d = '';
      series.forEach((s, i) => { if (s.median != null) d += `${d ? 'L' : 'M'}${sx(i).toFixed(1)},${sp(s.median).toFixed(1)}`; });
      med = `<path class="trend-med" d="${d}"/>`;
      for (const t of niceTicks(mn, mx, 3)) g += `<text class="tick" x="${W - m.r + 6}" y="${sp(t) + 4}">${moneyK(t)}</text>`;
    }
    const labels = [0, Math.round(n / 2), n].map((i) => `<text class="tick" x="${sx(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${series[i].daysAgo === 0 ? 'Today' : series[i].daysAgo + ' days ago'}</text>`).join('');
    const hits = series.map((s, i) => `<rect class="hit" x="${sx(i) - (W / n) / 2}" y="${m.t}" width="${W / n}" height="${H - m.t - m.b}"><title>${s.daysAgo === 0 ? 'Today' : s.daysAgo + ' days ago'}: ${s.count.toLocaleString()} for sale${s.median != null ? ' · median $' + Math.round(s.median).toLocaleString() : ''}</title></rect>`).join('');
    return `<svg class="chart trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((opts && opts.aria) || 'Inventory over time')}">${g}<path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${med}${labels}${hits}</svg>`;
  }

  /* ----- Real US geography (js/usmap.js): state outlines in the Albers USA projection ----- */

  const usGeo = () => (typeof USMap !== 'undefined' ? USMap : root.USMap) || null;
  const PX_PER_MILE = 1300 * (Math.PI / 180) / 69; // the projection's scale, in map pixels per mile
  const geoCache = new Map();
  // Bounding box and visual center of a state's outline, from its largest ring.
  function geoShape(st) {
    if (geoCache.has(st)) return geoCache.get(st);
    const d = usGeo().paths[st];
    let best = null, bestArea = 0;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of d.split('Z')) {
      if (!ring) continue;
      const pts = ring.slice(1).split('L').map((p) => p.split(',').map(Number));
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
        a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
        box[0] = Math.min(box[0], pts[i][0]); box[1] = Math.min(box[1], pts[i][1]); box[2] = Math.max(box[2], pts[i][0]); box[3] = Math.max(box[3], pts[i][1]);
      }
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
    }
    const out = { box, center: best || [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] };
    geoCache.set(st, out);
    return out;
  }
  // States too small to carry a label on a full-size map.
  const TINY = new Set(['RI', 'DE', 'DC', 'CT', 'NJ', 'MD', 'MA', 'NH', 'VT', 'HI']);

  // City dots on top of a map: area tracks the count, color is `cls`.
  function dotsHtml(groups, proj, maxN, opts) {
    const scale = (opts && opts.dotScale) || 1;
    return [...groups].sort((a, b) => b.count - a.count).map((g) => {
      const [x, y] = proj(g.lat, g.lng);
      const r = (3 + Math.sqrt(g.count / maxN) * 16) * scale;
      return `<g class="map-pt ${g.cls || ''}" data-city="${esc(g.city)}" role="button" tabindex="0" aria-label="${esc(g.title)}">` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>` +
        (g.count >= maxN * 0.25 || r > 9 * scale ? `<text x="${x.toFixed(1)}" y="${(y + 3.5 * scale).toFixed(1)}" style="font-size:${(10 * scale).toFixed(1)}px" text-anchor="middle">${g.count}</text>` : '') +
        `<title>${esc(g.title)}</title></g>`;
    }).join('');
  }

  /* Choropleth of the US drawn from real state outlines. cell(state) -> { cls, value, title, selected, href } or null.
     opts: { clickable, aria, labels, focus: 'TX' (zoom to one state), dots: [{ city, lat, lng, count, cls, title }] } */
  function geoMap(cell, opts) {
    const o = opts || {};
    const U = usGeo();
    if (!U) return tileMap(cell, opts);
    let vb = [0, 0, U.W, U.H], scale = 1;
    if (o.focus && U.paths[o.focus]) {
      const b = geoShape(o.focus).box;
      const w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08;
      vb = [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
      scale = vb[2] / U.W;
    }
    let out = '', labels = '';
    for (const st of Object.keys(U.paths)) {
      const c = cell(st);
      const cls = c ? c.cls : 'geo-empty';
      const act = c && (o.clickable || c.href) ? ` data-state="${st}"${c.href ? ` data-href="${esc(c.href)}"` : ''} role="button" tabindex="0" aria-label="${esc(c.title || st)}"` : '';
      out += `<path class="geo ${cls}${c && c.selected ? ' selected' : ''}${o.focus === st ? ' focus' : ''}" d="${U.paths[st]}"${act}>${c && c.title ? `<title>${esc(c.title)}</title>` : ''}</path>`;
      if (o.labels && c && !TINY.has(st) && (!o.focus || o.focus === st)) {
        const [x, y] = geoShape(st).center;
        const fs = o.focus ? 18 * scale : 16;
        labels += `<text class="geo-label${c.value != null ? ' has-val' : ''}" x="${x.toFixed(1)}" y="${(y + (c.value != null ? -1 : 3.5)).toFixed(1)}" text-anchor="middle" style="font-size:${fs.toFixed(1)}px">${st}</text>` +
          (c.value != null ? `<text class="geo-val" x="${x.toFixed(1)}" y="${(y + fs * 0.95).toFixed(1)}" text-anchor="middle" style="font-size:${(fs * 0.85).toFixed(1)}px">${esc(c.value)}</text>` : '');
      }
    }
    const dots = o.dots && o.dots.length ? dotsHtml(o.dots, U.project, Math.max(1, ...o.dots.map((g) => g.count)), { dotScale: scale }) : '';
    return `<svg class="chart geomap${o.focus ? ' focused' : ''}" viewBox="${vb.map((v) => v.toFixed(1)).join(' ')}" role="img" aria-label="${esc(o.aria || 'Map of the United States by state')}">${out}${labels}${dots}</svg>`;
  }

  /* Dot map of the US. Points are grouped by city; the circle area tracks the
     count and its color the median market position. */
  const US_OUTLINE = [[-124.7, 48.4], [-122.8, 49], [-95.2, 49], [-95.15, 49.38], [-94.6, 48.7], [-93, 48.6], [-91.4, 48.05], [-89.6, 48], [-88.4, 48.3],
    [-84.6, 46.5], [-82.4, 45.3], [-82.5, 43], [-83.1, 42], [-82.5, 41.7], [-79, 42.8], [-79.2, 43.4], [-76.3, 44.2], [-75, 44.9], [-71.5, 45],
    [-70.8, 45.4], [-70, 46.7], [-69.2, 47.45], [-68.2, 47.35], [-67.8, 47.1], [-67.8, 45.7], [-67, 44.9], [-68.8, 44.4], [-70.2, 43.7],
    [-70.7, 42.9], [-70, 41.7], [-71, 41.5], [-72, 41.3], [-73.6, 40.9], [-74, 40.6], [-74.1, 39.8], [-74.9, 38.9], [-75.5, 38.5], [-75.9, 37.2],
    [-76, 36.9], [-75.5, 35.2], [-76.5, 34.7], [-77.9, 33.9], [-79.2, 33.2], [-80.9, 32], [-81.4, 30.7], [-80.6, 28.4], [-80.1, 26.5],
    [-80.4, 25.2], [-81.1, 25.1], [-81.8, 26.1], [-82.7, 27.5], [-82.8, 28.9], [-83.7, 29.9], [-85.4, 29.7], [-86.5, 30.4], [-88, 30.4],
    [-89.6, 30.2], [-89.4, 29], [-90.2, 29.1], [-91.3, 29.3], [-93.3, 29.8], [-94.7, 29.4], [-96.3, 28.4], [-97.2, 27.7], [-97.4, 26],
    [-99.1, 26.5], [-99.5, 27.5], [-100.3, 28.3], [-101.4, 29.8], [-102.7, 29.7], [-103.2, 29], [-104.5, 29.6], [-106.5, 31.8], [-108.2, 31.8],
    [-108.2, 31.3], [-111.1, 31.3], [-114.8, 32.5], [-117.1, 32.5], [-117.3, 33.2], [-118.4, 33.8], [-120.6, 34.6], [-121.9, 36.6],
    [-122.5, 37.8], [-123.7, 39], [-124.4, 40.4], [-124.2, 42], [-124.6, 43], [-124, 46.3]];

  function usMap(groups, opts) {
    const U = usGeo();
    const W = U ? U.W : 760, H = U ? U.H : 430;
    const lower = (lat, lng) => [20 + (lng + 125) * 12.1 * 0.82, 16 + (50 - lat) * 13.6];
    const proj = U ? U.project : (lat, lng) => {
      if (lat > 51) return [36 + (lng + 170) * 3.1, 330 + (72 - lat) * 4.4];  // Alaska inset
      if (lng < -150) return [205 + (lng + 160.5) * 14, 360 + (22.5 - lat) * 14]; // Hawaii inset
      return lower(lat, lng);
    };
    const land = U ? Object.entries(U.paths).map(([st, d]) => `<path class="map-land map-state" d="${d}"><title>${st}</title></path>`).join('')
      : `<path class="map-land" d="${'M' + US_OUTLINE.map(([lng, lat]) => lower(lat, lng).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z'}"/>` +
        `<rect class="map-inset" x="14" y="318" width="150" height="100" rx="8"/><text class="map-inset-label" x="22" y="410">AK</text>` +
        `<rect class="map-inset" x="176" y="350" width="110" height="68" rx="8"/><text class="map-inset-label" x="184" y="410">HI</text>`;
    const maxN = Math.max(1, ...groups.map((g) => g.count));
    let ring = '';
    // One ring for `radius`, or several for `rings` (the first is the main one; the rest are wider).
    const radii = opts && opts.center ? (opts.rings || (opts.radius ? [opts.radius] : [])) : [];
    radii.forEach((r, i) => {
      const [cx, cy] = proj(opts.center[0], opts.center[1]);
      const rx = U ? r * PX_PER_MILE : (r / 69 / Math.cos(opts.center[0] * Math.PI / 180)) * 12.1 * 0.82;
      const ry = U ? r * PX_PER_MILE : (r / 69) * 13.6;
      ring = `<ellipse class="map-ring${i ? ' map-ring-wide' : ''}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>` + ring;
    });
    if (opts && opts.center) {
      const [cx, cy] = proj(opts.center[0], opts.center[1]);
      ring += `<g class="map-home"><circle cx="${cx}" cy="${cy}" r="9"/><circle cx="${cx}" cy="${cy}" r="3.5"/></g>`;
    }
    const dots = dotsHtml(groups, proj, maxN);
    return `<svg class="chart usmap${U ? ' geo' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((opts && opts.aria) || 'Map of listings')}">` +
      land + ring + dots + `</svg>`;
  }


  // A map centered on you: rings at each radius in `rings` (miles), cities as dots sized by
  // count and colored by `cls`, the biggest labeled. Distance from the center is drawn on a
  // square-root scale, so the cars near you get the room and the far ones still fit.
  // groups: [{ city, lat, lng, count, cls, title, inside }].
  function localMap(groups, opts) {
    const W = 560, H = 420, cx = W / 2, cy = H / 2;
    const [lat0, lng0] = opts.center;
    const rings = (opts.rings || []).filter(Boolean).sort((a, b) => a - b);
    const outer = rings[rings.length - 1] || 500;
    const R = Math.min(W, H) / 2 - 24;
    const px = (miles) => R * Math.sqrt(Math.min(miles, outer * 1.05) / outer);
    const proj = (lat, lng) => {
      const dx = (lng - lng0) * Math.cos(lat0 * Math.PI / 180) * 69.17, dy = (lat - lat0) * 69.17;
      const d = Math.hypot(dx, dy);
      if (!d) return [cx, cy, 0];
      const r = px(d);
      return [cx + (dx / d) * r, cy - (dy / d) * r, d];
    };
    const ringsHtml = rings.map((r, i) => {
      const rp = px(r);
      const a = i === rings.length - 1 ? -Math.PI / 2 : Math.PI / 2; // top for the outer ring, bottom for inner ones
      return `<circle class="lm-ring${i === rings.length - 1 ? ' lm-ring-wide' : ''}" cx="${cx}" cy="${cy}" r="${rp.toFixed(1)}"/>` +
        `<text class="lm-ring-label" x="${(cx + Math.cos(a) * (rp + 9)).toFixed(1)}" y="${(cy + Math.sin(a) * (rp + 9) + 4).toFixed(1)}" text-anchor="middle">${r} mi</text>`;
    }).join('');
    const maxN = Math.max(1, ...groups.map((g) => g.count));
    const placed = [];
    const dots = [...groups].sort((a, b) => b.count - a.count).map((g) => {
      const [x, y, d] = proj(g.lat, g.lng);
      if (d > outer) return '';
      const r = 4 + Math.sqrt(g.count / maxN) * 15;
      const name = g.city.split(',')[0];
      const want = g.inside || g.count >= maxN * 0.25;
      const clash = placed.some((p) => Math.abs(p[0] - x) < 90 && Math.abs(p[1] - y) < 15);
      const label = want && !clash;
      if (label) placed.push([x + r + 30, y]);
      return `<g class="map-pt lm-pt ${g.cls || ''}" data-city="${esc(g.city)}" role="button" tabindex="0" aria-label="${esc(g.title)}">` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>` +
        (r > 9 ? `<text class="lm-count" x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle">${g.count}</text>` : '') +
        (label ? `<text class="lm-name" x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(name)}</text>` : '') +
        `<title>${esc(g.title)}</title></g>`;
    }).join('');
    const cross = `<path class="lm-grid" d="M${cx} ${cy - R}V${cy + R}M${cx - R} ${cy}H${cx + R}"/>`;
    const home = `<g class="map-home"><circle cx="${cx}" cy="${cy}" r="9"/><circle cx="${cx}" cy="${cy}" r="3.5"/></g>`;
    return `<svg class="chart localmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'Map of cars for sale around you')}">` +
      `<circle class="lm-bg" cx="${cx}" cy="${cy}" r="${R.toFixed(1)}"/>` + cross + ringsHtml + home + dots +
      `<text class="lm-you" x="${cx - 13}" y="${cy - 10}" text-anchor="end">You</text></svg>`;
  }

  const api = { scatter, retentionBars, tileMap, geoMap, priceHistory, columns, car, trend, usMap, localMap, niceTicks, esc, TILES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Charts = api;
})(typeof window !== 'undefined' ? window : globalThis);
