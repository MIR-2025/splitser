# Changelog

All notable changes to Splitser. Each version is a tagged CI release; installers
(`.deb` / `.rpm` / `.AppImage` / `.exe` / `.dmg`) are built per tag and are currently
**unsigned** (expect a SmartScreen / Gatekeeper prompt). Which builds have actually been run on
real hardware varies by release -- the Linux `.deb` is what's used here day to day; the download
page on splitser.org tracks the per-release, per-artifact verification status.

## 0.1.31 — 2026-08-25
### Fixed
- **Inspect element works again.** It had been opening DevTools *docked*, which a pane's web view can't
  do (it has no window to dock into), so nothing appeared. It now opens DevTools in its own window.
  ("Inspect in a new tab" still puts DevTools in a pane tab.)
- **"Save as PDF" from a full-page capture actually saves now.** The old path used Chromium's
  print-to-PDF, which silently failed on some systems (the save dialog appeared but no file was
  written). PDFs are now built directly from the captured image, so the file is always written.

## 0.1.30 — 2026-08-25
### Fixed
- **Full-page screenshot no longer duplicates a band on pages that scroll smoothly.** The stitch
  recorded each tile's scroll position separately from taking its picture, so on a page with
  smooth scrolling (or slow-to-settle content) the position didn't match the pixels and a strip
  repeated. It now scrolls with smooth-scrolling forced off, waits for the scroll to actually
  settle, and reads the position in the same step it captures -- and re-measures the page height
  as it goes, so lazily-loaded content is included.

## 0.1.29 — 2026-08-25
### Fixed
- **Full-page screenshot now captures the whole page, not the visible part repeated.** On 0.1.28 the
  capture tiled the visible viewport down the image instead of scrolling through the real content --
  because a `<webview>`'s off-screen area isn't rendered until it's scrolled into view. It now
  scroll-and-stitches the page a viewport at a time onto one image, so what you save is the actual
  full page. Very tall pages are still scaled to stay within image limits.

### Added
- **A close (×) button on the capture preview** (and **Esc** closes it too) -- previously the only way
  out was clicking a workspace pill.

## 0.1.28 — 2026-08-25
### Added
- **Full-page screenshots.** Right-click a page → **Capture full page**. It grabs the whole
  scrollable page in one shot (not just the visible part), shows a preview, and lets you **save
  as PNG**, **save as PDF**, or **copy to the clipboard**. Very tall pages are scaled down to stay
  within image limits, and the preview tells you when that happened.
- **Inspect inside the pane.** The right-click menu now offers *Inspect element* (DevTools docked
  in the pane) and *Inspect in a new tab* (DevTools rendered into a fresh tab in the same pane),
  instead of only a separate floating window.
- **Switch workspaces from the keyboard.** **Ctrl+Tab** goes to the next workspace (wrapping past
  the last to the first); **Ctrl+Shift+Tab** goes to the previous (wrapping to the last).
- **Reorder workspaces by dragging.** Drag a pill in the Workspaces bar to a new position; the new
  order is remembered across restarts. A plain click still switches workspaces.

### Fixed
- **Closing a pane no longer leaks its page.** A pane/tab's page (and any DevTools open on it) is now
  fully destroyed on close. Previously an open DevTools kept the page — and its window — alive in the
  background after the pane was gone.

> Note: 0.1.27 was pulled before general use (a geolocation feature that didn't pan out); 0.1.28 is
> the next shipping release and does not include it.

## 0.1.26 — 2026-08-19
### Added
- **Workspace activity badges.** When pages change -- new titles or navigations -- in a workspace that
  isn't the one on screen, its pill in the Workspaces bar shows a **count** of how many changes happened
  there. Visiting the workspace clears it. Initial page loads don't count (a tab only starts counting after
  its first load settles), and rapid title changes from a single tab are coalesced (~2s) so a page that
  rewrites its title constantly can't inflate the number.

## 0.1.25 — 2026-08-19
### Fixed
- **RPM post-remove scriptlet no longer fails the transaction.** The package registers its launcher
  through `update-alternatives`, but shipped electron-builder's default post-remove, which tried to remove
  a different alternative path than the one installed -- so on upgrade it errored (`/usr/bin/splitser has
  not been configured as an alternative for splitser`) and, on Fedora's dnf5, failed the whole transaction.
  A custom post-remove now removes the exact alternative that was installed, only on a real uninstall (not
  an upgrade, where the new package owns it), and never exits non-zero.

  **This takes effect from the _next_ upgrade, not this one.** On any upgrade it's the *outgoing* package's
  post-remove that runs -- so anyone already on 0.1.21–0.1.24 still hits the old broken scriptlet once when
  upgrading to 0.1.25. 0.1.25 is the last version that *triggers* the error, the first that no longer *ships*
  it. It's **RPM-only**: Debian's `update-alternatives` ignores an unregistered path and exits 0, so `.deb`
  upgrades were never affected. One-time recovery on Fedora -- clear the old package without running its
  scriptlet, then install fresh:

  ```
  sudo rpm -e --noscripts splitser
  sudo dnf install ./Splitser-0.1.25-x86_64.rpm
  ```

## 0.1.24 — 2026-08-18
### Changed
- **macOS builds are now signed with a Developer ID and notarized by Apple.** The `.dmg` runs the app under
  the hardened runtime, signed with a Developer ID Application certificate and stapled with an Apple
  notarization ticket -- so it opens without the Gatekeeper "unidentified developer" / "can't be opened"
  warning. (Windows and Linux installers remain unsigned for now.)

