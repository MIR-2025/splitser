// Splitser renderer. Phase 1 tiling shell + Phase 2 native wins + Phase 3 data layer:
// history-backed address autocomplete, bookmarks, session restore, downloads, settings,
// and the vault (local password manager + autofill).
import { Vault } from './vault.js';
import { Theme } from './theme.js';
const api = window.splitAPI;
const HOME = (api && api.home) || '';
const gridRoot = document.getElementById('grid');   // parent element; holds one .gridset per set
const setbar = document.getElementById('setbar');
const hoverEl = document.getElementById('hoverurl');
const infoEl = document.getElementById('paneinfo');
const gridDimsEl = document.getElementById('grid-dims');   // the "C×R" text in the footer Grid button

// SETS (workspaces): each set is an independent grid of panes with its own layout. Only the
// current set is shown; the others stay in the DOM (display:none) so their webviews stay ALIVE.
// `grid` / `panes` / `activePane` / `currentLayout` MIRROR the current set (`cur`) so all the
// pane/tab/layout code below is unchanged -- switchSet() just re-points these four mirrors.
const sets = [];              // [{ el, panes:[], activePane, layout, gCols:[], gRows:[] }]
let cur = null;               // the current set
let grid = null;              // mirror of cur.el (current .gridset container)
let panes = [];               // mirror of cur.panes
let activePane = null;        // mirror of cur.activePane
let currentLayout = 'cols';   // mirror of cur.layout: 'cols' | 'g2x2' | 'g3x3'
let SETTINGS = { home: 'https://duckduckgo.com', search: 'https://duckduckgo.com/?q=%s' };

function normalize(s) {
  s = s.trim();
  if (!s) return null;
  if (/^(javascript|data|blob|vbscript):/i.test(s)) return SETTINGS.search.replace('%s', encodeURIComponent(s));  // never navigate the bar to a script/data URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^~\//.test(s) && HOME) return 'file://' + encodeURI(HOME + s.slice(1));         // ~/path -> local file
  if (/^\/(?!\/)/.test(s)) return 'file://' + encodeURI(s);                            // /abs/path -> local file
  if (/^[a-zA-Z]:[\\/]/.test(s)) return 'file:///' + encodeURI(s.replace(/\\/g, '/'));  // Windows C:\path -> local file
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(s)) return 'https://' + s;
  return SETTINGS.search.replace('%s', encodeURIComponent(s));
}
const active = () => activePane || panes[0];
function markActive() {   // visual focus indicator: accent the pane that has focus
  document.querySelectorAll('.pane.active').forEach((p) => p.classList.remove('active'));
  const p = active(); if (p && p.el) p.el.classList.add('active');
  updateTitle();          // window title follows the focused pane
}

// ---- per-host custom favicons: give an icon to sites that have none (localhost, dev servers) ----
let favOverrides = {};
try { favOverrides = JSON.parse(localStorage.getItem('favicons') || '{}') || {}; } catch (e) { favOverrides = {}; }
function favHost(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function favOv(host) { return host ? favOverrides[host] : null; }
function saveFavs() { try { localStorage.setItem('favicons', JSON.stringify(favOverrides)); } catch (e) { /* ignore */ } }

// ---- per-tab colours: an auto hue from the domain, with an optional manual per-host override ----
let colorOverrides = {};
try { colorOverrides = JSON.parse(localStorage.getItem('tabcolors') || '{}') || {}; } catch (e) { colorOverrides = {}; }
const TAB_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8'];
function colorOv(host) { return host ? (colorOverrides[host] || null) : null; }
function saveColors() { try { localStorage.setItem('tabcolors', JSON.stringify(colorOverrides)); } catch (e) { /* ignore */ } }
function autoTabColor(host) {                      // deterministic hue -> same site, same colour, no config
  if (!host) return '';
  let h = 0; for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ' 62% 60%)';
}
function tabColorFor(host) { return colorOv(host) || autoTabColor(host); }   // manual override wins over auto
function resyncHostColors(host) {
  for (const s of sets) for (const p of s.panes) for (const t of p.tabs) { if (favHost(t.url || (t.view && t.view.getURL())) === host && t.syncColor) t.syncColor(); }
}
const FAV_EMOJI = ['🖥️', '💻', '🧪', '⚙️', '🚀', '📦', '🔧', '🗄️', '🐘', '🐍', '⚡', '🌐', '📊', '🔒', '🎯', '🧩'];
const FAV_COLORS = ['#5fe08a', '#5b9dff', '#c084fc', '#fb7185', '#fbbf24', '#2dd4bf', '#f97316', '#94a3b8'];
function makeFav(spec, host) {   // render an emoji or a colour+initial to a 32px favicon data URL
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  if (spec.emoji) { g.font = '24px system-ui,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(spec.emoji, 16, 18); }
  else { g.fillStyle = spec.color; if (g.roundRect) { g.beginPath(); g.roundRect(1, 1, 30, 30, 7); g.fill(); } else g.fillRect(1, 1, 30, 30); g.fillStyle = '#0b1013'; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((host || '?').charAt(0).toUpperCase(), 16, 17); }
  return c.toDataURL('image/png');
}
function favFromFile(file) {   // downscale an uploaded image to a 64px square favicon data URL (cover-fit)
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => reject(new Error('decode'));
      im.onload = () => {
        const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
        const s = Math.max(S / im.naturalWidth, S / im.naturalHeight);
        const w = im.naturalWidth * s, h = im.naturalHeight * s;
        g.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
        resolve(c.toDataURL('image/png'));
      };
      im.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
function setPaneFav(pane, favicon) {
  if (favicon) { pane.fav.src = favicon; pane.fav.classList.remove('fav-empty'); }
  else { pane.fav.removeAttribute('src'); pane.fav.classList.add('fav-empty'); }
  pane.fav.hidden = false;   // always shown -> always a click target to set an icon
}
function resyncHostFavicons(host) {
  for (const s of sets) for (const p of s.panes) for (const t of p.tabs) { if (favHost(t.url || (t.view && t.view.getURL())) === host && t.syncFav) t.syncFav(); }
  renderSetbar();
}
function closeFavPicker() { document.querySelectorAll('.fav-picker').forEach((p) => p.remove()); }
function openFavPicker(pane) {
  closeFavPicker();
  const host = favHost(pane.view ? pane.view.getURL() : ''); if (!host) return;
  const pop = document.createElement('div'); pop.className = 'fav-picker';
  pop.innerHTML = '<div class="fp-h">Icon for <b>' + esc(host) + '</b></div>' +
    '<div class="fp-grid">' + FAV_EMOJI.map((e) => '<button class="fp-e" data-emoji="' + e + '">' + e + '</button>').join('') + '</div>' +
    '<div class="fp-grid">' + FAV_COLORS.map((c) => '<button class="fp-c" data-color="' + c + '" style="background:' + c + '"></button>').join('') + '</div>' +
    '<label class="fp-upload">&#128247; Upload an image<input type="file" accept="image/*" hidden /></label>' +
    '<button class="fp-auto">Use the site’s own icon</button>';
  pane.el.appendChild(pop);
  const br = pane.fav.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left - 8, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 6) + 'px';
  const setFav = (url) => { favOverrides[host] = url; saveFavs(); resyncHostFavicons(host); closeFavPicker(); };
  pop.querySelectorAll('.fp-e').forEach((b) => { b.onclick = () => setFav(makeFav({ emoji: b.dataset.emoji }, host)); });
  pop.querySelectorAll('.fp-c').forEach((b) => { b.onclick = () => setFav(makeFav({ color: b.dataset.color }, host)); });
  const up = pop.querySelector('.fp-upload input');
  if (up) up.onchange = async (e) => { const f = e.target.files[0]; if (f) { try { setFav(await favFromFile(f)); } catch (err) { /* bad image */ } } };
  pop.querySelector('.fp-auto').onclick = () => { delete favOverrides[host]; saveFavs(); resyncHostFavicons(host); closeFavPicker(); };
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!pop.contains(e.target) && e.target !== pane.fav) { closeFavPicker(); document.removeEventListener('mousedown', h); } }), 0);
}
function closeTabColorPicker() { document.querySelectorAll('.tabclr-picker').forEach((p) => p.remove()); }
function openTabColorPicker(pane, tab, tabEl) {   // right-click a tab -> override its site's colour (or reset to auto)
  closeTabColorPicker();
  const host = favHost(tab.url || (tab.view && tab.view.getURL()) || ''); if (!host) return;
  const cur = colorOv(host);
  const pop = document.createElement('div'); pop.className = 'tabclr-picker';
  pop.innerHTML = '<div class="fp-h">Colour for <b>' + esc(host) + '</b></div>' +
    '<div class="fp-grid">' + TAB_COLORS.map((c) => '<button class="tcp-c' + (c === cur ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>').join('') + '</div>' +
    '<button class="fp-auto">Auto (colour by site)</button>';
  pane.el.appendChild(pop);
  const br = tabEl.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 4) + 'px';
  const pick = (color) => { if (color) colorOverrides[host] = color; else delete colorOverrides[host]; saveColors(); resyncHostColors(host); closeTabColorPicker(); };
  pop.querySelectorAll('.tcp-c').forEach((b) => { b.onclick = () => pick(b.dataset.color); });
  pop.querySelector('.fp-auto').onclick = () => pick(null);
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!pop.contains(e.target)) { closeTabColorPicker(); document.removeEventListener('mousedown', h); } }), 0);
}

// ---- address-bar security badge: "secure" (https) / "not secure" (http) for real remote sites; nothing
// for file://, about:, or localhost (fine over http). Clicking it shows the site's TLS certificate. ----
function siteSecurity(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname;
  if (['file:', 'about:', 'data:', 'chrome:', 'blob:'].includes(u.protocol)) return null;
  if (host === 'localhost' || /\.localhost$/i.test(host) || /^127\./.test(host) || host === '::1' || host === '[::1]' || host === '0.0.0.0') return null;
  if (u.protocol === 'https:') return 'secure';
  if (u.protocol === 'http:') return 'insecure';
  return null;
}
function closeCertPop() { document.querySelectorAll('.cert-pop').forEach((p) => p.remove()); }
async function openCertPopover(pane) {
  closeCertPop();
  const url = pane.view ? pane.view.getURL() : '';
  const st = siteSecurity(url); if (!st) return;
  const host = favHost(url);
  const cert = st === 'secure' && api.certGet ? await api.certGet(host) : null;
  const fmt = (s) => { try { return s ? new Date(s * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '?'; } catch { return '?'; } };
  const expired = cert && cert.validExpiry && (cert.validExpiry * 1000 < Date.now());
  const row = (k, v) => '<div class="cert-row"><span class="cert-k">' + k + '</span><span class="cert-v">' + esc(v || '?') + '</span></div>';
  const body = st === 'insecure'
    ? '<div class="cert-warn">This site uses <b>http://</b> -- the connection is <b>not encrypted</b>, so anything you send can be read or changed on the network. Avoid entering passwords or personal details.</div>'
    : cert
      ? '<div class="cert-rows">' +
          row('Issued to', cert.subjectName) + row('Issued by', cert.issuerName) +
          row('Valid', fmt(cert.validStart) + ' to ' + fmt(cert.validExpiry) + (expired ? '  (EXPIRED)' : '')) +
          row('SHA-256', (cert.fingerprint || '').replace(/^sha256\//i, '')) +
        '</div>'
      : '<div class="cert-warn">Encrypted (HTTPS). Certificate details aren\'t cached yet -- reload the page to fetch them.</div>';
  const pop = document.createElement('div'); pop.className = 'cert-pop ' + st;
  pop.innerHTML = '<div class="cert-h">' + (st === 'secure' ? '&#128274; Secure connection' : '&#9888;&#65039; Not secure') + '</div>' +
    '<div class="cert-host">' + esc(host) + '</div>' + body;
  pane.el.appendChild(pop);
  const br = pane.lockBtn.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left - 8, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 6) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!pop.contains(e.target) && e.target !== pane.lockBtn) { closeCertPop(); document.removeEventListener('mousedown', h); } }), 0);
}

function closeNavHistPop() { document.querySelectorAll('.navhist-pop').forEach((p) => p.remove()); }
// Right-click a nav button -> a menu of up to 10 history entries. dir: -1 back (pages behind), +1 forward (ahead).
async function openNavHistory(pane, dir, btn) {
  closeNavHistPop(); closeCertPop(); closeShieldsPop(); closeFavPicker();
  const t = pane.activeTab;
  if (!t || !t.wcId || !api.navHistory) return;
  const h = await api.navHistory(t.wcId);
  if (!h || !h.entries || !h.entries.length) return;
  const active = h.active;
  const list = dir < 0
    ? h.entries.slice(Math.max(0, active - 10), active).reverse()   // nearest previous page first
    : h.entries.slice(active + 1, active + 11);                     // nearest next page first
  if (!list.length) return;
  const pop = document.createElement('div'); pop.className = 'navhist-pop';
  pop.innerHTML = list.map((e) =>
    '<button class="navhist-item" data-i="' + e.i + '" title="' + esc(e.url) + '">' + esc(e.title || e.url) + '</button>'
  ).join('');
  pane.el.appendChild(pop);
  const br = btn.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 6) + 'px';
  pop.addEventListener('click', (ev) => {
    const item = ev.target.closest('.navhist-item'); if (!item) return;
    const idx = parseInt(item.dataset.i, 10);
    if (pane.view) { try { pane.view.goToIndex(idx); } catch (e) { /* webview may be detached */ } }
    closeNavHistPop();
  });
  setTimeout(() => document.addEventListener('mousedown', function hh(e) { if (!pop.contains(e.target) && e.target !== btn) { closeNavHistPop(); document.removeEventListener('mousedown', hh); } }), 0);
}

