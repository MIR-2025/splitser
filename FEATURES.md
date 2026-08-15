# Splitser — feature spec (source of truth)

Canonical list of what Splitser does. The splitser.org site + any spec should cite this;
if the app and this file disagree, the file is wrong — fix it here first. Status is one of
**Built** (in `master`, verified) or **Roadmap** (not built — do not claim on the site).

**What it is:** a *tiling desktop browser*. Multiple resizable panes, each a real Chromium
view (Electron + `<webview>`), so any site loads first-party — no iframe embedding, no CSP
header-stripping. It's the "Split Screen" Brave extension's tiling UI as a standalone app,
plus everything a browser owns.

**Why not just the extension:** the extension frames sites in iframes (needs to strip
XFO/CSP, breaks on JS-framebusting sites, depends on third-party cookies that are being
killed). Splitser's panes are real top-level views: first-party cookies, reaches
framebusting sites, no header-stripping. And its vault is *part of the browser* — filling a
login doesn't hand a third-party extension read/write access across every site you tile.

## Tiling & panes — Built
- Dynamic panes: **resizable columns** (default — drag the gutter) plus **grids up to 3×3**.
  The status-bar **`Grid: C×R`** control has a 3×3 hover-to-pick flyout (`Ctrl+1` = columns,
  `Ctrl+2` = 2×2, `Ctrl+3` = 3×3); picking a shape sets the pane count to match. There's also a
  **1+2 layout** (one tall pane + two stacked) — click the Splitser logo in the Workspaces bar
  for it. The choice persists per set.
- **Resizable everywhere:** every internal border drags. Columns have vertical gutters; the
  2×2 / 3×3 grids have draggable dividers on **both** axes (a column divider resizes that
  column across all rows, a row divider resizes that row across all columns), plus a
  **diagonal handle at each divider crossing** that reproportions both axes in one drag.
  Sizes persist per layout. Dragging works over a page because a full-window shield overlays
  the webviews for the duration of the drag.
