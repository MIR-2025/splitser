// Splitser renderer. Phase 1 tiling shell + Phase 2 native wins + Phase 3 data layer:
// history-backed address autocomplete, bookmarks, session restore, downloads, settings.
const api = window.splitAPI;
const grid = document.getElementById('grid');
const hoverEl = document.getElementById('hoverurl');
const infoEl = document.getElementById('paneinfo');

const panes = [];
let activePane = null;
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

function makePane(url, beforeEl = null) {
  url = url || SETTINGS.home;
  const el = document.createElement('section');
  el.className = 'pane';
  el.style.flexGrow = '1';
  el.innerHTML = BAR + FINDBAR + '<div class="suggest" hidden></div>' +
    '<webview class="view" partition="persist:split" allowpopups></webview>';
  grid.insertBefore(el, beforeEl);

  const view = el.querySelector('.view');
  const addr = el.querySelector('.addr');
  const spin = el.querySelector('.spin');
  const fav = el.querySelector('.fav');
  const star = el.querySelector('.star');
  const muteBtn = el.querySelector('.mute');
  const suggest = el.querySelector('.suggest');
  const findbar = el.querySelector('.findbar');
  const findInput = el.querySelector('.find-input');
  const findCount = el.querySelector('.find-count');
  const pane = { el, view, addr, star, title: '', zoom: 1, muted: false, sugIdx: -1, sugs: [] };
  panes.push(pane);
  view.setAttribute('src', url);

  const syncAddr = () => { const u = view.getURL(); if (u && u !== 'about:blank' && document.activeElement !== addr) addr.value = u; };

  // ---- address bar + history autocomplete ----
  let sugTimer;
  addr.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = addr.value;
    if (!q) return hideSuggest(pane);
    sugTimer = setTimeout(async () => {
      if (document.activeElement !== addr) return;
      pane.sugs = await api.historyQuery(q);
      renderSuggest(pane);
    }, 110);
  });
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(pane, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(pane, -1); }
    else if (e.key === 'Enter') {
      const chosen = pane.sugIdx >= 0 && pane.sugs[pane.sugIdx] ? pane.sugs[pane.sugIdx].url : normalize(addr.value);
      hideSuggest(pane); if (chosen) view.loadURL(chosen); view.focus();
    } else if (e.key === 'Escape') { hideSuggest(pane); }
  });
  addr.addEventListener('focus', () => { activePane = pane; addr.select(); });
  addr.addEventListener('blur', () => setTimeout(() => hideSuggest(pane), 160));
  suggest.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.sug'); if (!item) return;
    e.preventDefault(); const u = item.dataset.url; hideSuggest(pane); view.loadURL(u);
  });

  el.addEventListener('mousedown', () => { activePane = pane; }, true);
  el.querySelector('.back').addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
  el.querySelector('.fwd').addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
  el.querySelector('.reload').addEventListener('click', () => view.reload());
  el.querySelector('.split').addEventListener('click', () => { const p = makePane(SETTINGS.home, el.nextElementSibling); rebuildGutters(); saveSession(); p.addr.focus(); });
  el.querySelector('.close').addEventListener('click', () => closePane(pane));

  // ---- bookmarks (star) ----
  pane.refreshStar = async () => {
    const u = view.getURL();
    const on = /^https?:/.test(u) ? await api.bookmarkHas(u) : false;
    star.innerHTML = on ? '&#9733;' : '&#9734;'; star.classList.toggle('on', on);
  };
  pane.toggleBookmark = async () => {
    const u = view.getURL(); if (!/^https?:/.test(u)) return;
    const on = await api.bookmarkToggle({ url: u, title: pane.title || u });
    star.innerHTML = on ? '&#9733;' : '&#9734;'; star.classList.toggle('on', on);
    if (!document.getElementById('panel-bookmarks').hidden) renderBookmarks();
  };
  star.addEventListener('click', pane.toggleBookmark);

  // ---- find ----
  pane.openFind = () => { findbar.hidden = false; findInput.focus(); findInput.select(); if (findInput.value) view.findInPage(findInput.value); };
  pane.closeFind = () => { findbar.hidden = true; findCount.textContent = ''; view.stopFindInPage('clearSelection'); view.focus(); };
  findInput.addEventListener('input', () => { if (findInput.value) view.findInPage(findInput.value); else { view.stopFindInPage('clearSelection'); findCount.textContent = ''; } });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: !e.shiftKey }); }
    else if (e.key === 'Escape') { e.preventDefault(); pane.closeFind(); }
  });
  el.querySelector('.find-prev').addEventListener('click', () => { if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: false }); });
  el.querySelector('.find-next').addEventListener('click', () => { if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: true }); });
  el.querySelector('.find-close').addEventListener('click', () => pane.closeFind());
  view.addEventListener('found-in-page', (e) => { const r = e.result; findCount.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : 'no matches'; });

  // ---- zoom + mute ----
  pane.setZoom = (z) => { pane.zoom = Math.max(0.4, Math.min(3, z)); view.setZoomFactor(pane.zoom); };
  pane.toggleMute = () => { pane.muted = !pane.muted; view.setAudioMuted(pane.muted); muteBtn.hidden = false; muteBtn.innerHTML = pane.muted ? '&#128263;' : '&#128266;'; };
  muteBtn.addEventListener('click', pane.toggleMute);
  view.addEventListener('media-started-playing', () => { muteBtn.hidden = false; });

  // ---- page events ----
  view.addEventListener('did-navigate', () => { syncAddr(); saveSession(); pane.refreshStar(); });
  view.addEventListener('did-navigate-in-page', syncAddr);
  view.addEventListener('dom-ready', () => { syncAddr(); pane.refreshStar(); });
  view.addEventListener('did-start-loading', () => { spin.hidden = false; });
  view.addEventListener('did-stop-loading', () => {
    spin.hidden = true; syncAddr();
    const u = view.getURL(); if (/^https?:/.test(u)) api.historyAdd({ url: u, title: pane.title || u });
  });
  view.addEventListener('page-title-updated', (e) => { pane.title = e.title; updateTitle(); });
  view.addEventListener('page-favicon-updated', (e) => { const f = (e.favicons || [])[0]; if (f) { fav.src = f; fav.hidden = false; } });
  view.addEventListener('update-target-url', (e) => { hoverEl.textContent = e.url || ''; });
  fav.addEventListener('error', () => { fav.hidden = true; });

  return pane;
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
  if (panes.length <= 1) { pane.view.loadURL(SETTINGS.home); return; }
  const i = panes.indexOf(pane);
  panes.splice(i, 1); pane.el.remove();
  if (activePane === pane) activePane = panes[Math.min(i, panes.length - 1)] || null;
  rebuildGutters(); updateTitle(); saveSession();
}

