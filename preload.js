// Sandboxed preload: a narrow, one-way bridge from the main process to the renderer.
// - open-pane: a page inside a webview tried to open a popup / target=_blank.
// - shortcut : a shell shortcut fired (forwarded from main so it works even while a
//              webview has focus, since webview key events don't bubble to the host).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitAPI', {
  onOpenPane: (cb) => ipcRenderer.on('open-pane', (_e, url) => cb(url)),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key))
});
