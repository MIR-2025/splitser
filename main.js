// Splitser (splitser.org) — main process. Hosts the renderer UI with <webview> enabled
// (real Chromium views, no header-strip), owns the data layer (history/bookmarks/session/
// settings via store.js), and handles downloads + permission prompts on the shared session.
import { app, BrowserWindow, ipcMain, session as electronSession, dialog, shell, clipboard, webContents, Menu, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ElectronBlocker, fromElectronDetails } from '@ghostery/adblocker-electron';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName('Splitser');
let win;

// ---- default-browser support: run ONE instance. A clicked link launches Splitser with the URL as an
// argv (opened once the renderer is ready), or -- if we're already running -- the OS starts a second
// instance whose argv is handed to us via 'second-instance', where we open it in a new pane. ----
function urlFromArgv(argv) { return (argv || []).find((a) => /^https?:\/\//i.test(a)) || ''; }
let pendingUrl = urlFromArgv(process.argv);            // a URL from THIS launch, opened after the UI is ready
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) { app.quit(); }
else {
  try { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); } catch (e) { /* best effort */ }
  app.on('second-instance', (_e, argv) => {
    const url = urlFromArgv(argv);
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (url) win.webContents.send('open-pane', url); }
  });
}

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
  // Docked: DevTools opens inside the pane's own view area, not a floating window.
  t.push({ label: 'Inspect element', click: () => { try { contents.openDevTools({ mode: 'bottom' }); } catch (e) {} contents.inspectElement(p.x, p.y); } });
  // In a tab: the renderer opens a fresh tab in this pane to host the DevTools (setDevToolsWebContents).
  t.push({ label: 'Inspect in a new tab', click: () => send('open-devtools-tab', { targetWcId: contents.id, x: p.x, y: p.y }) });
  return Menu.buildFromTemplate(t);
}

// Shell shortcuts intercepted on every webContents (host + each webview) so they fire even
// while a page has focus (webview key events don't bubble to the host).
const SHORTCUTS = new Set(['t', 'w', 'l', 'r', 'f', 'm', 'd', 'k', 'p', 'tab', 'shift+tab', '1', '2', '3', '=', '+', '-', '0', 'shift+n', 'shift+d', 'shift+e', 'shift+o']);
function wireShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const base = (input.key || '').toLowerCase();                 // the produced char, e.g. '+' for Shift+=
    const combo = input.shift ? 'shift+' + base : base;
    // prefer an explicit shift combo (shift+n, shift+d); else the base key so Ctrl++ (= Ctrl+Shift+=) still zooms
    const k = SHORTCUTS.has(combo) ? combo : (SHORTCUTS.has(base) ? base : null);
    if (k) { event.preventDefault(); if (win) win.webContents.send('shortcut', k); }
  });
}

// ---- Keyless geolocation (Brave-style). Prebuilt Electron has no Google geolocation key, so
// Chromium's network provider returns POSITION_UNAVAILABLE. We backfill navigator.geolocation in
// each page with a coarse, IP-based position fetched in MAIN -- no key, and the page never contacts
// the geoip host itself (no page CSP issue, nothing leaked beyond the IP the site already sees). ----
const GEOIP_URL = 'https://ipwho.is/';   // keyless, HTTPS, city-level. Point at a self-hosted endpoint
                                        // (Brave uses its own location.brave.com) to keep it fully private.
