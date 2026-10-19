// Local server for the website: serves the app and relays /visor/* requests to
// the Visor API (which only accepts browser requests from visor.vin).
// Usage: npm start  ->  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const UPSTREAM = process.env.VISOR_API_BASE || 'https://api.visor.vin';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const PUBLIC = ['index.html', 'css/', 'js/', 'assets/'];

async function relay(req, res, url) {
  const key = req.headers['x-visor-key'] || process.env.VISOR_API_KEY;
  const apiPath = url.pathname.slice('/visor'.length);
  if (!/^\/v1\/[A-Za-z0-9_\-/.%]+$/.test(apiPath) || req.method !== 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Only GET /v1/* requests are relayed.' } }));
  }
  try {
    const up = await fetch(UPSTREAM + apiPath + url.search, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    const body = Buffer.from(await up.arrayBuffer());
    const headers = { 'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
    for (const h of ['x-usage-cost-micros', 'x-ratelimit-remaining-60s', 'x-request-id']) if (up.headers.get(h)) headers[h] = up.headers.get(h);
    res.writeHead(up.status, headers);
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Could not reach the Visor API: ${e.message}` } }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/visor/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('gridline-visor-proxy');
  }
  if (url.pathname.startsWith('/visor/')) return relay(req, res, url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.some((p) => rel === p || rel.startsWith(p))) {
    res.writeHead(404);
    return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// Local only: never expose the relay (and your key) to the network.
server.listen(PORT, '127.0.0.1', () => console.log(`Gridline running at http://localhost:${PORT}`));