const BAR = `
  <div class="bar">
    <button class="nav back" title="Back">&#8249;</button>
    <button class="nav fwd" title="Forward">&#8250;</button>
    <button class="nav reload" title="Reload">&#8635;</button>
    <button class="nav lock" title="Site security" hidden></button>
    <img class="fav" alt="" hidden />
    <input class="addr" type="text" spellcheck="false" autocomplete="off" placeholder="Search or enter address" />
    <span class="spin" hidden></span>
    <button class="nav shield" title="Shields: ad &amp; tracker blocking">&#128737;<span class="shield-n"></span></button>
    <button class="nav key" title="Fill login from vault" hidden>&#128273;</button>
    <button class="nav star" title="Bookmark (Ctrl+D)">&#9734;</button>
    <button class="nav mute" title="Mute pane (Ctrl+M)" hidden>&#128266;</button>
    <button class="nav split" title="New pane (Ctrl+T)">+</button>
    <button class="nav close" title="Close pane (Ctrl+W)">&#215;</button>
  </div>`;
const FINDBAR = `
  <div class="findbar" hidden>
    <input class="find-input" type="text" spellcheck="false" placeholder="Find in page" />
    <span class="find-count"></span>
    <button class="find-btn find-prev" title="Previous">&#8593;</button>
    <button class="find-btn find-next" title="Next">&#8595;</button>
    <button class="find-btn find-close" title="Close (Esc)">&#215;</button>
  </div>`;

function certErrText(code) {   // Chromium cert error code -> a plain-language reason
  const c = String(code || '');
  if (/DATE_INVALID/.test(c)) return 'This site\'s security certificate has expired, or your device clock is wrong.';
  if (/AUTHORITY_INVALID|SELF_SIGNED/.test(c)) return 'This site\'s certificate isn\'t from a recognised authority (it may be self-signed).';
  if (/COMMON_NAME_INVALID/.test(c)) return 'This site\'s certificate was issued for a different domain.';
  if (/REVOKED/.test(c)) return 'This site\'s certificate has been revoked.';
  if (/WEAK|OBSOLETE/.test(c)) return 'This site\'s certificate uses a weak, insecure algorithm.';
  return 'This site\'s security certificate is not trusted.';
}

function makePane(url, beforeEl = null, tabUrls = null) {
  url = url || SETTINGS.home;
  const el = document.createElement('section');
  el.className = 'pane';
  el.style.flexGrow = '1';
  el.innerHTML = '<div class="tabstrip"><button class="newtab" title="New tab">+</button></div>' +
    BAR + FINDBAR + '<div class="suggest" hidden></div><div class="views"></div>';
  grid.insertBefore(el, beforeEl);

  const addr = el.querySelector('.addr');
  const fav = el.querySelector('.fav');
  const spin = el.querySelector('.spin');
  const star = el.querySelector('.star');
  const keyBtn = el.querySelector('.key');
  const muteBtn = el.querySelector('.mute');
  const shieldBtn = el.querySelector('.shield');
  const lockBtn = el.querySelector('.lock');
  const suggest = el.querySelector('.suggest');
  const findbar = el.querySelector('.findbar');
  const findInput = el.querySelector('.find-input');
  const findCount = el.querySelector('.find-count');
  const tabstrip = el.querySelector('.tabstrip');

  const pane = {
    el, addr, star, keyBtn, shieldBtn, lockBtn, tabstrip, fav, spin, muteBtn, findbar, findInput, findCount,
    viewsBox: el.querySelector('.views'), tabs: [], activeTab: null, sugIdx: -1, sugs: [],
    get view() { return this.activeTab ? this.activeTab.view : null; },
    get title() { return this.activeTab ? this.activeTab.title : ''; },
    get zoom() { return this.activeTab ? this.activeTab.zoom : 1; }
  };
  pane.incognito = !!(cur && cur.incognito);   // private-workspace panes: ephemeral session, no history
  panes.push(pane);
  pane.set = cur;                                    // owning workspace, for background-activity badges

  pane.syncAddr = () => { const u = pane.view && pane.view.getURL(); if (u && u !== 'about:blank' && document.activeElement !== addr) addr.value = u; };
  pane.refreshStar = async () => {
    const u = pane.view ? pane.view.getURL() : '';
    const on = /^https?:/.test(u) ? await api.bookmarkHas(u) : false;
    star.innerHTML = on ? '&#9733;' : '&#9734;'; star.classList.toggle('on', on);
  };
  pane.toggleBookmark = async () => {
    const u = pane.view ? pane.view.getURL() : ''; if (!/^https?:/.test(u)) return;
    const on = await api.bookmarkToggle({ url: u, title: pane.title || u });
    star.innerHTML = on ? '&#9733;' : '&#9734;'; star.classList.toggle('on', on);
    if (!document.getElementById('panel-bookmarks').hidden) renderBookmarks();
  };
  pane.openFind = () => { if (!pane.view) return; findbar.hidden = false; findInput.focus(); findInput.select(); if (findInput.value) pane.view.findInPage(findInput.value); };
  pane.closeFind = () => { findbar.hidden = true; findCount.textContent = ''; if (pane.view) { pane.view.stopFindInPage('clearSelection'); pane.view.focus(); } };
  pane.setZoom = (z) => {
    const t = pane.activeTab; if (!t) return;
    t.zoom = Math.max(0.4, Math.min(3, z)); pane.view.setZoomFactor(t.zoom);
    let b = pane._zoomBadge;                          // transient "120%" overlay, top-center of the pane
    if (!b) { b = document.createElement('div'); b.className = 'zoom-badge'; pane.viewsBox.appendChild(b); pane._zoomBadge = b; }
    b.textContent = Math.round(t.zoom * 100) + '%';
    b.classList.add('show');
    clearTimeout(pane._zoomBadgeT);
    pane._zoomBadgeT = setTimeout(() => b.classList.remove('show'), 900);
  };
  pane.showDrmNote = () => {                          // a page asked for a DRM CDM Splitser doesn't have
    let n = pane._drmNote;
    if (!n) {
      n = document.createElement('div'); n.className = 'drm-note';
      n.innerHTML = '<span>&#128274; This site needs DRM video (Netflix, Disney+, Spotify…) that Splitser can\'t play. Open it in your main browser.</span><button class="drm-note-x" title="Dismiss">&#215;</button>';
      n.querySelector('.drm-note-x').addEventListener('click', () => { n.classList.remove('show'); if (pane.activeTab) pane.activeTab.drm = false; });
      pane.viewsBox.appendChild(n); pane._drmNote = n;
    }
    n.classList.add('show');
  };
  pane.syncDrmNote = () => {                          // keep the notice tied to the active tab
    if (pane.activeTab && pane.activeTab.drm) pane.showDrmNote();
    else if (pane._drmNote) pane._drmNote.classList.remove('show');
  };
  pane.showCertError = (info) => {                    // full-cover "your connection isn't private" interstitial
    let n = pane._certInt;
    if (!n) { n = document.createElement('div'); n.className = 'cert-interstitial'; pane.viewsBox.appendChild(n); pane._certInt = n; }
    const host = info.host || 'this site';
    n.innerHTML =
      '<div class="ci-box">' +
        '<div class="ci-icon">&#9888;&#65039;</div>' +
        '<div class="ci-h">Your connection isn\'t private</div>' +
        '<div class="ci-host">' + esc(host) + '</div>' +
        '<div class="ci-msg">' + esc(certErrText(info.error)) +
          ' Attackers could be trying to impersonate it or read what you send (passwords, messages, card details).</div>' +
        '<div class="ci-code">' + esc(info.error || '') + '</div>' +
        '<div class="ci-actions">' +
          '<button class="ci-back">&#8592; Back to safety</button>' +
          '<button class="ci-proceed">Proceed anyway (unsafe)</button>' +
        '</div>' +
      '</div>';
    n.querySelector('.ci-back').addEventListener('click', () => {
      if (pane.activeTab) pane.activeTab.certError = null;
      n.classList.remove('show');
      if (pane.view && pane.view.canGoBack()) pane.view.goBack(); else if (pane.view) pane.view.loadURL(SETTINGS.home);
    });
    n.querySelector('.ci-proceed').addEventListener('click', () => {
      const t = pane.activeTab, ci = t && t.certError; if (!ci) return;
      n.classList.remove('show');
      api.certProceed({ wcId: t.wcId, host: ci.host, url: ci.url });   // main trusts the host for this session + reloads
    });
    n.classList.add('show');
  };
  pane.syncCertError = () => {                        // keep the interstitial tied to the active tab
    if (pane.activeTab && pane.activeTab.certError) pane.showCertError(pane.activeTab.certError);
    else if (pane._certInt) pane._certInt.classList.remove('show');
  };
  pane.toggleMute = () => { const t = pane.activeTab; if (!t) return; t.muted = !t.muted; pane.view.setAudioMuted(t.muted); muteBtn.hidden = false; muteBtn.innerHTML = t.muted ? '&#128263;' : '&#128266;'; };
  pane.updateShield = (info) => {
    pane.shieldInfo = info;
    const on = info.globalOn && info.siteOn;
    shieldBtn.classList.toggle('down', !on);
    shieldBtn.querySelector('.shield-n').textContent = (on && info.count) ? (info.count > 99 ? '99+' : String(info.count)) : '';
    shieldBtn.title = (on ? 'Shields on — ' + (info.count || 0) + ' blocked' : 'Shields off') + (info.host ? ' · ' + info.host : '');
    if (shieldsPopPane === pane) renderShieldsPop(pane);
  };
  pane.refreshShield = async () => {
    const t = pane.activeTab;
    if (!t || !t.wcId) return pane.updateShield({ globalOn: true, siteOn: true, count: 0, host: '' });
    pane.updateShield(await api.shieldsGet(t.wcId));
  };
  pane.openShields = () => { closeShieldsPop(); if (pane.shieldInfo === undefined) pane.refreshShield(); renderShieldsPop(pane); };
  pane.updateLock = () => {                          // secure/insecure badge for the active tab's URL
    // getURL() THROWS if the webview isn't attached + dom-ready yet (e.g. every pane during session
    // restore). updateLock is called synchronously from switchTab, so an unguarded throw here aborts the
    // whole restore loop and wipes the session. Never let it propagate.
    let url = ''; try { url = pane.view ? pane.view.getURL() : ''; } catch (e) { url = ''; }
    const st = siteSecurity(url);
    const b = pane.lockBtn; if (!b) return;
    if (!st) { b.hidden = true; b.classList.remove('secure', 'insecure'); return; }
    b.hidden = false;
    b.classList.toggle('secure', st === 'secure'); b.classList.toggle('insecure', st === 'insecure');
    b.innerHTML = st === 'secure' ? '&#128274;' : '&#9888;';
    b.title = st === 'secure' ? 'Secure (HTTPS) -- click for the certificate' : 'Not secure -- no HTTPS. Click for details';
  };

  // ---- toolbar handlers (all operate on the ACTIVE tab via pane.view) ----
  let sugTimer;
  addr.addEventListener('input', () => { clearTimeout(sugTimer); const q = addr.value; if (!q) return hideSuggest(pane); sugTimer = setTimeout(async () => { if (document.activeElement !== addr) return; pane.sugs = await api.historyQuery(q); renderSuggest(pane); }, 110); });
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(pane, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(pane, -1); }
    else if (e.key === 'Enter') { const chosen = pane.sugIdx >= 0 && pane.sugs[pane.sugIdx] ? pane.sugs[pane.sugIdx].url : normalize(addr.value); hideSuggest(pane); if (chosen && pane.view) pane.view.loadURL(chosen); if (pane.view) pane.view.focus(); }
    else if (e.key === 'Escape') { hideSuggest(pane); }
  });
  addr.addEventListener('focus', () => { activePane = pane; markActive(); addr.select(); });
  addr.addEventListener('blur', () => setTimeout(() => hideSuggest(pane), 160));
  suggest.addEventListener('mousedown', (e) => { const item = e.target.closest('.sug'); if (!item) return; e.preventDefault(); hideSuggest(pane); if (pane.view) pane.view.loadURL(item.dataset.url); });
  el.addEventListener('mousedown', () => { activePane = pane; markActive(); }, true);
  el.querySelector('.back').addEventListener('click', () => { if (pane.view && pane.view.canGoBack()) pane.view.goBack(); });
  el.querySelector('.fwd').addEventListener('click', () => { if (pane.view && pane.view.canGoForward()) pane.view.goForward(); });
  el.querySelector('.back').addEventListener('contextmenu', (e) => { e.preventDefault(); activePane = pane; markActive(); openNavHistory(pane, -1, e.currentTarget); });
  el.querySelector('.fwd').addEventListener('contextmenu', (e) => { e.preventDefault(); activePane = pane; markActive(); openNavHistory(pane, 1, e.currentTarget); });
  el.querySelector('.reload').addEventListener('click', () => pane.view && pane.view.reload());
  el.querySelector('.split').addEventListener('click', () => { const p = makePane(SETTINGS.home, el.nextElementSibling); rebuildGutters(); saveSession(); p.addr.focus(); });
  el.querySelector('.close').addEventListener('click', () => requestClosePane(pane));
  star.addEventListener('click', pane.toggleBookmark);
  keyBtn.addEventListener('click', () => Vault.fillPane(pane));
  fav.addEventListener('click', (e) => { e.stopPropagation(); openFavPicker(pane); });   // set a custom icon (localhost etc.)
  shieldBtn.addEventListener('click', (e) => { e.stopPropagation(); pane.openShields(); });
  lockBtn.addEventListener('click', (e) => { e.stopPropagation(); openCertPopover(pane); });
  muteBtn.addEventListener('click', pane.toggleMute);
  findInput.addEventListener('input', () => { if (!pane.view) return; if (findInput.value) pane.view.findInPage(findInput.value); else { pane.view.stopFindInPage('clearSelection'); findCount.textContent = ''; } });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (findInput.value && pane.view) pane.view.findInPage(findInput.value, { findNext: true, forward: !e.shiftKey }); } else if (e.key === 'Escape') { e.preventDefault(); pane.closeFind(); } });
  el.querySelector('.find-prev').addEventListener('click', () => { if (findInput.value && pane.view) pane.view.findInPage(findInput.value, { findNext: true, forward: false }); });
  el.querySelector('.find-next').addEventListener('click', () => { if (findInput.value && pane.view) pane.view.findInPage(findInput.value, { findNext: true, forward: true }); });
  el.querySelector('.find-close').addEventListener('click', () => pane.closeFind());

  // ---- tab strip ----
  tabstrip.querySelector('.newtab').addEventListener('click', () => { activePane = pane; addTab(pane, SETTINGS.home); addr.focus(); });
  tabstrip.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.tabclose');
    const tabEl = e.target.closest('.tab'); if (!tabEl) return;
    const t = pane.tabs.find((x) => x.tabEl === tabEl); if (!t) return;
    if (closeBtn) { e.stopPropagation(); closeTab(pane, t); }
    else if (t !== pane.activeTab) { activePane = pane; switchTab(pane, t); }
  });
  tabstrip.addEventListener('contextmenu', (e) => {   // right-click a tab -> pick a colour for its site
    const tabEl = e.target.closest('.tab'); if (!tabEl) return;
    e.preventDefault();
    const t = pane.tabs.find((x) => x.tabEl === tabEl); if (t) openTabColorPicker(pane, t, tabEl);
  });

  (tabUrls && tabUrls.length ? tabUrls : [url]).forEach((u) => addTab(pane, u));
  return pane;
}

