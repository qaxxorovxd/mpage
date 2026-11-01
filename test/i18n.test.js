'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I = require('../lib/i18n');

const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every key has all three languages with the same parameters', () => {
  for (const [key, row] of Object.entries(I.DICTIONARY)) {
    assert.strictEqual(row.length, 3, key);
    row.forEach((s, i) => assert.ok(typeof s === 'string' && s.length > 0, `${key} [${I.LANGS[i]}] is empty`));
    assert.strictEqual(params(row[1]), params(row[0]), `${key}: ru parameters differ`);
    assert.strictEqual(params(row[2]), params(row[0]), `${key}: en parameters differ`);
  }
});

test('the dictionary contains no emoji', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const [key, row] of Object.entries(I.DICTIONARY)) row.forEach((s) => assert.ok(!emoji.test(s), key));
});

test('every t(\'…\') key used in the code exists', () => {
  const files = ['app/main.js', 'app/renderer/src/main.js', 'app/renderer/src/stack.js', 'app/renderer/src/viewers.js', 'app/renderer/index.html', 'lib/mpage.js', 'lib/secure.js', 'cli/mpage.js'];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const keys = [
      ...[...src.matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/data-i18n(?:-html|-title|-ph)?="([\w.-]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/new (?:Mpage|Secure)Error\('(\w+)'/g)].map((m) => `err.${m[1]}`),
    ];
    for (const k of keys) if (!I.DICTIONARY[k]) missing.push(`${f}: ${k}`);
  }
  assert.deepStrictEqual(missing, []);
});

test('t(): parameters, switching language, singular forms', () => {
  I.setLang('en');
  assert.strictEqual(I.t('count.files', { n: 1 }), '1 file');
  assert.strictEqual(I.t('count.files', { n: 3 }), '3 files');
  I.setLang('ru');
  assert.strictEqual(I.t('err.wrongPassword'), 'Неверный пароль');
  I.setLang('uz');
  assert.strictEqual(I.t('err.wrongPassword'), "Parol noto'g'ri");
  assert.strictEqual(I.detect(null, 'ru-RU'), 'ru');
  assert.strictEqual(I.detect('xx', 'de-DE'), 'uz');
});
