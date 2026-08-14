// Splitser dynamic theming, ported from the Split Screen extension. A theme is
// { bg, bar, accent, text, img, dim }: four colours applied as CSS variables, plus
// an optional banner image painted as a fixed strip behind the top chrome (set-bar
// + tab strips + toolbars), which go translucent so one image spans them all.
// Persisted in localStorage so it applies before the panes render (no flash).

const PRESETS = {                                   // colour-only (leave the banner)
  Default:  { bg: '#0e1418', bar: '#12181d', accent: '#5fe08a', text: '#e7e3d6' },
  Navy:     { bg: '#001028', bar: '#0a1834', accent: '#5b9dff', text: '#f2f5fa' },
  Graphite: { bg: '#17191c', bar: '#232629', accent: '#8ab4f8', text: '#f2f3f5' },
  Forest:   { bg: '#0d1f16', bar: '#123024', accent: '#4ade80', text: '#eaf5ee' },
  Plum:     { bg: '#1d1230', bar: '#2a1a45', accent: '#c084fc', text: '#f4eefc' },
  Paper:    { bg: '#eceef2', bar: '#f7f8fa', accent: '#1a56db', text: '#1b1f24' },
  Crimson:  { bg: '#1a0d10', bar: '#2a141a', accent: '#fb7185', text: '#fbe9ec' },
  Mint:     { bg: '#08201c', bar: '#0f312b', accent: '#2dd4bf', text: '#e6faf5' },
  Amber:    { bg: '#1c1503', bar: '#2c2208', accent: '#fbbf24', text: '#fbf4e2' },
  Slate:    { bg: '#0f172a', bar: '#1e293b', accent: '#94a3b8', text: '#eef2f7' }
};
const BANNERS = {                                   // bundled photographic banners
  Sunset: 'banners/sunset.png', Ocean: 'banners/ocean.png', Twilight: 'banners/twilight.png',
  Forest: 'banners/forest.png', Aurora: 'banners/aurora.png', America: 'banners/america.png', Bubbles: 'banners/bubbles.png'
};
const LOOKS = {                                     // one-click: colours + a coordinated banner
  Bubbles:  { bg: '#272027', bar: '#3a303a', accent: '#cf9be0', text: '#eae6ea', img: 'banners/bubbles.png' },
  Sunset:   { bg: '#1a0f0a', bar: '#2a1810', accent: '#f59e0b', text: '#fdf0e6', img: 'banners/sunset.png' },
  Ocean:    { bg: '#04141f', bar: '#0a2434', accent: '#22d3ee', text: '#e6f6fb', img: 'banners/ocean.png' },
  Twilight: { bg: '#14091f', bar: '#221033', accent: '#c084fc', text: '#f4eefc', img: 'banners/twilight.png' },
  Woods:    { bg: '#0a1a0f', bar: '#122a1a', accent: '#4ade80', text: '#eafaf0', img: 'banners/forest.png' },
  Aurora:   { bg: '#0a1020', bar: '#141c32', accent: '#8ab4f8', text: '#eef2fb', img: 'banners/aurora.png' },
  America:  { bg: '#242c37', bar: '#364252', accent: '#6aa9ff', text: '#eaedf2', img: 'banners/america.png' }
};
const DEFAULT = { ...PRESETS.Default, img: '', dim: 35 };

let theme = { ...DEFAULT };
let panelEl, bodyEl, btn;

function load() { try { const t = JSON.parse(localStorage.getItem('theme') || 'null'); if (t && typeof t === 'object') theme = { ...DEFAULT, ...t }; } catch (e) { /* defaults */ } }
function persist() { try { localStorage.setItem('theme', JSON.stringify(theme)); } catch (e) { /* ignore */ } }

