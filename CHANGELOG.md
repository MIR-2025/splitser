# Changelog

All notable changes to Splitser. Each version is a tagged CI release; installers
(`.deb` / `.rpm` / `.AppImage` / `.exe` / `.dmg`) are built per tag and are currently
**unsigned** (expect a SmartScreen / Gatekeeper prompt). Which builds have actually been run on
real hardware varies by release -- the Linux `.deb` is what's used here day to day; the download
page on splitser.org tracks the per-release, per-artifact verification status.

## 0.1.13 — 2026-08-17
### Security
Hardening from an authorised white-box security review (findings #1-#5). The fixes are defensive --
nothing was exploited in the wild -- and none change how the app looks or works day to day.
- **A download filename can't inject markup into the app frame.** The single HTML escaper now escapes
  quotes as well as `& < >`, so a server-chosen filename containing a `"` can no longer break out of the
  download toast's `title="…"` attribute. The separate "attribute-only" escaper was removed -- there is
  now exactly one escaper, and it is always attribute-safe, so the unsafe short-named one can't be
  reached for by habit and regress this. The markdown viewer's own separate escaper (it builds link
  `href`s and feeds `innerHTML`) was hardened the same way, and the CSP that blocks inline script -- the
  backstop that keeps this Medium rather than Critical -- now carries a comment warning against relaxing it.
- **A shared theme code can't smuggle in a remote image.** The imported-theme image filter now validates
  the *whole* data-URL (base64 raster only) rather than just its `data:image/` prefix. This closes a hole
  where a crafted `SST1.` code appended a second `url(https://…)` and quietly beaconed the recipient's IP
  (and user-agent) to a third party every time the theme painted.
- **HTTP-auth prompts only appear for the page you actually navigated to.** A 401 from a cross-origin
  *subresource* (e.g. a hostile page embedding `<img src="https://intranet/secret">`) is now silently
  declined instead of popping a sign-in box. When a prompt does appear it names the full origin
  (scheme + host), and vault prefill requires an exact `host:port` match -- it no longer offers a
  domain-wide saved password on a prompt the user didn't initiate.
- **Saved passwords respect the scheme.** An https-saved credential is no longer offered on a plaintext
  `http://` page of the same host, so a downgraded or impostor page on a hostile network can't light the
  key icon and put the real password one click away.
- **The vault key-derivation has a floor.** The PBKDF2 iteration count read from the vault file is clamped
  to at least 600,000, so a tampered file can't ask for a weaker derivation.

## 0.1.12 — 2026-08-17
### Fixed
- **The About popover now toggles on the "Splitser" label.** Clicking the footer "Splitser" label a
  second time closes the About flyout instead of flickering it shut-then-open — the global panel
  outside-close (which fires on `mousedown`) was closing it just before the `click` could toggle it, so
  it reopened. The brand label is now exempt from that handler, like the status-bar buttons are.

## 0.1.11 — 2026-08-16
### Added
- **Remember a download folder per site.** A third Downloads mode in Settings: the first download
  from a site asks where to save (native Save As…), then every later download from that same site
  auto-saves to the folder you chose. Stored per host, so different sites can have different folders.
