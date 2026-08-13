// Phase 1 -- the tiling shell. A dynamic set of panes laid out as resizable columns.
// Each pane is a real <webview> with its own toolbar (back/fwd/reload, favicon, address,
// split, close). Draggable gutters between panes resize the neighbours. Everything the
// extension fakes with postMessage + a header-strip is a native webview call/event here.

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
    <button class="nav split" title="Split &mdash; new pane (Ctrl+T)" aria-label="New pane">+</button>
    <button class="nav close" title="Close pane (Ctrl+W)" aria-label="Close pane">&#215;</button>
  </div>`;

function makePane(url = HOME, beforeEl = null) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.style.flexGrow = '1';
  el.innerHTML = BAR + '<webview class="view" partition="persist:split" allowpopups></webview>';
  grid.insertBefore(el, beforeEl);

  const view = el.querySelector('.view');
  const addr = el.querySelector('.addr');
  const spin = el.querySelector('.spin');
  const fav = el.querySelector('.fav');
  const pane = { el, view, addr, title: '' };
  panes.push(pane);

  view.setAttribute('src', url);

  const syncAddr = () => { const u = view.getURL(); if (u && u !== 'about:blank') addr.value = u; };

  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const u = normalize(addr.value); if (u) view.loadURL(u); view.focus(); }
  });
  addr.addEventListener('focus', () => { activePane = pane; addr.select(); });
  el.addEventListener('mousedown', () => { activePane = pane; }, true);

  el.querySelector('.back').addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
  el.querySelector('.fwd').addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
  el.querySelector('.reload').addEventListener('click', () => view.reload());
  el.querySelector('.split').addEventListener('click', () => {
    const p = makePane(HOME, el.nextElementSibling);  // insert right after this pane
    rebuildGutters(); p.addr.focus();
  });
  el.querySelector('.close').addEventListener('click', () => closePane(pane));

  view.addEventListener('did-navigate', syncAddr);
  view.addEventListener('did-navigate-in-page', syncAddr);
  view.addEventListener('dom-ready', syncAddr);
  view.addEventListener('did-start-loading', () => { spin.hidden = false; });
  view.addEventListener('did-stop-loading', () => { spin.hidden = true; syncAddr(); });
  view.addEventListener('page-title-updated', (e) => { pane.title = e.title; updateTitle(); });
  view.addEventListener('page-favicon-updated', (e) => {
    const f = (e.favicons || [])[0];
    if (f) { fav.src = f; fav.hidden = false; }
  });
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

// gutters live between adjacent panes; rebuilt on every add/remove
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

  // a full-window shield so the webviews don't swallow the drag
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
  const onUp = () => {
    shield.remove();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
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

// shell-level keyboard shortcuts (the shell-reload/close keys are neutralized in main.js)
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'l') { e.preventDefault(); (activePane || panes[0])?.addr.focus(); }
  else if (k === 't') { e.preventDefault(); const p = makePane(HOME); rebuildGutters(); p.addr.focus(); }
  else if (k === 'w') { e.preventDefault(); if (activePane || panes[0]) closePane(activePane || panes[0]); }
  else if (k === 'r') { e.preventDefault(); (activePane || panes[0])?.view.reload(); }
});

// boot: two panes on sites an iframe can't embed -- now closable, splittable, resizable
makePane('https://github.com');
makePane('https://dashboard.stripe.com');
rebuildGutters();
activePane = panes[0];