- **Sets (workspaces):** a *set* is a whole independent grid of panes with its own layout.
  `Ctrl+T` (or **+ Workspace** in the top **Workspaces** bar) opens a **new set** — a fresh
  two-pane grid — and switches to it; click a pill to switch, its `×` to close a set. Each set
  stays in the DOM while you're on another (hidden, **webviews kept alive** — audio keeps
  playing, page state is preserved). **Named:** each pill shows a favicon + a name (auto-derived
  from the set's first site, e.g. `github.com`, and renamable inline via the `✎`); the bar wraps
  its pills across rows like the Split Screen extension. Every set's name, layout, panes, tabs,
  and the active set all restore with the session. This is the three-level hierarchy:
  **sets → panes → tabs**.
- **Per-workspace theme:** each set carries its own colours/backdrop; a new set inherits the
  current look then diverges. Persists per set.
- **Private (incognito) workspaces:** the 🕶 button in the Workspaces bar (or `Ctrl+Shift+N`)
  opens a workspace whose panes use an **in-memory session** — cookies, cache and localStorage
  never touch disk. It saves no history, is excluded from session restore, and its session is
  wiped when the last private workspace closes. It still gets the same ad/tracker blocking and
  default-deny permissions as normal browsing. Shown as a purple "Private" pill.
- **Panes:** split (toolbar `+`) / close (toolbar `×`), within the current set. Closing a
  workspace or a multi-tab pane asks for confirmation first.
- **Tabs per pane:** every pane has its own tab strip — new tab (strip `+`), close tab
  (tab `×`), click a tab to switch. `Ctrl+W` closes the current tab, and cascades: the last
  tab closes its pane, the last pane closes its set. Each tab is a real live `<webview>`;
  background tabs stay alive (hidden, not destroyed), so audio keeps playing and state is
  preserved. Tabs restore with the session.
- Per-pane toolbar: back / forward / reload, favicon, address bar, bookmark star, split, close.
- `target=_blank` / `window.open` opens a **new pane**, not an OS window.
- **Roadmap:** free-form nested 2-D splits — splitting *any* pane into arbitrary rows/columns
  (the built layouts are columns, grids up to 3×3, and the 1+2 shape, all resizable).

## Navigation — Built
- Address bar: URL or search (configurable engine). Real per-pane back / forward / reload / history.
- **History-backed address autocomplete** (type → matches drop down, ↑/↓/Enter).
- Native **find-in-page** (`Ctrl+F`) — real highlight + match count + next/prev.
- Per-pane **zoom** (`Ctrl+=` / `-` / `0`), **mute** (`Ctrl+M`), and **print** (`Ctrl+P`, prints the focused pane).
- **Right-click context menu** on web content: back/forward/reload, open link in new pane / new tab,
  copy link, image open/copy/save, cut/copy/paste in fields, "Search for …", inspect element.
- **Local files (`file://`):** paste a bare path (`/…`, `~/…`, `C:\…`) into the address bar and it
  opens as a local file. **Markdown** files render (themed, readable) with a Rendered/Raw toggle;
  **PDFs** open inline in the built-in viewer. Local-file tabs restore with the session.
- **Vanilla Chrome User-Agent** — panes present as plain Chrome (no `Electron`/`Splitser` tokens),
  so sites like Google sign-in don't refuse them.
- **Focus indicator** — an accent line marks the pane that has focus, and the **window title**
  follows the focused pane.
- Hovered-link URL in the status bar. Shortcuts fire even while a page has focus. Footer popovers
  close on any click outside them.

## Shields (ad + tracker blocking) — Built
- **On by default.** EasyList / EasyPrivacy-class filtering via the Ghostery engine, applied at
  the session level — blocks ad + tracker requests (not just cosmetics). Engine caches locally
  after a one-time fetch.
- Per-pane `🛡` with a **live count** of what was blocked on the active page; a popover gives a
  **per-site** toggle (allowlist a host) and a global on/off. Both persist.

## Browser data — Built
- **Bookmarks** (`Ctrl+D` / star; a `★` panel to open/remove). **Workspace bookmarks** — save the
  current workspace's whole layout + panes/tabs (`Ctrl+Shift+D`, or "Save workspace" in the panel)
  and reopen it later as a new set.
- **Session restore** — reopens the sets/panes/tabs (including `file://` tabs) you had open on
  relaunch; private workspaces are excluded.
- **Downloads** — saved to the OS Downloads folder (server-set name is basename-only + collision-safe);
  a slide-in **toast** per download (progress → "Downloaded", with Open / Show-in-folder) plus a `↓` panel.
- **HTTP auth** — sites/dev servers behind Basic/Digest auth get an in-app sign-in dialog, prefilled
  from the vault, matched by **host:port** (so localhost apps on different ports don't collide).
- **Permission prompts** — native allow/deny for camera / mic / geolocation / notifications; everything else defaults to deny.
- **Settings** — home page, search engine, clear history/bookmarks/session.
- **Theme** — colour presets, one-click "looks", a photographic backdrop banner behind the chrome, dim slider, custom accent/image.
- All local: JSON in the app's userData. No server, no account, no sync, no telemetry.

## Password vault — Built
- Local password manager. Master password → **PBKDF2-SHA256 (600k)** → **AES-256-GCM** key
  that encrypts the entries. Master password + key are **never stored**; only ciphertext at
  rest (`vault.enc`). Wrong master password = GCM auth-fail on decrypt (no password hash stored).
- Open with `Ctrl+K` or the `🔑` status button: create/unlock, search, add, generate,
  copy user/pass (clipboard auto-clears ~25 s), delete, "From current page" capture, CSV import.
- **Autofill** — focus a username/password field and a dropdown of matching saved logins
  appears **anchored under the field**; click one to fill both username + password (the `🔑`
  status button also fills the active pane, with a chooser when several match). Values are set
  through the native input setter so **React/Vue forms register the change and enable their
  submit button** — that's why logins like Stripe fill correctly. An extension *can* fill logins
  too (a content script with `all_frames`); the honest difference is the **permission surface** —
  the vault is part of the browser, so no third party gets read/write across every site you tile,
  and the key never leaves the isolated renderer.
- **Offer to save** — when you submit a login in any pane, Splitser offers to save it: an
  in-pane bar (`Save password for <host>?`) appears, or `Update…?` if the password changed,
  and it stays quiet if that login is already stored. A tiny per-webview preload (set from
  main, so a page can't spoof it) notices the submit and reports `{host, username, password}`
  up to the vault; the vault key never goes near the page. If the vault is locked it offers
  "Unlock & save" and completes the save once you unlock.
- **Never locked out** — the unlock screen has a "Forgot it? Reset the vault…" escape: a
  two-step in-panel confirm wipes the ciphertext and returns you to the create form. Honest
  about the trade: reset **erases** the stored logins, it can't recover them (zero-knowledge).
- Key lives only in the isolated renderer while unlocked; idle auto-lock at 15 min.

## Not built yet — Roadmap (do not claim)
Free-form nested 2-D splits (columns, grids up to 3×3, and the 1+2 layout *are* built and
resizable — what's not built is splitting any pane into arbitrary rows/columns) ·
**code-signing + notarization + auto-update** (installers are built by CI but unsigned) ·
external Chrome extension support · mobile.

## Packaging & distribution — Built
electron-builder produces **`.deb` / `.rpm` / `.AppImage`** (Linux), an **NSIS `.exe`** (Windows),
and a **`.dmg`** (macOS) via CI (GitHub Actions) on each release tag. Not code-signed yet, and
only the Linux build has actually been run — see REQUIREMENTS.md.