- **Custom favicon: upload an image.** The per-site favicon picker (click a pane's favicon) now
  accepts an uploaded image — downscaled to a 64px icon — alongside the existing emoji and colour
  options. Applies immediately to every tab on that host and persists.
### Changed
- **Top-left logo** in the Workspaces bar is now the real Splitser mark (matching the app icon),
  replacing the placeholder — still click it for the 1+2 layout. Workspace labels are now white.

## 0.1.10 — 2026-08-16
### Added
- **5 more backdrop banners** — Lake, Prairie, Stream, Waterfall, Sundown (wide scenic header images),
  added alongside the existing photos in the theme dialog's Backdrop row.
- **macOS Intel build.** CI now builds the `.dmg` for both **Apple Silicon (arm64)** and **Intel (x64)**,
  so Intel Macs have a native download too.
### Changed
- **Real app icon.** The packaged app now uses the official Splitser mark (rendered from
  `splitser.org/public/icon.svg`) -- the blue/green tiled panes with the cyan `<>` gutter -- instead of
  the plain placeholder, so the app/taskbar/dock icon matches the site and the Stripe checkout. The
  Windows `.ico` and macOS `.icns` are generated from it at build time.
- **GitHub Releases.** The build workflow now publishes a GitHub Release for each `v*` tag with all
  five installers attached, so the repo's Releases page is a real download page (not just bare tags).
### Fixed
- **App icon shows in the Linux desktop menu.** The `.deb`/`.rpm` now ship the icon at all standard
  sizes (16–1024, from `build/icons/`) and refresh the icon cache on install, so the Applications ›
  Internet entry renders the logo instead of a generic placeholder. Before, only the 1024px icon was
  installed and no icon-cache refresh ran, so the menu couldn't find a usable size.
### Removed
- **Bubbles theme.** Removed the Bubbles look and its backdrop banner from the theme dialog. The
  bundled image stays, so any saved theme or restored workspace still referencing it keeps working.

## 0.1.9 — 2026-08-16
### Added
- **Download location choice.** Settings → **Downloads**: **Save to Downloads automatically** (the
  default) or **Ask where to save each time (Save As…)**, which shows the native save dialog for each
  download so you pick the folder and filename.

## 0.1.8 — 2026-08-15
### Added
- **Per-tab colours.** Each tab shows a small colour dot auto-derived from its site (same site → same
  colour, so tabs group at a glance). Right-click a tab to override that site's colour with a swatch,
  or reset to Auto. Manual overrides persist (per host).
- **About popover.** Click the "Splitser" label in the footer for the app name, **build version**
  (`app.getVersion()`), a `splitser.org` link, and a **Support Splitser** donate button that opens a
  Stripe pay-what-you-want donation checkout in a new tab.
- **Richer theme dialog (parity with the Split Screen extension).** Save, name, and delete **custom
  themes** ("My themes"), including custom banners; **export/import** a theme as a short `SST1.` code
  (remote-URL images filtered out); **4 gradient banners** (Dusk/Ember/Tide/Steel) alongside the photos;
  **four colour pickers** (background / toolbar / accent / text) instead of accent-only; a live
  ideal-image-size hint; a **Mono** look; and a **Remove image** button. Uploaded images are downscaled
  to JPEG before storing so `localStorage` doesn't bloat.
### Fixed
- **Linux install now launches from the desktop menu.** The `.deb`/`.rpm` always installs
  `chrome-sandbox` as setuid `4755` via a custom post-install script, so the app starts *with* its
  sandbox even on Ubuntu 24.04 (`apparmor_restrict_unprivileged_userns=1`). electron-builder's default
  heuristic (`unshare --user true`) mis-detected user namespaces there and left it at `0755`, so the
  installed app aborted silently from the menu (`FATAL … chrome-sandbox … mode 4755`) and only the
  `--no-sandbox` CLI worked.

## 0.1.7 — 2026-08-15
### Fixed
- **Raw text files are readable.** A plain-text document (`.txt`, logs, `SHA256SUMS`, any `text/plain`)
  opened locally now renders in Splitser's dark theme instead of the browser's unstyled default, which
  came out white-on-white. The `.md` viewer is unchanged.
- **"Open" on a download stays in Splitser.** Clicking Open on a finished download now opens viewable
  files (`.md`, `.txt`, `.pdf`, images, `.html`, …) in a new Splitser tab instead of handing them to the
  OS default app (a saved `.md` was opening in Brave). Non-renderable files (`.deb` / `.exe` / `.zip` / …)
  still open with the OS.

## 0.1.6 — 2026-08-15
### Added
- **Bookmark folders** — organize saved pages *and* saved workspaces into named, collapsible
  folders in the Bookmarks panel. Create with 📁 Folder, move items with the per-row folder menu,
  rename or delete a folder. Deleting a folder keeps its bookmarks — they fall back to Ungrouped.
  Folders persist to disk.
- **Zoom indicator** — a transient "120%" badge on the pane whenever you change zoom
  (`Ctrl+scroll` or `Ctrl+=` / `-` / `0`).

## 0.1.5 — 2026-08-15
### Added
- **Ctrl+scroll to zoom** a pane, in addition to `Ctrl+=` / `-` / `0`.
### Fixed
- `Ctrl++` (i.e. `Ctrl+Shift+=`) zoom-in regression introduced by the shortcut shift-prefix handling.

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
