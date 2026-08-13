// Splitser renderer. Phase 1 tiling shell + Phase 2 native wins + Phase 3 data layer:
// history-backed address autocomplete, bookmarks, session restore, downloads, settings,
// and the vault (local password manager + autofill).
import { Vault } from './vault.js';
const api = window.splitAPI;
const gridRoot = document.getElementById('grid');   // parent element; holds one .gridset per set
const setbar = document.getElementById('setbar');
const hoverEl = document.getElementById('hoverurl');
const infoEl = document.getElementById('paneinfo');

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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(s)) return 'https://' + s;
  return SETTINGS.search.replace('%s', encodeURIComponent(s));
}
const active = () => activePane || panes[0];

const BAR = `
  <div class="bar">
    <button class="nav back" title="Back">&#8249;</button>
    <button class="nav fwd" title="Forward">&#8250;</button>
    <button class="nav reload" title="Reload">&#8635;</button>
    <img class="fav" alt="" hidden />
    <input class="addr" type="text" spellcheck="false" autocomplete="off" placeholder="Search or enter address" />
    <span class="spin" hidden></span>
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
  const suggest = el.querySelector('.suggest');
  const findbar = el.querySelector('.findbar');
  const findInput = el.querySelector('.find-input');
  const findCount = el.querySelector('.find-count');
  const tabstrip = el.querySelector('.tabstrip');

  const pane = {
    el, addr, star, keyBtn, tabstrip, fav, spin, muteBtn, findbar, findInput, findCount,
    viewsBox: el.querySelector('.views'), tabs: [], activeTab: null, sugIdx: -1, sugs: [],
    get view() { return this.activeTab ? this.activeTab.view : null; },
    get title() { return this.activeTab ? this.activeTab.title : ''; },
    get zoom() { return this.activeTab ? this.activeTab.zoom : 1; }
  };
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

  // ---- toolbar handlers (all operate on the ACTIVE tab via pane.view) ----
  let sugTimer;
  addr.addEventListener('input', () => { clearTimeout(sugTimer); const q = addr.value; if (!q) return hideSuggest(pane); sugTimer = setTimeout(async () => { if (document.activeElement !== addr) return; pane.sugs = await api.historyQuery(q); renderSuggest(pane); }, 110); });
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(pane, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(pane, -1); }
    else if (e.key === 'Enter') { const chosen = pane.sugIdx >= 0 && pane.sugs[pane.sugIdx] ? pane.sugs[pane.sugIdx].url : normalize(addr.value); hideSuggest(pane); if (chosen && pane.view) pane.view.loadURL(chosen); if (pane.view) pane.view.focus(); }
    else if (e.key === 'Escape') { hideSuggest(pane); }
  });
  addr.addEventListener('focus', () => { activePane = pane; addr.select(); });
  addr.addEventListener('blur', () => setTimeout(() => hideSuggest(pane), 160));
  suggest.addEventListener('mousedown', (e) => { const item = e.target.closest('.sug'); if (!item) return; e.preventDefault(); hideSuggest(pane); if (pane.view) pane.view.loadURL(item.dataset.url); });
  el.addEventListener('mousedown', () => { activePane = pane; }, true);
  el.querySelector('.back').addEventListener('click', () => { if (pane.view && pane.view.canGoBack()) pane.view.goBack(); });
  el.querySelector('.fwd').addEventListener('click', () => { if (pane.view && pane.view.canGoForward()) pane.view.goForward(); });
  el.querySelector('.reload').addEventListener('click', () => pane.view && pane.view.reload());
  el.querySelector('.split').addEventListener('click', () => { const p = makePane(SETTINGS.home, el.nextElementSibling); rebuildGutters(); saveSession(); p.addr.focus(); });
  el.querySelector('.close').addEventListener('click', () => closePane(pane));
  star.addEventListener('click', pane.toggleBookmark);
  keyBtn.addEventListener('click', () => Vault.fillPane(pane));
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

// one tab = one live <webview>; background tabs stay alive (display:none, not destroyed)
function addTab(pane, url) {
  const view = document.createElement('webview');
  view.className = 'view';
  view.setAttribute('partition', 'persist:split');
  view.setAttribute('allowpopups', '');
  pane.viewsBox.appendChild(view);
  view.setAttribute('src', url || SETTINGS.home);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = '<img class="tabfav" alt="" hidden /><span class="tabtitle">New tab</span><button class="tabclose" title="Close tab">&#215;</button>';
  pane.tabstrip.insertBefore(tabEl, pane.tabstrip.querySelector('.newtab'));

  const tab = { view, tabEl, title: 'New tab', favicon: '', url: url || '', zoom: 1, muted: false, loading: false, audio: false };
  const tfav = tabEl.querySelector('.tabfav');
  const ttitle = tabEl.querySelector('.tabtitle');
  const active = () => pane.activeTab === tab;

  view.addEventListener('did-navigate', () => { tab.url = view.getURL(); if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); } saveSession(); });
  view.addEventListener('did-navigate-in-page', () => { tab.url = view.getURL(); if (active()) pane.syncAddr(); });
  view.addEventListener('dom-ready', () => { if (active()) { pane.syncAddr(); pane.refreshStar(); Vault.refreshPaneKey(pane); } });
  view.addEventListener('did-start-loading', () => { tab.loading = true; tabEl.classList.add('loading'); if (active()) pane.spin.hidden = false; });
  view.addEventListener('did-stop-loading', () => { tab.loading = false; tabEl.classList.remove('loading'); if (active()) { pane.spin.hidden = true; pane.syncAddr(); } const u = view.getURL(); if (/^https?:/.test(u)) api.historyAdd({ url: u, title: tab.title }); });
  view.addEventListener('page-title-updated', (e) => { tab.title = e.title || tab.url; ttitle.textContent = tab.title; tabEl.title = tab.title; if (active()) updateTitle(); });
  view.addEventListener('page-favicon-updated', (e) => { const f = (e.favicons || [])[0]; if (f) { tab.favicon = f; tfav.src = f; tfav.hidden = false; if (active()) { pane.fav.src = f; pane.fav.hidden = false; renderSetbar(); } } });
  view.addEventListener('update-target-url', (e) => { hoverEl.textContent = e.url || ''; });
  view.addEventListener('found-in-page', (e) => { if (active()) { const r = e.result; pane.findCount.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : 'no matches'; } });
  view.addEventListener('media-started-playing', () => { tab.audio = true; if (active()) pane.muteBtn.hidden = false; });
  view.addEventListener('ipc-message', (e) => {                               // signals from the webview preload
    if (e.channel === 'vault:capture') Vault.offerSave(pane, e.args[0]);       // login submitted -> "save this?"
    else if (e.channel === 'vault:loginfocus') Vault.offerFill(pane, e.args[0]); // login field focused -> "prefill?"
    else if (e.channel === 'vault:loginblur') Vault.hideFill(pane);
  });
  tfav.addEventListener('error', () => { tfav.hidden = true; });

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
  pane.fav.hidden = !tab.favicon; if (tab.favicon) pane.fav.src = tab.favicon;
  pane.spin.hidden = !tab.loading;
  pane.muteBtn.hidden = !(tab.muted || tab.audio); pane.muteBtn.innerHTML = tab.muted ? '&#128263;' : '&#128266;';
  pane.findbar.hidden = true; pane.findCount.textContent = '';
  pane.refreshStar(); Vault.refreshPaneKey(pane); updateTitle();
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
function updateInfo() {
  const lay = currentLayout === 'g2x2' ? ' · 2×2' : currentLayout === 'g3x3' ? ' · 3×3' : '';
  const setPart = sets.length > 1 ? 'set ' + (sets.indexOf(cur) + 1) + '/' + sets.length + ' · ' : '';
  infoEl.textContent = 'Splitser · ' + setPart + panes.length + (panes.length === 1 ? ' pane' : ' panes') + lay;
}

// ---- resizable grids: fr tracks separated by real 6px divider tracks, so CSS positions the
// dividers for us. Every internal gridline (both axes) is a draggable .gdiv; sizes persist. ----
function frLoad(key, n) {
  try { const a = JSON.parse(localStorage.getItem('fr-' + key) || 'null'); if (Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && x > 0)) return a; } catch (e) { /* ignore */ }
  return Array(n).fill(1);
}
function frSave(key, arr) { try { localStorage.setItem('fr-' + key, JSON.stringify(arr)); } catch (e) { /* ignore */ } }
function frTpl(arr) { return arr.map((f) => f.toFixed(4) + 'fr').join(' 6px '); }

function applyGrid(mode) {
  const n = mode === 'g2x2' ? 2 : 3;   // square grids: 2×2, 3×3
  cur.gCols = frLoad(mode + '-c', n); cur.gRows = frLoad(mode + '-r', n);
  grid.style.gap = '0'; grid.style.gridAutoRows = '1fr';
  grid.style.gridTemplateColumns = frTpl(cur.gCols);
  grid.style.gridTemplateRows = frTpl(cur.gRows);
  panes.forEach((p, i) => { p.el.style.gridColumn = String((i % n) * 2 + 1); p.el.style.gridRow = String(Math.floor(i / n) * 2 + 1); });
  grid.querySelectorAll('.gdiv').forEach((d) => d.remove());
  for (let c = 0; c < n - 1; c++) { const d = document.createElement('div'); d.className = 'gdiv x'; d.style.gridColumn = String(c * 2 + 2); d.style.gridRow = '1 / -1'; d.addEventListener('mousedown', (e) => startGridDrag(e, 'x', c)); grid.appendChild(d); }
  for (let r = 0; r < n - 1; r++) { const d = document.createElement('div'); d.className = 'gdiv y'; d.style.gridRow = String(r * 2 + 2); d.style.gridColumn = '1 / -1'; d.addEventListener('mousedown', (e) => startGridDrag(e, 'y', r)); grid.appendChild(d); }
  // diagonal handles where a column divider crosses a row divider: drag to resize both axes at once
  for (let c = 0; c < n - 1; c++) for (let r = 0; r < n - 1; r++) { const d = document.createElement('div'); d.className = 'gdiv xy'; d.style.gridColumn = String(c * 2 + 2); d.style.gridRow = String(r * 2 + 2); d.addEventListener('mousedown', (e) => startGridDragXY(e, c, r)); grid.appendChild(d); }
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

// layout: 'cols' (resizable columns) | 'g2x2' | 'g3x3'. `fill` tops up to the grid's cell count.
// Operates on the CURRENT set (via the mirrors). `save=false` while building sets at boot.
function setLayout(mode, fill, save = true) {
  currentLayout = mode; if (cur) cur.layout = mode;
  if (fill) {
    const need = mode === 'g2x2' ? 4 : mode === 'g3x3' ? 9 : 0;
    while (panes.length < need) makePane(SETTINGS.home);
  }
  grid.classList.remove('g2x2', 'g3x3');
  if (mode === 'cols') {
    grid.style.gridTemplateColumns = ''; grid.style.gridTemplateRows = ''; grid.style.gap = ''; grid.style.gridAutoRows = '';
    grid.querySelectorAll('.gdiv').forEach((d) => d.remove());
    panes.forEach((p) => { p.el.style.gridColumn = ''; p.el.style.gridRow = ''; p.el.style.flexGrow = '1'; });
    rebuildGutters();
  } else {
    grid.querySelectorAll('.gutter').forEach((g) => g.remove());
    grid.classList.add(mode);
    applyGrid(mode);
  }
  document.querySelectorAll('#layout-picker .lbtn').forEach((b) => b.classList.toggle('on', b.dataset.layout === mode));
  if (save) saveSession();
}

// ---- sets / workspaces: each set is its own grid; only the current one is shown, the rest
// stay in the DOM (display:none) so their webviews keep running. `cur` + the four mirrors are
// the current set; switchSet() re-points them. ----
function createSet() {
  const el = document.createElement('div'); el.className = 'gridset'; el.style.display = 'none';
  gridRoot.appendChild(el);
  const s = { el, panes: [], activePane: null, layout: 'cols', gCols: [], gRows: [] };
  sets.push(s); return s;
}
function bindCur(s) { cur = s; grid = s.el; panes = s.panes; activePane = s.activePane; currentLayout = s.layout; }
function switchSet(s) {
  if (!s) return;
  if (cur) cur.activePane = activePane;                 // persist the mirror to the outgoing set
  bindCur(s);
  sets.forEach((x) => { x.el.style.display = (x === s) ? '' : 'none'; });
  document.querySelectorAll('#layout-picker .lbtn').forEach((b) => b.classList.toggle('on', b.dataset.layout === s.layout));
  renderSetbar(); updateTitle(); updateInfo();
}
// build a set from saved specs (array of per-pane tab-URL arrays) without saving mid-build
function buildSet(layout, paneSpecs) {
  const s = createSet(); bindCur(s);
  (paneSpecs && paneSpecs.length ? paneSpecs : [[SETTINGS.home], [SETTINGS.home]]).forEach((t) => makePane(t[0], null, t));
  activePane = s.activePane = panes[0];
  setLayout(layout || 'cols', false, false);
  return s;
}
function newSet() {
  if (cur) cur.activePane = activePane;
  const s = buildSet('cols', [[SETTINGS.home], [SETTINGS.home]]);
  switchSet(s); saveSession();
  panes[0]?.addr.focus();
}
function closeSet(s) {
  if (sets.length <= 1) return;
  const i = sets.indexOf(s); s.el.remove(); sets.splice(i, 1);
  if (cur === s) { cur = null; switchSet(sets[Math.min(i, sets.length - 1)]); }
  else renderSetbar();
  saveSession();
}
function renderSetbar() {
  setbar.innerHTML = sets.map((s, i) => {
    const favs = s.panes.map((p) => p.activeTab && p.activeTab.favicon).filter(Boolean);
    const favHtml = favs.slice(0, 4).map((f) => '<img class="setfav" src="' + f.replace(/"/g, '&quot;') + '" alt="" />').join('') +
      (favs.length > 4 ? '<span class="setmore">+' + (favs.length - 4) + '</span>' : '');
    return '<button class="setpill' + (s === cur ? ' on' : '') + '" data-i="' + i + '" title="Set ' + (i + 1) + '">' +
      favHtml + '<span class="setnum">' + (i + 1) + '</span>' +
      (sets.length > 1 ? '<span class="setclose" data-i="' + i + '" title="Close set">&#215;</span>' : '') +
      '</button>';
  }).join('') + '<button class="setadd" title="New set (Ctrl+T)">+</button>';
}
setbar.addEventListener('click', (e) => {
  if (e.target.closest('.setadd')) return newSet();
  const pill = e.target.closest('.setpill'); if (!pill) return;
  const i = +pill.dataset.i;
  if (e.target.closest('.setclose')) { e.stopPropagation(); closeSet(sets[i]); }
  else if (sets[i] !== cur) switchSet(sets[i]);
});

// ---- session persistence ----
let sessTimer;
function saveSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    if (cur) cur.activePane = activePane;
    const data = {
      v: 2, active: Math.max(0, sets.indexOf(cur)),
      sets: sets.map((s) => ({
        layout: s.layout,
        panes: s.panes.map((p) => p.tabs.map((t) => t.view.getURL()).filter((u) => /^https?:/.test(u))).filter((a) => a.length)
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
  else if (k === 'w') { if (p && p.activeTab) closeTab(p, p.activeTab); }               // close TAB (last tab -> pane; last pane -> set)
  else if (k === 'r') p?.view.reload();
  else if (k === 'f') p?.openFind();
  else if (k === 'm') p?.toggleMute();
  else if (k === 'd') p?.toggleBookmark();
  else if (k === 'k') Vault.togglePanel();
  else if (k === '1') setLayout('cols', false);
  else if (k === '2') setLayout('g2x2', true);
  else if (k === '3') setLayout('g3x3', true);
  else if (k === '=' || k === '+') { if (p) p.setZoom(p.zoom + 0.1); }
  else if (k === '-') { if (p) p.setZoom(p.zoom - 0.1); }
  else if (k === '0') p?.setZoom(1);
}
api.onShortcut(handleShortcut);
api.onOpenPane((url) => { const p = makePane(url, active() ? active().el.nextElementSibling : null); rebuildGutters(); saveSession(); activePane = p; });

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
});

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

// close panels when clicking into any pane (bubbles up to the sets root)
gridRoot.addEventListener('mousedown', () => { document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; }); }, true);

// ---- boot: restore last session (v2 sets, or legacy flat), else the two demo panes ----
SETTINGS = await api.settingsGet();
const saved = await api.sessionGet();
if (saved && saved.v === 2 && Array.isArray(saved.sets) && saved.sets.length) {
  saved.sets.forEach((s) => buildSet(s.layout || 'cols', Array.isArray(s.panes) ? s.panes : []));
  switchSet(sets[Math.min(saved.active || 0, sets.length - 1)]);
} else if (Array.isArray(saved) && saved.length) {                 // legacy single-set session
  buildSet('cols', saved.map((e) => Array.isArray(e) ? e : [e]));
  switchSet(sets[0]);
} else {
  buildSet('cols', [['https://github.com'], ['https://dashboard.stripe.com']]);
  switchSet(sets[0]);
}
Vault.init({ api, getPanes: () => panes, getActive: () => active() });

// layout picker (status bar) applies to the current set
document.getElementById('layout-picker').addEventListener('click', (e) => {
  const b = e.target.closest('.lbtn'); if (b) setLayout(b.dataset.layout, true);
});
