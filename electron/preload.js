// Tags the page for desktop styling and exposes a narrow bridge for Visor API
// requests, which run in the main process (Visor blocks browser requests).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gridlineDesktop', {
  visorFetch: (req) => ipcRenderer.invoke('visor:fetch', req),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`);
});