// Injected INTO a webview (via executeJavaScript) when it loads a local .md file: renders the
// markdown readably and adds a Rendered/Raw toggle. Self-contained -- must not reference outer scope.
function mdViewerInject() {
  if (window.__mdRendered) return;
  const pre = document.querySelector('body > pre');
  const raw = pre ? pre.textContent : (document.body ? document.body.innerText : '');
  if (raw == null || !document.body) return;
  window.__mdRendered = true;
  // Escapes quotes too, not just & < >: this renders markdown into document.documentElement.innerHTML,
  // and inl() below builds <a href="URL"> from the link target AFTER esc runs -- so an unescaped " in a
  // link URL would break out of the href attribute. This is a SEPARATE escaper from the top-level esc()
  // (this function is stringified and injected, so it can't reference outer scope) -- review #1.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inl = (s) => s
    .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  const md = (src) => {
    const L = src.split('\n'); const o = []; let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (/^```/.test(l)) { const c = []; i++; while (i < L.length && !/^```/.test(L[i])) { c.push(L[i]); i++; } i++; o.push('<pre class="cb"><code>' + esc(c.join('\n')) + '</code></pre>'); continue; }
      const h = l.match(/^(#{1,6})\s+(.*)/); if (h) { o.push('<h' + h[1].length + '>' + inl(esc(h[2])) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { o.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(l)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) { b.push(L[i].replace(/^>\s?/, '')); i++; } o.push('<blockquote>' + inl(esc(b.join(' '))) + '</blockquote>'); continue; }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) { const ord = /^\s*\d+\./.test(l); const it = []; while (i < L.length && /^\s*([-*+]|\d+\.)\s+/.test(L[i])) { it.push('<li>' + inl(esc(L[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))) + '</li>'); i++; } o.push('<' + (ord ? 'ol' : 'ul') + '>' + it.join('') + '</' + (ord ? 'ol' : 'ul') + '>'); continue; }
      if (/^\s*$/.test(l)) { i++; continue; }
      const p = []; while (i < L.length && !/^\s*$/.test(L[i]) && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(L[i])) { p.push(L[i]); i++; } o.push('<p>' + inl(esc(p.join(' '))) + '</p>');
    }
    return o.join('\n');
  };
  const css = ':root{color-scheme:dark}body{margin:0;background:#0e1418;color:#e7e3d6;font:15px/1.65 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}' +
    '#mdbar{position:sticky;top:0;display:flex;justify-content:flex-end;padding:8px 12px;background:#12181d;border-bottom:1px solid #26303a}' +
    '#mdtoggle{background:#1a2129;color:#e7e3d6;border:1px solid #2d3a45;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer}' +
    '#mdtoggle:hover{border-color:#5fe08a}' +
    '#mdview{max-width:820px;margin:0 auto;padding:28px 28px 60px}' +
    '#mdview h1,#mdview h2,#mdview h3,#mdview h4{line-height:1.25;margin:1.4em 0 .5em}' +
    '#mdview h1{font-size:2em;border-bottom:1px solid #26303a;padding-bottom:.3em}#mdview h2{font-size:1.5em;border-bottom:1px solid #26303a;padding-bottom:.3em}' +
    '#mdview a{color:#5fe08a}#mdview code{background:#1a2129;padding:.15em .4em;border-radius:4px;font-size:.9em;font-family:ui-monospace,Menlo,Consolas,monospace}' +
    '#mdview pre.cb{background:#0b1013;border:1px solid #26303a;border-radius:8px;padding:14px 16px;overflow:auto}#mdview pre.cb code{background:none;padding:0}' +
    '#mdview blockquote{border-left:3px solid #5fe08a;margin:1em 0;padding:.2em 1em;color:#aab6c0}#mdview ul,#mdview ol{padding-left:1.6em}' +
    '#mdview hr{border:0;border-top:1px solid #26303a;margin:1.6em 0}#mdview img{max-width:100%}' +
    '#mdraw{max-width:820px;margin:0 auto;padding:24px 28px 60px;white-space:pre-wrap;word-wrap:break-word;color:#cfd8e0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}';
  document.documentElement.innerHTML = '<head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<div id="mdbar"><button id="mdtoggle">View raw</button></div>' +
    '<article id="mdview">' + md(raw) + '</article>' +
    '<pre id="mdraw" style="display:none">' + esc(raw) + '</pre></body>';
  const tog = document.getElementById('mdtoggle'), v = document.getElementById('mdview'), r = document.getElementById('mdraw');
  let rendered = true;
  tog.onclick = () => { rendered = !rendered; v.style.display = rendered ? '' : 'none'; r.style.display = rendered ? 'none' : 'block'; tog.textContent = rendered ? 'View raw' : 'View rendered'; };
}
// Injected into a webview that loaded a raw text/plain document (a .txt, a log, SHA256SUMS, etc.):
// the browser's built-in plain-text view uses its own stylesheet and comes out unreadable in a dark
// context. Self-gates on contentType so it no-ops on real HTML/PDF/images. Colours match the .md viewer.
function plainTextThemeInject() {
  if (document.contentType !== 'text/plain') return;
  if (window.__ptThemed) return; window.__ptThemed = true;
  var st = document.createElement('style');
  st.textContent = ':root{color-scheme:dark}html,body{background:#0e1418!important;margin:0!important}' +
    'pre,body{color:#e7e3d6!important}' +
    'pre{white-space:pre-wrap!important;word-wrap:break-word!important;padding:22px 26px!important;' +
    'font:13px/1.6 ui-monospace,Menlo,Consolas,monospace!important;tab-size:4}';
  (document.head || document.documentElement).appendChild(st);
}
// Open a finished download INSIDE Splitser (a new tab) for anything we can render; hand the rest to
// the OS. Fixes "saved a .md, clicked Open, and it opened in Brave" -- renderable files stay in-app.
function openDownloadedFile(path) {
  if (/\.(md|markdown|txt|text|log|csv|tsv|json|xml|ya?ml|ini|conf|cfg|pdf|html?|png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(path)) {
    const p = active() || panes[0];
    if (p) { activePane = p; addTab(p, 'file://' + encodeURI(path)); markActive(); return; }
  }
  api.openDownload(path);   // .deb / .rpm / .exe / .zip / ... -> OS default app
}
// one tab = one live <webview>; background tabs stay alive (display:none, not destroyed)
function addTab(pane, url) {
  const view = document.createElement('webview');
  view.className = 'view';
  view.setAttribute('partition', pane.incognito ? 'split-incognito' : 'persist:split');   // ephemeral in private workspaces
  view.setAttribute('allowpopups', '');
  pane.viewsBox.appendChild(view);
  view.setAttribute('src', url || SETTINGS.home);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = '<i class="tabclr"></i><img class="tabfav" alt="" hidden /><span class="tabtitle">New tab</span><button class="tabclose" title="Close tab">&#215;</button>';
  pane.tabstrip.insertBefore(tabEl, pane.tabstrip.querySelector('.newtab'));

  const tab = { view, tabEl, title: 'New tab', favicon: '', realFavicon: '', url: url || '', zoom: 1, muted: false, loading: false, audio: false };
  const tclr = tabEl.querySelector('.tabclr');
  const tfav = tabEl.querySelector('.tabfav');
  const ttitle = tabEl.querySelector('.tabtitle');
  const active = () => pane.activeTab === tab;
  const syncColor = () => {   // per-tab colour dot: a manual per-host override, else an auto hue from the domain
    const c = tabColorFor(favHost(tab.url || view.getURL()));
    tclr.style.background = c || 'transparent'; tclr.hidden = !c;
  };
  tab.syncColor = syncColor;
  const syncFav = () => {   // a per-host custom icon (favOverrides) wins; else the page's own; else none
    const ov = favOv(favHost(tab.url || view.getURL()));
    tab.favicon = ov || tab.realFavicon || '';
    if (tab.favicon) { tfav.src = tab.favicon; tfav.hidden = false; } else { tfav.removeAttribute('src'); tfav.hidden = true; }
    if (active()) { setPaneFav(pane, tab.favicon); renderSetbar(); }
    syncColor();
  };
  tab.syncFav = syncFav;

  view.addEventListener('did-navigate', () => { tab.url = view.getURL(); tab.realFavicon = ''; tab.drm = isDrmHost(tab.url); tab.certError = null; if (tab.settled) flagUnseen(pane, tab); tab.settled = false; syncFav(); if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); pane.syncDrmNote(); pane.syncCertError(); pane.updateLock(); } saveSession(); });
  view.addEventListener('did-navigate-in-page', () => { tab.url = view.getURL(); if (active()) pane.syncAddr(); });
  view.addEventListener('dom-ready', () => { try { tab.wcId = view.getWebContentsId(); } catch (e) { /* not attached yet */ } if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); pane.refreshShield(); } });
  view.addEventListener('did-start-loading', () => { tab.loading = true; tab.drm = false; try { tab.wcId = view.getWebContentsId(); } catch (e) { /* not attached yet */ } tab.certError = null; tabEl.classList.add('loading'); if (active()) { pane.spin.hidden = false; pane.syncDrmNote(); pane.syncCertError(); } });
  view.addEventListener('did-stop-loading', () => { tab.loading = false; tab.settled = true; tabEl.classList.remove('loading'); if (active()) { pane.spin.hidden = true; pane.syncAddr(); } const u = view.getURL(); if (/^https?:/.test(u) && !pane.incognito) api.historyAdd({ url: u, title: tab.title });
    if (/^file:\/\/.*\.(md|markdown)(\?|#|$)/i.test(u)) view.executeJavaScript('(' + mdViewerInject.toString() + ')()').catch(() => {});   // render local markdown
    else if (/^file:\/\//i.test(u) || /\.(txt|text|log|csv|tsv|json|xml|ya?ml|ini|conf|cfg|md5|sha\d*sums?)(\?|#|$)/i.test(u)) view.executeJavaScript('(' + plainTextThemeInject.toString() + ')()').catch(() => {}); });   // make raw text/plain readable
  view.addEventListener('page-title-updated', (e) => { tab.title = e.title || tab.url; ttitle.textContent = tab.title; tabEl.title = tab.title; if (active()) updateTitle(); if (tab.settled) flagUnseen(pane, tab); });
  view.addEventListener('page-favicon-updated', (e) => { const f = (e.favicons || [])[0]; if (f) tab.realFavicon = f; syncFav(); });
  view.addEventListener('update-target-url', (e) => { hoverEl.textContent = e.url || ''; });
  view.addEventListener('found-in-page', (e) => { if (active()) { const r = e.result; pane.findCount.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : 'no matches'; } });
  view.addEventListener('media-started-playing', () => { tab.audio = true; if (active()) pane.muteBtn.hidden = false; });
  view.addEventListener('ipc-message', (e) => {                               // signals from the webview preload
    if (e.channel === 'vault:capture') Vault.offerSave(pane, e.args[0]);       // login submitted -> "save this?"
    else if (e.channel === 'vault:loginfocus') Vault.offerFill(pane, e.args[0]); // login field focused -> "prefill?"
    else if (e.channel === 'vault:newpw') Vault.offerSuggest(pane, e.args[0]);   // new-password field -> "suggest a strong one"
    else if (e.channel === 'vault:loginblur') Vault.hideFill(pane);
    else if (e.channel === 'pane-active') { activePane = pane; markActive(); closeCertPop(); closeShieldsPop(); closeFavPicker(); closeNavHistPop(); }   // clicked into a pane -> focus it + dismiss host popovers (webview clicks never reach the document's outside-close)
    else if (e.channel === 'zoom-wheel') { pane.setZoom(pane.zoom + ((e.args && e.args[0]) > 0 ? 0.1 : -0.1)); }   // Ctrl+scroll zoom
  });
  tfav.addEventListener('error', () => { tfav.hidden = true; });

  syncFav();   // apply a custom icon immediately (e.g. a restored localhost tab)
  pane.tabs.push(tab);
  pane.el.classList.toggle('multitab', pane.tabs.length > 1);
  switchTab(pane, tab);
  updateInfo();
  return tab;
}

// "Inspect in a new tab": open a fresh tab in `pane` and use ITS WebContents as the host that
// renders `targetWcId`'s DevTools (main wires it via setDevToolsWebContents). The host must not
// have navigated before wiring, so attach as soon as the blank host reports a WebContents id.
function openDevtoolsTab(pane, targetWcId, x, y) {
  const t = addTab(pane, 'about:blank');
  t.isDevtools = true; t.devtoolsTarget = targetWcId; t.title = 'DevTools';
  const label = t.tabEl.querySelector('.tabtitle'); if (label) label.textContent = 'DevTools';
  t.tabEl.title = 'DevTools'; t.tabEl.classList.add('devtools-tab');
  const wire = () => {
    let hostId; try { hostId = t.view.getWebContentsId(); } catch (e) { return false; }
    if (hostId == null) return false;
    t.wcId = hostId;
    api.devtoolsAttach({ targetId: targetWcId, hostId, x, y });
    return true;
  };
  if (!wire()) t.view.addEventListener('dom-ready', function h() { t.view.removeEventListener('dom-ready', h); wire(); });
  return t;
}

function switchTab(pane, tab) {
  pane.tabs.forEach((t) => { t.view.style.display = (t === tab) ? '' : 'none'; t.tabEl.classList.toggle('on', t === tab); });
  pane.activeTab = tab;
  pane.addr.value = (tab.url && tab.url !== 'about:blank') ? tab.url : '';
  setPaneFav(pane, tab.favicon);
  pane.spin.hidden = !tab.loading;
  pane.muteBtn.hidden = !(tab.muted || tab.audio); pane.muteBtn.innerHTML = tab.muted ? '&#128263;' : '&#128266;';
  pane.findbar.hidden = true; pane.findCount.textContent = '';
  pane.refreshStar(); Vault.refreshPaneKey(pane); pane.refreshShield(); pane.syncDrmNote(); pane.syncCertError(); pane.updateLock(); updateTitle();
}

// Force-destroy a tab's guest WebContents on close. Detaching the <webview> from the DOM is
// SUPPOSED to destroy the guest, but an open DevTools pins it -- so the guest (renderer process,
// memory, timers, media) and its DevTools window both leak. We already track wcId (dom-ready /
// did-start-loading); tell main to destroy it outright. Call this before removing the element.
function teardownTab(tab) {
  if (!tab) return;
  rememberClosed(tab);   // record its URL for Ctrl+Shift+T before we destroy it
  if (tab.isDevtools && tab.devtoolsTarget != null && api.devtoolsClose) api.devtoolsClose(tab.devtoolsTarget);   // detach DevTools from the still-live target
  let id = tab.wcId;
  if (id == null) { try { id = tab.view.getWebContentsId(); } catch (e) { id = null; } }
  if (id != null && api.destroyWc) api.destroyWc(id);
}

// Recently-closed items, newest last: single tabs {type:'tab',url} and whole workspaces
// {type:'ws',spec}. Ctrl+Shift+T pops the newest -- a tab reopens into the active pane, a workspace
// reopens as a whole set (layout + panes + tabs), like a browser reopening a closed window.
const closedItems = [];
let suppressTabRecord = false;   // set while closing a whole set -- we record the SET, not each tab
function pushClosed(item) { closedItems.push(item); if (closedItems.length > 25) closedItems.shift(); }
// teardownTab runs on every tab close (closeTab / closePane / setPaneCount / closeSet), so recording
// here covers single-tab and pane closes. During a set close we suppress it (the set is recorded whole).
function rememberClosed(tab) {
  if (suppressTabRecord) return;
  try {
    const u = (tab.view && tab.view.getURL && tab.view.getURL()) || tab.url || '';
    if (!/^(https?|file):/.test(u)) return;
    pushClosed({ type: 'tab', url: u, title: tab.title || u });
  } catch (e) { /* never block a close */ }
}
function reopenClosed() {
  const item = closedItems.pop();
  if (!item) return;
  if (item.type === 'ws') { openWorkspaceBookmark(item.spec); return; }   // restore the whole workspace as a new set
  const pane = active() || panes[0];
  if (!pane) return;
  activePane = pane; addTab(pane, item.url); markActive();
}

function closeTab(pane, tab) {
  if (pane.tabs.length <= 1) { closePane(pane); return; }
  const i = pane.tabs.indexOf(tab);
  teardownTab(tab);
  tab.view.remove(); tab.tabEl.remove(); pane.tabs.splice(i, 1);
  pane.el.classList.toggle('multitab', pane.tabs.length > 1);
  if (pane.activeTab === tab) switchTab(pane, pane.tabs[Math.min(i, pane.tabs.length - 1)]);
  updateInfo(); saveSession();
}

// ---- autocomplete dropdown ----
function renderSuggest(pane) {
  if (!pane.sugs.length) return hideSuggest(pane);
  pane.sugIdx = -1;
  pane.el.querySelector('.suggest').innerHTML = pane.sugs.map((s, i) =>
    `<div class="sug" data-url="${s.url.replace(/"/g, '&quot;')}" data-i="${i}">` +
    `<span class="sug-t">${esc(s.title || s.url)}</span><span class="sug-u">${esc(s.url)}</span></div>`).join('');
  pane.el.querySelector('.suggest').hidden = false;
}
function moveSuggest(pane, d) {
  const box = pane.el.querySelector('.suggest'); if (box.hidden) return;
  pane.sugIdx = Math.max(-1, Math.min(pane.sugs.length - 1, pane.sugIdx + d));
  box.querySelectorAll('.sug').forEach((el, i) => el.classList.toggle('sel', i === pane.sugIdx));
}
function hideSuggest(pane) { const b = pane.el.querySelector('.suggest'); b.hidden = true; b.innerHTML = ''; pane.sugIdx = -1; }
// Escapes & < > AND both quote characters, so esc() is safe in an attribute value as well as in text
// content. There is deliberately only ONE escaper: a separate attribute-only variant is a footgun (the
// unsafe one always ends up with the shorter name and gets reached for by habit -- security review #1).
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Dedicated streaming services whose video is DRM-only (Widevine / PlayReady), which vanilla Electron
// can't decrypt. Flagged by host so a pane can explain why the video is blank (see pane.showDrmNote).
const DRM_HOSTS = ['netflix.com', 'disneyplus.com', 'hulu.com', 'max.com', 'hbomax.com', 'primevideo.com', 'spotify.com', 'peacocktv.com', 'paramountplus.com', 'crunchyroll.com', 'tv.apple.com', 'music.apple.com', 'hotstar.com', 'starz.com', 'sling.com', 'fubo.tv'];
function isDrmHost(u) {
  let h; try { h = new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return false; }
  return DRM_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

function closePane(pane) {
  if (panes.length <= 1) {                         // closing the only pane of a set...
    if (sets.length > 1) { closeSet(cur); return; }  // ...closes the set, if there are others
    pane.view.loadURL(SETTINGS.home); return;        // ...or just resets it (last pane of last set)
  }
  const i = panes.indexOf(pane);
  panes.splice(i, 1); pane.tabs.forEach(teardownTab); pane.el.remove();
  if (activePane === pane) activePane = panes[Math.min(i, panes.length - 1)] || null;
  if (cur.split) {                                   // in a split tree: drop the leaf, collapse its parent
    cur.split = st_removeLeaf(cur.split, pane);
    if (cur.split) applySplitTree(cur); else setLayout('cols', false);
  } else rebuildGutters();
  updateTitle(); saveSession();
}

function rebuildGutters() {
  if (currentLayout === 'splits') { if (cur && cur.split) applySplitTree(cur); return; }   // split-tree sets re-render themselves
  grid.querySelectorAll('.gutter').forEach((g) => g.remove());
  if (currentLayout === 'split12') { applySplit12(); return; }
  if (currentLayout !== 'cols') { applyGrid(currentLayout); return; }   // grids re-place + re-divide
  const paneEls = [...grid.querySelectorAll('.pane')];
  paneEls.forEach((pe, idx) => {
    if (idx < paneEls.length - 1) {
      const g = document.createElement('div'); g.className = 'gutter';
      grid.insertBefore(g, pe.nextSibling); g.addEventListener('mousedown', startDrag);
    }
  });
  updateInfo();
}

// ---- shields popover (per-site ad/tracker blocking) ----
let shieldsPopPane = null;
function closeShieldsPop() { document.querySelectorAll('.shields-pop').forEach((p) => p.remove()); shieldsPopPane = null; }
function renderShieldsPop(pane) {
  document.querySelectorAll('.shields-pop').forEach((p) => p.remove());
  shieldsPopPane = pane;
  const info = pane.shieldInfo || { globalOn: true, siteOn: true, count: 0, host: '' };
  const pop = document.createElement('div');
  pop.className = 'shields-pop';
  pop.innerHTML =
    '<div class="sp-h"><span class="sp-ic">&#128737;</span><b>Shields</b><span class="sp-host">' + esc(info.host || 'this page') + '</span></div>' +
    '<div class="sp-count"><b>' + (info.count || 0) + '</b> ads &amp; trackers blocked here</div>' +
    '<label class="sp-row"><span>Shields for this site</span><input type="checkbox" class="sp-site"' + (info.siteOn ? ' checked' : '') + (info.globalOn ? '' : ' disabled') + ' /></label>' +
    '<label class="sp-row"><span>Block on all sites</span><input type="checkbox" class="sp-all"' + (info.globalOn ? ' checked' : '') + ' /></label>';
  pane.el.appendChild(pop);
  const br = pane.shieldBtn.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left - 40, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 4) + 'px';
  pop.querySelector('.sp-site').onchange = async () => { await api.shieldsToggleSite(info.host); if (pane.view) pane.view.reload(); setTimeout(() => pane.refreshShield(), 400); };
  pop.querySelector('.sp-all').onchange = async () => { await api.shieldsToggleAll(); if (pane.view) pane.view.reload(); setTimeout(() => pane.refreshShield(), 400); };
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!pop.contains(e.target) && e.target !== pane.shieldBtn) { closeShieldsPop(); document.removeEventListener('mousedown', h); } }), 0);
}
function startDrag(e) {
  e.preventDefault();
  const g = e.currentTarget, leftEl = g.previousElementSibling, rightEl = g.nextElementSibling;
  if (!leftEl || !rightEl) return;
  const combinedPx = leftEl.offsetWidth + rightEl.offsetWidth;
  const combinedGrow = (parseFloat(leftEl.style.flexGrow) || 1) + (parseFloat(rightEl.style.flexGrow) || 1);
  const startX = e.clientX, startLeftPx = leftEl.offsetWidth;
  const shield = document.createElement('div'); shield.className = 'drag-shield'; document.body.appendChild(shield);
  const onMove = (ev) => {
    let leftPx = Math.max(90, Math.min(combinedPx - 90, startLeftPx + (ev.clientX - startX)));
    const ratio = leftPx / combinedPx;
    leftEl.style.flexGrow = (combinedGrow * ratio).toFixed(4);
    rightEl.style.flexGrow = (combinedGrow * (1 - ratio)).toFixed(4);
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
function updateTitle() { const p = active(); document.title = (p && p.title) ? p.title + ' — Splitser' : 'Splitser'; }
function curDims() {   // [cols, rows] of the current set's arrangement (cols mode = N columns × 1 row)
  if (currentLayout === 'cols') return [Math.max(1, panes.length), 1];
  return gridDims(currentLayout);
}
function updateGridBtn() {   // footer "Grid: C×R" label reflects the current arrangement
  if (!gridDimsEl) return;
  if (currentLayout === 'split12') { gridDimsEl.textContent = '1+2'; return; }
  const [C, R] = curDims(); gridDimsEl.textContent = C + '×' + R;
}
function updateInfo() {
  const [C, R] = curDims();
  const lay = currentLayout === 'split12' ? ' · 1+2' : (C === 1 && R === 1) ? '' : ' · ' + C + '×' + R;
  const setPart = sets.length > 1 ? 'set ' + (sets.indexOf(cur) + 1) + '/' + sets.length + ' · ' : '';
  infoEl.textContent = 'Splitser · ' + setPart + panes.length + (panes.length === 1 ? ' pane' : ' panes') + lay;
  updateGridBtn();
}

// ---- resizable grids: fr tracks separated by real 6px divider tracks, so CSS positions the
// dividers for us. Every internal gridline (both axes) is a draggable .gdiv; sizes persist. ----
function frLoad(key, n) {
  try { const a = JSON.parse(localStorage.getItem('fr-' + key) || 'null'); if (Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && x > 0)) return a; } catch (e) { /* ignore */ }
  return Array(n).fill(1);
}
function frSave(key, arr) { try { localStorage.setItem('fr-' + key, JSON.stringify(arr)); } catch (e) { /* ignore */ } }
function frTpl(arr) { return arr.map((f) => f.toFixed(4) + 'fr').join(' 6px '); }

function gridDims(mode) {   // 'g{C}x{R}' -> [cols, rows]; default 2×2
  const m = /^g(\d+)x(\d+)$/.exec(mode || ''); return m ? [+m[1], +m[2]] : [2, 2];
}
function applyGrid(mode) {
  const [C, R] = gridDims(mode);       // C columns × R rows (any shape up to 3×3)
  cur.gCols = frLoad(mode + '-c', C); cur.gRows = frLoad(mode + '-r', R);
  grid.style.gap = '0'; grid.style.gridAutoRows = '1fr';
  grid.style.gridTemplateColumns = frTpl(cur.gCols);
  grid.style.gridTemplateRows = frTpl(cur.gRows);
  panes.forEach((p, i) => { p.el.style.gridColumn = String((i % C) * 2 + 1); p.el.style.gridRow = String(Math.floor(i / C) * 2 + 1); });
  grid.querySelectorAll('.gdiv').forEach((d) => d.remove());
  for (let c = 0; c < C - 1; c++) { const d = document.createElement('div'); d.className = 'gdiv x'; d.style.gridColumn = String(c * 2 + 2); d.style.gridRow = '1 / -1'; d.addEventListener('mousedown', (e) => startGridDrag(e, 'x', c)); grid.appendChild(d); }
  for (let r = 0; r < R - 1; r++) { const d = document.createElement('div'); d.className = 'gdiv y'; d.style.gridRow = String(r * 2 + 2); d.style.gridColumn = '1 / -1'; d.addEventListener('mousedown', (e) => startGridDrag(e, 'y', r)); grid.appendChild(d); }
  // diagonal handles where a column divider crosses a row divider: drag to resize both axes at once
  for (let c = 0; c < C - 1; c++) for (let r = 0; r < R - 1; r++) { const d = document.createElement('div'); d.className = 'gdiv xy'; d.style.gridColumn = String(c * 2 + 2); d.style.gridRow = String(r * 2 + 2); d.addEventListener('mousedown', (e) => startGridDragXY(e, c, r)); grid.appendChild(d); }
  updateInfo();
}
// the Splitser-logo layout: one tall pane on the left + two stacked on the right (3 panes, asymmetric).
// Left spans both rows; the row divider lives only in the right column. Reuses the fr-track drag machinery.
function applySplit12() {
  cur.gCols = frLoad('split12-c', 2); cur.gRows = frLoad('split12-r', 2);
  grid.style.gap = '0'; grid.style.gridAutoRows = '';
  grid.style.gridTemplateColumns = frTpl(cur.gCols);   // 1fr 6px 1fr
  grid.style.gridTemplateRows = frTpl(cur.gRows);
  if (panes[0]) { panes[0].el.style.gridColumn = '1'; panes[0].el.style.gridRow = '1 / -1'; }
  if (panes[1]) { panes[1].el.style.gridColumn = '3'; panes[1].el.style.gridRow = '1'; }
  if (panes[2]) { panes[2].el.style.gridColumn = '3'; panes[2].el.style.gridRow = '3'; }
  grid.querySelectorAll('.gdiv').forEach((d) => d.remove());
  const vx = document.createElement('div'); vx.className = 'gdiv x'; vx.style.gridColumn = '2'; vx.style.gridRow = '1 / -1'; vx.addEventListener('mousedown', (e) => startGridDrag(e, 'x', 0)); grid.appendChild(vx);   // columns divider (full height)
  const hy = document.createElement('div'); hy.className = 'gdiv y'; hy.style.gridColumn = '3'; hy.style.gridRow = '2'; hy.addEventListener('mousedown', (e) => startGridDrag(e, 'y', 0)); grid.appendChild(hy);   // right-column row divider
  updateInfo();
}
function startGridDrag(e, axis, idx) {
  e.preventDefault();
  const box = cur.el, arr = axis === 'x' ? cur.gCols : cur.gRows;
  const span = (axis === 'x' ? box.clientWidth : box.clientHeight) - (arr.length - 1) * 6;
  const sumFr = arr.reduce((a, b) => a + b, 0);
  const frPx = span / sumFr;                    // px per 1fr (constant during a drag)
  const minFr = Math.min(90 / frPx, (arr[idx] + arr[idx + 1]) / 2);
  const start = axis === 'x' ? e.clientX : e.clientY;
  const a0 = arr[idx], combined = arr[idx] + arr[idx + 1];
  const shield = document.createElement('div'); shield.className = 'drag-shield'; shield.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'; document.body.appendChild(shield);
  const onMove = (ev) => {
    const d = ((axis === 'x' ? ev.clientX : ev.clientY) - start) / frPx;
    arr[idx] = Math.max(minFr, Math.min(combined - minFr, a0 + d)); arr[idx + 1] = combined - arr[idx];
    if (axis === 'x') box.style.gridTemplateColumns = frTpl(cur.gCols); else box.style.gridTemplateRows = frTpl(cur.gRows);
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); frSave(cur.layout + (axis === 'x' ? '-c' : '-r'), arr); };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
// diagonal drag: the handle at (column-divider ci, row-divider ri) reproportions both axes at once
function startGridDragXY(e, ci, ri) {
  e.preventDefault();
  const box = cur.el;
  const axis = (arr, sizePx) => { const sum = arr.reduce((a, b) => a + b, 0); return { frPx: (sizePx - (arr.length - 1) * 6) / sum }; };
  const X = axis(cur.gCols, box.clientWidth), Y = axis(cur.gRows, box.clientHeight);
  const minX = Math.min(90 / X.frPx, (cur.gCols[ci] + cur.gCols[ci + 1]) / 2);
  const minY = Math.min(90 / Y.frPx, (cur.gRows[ri] + cur.gRows[ri + 1]) / 2);
  const sx = e.clientX, sy = e.clientY;
  const cx0 = cur.gCols[ci], combX = cur.gCols[ci] + cur.gCols[ci + 1];
  const cy0 = cur.gRows[ri], combY = cur.gRows[ri] + cur.gRows[ri + 1];
  const shield = document.createElement('div'); shield.className = 'drag-shield'; shield.style.cursor = 'move'; document.body.appendChild(shield);
  const onMove = (ev) => {
    cur.gCols[ci] = Math.max(minX, Math.min(combX - minX, cx0 + (ev.clientX - sx) / X.frPx)); cur.gCols[ci + 1] = combX - cur.gCols[ci];
    cur.gRows[ri] = Math.max(minY, Math.min(combY - minY, cy0 + (ev.clientY - sy) / Y.frPx)); cur.gRows[ri + 1] = combY - cur.gRows[ri];
    box.style.gridTemplateColumns = frTpl(cur.gCols);
    box.style.gridTemplateRows = frTpl(cur.gRows);
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); frSave(cur.layout + '-c', cur.gCols); frSave(cur.layout + '-r', cur.gRows); };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}

