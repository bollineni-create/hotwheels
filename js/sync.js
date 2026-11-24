/* Gridline sync: keeps hunts, favorites, compare and display settings the same on every device.
   There is no account. One device creates a sync code and the others enter it. From the code the
   browser derives an id (what the server knows this save by) and an encryption key (which never
   leaves the device), so the server stores text it cannot read.

   What is synced is a small document where every favorite, hunt and setting carries the time it
   last changed. Two devices' documents merge item by item, the later change winning, and a
   deleted item leaves a marker behind so the deletion wins too instead of the item coming back.
   The server keeps a version with each save and refuses one made from an older version, handing
   back what it has, so a device merges and tries again rather than overwriting another's change. */
(function (root) {
  'use strict';

  const webcrypto = root.crypto;
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O or U
  const CODE_LENGTH = 25; // 125 random bits
  const DAY = 86400000;
  const MARKER_DAYS = 90; // how long a deletion is remembered
  const PREF_KEYS = ['homeZip', 'homeRadius', 'showDealer', 'compact', 'valueSort', 'huntEvery', 'theme'];
  const MAX_PAYLOAD = 380000; // the server allows 400,000 characters
  const MAX_CARS = 150;

  /* ---------- The code ---------- */

  function newCode() {
    const bytes = webcrypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  }
  // Accepts the code however it was typed: any case, with or without dashes and spaces, and with
  // the letters people mistake for digits. Returns the 25 characters, or null.
  function normalizeCode(text) {
    const c = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
  }
  const formatCode = (code) => String(code || '').replace(/(.{5})(?=.)/g, '$1-');

  const utf8 = (s) => new TextEncoder().encode(s);
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const fromBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

  // The id and the key come from the code by two separate derivations, so knowing the id (as the
  // server does) says nothing about the key.
  async function derive(code) {
    const subtle = webcrypto.subtle;
    const material = await subtle.importKey('raw', utf8(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: utf8('bollineni-sync'), info: utf8(info) });
    const id = hex(await subtle.deriveBits(params('id/v1'), material, 256));
    const key = await subtle.deriveKey(params('key/v1'), material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { id, key };
  }
  async function seal(key, value) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(value))));
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return toBase64(out);
  }
  async function open(key, payload) {
    const bytes = fromBase64(payload);
    const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ---------- The document ---------- */

  // The part of Gridline's saved state that syncs. A hunt's own findings (what it has seen, what
  // is new) stay on each device, as do recently viewed cars, the data source and API keys.
  function snapshot(s) {
    const hunts = {};
    for (const h of s.saved || []) hunts[h.id] = { name: h.name, params: h.params, createdAt: h.createdAt || 0, watch: !!(h.hunt && h.hunt.watch), count: h.count == null ? null : h.count };
    const prefs = {};
    for (const k of PREF_KEYS) prefs[k] = k === 'theme' ? s.theme || null : s.prefs[k] == null ? null : s.prefs[k];
    return { favs: Object.assign({}, s.favs), hunts, compare: (s.compare || []).slice(), prefs };
  }
  const huntKey = (h) => JSON.stringify([h.name, h.params, h.createdAt, h.watch]);
  const emptyDoc = () => ({ v: 1, favs: {}, hunts: {}, compare: { ids: [], t: 0 }, prefs: {}, cars: {} });

  // Brings the document up to date with what changed on this device between two snapshots, each
  // change taking the time `now`. With no earlier snapshot the device is syncing for the first
  // time: its favorites and hunts are kept (time 1, so they join the other devices'), while its
  // settings and compare list give way to whatever is already synced (time 0).
  function stamp(doc, before, after, now) {
    let changed = false;
    const first = !before;
    const put = (map, id, entry) => { map[id] = entry; changed = true; };
    for (const [id, price] of Object.entries(after.favs)) {
      if (first ? !doc.favs[id] : before.favs[id] !== price) put(doc.favs, id, { p: price, t: first ? 1 : now });
    }
    for (const [id, h] of Object.entries(after.hunts)) {
      if (first ? !doc.hunts[id] : !before.hunts[id] || huntKey(before.hunts[id]) !== huntKey(h)) put(doc.hunts, id, { h, t: first ? 1 : now });
    }
    if (!first) {
      for (const id of Object.keys(before.favs)) if (!(id in after.favs)) put(doc.favs, id, { x: 1, t: now });
      for (const id of Object.keys(before.hunts)) if (!(id in after.hunts)) put(doc.hunts, id, { x: 1, t: now });
    }
    if (first ? !doc.compare.t && !doc.compare.ids.length && after.compare.length : JSON.stringify(before.compare) !== JSON.stringify(after.compare)) {
      doc.compare = { ids: after.compare.slice(), t: first ? 0 : now };
      changed = true;
    }
    for (const k of PREF_KEYS) {
      if (first ? !doc.prefs[k] : before.prefs[k] !== after.prefs[k]) put(doc.prefs, k, { v: after.prefs[k], t: first ? 0 : now });
    }
    return changed;
  }

  // One document from this device's and the synced one. For each item the later change wins, and
  // when the times are equal the synced copy does. Deletion markers older than 90 days are dropped.
  function merge(local, remote, now) {
    const out = emptyDoc();
    const later = (a, b) => (!b ? a : !a ? b : a.t > b.t ? a : b);
    for (const part of ['favs', 'hunts']) {
      const mine = local[part] || {}, theirs = remote[part] || {};
      for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
        const e = later(mine[id], theirs[id]);
        if (e.x && now - e.t > MARKER_DAYS * DAY) continue;
        out[part][id] = e;
      }
    }
    out.compare = later(local.compare, remote.compare) || out.compare;
    for (const k of PREF_KEYS) {
      const e = later((local.prefs || {})[k], (remote.prefs || {})[k]);
      if (e) out.prefs[k] = e;
    }
    const cars = Object.assign({}, local.cars, remote.cars);
    for (const id of carIds(out)) if (cars[id]) out.cars[id] = cars[id];
    return out;
  }
  const kept = (map) => Object.keys(map).filter((id) => !map[id].x);
  const carIds = (doc) => [...new Set([...kept(doc.favs), ...doc.compare.ids])];

  // Whether two documents say the same thing, whatever order their keys are in.
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    return v;
  }
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  const PREF_OK = {
    homeZip: (v) => v === null || /^\d{5}$/.test(v),
    homeRadius: (v) => Number.isFinite(v) && v > 0 && v <= 5000,
    showDealer: (v) => typeof v === 'boolean',
    compact: (v) => typeof v === 'boolean',
    valueSort: (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v),
    huntEvery: (v) => Number.isFinite(v) && v >= 0,
    theme: (v) => v === null || v === 'dark' || v === 'light',
  };
  const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

  // What arrives through sync was written by whoever holds the code, which is not always the
  // person at this device (someone can be talked into entering a stranger's code). Gridline puts
  // listing fields into its pages, so nothing synced may be able to act as markup: ids are plain
  // tokens, and in every other string the characters that open a tag or close an attribute are
  // swapped for look-alikes.
  const ID_OK = (id) => typeof id === 'string' && /^[\w.:-]{1,80}$/.test(id);
  const LOOKALIKE = { '<': '‹', '>': '›', '"': '″', '`': '′' };
  const plainText = (v) => v.replace(/[<>"`]/g, (ch) => LOOKALIKE[ch]);
  const SCRIPT_URL = /^\s*(javascript|data|vbscript)\s*:/i;
  // A copy of a synced car holding only plain values, or null if it can't be made safe.
  function cleanCar(car, id) {
    let budget = 3000;
    const copy = (v, depth) => {
      if (--budget < 0 || depth > 6) throw new Error('too much');
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('number'); return v; }
      if (typeof v === 'string') {
        if (v.length > 2000 || SCRIPT_URL.test(v)) throw new Error('string');
        return plainText(v);
      }
      if (Array.isArray(v)) return v.map((x) => copy(x, depth + 1));
      if (typeof v !== 'object') throw new Error('type');
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (k.length > 80 || k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error('key');
        out[plainText(k)] = copy(x, depth + 1);
      }
      return out;
    };
    try {
      if (!car || typeof car !== 'object' || Array.isArray(car) || car.id !== id || !ID_OK(id)) return null;
      const out = copy(car, 0);
      // These two become part of a class name and an address.
      if ('condition' in out && !/^[A-Za-z][A-Za-z -]{0,30}$/.test(out.condition)) return null;
      if ('vin' in out && out.vin !== null && !/^[A-Za-z0-9*?_.-]{0,20}$/.test(out.vin)) return null;
      return out;
    } catch (e) { return null; }
  }

  // Makes Gridline's saved state match the document. `makeHunt` builds a new hunt's own findings.
  // Anything in the document that isn't the shape Gridline saves is left out.
  function apply(doc, s, makeHunt) {
    s.favs = {};
    for (const id of kept(doc.favs)) if (ID_OK(id) && Number.isFinite(doc.favs[id].p)) s.favs[id] = doc.favs[id].p;
    const want = {};
    for (const id of kept(doc.hunts)) {
      const h = doc.hunts[id].h;
      if (ID_OK(id) && h && text(h.name, 200) && typeof h.params === 'string' && h.params.length <= 4000 && !/[<>"`\s]/.test(h.params)) want[id] = h;
    }
    s.saved = (s.saved || []).filter((x) => want[x.id]);
    for (const x of s.saved) {
      const h = want[x.id];
      x.name = plainText(h.name);
      x.createdAt = Number(h.createdAt) || 0;
      // The same hunt with a different search is a different search: what it found no longer applies.
      if (x.params !== h.params) { x.params = h.params; x.count = Number.isFinite(h.count) ? h.count : null; x.hunt = null; }
      if (!x.hunt) x.hunt = Object.assign(makeHunt(), { watch: false });
      x.hunt.watch = !!h.watch;
      delete want[x.id];
    }
    for (const [id, h] of Object.entries(want)) {
      s.saved.push({ id, name: plainText(h.name), params: h.params, count: Number.isFinite(h.count) ? h.count : null, createdAt: Number(h.createdAt) || 0, hunt: Object.assign(makeHunt(), { watch: !!h.watch }) });
    }
    s.saved.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    s.compare = doc.compare.ids.filter(ID_OK).slice(0, 4);
    for (const k of PREF_KEYS) {
      const e = doc.prefs[k];
      if (!e || !PREF_OK[k](e.v)) continue;
      if (k === 'theme') s.theme = e.v;
      else s.prefs[k] = e.v;
    }
    if (!s.prefs.homeZip) s.prefs.homeCity = null;
    s.liveCars = s.liveCars || {};
    for (const id of carIds(doc)) {
      if (s.liveCars[id] || !doc.cars[id]) continue;
      const car = cleanCar(doc.cars[id], id);
      if (car) s.liveCars[id] = car;
    }
  }

  /* ---------- Talking to the server ---------- */

  const failure = (reason, message) => Object.assign(new Error(message), { reason });
  const MESSAGES = {
    code: 'That isn’t a sync code. It has 25 letters and digits.',
    empty: 'Nothing is saved under that code. Check it against the one on your other device.',
    erased: 'Sync was erased from another device. Everything is still saved here.',
    unreadable: 'The synced copy couldn’t be read with this code.',
    rate_limited: 'Too many requests. Sync will try again shortly.',
    offline: 'Couldn’t reach sync. It will try again.',
    too_large: 'There’s too much to sync.',
  };

  // `o`: fetch, storage ({ get, set, remove } for one string), url (the app's sync address),
  // state() (Gridline's saved state), commit(fn) (changes it and saves), makeHunt, now(), and
  // onStatus(), called whenever status() would answer differently.
  function createEngine(o) {
    // A device whose clock is far off would always win or always lose: the server's Date header
    // corrects it, only past two minutes so ordinary drift changes nothing.
    let skew = 0;
    const now = o.now || (() => Date.now() + skew);
    let meta = null; // { code, version, doc, shadow, syncedAt, dirty }
    let keys = null; // { id, key } for meta.code
    let phase = 'idle', problem = null, applying = false;
    let queue = Promise.resolve();
    let timer = null, pending = false;

    // What was synced when sync last stopped here: linking again starts from it, so a change made
    // to an existing car or hunt in between counts as newer than the other devices' copies.
    let kept = null;
    try { meta = JSON.parse(o.storage.get() || 'null'); } catch (e) { meta = null; }
    if (meta && !normalizeCode(meta.code)) { if (meta.kept && meta.kept.doc) kept = meta.kept; meta = null; }

    const persist = () => { try { if (meta) { meta.savedAt = Date.now(); o.storage.set(JSON.stringify(meta)); } else if (kept) o.storage.set(JSON.stringify({ code: null, kept })); else o.storage.remove(); } catch (e) { /* private mode */ } };
    const stop = () => { if (meta) kept = { doc: meta.doc, shadow: meta.shadow }; meta = null; keys = null; };
    const fresh = (code, dirty) => { const k = kept; kept = null; return { code, version: null, doc: k ? k.doc : emptyDoc(), shadow: k ? k.shadow : null, syncedAt: null, dirty, _kept: k }; };
    const tell = (p, err) => { phase = p; problem = err || null; if (o.onStatus) o.onStatus(); };
    const status = () => ({ on: !!meta, code: meta ? formatCode(meta.code) : null, phase, problem, syncedAt: meta ? meta.syncedAt || null : null });
    // One thing at a time: a save never overlaps a read of the same file.
    const serial = (job) => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };

    async function request(method, body) {
      if (!keys) keys = await derive(meta.code);
      let r;
      try {
        r = await o.fetch(o.url, {
          method,
          headers: Object.assign({ Authorization: 'Bearer ' + keys.id }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
          // A small save can outlive the page that sent it (leaving, or locking the phone).
          keepalive: !!body && JSON.stringify(body).length < 60000,
        });
      } catch (e) { throw failure('offline', MESSAGES.offline); }
      const at = Date.parse((r.headers && r.headers.get && r.headers.get('date')) || '');
      if (Number.isFinite(at)) skew = Math.abs(at - Date.now()) > 120000 ? at - Date.now() : 0;
      const data = await r.json().catch(() => null);
      if (r.ok || r.status === 404 || r.status === 409) return { status: r.status, data: data || {} };
      const reason = (data && data.reason) || 'offline';
      throw failure(reason, MESSAGES[reason] || MESSAGES.offline);
    }
    const read = async (payload) => { try { return await open(keys.key, payload); } catch (e) { throw failure('unreadable', MESSAGES.unreadable); } };

    // Notes what changed here since the last look. Returns whether anything did.
    function note() {
      const after = snapshot(o.state());
      const changed = stamp(meta.doc, meta.shadow, after, now());
      meta.shadow = after;
      if (changed) meta.dirty = true;
      return changed;
    }
    // Folds the synced document into this device's, and shows the result in Gridline.
    function fold(remote, version) {
      note();
      const merged = merge(meta.doc, remote, now());
      if (!same(merged, meta.doc)) {
        applying = true;
        try { o.commit((s) => apply(merged, s, o.makeHunt)); } finally { applying = false; }
      }
      meta.doc = merged;
      meta.shadow = snapshot(o.state());
      meta.version = version;
      meta.dirty = !same(merged, remote);
    }
    function withCars() {
      const live = o.state().liveCars || {};
      const cars = {};
      for (const id of carIds(meta.doc).slice(0, MAX_CARS)) if (live[id]) cars[id] = live[id];
      return cars;
    }
    async function push(tries) {
      if (!keys) keys = await derive(meta.code);
      note();
      meta.doc.cars = withCars();
      let payload = await seal(keys.key, meta.doc);
      // A car's details are a convenience for the other device; the favorites themselves matter more.
      if (payload.length > MAX_PAYLOAD) { meta.doc.cars = {}; payload = await seal(keys.key, meta.doc); }
      if (payload.length > MAX_PAYLOAD) throw failure('too_large', MESSAGES.too_large);
      const sent = JSON.stringify(canonical(meta.doc));
      const r = await request('PUT', { payload, base: meta.version || null });
      if (r.status === 200) {
        meta.version = r.data.version;
        meta.syncedAt = now();
        // A change made while the save was on its way still needs sending.
        note();
        meta.dirty = JSON.stringify(canonical(meta.doc)) !== sent;
        return;
      }
      if (r.status !== 409 || !r.data.current || tries <= 0) throw failure('offline', MESSAGES.offline);
      fold(await read(r.data.current.payload), r.data.current.version);
      if (meta.dirty) await push(tries - 1);
      else meta.syncedAt = now();
    }
    async function pull() {
      if (!keys) keys = await derive(meta.code);
      const r = await request('GET');
      if (r.status === 404) {
        // This device has synced before, so the save was erased from another one.
        if (meta.version) { stop(); persist(); throw failure('erased', MESSAGES.erased); }
        return push(3);
      }
      if (r.data.version !== meta.version) fold(await read(r.data.payload), r.data.version);
      else note();
      if (meta.dirty) await push(3);
      else meta.syncedAt = now();
    }
    // Runs a job, keeps what it learned, and reports how it went.
    function run(job) {
      return serial(async () => {
        if (!meta) return;
        tell('syncing');
        try {
          await job();
          persist();
          tell('idle');
        } catch (e) {
          persist();
          // Anything unexpected reads as "couldn't reach sync" rather than as its own wording.
          const shown = e && e.reason ? e : failure('offline', MESSAGES.offline);
          tell(shown.reason === 'erased' ? 'idle' : 'error', shown);
          throw shown;
        }
      });
    }

    const api = {
      status,
      // Whether this site has sync at all (the hosted site does; the desktop app and a local copy don't).
      async available() {
        try {
          const r = await o.fetch(o.url.replace(/[^/]+$/, 'status'), { cache: 'no-store' });
          const d = r.ok ? await r.json() : null;
          return !!(d && d.sync && Array.isArray(d.apps) && d.apps.includes(o.url.split('/').pop()));
        } catch (e) { return false; }
      },
      // Starts sync on this device with a new code, or with `code` when the site already has one
      // (bollineni.co keeps one code for all its apps) and nothing is synced for Gridline under it yet.
      create(code) {
        if (meta) return Promise.resolve(status());
        meta = fresh(normalizeCode(code) || newCode(), true);
        const k = meta._kept; delete meta._kept;
        keys = null;
        return run(async () => { keys = await derive(meta.code); await push(0); }).then(status, (e) => { meta = null; keys = null; kept = k; persist(); tell('idle'); throw e; });
      },
      // Joins the devices already syncing under a code. Refused if nothing is saved under it.
      join(typed) {
        const code = normalizeCode(typed);
        if (!code) return Promise.reject(failure('code', MESSAGES.code));
        if (meta) return Promise.reject(failure('code', 'Turn sync off before entering a different code.'));
        meta = fresh(code, false);
        const k = meta._kept; delete meta._kept;
        keys = null;
        let joined = false;
        return run(async () => {
          keys = await derive(code);
          const r = await request('GET');
          if (r.status === 404) throw failure('empty', MESSAGES.empty);
          fold(await read(r.data.payload), r.data.version);
          // From here the device has joined: the synced saves are in Gridline. If sending this
          // device's own saves fails now, they stay marked as unsent and go with the next sync,
          // rather than the join being undone with the other devices' saves already merged in.
          joined = true;
          meta.syncedAt = now();
          if (meta.dirty) await push(3).catch(() => {});
        }).then(status, (e) => { if (joined) return status(); meta = null; keys = null; kept = k; persist(); tell('idle'); throw e; });
      },
      // Follows a code the site already uses: joins it, or starts Gridline's save under it.
      adopt(code) {
        return api.join(code).catch((e) => { if (e && e.reason === 'empty') return api.create(code); throw e; });
      },
      // Stops syncing here. What is saved on this device and on the others stays.
      leave() {
        return serial(async () => { clearTimeout(timer); stop(); persist(); tell('idle'); });
      },
      // Removes the synced copy from the server and stops syncing here. Other devices keep what
      // they have and stop syncing the next time they check.
      erase() {
        return serial(async () => {
          if (!meta) return;
          await request('DELETE');
          clearTimeout(timer);
          stop(); persist(); tell('idle');
        });
      },
      // Gridline calls this after every change to its saved state.
      changed() {
        if (!meta || applying) return;
        if (!note()) return;
        persist();
        clearTimeout(timer);
        pending = true;
        timer = setTimeout(() => { pending = false; run(() => push(3)).catch(() => {}); }, o.delay == null ? 1500 : o.delay);
      },
      // Leaving the page or locking the phone: send a change still waiting out its delay now.
      flush() {
        if (!pending || !meta) return Promise.resolve();
        clearTimeout(timer);
        pending = false;
        return run(() => push(3)).catch(() => {});
      },
      // Fetches what other devices changed and sends what this one did.
      sync() { return meta ? run(pull) : Promise.resolve(); },
    };
    return api;
  }

  const api = { newCode, normalizeCode, formatCode, derive, seal, open, snapshot, stamp, merge, apply, cleanCar, same, emptyDoc, createEngine, PREF_KEYS, MESSAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sync = api;
})(typeof window !== 'undefined' ? window : globalThis);