## 0.1.23 — 2026-08-18
### Fixed
- **Invalid-certificate pages no longer blank silently.** When a site's TLS certificate is untrusted
  (expired, self-signed, wrong domain, revoked…), the pane now shows a "Your connection isn't private"
  interstitial explaining the problem, with **Back to safety** and **Proceed anyway (unsafe)**. Proceeding
  trusts that host for the rest of the session and reloads. Previously the load just failed to a blank pane
  with no warning and no way through.

## 0.1.22 — 2026-08-18
### Added
- **History from the nav buttons.** Right-click the back or forward button in a pane to get a menu of up to
  10 history entries (page titles) and jump straight to any of them -- back lists the pages behind the
  current one, forward the pages ahead, each nearest-first. Left-click still steps one page at a time.

## 0.1.21 — 2026-08-18
### Added
- **Reopens where you left it.** Splitser remembers its window size, position, and which monitor it was on,
  and restores them on launch. If that monitor is no longer connected, it falls back to centered on the
  primary display, so a disconnected screen can't strand the window off-screen.
- **Match theme colours to the header image.** In Appearance, when a header image is set, a "🎨 Match
  colours" button derives the palette from it -- a dark, image-tinted background and toolbar plus the
  image's most vibrant colour as the accent. (Pick a sunset banner, hit it, and the theme goes warm.)

## 0.1.20 — 2026-08-18
### Added
- **Works as a default web browser.** Splitser now registers as an http/https handler and opens links
  handed to it: click a link in another app (email, chat, terminal) and it opens in a new pane in the
  current workspace. It runs a **single instance per profile** -- a second launch (like a clicked link)
  hands its URL to the running window instead of starting a duplicate. (`splitser new <name>` still gets
  its own separate instance + profile, since it uses a different profile dir.)
### Fixed
- The packaged `.desktop` now sets `MimeType=x-scheme-handler/http;https;text/html;…`, so the OS can route
  web links to Splitser (then `xdg-settings set default-web-browser splitser.desktop`). Before there was no
  MimeType, so Splitser couldn't be registered as a browser at all -- and even if launched, it ignored the
  URL (no argv handling); both are fixed.

## 0.1.19 — 2026-08-17
### Added
- **Per-pane split tiling (Terminator-style).** `Ctrl+Shift+E` splits the focused pane to the **right**,
  `Ctrl+Shift+O` splits it **below** -- the focused pane divides in two and the other panes stay put,
  instead of re-orienting the whole workspace. Splits nest arbitrarily; **drag any boundary** to resize,
  or grab the **round handle where two boundaries cross** to resize both axes at once. Split layouts
  persist across restart and restore exactly. Panes never re-parent, so splitting never reloads a page.
### Changed
- **`Ctrl+Shift+E` / `Ctrl+Shift+O` now do per-pane directional splits** (in 0.1.15 they re-oriented the
  entire workspace). The whole-workspace layouts are still available via the `Grid: C×R` picker, the 1+2
  logo layout, and `Ctrl+1/2/3`; choosing one of those clears the split tree for that workspace.

## 0.1.18 — 2026-08-17
### Fixed
- **Workspaces no longer wiped on launch (critical regression in 0.1.17).** The 0.1.17 security badge added
  `pane.updateLock()`, which read `webview.getURL()` **synchronously**. During session restore a pane's
  webview isn't attached/dom-ready yet, so `getURL()` throws -- and because `updateLock` runs synchronously
  inside `switchTab()`, that throw aborted the entire restore loop: no workspaces rebuilt, after which
  `saveSession()` overwrote `session.json` with the empty state. `updateLock` now wraps `getURL()` in
  try/catch, so a not-yet-ready webview can never break the restore. (The badge simply appears once the page
  finishes loading, via `did-navigate`.) If 0.1.17 wiped your workspaces, restore `session.json` from a
  backup **before** launching.

## 0.1.17 — 2026-08-17 [YANKED — blank UI / wipes workspaces; do not use]
### Added
- **Site security badge + certificate viewer.** The address bar now shows a lock badge on real remote
  sites: a green lock for HTTPS ("secure") or an amber warning for plain HTTP ("not secure"). Click it for
  the connection status and, on HTTPS, the site's TLS certificate -- issued to, issued by, the validity
  window, and the SHA-256 fingerprint. Nothing is shown for `file://`, `about:`, or localhost (which is
  fine over http). The cert is observed during Chromium's own verification; Splitser never overrides the
  trust decision, so a bad certificate is still blocked exactly as before.

## 0.1.16 — 2026-08-17
### Added
- **Suggest a strong password on sign-up.** Focus a "create password" field (an `autocomplete=new-password`
  field, or the password + confirm pair on a signup form) and Splitser offers one strong generated password;
  clicking it fills both the password and confirm fields. It then flows into the vault the usual way -- when
  you submit, Splitser offers to save it with the username you typed. Sign-IN password fields are unaffected
  (they still offer saved logins).

## 0.1.15 — 2026-08-17
### Added
- **Split shortcuts.** `Ctrl+Shift+E` opens a new pane **to the right** (lays the workspace out as
  horizontal columns); `Ctrl+Shift+O` opens a new pane **below** (a vertical stack). Both land you in the
  new pane's address bar. These orient the whole workspace -- horizontal vs vertical -- rather than
  splitting only the focused pane; true per-pane 2-D splits remain on the roadmap.

## 0.1.14 — 2026-08-17
### Added
- **A clear notice when a site needs DRM video.** Netflix, Disney+, Prime Video, Spotify and the like use
  Widevine / PlayReady DRM, which vanilla Electron doesn't ship -- so they can't play in Splitser. Instead
  of leaving you with only the service's cryptic error (Netflix's "M7701-1003"), Splitser now recognises
  those services and shows a dismissible bar along the bottom of the pane: "This site needs DRM video …
  that Splitser can't play. Open it in your main browser." Non-DRM video (YouTube, Twitch, most embedded
  players) is unaffected.

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