let geoCache = null, geoAt = 0;
async function geoipLookup() {
  if (geoCache && Date.now() - geoAt < 10 * 60 * 1000) return geoCache;   // IP location is stable -- cache 10 min
  const r = await fetch(GEOIP_URL, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('geoip http ' + r.status);
  const d = await r.json();
  if (d && d.success === false) throw new Error('geoip: ' + (d.message || 'lookup failed'));
  const lat = Number(d.latitude), lng = Number(d.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('geoip: no coords');
  geoCache = { latitude: lat, longitude: lng, accuracy: 25000 };   // ~city radius, metres
  geoAt = Date.now();
  return geoCache;
}
// Injected into every page's MAIN world via executeJavaScript (not a <script> tag, so CSP script-src
// can't block it): replace navigator.geolocation to route through the __splitGeo bridge.
const GEO_SHIM = "(function(){try{if(!navigator.geolocation||!window.__splitGeo)return;" +
  "var mk=function(p){return {coords:{latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()};};" +
  "var er=function(e){var m=(e&&e.message)||'';var c=/PERMISSION_DENIED/.test(m)?1:(/TIMEOUT/.test(m)?3:2);return {code:c,message:m||'position unavailable',PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3};};" +
  "var get=function(s,e,o){window.__splitGeo.get(o||{}).then(function(p){s&&s(mk(p));},function(x){e&&e(er(x));});};" +
  "navigator.geolocation.getCurrentPosition=get;var w=0;" +
  "navigator.geolocation.watchPosition=function(s,e,o){get(s,e,o);return ++w;};" +
  "navigator.geolocation.clearWatch=function(){};}catch(e){}})();";

function createWindow() {
  const winOpts = {
    width: 1500, height: 940, backgroundColor: '#0e1418', title: 'Splitser',
    autoHideMenuBar: true,          // the default File/Edit/View menu is dead weight for a browser; hide it (Alt reveals)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  };
  // reopen where it was closed: restore the saved size/position, but only use the position if it still
  // lands on a currently-connected display (so a disconnected monitor can't strand the window off-screen)
  const savedWin = store.getWindowState();
  if (savedWin && Number.isFinite(savedWin.width) && Number.isFinite(savedWin.height)) {
    winOpts.width = savedWin.width; winOpts.height = savedWin.height;
    if (Number.isFinite(savedWin.x) && Number.isFinite(savedWin.y)) {
      const wa = screen.getDisplayMatching({ x: savedWin.x, y: savedWin.y, width: savedWin.width, height: savedWin.height }).workArea;
      const onScreen = savedWin.x < wa.x + wa.width && savedWin.x + savedWin.width > wa.x && savedWin.y < wa.y + wa.height && savedWin.y + savedWin.height > wa.y;
      if (onScreen && savedWin.y >= wa.y - 8) { winOpts.x = savedWin.x; winOpts.y = savedWin.y; }   // else let the WM centre it on the primary display
    }
  }
  win = new BrowserWindow(winOpts);
  if (savedWin && savedWin.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  // remember size / position / monitor + maximized state whenever they change
  const saveWinState = () => { if (win && !win.isDestroyed()) { const b = win.getNormalBounds(); store.setWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }); } };
  ['resized', 'moved', 'maximize', 'unmaximize', 'close'].forEach((ev) => win.on(ev, saveWinState));
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
  // backfill navigator.geolocation in each pane's page (re-inject on every load, main world)
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.on('dom-ready', () => { wc.executeJavaScript(GEO_SHIM).catch(() => {}); });
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
ipcMain.handle('bookmarks:add-workspace', (_e, ws) => store.addWorkspaceBookmark(ws));
ipcMain.handle('bookmarks:remove', (_e, key) => store.removeBookmark(key));
ipcMain.handle('bookmarks:folders', () => store.getBookmarkFolders());
ipcMain.handle('bookmarks:folder-add', (_e, name) => store.addBookmarkFolder(name));
ipcMain.handle('bookmarks:folder-rename', (_e, { old, name }) => store.renameBookmarkFolder(old, name));
ipcMain.handle('bookmarks:folder-remove', (_e, name) => store.removeBookmarkFolder(name));
ipcMain.handle('bookmarks:set-folder', (_e, { key, folder }) => store.setBookmarkFolder(key, folder));
ipcMain.handle('session:get', () => store.getSession());
ipcMain.on('session:set', (_e, urls) => store.setSession(urls));
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));
ipcMain.handle('data:clear', (_e, kind) => store.clearData(kind));
const certCache = new Map();   // hostname -> last-seen TLS cert summary, for the address-bar security badge
const certOverrides = new Set();   // hostnames the user chose to proceed to despite a bad cert (this session only)
ipcMain.handle('cert:get', (_e, host) => certCache.get((host || '').replace(/^www\./, '')) || null);
ipcMain.handle('cert:proceed', (_e, { wcId, host, url }) => {   // user clicked "proceed anyway" on the interstitial
  if (host) certOverrides.add(host.replace(/^www\./, ''));
  const wc = wcId ? webContents.fromId(wcId) : null;
  if (wc && !wc.isDestroyed() && url) { try { wc.loadURL(url); } catch (e) { /* ignore */ } }
  return true;
});
const dlPaths = new Set();   // full paths of files we've saved -- open/reveal is gated to these
ipcMain.on('app:home', (e) => { e.returnValue = app.getPath('home'); });   // sync home dir for the sandboxed preload
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });   // sync app version for the About popover
ipcMain.on('app:ready', () => { if (pendingUrl && win && !win.isDestroyed()) { win.webContents.send('open-pane', pendingUrl); pendingUrl = ''; } });   // renderer restore done -> open a launch URL
ipcMain.on('destroy-wc', (_e, id) => {   // a pane/tab was closed -> definitively tear down its guest WebContents (+ any open DevTools)
  const wc = id ? webContents.fromId(id) : null;                 // detaching the <webview> alone leaks the guest when DevTools has it pinned
  if (wc && !wc.isDestroyed()) { try { wc.closeDevTools(); } catch (e) {} try { wc.destroy(); } catch (e) {} }
});
// Render a page's DevTools INTO another WebContents (a fresh host tab in the same pane) instead of a window.
ipcMain.on('devtools:attach', (_e, { targetId, hostId, x, y }) => {
  const target = targetId ? webContents.fromId(targetId) : null;
  const host = hostId ? webContents.fromId(hostId) : null;
  if (!target || target.isDestroyed() || !host || host.isDestroyed()) return;
  try {
    target.setDevToolsWebContents(host);                        // host must be a fresh WebContents (no prior navigation)
    target.openDevTools();
    if (x != null && y != null) target.inspectElement(x, y);
  } catch (e) { console.error('[devtools] attach failed:', e && e.message); }
});
ipcMain.on('devtools:close', (_e, targetId) => {   // the DevTools host tab was closed -> detach DevTools from the target (target keeps running)
  const target = targetId ? webContents.fromId(targetId) : null;
  if (target && !target.isDestroyed()) { try { target.closeDevTools(); } catch (e) {} }
});
ipcMain.handle('geo:get', async (e) => {   // coarse IP-based position for the geolocation shim (no Google key)
  const origin = (() => { try { return new URL(e.sender.getURL()).origin; } catch (x) { return ''; } })();
  let ok = store.getGeoConsent(origin);   // remembered per origin, persisted across restarts
  if (ok === undefined) {
    if (process.env.SPLITSER_GEO_TEST === '1') ok = true;   // test seam: skip the modal in headless runs
    else {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0,
        title: 'Splitser', message: 'Allow ' + (origin || 'this site') + ' to access your location?',
        detail: 'Splitser provides a coarse, IP-based location (no GPS, no Google).'
      });
      ok = response === 1;
    }
    store.setGeoConsent(origin, ok);
  }
  if (!ok) throw new Error('PERMISSION_DENIED');
  try { return await geoipLookup(); } catch (err) { throw new Error('POSITION_UNAVAILABLE'); }
});
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

