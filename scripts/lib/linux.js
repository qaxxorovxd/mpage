'use strict';
// Shared pieces of the Linux packages (.deb and .AppImage).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = require(path.join(ROOT, 'package.json'));

const NAME = 'mpage-viewer';
const VERSION = pkg.version;
const MAINTAINER = 'Axmadjon Qaxxorov <184016299+qaxxorovxd@users.noreply.github.com>';
const HOMEPAGE = 'https://github.com/qaxxorovxd/mpage';
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

/** .desktop entry; `exec` differs between the .deb (absolute path) and the AppImage (binary name). */
function desktopEntry(exec) {
  return `[Desktop Entry]
Name=MPage
GenericName=Archive File Manager
GenericName[uz]=Arxiv fayl menejeri
GenericName[ru]=Файловый менеджер архивов
Comment=.mpage archives: Session / Sector / File — a file manager you can control with hand gestures
Comment[uz]=.mpage arxivlari: Session / Sektor / Fayl — qo'l harakati bilan boshqariladigan fayl menejeri
Comment[ru]=Архивы .mpage: Сессия / Сектор / Файл — файловый менеджер с управлением жестами
Keywords=archive;encrypted;files;
Keywords[uz]=arxiv;shifrlangan;fayllar;
Keywords[ru]=архив;шифрование;файлы;
Exec=${exec} %F
Icon=${NAME}
Type=Application
Terminal=false
Categories=Utility;FileManager;Archiving;
MimeType=application/x-mpage;
`;
}

const MIME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-mpage">
    <comment>MPage archive</comment>
    <comment xml:lang="uz">MPage arxivi (Session / Sektor / Fayl)</comment>
    <comment xml:lang="ru">Архив MPage (Сессия / Сектор / Файл)</comment>
    <sub-class-of type="application/zip"/>
    <generic-icon name="application-x-mpage"/>
    <magic priority="80">
      <match type="string" offset="30" value="mimetypeapplication/x-mpage"/>
    </magic>
    <glob pattern="*.mpage"/>
  </mime-type>
</mime-info>
`;

/** Unix permission for a file inside the packaged Electron app. */
function appFileMode(name, { setuidSandbox }) {
  if (name === 'chrome-sandbox') return setuidSandbox ? 0o4755 : 0o755;
  if (name === NAME || name === 'chrome_crashpad_handler' || /\.so(\.\d+)*$/.test(name)) return 0o755;
  return 0o644;
}

/** hicolor theme icons: [relative path, bytes] for the app icon and the .mpage file-type icon. */
function themeIcons() {
  const out = [];
  for (const s of ICON_SIZES) {
    const png = fs.readFileSync(path.join(ROOT, 'build', 'icons', `${s}x${s}.png`));
    out.push([`usr/share/icons/hicolor/${s}x${s}/apps/${NAME}.png`, png]);
    out.push([`usr/share/icons/hicolor/${s}x${s}/mimetypes/application-x-mpage.png`, png]);
  }
  const svg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'));
  out.push([`usr/share/icons/hicolor/scalable/apps/${NAME}.svg`, svg]);
  out.push(['usr/share/icons/hicolor/scalable/mimetypes/application-x-mpage.svg', svg]);
  return out;
}

/** Packages the linux-x64 app once with @electron/packager and returns its folder. */
async function packageLinux() {
  const { packager } = await import('@electron/packager');
  console.log('- packaging linux-x64 app (@electron/packager)…');
  const [appDir] = await packager({
    dir: ROOT,
    out: path.join(ROOT, 'dist', 'packager'),
    platform: 'linux',
    arch: 'x64',
    name: NAME,
    executableName: NAME,
    appVersion: VERSION,
    overwrite: true,
    asar: true,
    prune: true,
    quiet: true,
    ignore: [/^\/(dist|build|assets|docs|examples|scripts|test|\.claude|\.git|\.github)(\/|$)/, /^\/app\/renderer\/src(\/|$)/, /\.map$/],
  });
  // Sample archives (resources/examples/*.mpage)
  const exDst = path.join(appDir, 'resources', 'examples');
  fs.rmSync(exDst, { recursive: true, force: true });
  fs.mkdirSync(exDst, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'examples')).filter((n) => n.endsWith('.mpage'))) {
    fs.copyFileSync(path.join(ROOT, 'examples', f), path.join(exDst, f));
  }
  return appDir;
}

module.exports = { ROOT, NAME, VERSION, MAINTAINER, HOMEPAGE, desktopEntry, MIME_XML, appFileMode, themeIcons, packageLinux };
