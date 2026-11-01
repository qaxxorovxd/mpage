'use strict';
// Inspects a .deb without dpkg: ar members, control file and file permissions.
const fs = require('fs');
const zlib = require('zlib');
const tar = require('tar-stream');

const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('not an ar archive');

const members = [];
for (let off = 8; off < buf.length;) {
  const h = buf.subarray(off, off + 60).toString('latin1');
  const name = h.slice(0, 16).trim();
  const size = parseInt(h.slice(48, 58), 10);
  if (h.slice(58, 60) !== '`\n') throw new Error(`corrupt ar header: ${name}`);
  members.push({ name, data: buf.subarray(off + 60, off + 60 + size) });
  off += 60 + size + (size % 2);
}
console.log('ar:', members.map((m) => `${m.name} (${m.data.length})`).join(', '));

function list(gz) {
  return new Promise((resolve, reject) => {
    const out = [];
    const ex = tar.extract();
    ex.on('entry', (h, stream, next) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        out.push({ ...h, body: Buffer.concat(chunks) });
        next();
      });
    });
    ex.on('finish', () => resolve(out));
    ex.on('error', reject);
    ex.end(zlib.gunzipSync(gz));
  });
}

(async () => {
  const control = await list(members.find((m) => m.name === 'control.tar.gz').data);
  for (const e of control) if (e.name.endsWith('control')) console.log(`\n${e.body.toString()}`);
  console.log('control.tar:', control.map((e) => `${e.name} ${e.mode.toString(8)}`).join(', '));

  const data = await list(members.find((m) => m.name === 'data.tar.gz').data);
  const show = (re) => data.filter((e) => re.test(e.name)).forEach((e) =>
    console.log(`  ${e.mode.toString(8).padStart(5)} ${e.uid}:${e.gid} ${e.type.padEnd(9)} ${e.name}${e.linkname ? ` -> ${e.linkname}` : ''}`));
  console.log('\nkey files:');
  show(/(mpage-viewer|chrome-sandbox|chrome_crashpad_handler|app\.asar|\.desktop|\.xml|usr\/bin\/|\.png|\.mpage|apparmor)$/);
  console.log(`\n${data.length} entries total`);
})();
