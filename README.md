# Splitser — a tiling browser · splitser.org

**Splitser** lifts the **Split Screen** extension's tiling UI onto a real browser shell:
**Electron + `<webview>`**. A `<webview>` is a real Chromium view, not an iframe, so it
embeds anything as a first-party, top-level page — no CSP header-stripping, no
framing-detection games, and it survives third-party-cookie deprecation the way the
extension can't.

Panes tile as **resizable columns**, each a real browser view with its own toolbar
(back / forward / reload, favicon, bookmark star, address bar, split, close). It's a
data-backed browser now — history, bookmarks, a **password vault (with autofill)**, session
restore, downloads, and settings all persist locally (`~/.config/splitser`). Boots on
**github.com** + **dashboard.stripe.com** the first time; after that it reopens whatever you had.

## Run

```sh
npm install     # pulls the Electron runtime (~large, one time)
npm start
```

- **Address bar** — type a URL or a search, Enter to go. Reload / back / forward are real
  per-view navigation; each pane keeps its own history.
- **Split** — the `+` on a pane's toolbar (or `Ctrl+T`) opens a new pane to its right.
- **Close** — the `×` (or `Ctrl+W`); the last pane always stays.
- **Resize** — drag the gutter between two panes.
- **Find in page** — `Ctrl+F` (native `webview.findInPage` — real highlights + match count).
- **Zoom** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, per pane.
- **Mute** — `Ctrl+M`, or the speaker button that appears when a pane plays audio.
- **Open in new pane** — a `target=_blank` link or popup opens a **new pane**, not a window.
- **Bookmark** — the `☆` on a pane (or `Ctrl+D`); the `★` in the status bar lists them.
- **Address autocomplete** — as you type, matches from your history drop down (↑/↓, Enter).
- **Downloads** — saved to your Downloads folder; the `↓` status button tracks progress.
- **Settings** — the `⚙` status button: home page, search URL, and clear history/bookmarks.
- **Session restore** — reopens the panes you had open on relaunch.
- **Vault** — `Ctrl+K` (or the `🔑` status button): a local password manager. Master password
  → PBKDF2-SHA256 (600k) → AES-256-GCM; only ciphertext is written, the master password and
  key are never stored. The `🔑` on a pane **fills the matching login**, "From current page"
  captures one, and browser-CSV import works. Autofill is the thing the *extension* couldn't
  do — it needs the host access a real browser view has.
- **Focus address** `Ctrl+L` · **Reload pane** `Ctrl+R`.

Shortcuts fire even while a page has focus (they're forwarded from the main process, since
webview key events don't bubble to the host). Logins persist (all panes share the
`persist:split` session).

## What's native here that the extension fakes

| The extension (iframes) | Splitser (webviews) |
|---|---|
| `declarativeNetRequest` strips XFO **and** CSP so sites frame at all | embeds first-party, no stripping |
| framed sites lean on third-party cookies (being deprecated) | first-party — immune |
| JS framebusting (`top !== self`) still breaks it | a webview isn't a frame — passes |
| custom find, favicon scraping, hover-link content script | native `webview` events |
| **cannot autofill** (no host access) | fills logins via the vault |

## Not yet (later phases)

Workspaces (saved pane layouts), 2-D splits, a packaged + code-signed build with auto-update,
ad-block / extension support (partial in Electron), and mobile. The grid is columns-only for now.

**Canonical:** see [`FEATURES.md`](FEATURES.md) for the built-vs-roadmap list and
[`REQUIREMENTS.md`](REQUIREMENTS.md) for software requirements + OS compatibility. If this
README disagrees with those, those win.

## Security notes

The renderer (this UI) runs isolated: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. It only touches the DOM, the `<webview>` element API, and a narrow preload
bridge. Webview content is treated as the whole hostile web.

**Vault crypto** is all standard WebCrypto (ported from the Vault extension): the derived
AES-GCM key lives *only* in this isolated renderer while unlocked, never in a webview and
never in main — main is a dumb ciphertext store. An idle auto-lock (15 min) and an explicit
Lock clear the key from memory. A wrong master password fails the GCM auth tag on decrypt —
that *is* the password check, so no password hash is stored either. Copied secrets are
cleared from the clipboard after ~25s.

`npm start` passes `--no-sandbox` because an npm-installed Electron's `chrome-sandbox`
helper isn't SUID-root on Linux. That's a dev convenience only. For a real build, either
package with electron-builder (which sets it up) or `sudo chown root:root` +
`chmod 4755 node_modules/electron/dist/chrome-sandbox` and drop the flag.
