'use strict';
/**
 * .mpage format library (shared by Node.js, Electron and the browser).
 *
 * .mpage is an ordered file archive: Session → Sector → File.
 * Inside the ZIP container:
 *   mimetype                               "application/x-mpage" (first entry, stored)
 *   manifest.json                          tree of sessions, sectors and files (+ SHA-256)
 *   sessions/<session>/<sector>/<file>     the file bytes themselves, in order
 *
 * File bytes are stored, not paths, so an .mpage keeps working when moved
 * to another computer.
 */
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const S = require('./secure');
const { t } = require('./i18n');

const MIME = 'application/x-mpage';
const FORMAT_VERSION = '2.1';
const SUPPORTED_MAJOR = 2;

// Classification levels (a sector's default color comes from here).
const LEVELS = {
  public: { label: 'PUBLIC', color: '#64748b' },
  internal: { label: 'INTERNAL', color: '#0e7490' },
  confidential: { label: 'CONFIDENTIAL', color: '#1d3a8a' },
  restricted: { label: 'RESTRICTED', color: '#2563eb' },
  'top-secret': { label: 'TOP SECRET', color: '#d97706' },
  'ultra-secret': { label: 'ULTRA SECRET', color: '#eab308' },
  secret: { label: 'SECRET', color: '#b91c1c' },
  cosmic: { label: 'COSMIC', color: '#06b6d4' },
};

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain',
  json: 'application/json', xml: 'application/xml', html: 'text/html', js: 'text/javascript',
  py: 'text/x-python', ts: 'text/plain', css: 'text/css', yml: 'text/yaml', yaml: 'text/yaml',
  glb: 'model/gltf-binary', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Already-compressed formats are stored as-is (no quality loss, faster).
const STORE_ONLY = /^(image\/(png|jpeg|webp|gif|avif)|video\/|audio\/(mpeg|ogg|mp4|aac|flac|opus)|model\/gltf-binary|application\/(zip|pdf|vnd\.openxml))/;

/** Errors carry a code: e.code is for programs, e.message is in the current UI language. */
class MpageError extends Error {
  constructor(code, params) {
    super(t(`err.${code}`, params));
    this.code = code;
  }
}

/** Classification level name in the current language. */
function levelLabel(level) {
  const k = `level.${level}`;
  const s = t(k);
  return s === k ? String(level || '').toUpperCase() : s;
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function mimeFromName(name) {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

/** Viewer kind for a MIME type: image | video | audio | pdf | text | other */
function kindOf(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || /json|xml|yaml|javascript/.test(mime)) return 'text';
  return 'other';
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Makes a string safe to use as a file or folder name. */
function safeName(name, fallback = 'nomsiz') {
  const s = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  return s.slice(0, 120) || fallback;
}

function uniqueIn(used, name) {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!used.has(n.toLowerCase())) {
      used.add(n.toLowerCase());
      return n;
    }
  }
}

function randomCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const d = () => Math.floor(Math.random() * 10);
  const l = () => L[Math.floor(Math.random() * L.length)];
  return `${d()}${d()}${d()}_${l()}${l()}${l()}_${d()}${d()}${d()}${l()}${l()}${l()}`;
}

function newSession(name) {
  return { id: uid('ses'), name, code: randomCode(), created: new Date().toISOString(), sectors: [] };
}

function newSector(name, level = 'confidential') {
  return { id: uid('sec'), name, level, color: (LEVELS[level] || LEVELS.confidential).color, files: [] };
}

function newFile(name, bytes, mime) {
  return { id: uid('file'), name, mime: mime || mimeFromName(name), size: bytes.length, added: new Date().toISOString(), bytes };
}

/**
 * .mpage faylini yozadi.
 * @param {{title?:string, id?:string, created?:string, generator?:string,
 *          sessions: Array<{id?,name,code?,created?, sectors: Array<{id?,name,level?,color?, files: Array<{id?,name,mime?,bytes:Uint8Array,added?}>}>}>}} doc
 */
