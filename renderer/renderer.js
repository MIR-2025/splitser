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
const FAV_EMOJI = ['🖥️', '💻', '🧪', '⚙️', '🚀', '📦', '🔧', '🗄️', '🐘', '🐍', '⚡', '🌐', '📊', '🔒', '🎯', '🧩'];
const FAV_COLORS = ['#5fe08a', '#5b9dff', '#c084fc', '#fb7185', '#fbbf24', '#2dd4bf', '#f97316', '#94a3b8'];
function makeFav(spec, host) {   // render an emoji or a colour+initial to a 32px favicon data URL
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  if (spec.emoji) { g.font = '24px system-ui,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(spec.emoji, 16, 18); }
  else { g.fillStyle = spec.color; if (g.roundRect) { g.beginPath(); g.roundRect(1, 1, 30, 30, 7); g.fill(); } else g.fillRect(1, 1, 30, 30); g.fillStyle = '#0b1013'; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((host || '?').charAt(0).toUpperCase(), 16, 17); }
  return c.toDataURL('image/png');
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
    '<button class="fp-auto">Use the site’s own icon</button>';
  pane.el.appendChild(pop);
  const br = pane.fav.getBoundingClientRect(), pr = pane.el.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(br.left - pr.left - 8, pane.el.clientWidth - pop.offsetWidth - 6)) + 'px';
  pop.style.top = (br.bottom - pr.top + 6) + 'px';
  const pick = (spec) => { if (spec) favOverrides[host] = makeFav(spec, host); else delete favOverrides[host]; saveFavs(); resyncHostFavicons(host); closeFavPicker(); };
  pop.querySelectorAll('.fp-e').forEach((b) => { b.onclick = () => pick({ emoji: b.dataset.emoji }); });
  pop.querySelectorAll('.fp-c').forEach((b) => { b.onclick = () => pick({ color: b.dataset.color }); });
  pop.querySelector('.fp-auto').onclick = () => pick(null);
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!pop.contains(e.target) && e.target !== pane.fav) { closeFavPicker(); document.removeEventListener('mousedown', h); } }), 0);
}

