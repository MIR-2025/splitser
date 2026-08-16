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
const BANNER_DEFS = {                               // zero-asset gradient banners (rendered to SVG data URLs)
  Dusk:  ['#2d1b4e', '#5b21b6', '#db2777'],
  Ember: ['#7c2d12', '#c2410c', '#f59e0b'],
  Tide:  ['#083344', '#0e7490', '#22d3ee'],
  Steel: ['#0f172a', '#334155', '#64748b']
};
const LOOKS = {                                     // one-click: colours + a coordinated banner
  Bubbles:  { bg: '#272027', bar: '#3a303a', accent: '#cf9be0', text: '#eae6ea', img: 'banners/bubbles.png' },
  Sunset:   { bg: '#1a0f0a', bar: '#2a1810', accent: '#f59e0b', text: '#fdf0e6', img: 'banners/sunset.png' },
  Ocean:    { bg: '#04141f', bar: '#0a2434', accent: '#22d3ee', text: '#e6f6fb', img: 'banners/ocean.png' },
  Twilight: { bg: '#14091f', bar: '#221033', accent: '#c084fc', text: '#f4eefc', img: 'banners/twilight.png' },
  Woods:    { bg: '#0a1a0f', bar: '#122a1a', accent: '#4ade80', text: '#eafaf0', img: 'banners/forest.png' },
  Aurora:   { bg: '#0a1020', bar: '#141c32', accent: '#8ab4f8', text: '#eef2fb', img: 'banners/aurora.png' },
  America:  { bg: '#242c37', bar: '#364252', accent: '#6aa9ff', text: '#eaedf2', img: 'banners/america.png' },
  Mono:     { bg: '#0f1115', bar: '#1b1f26', accent: '#94a3b8', text: '#e7ebf1', banner: 'Steel' }
};
const DEFAULT = { ...PRESETS.Default, img: '', dim: 35 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A gradient banner renders to an SVG data URL that flows through the same theme.img pipeline as a photo.
function svgGradient(colors) {
  const n = Math.max(1, colors.length - 1);
  const stops = colors.map((c, i) => `<stop offset='${Math.round((i / n) * 100)}%' stop-color='${c}'/>`).join('');
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='120'>" +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='0'>${stops}</linearGradient></defs>` +
    "<rect width='1920' height='120' fill='url(#g)'/></svg>";
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function bannerCss(colors) { return 'linear-gradient(90deg,' + colors.join(',') + ')'; }
function lookBanner(L) { return L.img || (L.banner ? svgGradient(BANNER_DEFS[L.banner] || []) : ''); }

let theme = { ...DEFAULT };
let customThemes = [];              // user-saved {name,bg,bar,accent,text,img,dim}, global + reusable
let draftName = '', draftImport = '', importOpen = false, noteMsg = '';
let panelEl, bodyEl, btn;
let onChangeCb = null;   // notified after a user edit, so the renderer can store the theme on the current set

function load() { try { const t = JSON.parse(localStorage.getItem('theme') || 'null'); if (t && typeof t === 'object') theme = { ...DEFAULT, ...t }; } catch (e) { /* defaults */ } }
function persist() { try { localStorage.setItem('theme', JSON.stringify(theme)); } catch (e) { /* ignore */ } }
function loadCustom() { try { const a = JSON.parse(localStorage.getItem('customThemes') || '[]'); if (Array.isArray(a)) customThemes = a; } catch (e) { customThemes = []; } }
function persistCustom() { try { localStorage.setItem('customThemes', JSON.stringify(customThemes)); } catch (e) { /* ignore */ } }

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
function bannerSize() {
  const setbar = document.getElementById('setbar');
  // measure a VISIBLE pane -- the first .pane in the DOM may live in a hidden set (display:none),
  // whose tab-strip/toolbar measure 0, which would collapse the banner to just the Workspaces bar.
  const pane = [...document.querySelectorAll('.pane')].find((p) => p.offsetParent !== null) || document.querySelector('.pane');
  const strip = pane && pane.querySelector('.tabstrip');
  const bar = pane && pane.querySelector('.bar');
  const h = (setbar ? setbar.offsetHeight : 30) + (strip ? strip.offsetHeight : 28) + (bar ? bar.offsetHeight : 44);
  return { w: Math.round(window.innerWidth), h };
}
function remeasure() { document.documentElement.style.setProperty('--banner-h', bannerSize().h + 'px'); }
function imgHint() {
  const { w, h } = bannerSize();
  return `Fills the top bar. Ideal <b>${w}&times;${h}px</b> -- a wide strip (~${Math.round(w / h)}:1). Stretched to fit, so match the shape and any width works.`;
}
function set(patch) { theme = { ...theme, ...patch }; apply(); persist(); renderPanel(); if (onChangeCb) onChangeCb({ ...theme }); }

// ---- custom themes: snapshot, save, delete, export, import ----
function themeSnapshot(name) {
  return { name: (name || 'My theme').toString().slice(0, 40), bg: theme.bg, bar: theme.bar, accent: theme.accent, text: theme.text, img: theme.img || '', dim: (typeof theme.dim === 'number') ? theme.dim : 35 };
}
function applyCustomTheme(t) { set({ bg: t.bg, bar: t.bar, accent: t.accent, text: t.text, img: t.img || '', dim: (typeof t.dim === 'number') ? t.dim : theme.dim }); }
function saveCurrentTheme() {
  const name = draftName.trim() || ('My theme ' + (customThemes.length + 1));
  const snap = themeSnapshot(name);
  const i = customThemes.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) customThemes[i] = snap; else customThemes.push(snap);   // same name overwrites
  persistCustom(); draftName = ''; notice('Saved "' + name + '"');
}
function deleteCustomTheme(name) { customThemes = customThemes.filter((t) => t.name !== name); persistCustom(); notice('Removed "' + name + '"'); }

// An imported image may only be a bundled banner or an inline data URL -- never a remote URL, so a
// shared theme can't quietly phone home when it paints.
function sanitizeThemeImg(img) {
  if (typeof img !== 'string' || !img) return '';
  if (img.startsWith('data:image/')) return img;
  if (/^banners\/[\w.-]+\.(png|jpe?g|webp|svg)$/i.test(img)) return img;
  return '';
}
function b64urlEncode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
function encodeTheme(t) { return 'SST1.' + b64urlEncode(JSON.stringify(t)); }
function decodeTheme(code) {
  let s = (code || '').trim(); const at = s.indexOf('SST1.'); if (at !== -1) s = s.slice(at + 5);
  const t = JSON.parse(b64urlDecode(s));
  const hex = (c) => typeof c === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(c.trim());
  if (!t || !hex(t.bg) || !hex(t.bar) || !hex(t.accent) || !hex(t.text)) throw new Error('not a theme');
  return { name: (t.name || 'Imported').toString().slice(0, 40), bg: t.bg, bar: t.bar, accent: t.accent, text: t.text, img: sanitizeThemeImg(t.img), dim: (typeof t.dim === 'number') ? t.dim : 35 };
}
function exportCurrentTheme() {
  const code = encodeTheme(themeSnapshot(draftName.trim() || 'My theme'));
  navigator.clipboard.writeText(code).then(
    () => notice(code.length > 500 ? 'Copied (large -- bundles an image)' : 'Theme code copied -- share or import it'),
    () => notice('Could not copy the code'));
}
function importThemeFromText(text) {
  let t; try { t = decodeTheme(text); } catch (e) { notice('That is not a valid theme code'); return; }
  if (customThemes.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) t.name += ' (imported)';
  customThemes.push(t); persistCustom(); draftImport = ''; importOpen = false; applyCustomTheme(t); notice('Imported "' + t.name + '"');
}
// Re-encode an upload to JPEG at a sane size, so a phone photo doesn't sit in localStorage as a
// multi-megabyte data URL and get re-read on every load.
function shrinkImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read failed'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => reject(new Error('decode failed'));
      im.onload = () => {
        const s = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      im.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
function notice(msg) { noteMsg = msg; if (!panelEl || !panelEl.hidden) renderPanel(); clearTimeout(notice._t); notice._t = setTimeout(() => { noteMsg = ''; if (panelEl && !panelEl.hidden) renderPanel(); }, 2600); }

function renderPanel() {
  if (!bodyEl) return;
  const chip = (name, c, kind) =>
    `<button class="th-chip" data-kind="${kind}" data-name="${name}" title="${name}" style="background:${c.bar}">` +
    `<i style="background:${c.bg}"></i><i style="background:${c.accent}"></i></button>`;
  const looks = Object.entries(LOOKS).map(([n, c]) => chip(n, c, 'look')).join('');
  const presets = Object.entries(PRESETS).map(([n, c]) => chip(n, c, 'preset')).join('');
  const photos = Object.entries(BANNERS).map(([n, p]) =>
    `<button class="th-ban${theme.img === p ? ' on' : ''}" data-ban="${p}" title="${n}" style="background-image:url(${p})"></button>`).join('');
  const grads = Object.entries(BANNER_DEFS).map(([n, cols]) =>
    `<button class="th-ban${theme.img === svgGradient(cols) ? ' on' : ''}" data-grad="${n}" title="${n}" style="background:${bannerCss(cols)}"></button>`).join('');
  const mine = customThemes.map((t, i) => {
    const bg = t.img ? `center/cover no-repeat url("${esc(t.img)}")` : bannerCss([t.bar, t.accent]);
    return `<button class="th-mine" data-mine="${i}" title="${esc(t.name)}" style="background:${bg};color:${t.text}">` +
      `<span class="th-mine-lbl">${esc(t.name)}</span><span class="th-del" data-del="${i}" title="Remove">&#215;</span></button>`;
  }).join('');
  const col = (lbl, key) => `<label class="th-cw">${lbl}<input class="th-color" type="color" data-col="${key}" value="${theme[key]}" /></label>`;

  bodyEl.innerHTML = `
    <div class="th-row"><span class="th-lbl">Looks</span><div class="th-wrap">${looks}</div></div>
    ${customThemes.length ? `<div class="th-row"><span class="th-lbl">My themes</span><div class="th-wrap th-mines">${mine}</div></div>` : ''}
    <div class="th-row"><span class="th-lbl">Colors</span><div class="th-wrap">${presets}</div></div>
    <div class="th-row"><span class="th-lbl">Backdrop</span><div class="th-wrap">${photos}${grads}` +
      `<button class="th-ban th-none${!theme.img ? ' on' : ''}" data-ban="" title="No image">&#8856;</button>` +
      `<label class="th-ban th-file" title="Custom image">&#128247;<input id="th-file" type="file" accept="image/*" hidden /></label></div></div>
    <div class="th-row th-hintrow${theme.img ? '' : ' th-hide'}"><span class="th-lbl"></span><span class="th-hint">${imgHint()}</span></div>
    <div class="th-row"><span class="th-lbl">Adjust</span><div class="th-wrap th-colors">${col('Bg', 'bg')}${col('Bar', 'bar')}${col('Accent', 'accent')}${col('Text', 'text')}</div></div>
    <div class="th-row${theme.img ? '' : ' th-hide'}"><span class="th-lbl">Overlay</span>` +
      `<input id="th-dim" class="th-range" type="range" min="0" max="85" value="${theme.dim ?? 35}" /><span class="th-dimval">${theme.dim ?? 35}%</span></div>
    <div class="th-row"><span class="th-lbl">Save</span><div class="th-wrap th-save">` +
      `<input id="th-name" class="th-name" type="text" maxlength="40" placeholder="Theme name" value="${esc(draftName)}" />` +
      `<button class="th-btn2" id="th-save">Save</button><button class="th-btn2" id="th-export">Export</button>` +
      `<button class="th-btn2" id="th-import-toggle">Import</button></div></div>
    <div class="th-row${importOpen ? '' : ' th-hide'}"><span class="th-lbl"></span><div class="th-wrap th-import">` +
      `<textarea id="th-import-text" class="th-import-text" rows="2" placeholder="Paste a theme code (SST1.…)">${esc(draftImport)}</textarea>` +
      `<button class="th-btn2" id="th-import-add">Add</button>` +
      `<label class="th-btn2" id="th-import-filebtn">Load .json<input id="th-import-file" type="file" accept=".json,application/json" hidden /></label></div></div>
    <div class="th-row"><span class="th-note">${esc(noteMsg)}</span><div class="th-wrap th-foot">` +
      `${theme.img ? '<button class="th-btn2" id="th-clearimg">Remove image</button>' : ''}<button class="th-btn" id="th-reset">Reset</button></div></div>`;

  bodyEl.querySelectorAll('.th-chip').forEach((b) => { b.onclick = () => {
    if (b.dataset.kind === 'look') { const L = LOOKS[b.dataset.name]; set({ bg: L.bg, bar: L.bar, accent: L.accent, text: L.text, img: lookBanner(L) }); }
    else { const p = PRESETS[b.dataset.name]; set({ bg: p.bg, bar: p.bar, accent: p.accent, text: p.text }); }
  }; });
  bodyEl.querySelectorAll('.th-ban[data-ban]').forEach((b) => { b.onclick = () => set({ img: b.dataset.ban }); });
  bodyEl.querySelectorAll('.th-ban[data-grad]').forEach((b) => { b.onclick = () => set({ img: svgGradient(BANNER_DEFS[b.dataset.grad]) }); });
  bodyEl.querySelectorAll('.th-mine').forEach((b) => { b.onclick = (e) => { if (e.target.closest('.th-del')) return; applyCustomTheme(customThemes[+b.dataset.mine]); }; });
  bodyEl.querySelectorAll('.th-del').forEach((d) => { d.onclick = (e) => { e.stopPropagation(); const t = customThemes[+d.dataset.del]; if (t) deleteCustomTheme(t.name); }; });
  bodyEl.querySelectorAll('.th-color').forEach((c) => { c.oninput = () => set({ [c.dataset.col]: c.value }); });
  const dim = bodyEl.querySelector('#th-dim'); if (dim) dim.oninput = () => set({ dim: +dim.value });
  const nameIn = bodyEl.querySelector('#th-name'); if (nameIn) nameIn.oninput = () => { draftName = nameIn.value; };
  bodyEl.querySelector('#th-save').onclick = saveCurrentTheme;
  bodyEl.querySelector('#th-export').onclick = exportCurrentTheme;
  bodyEl.querySelector('#th-import-toggle').onclick = () => { importOpen = !importOpen; renderPanel(); };
  const impText = bodyEl.querySelector('#th-import-text'); if (impText) impText.oninput = () => { draftImport = impText.value; };
  const impAdd = bodyEl.querySelector('#th-import-add'); if (impAdd) impAdd.onclick = () => importThemeFromText(draftImport);
  const impFile = bodyEl.querySelector('#th-import-file'); if (impFile) impFile.onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(importThemeFromText); };
  const clr = bodyEl.querySelector('#th-clearimg'); if (clr) clr.onclick = () => set({ img: '' });
  bodyEl.querySelector('#th-reset').onclick = () => set({ ...DEFAULT });
  const file = bodyEl.querySelector('#th-file');
  if (file) file.onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { set({ img: await shrinkImage(f, 2560, 1600) }); } catch (err) { notice('Could not load that image'); } };
}

function togglePanel() {
  const open = panelEl.hidden;
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
  panelEl.hidden = !open;
  if (!panelEl.hidden) renderPanel();
}

// apply colours immediately (before panes exist) so there's no flash; init() wires the UI later
load();
loadCustom();
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
  // per-set theming: use() switches the applied theme (no onChange -- it's a programmatic switch),
  // current() reads it to store on a set, onChange() fires only on the user's own panel edits.
  use(t) { theme = t ? { ...DEFAULT, ...t } : { ...DEFAULT }; apply(); persist(); renderPanel(); },
  current() { return { ...theme }; },
  onChange(cb) { onChangeCb = cb; },
  remeasure
};
