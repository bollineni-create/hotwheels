// Tags the page for desktop styling and exposes a narrow bridge for listing-data
// API requests, which run in the main process (the APIs block browser requests).
const { contextBridge, ipcRenderer } = require('electron');

// Keys built into this copy of the app (see electron/keys.local.json).
let defaultKeys = {};
try {
  const arg = process.argv.find((a) => a.startsWith('--gridline-keys='));
  if (arg) defaultKeys = JSON.parse(atob(arg.slice('--gridline-keys='.length)));
} catch (e) { /* none */ }

contextBridge.exposeInMainWorld('gridlineDesktop', {
  apiFetch: (req) => ipcRenderer.invoke('api:fetch', req),
  defaultKeys,
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`);
});
