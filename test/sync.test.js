const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../js/sync.js');

// The site's sync route, kept in memory with the same rules: a save names the version it was made
// from (null for "nothing there yet") and is refused with the current save when that is out of date.
function server() {
  const files = new Map();
  let n = 0, down = false;
  const answer = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  return {
    files,
    puts: 0,
    set down(v) { down = v; },
    fetch: async function (url, init = {}) {
      if (down) throw new Error('network');
      if (url.endsWith('/status')) return answer(200, { sync: true, apps: ['gridline'] });
      const id = /^Bearer ([0-9a-f]{64})$/.exec((init.headers || {}).Authorization || '');
      if (!id) return answer(401, { reason: 'code' });
      const f = files.get(id[1]);
      if (!init.method || init.method === 'GET') return f ? answer(200, { payload: f.payload, version: f.version }) : answer(404, { reason: 'empty' });
      if (init.method === 'DELETE') { files.delete(id[1]); return answer(200, { erased: true }); }
      const body = JSON.parse(init.body);
      if (body.base ? !f || f.version !== body.base : !!f) return answer(409, { reason: 'conflict', current: { payload: f.payload, version: f.version } });
      this.puts++;
      const version = `"v${++n}"`;
      files.set(id[1], { payload: body.payload, version });
      return answer(200, { version });
    },
  };
}

const makeHunt = () => ({ watch: true, seen: null, source: null, checkedAt: null, lookedAt: 0, news: { added: [], cut: [], gone: [] }, error: null });
const blank = () => ({ saved: [], favs: {}, compare: [], recent: [], theme: null, liveCars: {}, prefs: { homeCity: null, homeZip: null, homeRadius: 100, showDealer: false, compact: false, valueSort: 'count', dataSource: 'demo', huntEvery: 360 } });

// A device: Gridline's saved state, its own storage, and a clock the test moves.
function device(srv, clock) {
  const d = { s: blank(), kept: null, applied: 0 };
  d.engine = Sync.createEngine({
    fetch: (u, i) => srv.fetch(u, i),
    storage: { get: () => d.kept, set: (v) => { d.kept = v; }, remove: () => { d.kept = null; } },
    url: '/sync/api/gridline',
    state: () => d.s,
    commit: (fn) => { fn(d.s); d.applied++; d.engine.changed(); },
    makeHunt,
    now: () => clock.t,
    delay: 0,
  });
  // What Gridline does on every change: update the state, then tell sync.
  d.update = (fn) => { fn(d.s); d.engine.changed(); };
  d.settle = () => new Promise((r) => setTimeout(r, 30)).then(() => d.engine.sync());
  return d;
}
const hunt = (id, name, createdAt) => ({ id, name, params: 'model=' + name, count: 3, createdAt, hunt: makeHunt() });

test('a code survives being typed with dashes, spaces, lower case and look-alike letters', () => {
  const code = Sync.newCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{25}$/);
  assert.equal(Sync.formatCode(code).length, 29);
  assert.equal(Sync.normalizeCode(' ' + Sync.formatCode(code).toLowerCase().replace(/-/g, ' - ') + ' '), code);
  assert.equal(Sync.normalizeCode('O'.repeat(25)), '0'.repeat(25));
  assert.equal(Sync.normalizeCode('iIlL1'.repeat(5)), '1'.repeat(25));
  for (const bad of ['', 'ABC', code + 'A', code.slice(1), 'U'.repeat(25), null]) assert.equal(Sync.normalizeCode(bad), null);
  assert.notEqual(Sync.newCode(), Sync.newCode());
});

test('the id and the key come from the code, and what is sealed opens only with that code', async () => {
  const a = await Sync.derive('A'.repeat(25));
  const again = await Sync.derive('A'.repeat(25));
  const b = await Sync.derive('B'.repeat(25));
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.equal(a.id, again.id);
  assert.notEqual(a.id, b.id);
  const sealed = await Sync.seal(a.key, { favs: ['x'], note: 'héllo' });
  assert.ok(!sealed.includes('favs'));
  assert.notEqual(sealed, await Sync.seal(a.key, { favs: ['x'], note: 'héllo' }));
  assert.deepEqual(await Sync.open(again.key, sealed), { favs: ['x'], note: 'héllo' });
  await assert.rejects(Sync.open(b.key, sealed));
});

