// Split (standalone) -- Phase 0 spike. Main process: one window that hosts the renderer
// UI, with <webview> enabled. The whole point of the spike: webviews are real Chromium
// views, so they embed sites an iframe (the extension) is refused by. No header-stripping.
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    backgroundColor: '#0e1418',
    title: 'Split — spike',
    webPreferences: {
      webviewTag: true,        // enable <webview> in the renderer
      contextIsolation: true,  // renderer (our trusted UI) is isolated
      nodeIntegration: false,  // ...and has no Node; it only needs DOM + the webview API
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The shell must never reload or close on Ctrl+R / Ctrl+W -- those act on the active
  // PANE (handled in the renderer). Neutralize the built-in accelerators for the host.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = (input.key || '').toLowerCase();
    if (k === 'r' || k === 'w') event.preventDefault();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
