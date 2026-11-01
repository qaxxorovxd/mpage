#!/usr/bin/env node
'use strict';
/**
 * mpage CLI
 *   mpage pack <folder> [-o archive.mpage]   folder tree → .mpage
 *   mpage unpack <archive.mpage> [folder]    .mpage → folder tree
 *   mpage info <archive.mpage>               sessions / sectors / files tree
 *   mpage verify <archive.mpage>             SHA-256 check of every file
 *   mpage protect <archive.mpage> …          add a password (session or sector)
 *
 * Language: --lang uz|ru|en, MPAGE_LANG, or the system locale (LANG / LC_ALL).
 *
 * Folder layout:
 *   <folder>/<Session>/<Sector>/<files…>
 *   <Session>/_session.json  — optional: { "code": "456_SPG_425XVC" }
 *   <Sector>/_sector.json    — optional: { "level": "secret", "color": "#b91c1c" }
 */
const fs = require('fs');
const path = require('path');
const M = require('../lib/mpage');
const I = require('../lib/i18n');

const { t } = I;

function die(msg) {
  console.error(t('cli.error', { msg }));
  process.exit(1);
}

const isDir = (p) => fs.statSync(p).isDirectory();
const readMeta = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});
const META = new Set(['_session.json', '_sector.json']);

/** All files inside a sector folder (nested folder names are prefixed to the file name). */
function sectorFiles(dir, prefix = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (META.has(name)) continue;
    const p = path.join(dir, name);
    if (isDir(p)) out.push(...sectorFiles(p, `${prefix}${name}_`));
    else out.push(M.newFile(prefix + name, fs.readFileSync(p)));
  }
  return out;
}

async function pack(dir, out) {
  if (!fs.existsSync(dir) || !isDir(dir)) die(t('cli.noFolder', { p: dir }));
  const sessions = [];
  for (const sName of fs.readdirSync(dir).sort()) {
    const sDir = path.join(dir, sName);
    if (!isDir(sDir)) continue;
    const session = { ...M.newSession(sName), ...readMeta(path.join(sDir, '_session.json')) };
    const loose = [];
    for (const secName of fs.readdirSync(sDir).sort()) {
      const p = path.join(sDir, secName);
      if (META.has(secName)) continue;
      if (!isDir(p)) {
        loose.push(M.newFile(secName, fs.readFileSync(p)));
        continue;
      }
      const meta = readMeta(path.join(p, '_sector.json'));
      session.sectors.push({ ...M.newSector(secName, meta.level), ...meta, files: sectorFiles(p) });
    }
    if (loose.length) session.sectors.push({ ...M.newSector('General', 'public'), files: loose });
    sessions.push(session);
  }
  if (!sessions.length) die(t('cli.noSessions'));
  const bytes = await M.writeMpage({ title: path.basename(path.resolve(dir)), sessions, generator: 'mpage-cli/2.0' });
  out = out || `${path.resolve(dir)}.mpage`;
  fs.writeFileSync(out, bytes);
  const nSec = sessions.reduce((n, s) => n + s.sectors.length, 0);
  const nFiles = sessions.reduce((n, s) => n + s.sectors.reduce((m, x) => m + x.files.length, 0), 0);
  console.log(t('cli.packed', {
    out, kb: (bytes.length / 1024).toFixed(1),
    s: t('count.sessions', { n: sessions.length }), sec: t('count.sectors', { n: nSec }), f: t('count.files', { n: nFiles }),
  }));
}

/** Reads an archive and unlocks whatever the given passwords grant. */
async function load(file, passwords = []) {
  if (!file || !fs.existsSync(file)) die(t('cli.noFile', { p: file }));
  let doc;
  try {
    doc = await M.readMpage(fs.readFileSync(file));
  } catch (e) {
    return die(e.message);
  }
  for (const pw of passwords) {
    try {
      const r = await M.unlock(doc, pw);
      console.error(t('cli.unlocked', { list: r.units.join(', ') }));
      doc.warnings.push(...r.warnings);
    } catch (e) {
      console.error(`[x] ${e.message}`);
    }
  }
  return doc;
}

const lockedCount = (doc) => doc.sessions.filter((s) => s.locked).length;

async function unpack(file, outDir, passwords) {
  const doc = await load(file, passwords);
  outDir = outDir || file.replace(/\.mpage$/i, '');
  let n = 0;
  for (const s of doc.sessions) {
    if (s.locked) continue;
    const sDir = path.join(outDir, M.safeName(s.name));
    fs.mkdirSync(sDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, '_session.json'), JSON.stringify({ code: s.code }, null, 2));
    for (const sec of s.sectors) {
      const secDir = path.join(sDir, M.safeName(sec.name));
      fs.mkdirSync(secDir, { recursive: true });
      fs.writeFileSync(path.join(secDir, '_sector.json'), JSON.stringify({ level: sec.level, color: sec.color }, null, 2));
      for (const f of sec.files) {
        fs.writeFileSync(path.join(secDir, f.path ? path.basename(f.path) : M.safeName(f.name)), f.bytes);
        n++;
      }
    }
  }
  console.log(t('cli.unpacked', { dir: outDir, n: t('count.files', { n }) }));
  if (lockedCount(doc)) console.log(t('cli.stillLocked', { n: lockedCount(doc) }));
  console.log(t('cli.plainWarn'));
  for (const w of doc.warnings) console.warn(`[!] ${w}`);
}