test('the later change to an item wins, a tie goes to the synced copy, and a deletion is remembered for 90 days', () => {
  const day = 86400000, now = 200 * day, t = (n) => now - day + n;
  const local = Object.assign(Sync.emptyDoc(), { favs: { a: { p: 1, t: t(5) }, b: { p: 2, t: t(9) }, c: { x: 1, t: now - 91 * day }, d: { p: 4, t: 3 } }, compare: { ids: ['a'], t: 4 }, prefs: { compact: { v: true, t: 7 } } });
  const remote = Object.assign(Sync.emptyDoc(), { favs: { a: { x: 1, t: t(6) }, b: { p: 3, t: t(9) }, d: { x: 1, t: now - 10 * day } }, compare: { ids: ['b'], t: 4 }, prefs: { compact: { v: false, t: 6 }, theme: { v: 'dark', t: 1 } }, cars: { b: { id: 'b' }, z: { id: 'z' } } });
  const m = Sync.merge(local, remote, now);
  assert.deepEqual(m.favs, { a: { x: 1, t: t(6) }, b: { p: 3, t: t(9) }, d: { x: 1, t: now - 10 * day } });
  assert.deepEqual(m.compare, { ids: ['b'], t: 4 });
  assert.deepEqual(m.prefs, { compact: { v: true, t: 7 }, theme: { v: 'dark', t: 1 } });
  assert.deepEqual(m.cars, { b: { id: 'b' } });
  assert.ok(Sync.same(Sync.merge(remote, local, now).favs.a, m.favs.a));
});

test('a second device that enters the code gets the first one’s saves and keeps its own', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  a.s.favs = { car1: 21000 };
  a.s.saved = [hunt('h1', 'Miata', 50)];
  a.s.compare = ['car1'];
  a.s.prefs.homeZip = '94022';
  a.s.prefs.compact = true;
  a.s.theme = 'dark';
  a.s.liveCars = { car1: { id: 'car1', make: 'Mazda' }, other: { id: 'other' } };
  const on = await a.engine.create();
  assert.ok(on.on);
  assert.match(on.code, /^(\w{5}-){4}\w{5}$/);
  assert.equal(srv.files.size, 1);
  assert.ok(![...srv.files.values()][0].payload.includes('Miata'), 'the server holds only sealed text');

  b.s.favs = { car2: 9000 };
  b.s.saved = [hunt('h2', 'Bronco', 80)];
  b.s.prefs.homeZip = '10001';
  await b.engine.join(on.code.toLowerCase());
  assert.deepEqual(b.s.favs, { car1: 21000, car2: 9000 });
  assert.deepEqual(b.s.saved.map((h) => h.name), ['Bronco', 'Miata']);
  assert.equal(b.s.saved[1].hunt.seen, null);
  assert.equal(b.s.saved[1].count, 3);
  assert.deepEqual(b.s.compare, ['car1']);
  assert.equal(b.s.prefs.homeZip, '94022', 'settings already synced win over a joining device’s');
  assert.equal(b.s.prefs.compact, true);
  assert.equal(b.s.theme, 'dark');
  assert.equal(b.s.prefs.dataSource, 'demo');
  assert.deepEqual(b.s.liveCars, { car1: { id: 'car1', make: 'Mazda' } }, 'a favorite’s details come along, other cars do not');

  await a.engine.sync();
  assert.deepEqual(a.s.favs, { car1: 21000, car2: 9000 });
  assert.deepEqual(a.s.saved.map((h) => h.name), ['Bronco', 'Miata']);
});

