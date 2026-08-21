// Runs inside every pane's <webview> (isolated from the host + from the vault key). Its ONLY job
// is to notice when the user submits a login and hand the just-typed {origin, host, username,
// password} up to the host via sendToHost, so the vault (which holds the key, over in the host
// renderer) can OFFER to save it. Nothing is stored here; it reports the current form once and
// is otherwise inert. Wrapped in try/catch throughout so it can never break a page.
const { ipcRenderer, contextBridge } = require('electron');

// Keyless geolocation bridge: the injected main-world shim (see main.js GEO_SHIM) calls this to
// fetch a coarse, IP-based position from MAIN. Electron ships no Google geolocation key, so the
// native provider returns POSITION_UNAVAILABLE; this backfills it. Exposed to the page's world.
try {
  contextBridge.exposeInMainWorld('__splitGeo', { get: (opts) => ipcRenderer.invoke('geo:get', opts || {}) });
} catch (e) { /* never break the page */ }

let lastSent = '';

function nearestUsername(pw) {
  const inputs = [].slice.call(document.querySelectorAll('input'));
  const pi = inputs.indexOf(pw);
  for (let i = pi - 1; i >= 0; i--) {
    const el = inputs[i], t = (el.type || 'text').toLowerCase();
    const meta = (el.autocomplete || '') + ' ' + (el.name || '') + ' ' + (el.id || '');
    if ((t === 'text' || t === 'email' || t === 'tel') && (t === 'email' || /user|email|login|account|mail|phone/i.test(meta)) && el.value) return el.value;
  }
  for (let i = pi - 1; i >= 0; i--) { const t = (inputs[i].type || 'text').toLowerCase(); if ((t === 'text' || t === 'email') && inputs[i].value) return inputs[i].value; }
  const e = document.querySelector('input[type=email]'); return e && e.value ? e.value : '';
}

function report(scope) {
  try {
    const pw = (scope && scope.querySelector && scope.querySelector('input[type=password]')) || document.querySelector('input[type=password]');
    if (!pw || !pw.value) return;
    const creds = {
      origin: location.origin,
      host: (location.hostname || '').replace(/^www\./, ''),
      username: nearestUsername(pw),
      password: pw.value
    };
    const key = creds.host + ' ' + creds.username + ' ' + creds.password;
    if (key === lastSent) return;         // don't double-report the same login
    lastSent = key;
    ipcRenderer.sendToHost('vault:capture', creds);
  } catch (e) { /* never break the page */ }
}

// a real <form> submit -- covers most logins
document.addEventListener('submit', (e) => report(e.target), true);
// button-driven / SPA logins with no form submit: a click on a login-looking control
document.addEventListener('click', (e) => {
  try {
    const b = e.target.closest && e.target.closest('button, input[type=submit], input[type=button], [role=button], a');
    if (!b) return;
    const txt = ((b.value || '') + ' ' + (b.textContent || '') + ' ' + (b.getAttribute && b.getAttribute('aria-label') || '')).toLowerCase();
    if (b.type === 'submit' || /log\s*in|sign\s*in|log\s*on|continue|submit|next|anmelden|connexion|entrar/.test(txt)) setTimeout(() => report(null), 0);
  } catch (e) { /* ignore */ }
}, true);
// Enter pressed inside a password field
document.addEventListener('keydown', (e) => { try { if (e.key === 'Enter' && e.target && e.target.type === 'password') setTimeout(() => report(null), 0); } catch (x) { /* ignore */ } }, true);

// ---- autofill: tell the host when a login field is focused, so the vault can offer to prefill.
// A text/email field only counts if the page also has a password field (i.e. it's a login page),
// which keeps this quiet on search boxes and the like.
function isLoginField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t = (el.type || 'text').toLowerCase();
  if (t === 'password') return true;
  if (t !== 'text' && t !== 'email' && t !== 'tel') return false;
  return !!document.querySelector('input[type=password]:not([disabled])');
}
function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom, w: r.width, h: r.height }; }
// A field where the user is CREATING a password (signup / change-password), not signing in -- so we
// offer to suggest a strong one instead of offering saved logins. Signal: autocomplete="new-password",
// a new/confirm-ish name, or a second password field on the page (the classic "password + confirm").
function isNewPasswordField(el) {
  if (!el || el.tagName !== 'INPUT' || (el.type || '').toLowerCase() !== 'password') return false;
  const ac = (el.autocomplete || '').toLowerCase();
  if (ac.indexOf('new-password') !== -1) return true;
  if (ac.indexOf('current-password') !== -1) return false;          // explicitly a sign-IN field
  const meta = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
  if (/new|confirm|repeat|retype|create|regist|signup|sign-up/.test(meta)) return true;
  return document.querySelectorAll('input[type=password]:not([disabled])').length >= 2;   // password + confirm
}
document.addEventListener('focusin', (e) => {
  try {
    const el = e.target;
    if (isNewPasswordField(el)) ipcRenderer.sendToHost('vault:newpw', { rect: rectOf(el) });
    else if (isLoginField(el)) ipcRenderer.sendToHost('vault:loginfocus', { rect: rectOf(el) });
  } catch (x) { /* ignore */ }
}, true);
document.addEventListener('focusout', (e) => {
  try { if (isLoginField(e.target)) ipcRenderer.sendToHost('vault:loginblur'); } catch (x) { /* ignore */ }
}, true);
document.addEventListener('scroll', () => { try { ipcRenderer.sendToHost('vault:loginblur'); } catch (x) { /* ignore */ } }, true);

// clicking into a page's content should focus its pane (the host can't see webview clicks otherwise)
document.addEventListener('mousedown', () => { try { ipcRenderer.sendToHost('pane-active'); } catch (x) { /* ignore */ } }, true);

// Ctrl+wheel = page zoom. Chromium doesn't bind it inside a <webview>, so catch it and let the host
// zoom the pane (keeps the per-tab zoom bookkeeping in one place). passive:false so preventDefault works.
document.addEventListener('wheel', (e) => {
  try { if (!e.ctrlKey) return; e.preventDefault(); ipcRenderer.sendToHost('zoom-wheel', e.deltaY < 0 ? 1 : -1); } catch (x) { /* ignore */ }
}, { passive: false, capture: true });
