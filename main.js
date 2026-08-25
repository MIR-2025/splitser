// Splitser (splitser.org) — main process. Hosts the renderer UI with <webview> enabled
// (real Chromium views, no header-strip), owns the data layer (history/bookmarks/session/
// settings via store.js), and handles downloads + permission prompts on the shared session.
import { app, BrowserWindow, ipcMain, session as electronSession, dialog, shell, clipboard, nativeImage, webContents, Menu, screen } from 'electron';
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
  // A <webview> guest has no window of its own, so a DOCKED ('bottom'/'right') DevTools opens invisibly
  // -- inspect looked broken. 'detach' (a separate DevTools window) works for guests; that's the reliable one.
  t.push({ label: 'Inspect element', click: () => { try { contents.openDevTools({ mode: 'detach' }); } catch (e) {} contents.inspectElement(p.x, p.y); } });
  t.push({ type: 'separator' });
  t.push({ label: 'Capture full page', click: () => send('capture-full', { targetWcId: contents.id }) });
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

// ---- Full-page screenshot. Native, one-shot: attach the debugger to the tab's guest, ask CDP for
// the WHOLE scrollable page in a single Page.captureScreenshot (captureBeyondViewport) -- no
// scroll-and-stitch, no OffscreenCanvas seams. Enormous pages are scaled to stay under engine limits. ----
const CAP_MAX_EDGE = 16384;              // max px on any one edge most engines allow
const CAP_MAX_AREA = 256 * 1024 * 1024;  // conservative max canvas area (px)
async function captureFullPage(wcId) {
  const wc = wcId ? webContents.fromId(wcId) : null;
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'That tab is gone.' };
  const dbg = wc.debugger;
  let attached = false, scrolled = false;
  try {
    try { dbg.attach('1.3'); attached = true; }
    catch (e) { return { ok: false, error: 'Close this tab’s DevTools first, then try again.' }; }   // one debugger client at a time
    // Measure from the page itself. captureBeyondViewport / device-metrics overrides DON'T re-raster a
    // <webview> guest's off-screen content (its surface is tied to the visible element) -- they just tile
    // the visible viewport (the "repeated viewport" bug). So we scroll-and-stitch, like a real full-page
    // capture tool: scroll a viewport at a time, grab each visible tile, and stitch them on a canvas.
    // returnByValue eval; evalAsync awaits an in-page Promise (for the scroll-settle step).
    const evalJson = async (expr) => (await dbg.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
    const evalAsync = async (expr) => (await dbg.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    // Kill smooth scrolling first. With scroll-behavior:smooth, scrollTo animates -- so the scrollY we
    // record for a tile doesn't match where the shot was actually taken, and tiles land at the wrong
    // offset and duplicate content. Force 'auto' for the capture; we restore it afterward.
    await evalJson("(function(){var d=document.documentElement;window.__pcap={sb:d.style.scrollBehavior,bsb:document.body?document.body.style.scrollBehavior:'',y:window.scrollY};d.style.scrollBehavior='auto';if(document.body)document.body.style.scrollBehavior='auto';return 1;})()");
    scrolled = true;
    const g = await evalJson('JSON.stringify({sw:Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),sh:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0),vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio||1,y:window.scrollY})');
    const g0 = JSON.parse(g);
    const { vw, vh, dpr } = g0; let { sw, sh } = g0;
    if (!sw || !sh) return { ok: false, error: 'Could not measure the page.' };
    // Output scale: clamp so the stitched canvas (in device px) stays under engine limits.
    const pxW = sw * dpr, pxH = sh * dpr;
    const scale = Math.min(1, CAP_MAX_EDGE / pxW, CAP_MAX_EDGE / pxH, Math.sqrt(CAP_MAX_AREA / (pxW * pxH)));
    const scaled = scale < 1;
    // Capture tiles top-to-bottom. Each step scrolls, waits two animation frames + a beat for it to
    // actually paint, then reads the SETTLED scrollY -- in one awaited call -- so the tile's recorded
    // offset matches the pixels we capture right after. Re-measures height each step (lazy content).
    const tiles = [];
    for (let y = 0; y < sh; y += vh) {
      const info = JSON.parse(await evalAsync(
        '(async function(){window.scrollTo(0,' + y + ');' +
        'await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});' +
        'await new Promise(function(r){setTimeout(r,90);});' +
        'return JSON.stringify({y:Math.round(window.scrollY),sh:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)});})()'
      ));
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true });
      tiles.push({ y: info.y, data: shot.data });
      if (info.sh > sh) sh = info.sh;              // page grew (lazy content) -> keep going
      if (info.y + vh >= sh) break;                // reached the bottom
      if (tiles.length > 200) break;               // sanity cap on absurdly long pages
    }
    const dataUrl = await stitchTiles(tiles, { vw, vh, dpr, sh, scale });
    return { ok: true, dataUrl, width: Math.round(sw * dpr * scale), height: Math.round(sh * dpr * scale), scaled };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Capture failed.' };
  } finally {
    // restore the page's scroll-behavior + original scroll position
    if (scrolled) { try { await dbg.sendCommand('Runtime.evaluate', { expression: "(function(){var d=document.documentElement,c=window.__pcap||{};d.style.scrollBehavior=c.sb||'';if(document.body)document.body.style.scrollBehavior=c.bsb||'';window.scrollTo(0,c.y||0);try{delete window.__pcap;}catch(e){}})()" }); } catch (e) {} }
    if (attached) { try { dbg.detach(); } catch (e) {} }
  }
}
// Stitch viewport tiles onto one canvas in a hidden window (no image lib needed). Each tile is a full
// visible-viewport PNG; we draw it at its scroll offset. Returns a PNG data URL of the whole page.
async function stitchTiles(tiles, geo) {
  let off;
  try {
    off = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false } });
    await off.loadURL('about:blank');
    const dataUrl = await off.webContents.executeJavaScript(
      '(async function(){' +
      'var T=' + JSON.stringify(tiles) + ',G=' + JSON.stringify(geo) + ';' +
      'var W=Math.round(G.vw*G.dpr*G.scale),H=Math.round(G.sh*G.dpr*G.scale);' +
      'var c=document.createElement("canvas");c.width=W;c.height=H;var x=c.getContext("2d");' +
      'for(var i=0;i<T.length;i++){var t=T[i];' +
      'var im=new Image();await new Promise(function(res,rej){im.onload=res;im.onerror=res;im.src="data:image/png;base64,"+t.data;});' +
      'var dy=Math.round(t.y*G.dpr*G.scale);' +
      'x.drawImage(im,0,0,im.naturalWidth,im.naturalHeight,0,dy,Math.round(im.naturalWidth*G.scale),Math.round(im.naturalHeight*G.scale));' +
      '}' +
      'return c.toDataURL("image/png");})()'
    );
    return dataUrl;
  } finally { if (off && !off.isDestroyed()) off.destroy(); }
}
ipcMain.handle('capture:full', (_e, wcId) => captureFullPage(wcId));