test('changes and deletions on either device reach the other, without one overwriting the other', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  a.s.favs = { car1: 1, car2: 2 };
  a.s.saved = [hunt('h1', 'Miata', 50)];
  const { code } = await a.engine.create();
  await b.engine.join(code);

  // Both change something before either syncs again.
  clock.t = 2000;
  a.update((s) => { delete s.favs.car1; s.favs.car3 = 3; s.saved[0].hunt.watch = false; });
  clock.t = 3000;
  b.update((s) => { s.favs.car4 = 4; s.prefs.compact = true; s.saved = []; });
  await a.settle();
  await b.settle();
  await a.settle();
  assert.deepEqual(a.s.favs, { car2: 2, car3: 3, car4: 4 });
  assert.deepEqual(b.s.favs, a.s.favs);
  assert.deepEqual(a.s.saved, [], 'the later deletion beats the earlier pause');
  assert.equal(a.s.prefs.compact, true);

  // A favorite removed on one device does not come back from the other.
  clock.t = 4000;
  b.update((s) => { delete s.favs.car2; });
  await b.settle();
  await a.settle();
  assert.deepEqual(a.s.favs, { car3: 3, car4: 4 });
  const puts = srv.puts;
  await a.settle();
  await b.settle();
  assert.equal(srv.puts, puts, 'with nothing new, nothing is sent');
});

test('a hunt paused on one device is paused on the other and keeps what it found there', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  a.s.saved = [hunt('h1', 'Miata', 50)];
  const { code } = await a.engine.create();
  await b.engine.join(code);
  b.s.saved[0].hunt.seen = { x: 1 };
  clock.t = 2000;
  a.update((s) => { s.saved[0].hunt.watch = false; s.saved[0].name = 'Miata RF'; });
  await a.settle();
  await b.settle();
  assert.equal(b.s.saved[0].hunt.watch, false);
  assert.equal(b.s.saved[0].name, 'Miata RF');
  assert.deepEqual(b.s.saved[0].hunt.seen, { x: 1 });
});

test('a wrong code, or one nothing is saved under, is refused and leaves the device as it was', async () => {
  const srv = server(), clock = { t: 1000 };
  const b = device(srv, clock);
  b.s.favs = { mine: 1 };
  await assert.rejects(b.engine.join('nope'), { reason: 'code' });
  await assert.rejects(b.engine.join(Sync.newCode()), { reason: 'empty' });
  assert.equal(b.engine.status().on, false);
  assert.equal(b.kept, null);
  assert.equal(srv.files.size, 0);
  assert.deepEqual(b.s.favs, { mine: 1 });
});

test('changes made offline are kept and sent when sync is reachable again, also after a restart', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  const { code } = await a.engine.create();
  await b.engine.join(code);
  srv.down = true;
  clock.t = 2000;
  a.update((s) => { s.favs.late = 5; });
  await assert.rejects(a.settle(), { reason: 'offline' });
  assert.equal(a.engine.status().phase, 'error');
  // The app is closed and opened again: a new engine over the same storage.
  const reopened = device(srv, clock);
  reopened.s = a.s;
  reopened.kept = a.kept;
  reopened.engine = Sync.createEngine({ fetch: (u, i) => srv.fetch(u, i), storage: { get: () => reopened.kept, set: (v) => { reopened.kept = v; }, remove: () => { reopened.kept = null; } }, url: '/sync/api/gridline', state: () => reopened.s, commit: (fn) => fn(reopened.s), makeHunt, now: () => clock.t, delay: 0 });
  assert.equal(reopened.engine.status().on, true);
  srv.down = false;
  // A change right after opening is sent on its own, before any other sync has run.
  clock.t = 3000;
  reopened.s.favs.first = 6;
  reopened.engine.changed();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(reopened.engine.status().phase, 'idle');
  await reopened.engine.sync();
  await b.engine.sync();
  assert.deepEqual(b.s.favs, { late: 5, first: 6 });
});

test('turning sync off keeps everything here; erasing removes the synced copy and stops the other device', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  a.s.favs = { car1: 1 };
  const { code } = await a.engine.create();
  await b.engine.join(code);
  await b.engine.leave();
  assert.equal(b.engine.status().on, false);
  assert.deepEqual(b.s.favs, { car1: 1 });
  assert.equal(srv.files.size, 1);
  await b.engine.join(code);
  await b.engine.erase();
  assert.equal(srv.files.size, 0);
  await assert.rejects(a.engine.sync(), { reason: 'erased' });
  assert.equal(a.engine.status().on, false);
  assert.equal(a.kept, null);
  assert.deepEqual(a.s.favs, { car1: 1 });
  assert.equal(srv.files.size, 0, 'a device that learns of the erasure does not put the copy back');
});

