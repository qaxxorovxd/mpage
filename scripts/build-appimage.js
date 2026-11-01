'use strict';
/**
 * Builds dist/MPage-<version>-x86_64.AppImage on any host (Windows included):
 *  1. lays out an AppDir from the packaged linux-x64 app (AppRun, .desktop, icons, MIME type)
 *  2. writes an xz-compressed SquashFS image with scripts/mksquashfs.py (Python standard library)
 *  3. prepends the official AppImage type 2 runtime
 *
 * Runtime lookup: $APPIMAGE_RUNTIME, otherwise the electron-builder cache (it ships runtime-x64;
 * running `npx electron-builder --linux AppImage` once on any machine populates it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib/linux');

const { ROOT, NAME, VERSION } = L;

// Electron needs either unprivileged user namespaces or a setuid chrome-sandbox. Inside an AppImage
// (mounted nosuid) only the first can work, so fall back to --no-sandbox where namespaces are blocked.
const APPRUN = `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export PATH="$HERE:$PATH"
NO_SANDBOX=""
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] || \\
   [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then
  NO_SANDBOX="--no-sandbox"
fi
exec "$HERE/${NAME}" $NO_SANDBOX "$@"
`;

function findRuntime() {
  if (process.env.APPIMAGE_RUNTIME) return process.env.APPIMAGE_RUNTIME;
  const caches = [
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron-builder'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron-builder'),
  ];
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const tool of fs.readdirSync(cache).filter((d) => d.startsWith('appimage-'))) {
      const dir = path.join(cache, tool);
      for (const sub of fs.readdirSync(dir)) {
        const p = path.join(dir, sub, 'runtime-x64');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('AppImage runtime not found. Set APPIMAGE_RUNTIME, or run `npx electron-builder --linux AppImage` once to populate the cache.');
}

function python() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  throw new Error('Python 3 is required to build the AppImage (standard library only).');
}

async function buildAppImage(appDir) {
  const work = path.join(ROOT, 'dist', 'appimage');
  const appRoot = path.join(work, 'MPage.AppDir');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(appRoot, { recursive: true });

  console.log('- laying out AppDir…');
  fs.cpSync(appDir, appRoot, { recursive: true });
  const modes = {};
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(a).isDirectory()) walk(a, r);
      else modes[r] = L.appFileMode(name, { setuidSandbox: false }).toString(8);
    }
  };
  walk(appRoot, '');

  const put = (rel, data, mode = 0o644) => {
    const p = path.join(appRoot, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    modes[rel] = mode.toString(8);
  };
  put('AppRun', APPRUN, 0o755);
  put(`${NAME}.desktop`, L.desktopEntry(NAME));
  const icon256 = fs.readFileSync(path.join(ROOT, 'build', 'icons', '256x256.png'));
  put(`${NAME}.png`, icon256);
  put('.DirIcon', icon256);
  put(`usr/share/applications/${NAME}.desktop`, L.desktopEntry(NAME));
  put(`usr/share/mime/packages/${NAME}.xml`, L.MIME_XML);
  for (const [p, data] of L.themeIcons()) put(p, data);

  const modesFile = path.join(work, 'modes.json');
  fs.writeFileSync(modesFile, JSON.stringify(modes));
  const squashfs = path.join(work, 'app.squashfs');
  console.log('- writing SquashFS (xz)…');
  const r = spawnSync(python(), [path.join(__dirname, 'mksquashfs.py'), appRoot, squashfs, modesFile], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('mksquashfs.py failed');

  const out = path.join(ROOT, 'dist', `MPage-${VERSION}-x86_64.AppImage`);
  fs.writeFileSync(out, Buffer.concat([fs.readFileSync(findRuntime()), fs.readFileSync(squashfs)]));
  try {
    fs.chmodSync(out, 0o755);
  } catch { /* not meaningful on Windows */ }
  console.log(`[ok] ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  return out;
}

module.exports = { buildAppImage };

if (require.main === module) {
  L.packageLinux().then(buildAppImage).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