// Navigation history for a pane's active webview -- powers the right-click menu on the back/fwd buttons.
// The <webview> tag can't list entries; only webContents.navigationHistory can. Never let it throw.
ipcMain.handle('nav:history', (_e, wcId) => {
  try {
    const wc = wcId ? webContents.fromId(wcId) : null;
    if (!wc || wc.isDestroyed()) return null;
    const nh = wc.navigationHistory;
    const entries = nh.getAllEntries().map((en, i) => ({ i, url: en.url, title: en.title || '' }));
    return { entries, active: nh.getActiveIndex() };
  } catch (e) { return null; }
});

// ---- HTTP Basic/Digest auth: forward the challenge to an in-app dialog, then answer it ----
const pendingAuth = new Map();
const mainNavOrigin = new Map();                 // webContents.id -> origin of its last top-level navigation
let authId = 0;
app.on('login', (event, webContents, details, authInfo, callback) => {
  event.preventDefault();                        // we'll answer via the renderer dialog (or auto-decline)
  const reqUrl = details.url || '';
  // Only surface a credential prompt for auth that belongs to a top-level navigation the user drove.
  // A 401 on a cross-origin SUBRESOURCE (e.g. a hostile page's <img src="https://intranet/secret">) is
  // silently declined -- otherwise the page conjures a prompt, prefilled from the vault, for an origin
  // the user never chose to visit. Proxy auth has no page origin, so it is always allowed (review #3).
  let reqOrigin = ''; try { reqOrigin = new URL(reqUrl).origin; } catch { /* opaque */ }
  const navOrigin = webContents ? mainNavOrigin.get(webContents.id) : '';
  if (!authInfo.isProxy && (!navOrigin || navOrigin !== reqOrigin)) { callback(); return; }   // decline -> 401
  const id = ++authId;
  pendingAuth.set(id, callback);
  win && win.webContents.send('http-auth', { id, host: authInfo.host, port: authInfo.port, realm: authInfo.realm || '', isProxy: !!authInfo.isProxy, url: reqUrl });
});
ipcMain.on('http-auth-reply', (_e, { id, username, password }) => {
  const cb = pendingAuth.get(id); if (!cb) return;
  pendingAuth.delete(id);
  if (username == null) cb();                    // cancelled -> let it 401
  else cb(username, password);
});