function apply() {
  const r = document.documentElement.style, t = theme;
  r.setProperty('--bg', t.bg);
  r.setProperty('--chrome', t.bar);
  r.setProperty('--text', t.text);
  r.setProperty('--accent', t.accent);
  // derive the rest from the four so any theme stays coherent (Chromium 128 has color-mix)
  r.setProperty('--muted', `color-mix(in srgb, ${t.text} 46%, ${t.bar})`);
  r.setProperty('--line', `color-mix(in srgb, ${t.text} 12%, ${t.bar})`);
  r.setProperty('--line-2', `color-mix(in srgb, ${t.text} 22%, ${t.bar})`);
  r.setProperty('--field', `color-mix(in srgb, ${t.bg} 72%, ${t.bar})`);
  r.setProperty('--field-focus', `color-mix(in srgb, ${t.bg} 55%, ${t.bar})`);
  r.setProperty('--surface', `color-mix(in srgb, ${t.bg} 82%, ${t.text})`);
  r.setProperty('--surface-2', `color-mix(in srgb, ${t.bg} 90%, ${t.text})`);
  r.setProperty('--bg-img', t.img ? `url("${t.img}")` : 'none');
  r.setProperty('--dim', (t.dim ?? 35) / 100);
  document.body.classList.toggle('has-bgimg', !!t.img);
  remeasure();
}
// banner strip height = set-bar + one pane's tab strip + toolbar; the overshoot hides behind opaque panes
function remeasure() {
  const setbar = document.getElementById('setbar');
  const pane = document.querySelector('.pane');
  const strip = pane && pane.querySelector('.tabstrip');
  const bar = pane && pane.querySelector('.bar');
  const h = (setbar ? setbar.offsetHeight : 30) + (strip ? strip.offsetHeight : 28) + (bar ? bar.offsetHeight : 44);
  document.documentElement.style.setProperty('--banner-h', h + 'px');
}
function set(patch) { theme = { ...theme, ...patch }; apply(); persist(); renderPanel(); }

function renderPanel() {
  if (!bodyEl) return;
  const chip = (name, c, kind) =>
    `<button class="th-chip" data-kind="${kind}" data-name="${name}" title="${name}" style="background:${c.bar}">` +
    `<i style="background:${c.bg}"></i><i style="background:${c.accent}"></i></button>`;
  const looks = Object.entries(LOOKS).map(([n, c]) => chip(n, c, 'look')).join('');
  const presets = Object.entries(PRESETS).map(([n, c]) => chip(n, c, 'preset')).join('');
  const bans = Object.entries(BANNERS).map(([n, p]) =>
    `<button class="th-ban${theme.img === p ? ' on' : ''}" data-ban="${p}" title="${n}" style="background-image:url(${p})"></button>`).join('');
  bodyEl.innerHTML = `
    <div class="th-row"><span class="th-lbl">Looks</span><div class="th-wrap">${looks}</div></div>
    <div class="th-row"><span class="th-lbl">Colors</span><div class="th-wrap">${presets}</div></div>
    <div class="th-row"><span class="th-lbl">Backdrop</span><div class="th-wrap">${bans}` +
      `<button class="th-ban th-none${!theme.img ? ' on' : ''}" data-ban="" title="No image">&#8856;</button>` +
      `<label class="th-ban th-file" title="Custom image">&#128247;<input id="th-file" type="file" accept="image/*" hidden /></label></div></div>
    <div class="th-row${theme.img ? '' : ' th-hide'}"><span class="th-lbl">Overlay</span>` +
      `<input id="th-dim" class="th-range" type="range" min="0" max="85" value="${theme.dim ?? 35}" /><span class="th-dimval">${theme.dim ?? 35}%</span></div>
    <div class="th-row"><span class="th-lbl">Accent</span><input id="th-accent" class="th-color" type="color" value="${theme.accent}" />` +
      `<button class="th-btn" id="th-reset">Reset</button></div>`;
  bodyEl.querySelectorAll('.th-chip').forEach((b) => { b.onclick = () => {
    const src = b.dataset.kind === 'look' ? LOOKS[b.dataset.name] : PRESETS[b.dataset.name];
    set(b.dataset.kind === 'look' ? { ...src } : { bg: src.bg, bar: src.bar, accent: src.accent, text: src.text });
  }; });
  bodyEl.querySelectorAll('.th-ban[data-ban]').forEach((b) => { b.onclick = () => set({ img: b.dataset.ban }); });
  const dim = bodyEl.querySelector('#th-dim'); if (dim) dim.oninput = () => set({ dim: +dim.value });
  bodyEl.querySelector('#th-accent').oninput = (e) => set({ accent: e.target.value });
  bodyEl.querySelector('#th-reset').onclick = () => set({ ...DEFAULT });
  const file = bodyEl.querySelector('#th-file');
  if (file) file.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => set({ img: rd.result }); rd.readAsDataURL(f); };
}

function togglePanel() {
  const open = panelEl.hidden;
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
  panelEl.hidden = !open;
  if (!panelEl.hidden) renderPanel();
}

// apply colours immediately (before panes exist) so there's no flash; init() wires the UI later
load();
if (document.body) apply();

export const Theme = {
  init() {
    panelEl = document.getElementById('panel-theme');
    bodyEl = document.getElementById('theme-body');
    btn = document.getElementById('btn-theme');
    if (btn) btn.addEventListener('click', () => togglePanel());
    apply(); renderPanel();
    window.addEventListener('resize', remeasure);
  },
  remeasure
};
