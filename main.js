// Splitser (splitser.org) — main process. Hosts the renderer UI with <webview> enabled
// (real Chromium views, no header-strip), owns the data layer (history/bookmarks/session/
// settings via store.js), and handles downloads + permission prompts on the shared session.
import { app, BrowserWindow, ipcMain, session as electronSession, dialog, shell, clipboard, webContents, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ElectronBlocker, fromElectronDetails } from '@ghostery/adblocker-electron';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName('Splitser');
let win;

// ---- shields: ad/tracker blocking, on by default, with a per-site allowlist ----
let blocker = null;                              // Ghostery engine (EasyList-class), loaded async
const _sh = store.getShields();
const allow = new Set(_sh.allow || []);          // hosts with shields DOWN
let shieldsOn = _sh.on !== false;                // global default
const blocked = new Map();                       // webContentsId -> count on the current page
const pushT = new Map();
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function wcHost(id) { const wc = id ? webContents.fromId(id) : null; return wc && !wc.isDestroyed() ? hostOf(wc.getURL()) : ''; }
function persistShields() { store.setShields({ on: shieldsOn, allow: [...allow] }); }
function pushShields(id) {                        // throttle live count updates to the renderer
  if (pushT.has(id)) return;
  pushT.set(id, setTimeout(() => {
    pushT.delete(id);
    const host = wcHost(id);
    win && win.webContents.send('shields-update', { wcId: id, count: blocked.get(id) || 0, host, siteOn: host ? !allow.has(host) : true, globalOn: shieldsOn });
  }, 300));
}
function onBeforeRequest(details, cb) {
  if (!shieldsOn || !blocker) return cb({});
  const id = details.webContentsId, host = wcHost(id);
  if (host && allow.has(host)) return cb({});     // this site's shields are down
  const { match, redirect } = blocker.match(fromElectronDetails(details));
  if (redirect) return cb({ redirectURL: redirect.dataUrl });
  if (match) { blocked.set(id, (blocked.get(id) || 0) + 1); pushShields(id); return cb({ cancel: true }); }
  cb({});
}
async function initAdblock() {
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(app.getPath('userData'), 'adblocker-engine.bin'),
      read: (p) => fs.promises.readFile(p),
      write: (p, d) => fs.promises.writeFile(p, d)
    });
  } catch (e) { console.error('[shields] could not load filter lists:', e && e.message); }
}

// right-click menu for web content
function buildContextMenu(contents, p) {
  const t = [];
  const send = (ch, arg) => win && win.webContents.send(ch, arg);
  const link = p.linkURL || '';
  const img = (p.mediaType === 'image' && p.srcURL) ? p.srcURL : '';
  const sel = (p.selectionText || '').trim();
  t.push({ label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() });
  t.push({ label: 'Forward', enabled: contents.canGoForward(), click: () => contents.goForward() });
  t.push({ label: 'Reload', click: () => contents.reload() });
  if (link) {
    t.push({ type: 'separator' });
    t.push({ label: 'Open link in new pane', click: () => send('open-pane', link) });
    t.push({ label: 'Open link in new tab', click: () => send('open-tab-in', { url: link, wcId: contents.id }) });
    t.push({ label: 'Copy link address', click: () => clipboard.writeText(link) });
  }
  if (img) {
    t.push({ type: 'separator' });
    t.push({ label: 'Open image in new pane', click: () => send('open-pane', img) });
    t.push({ label: 'Copy image', click: () => contents.copyImageAt(p.x, p.y) });
    t.push({ label: 'Save image', click: () => contents.downloadURL(img) });
  }
  if (p.isEditable) {
    t.push({ type: 'separator' });
    t.push({ label: 'Cut', enabled: p.editFlags.canCut, click: () => contents.cut() });
    t.push({ label: 'Copy', enabled: p.editFlags.canCopy, click: () => contents.copy() });
    t.push({ label: 'Paste', enabled: p.editFlags.canPaste, click: () => contents.paste() });
    t.push({ label: 'Select all', click: () => contents.selectAll() });
  } else if (sel) {
    t.push({ type: 'separator' });
    t.push({ label: 'Copy', click: () => contents.copy() });
    const q = sel.length > 24 ? sel.slice(0, 24) + '…' : sel;
    const searchUrl = (store.getSettings().search || 'https://duckduckgo.com/?q=%s').replace('%s', encodeURIComponent(sel));
    t.push({ label: 'Search for “' + q + '”', click: () => send('open-pane', searchUrl) });
  }
  t.push({ type: 'separator' });
  t.push({ label: 'Inspect element', click: () => contents.inspectElement(p.x, p.y) });
  return Menu.buildFromTemplate(t);
}

