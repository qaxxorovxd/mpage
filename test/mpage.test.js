'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { unzipSync, zipSync } = require('fflate');
const M = require('../lib/mpage');

function sampleDoc() {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  return {
    title: 'Test',
    sessions: [
      {
        name: 'Session A',
        sectors: [
          { name: 'Sector 1', level: 'secret', files: [{ name: 'a.png', bytes }, { name: 'a.png', bytes: new Uint8Array([9]) }] },
          { name: 'Sector/2', files: [{ name: 'note.txt', bytes: new TextEncoder().encode('hello') }] },
        ],
      },
      { name: 'Session A', sectors: [] },
    ],
  };
}

test('round-trip keeps the session / sector / file tree', async () => {
  const doc = await M.readMpage(await M.writeMpage(sampleDoc()));
  assert.strictEqual(doc.title, 'Test');
  assert.strictEqual(doc.sessions.length, 2);
  const [s] = doc.sessions;
  assert.strictEqual(s.sectors[0].level, 'secret');
  assert.strictEqual(s.sectors[0].color, M.LEVELS.secret.color);
  assert.deepStrictEqual([...s.sectors[0].files[0].bytes], [1, 2, 3, 4, 5]);
  assert.strictEqual(new TextDecoder().decode(s.sectors[1].files[0].bytes), 'hello');
  assert.deepStrictEqual(doc.warnings, []);
});

test('files are stored at ordered, safe and unique paths', async () => {
  const names = Object.keys(unzipSync(await M.writeMpage(sampleDoc())));
  assert.deepStrictEqual(names, [
    'mimetype',
    'manifest.json',
    'sessions/Session A/Sector 1/a.png',
    'sessions/Session A/Sector 1/a (2).png',
    'sessions/Session A/Sector_2/note.txt',
  ]);
});

test('mimetype is the first entry, readable at offset 38', async () => {
  const file = await M.writeMpage(sampleDoc());
  assert.strictEqual(Buffer.from(file.subarray(30, 38 + M.MIME.length)).toString('latin1'), 'mimetype' + M.MIME);
  assert.ok(M.looksLikeMpage(file));
});

test('a corrupted file is detected by SHA-256', async () => {
  const entries = unzipSync(await M.writeMpage(sampleDoc()));
  entries['sessions/Session A/Sector 1/a.png'] = new Uint8Array([7, 7, 7]);
  const { mimetype, ...rest } = entries;
  const doc = await M.readMpage(zipSync({ mimetype: [mimetype, { level: 0 }], ...rest }));
  assert.strictEqual(doc.sessions[0].sectors[0].files.length, 1);
  assert.strictEqual(doc.warnings.length, 1);
});

test('a non-.mpage file is rejected', async () => {
  await assert.rejects(M.readMpage(new Uint8Array(100)), { code: 'notMpage' });
});

test('kindOf maps MIME types to viewers', () => {
  assert.strictEqual(M.kindOf(M.mimeFromName('x.PDF')), 'pdf');
  assert.strictEqual(M.kindOf(M.mimeFromName('x.json')), 'text');
  assert.strictEqual(M.kindOf(M.mimeFromName('x.mp4')), 'video');
  assert.strictEqual(M.kindOf(M.mimeFromName('x.bin')), 'other');
});