// add/remove panes so the current set has exactly `n` (trims from the end, never below 1).
function setPaneCount(n) {
  while (panes.length < n) makePane(SETTINGS.home);
  while (panes.length > n && panes.length > 1) {
    const p = panes.pop(); p.tabs.forEach(teardownTab); p.el.remove();
    if (activePane === p) activePane = panes[panes.length - 1] || null;
  }
}
// layout: 'cols' (resizable columns, 1 row) | 'g{C}x{R}' (grid up to 3×3). `fill` sets the pane
// count to the grid's cells. Operates on the CURRENT set. `save=false` while building sets at boot.
function setLayout(mode, fill, save = true) {
  // choosing a legacy layout clears any split tree AND its overlay handles (else stray .splitdiv linger)
  if (cur) cur.split = null;
  if (grid) { grid.classList.remove('smode'); grid.querySelectorAll('.splitdiv').forEach((d) => d.remove()); }
  currentLayout = mode; if (cur) cur.layout = mode;
  if (fill) { if (mode === 'split12') setPaneCount(3); else if (mode !== 'cols') { const [C, R] = gridDims(mode); setPaneCount(C * R); } }
  [...grid.classList].filter((c) => c === 'gmode').forEach((c) => grid.classList.remove(c));
  if (mode === 'cols') {
    grid.style.gridTemplateColumns = ''; grid.style.gridTemplateRows = ''; grid.style.gap = ''; grid.style.gridAutoRows = '';
    grid.querySelectorAll('.gdiv').forEach((d) => d.remove());
    panes.forEach((p) => { p.el.style.gridColumn = ''; p.el.style.gridRow = ''; p.el.style.flexGrow = '1'; });
    rebuildGutters();
  } else {
    grid.querySelectorAll('.gutter').forEach((g) => g.remove());
    grid.classList.add('gmode');
    if (mode === 'split12') applySplit12(); else applyGrid(mode);
  }
  updateGridBtn(); markActive();
  if (save) saveSession();
}

