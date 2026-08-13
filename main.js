// Splitser (splitser.org) — main process. Hosts the renderer UI with <webview> enabled
// (real Chromium views, no header-strip), owns the data layer (history/bookmarks/session/
// settings via store.js), and handles downloads + permission prompts on the shared session.
import { app, BrowserWindow, ipcMain, session as electronSession, dialog, shell, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName('Splitser');
let win;

// Shell shortcuts intercepted on every webContents (host + each webview) so they fire even
// while a page has focus (webview key events don't bubble to the host).
const SHORTCUTS = new Set(['t', 'w', 'l', 'r', 'f', 'm', 'd', 'k', '1', '2', '3', '=', '+', '-', '0']);
function wireShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = (input.key || '').toLowerCase();
    if (SHORTCUTS.has(k)) { event.preventDefault(); if (win) win.webContents.send('shortcut', k); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, backgroundColor: '#0e1418', title: 'Splitser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  // give every pane's <webview> a tiny preload that reports login submissions to the host so the
  // vault can offer to save them (set from main, so a page can't spoof or replace it)
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.preload = path.join(__dirname, 'webview-preload.cjs');
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  wireShortcuts(win.webContents);
}

// ---- data-layer IPC ----
ipcMain.on('history:add', (_e, { url, title }) => store.addHistory(url, title));
ipcMain.handle('history:query', (_e, q) => store.queryHistory(q));
ipcMain.handle('bookmarks:get', () => store.getBookmarks());
ipcMain.handle('bookmarks:has', (_e, url) => store.hasBookmark(url));
ipcMain.handle('bookmarks:toggle', (_e, { url, title }) => store.toggleBookmark(url, title));
ipcMain.handle('session:get', () => store.getSession());
ipcMain.on('session:set', (_e, urls) => store.setSession(urls));
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));
ipcMain.handle('data:clear', (_e, kind) => store.clearData(kind));
ipcMain.on('open-downloads', () => shell.openPath(app.getPath('downloads')));

// vault: main only reads/writes the encrypted blob (never the key or plaintext)
ipcMain.handle('vault:get', () => store.getVault());
ipcMain.on('vault:set', (_e, blob) => store.setVault(blob));
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));
// auto-clear a copied secret from the clipboard after a delay (best effort)
ipcMain.on('clipboard:clear-soon', (_e, text) => {
  setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(''); }, 25000);
});

app.whenReady().then(() => {
  const ses = electronSession.fromPartition('persist:split');

  // downloads: save to the Downloads folder, stream progress to the renderer
  let dlId = 0;
  ses.on('will-download', (_e, item) => {
    const id = ++dlId;
    const name = item.getFilename();
    item.setSavePath(path.join(app.getPath('downloads'), name));
    const emit = (state) => win && win.webContents.send('download-update', {
      id, name, received: item.getReceivedBytes(), total: item.getTotalBytes(), state
    });
    item.on('updated', (_ev, s) => emit(s));
    item.once('done', (_ev, s) => emit(s));
    emit('progressing');
  });

  // permission prompts for sensitive capabilities; benign ones auto-allow
  const SENSITIVE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock']);
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (!SENSITIVE.has(permission)) return callback(true);
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0,
      title: 'Splitser', message: 'Allow ' + permission + '?',
      detail: (details && details.requestingUrl) || (wc && wc.getURL()) || ''
    });
    callback(response === 1);
  });

  // a page opening a popup / target=_blank -> a new PANE; shortcuts on every webview
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      if (win && /^(https?:|about:)/.test(url)) win.webContents.send('open-pane', url);
      return { action: 'deny' };
    });
    wireShortcuts(contents);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