async function writeMpage(doc) {
  if (!Array.isArray(doc.sessions)) throw new MpageError('sessionsArray');
  const files = {};
  const sessionNames = new Set();
  const sessions = [];
  for (let s of doc.sessions) {
    // A protected session (has a DEK) is encrypted before writing; a locked session passes through unchanged.
    if (s.dek && !s.locked) s = await S.sealSession(s, sha256Hex);
    if (s.locked) {
      const blobs = {};
      for (const [path, data] of Object.entries(s.raw)) {
        files[path] = [data, { level: 0 }];
        blobs[path] = await sha256Hex(data);
      }
      sessions.push({ id: s.id, locked: true, blobs });
      continue;
    }
    const sDir = uniqueIn(sessionNames, safeName(s.name, 'session'));
    const sectorNames = new Set();
    const sectors = [];
    for (let sec of s.sectors || []) {
      if (sec.dek && !sec.locked) sec = await S.sealSector(sec, sha256Hex);
      if (sec.locked) {
        for (const [path, data] of Object.entries(sec.raw)) files[path] = [data, { level: 0 }];
        sectors.push(await S.lockedSectorEntry(sec, sha256Hex));
        continue;
      }
      const secDir = uniqueIn(sectorNames, safeName(sec.name, 'sector'));
      const fileNames = new Set();
      const outFiles = [];
      for (const f of sec.files || []) {
        const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
        const mime = f.mime || mimeFromName(f.name);
        const fname = uniqueIn(fileNames, safeName(f.name, 'fayl'));
        const path = `sessions/${sDir}/${secDir}/${fname}`;
        files[path] = [bytes, { level: STORE_ONLY.test(mime) ? 0 : 6 }];
        outFiles.push({
          id: f.id || uid('file'), name: f.name, mime, size: bytes.length,
          sha256: await sha256Hex(bytes), added: f.added || new Date().toISOString(), path,
          ...(f.modified ? { modified: f.modified } : {}),
        });
      }
      sectors.push({
        id: sec.id || uid('sec'), name: sec.name, level: sec.level || 'confidential',
        color: sec.color || (LEVELS[sec.level] || LEVELS.confidential).color, files: outFiles,
      });
    }
    sessions.push({ id: s.id || uid('ses'), name: s.name, code: s.code || randomCode(), created: s.created || new Date().toISOString(), sectors });
  }

  const now = new Date().toISOString();
  const manifest = {
    format: 'mpage',
    version: FORMAT_VERSION,
    id: doc.id || uid('mpage'),
    title: doc.title || 'Nomsiz arxiv',
    created: doc.created || now,
    modified: now,
    generator: doc.generator || 'mpage-lib/2.0',
    sessions,
  };
  if (doc.security && doc.security.slots.length) {
    const slots = [];
    for (const slot of doc.security.slots) slots.push(S.b64(slot.blob || (await S.sealSlot(slot))));
    manifest.security = { kdf: doc.security.kdf, cipher: 'AES-256-GCM', slots };
  } else if (sessions.some((s) => s.locked)) {
    throw new MpageError('lockedNoSlot');
  }

  // Order matters: mimetype must be the first, uncompressed entry.
  return zipSync({
    mimetype: [strToU8(MIME), { level: 0 }],
    'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
    ...files,
  }, { mtime: new Date('2020-01-01T00:00:00Z') });
}

/** Faylning boshidagi baytlarga qarab .mpage ekanini tekshiradi. */
function looksLikeMpage(bytes) {
  if (!bytes || bytes.length < 38 + MIME.length) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) return false;
  const nameLen = bytes[26] | (bytes[27] << 8);
  const extraLen = bytes[28] | (bytes[29] << 8);
  const name = strFromU8(bytes.subarray(30, 30 + nameLen));
  const start = 30 + nameLen + extraLen;
  return name === 'mimetype' && strFromU8(bytes.subarray(start, start + MIME.length)) === MIME;
}

/**
 * Reads an .mpage file and verifies the SHA-256 of every file.
 * Returns { manifest, title, id, created, sessions (files carry `bytes`), security, warnings }
 */
async function readMpage(bytes, opts = {}) {
  const verify = opts.verify !== false;
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!looksLikeMpage(bytes)) throw new MpageError('notMpage');

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new MpageError('corrupt', { msg: e.message });
  }
  if (!entries['manifest.json']) throw new MpageError('noManifest');
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
  } catch (e) {
    throw new MpageError('manifestJson', { msg: e.message });
  }
  if (manifest.format !== 'mpage') throw new MpageError('notMpageFormat');
  const major = parseInt(String(manifest.version).split('.')[0], 10);
  if (major > SUPPORTED_MAJOR) throw new MpageError('version', { v: manifest.version });
  if (!Array.isArray(manifest.sessions)) throw new MpageError('noSessions');

  const warnings = [];
  // Encrypted blocks: without a password only their integrity (ciphertext SHA-256) can be checked.
  const collectBlobs = async (blobs = {}) => {
    const raw = {};
    for (const [path, sum] of Object.entries(blobs)) {
      const data = entries[path];
      if (!data || (verify && (await sha256Hex(data)) !== sum)) warnings.push(t('err.blob', { path }));
      else raw[path] = data;
    }
    return raw;
  };
  const sessions = [];
  for (const s of manifest.sessions) {
    if (s.locked) {
      sessions.push({ id: s.id, locked: true, raw: await collectBlobs(s.blobs) });
      continue;
    }
    const sectors = [];
    for (const sec of s.sectors || []) {
      if (sec.locked) {
        sectors.push({ id: sec.id, locked: true, level: sec.level, color: sec.color, raw: await collectBlobs(sec.blobs) });
        continue;
      }
      const out = [];
      for (const f of sec.files || []) {
        const data = entries[f.path];
        if (!data) {
          warnings.push(t('err.missingFile', { where: `${s.name}/${sec.name}/${f.name}` }));
          continue;
        }
        if (verify && (await sha256Hex(data)) !== f.sha256) {
          warnings.push(t('err.sha', { where: `${s.name}/${sec.name}/${f.name}` }));
          continue;
        }
        out.push({ ...f, bytes: data });
      }
      sectors.push({ ...sec, files: out });
    }
    sessions.push({ ...s, sectors });
  }
  const security = manifest.security
    ? { kdf: manifest.security.kdf, slots: manifest.security.slots.map((b) => ({ blob: S.unb64(b) })) }
    : null;
  return { manifest, id: manifest.id, title: manifest.title, created: manifest.created, sessions, security, warnings };
}

