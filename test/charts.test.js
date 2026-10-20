const test = require('node:test');
const assert = require('node:assert/strict');
const USMap = require('../js/usmap.js');
globalThis.USMap = USMap;
const Charts = require('../js/charts.js');

// Ray casting over an SVG path made of M…L…Z rings.
function inside(d, [x, y]) {
  let hit = false;
  for (const ring of d.split('Z')) {
    if (!ring) continue;
    const pts = ring.slice(1).split('L').map((p) => p.split(',').map(Number));
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

test('the US map has every state and projects cities into the right one', () => {
  assert.equal(Object.keys(USMap.paths).length, 51);
  const cities = { TX: [30.27, -97.74], FL: [25.77, -80.19], WA: [47.6, -122.33], ME: [43.66, -70.26], AK: [61.2, -149.9], HI: [21.3, -157.86], CA: [34.05, -118.24], MI: [42.33, -83.05], CO: [39.74, -104.99] };
  for (const [st, [lat, lng]] of Object.entries(cities)) {
    const p = USMap.project(lat, lng);
    assert.ok(inside(USMap.paths[st], p), `${st} at ${p}`);
    for (const other of Object.keys(cities)) if (other !== st) assert.ok(!inside(USMap.paths[other], p), `${st} point not in ${other}`);
  }
});

test('geoMap shades, labels and links states, and can zoom to one', () => {
  const svg = Charts.geoMap((st) => (st === 'TX' ? { cls: 'd-great', value: '-3%', title: 'Texas', href: '#/search?state=TX' } : null), { labels: true });
  assert.match(svg, /class="geo d-great" d="M[^"]+" data-state="TX" data-href="#\/search\?state=TX"/);
  assert.match(svg, /<text class="geo-label has-val"[^>]*>TX<\/text>/);
  assert.equal((svg.match(/<path/g) || []).length, 51);
  assert.equal((svg.match(/geo-empty/g) || []).length, 50);
  const zoom = Charts.geoMap(() => null, { focus: 'TX', dots: [{ city: 'Austin, TX', lat: 30.27, lng: -97.74, count: 3, title: 'Austin' }] });
  assert.match(zoom, /class="chart geomap focused" viewBox="(?!0\.0 0\.0 975)/);
  assert.match(zoom, /data-city="Austin, TX"/);
});

test('the dot map draws real outlines when the atlas is loaded', () => {
  const svg = Charts.usMap([{ city: 'Denver, CO', lat: 39.74, lng: -104.99, count: 5, title: 'Denver' }], { center: [39.74, -104.99], rings: [100, 500] });
  assert.match(svg, /class="chart usmap geo" viewBox="0 0 975 610"/);
  assert.equal((svg.match(/map-state/g) || []).length, 51);
  assert.equal((svg.match(/<ellipse/g) || []).length, 2);
});

test('the car strip draws four views, painted in the car\'s colors', () => {
  const html = Charts.carStrip({ body: 'SUV', extHex: '#1c2b45', extColor: 'Deep Crystal Blue', intColor: 'Beige', model: 'CX-5' });
  assert.equal((html.match(/<svg /g) || []).length, 4);
  assert.ok(html.includes('#1c2b45'), 'paint on the body');
  assert.ok(html.includes('#c9b99a'), 'beige interior');
  assert.ok(/aria-label="[^"]*side"/.test(html) && /aria-label="[^"]*front"/.test(html) && /aria-label="[^"]*interior"/.test(html) && /aria-label="[^"]*wheel"/.test(html));
  const sedan = Charts.carStrip({ body: 'Spaceship', extHex: '#fff', extColor: 'White', intColor: 'Rioja Red' });
  assert.equal((sedan.match(/<svg /g) || []).length, 4, 'unknown bodies draw as a sedan');
});
