// Phase 1 shell + Phase 2 native wins. Panes are resizable columns of real <webview>s.
// Phase 2 adds: target=_blank -> new pane (via main), native find-in-page (webview.findInPage),
// per-pane zoom, and per-pane mute -- all built-in webview APIs the extension has to fake.

const grid = document.getElementById('grid');
const hoverEl = document.getElementById('hoverurl');
const infoEl = document.getElementById('paneinfo');
const HOME = 'https://duckduckgo.com';

const panes = [];
let activePane = null;

function normalize(s) {
  s = s.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(s)) return 'https://' + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

const BAR = `
  <div class="bar">
    <button class="nav back" title="Back" aria-label="Back">&#8249;</button>
    <button class="nav fwd" title="Forward" aria-label="Forward">&#8250;</button>
    <button class="nav reload" title="Reload" aria-label="Reload">&#8635;</button>
    <img class="fav" alt="" hidden />
    <input class="addr" type="text" spellcheck="false" autocomplete="off"
           aria-label="Address" placeholder="Search or enter address" />
    <span class="spin" hidden aria-hidden="true"></span>
    <button class="nav mute" title="Mute pane (Ctrl+M)" aria-label="Mute pane" hidden>&#128266;</button>
    <button class="nav split" title="New pane (Ctrl+T)" aria-label="New pane">+</button>
    <button class="nav close" title="Close pane (Ctrl+W)" aria-label="Close pane">&#215;</button>
  </div>`;

const FINDBAR = `
  <div class="findbar" hidden>
    <input class="find-input" type="text" spellcheck="false" placeholder="Find in page" aria-label="Find in page" />
    <span class="find-count" aria-live="polite"></span>
    <button class="find-btn find-prev" title="Previous (Shift+Enter)" aria-label="Previous">&#8593;</button>
    <button class="find-btn find-next" title="Next (Enter)" aria-label="Next">&#8595;</button>
    <button class="find-btn find-close" title="Close (Esc)" aria-label="Close find">&#215;</button>
  </div>`;

function makePane(url = HOME, beforeEl = null) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.style.flexGrow = '1';
  el.innerHTML = BAR + FINDBAR + '<webview class="view" partition="persist:split" allowpopups></webview>';
  grid.insertBefore(el, beforeEl);

  const view = el.querySelector('.view');
  const addr = el.querySelector('.addr');
  const spin = el.querySelector('.spin');
  const fav = el.querySelector('.fav');
  const muteBtn = el.querySelector('.mute');
  const findbar = el.querySelector('.findbar');
  const findInput = el.querySelector('.find-input');
  const findCount = el.querySelector('.find-count');
  const pane = { el, view, addr, title: '', zoom: 1, muted: false };
  panes.push(pane);

  view.setAttribute('src', url);
  const syncAddr = () => { const u = view.getURL(); if (u && u !== 'about:blank') addr.value = u; };

  // --- address + navigation ---
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const u = normalize(addr.value); if (u) view.loadURL(u); view.focus(); }
  });
  addr.addEventListener('focus', () => { activePane = pane; addr.select(); });
  el.addEventListener('mousedown', () => { activePane = pane; }, true);
  el.querySelector('.back').addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
  el.querySelector('.fwd').addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
  el.querySelector('.reload').addEventListener('click', () => view.reload());
  el.querySelector('.split').addEventListener('click', () => {
    const p = makePane(HOME, el.nextElementSibling); rebuildGutters(); p.addr.focus();
  });
  el.querySelector('.close').addEventListener('click', () => closePane(pane));

  // --- find in page (native) ---
  pane.openFind = () => { findbar.hidden = false; findInput.focus(); findInput.select();
    if (findInput.value) view.findInPage(findInput.value); };
  pane.closeFind = () => { findbar.hidden = true; findCount.textContent = ''; view.stopFindInPage('clearSelection'); view.focus(); };
  findInput.addEventListener('input', () => {
    if (findInput.value) view.findInPage(findInput.value);
    else { view.stopFindInPage('clearSelection'); findCount.textContent = ''; }
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: !e.shiftKey }); }
    else if (e.key === 'Escape') { e.preventDefault(); pane.closeFind(); }
  });
  el.querySelector('.find-prev').addEventListener('click', () => { if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: false }); });
  el.querySelector('.find-next').addEventListener('click', () => { if (findInput.value) view.findInPage(findInput.value, { findNext: true, forward: true }); });
  el.querySelector('.find-close').addEventListener('click', () => pane.closeFind());
  view.addEventListener('found-in-page', (e) => {
    const r = e.result; findCount.textContent = r.matches ? r.activeMatchOrdinal + '/' + r.matches : 'no matches';
  });

  // --- zoom + mute (native, per pane) ---
  pane.setZoom = (z) => { pane.zoom = Math.max(0.4, Math.min(3, z)); view.setZoomFactor(pane.zoom); };
  pane.toggleMute = () => { pane.muted = !pane.muted; view.setAudioMuted(pane.muted);
    muteBtn.hidden = false; muteBtn.innerHTML = pane.muted ? '&#128263;' : '&#128266;'; };
  muteBtn.addEventListener('click', pane.toggleMute);
  view.addEventListener('media-started-playing', () => { muteBtn.hidden = false; });

  // --- native page events ---
  view.addEventListener('did-navigate', syncAddr);
  view.addEventListener('did-navigate-in-page', syncAddr);
  view.addEventListener('dom-ready', syncAddr);
  view.addEventListener('did-start-loading', () => { spin.hidden = false; });
  view.addEventListener('did-stop-loading', () => { spin.hidden = true; syncAddr(); });
  view.addEventListener('page-title-updated', (e) => { pane.title = e.title; updateTitle(); });
  view.addEventListener('page-favicon-updated', (e) => { const f = (e.favicons || [])[0]; if (f) { fav.src = f; fav.hidden = false; } });
  view.addEventListener('update-target-url', (e) => { hoverEl.textContent = e.url || ''; });
  fav.addEventListener('error', () => { fav.hidden = true; });

  return pane;
}