// ---------- Passwords and access ----------
// `doc` is a readMpage() result (or an object of the same shape). These functions mutate it in place.

function checkPasswordStrength(password) {
  const bits = S.passwordBits(password);
  if (bits < S.MIN_PASSWORD_BITS) {
    throw new MpageError('weak', { bits, min: S.MIN_PASSWORD_BITS });
  }
  return bits;
}

/** Finds a protectable unit (session or sector) by id. */
function findUnit(doc, id) {
  for (let si = 0; si < doc.sessions.length; si++) {
    const s = doc.sessions[si];
    if (s.id === id) return { kind: 'session', unit: s, si };
    if (s.locked) continue;
    const ci = s.sectors.findIndex((x) => x.id === id);
    if (ci >= 0) return { kind: 'sector', unit: s.sectors[ci], si, ci, session: s };
  }
  return null;
}

/** Human-readable label: "Session" or "Session / Sector". */
function unitLabel(doc, id) {
  const u = findUnit(doc, id);
  if (!u) return t('sec.lockedUnit');
  if (u.kind === 'session') return u.unit.locked ? t('sec.encryptedSession') : u.unit.name;
  return `${u.session.name} / ${u.unit.locked ? levelLabel(u.unit.level) : u.unit.name}`;
}

function ensureSecurity(doc) {
  if (!doc.security) doc.security = { kdf: { ...S.KDF_DEFAULT, salt: S.b64(S.randomBytes(16)) }, slots: [] };
  return doc.security;
}

/** Finds the key slot matching a KEK (opened or not); an unopened slot is opened in place. */
async function slotForKek(doc, kek) {
  const slots = doc.security?.slots || [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const opened = await S.openSlot(kek, s.blob || (await S.sealSlot(s)));
    if (opened) {
      if (s.blob) slots[i] = opened;
      return { slot: slots[i], wasNew: !!s.blob };
    }
  }
  return null;
}

/** Unlocks every unit reachable with keys from opened slots (opening a session can reveal locked sectors inside). */
async function openWithKnownKeys(doc) {
  const keys = new Map();
  for (const slot of doc.security?.slots || []) if (slot.keys) for (const [id, dek] of Object.entries(slot.keys)) keys.set(id, dek);
  const opened = [];
  const warnings = [];
  for (let progress = true; progress;) {
    progress = false;
    for (const [id, dek] of keys) {
      const u = findUnit(doc, id);
      if (!u || !u.unit.locked) continue;
      if (u.kind === 'session') {
        const r = await S.openSession(u.unit, dek, sha256Hex);
        doc.sessions[u.si] = r.session;
        warnings.push(...r.warnings);
      } else {
        const r = await S.openSector(u.unit, dek, sha256Hex, `${u.session.name}/`);
        u.session.sectors[u.ci] = r.sector;
        warnings.push(...r.warnings);
      }
      opened.push(id);
      progress = true;
    }
  }
  return { opened, warnings };
}

/**
 * Unlocks every session and sector granted by a password (or recovery key).
 * @returns {Promise<{ sessions: string[], units: string[], recovery: boolean, warnings: string[] }>}
 */
async function unlock(doc, password) {
  if (!doc.security) throw new MpageError('noPassword');
  const kek = await S.deriveKek(password, doc.security.kdf);
  const found = await slotForKek(doc, kek);
  if (!found) throw new MpageError('wrongPassword');
  const { warnings } = await openWithKnownKeys(doc);
  const ids = Object.keys(found.slot.keys);
  return {
    sessions: [...new Set(ids.map((id) => findUnit(doc, id)).filter((u) => u?.kind === 'session').map((u) => u.unit.name))],
    units: ids.map((id) => unitLabel(doc, id)),
    recovery: found.slot.kind === 'recovery',
    already: !found.wasNew,
    warnings,
  };
}

