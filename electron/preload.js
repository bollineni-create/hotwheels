// Tags the page for desktop styling and exposes a narrow bridge for listing-data
// API requests, which run in the main process (the APIs block browser requests).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gridlineDesktop', {
  apiFetch: (req) => ipcRenderer.invoke('api:fetch', req),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`);
});
