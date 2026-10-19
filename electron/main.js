// Desktop shell: loads the same static site in a native window.
const { app, BrowserWindow, Menu, shell, nativeTheme, ipcMain, net } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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
  const isInternal = (url) => url.startsWith('file://');
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

  win.loadFile(path.join(ROOT, 'index.html'));
}

// Visor API requests from the page. Only GET /v1/* on api.visor.vin is allowed.
const VISOR_BASE = process.env.VISOR_API_BASE || 'https://api.visor.vin';
ipcMain.handle('visor:fetch', async (event, req) => {
  const { path: apiPath, query, key } = req || {};
  if (typeof apiPath !== 'string' || !/^\/v1\/[A-Za-z0-9_\-/.%]+$/.test(apiPath)) return { status: 400, body: '{"error":{"message":"Bad path"}}', cost: 0 };
  try {
    const res = await net.fetch(`${VISOR_BASE}${apiPath}${query ? '?' + query : ''}`, { headers: { Authorization: `Bearer ${key || ''}` } });
    return { status: res.status, body: await res.text(), cost: Number(res.headers.get('x-usage-cost-micros')) || 0 };
  } catch (e) {
    return { status: 502, body: JSON.stringify({ error: { message: `Could not reach the Visor API: ${e.message}` } }), cost: 0 };
  }
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
        { label: 'Saved', accelerator: 'CmdOrCtrl+4', click: () => go('#/saved') },
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
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