/** Makes a unit (session or sector) protected and adds its key to the slot. */
function grant(doc, slot, id) {
  const u = findUnit(doc, id);
  if (!u || u.unit.locked) throw new MpageError('onlyOpenGrant');
  if (!u.unit.dek) {
    u.unit.dek = S.randomBytes(32);
    u.unit.protected = true;
  }
  slot.keys[id] = u.unit.dek;
}

/**
 * Adds a password that unlocks the given sessions and/or sectors.
 * If the same password already exists, its slot is reused and the grants are added to it.
 */
async function addPassword(doc, password, ids) {
  checkPasswordStrength(password);
  if (!ids.length) throw new MpageError('pickOne');
  ensureSecurity(doc);
  const kek = await S.deriveKek(password, doc.security.kdf);
  let slot = (await slotForKek(doc, kek))?.slot;
  if (!slot) {
    slot = { kek, kind: 'password', keys: {} };
    doc.security.slots.push(slot);
  }
  for (const id of ids) grant(doc, slot, id);
  return slot;
}

/** Changes an opened password. Data is not re-encrypted; only the slot is re-sealed with the new key. */
async function changePassword(doc, slot, newPassword) {
  checkPasswordStrength(newPassword);
  const kek = await S.deriveKek(newPassword, doc.security.kdf);
  const other = await slotForKek(doc, kek);
  if (other && other.slot !== slot) throw new MpageError('pwUsed');
  slot.kek = kek;
}

/**
 * Recovery key: a 200-bit code that unlocks every protected session and sector that is open right now.
 * It is shown once; it should be written down and stored somewhere safe.
 */
async function addRecoveryKey(doc) {
  ensureSecurity(doc);
  const ids = new Set();
  for (const s of doc.sessions) {
    if (s.locked) continue;
    if (s.dek) ids.add(s.id);
    for (const sec of s.sectors) if (sec.dek && !sec.locked) ids.add(sec.id);
  }
  if (!ids.size) throw new MpageError('noOpenProtected');
  const code = S.generateRecoveryKey();
  const slot = { kek: await S.deriveKek(code, doc.security.kdf), kind: 'recovery', keys: {} };
  for (const id of ids) grant(doc, slot, id);
  doc.security.slots.push(slot);
  return { code, slot };
}

/** Removes an opened (known) password slot. */
function removePassword(doc, slot) {
  doc.security.slots = doc.security.slots.filter((s) => s !== slot);
}

/** Removes protection from a session or sector (it must be unlocked). */
function unprotect(doc, id) {
  const u = findUnit(doc, id);
  if (!u || u.unit.locked) throw new MpageError('openFirst');
  delete u.unit.dek;
  delete u.unit.protected;
  for (const slot of doc.security?.slots || []) if (slot.keys) delete slot.keys[id];
}

/** Locks everything: keys are dropped from memory and protected units return to their encrypted form. */
async function lockAll(doc) {
  for (let i = 0; i < doc.sessions.length; i++) {
    const s = doc.sessions[i];
    if (s.locked) continue;
    if (s.dek) {
      doc.sessions[i] = await S.sealSession(s, sha256Hex); // also encrypts protected sectors inside
      continue;
    }
    for (let j = 0; j < s.sectors.length; j++) {
      const sec = s.sectors[j];
      if (sec.dek && !sec.locked) s.sectors[j] = await S.sealSector(sec, sha256Hex);
    }
  }
  for (let i = 0; i < (doc.security?.slots.length || 0); i++) {
    const slot = doc.security.slots[i];
    if (!slot.blob) doc.security.slots[i] = { blob: await S.sealSlot(slot) };
  }
}

/** Opened passwords and what they grant (for the UI). */
function accessSummary(doc) {
  const slots = doc.security?.slots || [];
  return {
    known: slots.filter((s) => s.keys).map((slot) => ({ slot, kind: slot.kind, ids: Object.keys(slot.keys) })),
    hidden: slots.filter((s) => s.blob).length,
  };
}

module.exports = {
  MIME,
  FORMAT_VERSION,
  LEVELS,
  MpageError,
  accessSummary,
  addPassword,
  addRecoveryKey,
  changePassword,
  checkPasswordStrength,
  findUnit,
  generatePassword: S.generatePassword,
  levelLabel,
  lockAll,
  passwordBits: S.passwordBits,
  removePassword,
  unitLabel,
  unlock,
  unprotect,
  unprotectSession: unprotect,
  extOf,
  kindOf,
  looksLikeMpage,
  mimeFromName,
  newFile,
  newSector,
  newSession,
  randomCode,
  readMpage,
  safeName,
  sha256Hex,
  uid,
  writeMpage,
};
