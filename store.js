// Splitser data layer (main process). Plain JSON files in the app's userData dir -- zero
// native deps for now; history is capped and de-duped so the file stays small. If history
// ever outgrows this, swap the internals for better-sqlite3 behind the same functions.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DIR = app.getPath('userData');
const file = (name) => path.join(DIR, name);

function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function saveNow(name, data) {
  try { fs.writeFileSync(file(name), JSON.stringify(data)); } catch { /* best effort */ }
}
const timers = {};
function saveSoon(name, data) {                 // debounce noisy writers (history)
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => saveNow(name, data), 600);
}

// ---- history: [{u:url, t:title, v:visits, ts:lastVisit}], most-visited first-ish ----
let history = load('history.json', []);
const HISTORY_CAP = 3000;

export function addHistory(url, title) {
  if (!url || !/^https?:/.test(url)) return;
  const i = history.findIndex((e) => e.u === url);
  if (i >= 0) {
    const e = history[i];
    e.v += 1; e.ts = Date.now(); if (title) e.t = title;
    history.splice(i, 1); history.unshift(e);
  } else {
    history.unshift({ u: url, t: title || url, v: 1, ts: Date.now() });
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  }
  saveSoon('history.json', history);
}

export function queryHistory(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const hits = history.filter((e) => e.u.toLowerCase().includes(q) || (e.t || '').toLowerCase().includes(q));
  hits.sort((a, b) => (b.v - a.v) || (b.ts - a.ts));
  return hits.slice(0, 8).map((e) => ({ url: e.u, title: e.t }));
}

// ---- bookmarks: page bookmarks {url, title} OR workspace bookmarks {type:'workspace', id, name, layout, theme, panes} ----
let bookmarks = load('bookmarks.json', []);
export function getBookmarks() { return bookmarks; }
export function hasBookmark(url) { return bookmarks.some((b) => b.url === url); }
export function toggleBookmark(url, title) {
  const i = bookmarks.findIndex((b) => b.url === url);
  if (i >= 0) { bookmarks.splice(i, 1); saveNow('bookmarks.json', bookmarks); return false; }
  bookmarks.unshift({ url, title: title || url }); saveNow('bookmarks.json', bookmarks); return true;
}
export function addWorkspaceBookmark(ws) {
  const entry = { type: 'workspace', id: 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (ws && ws.name) || 'Workspace', layout: (ws && ws.layout) || 'cols', theme: (ws && ws.theme) || null,
    panes: (ws && Array.isArray(ws.panes)) ? ws.panes : [] };
  bookmarks.unshift(entry); saveNow('bookmarks.json', bookmarks); return entry;
}
export function removeBookmark(key) {   // by workspace id OR page url
  const i = bookmarks.findIndex((b) => b.id === key || b.url === key);
  if (i >= 0) { bookmarks.splice(i, 1); saveNow('bookmarks.json', bookmarks); return true; }
  return false;
}

// ---- bookmark folders: an ordered list of names; each bookmark carries an optional `folder`.
// Deleting a folder NEVER deletes its bookmarks -- they just fall back to ungrouped. ----
let bmFolders = load('bookmark-folders.json', []);
export function getBookmarkFolders() { return bmFolders; }
export function addBookmarkFolder(name) {
  name = String(name || '').trim().slice(0, 40);
  if (name && !bmFolders.includes(name)) { bmFolders.push(name); saveNow('bookmark-folders.json', bmFolders); }
  return bmFolders;
}
export function renameBookmarkFolder(oldName, name) {
  name = String(name || '').trim().slice(0, 40);
  const i = bmFolders.indexOf(oldName);
  if (i < 0 || !name || name === oldName) return bmFolders;
  if (bmFolders.includes(name)) bmFolders.splice(i, 1);   // target exists -> merge into it
  else bmFolders[i] = name;
  bookmarks.forEach((b) => { if (b.folder === oldName) b.folder = name; });
  saveNow('bookmark-folders.json', bmFolders); saveNow('bookmarks.json', bookmarks);
  return bmFolders;
}
export function removeBookmarkFolder(name) {
  const i = bmFolders.indexOf(name);
  if (i < 0) return bmFolders;
  bmFolders.splice(i, 1);
  bookmarks.forEach((b) => { if (b.folder === name) b.folder = null; });   // un-file, keep the bookmarks
  saveNow('bookmark-folders.json', bmFolders); saveNow('bookmarks.json', bookmarks);
  return bmFolders;
}
export function setBookmarkFolder(key, folder) {   // key = workspace id OR page url; folder = name or null
  folder = folder ? String(folder).trim().slice(0, 40) : null;
  if (folder && !bmFolders.includes(folder)) { bmFolders.push(folder); saveNow('bookmark-folders.json', bmFolders); }
  const b = bookmarks.find((x) => x.id === key || x.url === key);
  if (b) { b.folder = folder; saveNow('bookmarks.json', bookmarks); }
  return b || null;
}

// ---- session: the open sets/panes/tabs, restored on relaunch (array = legacy; object = v2 sets) ----
let session = load('session.json', []);
export function getSession() { return session; }
export function setSession(data) { session = (data && typeof data === 'object') ? data : []; saveSoon('session.json', session); }

// ---- settings ----
let settings = load('settings.json', { home: 'https://duckduckgo.com', search: 'https://duckduckgo.com/?q=%s', downloadMode: 'auto' });
export function getSettings() { return settings; }
export function setSettings(patch) { settings = { ...settings, ...patch }; saveNow('settings.json', settings); return settings; }

// window bounds + which monitor, so the window reopens where it was closed
let winState = load('window.json', null);
export function getWindowState() { return winState; }
export function setWindowState(s) { winState = s; saveNow('window.json', s); }

// ---- per-site download folders: in "remember" mode, a site's downloads reuse the folder you last
// chose for that site (ask once, then auto-save there). { host: '/abs/dir' } ----
let downloadDirs = load('download-dirs.json', {});
export function getDownloadDir(host) { return host ? (downloadDirs[host] || '') : ''; }
export function setDownloadDir(host, dir) { if (host && dir) { downloadDirs[host] = dir; saveNow('download-dirs.json', downloadDirs); } }

// ---- vault: ciphertext blob only. Main NEVER sees the key, master password, or
// plaintext -- all crypto happens in the isolated renderer. ----
export function getVault() { return load('vault.enc', null); }
export function setVault(blob) { saveNow('vault.enc', blob); }

// ---- shields (ad/tracker blocking): { on: global default, allow: [hosts with shields down] } ----
let shields = load('shields.json', { on: true, allow: [] });
export function getShields() { return shields; }
export function setShields(s) { shields = { on: s.on !== false, allow: Array.isArray(s.allow) ? s.allow : [] }; saveNow('shields.json', shields); }

export function clearData(kind) {
  if (kind === 'history' || kind === 'all') { history = []; saveNow('history.json', history); }
  if (kind === 'bookmarks' || kind === 'all') { bookmarks = []; saveNow('bookmarks.json', bookmarks); bmFolders = []; saveNow('bookmark-folders.json', bmFolders); }
  if (kind === 'session' || kind === 'all') { session = []; saveNow('session.json', session); }
}