async function info(file, passwords) {
  const doc = await load(file, passwords);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`${doc.title}  (mpage ${doc.manifest.version}, ${doc.manifest.generator})`);
  if (doc.security) console.log(t('cli.security', { n: doc.security.slots.length, alg: doc.security.kdf.alg, mib: doc.security.kdf.memory / 1024 }));
  for (const s of doc.sessions) {
    if (s.locked) {
      const size = Object.values(s.raw).reduce((a, b) => a + b.length, 0);
      console.log(`├─ ${t('cli.lockedSession', { size: kb(size) })}`);
      continue;
    }
    console.log(`├─ ${s.protected ? '[+] ' : ''}${s.name}  [${s.code}]`);
    for (const sec of s.sectors) {
      const lvl = M.levelLabel(sec.level);
      if (sec.locked) {
        console.log(`│  ├─ ${t('cli.lockedSector', { level: lvl })}`);
        continue;
      }
      console.log(`│  ├─ ${sec.dek ? '[+] ' : ''}${sec.name}  <${lvl}>  ${t('count.files', { n: sec.files.length })}`);
      for (const f of sec.files) console.log(`│  │    ${f.name.padEnd(32)} ${f.mime.padEnd(22)} ${kb(f.size)}`);
    }
  }
  for (const w of doc.warnings) console.warn(`[!] ${w}`);
}

async function verify(file, passwords) {
  const doc = await load(file, passwords);
  const total = doc.sessions.reduce((n, s) => n + (s.locked ? 0 : s.sectors.reduce((m, x) => m + (x.files?.length || 0), 0)), 0);
  if (doc.warnings.length) {
    for (const w of doc.warnings) console.error(`[x] ${w}`);
    process.exit(2);
  }
  console.log(t('cli.verified', { n: total }));
  if (lockedCount(doc)) console.log(t('cli.verifiedLocked', { n: lockedCount(doc) }));
}

/**
 * Adds a password: mpage protect archive.mpage --new <password> -s <Session> -s <Session/Sector>… [-p <existing password>]…
 * "Session" grants the whole session, "Session/Sector" only that sector.
 */
async function protect(file, passwords, newPw, targets) {
  if (!newPw) die(t('cli.needNew'));
  if (!targets.length) die(t('cli.needTarget'));
  const doc = await load(file, passwords);
  const ids = targets.map((target) => {
    const [sName, secName] = target.split('/');
    const s = doc.sessions.find((x) => !x.locked && x.name === sName);
    if (!s) return die(t('cli.noSession', { name: sName }));
    if (!secName) return s.id;
    const sec = s.sectors.find((x) => !x.locked && x.name === secName);
    return sec ? sec.id : die(t('cli.noSector', { name: target }));
  });
  try {
    await M.addPassword(doc, newPw, ids);
  } catch (e) {
    die(e.message);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, await M.writeMpage({ ...doc, generator: 'mpage-cli/2.1' }));
  fs.renameSync(tmp, file);
  console.log(t('cli.protected', { list: targets.join(', ') }));
}

/** Parses -p, --new, -s, -o and --lang. MPAGE_PASSWORD is treated as an extra -p. */
function parseArgs(argv) {
  const opts = { pw: [], sessions: [], positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--password') opts.pw.push(argv[++i]);
    else if (a === '-s' || a === '--session') opts.sessions.push(argv[++i]);
    else if (a === '--new') opts.newPw = argv[++i];
    else if (a === '-o') opts.out = argv[++i];
    else if (a === '--lang') opts.lang = argv[++i];
    else opts.positional.push(a);
  }
  if (process.env.MPAGE_PASSWORD) opts.pw.push(process.env.MPAGE_PASSWORD);
  return opts;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  let osLocale = null;
  try {
    osLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch { /* not available */ }
  I.setLang(I.detect(o.lang, process.env.MPAGE_LANG, process.env.LC_ALL, process.env.LANG, osLocale));
  const [a, b] = o.positional;
  switch (cmd) {
    case 'pack': return pack(a || die(t('cli.noFolderArg')), o.out);
    case 'unpack': return unpack(a, b, o.pw);
    case 'info': return info(a, o.pw);
    case 'verify': return verify(a, o.pw);
    case 'protect': return protect(a, o.pw, o.newPw, o.sessions);
    default:
      console.log(t('cli.usage'));
      process.exit(cmd ? 1 : 0);
  }
}

main();
