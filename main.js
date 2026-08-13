// Split (standalone). Main process: one window hosting the renderer UI, with <webview>
// enabled. Webviews are real Chromium views, so they embed anything -- no header-strip.
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win;

// Shell shortcuts must reach the renderer even while a webview has focus -- webview key
// events don't bubble to the host -- so we intercept them on EVERY webContents (host +
// each webview) and forward. This also stops the built-in Ctrl+R/W/zoom accelerators from
// acting on the shell; the renderer routes each to the active pane instead.
const SHORTCUTS = new Set(['t', 'w', 'l', 'r', 'f', 'm', '=', '+', '-', '0']);
function wireShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = (input.key || '').toLowerCase();
    if (SHORTCUTS.has(k)) { event.preventDefault(); if (win) win.webContents.send('shortcut', k); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    backgroundColor: '#0e1418',
    title: 'Split',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,        // enable <webview>
      contextIsolation: true,  // renderer (our trusted UI) is isolated
      nodeIntegration: false,  // ...and uses only the DOM + webview API + the preload bridge
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  wireShortcuts(win.webContents);
}

app.whenReady().then(() => {
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    // a page opening a popup / target=_blank -> a new PANE, not an OS window
    contents.setWindowOpenHandler(({ url }) => {
      if (win && /^(https?:|about:)/.test(url)) win.webContents.send('open-pane', url);
      return { action: 'deny' };
    });
    wireShortcuts(contents);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
