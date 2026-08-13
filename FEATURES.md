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
killed, and *cannot autofill*). Splitser's panes are real top-level views: first-party
cookies, reaches framebusting sites, no header-stripping, and it can autofill.

## Tiling & panes — Built
- Dynamic panes laid out as **resizable columns**; add / split (`+` or `Ctrl+T`) / close
  (`×` or `Ctrl+W`); drag the gutter between two panes to resize.
- Per-pane toolbar: back / forward / reload, favicon, address bar, bookmark star, split, close.
- `target=_blank` / `window.open` opens a **new pane**, not an OS window.
- Grid is **columns-only** today.
- **Roadmap:** 2-D splits (rows within columns); workspaces (named, saved pane layouts).

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
- **Autofill** — the `🔑` on a pane fills the matching login into the page (chooser if
  multiple match). *This is what the extension structurally cannot do.*
- Key lives only in the isolated renderer while unlocked; idle auto-lock at 15 min.

## Not built yet — Roadmap (do not claim)
Workspaces · 2-D splits · packaging + code-signing + auto-update (no installer yet) ·
ad-block / extension support (Electron loads unpacked extensions only partially) · mobile ·
password autofill *on form submit* prompt (today: manual capture).
