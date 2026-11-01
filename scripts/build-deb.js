'use strict';
/**
 * Builds the Linux .deb package (works on Windows too; no dpkg/fpm needed).
 *  1. packages the linux-x64 app with @electron/packager (scripts/lib/linux.js)
 *  2. writes data.tar.gz / control.tar.gz with Unix permissions (0755, setuid chrome-sandbox)
 *  3. combines them into an ar archive → dist/mpage-viewer_<version>_amd64.deb
 *
 * The package registers the application/x-mpage MIME type, so double-clicking an .mpage
 * file in a file manager opens MPage.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const tar = require('tar-stream');
const L = require('./lib/linux');

const { ROOT, NAME, VERSION } = L;
const INSTALL_DIR = `opt/${NAME}`;
const MTIME = new Date();

const CLI_WRAPPER = `#!/bin/sh
# mpage CLI: pack / unpack / info / verify / protect (runs on the Node.js bundled in Electron)
ELECTRON_RUN_AS_NODE=1 exec /opt/${NAME}/${NAME} /opt/${NAME}/resources/app.asar/cli/mpage.js "$@"
`;

// Ubuntu 24.04+ restricts unprivileged user namespaces; this profile lets the Electron sandbox work.
const APPARMOR = `abi <abi/4.0>,
include <tunables/global>

profile ${NAME} /opt/${NAME}/${NAME} flags=(unconfined) {
  userns,
  include if exists <local/${NAME}>
}
`;

const POSTINST = `#!/bin/sh
set -e
if [ -f /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cp /opt/${NAME}/resources/apparmor-profile /etc/apparmor.d/${NAME}
  apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/${NAME} || true
fi
chmod 4755 /opt/${NAME}/chrome-sandbox || true
command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
`;

const POSTRM = `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/${NAME} ]; then
    command -v apparmor_parser >/dev/null 2>&1 && apparmor_parser -R /etc/apparmor.d/${NAME} || true
    rm -f /etc/apparmor.d/${NAME}
  fi
fi
command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
`;

const COPYRIGHT = `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: MPage
Source: ${L.HOMEPAGE}

Files: *
Copyright: ${new Date().getFullYear()} Axmadjon Qaxxorov (https://qaxxorov.uz)
License: MIT
`;

/** Package contents: { path, mode, data?, link?, dir? } */
function collect(appDir) {
  const entries = [];
  const dirs = new Set();
  const addDir = (p) => {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!dirs.has(d)) {
        dirs.add(d);
        entries.push({ path: d, dir: true, mode: 0o755 });
      }
    }
  };
  const addFile = (p, data, mode = 0o644) => {
    addDir(path.posix.dirname(p));
    entries.push({ path: p, data, mode });
  };
  const addLink = (p, target) => {
    addDir(path.posix.dirname(p));
    entries.push({ path: p, link: target, mode: 0o777 });
  };

  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = `${rel}/${name}`;
      if (fs.statSync(a).isDirectory()) {
        addDir(r);
        walk(a, r);
      } else {
        addFile(r, fs.readFileSync(a), L.appFileMode(name, { setuidSandbox: true }));
      }
    }
  };
  addDir(INSTALL_DIR);
  walk(appDir, INSTALL_DIR);

  addFile(`${INSTALL_DIR}/resources/apparmor-profile`, Buffer.from(APPARMOR));
  addLink(`usr/bin/${NAME}`, `/opt/${NAME}/${NAME}`);
  addFile('usr/bin/mpage', Buffer.from(CLI_WRAPPER), 0o755);
  addFile(`usr/share/applications/${NAME}.desktop`, Buffer.from(L.desktopEntry(`/opt/${NAME}/${NAME}`)));
  addFile(`usr/share/mime/packages/${NAME}.xml`, Buffer.from(L.MIME_XML));
  for (const [p, data] of L.themeIcons()) addFile(p, data);
  addFile(`usr/share/doc/${NAME}/copyright`, Buffer.from(COPYRIGHT));
  return entries;
}

