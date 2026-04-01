// CJS wrapper to load ESM server entry point.
// Required for Electron's ELECTRON_RUN_AS_NODE mode (Node v20)
// which does not respect package.json "type": "module" in asar paths.
(async () => {
  await import('./index.js');
})();