// ---- Per-pane directional splits (Terminator-style). A binary split tree per set (s.split; null = legacy
// cols/grid). Rendered by computing each pane's CSS GRID AREA, so panes stay DIRECT children of .gridset and
// never re-parent -- re-parenting a <webview> reloads its page (verified via spike), which we must avoid.
// Node: leaf {pane} | split {dir:'row'|'col', ratio, a, b}. 'row' = side by side (new pane RIGHT); 'col' =
// stacked (new pane BELOW). ----
function st_replaceLeaf(node, pane, repl) {
  if (node.pane) return node.pane === pane ? repl : node;
  return { dir: node.dir, ratio: node.ratio, a: st_replaceLeaf(node.a, pane, repl), b: st_replaceLeaf(node.b, pane, repl) };
}
function st_removeLeaf(node, pane) {   // collapse: the sibling replaces the parent split; null only if node IS the leaf
  if (node.pane) return node.pane === pane ? null : node;
  const a = st_removeLeaf(node.a, pane); if (a === null) return node.b;
  const b = st_removeLeaf(node.b, pane); if (b === null) return node.a;
  return { dir: node.dir, ratio: node.ratio, a, b };
}
function st_rects(node, x0, y0, x1, y1, out, divs) {
  if (node.pane) { out.push({ pane: node.pane, x0, y0, x1, y1 }); return; }
  if (node.dir === 'row') { const xm = x0 + node.ratio * (x1 - x0);
    if (divs) divs.push({ node, dir: 'row', pos: xm, x0, x1, y0, y1 });
    st_rects(node.a, x0, y0, xm, y1, out, divs); st_rects(node.b, xm, y0, x1, y1, out, divs);
  } else { const ym = y0 + node.ratio * (y1 - y0);
    if (divs) divs.push({ node, dir: 'col', pos: ym, x0, x1, y0, y1 });
    st_rects(node.a, x0, y0, x1, ym, out, divs); st_rects(node.b, x0, ym, x1, y1, out, divs);
  }
}
function applySplitTree(s) {
  const g = s.el;
  g.querySelectorAll('.gutter, .gdiv, .splitdiv').forEach((x) => x.remove());
  g.classList.remove('gmode'); g.classList.add('smode');
  const rects = [], divs = []; st_rects(s.split, 0, 0, 1, 1, rects, divs);
  const R = (v) => Math.round(v * 10000) / 10000;
  const xs = [...new Set(rects.flatMap((r) => [R(r.x0), R(r.x1)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [R(r.y0), R(r.y1)]))].sort((a, b) => a - b);
  g.style.gridTemplateColumns = xs.slice(1).map((x, i) => (x - xs[i]).toFixed(4) + 'fr').join(' ');
  g.style.gridTemplateRows = ys.slice(1).map((y, i) => (y - ys[i]).toFixed(4) + 'fr').join(' ');
  g.style.gap = '0'; g.style.gridAutoRows = '';
  rects.forEach((r) => {
    const el = r.pane.el;
    el.style.flex = ''; el.style.minWidth = '0'; el.style.minHeight = '0';
    el.style.gridColumn = (xs.indexOf(R(r.x0)) + 1) + ' / ' + (xs.indexOf(R(r.x1)) + 1);
    el.style.gridRow = (ys.indexOf(R(r.y0)) + 1) + ' / ' + (ys.indexOf(R(r.y1)) + 1);
  });
  divs.forEach((d) => {                                // draggable handle at each split boundary
    const el = document.createElement('div'); el.className = 'splitdiv ' + d.dir;
    if (d.dir === 'row') { el.style.left = (d.pos * 100) + '%'; el.style.top = (d.y0 * 100) + '%'; el.style.height = ((d.y1 - d.y0) * 100) + '%'; }
    else { el.style.top = (d.pos * 100) + '%'; el.style.left = (d.x0 * 100) + '%'; el.style.width = ((d.x1 - d.x0) * 100) + '%'; }
    el.addEventListener('mousedown', (e) => startSplitDrag(e, s, d));
    g.appendChild(el);
  });
  // diagonal handles: where a vertical (row) and horizontal (col) divider meet, drag resizes BOTH axes
  const rowD = divs.filter((d) => d.dir === 'row'), colD = divs.filter((d) => d.dir === 'col'), seen = new Set();
  rowD.forEach((rd) => colD.forEach((cd) => {
    const x = rd.pos, y = cd.pos, E = 1e-4;
    if (x < cd.x0 - E || x > cd.x1 + E || y < rd.y0 - E || y > rd.y1 + E) return;   // lines don't meet here
    const kk = R(x) + ',' + R(y); if (seen.has(kk)) return; seen.add(kk);
    const rowsAt = rowD.filter((d) => Math.abs(d.pos - x) < E && y >= d.y0 - E && y <= d.y1 + E);   // all verticals through the point
    const colsAt = colD.filter((d) => Math.abs(d.pos - y) < E && x >= d.x0 - E && x <= d.x1 + E);   // all horizontals through the point
    const el = document.createElement('div'); el.className = 'splitdiv xy';
    el.style.left = (x * 100) + '%'; el.style.top = (y * 100) + '%';
    el.addEventListener('mousedown', (e) => startSplitDragXY(e, s, rowsAt, colsAt));
    g.appendChild(el);
  }));
  s.layout = 'splits'; if (s === cur) currentLayout = 'splits';
  updateInfo();
}
function startSplitDrag(e, s, d) {
  e.preventDefault();
  const shield = document.createElement('div'); shield.className = 'drag-shield'; shield.style.cursor = d.dir === 'row' ? 'col-resize' : 'row-resize'; document.body.appendChild(shield);
  const onMove = (ev) => {
    const r = s.el.getBoundingClientRect();
    if (d.dir === 'row') { const mx = (ev.clientX - r.left) / r.width; d.node.ratio = Math.max(0.05, Math.min(0.95, (mx - d.x0) / (d.x1 - d.x0))); }
    else { const my = (ev.clientY - r.top) / r.height; d.node.ratio = Math.max(0.05, Math.min(0.95, (my - d.y0) / (d.y1 - d.y0))); }
    applySplitTree(s);   // grid-area recompute -- panes don't reload
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); saveSession(); };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
function startSplitDragXY(e, s, rows, cols) {   // drag an intersection -> resize both axes at once
  e.preventDefault();
  const shield = document.createElement('div'); shield.className = 'drag-shield'; shield.style.cursor = 'move'; document.body.appendChild(shield);
  const onMove = (ev) => {
    const r = s.el.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width, my = (ev.clientY - r.top) / r.height;
    rows.forEach((d) => { d.node.ratio = Math.max(0.05, Math.min(0.95, (mx - d.x0) / (d.x1 - d.x0))); });
    cols.forEach((d) => { d.node.ratio = Math.max(0.05, Math.min(0.95, (my - d.y0) / (d.y1 - d.y0))); });
    applySplitTree(s);
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); saveSession(); };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
function st_rowTree(ps) { return ps.length === 1 ? { pane: ps[0] } : { dir: 'row', ratio: 1 / ps.length, a: { pane: ps[0] }, b: st_rowTree(ps.slice(1)) }; }
function st_colTree(ns) { return ns.length === 1 ? ns[0] : { dir: 'col', ratio: 1 / ns.length, a: ns[0], b: st_colTree(ns.slice(1)) }; }
function legacyToTree(s) {   // build a tree matching the set's current legacy arrangement, so a split preserves it
  const ps = s.panes;
  if (ps.length === 1) return { pane: ps[0] };
  if (s.layout === 'split12' && ps.length === 3) return { dir: 'row', ratio: 0.5, a: { pane: ps[0] }, b: { dir: 'col', ratio: 0.5, a: { pane: ps[1] }, b: { pane: ps[2] } } };
  const gm = /^g(\d+)x(\d+)$/.exec(s.layout || '');
  if (gm) { const C = +gm[1]; const rows = []; for (let i = 0; i < ps.length; i += C) rows.push(st_rowTree(ps.slice(i, i + C))); return st_colTree(rows); }
  return st_rowTree(ps);   // cols (and anything else) -> a single row
}
function splitFocused(dir) {   // 'row' = new pane to the RIGHT of focused; 'col' = new pane BELOW
  const p = active(); if (!p) return;
  if (!cur.split) cur.split = legacyToTree(cur);
  const np = makePane(SETTINGS.home);   // direct child of grid + pushed to panes[]; applySplitTree places it
  cur.split = st_replaceLeaf(cur.split, p, { dir, ratio: 0.5, a: { pane: p }, b: { pane: np } });
  activePane = np; applySplitTree(cur); markActive(); np.addr.focus(); saveSession();
}
// session persistence: self-contained (leaves carry their own tab URLs) so pane indices never matter and
// old sessions (no `split` field) stay on the untouched legacy path.
function tabUrlSafe(t) { try { return t.view.getURL(); } catch { return ''; } }   // getURL throws on a detaching/not-ready webview
function serializeSplit(node) {
  if (node.pane) return { tabs: node.pane.tabs.map(tabUrlSafe).filter((u) => /^(https?|file):/.test(u)) };
  return { d: node.dir, r: node.ratio, a: serializeSplit(node.a), b: serializeSplit(node.b) };
}
function buildSplit(snode) {   // rebuild BOTH the tree and its panes from a serialized split (uses current-set mirrors)
  if (!snode) return null;
  if (snode.tabs !== undefined) { const tabs = Array.isArray(snode.tabs) ? snode.tabs : []; return { pane: makePane(tabs[0] || SETTINGS.home, null, tabs.length ? tabs : null) }; }
  const a = buildSplit(snode.a), b = buildSplit(snode.b);
  if (!a || !b) return a || b;                          // tolerate a malformed half rather than throw
  return { dir: snode.d === 'col' ? 'col' : 'row', ratio: (typeof snode.r === 'number' ? snode.r : 0.5), a, b };
}

// Ctrl+Shift+E / Ctrl+Shift+O: add a pane and orient the set. "Right" lays the panes out as horizontal
// columns (the new one sits to the right of the focused pane); "below" lays them out as a single vertical
// stack (1 column x N rows, the new one at the bottom). setLayout(mode, false) rearranges without changing
// the pane count. (True per-pane 2-D splits -- where only the focused pane splits -- are a separate feature.)
function openPaneRight() { splitFocused('row'); }   // Ctrl+Shift+E: new pane to the right of the focused pane
function openPaneBelow() { splitFocused('col'); }   // Ctrl+Shift+O: new pane below the focused pane

// ---- sets / workspaces: each set is its own grid; only the current one is shown, the rest
// stay in the DOM (display:none) so their webviews keep running. `cur` + the four mirrors are
// the current set; switchSet() re-points them. ----
function createSet() {
  const el = document.createElement('div'); el.className = 'gridset'; el.style.display = 'none';
  gridRoot.appendChild(el);
  const s = { el, panes: [], activePane: null, layout: 'cols', gCols: [], gRows: [], name: '', theme: null, incognito: false, unseen: 0 };
  sets.push(s); return s;
}
function bindCur(s) { cur = s; grid = s.el; panes = s.panes; activePane = s.activePane; currentLayout = s.layout; }
// a page changed in a workspace that isn't the one on screen -> count it on the pill until you visit it.
// Per-tab coalescing so a title-spamming page (a clock, a video timer) can't inflate the count.
const UNSEEN_COALESCE_MS = 2000;
function flagUnseen(pane, tab) {
  const s = pane && pane.set;
  if (!s || s === cur) return;
  const now = Date.now();
  if (tab && now - (tab._lastFlag || 0) < UNSEEN_COALESCE_MS) return;
  if (tab) tab._lastFlag = now;
  s.unseen = (s.unseen || 0) + 1;
  if (!document.querySelector('.setname-edit')) renderSetbar();   // don't clobber an in-progress rename
}
function switchWorkspace(dir) {   // Ctrl+Tab / Ctrl+Shift+Tab -- cycle workspaces with wraparound
  if (sets.length < 2) return;
  const i = sets.indexOf(cur);
  switchSet(sets[(i + dir + sets.length) % sets.length]);
  saveSession();
}

function switchSet(s) {
  if (!s) return;
  s.unseen = 0;                                        // visiting a workspace clears its badge
  if (cur) cur.activePane = activePane;                 // persist the mirror to the outgoing set
  bindCur(s);
  sets.forEach((x) => { x.el.style.display = (x === s) ? '' : 'none'; });
  Theme.use(cur.theme);                                 // each set carries its own look
  renderSetbar(); updateTitle(); updateInfo(); markActive();
}
// build a set from saved specs (array of per-pane tab-URL arrays) without saving mid-build
function buildSet(layout, paneSpecs, incognito) {
  const s = createSet(); s.incognito = !!incognito; bindCur(s);   // set incognito BEFORE makePane (panes read it)
  (paneSpecs && paneSpecs.length ? paneSpecs : [[SETTINGS.home], [SETTINGS.home]]).forEach((t) => makePane(t[0], null, t));
  activePane = s.activePane = panes[0];
  setLayout(layout || 'cols', false, false);
  return s;
}
function newSet() {
  if (cur) cur.activePane = activePane;
  const inherit = Theme.current();                      // start the new workspace with the current look
  const s = buildSet('cols', [[SETTINGS.home], [SETTINGS.home]]);
  s.theme = inherit;
  switchSet(s); saveSession();
  panes[0]?.addr.focus();
}
function newIncognitoSet() {   // a private workspace: ephemeral 'split-incognito' session, no history, not restored
  if (cur) cur.activePane = activePane;
  const s = buildSet('cols', [[SETTINGS.home], [SETTINGS.home]], true);
  switchSet(s); saveSession();
  panes[0]?.addr.focus();
}
function closeSet(s) {
  if (sets.length <= 1) return;
  const wasIncognito = s.incognito;
  // Record the whole workspace for Ctrl+Shift+T (unless private -- those are ephemeral). Built before
  // teardown so the tab URLs are still readable; suppress per-tab recording so we don't double-log.
  if (!wasIncognito) { const spec = setSpec(s); if (spec.panes.length) pushClosed({ type: 'ws', spec }); }
  suppressTabRecord = true;
  const i = sets.indexOf(s); s.panes.forEach((p) => p.tabs.forEach(teardownTab)); s.el.remove(); sets.splice(i, 1);
  suppressTabRecord = false;
  if (cur === s) { cur = null; switchSet(sets[Math.min(i, sets.length - 1)]); }
  else renderSetbar();
  if (wasIncognito && !sets.some((x) => x.incognito)) api.clearIncognito();   // last private workspace closed -> wipe
  saveSession();
}
// closing a workspace discards every pane + tab in it at once -- confirm first unless it's a lone single-tab pane
function requestCloseSet(s) {
  const tabs = s.panes.reduce((n, p) => n + p.tabs.length, 0);
  if (s.panes.length <= 1 && tabs <= 1) { closeSet(s); return; }
  const detail = s.panes.length > 1
    ? s.panes.length + ' panes' + (tabs > s.panes.length ? ' and ' + tabs + ' tabs' : '')
    : tabs + ' tabs';
  confirmDialog({
    title: 'Close "' + setName(s, sets.indexOf(s)) + '"?',
    body: 'This workspace has ' + detail + '. Closing it discards them all (Ctrl+Shift+T reopens it).',
    okLabel: 'Close workspace'
  }, () => closeSet(s));
}
// closing a pane discards its tabs (and closes the workspace if it's the last pane) -- confirm when it has 2+ tabs
function requestClosePane(pane) {
  const resetsOnly = panes.length <= 1 && sets.length <= 1;   // last pane of last set just reloads home -- not destructive
  if (resetsOnly || pane.tabs.length <= 1) { closePane(pane); return; }
  confirmDialog({
    title: 'Close this pane?',
    body: 'This pane has ' + pane.tabs.length + ' tabs. Closing it discards them all -- this cannot be undone.',
    okLabel: 'Close pane'
  }, () => closePane(pane));
}
// generic in-app confirm (styled like the auth dialog; NOT a blocking native confirm()). onOk runs on confirm.
function confirmDialog({ title, body, okLabel }, onOk) {
  document.querySelectorAll('.confirm-modal').forEach((m) => m.remove());
  const modal = document.createElement('div'); modal.className = 'auth-modal confirm-modal';
  modal.innerHTML = '<div class="auth-box">' +
    '<div class="auth-h">' + esc(title) + '</div>' +
    '<div class="auth-realm">' + esc(body) + '</div>' +
    '<div class="auth-row"><button class="auth-btn" id="cf-cancel">Cancel</button>' +
    '<button class="auth-btn danger" id="cf-ok">' + esc(okLabel || 'OK') + '</button></div></div>';
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  modal.querySelector('#cf-ok').onclick = () => { close(); onOk(); };
  modal.querySelector('#cf-cancel').onclick = close;
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });   // click the backdrop to cancel
  document.addEventListener('keydown', onKey);
  modal.querySelector('#cf-cancel').focus();                                           // safe default
}
function setName(s, i) {   // a workspace's label: user-set name, else its first site's host, else "Set N"
  if (s.name) return s.name;
  if (s.incognito) return 'Private';
  const p = s.panes[0];
  const h = p && p.activeTab ? favHost(p.activeTab.url || (p.activeTab.view && p.activeTab.view.getURL())) : '';
  return h || ('Set ' + (i + 1));
}
// the split-pane brand mark, inlined so it needs no file/CSP round-trip; sits where the label was
// the real Splitser logo (bundled renderer/logo.svg -- same mark as the app icon), top-left of the
// Workspaces bar; clicking it still applies the 1+2 layout.
const LOGO_SVG = '<img class="setbar-logo" src="logo.svg" width="20" height="20" alt="Splitser" title="Splitser -- click for the 1+2 layout" />';
function renderSetbar() {   // the "Workspaces" bar: named pills that wrap across rows (like the Split Screen ext)
  const pills = sets.map((s, i) => {
    const fav = s.panes.map((p) => p.activeTab && p.activeTab.favicon).find(Boolean);
    const name = setName(s, i);
    const n = s === cur ? 0 : (s.unseen || 0);            // changes since you last visited this workspace
    return '<span class="setpill' + (s === cur ? ' on' : '') + (s.incognito ? ' incognito' : '') + (n ? ' unseen' : '') + '" data-i="' + i + '" title="' + esc(name).replace(/"/g, '&quot;') + (s.incognito ? ' (private -- nothing saved)' : '') + (n ? ' -- ' + n + ' change' + (n === 1 ? '' : 's') + ' here' : '') + '">' +
      (s.incognito ? '<span class="setinc-ico">&#128374;</span>' : (fav ? '<img class="setfav" src="' + fav.replace(/"/g, '&quot;') + '" alt="" />' : '<span class="setfav-none">&#127760;</span>')) +
      (n ? '<span class="set-badge">' + (n > 99 ? '99+' : n) + '</span>' : '') +
      '<span class="setname">' + esc(name) + '</span>' +
      '<button class="setedit" data-i="' + i + '" title="Rename workspace">&#9998;</button>' +
      (sets.length > 1 ? '<button class="setclose" data-i="' + i + '" title="Close workspace">&#215;</button>' : '') +
      '</span>';
  }).join('');
  setbar.innerHTML = LOGO_SVG + pills +
    '<button class="setadd" title="New workspace (Ctrl+T)">+ Workspace</button>' +
    '<button class="setinc" title="New private workspace -- ephemeral, nothing saved (Ctrl+Shift+N)">&#128374;</button>';
}
function renameSet(s, pill) {
  const nameEl = pill.querySelector('.setname'); if (!nameEl) return;
  const input = document.createElement('input'); input.className = 'setname-edit';
  input.value = s.name || nameEl.textContent;
  nameEl.replaceWith(input); input.focus(); input.select();
  let done = false;
  const commit = (save) => { if (done) return; done = true; if (save) { s.name = input.value.trim(); saveSession(); } renderSetbar(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') commit(false); });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
let pillDragged = false;   // set by a reorder drag so the trailing click doesn't also switchSet
setbar.addEventListener('click', (e) => {
  if (pillDragged) { pillDragged = false; return; }   // a pill was just dragged -- swallow its click
  if (e.target.closest('.setbar-logo')) return setLayout('split12', true);   // the logo IS a layout -- apply it
  if (e.target.closest('.setinc')) return newIncognitoSet();
  if (e.target.closest('.setadd')) return newSet();
  const pill = e.target.closest('.setpill'); if (!pill) return;
  const i = +pill.dataset.i;
  if (e.target.closest('.setclose')) { e.stopPropagation(); requestCloseSet(sets[i]); }
  else if (e.target.closest('.setedit')) { e.stopPropagation(); renameSet(sets[i], pill); }
  else if (sets[i] !== cur) switchSet(sets[i]);
});
setbar.addEventListener('dblclick', (e) => {   // double-click a pill (not its × / ✎) to rename it inline
  const pill = e.target.closest('.setpill');
  if (pill && !e.target.closest('.setclose') && !e.target.closest('.setedit')) renameSet(sets[+pill.dataset.i], pill);
});

// ---- drag a workspace pill to reorder it. Pure setbar + sets-array reorder: it never touches a
// pane or <webview>, so page content can't be disturbed. Live preview by moving the pill's DOM node
// between slots (data-i stays put); on drop we rebuild `sets` from the DOM order and persist it. ----
function pillDropTarget(cx, cy, dragged) {   // the pill to insert BEFORE (null = after the last pill), honoring row-wrap
  for (const p of setbar.querySelectorAll('.setpill')) {
    if (p === dragged) continue;
    const r = p.getBoundingClientRect();
    if (cy < r.top) return p;                                    // cursor on an earlier row -> before this pill
    if (cy <= r.bottom && cx < r.left + r.width / 2) return p;   // same row, left of its middle -> before it
  }
  return null;                                                   // past the last pill -> drop at the end
}
setbar.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || sets.length < 2) return;
  const pill = e.target.closest('.setpill');
  if (!pill || e.target.closest('.setclose') || e.target.closest('.setedit') || setbar.querySelector('.setname-edit')) return;
  const sx = e.clientX, sy = e.clientY;
  let dragging = false, shield = null;
  const onMove = (ev) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;   // click threshold
      dragging = true; pill.classList.add('dragging');
      shield = document.createElement('div'); shield.className = 'drag-shield'; shield.style.cursor = 'grabbing';
      document.body.appendChild(shield);
    }
    const ref = pillDropTarget(ev.clientX, ev.clientY, pill);
    setbar.insertBefore(pill, ref || setbar.querySelector('.setadd'));   // live-move into the target slot
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    if (shield) shield.remove();
    if (!dragging) return;
    pill.classList.remove('dragging');
    const order = [...setbar.querySelectorAll('.setpill')].map((p) => sets[+p.dataset.i]).filter(Boolean);
    if (order.length === sets.length) { sets.length = 0; sets.push(...order); }   // rebuild sets from DOM order
    pillDragged = true;                 // swallow the click that fires right after this mouseup
    renderSetbar(); saveSession();      // re-emit correct data-i + persist the new order
  };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
});

// ---- session persistence ----
let sessTimer;
function saveSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    if (cur) cur.activePane = activePane;
    const persist = sets.filter((s) => !s.incognito);   // private workspaces are ephemeral -- never saved
    const data = {
      v: 2, active: Math.max(0, persist.indexOf(cur)),   // cur incognito -> indexOf -1 -> 0
      sets: persist.map((s) => {
        const o = {
          name: s.name || '',
          theme: s.theme || null,
          layout: s.layout,
          panes: s.panes.map((p) => p.tabs.map(tabUrlSafe).filter((u) => /^(https?|file):/.test(u))).filter((a) => a.length)
        };
        if (s.split) o.split = serializeSplit(s.split);   // per-pane split tree (self-contained). Flat `panes` stays as a safe fallback.
        return o;
      })
    };
    api.sessionSet(data);
  }, 700);
}