// Shell shortcuts intercepted on every webContents (host + each webview) so they fire even
// while a page has focus (webview key events don't bubble to the host).
const SHORTCUTS = new Set(['t', 'w', 'l', 'r', 'f', 'm', 'd', 'k', 'p', '1', '2', '3', '=', '+', '-', '0', 'shift+n']);
function wireShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = (input.shift ? 'shift+' : '') + (input.key || '').toLowerCase();   // shift+n = new incognito
    if (SHORTCUTS.has(k)) { event.preventDefault(); if (win) win.webContents.send('shortcut', k); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, backgroundColor: '#0e1418', title: 'Splitser',
    autoHideMenuBar: true,          // the default File/Edit/View menu is dead weight for a browser; hide it (Alt reveals)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {   // come to the front on launch -- don't hide behind whatever was focused (e.g. the terminal)
    win.show(); win.moveTop(); win.focus();
    try { app.focus({ steal: true }); } catch { /* not supported on some platforms */ }
  });
  // Authoritatively harden every pane's <webview> from MAIN, so a future renderer bug/XSS can't
  // hand hostile content Node access. Force the safe prefs (don't merely rely on defaults), pin the
  // preload (a page can't spoof/replace it), and drop dangerous <webview> attributes if any appear.
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, 'webview-preload.cjs');
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.plugins = true;   // enable Chromium's built-in (pdfium) PDF viewer -- view PDFs inline, not download
    if (params) { delete params.nodeintegration; delete params.nodeintegrationinsubframes; delete params.webpreferences; delete params.disablewebsecurity; delete params.plugins; }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // the privileged host frame holds splitAPI -> the vault; it must never leave its local page
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
const dlPaths = new Set();   // full paths of files we've saved -- open/reveal is gated to these
ipcMain.on('app:home', (e) => { e.returnValue = app.getPath('home'); });   // sync home dir for the sandboxed preload
ipcMain.on('open-downloads', () => shell.openPath(app.getPath('downloads')));
ipcMain.on('download:open', (_e, p) => { if (dlPaths.has(p)) shell.openPath(p); });
ipcMain.on('download:reveal', (_e, p) => { if (dlPaths.has(p)) shell.showItemInFolder(p); });
ipcMain.on('incognito:clear', () => {   // wipe the ephemeral session when the last private workspace closes
  const s = electronSession.fromPartition('split-incognito');
  Promise.all([s.clearStorageData(), s.clearCache()]).catch(() => {});
});

// vault: main only reads/writes the encrypted blob (never the key or plaintext)
ipcMain.handle('vault:get', () => store.getVault());
ipcMain.on('vault:set', (_e, blob) => store.setVault(blob));
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));
// auto-clear a copied secret from the clipboard after a delay (best effort)
ipcMain.on('clipboard:clear-soon', (_e, text) => {
  setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(''); }, 25000);
});

// shields
ipcMain.handle('shields:get', (_e, wcId) => {
  const host = wcHost(wcId);
  return { count: blocked.get(wcId) || 0, host, siteOn: host ? !allow.has(host) : true, globalOn: shieldsOn };
});
ipcMain.handle('shields:toggleSite', (_e, host) => {   // returns new on-state for this site
  if (!host) return true;
  if (allow.has(host)) allow.delete(host); else allow.add(host);
  persistShields();
  return !allow.has(host);
});
ipcMain.handle('shields:toggleAll', () => { shieldsOn = !shieldsOn; persistShields(); return shieldsOn; });

