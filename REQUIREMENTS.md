# Splitser — software requirements & OS compatibility (source of truth)

Cite this on splitser.org for anything about system requirements, platforms, or install.
Keep it honest — it's better to under-promise than to ship a download that won't run.

## Runtime & dependencies
- **Electron `^32`** (Chromium ~128, Node ~20 embedded). This is the whole runtime.
- Sole npm dependency: `electron` (dev). **No native modules** — nothing to compile per platform.
- **Fully local / offline.** No server, no backend, no account, no sync, no telemetry, no
  network dependency of its own. Everything is on the machine.
- **Data location** (userData): `~/.config/splitser` on Linux (`~/Library/Application
  Support/splitser` macOS, `%APPDATA%\splitser` Windows). Contents: plain JSON
  (`history.json`, `bookmarks.json`, `session.json`, `settings.json`) + `vault.enc`
  (AES-256-GCM ciphertext). Crypto is standard WebCrypto.

## Platforms
Cross-platform through Electron: **Linux, macOS, Windows** (same codebase, no per-OS forks).

| OS | Status | Minimum (Electron 32 / Chromium 128) |
|---|---|---|
| **Linux** | Developed + verified (X11 / XFCE) | modern glibc (~Ubuntu 20.04+ / equivalent); X11 or Wayland |
| **macOS** | Should run; not yet built/tested | macOS 11 (Big Sur)+ |
| **Windows** | Should run; not yet built/tested | Windows 10+ (x64/arm64) |

If we pin an exact Electron version for release, the OS floors move with Chromium's support
matrix — update this table when we pin.

## Running it today (dev)
```sh
npm install     # pulls the Electron runtime (one time)
npm start
```
`npm start` passes `--no-sandbox` **only** because an npm-installed Electron ships
`chrome-sandbox` without the SUID-root bit on Linux. A packaged build sets this up properly;
do not present `--no-sandbox` as the shipping configuration.

## Packaging & distribution — Roadmap (not done yet)
There is **no installer yet** — the site must not offer a "Download" until this ships.
Plan (electron-builder):
- **Linux:** `.AppImage` + `.deb` (candidates: Flatpak, `.rpm`).
- **macOS:** `.dmg`, requires **Apple Developer ID signing + notarization** (else Gatekeeper blocks it).
- **Windows:** NSIS `.exe`, requires a **code-signing certificate** (else SmartScreen warns).
- **Auto-update:** electron-updater.

## Security posture (safe to state)
- Renderer (the Splitser UI) runs isolated: `contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: true`; it reaches main only through a narrow preload bridge.
- Every `<webview>` is treated as hostile web content.
- Vault: the derived AES-GCM key lives **only** in the isolated renderer while unlocked —
  never in a webview, never in the main process (main is a dumb ciphertext store). Idle
  auto-lock (15 min). No master password or password hash is ever stored.

## Known limits (be upfront)
- Ad-block / extensions: Electron loads unpacked Chrome extensions with **partial** API
  coverage — don't promise full uBlock-grade blocking.
- No mobile.
- `<webview>` is Electron's DOM-flowed guest view (great for tiling); `WebContentsView` is
  the documented fallback if perf/robustness ever needs it.