// ---- shortcuts (forwarded from main) ----
function handleShortcut(k) {
  const p = active();
  if (k === 'l') p?.addr.focus();
  else if (k === 't') newSet();                                                         // new SET (fresh grid); tabs open via the strip +
  else if (k === 'shift+t') reopenClosed();                                              // reopen the last closed tab / workspace
  else if (k === 'shift+n') newIncognitoSet();                                          // new PRIVATE workspace
  else if (k === 'w') { if (p && p.activeTab) closeTab(p, p.activeTab); }               // close TAB (last tab -> pane; last pane -> set)
  else if (k === 'r') p?.view.reload();
  else if (k === 'f') p?.openFind();
  else if (k === 'm') p?.toggleMute();
  else if (k === 'd') p?.toggleBookmark();
  else if (k === 'shift+d') bookmarkCurrentWorkspace();                                  // bookmark the whole workspace
  else if (k === 'k') Vault.togglePanel();
  else if (k === 'p') { try { p?.view.print(); } catch (e) { /* print may reject if the view isn't ready */ } }   // print the focused pane
  else if (k === '1') setLayout('cols', false);
  else if (k === '2') setLayout('g2x2', true);
  else if (k === '3') setLayout('g3x3', true);
  else if (k === 'shift+e') openPaneRight();                                             // new pane to the right (columns)
  else if (k === 'shift+o') openPaneBelow();                                             // new pane below (vertical stack)
  else if (k === '=' || k === '+') { if (p) p.setZoom(p.zoom + 0.1); }
  else if (k === '-') { if (p) p.setZoom(p.zoom - 0.1); }
  else if (k === '0') p?.setZoom(1);
  else if (k === 'tab') switchWorkspace(1);            // Ctrl+Tab -> next workspace (wraps to first)
  else if (k === 'shift+tab') switchWorkspace(-1);     // Ctrl+Shift+Tab -> previous workspace (wraps to last)
}
api.onShortcut(handleShortcut);
api.onOpenPane((url) => { const p = makePane(url, active() ? active().el.nextElementSibling : null); rebuildGutters(); saveSession(); activePane = p; });
// live shield counts: route to whichever pane's ACTIVE tab this webContents is
api.onShields((d) => { for (const s of sets) for (const p of s.panes) { if (p.activeTab && p.activeTab.wcId === d.wcId) { p.updateShield(d); return; } } });

