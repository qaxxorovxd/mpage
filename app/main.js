'use strict';
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const I = require('../lib/i18n');

const { t } = I;

const RENDERER_DIR = path.join(__dirname, 'renderer');
const EXAMPLES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'examples')
  : path.join(__dirname, '..', 'examples');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// App files are served from app://local/ because fetch/WASM do not work over file://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let pendingFile = null;

function mpageFromArgv(argv) {
  return argv.slice(1).find((a) => /\.mpage$/i.test(a) && fs.existsSync(a)) || null;
}

function sendOpen(file) {
  if (!file) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('open-file', file);
  else pendingFile = file;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    sendOpen(mpageFromArgv(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // macOS: opening from Finder
  app.on('open-file', (e, file) => {
    e.preventDefault();
    sendOpen(file);
  });
  pendingFile = mpageFromArgv(process.argv);
  app.whenReady().then(start);
}

function start() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Only the camera (for hand tracking) is allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(permission === 'media' && !(details.mediaTypes || []).includes('audio'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#dfe4e7',
    title: 'MPage',
    icon: path.join(RENDERER_DIR, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true, // built-in PDF viewer
    },
  });
  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    if (pendingFile) {
      win.webContents.send('open-file', pendingFile);
      pendingFile = null;
    }
  });
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [t('main.quitNoSave'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      title: t('main.unsavedTitle'),
      message: t('main.unsavedMsg'),
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // Automated smoke test: prints renderer logs and a status line, then quits.
  if (process.env.MPAGE_SMOKE) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
    setTimeout(async () => {
      const report = await win.webContents.executeJavaScript(`(async () => {
        const wasm = await fetch('vendor/mediapipe/wasm/vision_wasm_internal.wasm').then((r) => r.arrayBuffer());
        await WebAssembly.compile(wasm);
        const model = await fetch('vendor/models/hand_landmarker.task').then((r) => r.status);
        const cards = [...document.querySelectorAll('#labels .chip')].map((c) => c.textContent).join(',');
        return document.querySelector('#toast').textContent + ' | ' + cards + ' sector cards | wasm ok | model ' + model;
      })()`);
      console.log(`[smoke] ${report}`);
      // Optional screenshot for docs: MPAGE_SCREENSHOT=<png path>, MPAGE_SCREENSHOT_JS=<code run first>.
      if (process.env.MPAGE_SCREENSHOT) {
        if (process.env.MPAGE_SCREENSHOT_JS) await win.webContents.executeJavaScript(process.env.MPAGE_SCREENSHOT_JS);
        await new Promise((r) => setTimeout(r, 1500));
        fs.writeFileSync(process.env.MPAGE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      app.exit(0);
    }, Number(process.env.MPAGE_SMOKE) || 6000);
  }

  win.loadURL('app://local/index.html');
}

// Native dialogs follow the UI language (the renderer reports it); before that, the OS locale.
app.whenReady().then(() => I.setLang(I.detect(app.getLocale())));
ipcMain.on('lang', (_e, lang) => I.setLang(lang));

const mpageFilter = () => [{ name: t('main.filter'), extensions: ['mpage'] }];

ipcMain.handle('file:read', async (_e, file) => {
  const data = await fs.promises.readFile(file);
  return { path: file, name: path.basename(file), data: new Uint8Array(data) };
});

ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: t('main.openTitle'),
    defaultPath: fs.existsSync(EXAMPLES_DIR) ? EXAMPLES_DIR : undefined,
    filters: mpageFilter(),
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('dialog:files', async () => {
  const r = await dialog.showOpenDialog(win, { title: t('main.addTitle'), properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(async (f) => ({ name: path.basename(f), data: new Uint8Array(await fs.promises.readFile(f)) })));
});

ipcMain.handle('file:export', async (_e, { name, data }) => {
  const r = await dialog.showSaveDialog(win, { title: t('main.exportTitle'), defaultPath: name });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

// Reads a dropped folder as a tree (null if the path is not a folder).
ipcMain.handle('folder:read', async (_e, dir) => {
  const st = await fs.promises.stat(dir).catch(() => null);
  if (!st || !st.isDirectory()) return null;
  const MAX_BYTES = 2 * 1024 ** 3;
  let total = 0;
  const walk = async (p, depth) => {
    const children = [];
    for (const ent of (await fs.promises.readdir(p, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        if (depth < 8) children.push({ name: ent.name, children: await walk(full, depth + 1) });
      } else if (ent.isFile()) {
        const data = await fs.promises.readFile(full);
        total += data.length;
        if (total > MAX_BYTES) throw new Error(t('main.folderTooBig'));
        children.push({ name: ent.name, data: new Uint8Array(data) });
      }
    }
    return children;
  };
  return { name: path.basename(dir), children: await walk(dir, 0) };
});

ipcMain.handle('file:save', async (_e, { path: target, data, title }) => {
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: t('main.saveTitle'),
      defaultPath: `${(title || 'archive').replace(/[\\/:*?"<>|]/g, '_')}.mpage`,
      filters: mpageFilter(),
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  // Atomic write: write a temp file, then rename over the target.
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, Buffer.from(data));
  await fs.promises.rename(tmp, target);
  return target;
});

ipcMain.handle('example:path', () => {
  const p = path.join(EXAMPLES_DIR, 'demo.mpage');
  return fs.existsSync(p) ? p : null;
});

ipcMain.on('title', (_e, title) => win && win.setTitle(title));

app.on('window-all-closed', () => app.quit());
