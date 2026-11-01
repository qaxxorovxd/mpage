'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { unzipSync, zipSync, strFromU8 } = require('fflate');
const M = require('../lib/mpage');

const PW_A = 'K7QF-M2XP-9WBT-R4HZ-QQ3N';
const PW_B = 'correct horse battery staple 1997!';
const enc = (s) => new TextEncoder().encode(s);

function sampleDoc() {
  const mk = (name, sec, file, text) => ({ ...M.newSession(name), sectors: [{ ...M.newSector(sec, 'secret'), files: [M.newFile(file, enc(text))] }] });
  // Names are long enough that they cannot show up by chance inside random ciphertext.
  return { title: 'Secrets', sessions: [
    mk('Public', 'SECTOR-PUBLIC', 'everyone.txt', 'public'),
    mk('Alpha', 'SECTOR-ALPHA', 'alpha.txt', 'ALPHA-SECRET'),
    mk('Bravo', 'SECTOR-BRAVO', 'bravo.txt', 'BRAVO-SECRET'),
  ] };
}

/** Password A → Alpha + Bravo, password B → Bravo only. */
async function protectedFile() {
  const doc = sampleDoc();
  const [, alpha, bravo] = doc.sessions;
  await M.addPassword(doc, PW_A, [alpha.id, bravo.id]);
  await M.addPassword(doc, PW_B, [bravo.id]);
  return { bytes: await M.writeMpage(doc), alpha, bravo };
}

const allText = (bytes) => Object.entries(unzipSync(bytes)).map(([k, v]) => k + strFromU8(v, true)).join('\n');

test('no secret names or contents appear in plain text inside the file', async () => {
  const { bytes } = await protectedFile();
  const all = allText(bytes);
  for (const secret of ['Alpha', 'Bravo', 'ALPHA-SECRET', 'BRAVO-SECRET', 'alpha.txt', 'SECTOR-ALPHA']) {
    assert.ok(!all.includes(secret), `leaked: ${secret}`);
  }
  assert.ok(all.includes('everyone.txt')); // the unprotected session stays readable
});

test('different passwords unlock different sessions', async () => {
  const { bytes } = await protectedFile();
  const a = await M.readMpage(bytes);
  assert.strictEqual(a.sessions.filter((s) => s.locked).length, 2);
  assert.deepStrictEqual((await M.unlock(a, PW_A)).sessions.sort(), ['Alpha', 'Bravo']);

  const b = await M.readMpage(bytes);
  assert.deepStrictEqual((await M.unlock(b, PW_B)).sessions, ['Bravo']);
  assert.ok(b.sessions[1].locked, 'password B must not unlock Alpha');
  assert.strictEqual(new TextDecoder().decode(b.sessions[2].sectors[0].files[0].bytes), 'BRAVO-SECRET');
});

test('a wrong password is rejected', async () => {
  const { bytes } = await protectedFile();
  const d = await M.readMpage(bytes);
  await assert.rejects(M.unlock(d, 'K7QF-M2XP-9WBT-R4HZ-QQ3M'), { code: 'wrongPassword' });
});

test('tampered ciphertext is detected', async () => {
  const { bytes } = await protectedFile();
  const entries = unzipSync(bytes);
  const path = Object.keys(entries).find((p) => p.startsWith('locked/') && !p.endsWith('meta.bin'));
  entries[path][20] ^= 1;
  const { mimetype, ...rest } = entries;
  const d = await M.readMpage(zipSync({ mimetype: [mimetype, { level: 0 }], ...rest }), { verify: false });
  const r = await M.unlock(d, PW_A);
  assert.strictEqual(r.warnings.length, 1);
});

test('edit and save keeps slots that were not unlocked', async () => {
  const { bytes } = await protectedFile();
  const d = await M.readMpage(bytes);
  await M.unlock(d, PW_B);
  d.sessions[2].sectors[0].files.push(M.newFile('new.txt', enc('NEW')));
  const d2 = await M.readMpage(await M.writeMpage(d));
  const r = await M.unlock(d2, PW_A); // slot A was never opened, it must still work
  assert.deepStrictEqual(r.sessions.sort(), ['Alpha', 'Bravo']);
  assert.strictEqual(d2.sessions[2].sectors[0].files.length, 2);
});

test('lockAll, then removing protection', async () => {
  const doc = sampleDoc();
  await M.addPassword(doc, PW_A, [doc.sessions[1].id]);
  await M.lockAll(doc);
  assert.ok(doc.sessions[1].locked);
  await M.unlock(doc, PW_A);
  M.unprotect(doc, doc.sessions[1].id);
  const d = await M.readMpage(await M.writeMpage(doc));
  assert.ok(!d.sessions[1].locked);
  assert.strictEqual(d.sessions[1].name, 'Alpha');
});

