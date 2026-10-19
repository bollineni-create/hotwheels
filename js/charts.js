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

  const api = { scatter, retentionBars, tileMap, priceHistory, columns, car, niceTicks, esc, TILES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Charts = api;
})(typeof window !== 'undefined' ? window : globalThis);