app.whenReady().then(() => {
  if (!gotSingleLock) return;   // a non-primary instance is quitting -- don't build a session/window
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
    ses.on('will-download', (_e, item, wc) => {
      const id = ++dlId;
      const mode = store.getSettings().downloadMode || 'auto';
      const name = path.basename(item.getFilename() || 'download');   // server-controlled -> basename only
      const host = (() => { try { return new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      const remembered = (mode === 'remember' && host) ? store.getDownloadDir(host) : '';
      const collisionSafe = (dir) => {
        let d = path.join(dir, name);
        if (fs.existsSync(d)) { const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let i = 1; do { d = path.join(dir, base + ' (' + (i++) + ')' + ext); } while (fs.existsSync(d)); }
        return d;
      };
      let dest = '';
      // 'ask', or 'remember' with no folder yet for this site -> native Save As dialog (the chosen
      // folder is recorded on completion, so the next download from this site reuses it). Otherwise
      // auto-save: 'auto' -> Downloads; 'remember' with a known per-site folder -> that folder.
      if (mode === 'ask' || (mode === 'remember' && !remembered)) {
        // don't setSavePath -> Electron shows the Save As dialog
      } else {
        dest = collisionSafe(remembered || dlDir);
        item.setSavePath(dest);
        dlPaths.add(dest);
      }
      const emit = (state) => {
        const p = item.getSavePath() || dest || '';
        if (p) dlPaths.add(p);   // gate open/reveal to the real saved path (dialog path is chosen late)
        if (state === 'completed' && mode === 'remember' && host && p) store.setDownloadDir(host, path.dirname(p));
        win && win.webContents.send('download-update', {
          id, name: p ? path.basename(p) : name, path: p, received: item.getReceivedBytes(), total: item.getTotalBytes(), state
        });
      };
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
    // Auto-allowed perms pass the sync check; PROMPT perms also pass it so navigator.permissions.query()
    // reports them as available (not 'denied') and the ASYNC request handler above gets to prompt --
    // otherwise a site that pre-checks (e.g. geolocation) gives up before ever requesting. Everything
    // else (clipboard-read, display-capture, usb/serial/hid, ...) still fails the check -> denied.
    ses.setPermissionCheckHandler((_wc, permission) => AUTO_ALLOW.has(permission) || PROMPT.has(permission));
    // Observe only: cache each host's leaf cert for the address-bar badge, then DEFER the trust decision
    // to Chromium (cb(-3)) so this never weakens verification (a bad cert is still blocked as before).
    ses.setCertificateVerifyProc((req, cb) => {
      try {
        const c = req.validatedCertificate || req.certificate;
        if (req.hostname && c) certCache.set(req.hostname.replace(/^www\./, ''), {
          subjectName: c.subjectName || '', issuerName: c.issuerName || '', serialNumber: c.serialNumber || '',
          validStart: c.validStart || 0, validExpiry: c.validExpiry || 0, fingerprint: c.fingerprint || '',
          ok: req.verificationResult === 'net::OK'
        });
      } catch (e) { /* ignore */ }
      cb(-3);
    });
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
    contents.on('did-start-navigation', (_ev, url, isInPlace, isMainFrame) => {   // new page -> reset its block count
      if (isMainFrame && !isInPlace) {
        blocked.set(contents.id, 0); pushShields(contents.id);
        try { mainNavOrigin.set(contents.id, new URL(url).origin); } catch { mainNavOrigin.delete(contents.id); }   // remember the top-level origin for the HTTP-auth main-frame check
      }
    });
    contents.on('context-menu', (_ev, p) => buildContextMenu(contents, p).popup({ window: win }));
    contents.on('certificate-error', (event, url, error, _certificate, callback, isMainFrame) => {
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      if (host && certOverrides.has(host)) { event.preventDefault(); callback(true); return; }   // user already chose to proceed
      callback(false);                                                                            // otherwise keep blocking (the load fails)
      if (isMainFrame !== false && win && !win.isDestroyed())                                     // main-frame failure -> show the interstitial
        win.webContents.send('cert-error', { wcId: contents.id, url, host, error });
    });
    wireShortcuts(contents);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
