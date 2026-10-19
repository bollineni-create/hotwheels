/* Natural-language search: turns "red convertibles under 40k with leather
   seats" into structured filters. Pure and data-driven, so it runs in Node
   tests as well as the browser. */
(function (root) {
  'use strict';

  const STATES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
    louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
    montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
    'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
    washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  };

  const BODY = [
    [/\b(pickups?|trucks?)\b/, 'Truck'], [/\b(suvs?|crossovers?)\b/, 'SUV'], [/\bsedans?\b/, 'Sedan'], [/\bcoupes?\b/, 'Coupe'],
    [/\b(convertibles?|roadsters?|drop-?tops?)\b/, 'Convertible'], [/\bwagons?\b/, 'Wagon'], [/\b(mini-?vans?|vans?)\b/, 'Minivan'],
  ];
  const DRIVE = [[/\b(awd|all[- ]wheel drive)\b/, 'AWD'], [/\b(4wd|4x4|four[- ]wheel drive)\b/, '4WD'], [/\b(fwd|front[- ]wheel drive)\b/, 'FWD'], [/\b(rwd|rear[- ]wheel drive)\b/, 'RWD']];
  // Transmission words. "Stick" and "three pedals" are how enthusiasts say manual.
  const TRANS = [[/\b(manuals?( transmission| gearbox)?|stick( ?shifts?)?|(5|6|7|five|six|seven)[- ]speed manual|(3|three)[- ]pedals?|row your own)\b/, 'Manual'],
    [/\b(cvts?|continuously variable)\b/, 'CVT'], [/\b(automatics?( transmission)?|auto transmission|autotragic)\b/, 'Automatic']];
  const FUEL = [[/\b(plug-?in( hybrid)?s?|phevs?)\b/, 'Plug-in Hybrid'], [/\bhybrids?\b/, 'Hybrid'], [/\b(electric|evs?|bevs?)\b/, 'Electric'], [/\bdiesels?\b/, 'Diesel']];
  const COLORS = { red: 'Red', blue: 'Blue', black: 'Black', white: 'White', gray: 'Gray', grey: 'Gray', silver: 'Silver', green: 'Green',
    brown: 'Brown', bronze: 'Brown', beige: 'Beige', tan: 'Beige', orange: 'Orange', yellow: 'Yellow', gold: 'Yellow', purple: 'Purple' };
  const FEATURES = [
    [/leather( seats?| interior)?/, 'Leather Seats'], [/(heated seats?|seat heaters?)/, 'Heated Seats'],
    [/(ventilated|cooled) seats?/, 'Ventilated Seats'], [/panoramic( roof| sunroof| moonroof)?/, 'Panoramic Roof'],
    [/(sun|moon) ?roofs?/, 'Sunroof/Moonroof'], [/(apple )?carplay/, 'Apple CarPlay'], [/android auto/, 'Android Auto'],
    [/(third|3rd)[- ]row( seating| seats?)?|7[- ]seaters?|8[- ]seaters?/, 'Third-Row Seating'],
    [/tow(ing)?( package| hitch| pkg)?/, 'Tow Package'], [/(navigation|nav|gps)/, 'Navigation'], [/(heads?[- ]up( display)?|hud)/, 'Head-Up Display'],
    [/(360|surround)[- °]?(view )?cameras?/, '360° Camera'], [/adaptive cruise( control)?/, 'Adaptive Cruise Control'],
    [/blind[- ]spot( monitor(ing)?)?/, 'Blind Spot Monitor'], [/remote start/, 'Remote Start'], [/heated (steering )?wheel/, 'Heated Steering Wheel'],
    [/premium (audio|sound|stereo)/, 'Premium Audio'], [/air suspension/, 'Air Suspension'], [/off[- ]road (package|pkg)/, 'Off-Road Package'],
    [/(super cruise|self[- ]driving|hands[- ]free( driving)?|autopilot)/, 'Hands-Free Driving'], [/wireless charg(ing|er)/, 'Wireless Charging'],
    [/power (liftgate|tailgate)/, 'Power Liftgate'],
  ];
  const STOP = new Set(('a an the and or with w for sale cars car vehicles vehicle show me find i want looking that has have having ' +
    'in near around under over below above less more than between to from of on by any some please only miles mi price priced ' +
    'interior exterior color colored seats seat').split(' '));

  const money = (raw, k) => {
    let v = parseFloat(String(raw).replace(/[$,]/g, ''));
    if (k || v < 1000) v *= 1000;
    return Math.round(v);
  };

  function build(data) {
    const models = data.models.map((m) => {
      const name = m.model.toLowerCase();
      const aliases = new Set([name, `${(m.make || '').toLowerCase()} ${name}`.trim(), name.replace(/-/g, ''), name.replace(/-/g, ' ')]);
      if (m.model === 'MX-5 Miata') ['miata', 'mx5', 'mx-5'].forEach((a) => aliases.add(a));
      if (m.model === '3 Series') ['3 series', '3-series', '330i', 'm340i'].forEach((a) => aliases.add(a));
      if (m.model === 'Silverado 1500') ['silverado'].forEach((a) => aliases.add(a));
      if (m.model === '2') ['polestar 2', 'polestar'].forEach((a) => aliases.add(a));
      if (m.model === '1500') { aliases.delete('1500'); aliases.add('ram 1500'); aliases.add('ram'); }
      if (m.make === 'Tesla') aliases.add(name.replace('model ', 'model'));
      return { key: m.make ? `${m.make} ${m.model}` : m.model, make: m.make, trims: (m.trims || []).map((t) => t[0]), aliases: [...aliases].filter((a) => a.length > 1) };
    });
    const makes = [...new Set(data.models.map((m) => m.make).concat(data.makes || []).filter(Boolean))];
    const cities = [...new Set(data.cities.map((c) => `${c[0]}, ${c[1]}`))];
    const paints = [...new Set(data.paints || [])];
    const upfitters = [...new Set(data.upfitters || [])];
    return { models, makes, cities, paints, upfitters, currentYear: data.currentYear || 2026 };
  }

  // Escape for use inside a RegExp.
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (s) => new RegExp(`(^|[^a-z0-9])${rx(s)}s?(?=$|[^a-z0-9])`);

  function parse(text, vocab) {
    let t = ` ${String(text || '').toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ')} `;
    const f = { ex: {} };
    const understood = [];
    const add = (key, value, label) => {
      f[key] = f[key] || [];
      if (!f[key].includes(value)) f[key].push(value);
      understood.push(label || value);
    };
    const exclude = (key, value) => {
      f.ex[key] = f.ex[key] || [];
      if (!f.ex[key].includes(value)) f.ex[key].push(value);
      understood.push(`without ${value}`);
    };
    const take = (re) => {
      const m = t.match(re);
      if (m) t = t.replace(m[0], ' ');
      return m;
    };

    // Exclusions first: "without sunroof", "no private sellers", "exclude red"
    let m;
    const exRe = /\b(?:without|no|exclude|excluding|except|not)\s+([a-z0-9°&' -]+?)(?=$|,|\.| with | and | under | over | below | above | near | in | from )/;
    while ((m = t.match(exRe))) {
      const phrase = m[1].trim();
      t = t.replace(m[0], ' ');
      const feat = FEATURES.find(([re]) => re.test(phrase));
      const up = vocab.upfitters.find((u) => phrase.includes(u.toLowerCase()));
      const trans = TRANS.find(([re]) => re.test(phrase));
      if (trans) exclude('transmission', trans[1]);
      else if (feat) exclude('features', feat[1]);
      else if (up) exclude('upfitter', up);
      else if (/private/.test(phrase)) exclude('seller', 'Private');
      else if (/(upfit|lift|modified|aftermarket)/.test(phrase)) f.noUpfit = understood.push('no upfits');
      else if (COLORS[phrase.split(' ')[0]]) exclude('colorFamily', COLORS[phrase.split(' ')[0]]);
      else {
        const body = BODY.find(([re]) => re.test(phrase));
        if (body) exclude('body', body[1]);
      }
    }

    // Mileage before price so "under 50k miles" isn't read as a price.
    if ((m = take(/\b(?:under|below|less than|fewer than|<|max|up to)\s*([\d,.]+)\s*(k)?\s*(?:miles|mi)\b/))) {
      f.milesMax = money(m[1], m[2]);
      understood.push(`under ${Math.round(f.milesMax / 1000)}k miles`);
    } else if ((m = take(/\b(low|lowest)[- ]mile(age|s)?\b/))) {
      f.milesMax = 40000;
      understood.push('under 40k miles');
    }
    if ((m = take(/\bbetween\s*\$?([\d,.]+)\s*(k)?\s*(?:and|-|to)\s*\$?([\d,.]+)\s*(k)?/))) {
      f.priceMin = money(m[1], m[2] || m[4]);
      f.priceMax = money(m[3], m[4]);
      understood.push(`$${f.priceMin.toLocaleString('en-US')}–$${f.priceMax.toLocaleString('en-US')}`);
    }
    if ((m = take(/\b(?:under|below|less than|max|up to|cheaper than|<)\s*\$?([\d,.]+)\s*(k|grand|thousand)?\b/))) {
      f.priceMax = money(m[1], m[2]);
      understood.push(`under $${f.priceMax.toLocaleString('en-US')}`);
    }
    if ((m = take(/\b(?:over|above|more than|at least|>)\s*\$?([\d,.]+)\s*(k|grand|thousand)?\b/))) {
      f.priceMin = money(m[1], m[2]);
      understood.push(`over $${f.priceMin.toLocaleString('en-US')}`);
    }

    // Years: "2022", "2020+", "2019-2021", "2020 or newer"
    const cy = vocab.currentYear + 1;
    const span = (a, b) => { for (let y = a; y <= b; y++) (f.year = f.year || []).push(String(y)); };
    if ((m = take(/\b((?:19|20)\d\d)\s*(?:-|to|through)\s*((?:19|20)\d\d)\b/))) {
      span(+m[1], +m[2]);
      understood.push(`${m[1]}–${m[2]}`);
    } else if ((m = take(/\b((?:19|20)\d\d)\s*(?:\+|or newer|and newer|or later|and up)/)) || (m = take(/\b(?:newer than|after|since)\s*((?:19|20)\d\d)\b/))) {
      span(+m[1] + (/newer than|after/.test(m[0]) ? 1 : 0), cy);
      understood.push(`${m[1]} or newer`);
    } else if ((m = take(/\b((?:19|20)\d\d)\b/))) {
      add('year', m[1]);
    }

    // Location: "near denver", "in texas", "in tx"
    for (const c of vocab.cities) {
      const city = c.split(',')[0].toLowerCase();
      if ((m = take(new RegExp(`\\b(?:near|around|close to|in)\\s+${rx(city)}\\b`)))) {
        f.near = c;
        understood.push(`near ${c}`);
        break;
      }
    }
    for (const [name, code] of Object.entries(STATES).sort((a, b) => b[0].length - a[0].length)) {
      if ((m = take(new RegExp(`\\bin\\s+(?:${rx(name)}|${code.toLowerCase()})\\b`)))) {
        add('state', code, `in ${code}`);
        break;
      }
    }

    // Models (longest alias first), then makes.
    const aliases = vocab.models.flatMap((md) => md.aliases.map((a) => [a, md])).sort((a, b) => b[0].length - a[0].length);
    const foundModels = [];
    for (const [alias, md] of aliases) {
      if (foundModels.includes(md)) continue;
      const re = wordRe(alias);
      if (re.test(t)) {
        t = t.replace(re, '$1 ');
        foundModels.push(md);
        add('model', md.key);
      }
    }
    for (const mk of vocab.makes) {
      const re = wordRe(mk.toLowerCase());
      if (re.test(t)) {
        t = t.replace(re, '$1 ');
        if (!foundModels.some((md) => md.make === mk)) add('make', mk);
      }
    }
    if (foundModels.length === 1) {
      for (const trim of [...foundModels[0].trims].sort((a, b) => b.length - a.length)) {
        const re = wordRe(trim.toLowerCase());
        if (trim.length > 1 && re.test(t)) {
          t = t.replace(re, '$1 ');
          add('trim', trim);
        }
      }
    }

    for (const up of vocab.upfitters) {
      const re = wordRe(up.toLowerCase());
      if (re.test(t)) { t = t.replace(re, '$1 '); add('upfitter', up); }
    }
    if ((m = take(/\b(private (seller|party|owner)s?|by owner|fsbo)\b/))) add('seller', 'Private', 'private sellers');
    if ((m = take(/\b(dealers? only|from dealers?)\b/))) add('seller', 'Dealer', 'dealers only');

    if ((m = take(/\b(certified|cpo)\b/))) add('condition', 'Certified');
    else if ((m = take(/\b(used|pre-?owned)\b/))) { add('condition', 'Used'); add('condition', 'Certified', 'certified'); }
    else if ((m = take(/\bnew\b/))) add('condition', 'New');

    for (const [re, v] of BODY) if ((m = take(re))) add('body', v);
    for (const [re, v] of DRIVE) if ((m = take(re))) add('drivetrain', v);
    for (const [re, v] of FUEL) if ((m = take(re))) add('fuel', v);
    for (const [re, v] of TRANS) if ((m = take(re))) add('transmission', v, v === 'Manual' ? 'manual transmission' : v === 'CVT' ? 'CVT' : 'automatic');

    for (const paint of [...vocab.paints].sort((a, b) => b.length - a.length)) {
      const re = wordRe(paint.toLowerCase());
      if (paint.length > 3 && re.test(t)) { t = t.replace(re, '$1 '); add('extColor', paint); }
    }
    for (const [word, fam] of Object.entries(COLORS)) {
      let re = new RegExp(`\\b${word}\\s+(?:leather\\s+)?interior\\b`);
      if ((m = take(re))) { add('interiorFamily', fam, `${fam.toLowerCase()} interior`); continue; }
      re = new RegExp(`\\b${word}\\b`);
      if ((m = take(re))) add('colorFamily', fam, fam.toLowerCase());
    }
    for (const [re, v] of FEATURES) {
      const full = new RegExp(`\\b${re.source}\\b`);
      if ((m = take(full))) add('features', v);
    }

    if ((m = take(/\b(cheap|cheapest|affordable|inexpensive)\b/))) { f.sort = 'price-asc'; understood.push('cheapest first'); }
    if ((m = take(/\b(price (drops?|cuts?|reductions?)|reduced|price dropped)\b/))) { f.dropsOnly = true; understood.push('price cuts'); }
    if ((m = take(/\b(good |great |best )?(deals?|below market|under ?priced|bargains?)\b/))) { f.belowMarket = true; understood.push('below market'); }

    const rest = t.split(/[\s,.!?]+/).filter((w) => w && !STOP.has(w)).join(' ');
    return { filters: f, understood, rest };
  }

  /* Filter finder: "brown interior", "without sunroof". Matches the text against
     every filter value currently available, with live counts. */
  function findFilters(text, facets, labels) {
    let q = String(text || '').toLowerCase().trim();
    if (!q) return [];
    let exclude = false;
    const ex = q.match(/^(without|no|exclude|excluding|not)\s+(.*)$/);
    if (ex) { exclude = true; q = ex[2]; }
    if (!q) return [];
    const words = q.split(/\s+/);
    const out = [];
    for (const [key, items] of Object.entries(facets)) {
      const label = (labels[key] || key).toLowerCase();
      for (const it of items) {
        const val = String(it.value).toLowerCase();
        const hay = `${val} ${label}`;
        if (!words.every((w) => hay.includes(w))) continue;
        // Prefer matches on the value itself over matches on the group name.
        const score = (val === q ? 0 : val.startsWith(q) ? 1 : words.every((w) => val.includes(w)) ? 2 : 3) - Math.min(it.count, 999) / 1000;
        out.push({ key, value: it.value, count: it.count, label: labels[key] || key, exclude, score });
      }
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 12);
  }

  const api = { build, parse, findFilters, STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NLQ = api;
})(typeof window !== 'undefined' ? window : globalThis);
