// Splitser vault -- a local password manager, ported from the Vault extension's model:
// master password --PBKDF2-SHA256 (600k)--> AES-256-GCM key that encrypts the entries JSON.
// The master password is never stored; only ciphertext is persisted (main writes vault.enc,
// it never sees the key or plaintext). The derived key lives ONLY here in the isolated
// renderer while unlocked -- webviews (hostile content) run in separate WebContents and can
// never reach it. What the extension couldn't do, we can: autofill + capture, because we
// drive each pane's <webview> with executeJavaScript.

const ITER = 600000;
const encU = new TextEncoder();
const decU = new TextDecoder();
function b64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function ub64(str) { const bin = atob(str); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', encU.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter || ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptObj(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encU.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(new Uint8Array(ct)) };
}
async function decryptObj(key, ivB64, dataB64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(ivB64) }, key, ub64(dataB64));
  return JSON.parse(decU.decode(pt));
}
export function generatePassword(len = 20) {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+?';
  const r = crypto.getRandomValues(new Uint32Array(len));
  let s = ''; for (let i = 0; i < len; i++) s += set[r[i] % set.length]; return s;
}
// CSV import (ported from the extension's csv.js) -- maps a browser password export by header
function fromPasswordCSV(text) {
  const rows = []; let row = [], field = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += c; }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.some((x) => x !== '')); if (data.length < 2) return [];
  const h = data[0].map((x) => x.trim().toLowerCase());
  const col = (ns) => { for (const n of ns) { const k = h.indexOf(n); if (k !== -1) return k; } return -1; };
  const iN = col(['name', 'title']), iU = col(['url', 'website', 'origin', 'login_uri']),
    iUs = col(['username', 'user', 'login', 'login_username']), iP = col(['password', 'pass', 'login_password']), iNo = col(['note', 'notes']);
  const at = (r, i) => (i !== -1 && r[i] != null ? r[i] : '');
  const out = [];
  for (let r = 1; r < data.length; r++) { const row2 = data[r]; const url = at(row2, iU), u = at(row2, iUs), p = at(row2, iP);
    if (!url && !u && !p) continue; out.push({ name: at(row2, iN) || url || u || 'Untitled', url, username: u, password: p, note: at(row2, iNo) }); }
  return out;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// ---- fill / capture scripts injected into a pane's webview ----
function fillScript(user, pass) {
  return `(function(u,p){
    function fire(el){['input','change','keyup','blur'].forEach(function(t){el.dispatchEvent(new Event(t,{bubbles:true}));});}
    // set the value through the NATIVE setter, bypassing React/Vue's overridden value tracker, so
    // the framework sees a real change and re-runs validation (otherwise submit buttons stay disabled)
    function nset(el,v){ try{var pr=(el.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement).prototype; var d=Object.getOwnPropertyDescriptor(pr,'value'); if(d&&d.set){d.set.call(el,v);return;}}catch(e){} el.value=v; }
    function set(el,v){ if(!el||v==null) return false; try{el.focus();}catch(e){} nset(el,v); fire(el); return true; }
    var pw=document.querySelector('input[type=password]:not([disabled]):not([readonly])');
    var user=null, inputs=[].slice.call(document.querySelectorAll('input'));
    if(pw){ var pi=inputs.indexOf(pw);
      for(var i=pi-1;i>=0;i--){ var el=inputs[i], t=(el.type||'text').toLowerCase(), meta=(el.autocomplete||'')+' '+(el.name||'')+' '+(el.id||'');
        if((t==='text'||t==='email'||t==='tel')&&(t==='email'||/user|email|login|account|mail/i.test(meta))){ user=el; break; } }
      if(!user){ for(var j=pi-1;j>=0;j--){ var t2=(inputs[j].type||'text').toLowerCase(); if(t2==='text'||t2==='email'){ user=inputs[j]; break; } } }
    }
    if(!user) user=document.querySelector('input[type=email],input[autocomplete~=username]');
    var a=set(user,u), b=set(pw,p); return a||b;
  })(${JSON.stringify(user)}, ${JSON.stringify(pass)})`;
}
const CAPTURE = `(function(){
  var pw=document.querySelector('input[type=password]'); var user='';
  if(pw){ var inputs=[].slice.call(document.querySelectorAll('input')), pi=inputs.indexOf(pw);
    for(var i=pi-1;i>=0;i--){ var t=(inputs[i].type||'text').toLowerCase(); if((t==='text'||t==='email')&&inputs[i].value){ user=inputs[i].value; break; } } }
  if(!user){ var e=document.querySelector('input[type=email]'); if(e) user=e.value; }
  return { username:user, password: pw?pw.value:'', origin:location.origin, host:location.hostname };
})()`;