function closePane(pane) {
  if (panes.length <= 1) { pane.view.loadURL(HOME); return; }  // never zero panes
  const i = panes.indexOf(pane);
  panes.splice(i, 1);
  pane.el.remove();
  if (activePane === pane) activePane = panes[Math.min(i, panes.length - 1)] || null;
  rebuildGutters();
  updateTitle();
}

function rebuildGutters() {
  grid.querySelectorAll('.gutter').forEach((g) => g.remove());
  const paneEls = [...grid.querySelectorAll('.pane')];
  paneEls.forEach((pe, idx) => {
    if (idx < paneEls.length - 1) {
      const g = document.createElement('div');
      g.className = 'gutter';
      grid.insertBefore(g, pe.nextSibling);
      g.addEventListener('mousedown', startDrag);
    }
  });
  updateInfo();
}

function startDrag(e) {
  e.preventDefault();
  const gutter = e.currentTarget;
  const leftEl = gutter.previousElementSibling;
  const rightEl = gutter.nextElementSibling;
  if (!leftEl || !rightEl) return;
  const combinedPx = leftEl.offsetWidth + rightEl.offsetWidth;
  const combinedGrow = (parseFloat(leftEl.style.flexGrow) || 1) + (parseFloat(rightEl.style.flexGrow) || 1);
  const startX = e.clientX;
  const startLeftPx = leftEl.offsetWidth;
  const shield = document.createElement('div');
  shield.className = 'drag-shield';
  document.body.appendChild(shield);
  const onMove = (ev) => {
    let leftPx = startLeftPx + (ev.clientX - startX);
    leftPx = Math.max(90, Math.min(combinedPx - 90, leftPx));
    const ratio = leftPx / combinedPx;
    leftEl.style.flexGrow = (combinedGrow * ratio).toFixed(4);
    rightEl.style.flexGrow = (combinedGrow * (1 - ratio)).toFixed(4);
  };
  const onUp = () => { shield.remove(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function updateTitle() {
  const p = activePane || panes[0];
  document.title = (p && p.title) ? p.title + ' — Split' : 'Split';
}
function updateInfo() {
  infoEl.textContent = panes.length + (panes.length === 1 ? ' pane' : ' panes') + ' · Split';
}
const active = () => activePane || panes[0];

// shell shortcuts arrive from main.js (forwarded so they fire even while a webview has
// focus, since webview key events don't bubble to the host). Each routes to the active pane.
function handleShortcut(k) {
  const p = active();
  if (k === 'l') p?.addr.focus();
  else if (k === 't') { const np = makePane(HOME); rebuildGutters(); np.addr.focus(); }
  else if (k === 'w') { if (p) closePane(p); }
  else if (k === 'r') p?.view.reload();
  else if (k === 'f') p?.openFind();
  else if (k === 'm') p?.toggleMute();
  else if (k === '=' || k === '+') { if (p) p.setZoom(p.zoom + 0.1); }
  else if (k === '-') { if (p) p.setZoom(p.zoom - 0.1); }
  else if (k === '0') p?.setZoom(1);
}
window.splitAPI?.onShortcut(handleShortcut);

// a page opening target=_blank / window.open -> a new pane beside the active one (via main.js)
window.splitAPI?.onOpenPane((url) => {
  const p = makePane(url, active() ? active().el.nextElementSibling : null);
  rebuildGutters();
  activePane = p;
});

// boot: two panes on sites an iframe can only frame by gutting their CSP -- now first-class views
makePane('https://github.com');
makePane('https://dashboard.stripe.com');
rebuildGutters();
activePane = panes[0];
