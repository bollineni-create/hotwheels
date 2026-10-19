// Tags the page so CSS can adapt to the desktop window (e.g. macOS traffic lights).
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`);
});