function dataUrlToBuffer(dataUrl) { return Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'); }
function stampName(ext) { const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`; }

ipcMain.handle('capture:savePng', async (_e, { dataUrl } = {}) => {   // user picks the path -> no path-injection risk
  if (!dataUrl) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save full-page screenshot', defaultPath: path.join(app.getPath('downloads'), stampName('png')),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try { await fs.promises.writeFile(filePath, dataUrlToBuffer(dataUrl)); return { ok: true, path: filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('capture:savePdf', async (_e, { dataUrl, width, height } = {}) => {   // render the PNG into a one-page PDF sized to the image
  if (!dataUrl || !width || !height) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save full-page screenshot as PDF', defaultPath: path.join(app.getPath('downloads'), stampName('pdf')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    // Build the PDF ourselves by embedding the image (JPEG via /DCTDecode) into a one-page PDF sized to
    // it. We used to use webContents.printToPDF, but that's flaky/undebuggable across environments (it
    // silently fails to produce a file on some setups). Hand-building is deterministic and testable.
    const jp = await pngToJpeg(dataUrl);
    const pdf = buildImagePdf(jp);
    await fs.promises.writeFile(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Re-encode a PNG data URL to JPEG bytes + pixel dims via a hidden-window canvas (no printToPDF).
async function pngToJpeg(dataUrl) {
  let off;
  try {
    off = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await off.loadURL('about:blank');
    const res = await off.webContents.executeJavaScript(
      '(async function(){var im=new Image();await new Promise(function(r){im.onload=r;im.onerror=r;im.src=' + JSON.stringify(dataUrl) + ';});' +
      'var c=document.createElement("canvas");c.width=im.naturalWidth;c.height=im.naturalHeight;' +
      'var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0);' +   // white matte (JPEG has no alpha)
      'return JSON.stringify({w:c.width,h:c.height,jpeg:c.toDataURL("image/jpeg",0.92)});})()'
    );
    const o = JSON.parse(res);
    if (!o.w || !o.h) throw new Error('could not rasterize image');
    return { w: o.w, h: o.h, bytes: Buffer.from(o.jpeg.replace(/^data:image\/jpeg;base64,/, ''), 'base64') };
  } finally { if (off && !off.isDestroyed()) off.destroy(); }
}
// Minimal one-page PDF embedding a JPEG (baseline, DeviceRGB). Page sized to the image at 96dpi -> points.
function buildImagePdf({ w, h, bytes }) {
  const pw = (w * 72 / 96).toFixed(2), ph = (h * 72 / 96).toFixed(2);
  const content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
  const imgHead = '<</Type/XObject/Subtype/Image/Width ' + w + '/Height ' + h + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + bytes.length + '>>';
  const chunks = []; let pos = 0; const off = [];
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); pos += buf.length; };
  push('%PDF-1.3\n');
  off[1] = pos; push('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n');
  off[2] = pos; push('2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n');
  off[3] = pos; push('3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + pw + ' ' + ph + ']/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>\nendobj\n');
  off[4] = pos; push('4 0 obj\n' + imgHead + '\nstream\n'); push(bytes); push('\nendstream\nendobj\n');
  off[5] = pos; push('5 0 obj\n<</Length ' + content.length + '>>\nstream\n' + content + '\nendstream\nendobj\n');
  const xref = pos;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push('trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF');
  return Buffer.concat(chunks);
}

ipcMain.handle('capture:copy', (_e, { dataUrl } = {}) => {   // put the PNG on the clipboard as an image
  if (!dataUrl) return { ok: false };
  try { clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
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
    ses.setPermissionCheckHandler((_wc, permission) => AUTO_ALLOW.has(permission));   // gates clipboard-read etc.
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
