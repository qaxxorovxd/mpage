'use strict';
/**
 * .mpage encryption: sessions and sectors protected by passwords.
 *
 *   password ──Argon2id(salt, 64 MiB)──▶ KEK (key-encryption key)
 *   KEK ──AES-256-GCM──▶ key slot: { unitId: DEK, … }
 *   DEK ──AES-256-GCM──▶ unit metadata (names, sectors, file names) and every file
 *
 * - Every protected session or sector has its own random 256-bit DEK.
 * - Every password is one key slot; only its holder can see what it unlocks.
 * - Every encrypted block uses a fresh random 96-bit IV and is bound to its unit/file id via AAD,
 *   so swapping or tampering with blocks is caught by GCM authentication.
 */
const { argon2id } = require('hash-wasm');
const { t } = require('./i18n');

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// Slightly above the RFC 9106 recommendation (64 MiB); parameters are stored per file and can be raised later.
const KDF_DEFAULT = { alg: 'argon2id', memory: 65536, iterations: 4, parallelism: 1 };
const MIN_PASSWORD_BITS = 70;

class SecureError extends Error {
  constructor(code, params) {
    super(t(`err.${code}`, params));
    this.code = code;
  }
}

function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/**
 * Rough password strength estimate in bits: charset × length, with penalties for repeats and sequences.
 * This is not a security boundary, only a filter that rejects weak passwords.
 */
function passwordBits(pw) {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  // repeated characters and simple sequences reduce the effective length
  let effective = 0;
  for (let i = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i), p = pw.charCodeAt(i - 1), pp = pw.charCodeAt(i - 2);
    if (i > 0 && c === p) effective += 0.2;
    else if (i > 1 && c - p === p - pp && Math.abs(c - p) <= 1) effective += 0.3;
    else effective += 1;
  }
  const unique = new Set(pw).size;
  let bits = Math.round(Math.min(effective, unique * 1.5) * Math.log2(Math.max(pool, 1)));
  // Shapes dictionary attacks try first: "Word2024!", common words, keyboard rows.
  if (/^[A-Za-z]{1,16}[0-9]{0,8}[^A-Za-z0-9]{0,3}$/.test(pw)) bits = Math.min(bits, 40);
  if (/(password|parol|qwerty|asdf|zxcv|admin|letmein|welcome|12345|11111|00000|abc123|iloveyou)/i.test(pw)) bits = Math.min(bits, 20);
  if (pw.length < 12) bits = Math.min(bits, 45);
  return bits;
}

/** Strong random password: XXXX-XXXX-XXXX-XXXX-XXXX (32-symbol alphabet, 100 bits). */
function generatePassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => A[b & 31]);
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

async function aesKey(raw) {
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function deriveKek(password, kdf) {
  if (kdf.alg !== 'argon2id') throw new SecureError('unknownKdf', { alg: kdf.alg });
  const hash = await argon2id({
    password: enc.encode(String(password).normalize('NFC')),
    salt: unb64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memory,
    hashLength: 32,
    outputType: 'binary',
  });
  return aesKey(hash);
}

/** iv(12) || AES-GCM shifrmatn+teg */
async function seal(key, data, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function unseal(key, blob, aad) {
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: enc.encode(aad) }, key, blob.subarray(12)));
  } catch {
    return null; // wrong key or tampered data
  }
}

// ---------- Encrypted units: sessions and sectors ----------
// A locked unit is kept in memory as a stub: { id, locked: true, raw: { path: bytes }, …public fields }.
// A sector stub keeps only its level and color public (so the card can show "TOP SECRET" with a lock icon).

async function sealFiles(key, unitId, files, sha256Hex, raw) {
  const out = [];
  for (const f of files) {
    const path = `locked/${unitId}/${f.id}.bin`;
    raw[path] = await seal(key, f.bytes, `${unitId}/${f.id}`);
    out.push({
      id: f.id, name: f.name, mime: f.mime, size: f.bytes.length, sha256: f.sha256 || (await sha256Hex(f.bytes)),
      added: f.added, ...(f.modified ? { modified: f.modified } : {}), path,
    });
  }
  return out;
}

async function openFiles(key, unitId, files, raw, sha256Hex, where, warnings) {
  const out = [];
  for (const f of files) {
    const blob = raw[f.path];
    const bytes = blob && (await unseal(key, blob, `${unitId}/${f.id}`));
    if (!bytes || (await sha256Hex(bytes)) !== f.sha256) {
      warnings.push(t('err.fileCorrupt', { where: `${where}/${f.name}` }));
      continue;
    }
    const { path, ...rest } = f;
    out.push({ ...rest, bytes });
  }
  return out;
}

/** Manifest/session entry for a locked sector: public fields and block checksums only. */
async function lockedSectorEntry(stub, sha256Hex) {
  const blobs = {};
  for (const [p, d] of Object.entries(stub.raw)) blobs[p] = await sha256Hex(d);
  return { id: stub.id, locked: true, level: stub.level, color: stub.color, blobs };
}