// ---- the Vault singleton ----
let api, getPanes, getActive;
let key = null, entries = [], salt = null, iter = ITER, hasVault = false;
let lockTimer = null;
let pendingSave = null;   // a login captured while locked, re-offered after unlock
const AUTOLOCK_MS = 15 * 60 * 1000;
let panelEl, bodyEl, statusBtn;

function unlocked() { return !!key; }
function armLock() { clearTimeout(lockTimer); if (unlocked()) lockTimer = setTimeout(lock, AUTOLOCK_MS); }
function refreshAllKeys() { getPanes().forEach(refreshPaneKey); }

async function persist() { if (!key) return; const c = await encryptObj(key, entries); api.vaultSet({ v: 1, salt: b64(salt), iter, iv: c.iv, data: c.data }); }

async function load() {
  const blob = await api.vaultGet();
  hasVault = !!blob;
  if (blob) { salt = ub64(blob.salt); iter = blob.iter || ITER; }
  render();
}

async function create(master) {
  salt = crypto.getRandomValues(new Uint8Array(16)); iter = ITER;
  key = await deriveKey(master, salt, iter); entries = []; hasVault = true;
  await persist(); armLock(); render(); refreshAllKeys();
}
async function unlock(master) {
  const blob = await api.vaultGet(); if (!blob) return false;
  salt = ub64(blob.salt); iter = blob.iter || ITER;
  const k = await deriveKey(master, salt, iter);
  try { entries = await decryptObj(k, blob.iv, blob.data); } catch { return false; }  // GCM auth fail = wrong password
  key = k; armLock(); render(); refreshAllKeys();
  if (pendingSave) { const c = pendingSave; pendingSave = null; const p = getActive(); if (p) offerSave(p, c); }
  return true;
}
function lock() { key = null; entries = []; clearTimeout(lockTimer); render(); refreshAllKeys(); }

function matchesForUrl(url) {
  const h = hostOf(url); if (!h) return [];
  return entries.filter((e) => { const eh = hostOf(e.url); return eh && (eh === h || h.endsWith('.' + eh) || eh.endsWith('.' + h)); });
}

async function fill(view, entry) { armLock(); try { return await view.executeJavaScript(fillScript(entry.username, entry.password), true); } catch { return false; } }

function refreshPaneKey(pane) {
  if (!pane.keyBtn) return;
  const on = unlocked() && matchesForUrl(pane.view.getURL()).length > 0;
  pane.keyBtn.hidden = !on; pane.keyBtn.classList.toggle('on', on);
}