test('sector password: opening the session does not reveal the locked sector', async () => {
  const doc = sampleDoc();
  const [open] = doc.sessions;
  const secret = { ...M.newSector('CLASSIFIED', 'top-secret'), files: [M.newFile('plan.txt', enc('SECTOR-SECRET'))] };
  open.sectors.push(secret);
  await M.addPassword(doc, PW_A, [secret.id]);
  const bytes = await M.writeMpage(doc);
  const all = allText(bytes);
  for (const s of ['CLASSIFIED', 'plan.txt', 'SECTOR-SECRET']) assert.ok(!all.includes(s), `leaked: ${s}`);

  const d = await M.readMpage(bytes);
  const stub = d.sessions[0].sectors[1];
  assert.ok(stub.locked);
  assert.strictEqual(stub.level, 'top-secret'); // the level stays public
  assert.strictEqual(stub.name, undefined);
  const r = await M.unlock(d, PW_A);
  assert.deepStrictEqual(r.units, ['Public / CLASSIFIED']);
  assert.strictEqual(new TextDecoder().decode(d.sessions[0].sectors[1].files[0].bytes), 'SECTOR-SECRET');
});

test('a separately protected sector inside a protected session', async () => {
  const doc = sampleDoc();
  const alpha = doc.sessions[1];
  const inner = { ...M.newSector('INNER', 'cosmic'), files: [M.newFile('x.txt', enc('INNER-SECRET'))] };
  alpha.sectors.push(inner);
  await M.addPassword(doc, PW_A, [alpha.id]);
  await M.addPassword(doc, PW_B, [inner.id]);

  const d = await M.readMpage(await M.writeMpage(doc));
  await M.unlock(d, PW_A);
  assert.strictEqual(d.sessions[1].name, 'Alpha');
  assert.ok(d.sessions[1].sectors[1].locked, 'password A must not unlock the inner sector');
  await M.unlock(d, PW_B);
  assert.strictEqual(d.sessions[1].sectors[1].name, 'INNER');

  // With B only the session is still locked, so the sector stays hidden; entering A then opens both.
  const e = await M.readMpage(await M.writeMpage(d));
  await M.unlock(e, PW_B);
  assert.ok(e.sessions[1].locked);
  await M.unlock(e, PW_A);
  assert.strictEqual(e.sessions[1].sectors[1].name, 'INNER');
});

test('changing a password: the old one stops working, the new one works', async () => {
  const doc = sampleDoc();
  await M.addPassword(doc, PW_A, [doc.sessions[1].id]);
  const d = await M.readMpage(await M.writeMpage(doc));
  await M.unlock(d, PW_A);
  await M.changePassword(d, M.accessSummary(d).known[0].slot, PW_B);
  const e = await M.readMpage(await M.writeMpage(d));
  await assert.rejects(M.unlock(e, PW_A), { code: 'wrongPassword' });
  assert.deepStrictEqual((await M.unlock(e, PW_B)).sessions, ['Alpha']);
});

test('a recovery key unlocks every protected part', async () => {
  const doc = sampleDoc();
  const sec = doc.sessions[0].sectors[0];
  await M.addPassword(doc, PW_A, [doc.sessions[1].id]);
  await M.addPassword(doc, PW_B, [doc.sessions[2].id, sec.id]);
  const { code } = await M.addRecoveryKey(doc);
  assert.match(code, /^([A-Z2-9]{5}-){7}[A-Z2-9]{5}$/);
  const d = await M.readMpage(await M.writeMpage(doc));
  const r = await M.unlock(d, code);
  assert.ok(r.recovery);
  assert.deepStrictEqual(r.sessions.sort(), ['Alpha', 'Bravo']);
  assert.ok(!d.sessions[0].sectors[0].locked);
});

test('weak passwords are rejected', async () => {
  const doc = sampleDoc();
  for (const weak of ['123456', 'password', 'aaaaaaaaaaaaaaaa', 'qwerty123', 'abcdefghijkl', 'Tashkent2024!', 'Parol_Mening_2024', 'Xy9#kL2!']) {
    await assert.rejects(M.addPassword(doc, weak, [doc.sessions[1].id]), { code: 'weak' }, weak);
  }
  assert.ok(M.passwordBits(M.generatePassword()) >= 90);
});
