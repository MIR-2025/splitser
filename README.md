# Split (standalone) — Phases 0–2

Lifting the **Split Screen** extension's tiling UI onto a real browser shell:
**Electron + `<webview>`**. A `<webview>` is a real Chromium view, not an iframe — so it
embeds anything, with no `X-Frame-Options` / CSP header-stripping and none of the
framing-detection games the extension has to play.

**Phase 1** is the tiling shell: a dynamic set of panes laid out as **resizable columns**.
Each pane is a real browser view with its own toolbar — back / forward / reload, favicon,
address bar, split and close. Drag the gutter between two panes to resize them. It boots
pointed at **github.com** and **dashboard.stripe.com** — two sites the iframe version
flat-out cannot embed — so the first thing you see is the ceiling being gone.

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

Workspaces, bookmarks store, history + address autocomplete, downloads, settings
(Phases 3–4). The grid is columns-only for now — 2-D splits come later.

## Security notes

The renderer (this UI) runs isolated: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. It only touches the DOM and the `<webview>` element API — no Node bridge.
Webview content is treated as the whole hostile web.

`npm start` passes `--no-sandbox` because an npm-installed Electron's `chrome-sandbox`
helper isn't SUID-root on Linux. That's a dev convenience only. For a real build, either
package with electron-builder (which sets it up) or `sudo chown root:root` +
`chmod 4755 node_modules/electron/dist/chrome-sandbox` and drop the flag.