// A page's TLS cert was rejected -> flag the tab and show the interstitial (if it's the visible one)
api.onCertError((d) => { for (const s of sets) for (const p of s.panes) for (const t of p.tabs) { if (t.wcId === d.wcId) { t.certError = d; if (p.activeTab === t) p.syncCertError(); return; } } });

// "Open link in new tab" from the context menu -> a tab in the pane that was right-clicked
api.onOpenTabIn((d) => { for (const s of sets) for (const p of s.panes) { if (p.activeTab && p.activeTab.wcId === d.wcId) { activePane = p; addTab(p, d.url); return; } } });
api.onOpenDevtoolsTab((d) => { for (const s of sets) for (const p of s.panes) { if (p.activeTab && p.activeTab.wcId === d.targetWcId) { activePane = p; openDevtoolsTab(p, d.targetWcId, d.x, d.y); return; } } });

// ---- Full-page screenshot: main captures via CDP, we preview it in a host panel + export it.
// Host-level (not a webview tab) so it can reach the export IPC without weakening the webview sandbox. ----
const panelCap = document.getElementById('panel-capture');
const capImg = document.getElementById('cap-img');
const capStatus = document.getElementById('cap-status');
const capDim = document.getElementById('cap-dim');
let capShot = null;   // { dataUrl, width, height, scaled } of the current preview
function setCapButtons(on) { ['cap-png', 'cap-pdf', 'cap-copy'].forEach((id) => { document.getElementById(id).disabled = !on; }); }
api.onCaptureFull(async (d) => {
  // confirm it's a live tab we own, then show the panel in a "capturing" state
  let known = false;
  for (const s of sets) for (const p of s.panes) for (const t of p.tabs) if (t.wcId === d.targetWcId) known = true;
  if (!known) return;
  capShot = null; capImg.hidden = true; capImg.removeAttribute('src');
  capDim.textContent = ''; capStatus.hidden = false; capStatus.textContent = 'Capturing…'; setCapButtons(false);
  togglePanel(panelCap);
  const r = await api.captureFull(d.targetWcId).catch((e) => ({ ok: false, error: String(e) }));
  if (panelCap.hidden) return;   // user closed it while we captured
  if (!r || !r.ok) { capStatus.textContent = (r && r.error) || 'Capture failed.'; return; }
  capShot = r;
  capImg.src = r.dataUrl; capImg.hidden = false; capStatus.hidden = true;
  capDim.textContent = r.width + '×' + r.height + (r.scaled ? ' · scaled to fit' : '');
  setCapButtons(true);
});
async function capExport(fn, okMsg) {
  if (!capShot) return;
  setCapButtons(false);
  const r = await fn({ dataUrl: capShot.dataUrl, width: capShot.width, height: capShot.height }).catch(() => null);
  setCapButtons(true);
  if (r && r.ok) capDim.textContent = okMsg + (r.path ? ' → ' + r.path.split('/').pop() : '');
}
document.getElementById('cap-png').addEventListener('click', () => capExport(api.captureSavePng, 'Saved PNG'));
document.getElementById('cap-pdf').addEventListener('click', () => capExport(api.captureSavePdf, 'Saved PDF'));
document.getElementById('cap-copy').addEventListener('click', () => capExport(api.captureCopy, 'Copied to clipboard'));
document.getElementById('cap-close').addEventListener('click', () => { panelCap.hidden = true; capShot = null; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panelCap.hidden) { panelCap.hidden = true; capShot = null; } });

// HTTP Basic/Digest auth: a site (or dev server) asked for credentials
api.onHttpAuth((d) => showAuthDialog(d));
function showAuthDialog(d) {
  document.querySelectorAll('.auth-modal').forEach((m) => m.remove());
  const pre = Vault.credsForHost(d.host, d.port) || { username: '', password: '' };
  const locked = !Vault.unlocked();
  // Name the actual origin (scheme + host) that asked, not just the bare host -- so the user can tell an
  // https page from a plaintext one, and there is no ambiguity about which page raised the prompt (review #3).
  const originStr = (() => { try { return new URL(d.url).origin; } catch { return ''; } })();
  const where = d.isProxy
    ? 'Proxy ' + esc(d.host) + (d.port && d.port !== 80 && d.port !== 443 ? ':' + d.port : '')
    : esc(originStr || d.host);
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = '<div class="auth-box">' +
    '<div class="auth-h">Sign in to ' + where + '</div>' +
    (d.realm ? '<div class="auth-realm">' + esc(d.realm) + '</div>' : '') +
    '<input class="auth-in" id="auth-user" placeholder="Username" autocomplete="off" />' +
    '<input class="auth-in" id="auth-pass" type="password" placeholder="Password" />' +
    (locked ? '<button class="auth-unlock" id="auth-unlock">&#128273; Unlock vault to autofill</button>' : '') +
    '<div class="auth-row"><button class="auth-btn primary" id="auth-ok">Sign in</button><button class="auth-btn" id="auth-cancel">Cancel</button></div></div>';
  document.body.appendChild(modal);
  const user = modal.querySelector('#auth-user'), pass = modal.querySelector('#auth-pass');
  user.value = pre.username; pass.value = pre.password;
  (pre.username ? pass : user).focus();
  const done = (ok) => { modal.remove(); api.httpAuthReply({ id: d.id, username: ok ? user.value : null, password: ok ? pass.value : '' }); };
  modal.querySelector('#auth-ok').onclick = () => done(true);
  modal.querySelector('#auth-cancel').onclick = () => done(false);
  if (locked) modal.querySelector('#auth-unlock').onclick = () => {
    modal.remove();                       // hide the dialog (main keeps waiting -- we haven't answered)
    Vault.openPanel();                    // let the user unlock/create the vault
    Vault.onNextUnlock(() => showAuthDialog(d));   // then re-open the dialog, now prefilled from the vault
  };
  [user, pass].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); }));
}

// ---- status-bar panels: bookmarks / downloads / settings ----
const panelBM = document.getElementById('panel-bookmarks');
const panelDL = document.getElementById('panel-downloads');
const panelSet = document.getElementById('panel-settings');
function togglePanel(panel) {
  const open = panel.hidden;
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
  panel.hidden = !open;
}
document.getElementById('btn-bookmarks').addEventListener('click', () => { renderBookmarks(); togglePanel(panelBM); });
document.getElementById('btn-downloads').addEventListener('click', () => togglePanel(panelDL));
document.getElementById('btn-settings').addEventListener('click', () => { fillSettings(); togglePanel(panelSet); });

// ---- About popover: click the "Splitser" footer brand -> build version + (prepped) donate link ----
// To turn on the Donate button, set DONATE_URL to a Stripe Payment Link (https://buy.stripe.com/…)
// or a PayPal link (https://paypal.me/…). Empty = the button shows but stays disabled ("coming soon").
const DONATE_URL = 'https://buy.stripe.com/9B6aEZ5Q15HM9io4ZV8AE00';
const panelAbout = document.getElementById('panel-about');
function openUrlInSplitser(u) { const p = active() || panes[0]; if (p) { activePane = p; addTab(p, u); markActive(); } }
function openAbout() {
  const vEl = document.getElementById('about-version'); if (vEl) vEl.textContent = (api && api.version) || '?';
  const don = document.getElementById('about-donate');
  if (don) {
    if (DONATE_URL) { don.disabled = false; don.title = 'Open the donation page'; don.onclick = () => { openUrlInSplitser(DONATE_URL); panelAbout.hidden = true; }; }
    else { don.disabled = true; don.title = 'Donations coming soon'; }
  }
  const site = document.getElementById('about-site');
  if (site) site.onclick = () => { openUrlInSplitser('https://splitser.org'); panelAbout.hidden = true; };
  togglePanel(panelAbout);
}
infoEl.style.cursor = 'pointer'; infoEl.title = 'About Splitser';
infoEl.addEventListener('click', openAbout);
document.getElementById('open-dl-folder').addEventListener('click', () => api.openDownloads());

// the current workspace as a saveable spec (same shape as a saved-session set)
function setSpec(s) {   // a set's reopenable spec: name + layout + theme + each pane's real-page URLs
  return {
    name: s.name || setName(s, sets.indexOf(s)),
    layout: s.layout,
    theme: s.theme || null,
    panes: s.panes.map((p) => p.tabs.map((t) => { try { return t.view.getURL(); } catch (e) { return t.url || ''; } }).filter((u) => /^(https?|file):/.test(u))).filter((a) => a.length)
  };
}
function currentWorkspaceSpec() {
  if (cur) cur.activePane = activePane;
  return setSpec(cur);
}
async function bookmarkCurrentWorkspace() {
  if (cur && cur.incognito) return;   // private workspaces are ephemeral -- don't write them to disk
  await api.bookmarkWorkspace(currentWorkspaceSpec());
  renderBookmarks(); panelBM.hidden = false;
}
function openWorkspaceBookmark(ws) {   // reopen a saved workspace as a NEW set
  if (cur) cur.activePane = activePane;
  const s = buildSet(ws.layout || 'cols', (ws.panes && ws.panes.length) ? ws.panes : [[SETTINGS.home]]);
  s.name = ws.name || ''; s.theme = ws.theme || null;
  switchSet(s); saveSession();
}
const bmCollapsed = new Set();   // folder names collapsed in the panel (this session)

