'use strict';
// Bundles the renderer (app/renderer/src -> app/renderer/dist/bundle.js) and copies the app icon.
// Pass --minify for release builds (no source map).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'app', 'renderer');

fs.copyFileSync(path.join(ROOT, 'build', 'icons', '256x256.png'), path.join(R, 'icon.png'));

esbuild.buildSync({
  entryPoints: [path.join(R, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: path.join(R, 'dist', 'bundle.js'),
  minify: process.argv.includes('--minify') || process.env.NODE_ENV === 'production',
  sourcemap: !process.argv.includes('--minify'),
  logLevel: 'info',
});