const BAR = `
  <div class="bar">
    <button class="nav back" title="Back">&#8249;</button>
    <button class="nav fwd" title="Forward">&#8250;</button>
    <button class="nav reload" title="Reload">&#8635;</button>
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
  const suggest = el.querySelector('.suggest');
  const findbar = el.querySelector('.findbar');
  const findInput = el.querySelector('.find-input');
  const findCount = el.querySelector('.find-count');
  const tabstrip = el.querySelector('.tabstrip');

  const pane = {
    el, addr, star, keyBtn, shieldBtn, tabstrip, fav, spin, muteBtn, findbar, findInput, findCount,
    viewsBox: el.querySelector('.views'), tabs: [], activeTab: null, sugIdx: -1, sugs: [],
    get view() { return this.activeTab ? this.activeTab.view : null; },
    get title() { return this.activeTab ? this.activeTab.title : ''; },
    get zoom() { return this.activeTab ? this.activeTab.zoom : 1; }
  };
  pane.incognito = !!(cur && cur.incognito);   // private-workspace panes: ephemeral session, no history
  panes.push(pane);

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
  pane.setZoom = (z) => { const t = pane.activeTab; if (!t) return; t.zoom = Math.max(0.4, Math.min(3, z)); pane.view.setZoomFactor(t.zoom); };
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
  el.querySelector('.reload').addEventListener('click', () => pane.view && pane.view.reload());
  el.querySelector('.split').addEventListener('click', () => { const p = makePane(SETTINGS.home, el.nextElementSibling); rebuildGutters(); saveSession(); p.addr.focus(); });
  el.querySelector('.close').addEventListener('click', () => requestClosePane(pane));
  star.addEventListener('click', pane.toggleBookmark);
  keyBtn.addEventListener('click', () => Vault.fillPane(pane));
  fav.addEventListener('click', (e) => { e.stopPropagation(); openFavPicker(pane); });   // set a custom icon (localhost etc.)
  shieldBtn.addEventListener('click', (e) => { e.stopPropagation(); pane.openShields(); });
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
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  tabEl.innerHTML = '<img class="tabfav" alt="" hidden /><span class="tabtitle">New tab</span><button class="tabclose" title="Close tab">&#215;</button>';
  pane.tabstrip.insertBefore(tabEl, pane.tabstrip.querySelector('.newtab'));

  const tab = { view, tabEl, title: 'New tab', favicon: '', realFavicon: '', url: url || '', zoom: 1, muted: false, loading: false, audio: false };
  const tfav = tabEl.querySelector('.tabfav');
  const ttitle = tabEl.querySelector('.tabtitle');
  const active = () => pane.activeTab === tab;
  const syncFav = () => {   // a per-host custom icon (favOverrides) wins; else the page's own; else none
    const ov = favOv(favHost(tab.url || view.getURL()));
    tab.favicon = ov || tab.realFavicon || '';
    if (tab.favicon) { tfav.src = tab.favicon; tfav.hidden = false; } else { tfav.removeAttribute('src'); tfav.hidden = true; }
    if (active()) { setPaneFav(pane, tab.favicon); renderSetbar(); }
  };
  tab.syncFav = syncFav;

  view.addEventListener('did-navigate', () => { tab.url = view.getURL(); tab.realFavicon = ''; syncFav(); if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); } saveSession(); });
  view.addEventListener('did-navigate-in-page', () => { tab.url = view.getURL(); if (active()) pane.syncAddr(); });
  view.addEventListener('dom-ready', () => { try { tab.wcId = view.getWebContentsId(); } catch (e) { /* not attached yet */ } if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); pane.refreshShield(); } });
  view.addEventListener('did-start-loading', () => { tab.loading = true; tabEl.classList.add('loading'); if (active()) pane.spin.hidden = false; });
  view.addEventListener('did-stop-loading', () => { tab.loading = false; tabEl.classList.remove('loading'); if (active()) { pane.spin.hidden = true; pane.syncAddr(); } const u = view.getURL(); if (/^https?:/.test(u) && !pane.incognito) api.historyAdd({ url: u, title: tab.title });
    if (/^file:\/\/.*\.(md|markdown)(\?|#|$)/i.test(u)) view.executeJavaScript('(' + mdViewerInject.toString() + ')()').catch(() => {}); });   // render local markdown
  view.addEventListener('page-title-updated', (e) => { tab.title = e.title || tab.url; ttitle.textContent = tab.title; tabEl.title = tab.title; if (active()) updateTitle(); });
  view.addEventListener('page-favicon-updated', (e) => { const f = (e.favicons || [])[0]; if (f) tab.realFavicon = f; syncFav(); });
  view.addEventListener('update-target-url', (e) => { hoverEl.textContent = e.url || ''; });
  view.addEventListener('found-in-page', (e) => { if (active()) { const r = e.result; pane.findCount.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : 'no matches'; } });
  view.addEventListener('media-started-playing', () => { tab.audio = true; if (active()) pane.muteBtn.hidden = false; });
  view.addEventListener('ipc-message', (e) => {                               // signals from the webview preload
    if (e.channel === 'vault:capture') Vault.offerSave(pane, e.args[0]);       // login submitted -> "save this?"
    else if (e.channel === 'vault:loginfocus') Vault.offerFill(pane, e.args[0]); // login field focused -> "prefill?"
    else if (e.channel === 'vault:loginblur') Vault.hideFill(pane);
    else if (e.channel === 'pane-active') { activePane = pane; markActive(); }   // clicked into this pane's content
  });
  tfav.addEventListener('error', () => { tfav.hidden = true; });

  syncFav();   // apply a custom icon immediately (e.g. a restored localhost tab)
  pane.tabs.push(tab);
  pane.el.classList.toggle('multitab', pane.tabs.length > 1);
  switchTab(pane, tab);
  updateInfo();
  return tab;
}

function switchTab(pane, tab) {
  pane.tabs.forEach((t) => { t.view.style.display = (t === tab) ? '' : 'none'; t.tabEl.classList.toggle('on', t === tab); });
  pane.activeTab = tab;
  pane.addr.value = (tab.url && tab.url !== 'about:blank') ? tab.url : '';
  setPaneFav(pane, tab.favicon);
  pane.spin.hidden = !tab.loading;
  pane.muteBtn.hidden = !(tab.muted || tab.audio); pane.muteBtn.innerHTML = tab.muted ? '&#128263;' : '&#128266;';
  pane.findbar.hidden = true; pane.findCount.textContent = '';
  pane.refreshStar(); Vault.refreshPaneKey(pane); pane.refreshShield(); updateTitle();
}

function closeTab(pane, tab) {
  if (pane.tabs.length <= 1) { closePane(pane); return; }
  const i = pane.tabs.indexOf(tab);
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
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function closePane(pane) {
  if (panes.length <= 1) {                         // closing the only pane of a set...
    if (sets.length > 1) { closeSet(cur); return; }  // ...closes the set, if there are others
    pane.view.loadURL(SETTINGS.home); return;        // ...or just resets it (last pane of last set)
  }
  const i = panes.indexOf(pane);
  panes.splice(i, 1); pane.el.remove();
  if (activePane === pane) activePane = panes[Math.min(i, panes.length - 1)] || null;
  rebuildGutters(); updateTitle(); saveSession();
}

function rebuildGutters() {
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
    const p = panes.pop(); p.el.remove();
    if (activePane === p) activePane = panes[panes.length - 1] || null;
  }
}
// layout: 'cols' (resizable columns, 1 row) | 'g{C}x{R}' (grid up to 3×3). `fill` sets the pane
// count to the grid's cells. Operates on the CURRENT set. `save=false` while building sets at boot.
function setLayout(mode, fill, save = true) {
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

// ---- sets / workspaces: each set is its own grid; only the current one is shown, the rest
// stay in the DOM (display:none) so their webviews keep running. `cur` + the four mirrors are
// the current set; switchSet() re-points them. ----
function createSet() {
  const el = document.createElement('div'); el.className = 'gridset'; el.style.display = 'none';
  gridRoot.appendChild(el);
  const s = { el, panes: [], activePane: null, layout: 'cols', gCols: [], gRows: [], name: '', theme: null, incognito: false };
  sets.push(s); return s;
}
function bindCur(s) { cur = s; grid = s.el; panes = s.panes; activePane = s.activePane; currentLayout = s.layout; }
function switchSet(s) {
  if (!s) return;
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
  const i = sets.indexOf(s); s.el.remove(); sets.splice(i, 1);
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
    body: 'This workspace has ' + detail + '. Closing it discards them all -- this cannot be undone.',
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
const LOGO_SVG = '<svg class="setbar-logo" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="Splitser -- the 1+2 layout"><title>Splitser -- click for the 1+2 layout</title>' +
  '<rect width="24" height="24" rx="5.4" fill="#0e1418"/>' +
  '<rect x="4.2" y="4.2" width="6.6" height="15.6" rx="1.2" fill="#5fe08a"/>' +
  '<rect x="11.7" y="4.2" width="8.1" height="7.3" rx="1.2" fill="#5fe08a"/>' +
  '<rect x="11.7" y="12.5" width="8.1" height="7.3" rx="1.2" fill="#5fe08a"/></svg>';
function renderSetbar() {   // the "Workspaces" bar: named pills that wrap across rows (like the Split Screen ext)
  const pills = sets.map((s, i) => {
    const fav = s.panes.map((p) => p.activeTab && p.activeTab.favicon).find(Boolean);
    const name = setName(s, i);
    return '<span class="setpill' + (s === cur ? ' on' : '') + (s.incognito ? ' incognito' : '') + '" data-i="' + i + '" title="' + esc(name).replace(/"/g, '&quot;') + (s.incognito ? ' (private -- nothing saved)' : '') + '">' +
      (s.incognito ? '<span class="setinc-ico">&#128374;</span>' : (fav ? '<img class="setfav" src="' + fav.replace(/"/g, '&quot;') + '" alt="" />' : '<span class="setfav-none">&#127760;</span>')) +
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
setbar.addEventListener('click', (e) => {
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

// ---- session persistence ----
let sessTimer;
function saveSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    if (cur) cur.activePane = activePane;
    const persist = sets.filter((s) => !s.incognito);   // private workspaces are ephemeral -- never saved
    const data = {
      v: 2, active: Math.max(0, persist.indexOf(cur)),   // cur incognito -> indexOf -1 -> 0
      sets: persist.map((s) => ({
        name: s.name || '',
        theme: s.theme || null,
        layout: s.layout,
        panes: s.panes.map((p) => p.tabs.map((t) => t.view.getURL()).filter((u) => /^(https?|file):/.test(u))).filter((a) => a.length)
      }))
    };
    api.sessionSet(data);
  }, 700);
}

// ---- shortcuts (forwarded from main) ----
function handleShortcut(k) {
  const p = active();
  if (k === 'l') p?.addr.focus();
  else if (k === 't') newSet();                                                         // new SET (fresh grid); tabs open via the strip +
  else if (k === 'shift+n') newIncognitoSet();                                          // new PRIVATE workspace
  else if (k === 'w') { if (p && p.activeTab) closeTab(p, p.activeTab); }               // close TAB (last tab -> pane; last pane -> set)
  else if (k === 'r') p?.view.reload();
  else if (k === 'f') p?.openFind();
  else if (k === 'm') p?.toggleMute();
  else if (k === 'd') p?.toggleBookmark();
  else if (k === 'k') Vault.togglePanel();
  else if (k === 'p') { try { p?.view.print(); } catch (e) { /* print may reject if the view isn't ready */ } }   // print the focused pane
  else if (k === '1') setLayout('cols', false);
  else if (k === '2') setLayout('g2x2', true);
  else if (k === '3') setLayout('g3x3', true);
  else if (k === '=' || k === '+') { if (p) p.setZoom(p.zoom + 0.1); }
  else if (k === '-') { if (p) p.setZoom(p.zoom - 0.1); }
  else if (k === '0') p?.setZoom(1);
}
api.onShortcut(handleShortcut);
api.onOpenPane((url) => { const p = makePane(url, active() ? active().el.nextElementSibling : null); rebuildGutters(); saveSession(); activePane = p; });
// live shield counts: route to whichever pane's ACTIVE tab this webContents is
api.onShields((d) => { for (const s of sets) for (const p of s.panes) { if (p.activeTab && p.activeTab.wcId === d.wcId) { p.updateShield(d); return; } } });

// "Open link in new tab" from the context menu -> a tab in the pane that was right-clicked
api.onOpenTabIn((d) => { for (const s of sets) for (const p of s.panes) { if (p.activeTab && p.activeTab.wcId === d.wcId) { activePane = p; addTab(p, d.url); return; } } });

// HTTP Basic/Digest auth: a site (or dev server) asked for credentials
api.onHttpAuth((d) => showAuthDialog(d));
function showAuthDialog(d) {
  document.querySelectorAll('.auth-modal').forEach((m) => m.remove());
  const pre = Vault.credsForHost(d.host, d.port) || { username: '', password: '' };
  const locked = !Vault.unlocked();
  const where = (d.isProxy ? 'Proxy ' : '') + esc(d.host) + (d.port && d.port !== 80 && d.port !== 443 ? ':' + d.port : '');
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
document.getElementById('open-dl-folder').addEventListener('click', () => api.openDownloads());

async function renderBookmarks() {
  const bms = await api.bookmarksGet();
  const list = document.getElementById('bm-list');
  list.innerHTML = bms.length ? bms.map((b) =>
    `<div class="row"><a class="row-main" data-url="${b.url.replace(/"/g, '&quot;')}"><span class="row-t">${esc(b.title || b.url)}</span><span class="row-u">${esc(b.url)}</span></a>` +
    `<button class="row-x" data-url="${b.url.replace(/"/g, '&quot;')}" title="Remove">&#215;</button></div>`).join('')
    : '<p class="empty">No bookmarks yet — hit the &#9734; on any page (or Ctrl+D).</p>';
}
document.getElementById('bm-list').addEventListener('click', async (e) => {
  const open = e.target.closest('.row-main');
  const rm = e.target.closest('.row-x');
  if (open) { active()?.view.loadURL(open.dataset.url); panelBM.hidden = true; panes.forEach((p) => p.refreshStar()); }
  else if (rm) { await api.bookmarkToggle({ url: rm.dataset.url }); renderBookmarks(); panes.forEach((p) => p.refreshStar()); }
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
    '<div class="dlt-body"><div class="dlt-name" title="' + esc(d.name) + '">' + esc(d.name) + '</div>' +
    '<div class="dlt-sub">' + status + '</div>' +
    (done ? '<div class="dlt-actions"><button class="dlt-btn" data-a="open">Open</button><button class="dlt-btn" data-a="folder">Show in folder</button></div>' : '') +
    '</div><button class="dlt-x" title="Dismiss">×</button>' +
    (done || failed ? '' : '<div class="dlt-bar"><i style="width:' + pct + '%"></i></div>');
  el.querySelector('.dlt-x').onclick = () => el.remove();
  if (done) {
    el.querySelector('[data-a="open"]').onclick = () => api.openDownload(d.path);
    el.querySelector('[data-a="folder"]').onclick = () => api.revealDownload(d.path);
  }
  if (done || failed) { clearTimeout(el._t); el._t = setTimeout(() => el.remove(), done ? 12000 : 8000); }
}

// settings
async function fillSettings() {
  SETTINGS = await api.settingsGet();
  document.getElementById('set-home').value = SETTINGS.home;
  document.getElementById('set-search').value = SETTINGS.search;
}
document.getElementById('set-home').addEventListener('change', async (e) => { SETTINGS = await api.settingsSet({ home: e.target.value.trim() }); });
document.getElementById('set-search').addEventListener('change', async (e) => { SETTINGS = await api.settingsSet({ search: e.target.value.trim() }); });
panelSet.querySelectorAll('.danger').forEach((b) => b.addEventListener('click', async () => {
  await api.clearData(b.dataset.clear);
  if (b.dataset.clear === 'bookmarks') { renderBookmarks(); panes.forEach((p) => p.refreshStar()); }
}));

// close any open footer panel when clicking ANYWHERE outside it -- but not when clicking inside a
// panel, nor on a status-bar toggle button (whose own handler opens/closes it). Covers panes, the
// bars, the address bar, everything.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.panel') || e.target.closest('.sbtn')) return;
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
}, true);

// ---- boot: restore last session (v2 sets, or legacy flat), else the two demo panes ----
SETTINGS = await api.settingsGet();
const saved = await api.sessionGet();
if (saved && saved.v === 2 && Array.isArray(saved.sets) && saved.sets.length) {
  saved.sets.forEach((ss) => { const st = buildSet(ss.layout || 'cols', Array.isArray(ss.panes) ? ss.panes : []); st.name = ss.name || ''; st.theme = ss.theme || null; });
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
