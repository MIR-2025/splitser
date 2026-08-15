# Changelog

All notable changes to Splitser. Each version is a tagged CI release; installers
(`.deb` / `.rpm` / `.AppImage` / `.exe` / `.dmg`) are built per tag and are currently
**unsigned** — and only the **Linux** build has actually been run (see REQUIREMENTS.md).

## 0.1.4 — 2026-08-15
### Added
- **Workspace bookmarks** — save a whole workspace (layout + panes + tabs + name + theme) from
  the Bookmarks panel ("Save workspace") or `Ctrl+Shift+D`, and reopen it later as a new set.
### Changed
- FEATURES.md and REQUIREMENTS.md brought up to date with the current app.

## 0.1.3 — 2026-08-15
### Added
- **Private (incognito) workspaces** — the 🕶 button in the Workspaces bar, or `Ctrl+Shift+N`.
  Panes run on an in-memory session (cookies / cache / localStorage never touch disk); no history,
  excluded from session restore, and wiped when the last private workspace closes. Same ad/tracker
  blocking and default-deny permissions as normal browsing.
### Fixed
- HTTP-auth prefill matches **host:port**, so localhost apps on different ports no longer share one
  (wrong) saved user.

## 0.1.2 — 2026-08-14
### Added
- **Local files (`file://`)** — paste a bare path (`/…`, `~/…`, `C:\…`) to open a local file;
  **Markdown** files render (themed, readable) with a Rendered/Raw toggle; **PDFs** open inline.
- **Download toast** — a per-download notification (progress → "Downloaded", with Open / Show-in-folder).
- **1+2 layout** — click the Splitser logo for one tall pane + two stacked.
- The window title follows the focused pane; footer popovers close on any click outside them.
### Changed
- Panes present a **vanilla Chrome User-Agent** (no `Electron` / `Splitser` tokens) so sites like
  Google sign-in don't refuse them.
- The Splitser logo replaces the "Workspaces" label; "+ New grid" → "+ Workspace".
- CI builds on Node 24 (Node 20 is end-of-life).
### Fixed
- `file://` tabs now restore with the session (were being dropped).

## 0.1.0 — 2026-08-14
First packaged release.
### Added
- **Tiling desktop browser** — resizable panes, columns + grids up to 3×3 (a `Grid: C×R` picker),
  per-pane tabs, and **workspaces (sets)**: named, per-workspace themes, session-restored.
- **Browser essentials** — address bar + history autocomplete, find-in-page, per-pane zoom / mute /
  print, back/forward/reload, bookmarks, downloads, HTTP auth, permission prompts, right-click
  context menu, session restore, settings, dynamic theming + photographic backdrops.
- **Shields** — EasyList / EasyPrivacy ad + tracker blocking, on by default, with a per-pane count and toggle.
- **Password vault** — local, AES-256-GCM (PBKDF2-SHA256 600k), autofill, offer-to-save, CSV import.
- **Installers** — electron-builder produces `.deb` / `.rpm` / `.AppImage` / `.exe` / `.dmg` via CI.
