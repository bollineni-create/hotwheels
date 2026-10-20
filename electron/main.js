// Desktop shell: loads the same static site in a native window.
const { app, BrowserWindow, Menu, shell, nativeTheme, ipcMain, net, Notification } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLED_PAGE = path.join(ROOT, 'index.html');

// Where the pages come from. A packaged app (DMG, installer) shows the public site, which GitHub
// Pages rebuilds from the main branch within minutes of every merge, so every copy stays current
// without a new build; the files bundled inside the app are the fallback when there is no internet.
// `npm run app` shows the local files. GRIDLINE_LIVE_URL overrides the site (empty disables it).
const LIVE_URL = process.env.GRIDLINE_LIVE_URL !== undefined
  ? process.env.GRIDLINE_LIVE_URL
  : (app.isPackaged ? 'https://bollineni-create.github.io/hotwheels/' : '');
const CHECK_EVERY_MS = 15 * 60 * 1000;

// Optional API keys baked into your own build (electron/keys.local.json, not in git).
function bundledKeys() {
  try {
    const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys.local.json'), 'utf8'));
    return Object.fromEntries(Object.entries(keys).filter(([k, v]) => ['autodev', 'visor'].includes(k) && typeof v === 'string' && v.trim()));
  } catch (e) {
    return {};
  }
}
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const isMac = process.platform === 'darwin';

let win = null;

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch (e) {
    return { width: 1360, height: 900 };
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify(state)); } catch (e) { /* non-fatal */ }
}

function go(hash) {
  if (!win) return;
  win.show();
  win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
}

function focusSearch() {
  if (!win) return;
  win.webContents.executeJavaScript(`(() => {
    const el = ['#hero-search input', '#q-input', '#header-search input']
      .map((s) => document.querySelector(s))
      .find((e) => e && e.offsetParent !== null && !e.closest('[hidden]'));
    if (el) { el.focus(); el.select(); } else { location.hash = '#/search'; }
  })()`);
}

function createWindow() {
  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 560,
    title: 'Gridline',
    show: false,
    icon: path.join(ROOT, 'assets/icons/icon-512.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f16' : '#f6f7f9',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--gridline-keys=${Buffer.from(JSON.stringify(bundledKeys())).toString('base64')}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });

  // Keep the app on its own pages; anything else opens in the default browser.
  const isInternal = (url) => url.startsWith('file://') || (LIVE_URL && url.startsWith(LIVE_URL));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    }
  });

  // No internet (or the site is down): show the copy built into the app instead.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted by a newer navigation */) return;
    if (LIVE_URL && url.startsWith(LIVE_URL)) win.loadFile(BUNDLED_PAGE);
  });
  win.webContents.on('did-navigate', (e, url, httpStatus) => {
    if (LIVE_URL && url.startsWith(LIVE_URL) && httpStatus >= 400) win.loadFile(BUNDLED_PAGE);
  });
  win.on('focus', () => checkForNewPages());
  win.webContents.on('did-finish-load', () => checkForNewPages(true));

  if (LIVE_URL) win.loadURL(LIVE_URL); else win.loadFile(BUNDLED_PAGE);
}

// Reloads the window when the site has changed since it was last shown. Runs when the window
// gets focus (at most once a minute) and every 15 minutes while the app is open.
let pagesTag = null;
let lastCheck = 0;
async function checkForNewPages(force) {
  if (!LIVE_URL || !win || win.isDestroyed() || !win.webContents.getURL().startsWith(LIVE_URL)) return;
  if (!force && Date.now() - lastCheck < 60 * 1000) return;
  lastCheck = Date.now();
  try {
    const res = await net.fetch(LIVE_URL, { method: 'HEAD', cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
    const tag = res.ok ? (res.headers.get('etag') || res.headers.get('last-modified')) : null;
    if (!tag) return;
    if (pagesTag && tag !== pagesTag) win.webContents.reloadIgnoringCache();
    pagesTag = tag;
  } catch (e) { /* offline: keep showing what we have */ }
}

// Listing-data API requests from the page. Visor and auto.dev only accept
// browser requests from their own sites, so the app makes them from here.
const API_BASES = {
  visor: process.env.VISOR_API_BASE || 'https://api.visor.vin',
  autodev: process.env.AUTODEV_API_BASE || 'https://api.auto.dev',
};
const API_PATHS = {
  visor: /^\/v1\/[A-Za-z0-9_\-/.%]+$/,
  autodev: /^\/(listings|photos)(\/[A-Za-z0-9]{1,17})?$/,
};
ipcMain.handle('api:fetch', async (event, req) => {
  const { provider, path: apiPath, query, key } = req || {};
  if (!API_BASES[provider] || typeof apiPath !== 'string' || !API_PATHS[provider].test(apiPath)) {
    return { status: 400, body: '{"error":{"message":"Request not allowed"}}', cost: 0 };
  }
  try {
    const res = await net.fetch(`${API_BASES[provider]}${apiPath}${query ? '?' + query : ''}`, { headers: { Authorization: `Bearer ${key || ''}` } });
    return { status: res.status, body: await res.text(), cost: Number(res.headers.get('x-usage-cost-micros')) || 0 };
  } catch (e) {
    return { status: 502, body: JSON.stringify({ error: { message: `Could not reach the listings API: ${e.message}` } }), cost: 0 };
  }
});

// Hunt notifications from the page. Clicking one brings the window back on that hunt.
ipcMain.on('notify', (event, n) => {
  const { title, body, href } = n || {};
  if (typeof title !== 'string' || !Notification.isSupported()) return;
  const note = new Notification({ title: title.slice(0, 200), body: String(body || '').slice(0, 400) });
  note.on('click', () => {
    if (!win) createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
    if (typeof href === 'string' && /^#\/[\w\/?=&.%-]*$/.test(href)) go(href);
  });
  note.show();
});

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Search', accelerator: 'CmdOrCtrl+N', click: () => go('#/search') },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: focusSearch },
        { label: 'Find…', accelerator: 'CmdOrCtrl+K', click: focusSearch, visible: false },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+1', click: () => go('#/') },
        { label: 'Search', accelerator: 'CmdOrCtrl+2', click: () => go('#/search') },
        { label: 'Insights', accelerator: 'CmdOrCtrl+3', click: () => go('#/insights') },
        { label: 'Saved & Hunts', accelerator: 'CmdOrCtrl+4', click: () => go('#/saved') },
        { label: 'Compare', accelerator: 'CmdOrCtrl+5', click: () => go('#/compare') },
        { type: 'separator' },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => win && win.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => win && win.webContents.navigationHistory.goForward() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('Gridline');
  if (process.platform === 'win32') app.setAppUserModelId('app.gridline.desktop');
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    if (LIVE_URL) setInterval(() => checkForNewPages(true), CHECK_EVERY_MS);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
