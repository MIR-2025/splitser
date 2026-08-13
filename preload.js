// Sandboxed preload: the narrow bridge between the renderer UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitAPI', {
  // main -> renderer events
  onOpenPane: (cb) => ipcRenderer.on('open-pane', (_e, url) => cb(url)),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key)),
  onDownload: (cb) => ipcRenderer.on('download-update', (_e, d) => cb(d)),

  // history
  historyAdd: (entry) => ipcRenderer.send('history:add', entry),
  historyQuery: (q) => ipcRenderer.invoke('history:query', q),

  // bookmarks
  bookmarksGet: () => ipcRenderer.invoke('bookmarks:get'),
  bookmarkHas: (url) => ipcRenderer.invoke('bookmarks:has', url),
  bookmarkToggle: (entry) => ipcRenderer.invoke('bookmarks:toggle', entry),

  // session (open pane URLs, restored on relaunch)
  sessionGet: () => ipcRenderer.invoke('session:get'),
  sessionSet: (urls) => ipcRenderer.send('session:set', urls),

  // settings + data
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  clearData: (kind) => ipcRenderer.invoke('data:clear', kind),
  openDownloads: () => ipcRenderer.send('open-downloads')
});
