'use strict';
/**
 * Renders every icon from the single vector source assets/logo.svg (transparent background):
 *   build/icon.png              1024 px (electron-builder, AppImage)
 *   build/icons/NxN.png         16 … 1024 px (Linux hicolor theme, README, renderer)
 *   build/icon.ico              16 … 256 px (Windows app icon)
 *   build/mpage-file.{png,ico}  .mpage file-type icon (same artwork)
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { toICO } = require('./lib/raster');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build');
const svg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'));

const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();

fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngs = Object.fromEntries(sizes.map((s) => [s, render(s)]));
for (const s of sizes) fs.writeFileSync(path.join(OUT, 'icons', `${s}x${s}.png`), pngs[s]);

const ico = toICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs[size] })));
fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[1024]);
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
fs.writeFileSync(path.join(OUT, 'mpage-file.png'), pngs[512]);
fs.writeFileSync(path.join(OUT, 'mpage-file.ico'), ico);
console.log(`[ok] icons rendered from assets/logo.svg (${sizes.join(', ')} px)`);