/** Encrypts an unlocked sector that has a DEK. */
async function sealSector(sec, sha256Hex) {
  const key = await aesKey(sec.dek);
  const raw = {};
  const files = await sealFiles(key, sec.id, sec.files, sha256Hex, raw);
  const meta = { name: sec.name, level: sec.level, color: sec.color, files };
  raw[`locked/${sec.id}/meta.bin`] = await seal(key, enc.encode(JSON.stringify(meta)), `${sec.id}/meta`);
  return { id: sec.id, locked: true, level: sec.level, color: sec.color, raw };
}

async function openSector(stub, dek, sha256Hex, where = '') {
  const key = await aesKey(dek);
  const metaBlob = stub.raw[`locked/${stub.id}/meta.bin`];
  const metaBytes = metaBlob && (await unseal(key, metaBlob, `${stub.id}/meta`));
  if (!metaBytes) throw new SecureError('sectorMeta');
  const meta = JSON.parse(dec.decode(metaBytes));
  const warnings = [];
  const files = await openFiles(key, stub.id, meta.files, stub.raw, sha256Hex, `${where}${meta.name}`, warnings);
  return { sector: { id: stub.id, name: meta.name, level: meta.level, color: meta.color, files, protected: true, dek }, warnings };
}

/** Encrypts an unlocked session that has a DEK. Protected sectors inside are sealed with their own key first. */
async function sealSession(s, sha256Hex) {
  const key = await aesKey(s.dek);
  const raw = {};
  const sectors = [];
  for (let sec of s.sectors) {
    if (sec.dek && !sec.locked) sec = await sealSector(sec, sha256Hex);
    if (sec.locked) {
      Object.assign(raw, sec.raw);
      sectors.push(await lockedSectorEntry(sec, sha256Hex));
      continue;
    }
    sectors.push({ id: sec.id, name: sec.name, level: sec.level, color: sec.color, files: await sealFiles(key, s.id, sec.files, sha256Hex, raw) });
  }
  const meta = { name: s.name, code: s.code, created: s.created, sectors };
  raw[`locked/${s.id}/meta.bin`] = await seal(key, enc.encode(JSON.stringify(meta)), `${s.id}/meta`);
  return { id: s.id, locked: true, raw };
}

/** Decrypts a session with its DEK; locked sectors inside stay as stubs. */
async function openSession(stub, dek, sha256Hex) {
  const key = await aesKey(dek);
  const metaBlob = stub.raw[`locked/${stub.id}/meta.bin`];
  const metaBytes = metaBlob && (await unseal(key, metaBlob, `${stub.id}/meta`));
  if (!metaBytes) throw new SecureError('sessionMeta');
  const meta = JSON.parse(dec.decode(metaBytes));
  const warnings = [];
  const sectors = [];
  for (const sec of meta.sectors) {
    if (sec.locked) {
      const raw = {};
      for (const p of Object.keys(sec.blobs)) if (stub.raw[p]) raw[p] = stub.raw[p];
      sectors.push({ id: sec.id, locked: true, level: sec.level, color: sec.color, raw });
      continue;
    }
    sectors.push({ ...sec, files: await openFiles(key, stub.id, sec.files, stub.raw, sha256Hex, `${meta.name}/${sec.name}`, warnings) });
  }
  return { session: { id: stub.id, name: meta.name, code: meta.code, created: meta.created, sectors, protected: true, dek }, warnings };
}

// ---------- Key slots ----------
// In memory: an opened slot is { kek, keys: { id: DEK }, kind }, an unopened one is { blob }.
// keys mixes session and sector ids (distinct prefixes and random, so they never collide).
// kind: 'password' or 'recovery'.

async function sealSlot(slot) {
  const keys = Object.fromEntries(Object.entries(slot.keys).map(([id, dek]) => [id, b64(dek)]));
  return seal(slot.kek, enc.encode(JSON.stringify({ v: 2, kind: slot.kind || 'password', keys })), 'mpage-keyslot');
}

async function openSlot(kek, blob) {
  const plain = await unseal(kek, blob, 'mpage-keyslot');
  if (!plain) return null;
  const data = JSON.parse(dec.decode(plain));
  const keys = data.keys || data.sessions || {}; // v1 slots only had `sessions`
  return { kek, kind: data.kind || 'password', keys: Object.fromEntries(Object.entries(keys).map(([id, d]) => [id, unb64(d)])) };
}

/** Recovery key: 8 groups of 5 (40 symbols, 200 bits), meant to be written on paper. */
function generateRecoveryKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(randomBytes(40), (b) => A[b & 31]);
  return Array.from({ length: 8 }, (_, i) => chars.slice(i * 5, i * 5 + 5).join('')).join('-');
}

module.exports = {
  KDF_DEFAULT,
  MIN_PASSWORD_BITS,
  SecureError,
  b64,
  deriveKek,
  generatePassword,
  generateRecoveryKey,
  lockedSectorEntry,
  openSector,
  openSession,
  openSlot,
  passwordBits,
  randomBytes,
  sealSector,
  sealSession,
  sealSlot,
  unb64,
};