function rebuildGutters() {
  grid.querySelectorAll('.gutter').forEach((g) => g.remove());
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
function updateInfo() { infoEl.textContent = 'Splitser · ' + panes.length + (panes.length === 1 ? ' pane' : ' panes'); }

// ---- session persistence ----
let sessTimer;
function saveSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => { api.sessionSet(panes.map((p) => p.view.getURL()).filter((u) => /^https?:/.test(u))); }, 700);
}

// ---- shortcuts (forwarded from main) ----
function handleShortcut(k) {
  const p = active();
  if (k === 'l') p?.addr.focus();
  else if (k === 't') { const np = makePane(SETTINGS.home); rebuildGutters(); saveSession(); np.addr.focus(); }
  else if (k === 'w') { if (p) closePane(p); }
  else if (k === 'r') p?.view.reload();
  else if (k === 'f') p?.openFind();
  else if (k === 'm') p?.toggleMute();
  else if (k === 'd') p?.toggleBookmark();
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
  [panelBM, panelDL, panelSet].forEach((p) => { p.hidden = true; });
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

// close panels when clicking into a pane
grid.addEventListener('mousedown', () => { [panelBM, panelDL, panelSet].forEach((p) => { p.hidden = true; }); }, true);

// ---- boot: restore last session, else the two demo panes ----
SETTINGS = await api.settingsGet();
const saved = await api.sessionGet();
if (saved && saved.length) saved.forEach((u) => makePane(u));
else { makePane('https://github.com'); makePane('https://dashboard.stripe.com'); }
rebuildGutters();
activePane = panes[0];
