'use strict';
// Packages the Linux app once and builds both the .deb and the .AppImage from it.
const { packageLinux } = require('./lib/linux');
const { buildDeb } = require('./build-deb');
const { buildAppImage } = require('./build-appimage');

(async () => {
  const appDir = await packageLinux();
  await buildDeb(appDir);
  await buildAppImage(appDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