test('only saves in the shape Gridline keeps are applied', () => {
  const s = blank();
  s.saved = [hunt('keep', 'Old name', 10)];
  const doc = Object.assign(Sync.emptyDoc(), {
    favs: { ok: { p: 5, t: 1 }, bad: { p: 'x', t: 1 }, gone: { x: 1, t: 1 } },
    hunts: { keep: { h: { name: 'New name', params: 'a=1', createdAt: 10, watch: false }, t: 2 }, noname: { h: { name: '', params: 'a=1' }, t: 2 }, junk: { h: null, t: 2 } },
    compare: { ids: ['a', 5, 'b', 'c', 'd', 'e'], t: 1 },
    prefs: { homeZip: { v: 'not a zip', t: 1 }, homeRadius: { v: 250, t: 1 }, theme: { v: 'purple', t: 1 }, compact: { v: 'yes', t: 1 } },
    cars: { a: { id: 'other' }, b: { id: 'b' } },
  });
  Sync.apply(doc, s, makeHunt);
  assert.deepEqual(s.favs, { ok: 5 });
  assert.deepEqual(s.saved.map((h) => [h.id, h.name, h.hunt.watch]), [['keep', 'New name', false]]);
  assert.deepEqual(s.compare, ['a', 'b', 'c', 'd']);
  assert.equal(s.prefs.homeZip, null);
  assert.equal(s.prefs.homeRadius, 250);
  assert.equal(s.theme, null);
  assert.equal(s.prefs.compact, false);
  assert.deepEqual(s.liveCars, { b: { id: 'b' } });
});

test('nothing that arrives through sync can act as markup in Gridline’s pages', () => {
  const s = blank();
  const car = (over) => Object.assign({ id: 'c1', live: true, make: 'Mazda', condition: 'Used', vin: 'JM1NDAD75K0300000', price: 21000, options: ['19" wheels'], dealer: { name: 'Bob\'s Auto & Truck' }, photos: ['https://img.example/a.jpg'] }, over);
  assert.deepEqual(Sync.cleanCar(car({}), 'c1').options, ['19″ wheels']);
  assert.equal(Sync.cleanCar(car({}), 'c1').dealer.name, 'Bob\'s Auto & Truck');
  assert.equal(Sync.cleanCar(car({ trim: '<img src=x onerror=alert(1)>' }), 'c1').trim, '‹img src=x onerror=alert(1)›');
  for (const bad of [
    car({ condition: 'x" onmouseover="alert(1)' }),
    car({ condition: 'Used"><script>' }),
    car({ vin: '"><svg onload=alert(1)>' }),
    car({ photos: ['javascript:alert(1)'] }),
    car({ url: ' JaVaScript :alert(1)' }),
    car({ __proto__: null, constructor: 1 }),
    car({ price: Infinity }),
    car({ deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }),
    car({ big: 'x'.repeat(2001) }),
    car({ id: 'other' }),
    ['c1'],
    null,
  ]) assert.equal(Sync.cleanCar(bad, 'c1'), null);
  assert.equal(Sync.cleanCar(Object.assign(car({}), { id: 'a"b' }), 'a"b'), null);
  assert.deepEqual(Object.keys(Sync.cleanCar(car({ 'Cold "Weather" Pkg': true }), 'c1')).pop(), 'Cold ″Weather″ Pkg');

  const doc = Object.assign(Sync.emptyDoc(), {
    favs: { c1: { p: 1, t: 1 }, 'x"><script>alert(1)</script>': { p: 1, t: 1 }, c2: { p: 2, t: 1 } },
    hunts: {
      ok: { h: { name: 'Miata <b>RF</b>', params: 'q=miata', createdAt: 1, watch: true }, t: 1 },
      'h"1': { h: { name: 'x', params: 'q=1', createdAt: 1 }, t: 1 },
      inj: { h: { name: 'x', params: 'q=1"><script>', createdAt: 1 }, t: 1 },
    },
    compare: { ids: ['c1', 'a"b', 'c2'], t: 1 },
    prefs: { valueSort: { v: 'count"><x', t: 1 } },
    cars: { c1: car({ trim: 'Club "Brembo"' }), c2: Object.assign(car({ condition: 'Used" x="' }), { id: 'c2' }) },
  });
  Sync.apply(doc, s, makeHunt);
  assert.deepEqual(Object.keys(s.favs), ['c1', 'c2']);
  assert.deepEqual(s.saved.map((h) => [h.id, h.name]), [['ok', 'Miata ‹b›RF‹/b›']]);
  assert.deepEqual(s.compare, ['c1', 'c2']);
  assert.equal(s.prefs.valueSort, 'count');
  assert.deepEqual(Object.keys(s.liveCars), ['c1'], 'a car that can’t be made safe is left out');
  assert.equal(s.liveCars.c1.trim, 'Club ″Brembo″');
});

