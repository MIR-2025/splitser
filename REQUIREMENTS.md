# Splitser — software requirements & OS compatibility (source of truth)

Cite this on splitser.org for anything about system requirements, platforms, or install.
Keep it honest — it's better to under-promise than to ship a download that won't run.

## Runtime & dependencies
- **Electron `^43`** (Chromium ~150, Node ~22 embedded). This is the whole runtime.
- Runtime dependency: `@ghostery/adblocker-electron` (pure-JS ad/tracker engine). Dev tooling:
  `electron` + `electron-builder`. **No native modules** — nothing to compile per platform.
- **Local-first, no account.** No server, no backend, no account, no sync, no telemetry. The only
  network Splitser makes on its own is a **one-time fetch of the EasyList / EasyPrivacy filter
  lists** (then cached to userData); everything else is the sites you choose to visit.
- **Data location** (userData): `~/.config/splitser` on Linux (`~/Library/Application
  Support/splitser` macOS, `%APPDATA%\splitser` Windows). Contents: plain JSON (`history.json`,
  `bookmarks.json` — page + workspace bookmarks —, `session.json`, `settings.json`, `shields.json`;
  theme in localStorage) + `vault.enc` (AES-256-GCM ciphertext) + the cached adblocker engine.
  **Private (incognito) workspaces write nothing to disk** — their session is in-memory only.

## Platforms
Cross-platform through Electron: **Linux, macOS, Windows** (same codebase, no per-OS forks).

| OS | Status | Minimum (Electron 43 / Chromium ~150) |
|---|---|---|
| **Linux** | Developed + run (X11 / XFCE) | modern glibc (~Ubuntu 20.04+ / equivalent); X11 or Wayland |
| **macOS** | Built in CI (unsigned); **not yet run on a Mac** | macOS 11 (Big Sur)+, Apple Silicon or Intel |
| **Windows** | Built in CI (unsigned); **not yet run on Windows** | Windows 10+ (x64) |

"Built in CI" and "run on the platform" are different statements — only **Linux** has actually been
launched. OS floors move with the pinned Electron/Chromium; update this table when the pin changes.

## Install / run
Installers are built by CI (GitHub Actions) on each release tag:
- **Linux:** `.deb`, `.rpm`, `.AppImage`
- **Windows:** NSIS `.exe`
- **macOS:** `.dmg` (Apple Silicon + Intel)

None are **code-signed yet**, so Windows SmartScreen and macOS Gatekeeper will warn — expected for an
unsigned app from a new publisher (right-click → Open on macOS). SHA-256 checksums accompany each
build; the source is public if you'd rather build it yourself.

Dev:
```sh
npm install    # pulls Electron + the adblocker engine (one time)
npm start
```
`npm start` passes `--no-sandbox` **only** because an npm-installed Electron ships `chrome-sandbox`
without the SUID-root bit on Linux. The packaged builds set this up properly; do not present
`--no-sandbox` as the shipping configuration.

## Security posture (safe to state)
- Renderer (the Splitser UI) runs isolated: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; it reaches main only through a narrow preload bridge.
- Every `<webview>` is hardened from main (forced-safe prefs, pinned preload) and treated as hostile.
- Permissions default-DENY (a tiny auto-allow set; a few prompt); clipboard-read is denied. Same
  protections apply to the incognito session.
- Presents a vanilla Chrome User-Agent (no `Electron`/`Splitser` tokens) so sites don't refuse it.
- Vault: the derived AES-GCM key lives **only** in the isolated renderer while unlocked — never in a
  webview, never in main (main is a dumb ciphertext store). Idle auto-lock (15 min). No master
  password or hash is ever stored.

## Not done yet (be upfront)
- **Code-signing / notarization** — builds are unsigned; **auto-update** (electron-updater) is not wired.
- **External Chrome extensions** — not supported (the built-in ad/tracker blocking is shipped, but
  loading unpacked extensions is not).
- **No mobile.**
- Free-form nested splitting beyond the fixed grids and the 1+2 (logo) layout.