async function tarGz(entries) {
  const pack = tar.pack();
  const gz = zlib.createGzip({ level: 9 });
  const chunks = [];
  const done = new Promise((res, rej) => {
    gz.on('data', (c) => chunks.push(c));
    gz.on('end', res);
    gz.on('error', rej);
  });
  pack.pipe(gz);
  const base = { uid: 0, gid: 0, uname: 'root', gname: 'root', mtime: MTIME };
  for (const e of entries) {
    const name = e.path === '.' ? './' : `./${e.path}${e.dir ? '/' : ''}`;
    await new Promise((res, rej) => {
      const cb = (err) => (err ? rej(err) : res());
      if (e.dir) pack.entry({ ...base, name, type: 'directory', mode: e.mode }, cb);
      else if (e.link) pack.entry({ ...base, name, type: 'symlink', linkname: e.link, mode: e.mode }, cb);
      else pack.entry({ ...base, name, mode: e.mode, size: e.data.length }, e.data, cb);
    });
  }
  pack.finalize();
  await done;
  return Buffer.concat(chunks);
}

function ar(members) {
  const parts = [Buffer.from('!<arch>\n')];
  for (const { name, data } of members) {
    const h = Buffer.alloc(60, 0x20);
    h.write(name, 0);
    h.write(String(Math.floor(MTIME / 1000)), 16);
    h.write('0', 28);
    h.write('0', 34);
    h.write('100644', 40);
    h.write(String(data.length), 48);
    h.write('`\n', 58);
    parts.push(h, data);
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

async function buildDeb(appDir) {
  console.log('- writing data.tar.gz…');
  const entries = collect(appDir);
  const data = await tarGz(entries);
  const files = entries.filter((e) => e.data);
  const installedKb = Math.ceil(files.reduce((s, e) => s + e.data.length, 0) / 1024);

  const control = `Package: ${NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: ${L.MAINTAINER}
Installed-Size: ${installedKb}
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, libnotify4, libatspi2.0-0 | libatspi2.0-0t64, libgbm1, libdrm2, libasound2 | libasound2t64, libsecret-1-0, xdg-utils, shared-mime-info, desktop-file-utils
Homepage: ${L.HOMEPAGE}
Description: MPage - file manager for .mpage archives
 .mpage stores any files as Session / Sector / File in a single archive, with
 per-session and per-sector password encryption (Argon2id + AES-256-GCM).
 MPage shows sectors as a 3D card stack and can be controlled with hand
 gestures via webcam (MediaPipe). Interface: Uzbek, Russian, English.
`;
  const md5sums = files.map((e) => `${crypto.createHash('md5').update(e.data).digest('hex')}  ${e.path}\n`).join('');
  const controlTar = await tarGz([
    { path: '.', dir: true, mode: 0o755 },
    { path: 'control', data: Buffer.from(control), mode: 0o644 },
    { path: 'md5sums', data: Buffer.from(md5sums), mode: 0o644 },
    { path: 'postinst', data: Buffer.from(POSTINST), mode: 0o755 },
    { path: 'postrm', data: Buffer.from(POSTRM), mode: 0o755 },
  ]);

  const deb = ar([
    { name: 'debian-binary', data: Buffer.from('2.0\n') },
    { name: 'control.tar.gz', data: controlTar },
    { name: 'data.tar.gz', data },
  ]);
  const out = path.join(ROOT, 'dist', `${NAME}_${VERSION}_amd64.deb`);
  fs.writeFileSync(out, deb);
  console.log(`[ok] ${path.relative(ROOT, out)} (${(deb.length / 1024 / 1024).toFixed(1)} MB, ${files.length} files)`);
  return out;
}

module.exports = { buildDeb };

if (require.main === module) {
  L.packageLinux().then(buildDeb).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