async function fillPane(pane) {
  if (!unlocked()) { openPanel(); return; }
  const ms = matchesForUrl(pane.view.getURL());
  if (!ms.length) { openPanel(); return; }
  if (ms.length === 1) { fill(pane.view, ms[0]); return; }
  showChooser(pane, ms);
}
function showChooser(pane, ms) {
  document.querySelectorAll('.vault-chooser').forEach((c) => c.remove());
  const box = document.createElement('div'); box.className = 'vault-chooser';
  box.innerHTML = ms.map((e, i) => `<div class="vc-item" data-i="${i}"><b>${esc(e.username || e.name)}</b><span>${esc(e.name || e.url)}</span></div>`).join('');
  pane.el.appendChild(box);
  box.addEventListener('mousedown', (ev) => { const it = ev.target.closest('.vc-item'); if (!it) return; ev.preventDefault(); fill(pane.view, ms[+it.dataset.i]); box.remove(); });
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

// ---- autofill dropdown: offered when a login field is focused (webview-preload -> ipc-message).
// Anchored under the field; click a row to fill both username + password into the page. ----
let fillTimer = null, suppressFill = 0;
function hideFill() {
  clearTimeout(fillTimer);
  fillTimer = setTimeout(() => document.querySelectorAll('.vault-fill').forEach((b) => b.remove()), 150);  // delay so a click on it lands
}
function offerFill(pane, data) {
  clearTimeout(fillTimer);
  document.querySelectorAll('.vault-fill').forEach((b) => b.remove());
  if (!unlocked() || Date.now() < suppressFill) return;           // locked, or we just filled (fill re-focuses the field)
  const ms = matchesForUrl(pane.view.getURL());
  if (!ms.length) return;
  const box = document.createElement('div');
  box.className = 'vault-fill';
  box.innerHTML = ms.map((e, i) => `<div class="vf-item" data-i="${i}"><span class="vf-k">&#128273;</span><span class="vf-main"><b>${esc(e.username || e.name)}</b><span class="vf-sub">${esc(e.name || hostOf(e.url) || e.url)}</span></span></div>`).join('');
  box.addEventListener('mousedown', (ev) => {
    const it = ev.target.closest('.vf-item'); if (!it) return;
    ev.preventDefault(); armLock(); suppressFill = Date.now() + 900;
    fill(pane.view, ms[+it.dataset.i]); box.remove();
  });
  pane.el.appendChild(box);
  // anchor under the field (rect is in the webview's viewport px; scale by the pane's zoom)
  const z = pane.activeTab ? (pane.activeTab.zoom || 1) : 1;
  const vb = pane.viewsBox, r = (data && data.rect) || { x: 16, y: 80, w: 220, h: 20 };
  let left = vb.offsetLeft + r.x * z;
  let top = vb.offsetTop + r.y * z + 2;
  left = Math.max(6, Math.min(left, pane.el.clientWidth - box.offsetWidth - 6));
  if (top + box.offsetHeight > pane.el.clientHeight - 6) top = Math.max(vb.offsetTop + 6, vb.offsetTop + (r.y - r.h) * z - box.offsetHeight - 4);  // flip above
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

async function captureFromPane(pane) {
  let got; try { got = await pane.view.executeJavaScript(CAPTURE, true); } catch { got = null; }
  openAdd({ name: (got && got.host) || '', url: (got && got.origin) || pane.view.getURL(), username: (got && got.username) || '', password: (got && got.password) || '', note: '' });
}

// called when a pane's webview reports a login submission (webview-preload.cjs -> ipc-message).
// Offers to save/update it -- unless it's already stored verbatim, or the vault is locked.
function offerSave(pane, creds) {
  if (!pane || !creds || !creds.password) return;
  const host = creds.host || hostOf(creds.origin) || hostOf(creds.url);
  if (!host) return;
  if (!unlocked()) { pendingSave = creds; showSaveBar(pane, creds, host, 'locked'); return; }
  const same = entries.find((e) => hostOf(e.url) === host && (e.username || '') === (creds.username || ''));
  if (same) {
    if (same.password === creds.password) return;          // already saved, nothing to offer
    showSaveBar(pane, creds, host, 'update', same);        // password changed -> offer to update
  } else {
    showSaveBar(pane, creds, host, 'new');
  }
}
function showSaveBar(pane, creds, host, mode, existing) {
  pane.el.querySelectorAll('.savebar').forEach((b) => b.remove());
  const label = mode === 'locked' ? 'Save this login to your vault? Unlock it to save.'
    : mode === 'update' ? 'Update the saved password for ' + host + '?'
    : 'Save password for ' + host + '?';
  const primary = mode === 'locked' ? 'Unlock &amp; save' : mode === 'update' ? 'Update' : 'Save';
  const bar = document.createElement('div');
  bar.className = 'savebar';
  bar.innerHTML = '<span class="sb-key">&#128273;</span><span class="sb-text">' + esc(label) + '</span>' +
    '<button class="sb-btn primary" data-a="ok">' + primary + '</button>' +
    '<button class="sb-btn" data-a="no">Not now</button>';
  bar.querySelector('[data-a="no"]').onclick = () => { bar.remove(); if (mode === 'locked') pendingSave = null; };
  bar.querySelector('[data-a="ok"]').onclick = async () => {
    bar.remove();
    if (mode === 'locked') { openPanel(); return; }        // unlock -> pendingSave re-offered on success
    if (mode === 'update' && existing) { existing.password = creds.password; existing.username = creds.username || existing.username; }
    else { entries.unshift({ name: host, url: creds.origin || creds.url || ('https://' + host), username: creds.username || '', password: creds.password, note: '' }); }
    await persist(); refreshAllKeys();
  };
  pane.el.insertBefore(bar, pane.viewsBox);
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- panel UI ----
function openPanel() { panelEl.hidden = false; render(); const f = bodyEl.querySelector('input'); if (f) f.focus(); }
function togglePanel() { const open = panelEl.hidden; document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; }); panelEl.hidden = !open; if (!panelEl.hidden) { render(); const f = bodyEl.querySelector('input'); if (f) f.focus(); } }

function render() {
  if (!bodyEl) return;
  if (!hasVault) return renderSetup();
  if (!unlocked()) return renderUnlock();
  renderList();
}
function renderSetup() {
  bodyEl.innerHTML = `<p class="v-hint">Create a master password. It's never stored — if you forget it, the vault is gone (that's the point).</p>
    <input class="v-in" id="v-new" type="password" placeholder="Master password" />
    <input class="v-in" id="v-new2" type="password" placeholder="Confirm master password" />
    <button class="v-btn primary" id="v-create">Create vault</button>
    <div class="v-err" id="v-err"></div>`;
  bodyEl.querySelector('#v-create').onclick = async () => {
    const a = bodyEl.querySelector('#v-new').value, b = bodyEl.querySelector('#v-new2').value;
    if (a.length < 8) return err('Use at least 8 characters.');
    if (a !== b) return err('Passwords do not match.');
    await create(a);
  };
  bodyEl.querySelector('#v-new').onkeydown = (e) => { if (e.key === 'Enter') bodyEl.querySelector('#v-new2').focus(); };
  bodyEl.querySelector('#v-new2').onkeydown = (e) => { if (e.key === 'Enter') bodyEl.querySelector('#v-create').click(); };
}
function renderUnlock() {
  bodyEl.innerHTML = `<p class="v-hint">Vault is locked.</p>
    <input class="v-in" id="v-pw" type="password" placeholder="Master password" />
    <button class="v-btn primary" id="v-unlock">Unlock</button>
    <div class="v-err" id="v-err"></div>
    <button class="v-link" id="v-reset">Forgot it? Reset the vault…</button>`;
  const go = async () => { const ok = await unlock(bodyEl.querySelector('#v-pw').value); if (!ok) err('Wrong master password.'); };
  bodyEl.querySelector('#v-unlock').onclick = go;
  bodyEl.querySelector('#v-pw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  bodyEl.querySelector('#v-reset').onclick = renderReset;
}
// escape hatch: a locked-out user (forgot the master password, or a stray vault) can always
// wipe and start over. Two-step, in-panel (no native dialog).
function renderReset() {
  bodyEl.innerHTML = `<p class="v-hint v-warn">Reset erases every saved login and lets you set a new
    master password. There's no recovery — that's the point of a zero-knowledge vault.</p>
    <button class="v-btn danger" id="v-reset-yes">Erase vault &amp; start over</button>
    <button class="v-link" id="v-reset-no">Cancel</button>`;
  bodyEl.querySelector('#v-reset-yes').onclick = resetVault;
  bodyEl.querySelector('#v-reset-no').onclick = () => render();
}
async function resetVault() {
  api.vaultSet(null);                               // clear the ciphertext blob (main writes null)
  key = null; entries = []; salt = null; iter = ITER; hasVault = false;
  clearTimeout(lockTimer); refreshAllKeys(); render();   // hasVault=false -> renderSetup()
}
let toastEl;
function vToast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'v-toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(vToast._t); vToast._t = setTimeout(() => toastEl.classList.remove('on'), 1500);
}
function copied(btn, msg) {                       // inline "✓" on the button + a toast, so a copy is never silent
  const orig = btn.textContent;
  btn.textContent = '✓'; btn.classList.add('ok');
  clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1100);
  vToast(msg);
}
function rowHtml(e, i) {
  return `<div class="v-row" data-i="${i}">
        <div class="v-row-main"><span class="v-row-t">${esc(e.name || e.url)}</span><span class="v-row-u">${esc(e.username)} · ${esc(hostOf(e.url) || e.url)}</span></div>
        <button class="v-mini" data-act="user" data-i="${i}" title="Copy username">user</button>
        <button class="v-mini" data-act="pass" data-i="${i}" title="Copy password">pass</button>
        <button class="v-mini" data-act="fill" data-i="${i}" title="Fill active pane">&#128273;</button>
        <button class="v-mini danger" data-act="del" data-i="${i}" title="Delete">&#215;</button>
      </div>`;
}
// only the ROWS re-render on search -- never the <input> -- so the caret stays put (no "backwards" typing)
function renderRows(filter) {
  const f = (filter || '').toLowerCase();
  const box = bodyEl.querySelector('.v-list'); if (!box) return;
  const list = entries.map((e, i) => ({ e, i })).filter(({ e }) => !f || (e.name + ' ' + e.url + ' ' + e.username).toLowerCase().includes(f));
  box.innerHTML = list.length ? list.map(({ e, i }) => rowHtml(e, i)).join('') : '<p class="v-hint">No entries. Add one, capture from a page, or import a CSV.</p>';
}
function renderList(filter = '') {
  bodyEl.innerHTML = `
    <div class="v-top">
      <input class="v-in v-search" id="v-search" placeholder="Search ${entries.length} entries" value="${esc(filter)}" />
      <button class="v-icon" id="v-add" title="Add entry">+</button>
      <button class="v-icon" id="v-lock" title="Lock">&#128274;</button>
    </div>
    <div class="v-list"></div>
    <div class="v-foot">
      <button class="v-btn" id="v-capture">+ From current page</button>
      <label class="v-btn" for="v-csv">Import CSV</label><input type="file" id="v-csv" accept=".csv" hidden />
    </div>`;
  renderRows(filter);
  bodyEl.querySelector('#v-search').oninput = (e) => { armLock(); renderRows(e.target.value); };
  bodyEl.querySelector('#v-add').onclick = () => openAdd();
  bodyEl.querySelector('#v-lock').onclick = lock;
  bodyEl.querySelector('#v-capture').onclick = () => { const p = getActive(); if (p) captureFromPane(p); };
  bodyEl.querySelector('#v-csv').onchange = async (e) => { const file = e.target.files[0]; if (!file) return; const text = await file.text(); const imp = fromPasswordCSV(text); if (imp.length) { entries = entries.concat(imp); await persist(); render(); refreshAllKeys(); } };
  bodyEl.querySelector('.v-list').onclick = async (e) => {
    const btn = e.target.closest('.v-mini'); if (!btn) return; armLock();
    const i = +btn.dataset.i, ent = entries[i]; if (!ent) return;
    if (btn.dataset.act === 'user') { api.clipboardWrite(ent.username); copied(btn, 'Username copied'); }
    else if (btn.dataset.act === 'pass') { api.clipboardWrite(ent.password); copied(btn, 'Password copied — clears in ~25s'); }
    else if (btn.dataset.act === 'fill') { const p = getActive(); if (p) fill(p.view, ent); }
    else if (btn.dataset.act === 'del') { entries.splice(i, 1); await persist(); renderList((bodyEl.querySelector('#v-search') || {}).value || ''); refreshAllKeys(); }
  };
}
function openAdd(pre) {
  pre = pre || { name: '', url: '', username: '', password: '', note: '' };
  bodyEl.innerHTML = `
    <div class="v-add">
      <input class="v-in" id="a-name" placeholder="Name" value="${esc(pre.name)}" />
      <input class="v-in" id="a-url" placeholder="URL" value="${esc(pre.url)}" />
      <input class="v-in" id="a-user" placeholder="Username" value="${esc(pre.username)}" />
      <div class="v-pwrow"><input class="v-in" id="a-pass" placeholder="Password" value="${esc(pre.password)}" /><button class="v-icon" id="a-gen" title="Generate">&#127922;</button></div>
      <input class="v-in" id="a-note" placeholder="Note (optional)" value="${esc(pre.note)}" />
      <div class="v-addrow"><button class="v-btn primary" id="a-save">Save</button><button class="v-btn" id="a-cancel">Cancel</button></div>
    </div>`;
  bodyEl.querySelector('#a-gen').onclick = () => { bodyEl.querySelector('#a-pass').value = generatePassword(20); };
  bodyEl.querySelector('#a-cancel').onclick = () => renderList();
  bodyEl.querySelector('#a-save').onclick = async () => {
    armLock();
    const ent = {
      name: bodyEl.querySelector('#a-name').value.trim() || bodyEl.querySelector('#a-url').value.trim() || 'Untitled',
      url: bodyEl.querySelector('#a-url').value.trim(), username: bodyEl.querySelector('#a-user').value,
      password: bodyEl.querySelector('#a-pass').value, note: bodyEl.querySelector('#a-note').value
    };
    entries.unshift(ent); await persist(); render(); refreshAllKeys();
  };
}
function err(m) { const e = bodyEl.querySelector('#v-err'); if (e) e.textContent = m; }

export const Vault = {
  init(deps) {
    api = deps.api; getPanes = deps.getPanes; getActive = deps.getActive;
    panelEl = document.getElementById('panel-vault'); bodyEl = document.getElementById('vault-body');
    statusBtn = document.getElementById('btn-vault');
    statusBtn.addEventListener('click', () => togglePanel());
    bodyEl.addEventListener('mousedown', armLock, true);
    return load();
  },
  refreshPaneKey, fillPane, unlocked, togglePanel, offerSave, offerFill, hideFill
};