async function renderBookmarks() {
  const [bms, folders] = await Promise.all([api.bookmarksGet(), api.bookmarkFolders()]);
  const list = document.getElementById('bm-list');
  const folderSel = (key, cur) =>
    `<select class="row-folder" data-key="${esc(String(key))}" title="Move to folder">` +
    `<option value=""${cur ? '' : ' selected'}>no folder</option>` +
    folders.map((f) => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('') +
    `</select>`;
  const rowHtml = (b) => {
    const key = b.type === 'workspace' ? b.id : b.url;
    const main = b.type === 'workspace'
      ? `<a class="row-main" data-ws="${esc(b.id)}"><span class="row-t">&#9638; ${esc(b.name || 'Workspace')}</span><span class="row-u">${(b.panes || []).length} pane${(b.panes || []).length === 1 ? '' : 's'} · ${esc(b.layout || 'cols')}</span></a>`
      : `<a class="row-main" data-url="${esc(b.url)}"><span class="row-t">${esc(b.title || b.url)}</span><span class="row-u">${esc(b.url)}</span></a>`;
    return `<div class="row">${main}${folderSel(key, b.folder || '')}<button class="row-x" data-key="${esc(String(key))}" title="Remove">&#215;</button></div>`;
  };

  if (!bms.length && !folders.length) {
    list.innerHTML = '<p class="empty">No bookmarks yet -- hit the &#9734; on any page, or Save workspace above. Use &#128193; Folder to group them.</p>';
    return;
  }

  let html = '';
  for (const f of folders) {                                               // folders in stored order
    const items = bms.filter((b) => (b.folder || '') === f);
    const collapsed = bmCollapsed.has(f);
    html +=
      `<div class="bm-folder${collapsed ? ' collapsed' : ''}">` +
      `<div class="bm-folder-h" data-folder="${esc(f)}">` +
        `<span class="bm-caret">${collapsed ? '&#9656;' : '&#9662;'}</span>` +
        `<span class="bm-fold-name" data-folder="${esc(f)}">${esc(f)}</span>` +
        `<span class="bm-fold-count">${items.length}</span>` +
        `<button class="bm-fold-btn" data-rename="${esc(f)}" title="Rename folder">&#9998;</button>` +
        `<button class="bm-fold-btn" data-delfolder="${esc(f)}" title="Delete folder (keeps its bookmarks)">&#215;</button>` +
      `</div>` +
      `<div class="bm-folder-items">${items.map(rowHtml).join('') || '<p class="bm-fold-empty">Empty -- assign bookmarks with the folder menu.</p>'}</div>` +
      `</div>`;
  }
  const ungrouped = bms.filter((b) => !b.folder || !folders.includes(b.folder));
  if (ungrouped.length) {
    if (folders.length) html += '<div class="bm-ungrouped-label">Ungrouped</div>';
    html += ungrouped.map(rowHtml).join('');
  }
  list.innerHTML = html;
}

function startFolderRename(btn) {
  const oldName = btn.getAttribute('data-rename');
  const nameEl = btn.closest('.bm-folder-h')?.querySelector('.bm-fold-name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.className = 'bm-fold-rename-in'; input.type = 'text'; input.value = oldName; input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return; done = true;
    const name = input.value.trim();
    if (save && name && name !== oldName) await api.bookmarkFolderRename(oldName, name);
    renderBookmarks();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());           // don't toggle collapse
}

document.getElementById('bm-add-ws').addEventListener('click', bookmarkCurrentWorkspace);
document.getElementById('bm-add-folder').addEventListener('click', () => {
  const list = document.getElementById('bm-list');
  const existing = list.querySelector('.bm-newfolder');
  if (existing) { existing.querySelector('input').focus(); return; }
  const emptyMsg = list.querySelector('.empty'); if (emptyMsg) emptyMsg.remove();
  const row = document.createElement('div');
  row.className = 'bm-newfolder';
  row.innerHTML = '<input type="text" placeholder="New folder name…" maxlength="40" />';
  list.prepend(row);
  const input = row.querySelector('input');
  input.focus();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const name = input.value.trim();
    if (name) await api.bookmarkFolderAdd(name);
    renderBookmarks();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done = true; renderBookmarks(); }
  });
  input.addEventListener('blur', commit);
});
document.getElementById('bm-list').addEventListener('change', async (e) => {
  const s = e.target.closest('.row-folder');
  if (!s) return;
  await api.bookmarkSetFolder(s.dataset.key, s.value || null);
  renderBookmarks();
});
document.getElementById('bm-list').addEventListener('click', async (e) => {
  const ren = e.target.closest('[data-rename]');
  if (ren) { e.stopPropagation(); startFolderRename(ren); return; }
  const del = e.target.closest('[data-delfolder]');
  if (del) { e.stopPropagation(); await api.bookmarkFolderRemove(del.getAttribute('data-delfolder')); renderBookmarks(); return; }
  const hdr = e.target.closest('.bm-folder-h');
  if (hdr) { const f = hdr.getAttribute('data-folder'); if (bmCollapsed.has(f)) bmCollapsed.delete(f); else bmCollapsed.add(f); renderBookmarks(); return; }
  const rm = e.target.closest('.row-x');
  if (rm) { await api.bookmarkRemove(rm.dataset.key); renderBookmarks(); panes.forEach((p) => p.refreshStar()); return; }
  const open = e.target.closest('.row-main');
  if (!open) return;
  if (open.dataset.ws) {
    const ws = (await api.bookmarksGet()).find((b) => b.id === open.dataset.ws);
    if (ws) openWorkspaceBookmark(ws);
    panelBM.hidden = true;
  } else { active()?.view.loadURL(open.dataset.url); panelBM.hidden = true; panes.forEach((p) => p.refreshStar()); }
});

// downloads
const dlMap = new Map();
function fmt(b) { return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB'; }
api.onDownload((d) => {
  dlMap.set(d.id, d);
  document.getElementById('btn-downloads').hidden = false;
  const active = [...dlMap.values()].filter((x) => x.state === 'progressing').length;
  document.getElementById('dl-badge').textContent = active ? ' ' + active : '';
  const list = document.getElementById('dl-list');
  list.innerHTML = [...dlMap.values()].reverse().map((x) => {
    const pct = x.total ? Math.round(x.received / x.total * 100) : 0;
    const status = x.state === 'completed' ? 'done' : x.state === 'progressing' ? pct + '% · ' + fmt(x.received) : x.state;
    return `<div class="row"><span class="row-t">${esc(x.name)}</span><span class="row-u">${status}</span>` +
      `<div class="dl-bar"><i style="width:${x.state === 'completed' ? 100 : pct}%"></i></div></div>`;
  }).join('');
  showDlToast(d);                                   // visible feedback -- downloads shouldn't be silent
});
// slide-in toast per download: progress while going, then "Downloaded" with Open / Show-in-folder
function showDlToast(d) {
  let host = document.getElementById('dl-toasts');
  if (!host) { host = document.createElement('div'); host.id = 'dl-toasts'; document.body.appendChild(host); }
  let el = document.getElementById('dlt-' + d.id);
  if (!el) { el = document.createElement('div'); el.className = 'dl-toast'; el.id = 'dlt-' + d.id; host.appendChild(el); }
  const pct = d.total ? Math.round(d.received / d.total * 100) : 0;
  const done = d.state === 'completed';
  const failed = d.state === 'interrupted' || d.state === 'cancelled';
  el.classList.toggle('done', done); el.classList.toggle('failed', failed);
  const status = done ? 'Downloaded' : failed ? 'Download ' + d.state : (d.total ? pct + '% · ' + fmt(d.received) : fmt(d.received));
  el.innerHTML =
    '<div class="dlt-ico">' + (done ? '✓' : failed ? '✕' : '↓') + '</div>' +
    '<div class="dlt-body"><div class="dlt-name" title="' + esc(d.name) + '">' + esc(d.name) + '</div>' +  // esc() escapes quotes, so a filename cannot break out of title=""
    '<div class="dlt-sub">' + status + '</div>' +
    (done ? '<div class="dlt-actions"><button class="dlt-btn" data-a="open">Open</button><button class="dlt-btn" data-a="folder">Show in folder</button></div>' : '') +
    '</div><button class="dlt-x" title="Dismiss">×</button>' +
    (done || failed ? '' : '<div class="dlt-bar"><i style="width:' + pct + '%"></i></div>');
  el.querySelector('.dlt-x').onclick = () => el.remove();
  if (done) {
    el.querySelector('[data-a="open"]').onclick = () => openDownloadedFile(d.path);
    el.querySelector('[data-a="folder"]').onclick = () => api.revealDownload(d.path);
  }
  if (done || failed) { clearTimeout(el._t); el._t = setTimeout(() => el.remove(), done ? 12000 : 8000); }
}

// settings
async function fillSettings() {
  SETTINGS = await api.settingsGet();
  document.getElementById('set-home').value = SETTINGS.home;
  document.getElementById('set-search').value = SETTINGS.search;
  document.getElementById('set-dlmode').value = SETTINGS.downloadMode || 'auto';
}
document.getElementById('set-home').addEventListener('change', async (e) => { SETTINGS = await api.settingsSet({ home: e.target.value.trim() }); });
document.getElementById('set-search').addEventListener('change', async (e) => { SETTINGS = await api.settingsSet({ search: e.target.value.trim() }); });
document.getElementById('set-dlmode').addEventListener('change', async (e) => { SETTINGS = await api.settingsSet({ downloadMode: e.target.value }); });
panelSet.querySelectorAll('.danger').forEach((b) => b.addEventListener('click', async () => {
  await api.clearData(b.dataset.clear);
  if (b.dataset.clear === 'bookmarks') { renderBookmarks(); panes.forEach((p) => p.refreshStar()); }
}));

// close any open footer panel when clicking ANYWHERE outside it -- but not when clicking inside a
// panel, nor on a status-bar toggle button (whose own handler opens/closes it). Covers panes, the
// bars, the address bar, everything.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.panel') || e.target.closest('.sbtn') || e.target.closest('.brand')) return;   // .brand = the "Splitser" footer label toggles the About panel
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
}, true);

// ---- boot: restore last session (v2 sets, or legacy flat), else the two demo panes ----
SETTINGS = await api.settingsGet();
const saved = await api.sessionGet();
if (saved && saved.v === 2 && Array.isArray(saved.sets) && saved.sets.length) {
  saved.sets.forEach((ss) => {
    try {
      if (ss.split) {                                   // a per-pane split set: rebuild panes FROM the tree
        const st = createSet(); bindCur(st);
        st.split = buildSplit(ss.split); st.name = ss.name || ''; st.theme = ss.theme || null;
        if (st.split) { st.layout = 'splits'; applySplitTree(st); } else setLayout('cols', false, false);
      } else {
        const st = buildSet(ss.layout || 'cols', Array.isArray(ss.panes) ? ss.panes : []); st.name = ss.name || ''; st.theme = ss.theme || null;
      }
    } catch (e) {   // NEVER let one bad set abort the whole restore (that is what wiped 0.1.17's workspaces)
      try { const st = buildSet(ss.layout || 'cols', (Array.isArray(ss.panes) && ss.panes.length) ? ss.panes : [[SETTINGS.home]]); st.name = ss.name || ''; st.theme = ss.theme || null; } catch (e2) { /* skip this set only */ }
    }
  });
  switchSet(sets[Math.min(saved.active || 0, sets.length - 1)]);
} else if (Array.isArray(saved) && saved.length) {                 // legacy single-set session
  buildSet('cols', saved.map((e) => Array.isArray(e) ? e : [e]));
  switchSet(sets[0]);
} else {
  buildSet('cols', [['https://github.com'], ['https://dashboard.stripe.com']]);
  switchSet(sets[0]);
}
Vault.init({ api, getPanes: () => panes, getActive: () => active() });
Theme.init();
Theme.onChange((t) => { if (cur) { cur.theme = t; saveSession(); } });   // a theme edit belongs to the current set
updateGridBtn();
if (api.appReady) api.appReady();   // restore + vault + theme are up -> main may now open a URL Splitser was launched with

// ---- footer Grid picker: a "Grid: C×R" button with a 3×3 hover-to-pick flyout (max 3×3) ----
const gridBtn = document.getElementById('grid-btn');
const gridFlyout = document.getElementById('grid-flyout');
const gfMatrix = document.getElementById('gf-matrix');
const gfLabel = document.getElementById('gf-label');
for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) {   // 9 cells, row-major
  const cell = document.createElement('div'); cell.className = 'gf-cell'; cell.dataset.c = c; cell.dataset.r = r;
  gfMatrix.appendChild(cell);
}
function gfHighlight(hc, hr) {   // light up the top-left hc×hr rectangle and label it
  gfMatrix.querySelectorAll('.gf-cell').forEach((cell) => cell.classList.toggle('lit', +cell.dataset.c <= hc && +cell.dataset.r <= hr));
  gfLabel.textContent = hc + ' × ' + hr;
}
function openGridFlyout(open) {
  gridFlyout.hidden = !open;
  if (open) { const [C, R] = curDims(); gfHighlight(Math.min(C, 3), Math.min(R, 3)); }
}
function pickGrid(c, r) {
  if (r === 1) { setPaneCount(c); setLayout('cols', false); }   // one row -> resizable columns
  else setLayout('g' + c + 'x' + r, true);                      // 2-D grid, fills to exactly c×r panes
}
gridBtn.addEventListener('click', (e) => { e.stopPropagation(); openGridFlyout(gridFlyout.hidden); });
gfMatrix.addEventListener('mousemove', (e) => { const cell = e.target.closest('.gf-cell'); if (cell) gfHighlight(+cell.dataset.c, +cell.dataset.r); });
gfMatrix.addEventListener('click', (e) => { const cell = e.target.closest('.gf-cell'); if (!cell) return; pickGrid(+cell.dataset.c, +cell.dataset.r); openGridFlyout(false); });
document.addEventListener('click', (e) => { if (!gridFlyout.hidden && !e.target.closest('#grid-picker')) openGridFlyout(false); });
