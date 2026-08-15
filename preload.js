// Sandboxed preload: the narrow bridge between the renderer UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitAPI', {
  home: ipcRenderer.sendSync('app:home'),   // home dir for ~/path expansion (sync, sandbox-safe -- no os require)
  // main -> renderer events
  onOpenPane: (cb) => ipcRenderer.on('open-pane', (_e, url) => cb(url)),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key)),
  onDownload: (cb) => ipcRenderer.on('download-update', (_e, d) => cb(d)),
  onShields: (cb) => ipcRenderer.on('shields-update', (_e, d) => cb(d)),
  onHttpAuth: (cb) => ipcRenderer.on('http-auth', (_e, d) => cb(d)),
  onOpenTabIn: (cb) => ipcRenderer.on('open-tab-in', (_e, d) => cb(d)),

  // shields (ad/tracker blocking)
  shieldsGet: (wcId) => ipcRenderer.invoke('shields:get', wcId),
  shieldsToggleSite: (host) => ipcRenderer.invoke('shields:toggleSite', host),
  shieldsToggleAll: () => ipcRenderer.invoke('shields:toggleAll'),

  // HTTP auth dialog reply ({ id, username, password }; username null = cancel)
  httpAuthReply: (r) => ipcRenderer.send('http-auth-reply', r),

  // history
  historyAdd: (entry) => ipcRenderer.send('history:add', entry),
  historyQuery: (q) => ipcRenderer.invoke('history:query', q),

  // bookmarks
  bookmarksGet: () => ipcRenderer.invoke('bookmarks:get'),
  bookmarkHas: (url) => ipcRenderer.invoke('bookmarks:has', url),
  bookmarkToggle: (entry) => ipcRenderer.invoke('bookmarks:toggle', entry),
  bookmarkWorkspace: (ws) => ipcRenderer.invoke('bookmarks:add-workspace', ws),   // save the whole workspace
  bookmarkRemove: (key) => ipcRenderer.invoke('bookmarks:remove', key),           // by workspace id or url
  bookmarkFolders: () => ipcRenderer.invoke('bookmarks:folders'),
  bookmarkFolderAdd: (name) => ipcRenderer.invoke('bookmarks:folder-add', name),
  bookmarkFolderRename: (old, name) => ipcRenderer.invoke('bookmarks:folder-rename', { old, name }),
  bookmarkFolderRemove: (name) => ipcRenderer.invoke('bookmarks:folder-remove', name),
  bookmarkSetFolder: (key, folder) => ipcRenderer.invoke('bookmarks:set-folder', { key, folder }),

  // session (open pane URLs, restored on relaunch)
  sessionGet: () => ipcRenderer.invoke('session:get'),
  sessionSet: (urls) => ipcRenderer.send('session:set', urls),

  // settings + data
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  clearData: (kind) => ipcRenderer.invoke('data:clear', kind),
  openDownloads: () => ipcRenderer.send('open-downloads'),
  openDownload: (p) => ipcRenderer.send('download:open', p),      // open a finished download (main validates the path)
  revealDownload: (p) => ipcRenderer.send('download:reveal', p),  // show it in the OS file manager
  clearIncognito: () => ipcRenderer.send('incognito:clear'),      // wipe the ephemeral session

  // vault (main stores only the encrypted blob) + clipboard
  vaultGet: () => ipcRenderer.invoke('vault:get'),
  vaultSet: (blob) => ipcRenderer.send('vault:set', blob),
  clipboardWrite: (text) => { ipcRenderer.send('clipboard:write', text); ipcRenderer.send('clipboard:clear-soon', text); }
});
