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
- Dynamic panes: **resizable columns** (default — drag the gutter to resize) plus **2×2 and
  3×3 grid layouts**. Switch with the status-bar picker or `Ctrl+1` (columns) / `Ctrl+2` (2×2)
  / `Ctrl+3` (3×3); the choice persists across launches, and switching to a grid tops up to
  its cell count.
- **Resizable everywhere:** every internal border drags. Columns have vertical gutters; the
  2×2 / 3×3 grids have draggable dividers on **both** axes (a column divider resizes that
  column across all rows, a row divider resizes that row across all columns), plus a
  **diagonal handle at each divider crossing** that reproportions both axes in one drag.
  Sizes persist per layout. Dragging works over a page because a full-window shield overlays
  the webviews for the duration of the drag.
- **Sets (workspaces):** a *set* is a whole independent grid of panes with its own layout.
  `Ctrl+T` (or the `+` in the top set-bar) opens a **new set** — a fresh two-pane grid — and
  switches to it; click a numbered pill to switch, its `×` to close a set. Each set stays in
  the DOM while you're on another (hidden, **webviews kept alive** — audio keeps playing,
  page state is preserved). Each pill shows the favicons of the sites in that set, so sets are
  identifiable at a glance. Every set's layout, panes, tabs, and the active set all restore
  with the session. This is the three-level hierarchy: **sets → panes → tabs**.
- **Panes:** split (toolbar `+`) / close (toolbar `×`), within the current set.
- **Tabs per pane:** every pane has its own tab strip — new tab (strip `+`), close tab
  (tab `×`), click a tab to switch. `Ctrl+W` closes the current tab, and cascades: the last
  tab closes its pane, the last pane closes its set. Each tab is a real live `<webview>`;
  background tabs stay alive (hidden, not destroyed), so audio keeps playing and state is
  preserved. Tabs restore with the session.
- Per-pane toolbar: back / forward / reload, favicon, address bar, bookmark star, split, close.
- `target=_blank` / `window.open` opens a **new pane**, not an OS window.
- **Roadmap:** free-form 2-D splits — splitting *any* pane into rows/columns arbitrarily and
  nesting (the built grids are the fixed 2×2 / 3×3 shapes, now resizable); **named** sets
  (sets exist and persist today, but they're numbered — naming/renaming is not built).

## Navigation — Built
- Address bar: URL or search (configurable engine). Real per-pane back / forward / reload / history.
- **History-backed address autocomplete** (type → matches drop down, ↑/↓/Enter).
- Native **find-in-page** (`Ctrl+F`) — real highlight + match count + next/prev.
- Per-pane **zoom** (`Ctrl+=` / `-` / `0`) and **mute** (`Ctrl+M`).
- Hovered-link URL in the status bar. Shortcuts fire even while a page has focus.

## Browser data — Built
- **Bookmarks** (`Ctrl+D` / star; a `★` panel to open/remove).
- **Session restore** — reopens the panes you had open on relaunch.
- **Downloads** — saved to the OS Downloads folder; a `↓` panel tracks progress.
- **Permission prompts** — native allow/deny for camera / mic / geolocation / notifications.
- **Settings** — home page, search engine, clear history/bookmarks/session.
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
Named sets (switchable, persisted sets *are* built — naming/renaming them is not) · free-form
2-D splits (the fixed 2×2 / 3×3 grids *are* built and resizable on both axes — what's not built
is splitting any pane arbitrarily into rows/columns) · packaging +
code-signing + auto-update (no installer yet) · ad-block / extension support (Electron loads
unpacked extensions only partially) · mobile.
