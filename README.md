# Splitser — a tiling browser · splitser.org

**Splitser** lifts the **Split Screen** extension's tiling UI onto a real browser shell:
**Electron + `<webview>`**. A `<webview>` is a real Chromium view, not an iframe, so it
embeds anything as a first-party, top-level page — no CSP header-stripping, no
framing-detection games, and it survives third-party-cookie deprecation the way the
extension can't.

Panes tile as **resizable columns**, each a real browser view with its own toolbar
(back / forward / reload, favicon, bookmark star, address bar, split, close). It's a
data-backed browser now — history, bookmarks, session restore, downloads, and settings all
persist locally (`~/.config/splitser`). Boots on **github.com** + **dashboard.stripe.com**
the first time; after that it reopens whatever you had.

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
- **Focus address** `Ctrl+L` · **Reload pane** `Ctrl+R`.

Shortcuts fire even while a page has focus (they're forwarded from the main process, since
webview key events don't bubble to the host). Logins persist (all panes share the
`persist:split` session).

## What's native here that the extension fakes

| Extension | This spike |
|---|---|
| `declarativeNetRequest` strips XFO/CSP so sites embed | not needed — webviews embed anything |
| custom find, favicon scraping, hover-link content script | native `webview` events |
| no reliable per-pane history | real `goBack()` / `goForward()` / `reload()` |

## Not yet (later phases)

Workspaces (saved pane layouts), password/autofill, ad-block/extensions, 2-D splits, and a
packaged + code-signed build with auto-update. The grid is columns-only for now.

## Security notes

The renderer (this UI) runs isolated: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. It only touches the DOM and the `<webview>` element API — no Node bridge.
Webview content is treated as the whole hostile web.

`npm start` passes `--no-sandbox` because an npm-installed Electron's `chrome-sandbox`
helper isn't SUID-root on Linux. That's a dev convenience only. For a real build, either
package with electron-builder (which sets it up) or `sudo chown root:root` +
`chmod 4755 node_modules/electron/dist/chrome-sandbox` and drop the flag.