// ---- HTTP Basic/Digest auth: forward the challenge to an in-app dialog, then answer it ----
const pendingAuth = new Map();
let authId = 0;
app.on('login', (event, _contents, details, authInfo, callback) => {
  event.preventDefault();                       // we'll answer via the renderer dialog
  const id = ++authId;
  pendingAuth.set(id, callback);
  win && win.webContents.send('http-auth', { id, host: authInfo.host, port: authInfo.port, realm: authInfo.realm || '', isProxy: !!authInfo.isProxy, url: details.url || '' });
});
ipcMain.on('http-auth-reply', (_e, { id, username, password }) => {
  const cb = pendingAuth.get(id); if (!cb) return;
  pendingAuth.delete(id);
  if (username == null) cb();                    // cancelled -> let it 401
  else cb(username, password);
});

app.whenReady().then(() => {
  // Present as vanilla Chrome: drop the "Splitser/x" and "Electron/x" UA tokens. Some sites (Google
  // sign-in, banks) refuse or degrade for anything advertising Electron -- bad for a logged-in-apps browser.
  app.userAgentFallback = app.userAgentFallback.replace(/ (Splitser|Electron)\/\S+/g, '');

  initAdblock();   // engine loads async; the per-session handler no-ops until ready

  // downloads land here; env override lets tests isolate downloads
  const dlDir = process.env.SPLITSER_DL_DIR || app.getPath('downloads');
  try { fs.mkdirSync(dlDir, { recursive: true }); } catch { /* Downloads already exists */ }
  let dlId = 0;
  // Permissions: default-DENY. A couple of harmless ones auto-allow; a known-sensitive set prompts;
  // everything else (clipboard-READ, display-capture, usb/serial/hid, ...) is denied outright.
  const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write']);
  const PROMPT = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock']);

  // Apply the SAME protections (ad/tracker blocking, download handling, default-deny permissions) to
  // every session -- the persistent one AND the ephemeral 'split-incognito' one that private workspaces use.
  function wireSession(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, onBeforeRequest);
    ses.on('will-download', (_e, item) => {
      const id = ++dlId;
      const name = path.basename(item.getFilename() || 'download');   // server-controlled -> basename only
      let dest = path.join(dlDir, name);
      if (fs.existsSync(dest)) {
        const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
        let i = 1; do { dest = path.join(dlDir, base + ' (' + (i++) + ')' + ext); } while (fs.existsSync(dest));
      }
      item.setSavePath(dest);
      dlPaths.add(dest);
      const finalName = path.basename(dest);
      const emit = (state) => win && win.webContents.send('download-update', {
        id, name: finalName, path: dest, received: item.getReceivedBytes(), total: item.getTotalBytes(), state
      });
      item.on('updated', (_ev, s) => emit(s));
      item.once('done', (_ev, s) => emit(s));
      emit('progressing');
    });
    ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      if (AUTO_ALLOW.has(permission)) return callback(true);
      if (!PROMPT.has(permission)) return callback(false);   // default-deny everything else
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0,
        title: 'Splitser', message: 'Allow ' + permission + '?',
        detail: (details && details.requestingUrl) || (wc && wc.getURL()) || ''
      });
      callback(response === 1);
    });
    ses.setPermissionCheckHandler((_wc, permission) => AUTO_ALLOW.has(permission));   // gates clipboard-read etc.
  }
  wireSession(electronSession.fromPartition('persist:split'));
  wireSession(electronSession.fromPartition('split-incognito'));   // in-memory session for private workspaces

  // a page opening a popup / target=_blank -> a new PANE; shortcuts on every webview
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      if (win && /^(https?:|about:)/.test(url)) win.webContents.send('open-pane', url);
      return { action: 'deny' };
    });
    contents.on('did-start-navigation', (_ev, _u, isInPlace, isMainFrame) => {   // new page -> reset its block count
      if (isMainFrame && !isInPlace) { blocked.set(contents.id, 0); pushShields(contents.id); }
    });
    contents.on('context-menu', (_ev, p) => buildContextMenu(contents, p).popup({ window: win }));
    wireShortcuts(contents);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
