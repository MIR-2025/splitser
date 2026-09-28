// Runs inside every pane's <webview> (isolated from the host + from the vault key). Its ONLY job
// is to notice when the user submits a login and hand the just-typed {origin, host, username,
// password} up to the host via sendToHost, so the vault (which holds the key, over in the host
// renderer) can OFFER to save it. Nothing is stored here; it reports the current form once and
// is otherwise inert. Wrapped in try/catch throughout so it can never break a page.
const { ipcRenderer, webFrame } = require('electron');   // webFrame: reaches the page's main world

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

// ---- Ctrl+middle-click a link -> open it as a new TAB in this pane (not a new pane).
// It has to be caught HERE, in the page: plain middle-click and Ctrl+click both reach main as
// disposition 'background-tab' and setWindowOpenHandler carries no modifier keys, so main cannot
// tell them apart. We recognise the intent, cancel the default (otherwise Chromium's window-open
// handler fires and opens a PANE), and hand the URL to the host renderer, which owns this webview
// and so knows exactly which pane to put the tab in. Plain middle-click is untouched -> still a pane.
// Main frame only (nodeIntegrationInSubFrames is off), so a link inside an iframe still opens a pane.
document.addEventListener('auxclick', (e) => {
  try {
    if (e.button !== 1 || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let href = a.href;
    if (href && typeof href !== 'string') href = href.baseVal;          // SVG <a> gives an SVGAnimatedString
    if (!href) return;
    href = new URL(href, location.href).href;                           // resolve relative hrefs / <base>
    if (!/^(https?:|file:|about:)/i.test(href)) return;                 // skip javascript:, mailto:, blob:, ...
    e.preventDefault();                                                 // stop Chromium opening it as a pane
    e.stopPropagation();
    ipcRenderer.sendToHost('nav:newtab', href);
  } catch (x) { /* never break the page */ }
}, true);

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

// ---- fingerprint farbling -------------------------------------------------------------------
// Brave does this in Blink; we can only do it in JS, from here. Two constraints shaped it:
//
//   1. contextIsolation is ON, so patching prototypes in THIS world would not touch the page at
//      all. webFrame.executeJavaScript reaches the page's MAIN world even from a sandboxed
//      preload -- verified 2026-09-28 -- and running at preload time lands it before page script.
//   2. It is a JS patch, so it is bypassable: a page can pull a pristine prototype off a fresh
//      same-origin iframe's contentWindow. This raises the cost of commercial fingerprinting;
//      it does not defeat someone specifically working around it. Don't oversell it.
//
// Noise is deterministic per (session, site): a site re-reading the same canvas gets the same
// answer -- random-per-call is itself a signal, and it breaks legitimate readback -- while two
// sites, or two launches, never agree.
try {
  const { seed, on } = ipcRenderer.sendSync('farble:init', location.hostname || '');
  {
    webFrame.executeJavaScript('(' + function (SEED, SITE, FARBLE) {
      'use strict';
      // FNV-1a -> xorshift32. Cheap, no deps, good enough to decorrelate sites.
      let h = 2166136261;
      const key = SEED + '|' + SITE;
      for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
      const SITE_SEED = h >>> 0;
      const stream = (salt) => {
        let x = (SITE_SEED ^ Math.imul(salt || 1, 2654435761)) >>> 0 || 1;
        return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
      };
      // --- present as real Chrome, not Chromium. Unconditional (like the UA string in main.js):
      //     this is about not standing out, not about adding noise, so shields do not gate it.
      //     main.js freezes the UA STRING to Chrome/<major>.0.0.0, but userAgentData is a second
      //     door -- getHighEntropyValues still handed out the true build (150.0.7871.224), and the
      //     brands list omitted "Google Chrome", which by itself says Chromium.
      try {
        const UAD = window.NavigatorUAData && window.NavigatorUAData.prototype;
        if (UAD) {
          const MAJOR = (navigator.userAgent.match(/Chrome\/(\d+)/) || ['', '0'])[1];
          const FULL = MAJOR + '.0.0.0';
          const mkBrands = () => [{ brand: 'Not;A=Brand', version: '8' },
                                  { brand: 'Chromium', version: MAJOR },
                                  { brand: 'Google Chrome', version: MAJOR }];
          const mkFull = () => [{ brand: 'Not;A=Brand', version: '8.0.0.0' },
                                { brand: 'Chromium', version: FULL },
                                { brand: 'Google Chrome', version: FULL }];
          Object.defineProperty(UAD, 'brands', { get: mkBrands, configurable: true });
          const ghev = UAD.getHighEntropyValues;
          Object.defineProperty(UAD, 'getHighEntropyValues', {
            configurable: true, writable: true,
            value: function (hints) {
              return ghev.call(this, hints).then((v) => {
                if ('uaFullVersion' in v) v.uaFullVersion = FULL;
                if ('fullVersionList' in v) v.fullVersionList = mkFull();
                if ('brands' in v) v.brands = mkBrands();
                return v;
              });
            }
          });
        }
      } catch (e) {}

      if (!FARBLE) return;                 // everything below is noise injection -- shields gate it

      const def = (obj, name, fn) => {
        if (!obj || !obj[name]) return;
        const orig = obj[name];
        Object.defineProperty(obj, name, { value: fn(orig), writable: true, configurable: true });
        try { Object.defineProperty(obj[name], 'toString', { value: () => orig.toString() }); } catch (e) {}
      };

      // --- canvas: flip low bits of colour channels. Invisible; changes every hash. -----------
      const perturb = (data, salt) => {
        const next = stream(salt);
        for (let i = 0; i < data.length; i += 4) {
          const r = next();
          data[i] ^= r & 1;
          data[i + 1] ^= (r >>> 1) & 1;
          data[i + 2] ^= (r >>> 2) & 1;      // alpha untouched: nudging it shows up as artifacts
        }
        return data;
      };
      def(CanvasRenderingContext2D.prototype, 'getImageData', (o) => function (...a) {
        const d = o.apply(this, a);
        try { perturb(d.data, (a[2] | 0) * 31 + (a[3] | 0)); } catch (e) {}
        return d;
      });
      // toDataURL/toBlob read the backing store directly, so farble a COPY and encode that
      const viaCopy = (canvas, done) => {
        const w = canvas.width, hgt = canvas.height;
        const c2 = document.createElement('canvas'); c2.width = w; c2.height = hgt;
        const cx = c2.getContext('2d');
        cx.drawImage(canvas, 0, 0);
        const img = cx.getImageData(0, 0, w, hgt);         // already farbled by the patch above
        cx.putImageData(img, 0, 0);
        return done(c2);
      };
      def(HTMLCanvasElement.prototype, 'toDataURL', (o) => function (...a) {
        try { return viaCopy(this, (c) => o.apply(c, a)); } catch (e) { return o.apply(this, a); }
      });
      def(HTMLCanvasElement.prototype, 'toBlob', (o) => function (cb, ...a) {
        try { return viaCopy(this, (c) => o.call(c, cb, ...a)); } catch (e) { return o.call(this, cb, ...a); }
      });

      // OffscreenCanvas is a SEPARATE prototype chain, not an alias of the above -- patching
      // CanvasRenderingContext2D does nothing for it. browserleaks.com fingerprints through it,
      // which is exactly how a stable signature survived sessions that should have reseeded it.
      // (Verified 2026-09-28: html canvas 52/64 pixels deviating, OffscreenCanvas 0/64.)
      if (window.OffscreenCanvasRenderingContext2D) {
        def(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', (o) => function (...a) {
          const d = o.apply(this, a);
          try { perturb(d.data, (a[2] | 0) * 31 + (a[3] | 0)); } catch (e) {}
          return d;
        });
      }
      if (window.OffscreenCanvas) {
        def(OffscreenCanvas.prototype, 'convertToBlob', (o) => function (...a) {
          try {
            const c2 = new OffscreenCanvas(this.width, this.height);
            const cx = c2.getContext('2d');
            cx.drawImage(this, 0, 0);
            cx.putImageData(cx.getImageData(0, 0, this.width, this.height), 0, 0);   // farbled above
            return o.apply(c2, a);
          } catch (e) { return o.apply(this, a); }
        });
      }

      // --- WebGL: the GPU string is the identifying part. Numeric caps are left ALONE on
      //     purpose -- lying about MAX_TEXTURE_SIZE breaks real WebGL apps for no real gain.
      const GPU = { 37445: 'Intel Inc.', 37446: 'Intel Iris OpenGL Engine', 7936: 'WebKit', 7937: 'WebKit WebGL' };
      [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach((C) => {
        if (!C) return;
        def(C.prototype, 'getParameter', (o) => function (p) {
          return Object.prototype.hasOwnProperty.call(GPU, p) ? GPU[p] : o.call(this, p);
        });
      });

      // --- audio: only the OFFLINE render path, which is what the fingerprint uses. Live
      //     AudioBuffers are left alone so authoring/playback code is untouched.
      const rendered = new WeakSet();
      if (window.OfflineAudioContext) {
        def(OfflineAudioContext.prototype, 'startRendering', (o) => function (...a) {
          const r = o.apply(this, a);
          return (r && r.then) ? r.then((buf) => { try { rendered.add(buf); } catch (e) {} return buf; }) : r;
        });
      }
      if (window.AudioBuffer) {
        def(AudioBuffer.prototype, 'getChannelData', (o) => function (ch) {
          const d = o.call(this, ch);
          if (!rendered.has(this)) return d;              // not a fingerprint read -- hands off
          const next = stream(ch + 1);
          for (let i = 0; i < d.length; i++) d[i] += (next() / 4294967295 - 0.5) * 1e-7;
          rendered.delete(this);                          // perturb once; repeat reads stay stable
          return d;
        });
      }
      if (window.AnalyserNode) {
        def(AnalyserNode.prototype, 'getFloatFrequencyData', (o) => function (arr) {
          o.call(this, arr);
          const next = stream(9);
          for (let i = 0; i < arr.length; i++) arr[i] += (next() / 4294967295 - 0.5) * 1e-4;
        });
      }
    }.toString() + ')(' + JSON.stringify(seed || '') + ',' +
      JSON.stringify((location.hostname || '').replace(/^www\./, '')) + ',' + JSON.stringify(!!(on && seed)) + ')');
  }
} catch (e) { /* never break a page */ }