test('a real live listing passes through sync unchanged', () => {
  const Live = require('../js/live.js');
  const l = Live.normalize({
    id: 'abc', vin: '5TFAB5DB1MX123456', year: 2021, make: 'Toyota', model: 'Tundra', trim: 'SR5', body_type: 'Pickup Truck', drivetrain: '4WD',
    fuel_type: 'Gas only', base_exterior_color: 'Red', exterior_color: 'Barcelona Red', msrp: 45000, discount_from_msrp: -0.1, price: 40500, miles: 30000,
    days_on_market: 20, status: 'active', availability_status: 'transit', inventory_type: 'certified', dealer_name: 'Denver Toyota', dealer_type: 'franchise',
    city: 'Denver', state: 'CO', latitude: 39.7, longitude: -105, photo_urls: ['https://x/1.jpg'], features: ['heated_seats'], upfitters: ['rocky_ridge'],
    price_history: [{ changed_at: '2026-11-01 00:00:00.000', price_before: 41500, price_after: 40500 }],
  });
  // What Gridline remembers of a live car, as it comes back out of the synced document.
  const remembered = JSON.parse(JSON.stringify(Object.assign({}, l, { photos: (l.photos || []).slice(0, 1), history: l.history.slice(-6), livePricing: null })));
  assert.deepEqual(Sync.cleanCar(remembered, 'abc'), remembered);
});

test('a join that reads the synced saves but can’t send this device’s own still joins, and sends them later', async () => {
  const srv = server(), clock = { t: 1000 };
  const a = device(srv, clock), b = device(srv, clock);
  a.s.favs = { car1: 1 };
  const { code } = await a.engine.create();
  b.s.favs = { mine: 2 };
  // The read works, then the connection drops before this device's own favorite is sent.
  const fetch = srv.fetch.bind(srv);
  srv.fetch = async (url, init = {}) => { if (init.method === 'PUT') throw new Error('network'); return fetch(url, init); };
  const st = await b.engine.join(code);
  assert.equal(st.on, true);
  assert.deepEqual(b.s.favs, { car1: 1, mine: 2 });
  assert.ok(b.kept, 'the code is kept');
  srv.fetch = fetch;
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.s.favs, { car1: 1, mine: 2 });
});

test('a hunt whose search changed on another device takes the new search and starts over', async () => {
  const s = blank();
  s.saved = [Object.assign(hunt('h1', 'Miata', 50), { count: 9 })];
  s.saved[0].hunt.seen = { old: 1 };
  const doc = Object.assign(Sync.emptyDoc(), { hunts: { h1: { h: { name: 'Miata', params: 'model=Miata&maxPrice=20000', createdAt: 60, watch: true, count: 4 }, t: 5 } } });
  Sync.apply(doc, s, makeHunt);
  assert.equal(s.saved[0].params, 'model=Miata&maxPrice=20000');
  assert.equal(s.saved[0].createdAt, 60);
  assert.equal(s.saved[0].count, 4);
  assert.equal(s.saved[0].hunt.seen, null);
  assert.equal(s.saved[0].hunt.watch, true);
});
