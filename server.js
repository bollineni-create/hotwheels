// Local server for the website: serves the app and relays /api/<provider>/*
// requests to Visor or auto.dev, which only accept browser requests from their
// own sites.
// Usage: npm start  ->  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const UPSTREAMS = {
  visor: process.env.VISOR_API_BASE || 'https://api.visor.vin',
  autodev: process.env.AUTODEV_API_BASE || 'https://api.auto.dev',
};
const PATHS = { visor: /^\/v1\/[A-Za-z0-9_\-/.%]+$/, autodev: /^\/(listings|photos)(\/[A-Za-z0-9]{1,17})?$/ };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const PUBLIC = ['index.html', 'css/', 'js/', 'assets/'];

async function relay(req, res, url) {
  const [, , provider, ...rest] = url.pathname.split('/');
  const apiPath = '/' + rest.join('/');
  const key = req.headers['x-api-key'];
  if (!UPSTREAMS[provider] || !PATHS[provider].test(apiPath) || req.method !== 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Request not allowed.' } }));
  }
  try {
    const up = await fetch(UPSTREAMS[provider] + apiPath + url.search, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    const body = Buffer.from(await up.arrayBuffer());
    const headers = { 'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
    for (const h of ['x-usage-cost-micros', 'x-ratelimit-remaining-60s', 'x-request-id']) if (up.headers.get(h)) headers[h] = up.headers.get(h);
    res.writeHead(up.status, headers);
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Could not reach the listings API: ${e.message}` } }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('gridline-api-proxy');
  }
  if (url.pathname.startsWith('/api/')) return relay(req, res, url);
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
