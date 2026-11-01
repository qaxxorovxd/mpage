import {
  LEVELS, accessSummary, addPassword, addRecoveryKey, changePassword, checkPasswordStrength, generatePassword, kindOf,
  lockAll, mimeFromName, newFile, newSector, newSession, passwordBits, readMpage, removePassword, unitLabel, unlock,
  unprotect, writeMpage, levelLabel as levelName,
} from '../../../lib/mpage.js';
import { LANGS, detect, getLang, setLang, t } from '../../../lib/i18n.js';
import { applyIcons, icon } from './icons.js';
import { SectorStack } from './stack.js';
import { HandTracker } from './hands.js';
import { GESTURE_PARAMS, gestureConfig as G, resetGestureConfig, saveGestureConfig } from './gesture-config.js';
import { host } from './host.js';
import { renderFlavor, textFlavor } from './viewers.js';

const $ = (s) => document.querySelector(s);
const on = (id, fn) => ($(id).onclick = fn);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const levelLabel = (s) => levelName(s.level);
const flavorLabel = (f) => t(`flavor.${f}`);

// ---------- State ----------
const state = {
  doc: null,       // { id, title, created, sessions }
  path: null,
  dirty: false,
  si: 0,           // tanlangan session
  focus: 0,        // focused sector
  open: false,     // is the sector open (files visible)
  preview: -1,     // index of the previewed file
  zoom: 1,         // image zoom in preview
};
const rawSession = () => state.doc?.sessions[state.si];
// A locked (encrypted) session cannot be browsed, so session() returns null for it.
const session = () => (rawSession()?.locked ? null : rawSession());
const sector = () => session()?.sectors[state.focus];
const urls = new Map(); // file id → blob URL

function urlFor(f) {
  if (!urls.has(f.id)) urls.set(f.id, URL.createObjectURL(new Blob([f.bytes], { type: f.mime })));
  return urls.get(f.id);
}
function dropUrl(f) {
  if (urls.has(f.id)) URL.revokeObjectURL(urls.get(f.id));
  urls.delete(f.id);
}

let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), kind === 'error' ? 6000 : 2500);
}

function markDirty() {
  state.dirty = true;
  renderTitle();
}
function renderTitle() {
  $('#doc-title').textContent = state.doc ? `${state.doc.title}${state.dirty ? ' •' : ''}` : t('app.noArchive');
  host.setTitle(state.doc ? `${state.dirty ? '• ' : ''}${state.doc.title} — MPage` : 'MPage');
}

// ---------- Modal (Electron has no prompt()) ----------
function ask(title, fields) {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    $('#modal-fields').innerHTML = fields.map((f) => `<label>${esc(f.label)}</label>${
      f.options
        ? `<select name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input name="${f.name}" value="${esc(f.value || '')}" ${f.type ? `type="${f.type}"` : ''} autocomplete="off">`}`).join('');
    $('#modal').hidden = false;
    const first = $('#modal-fields input, #modal-fields select');
    first?.focus();
    first?.select?.();
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modal-form').onsubmit = null;
      $('#modal-cancel').onclick = null;
      resolve(v);
    };
    $('#modal-form').onsubmit = (e) => {
      e.preventDefault();
      done(Object.fromEntries(new FormData($('#modal-form'))));
    };
    $('#modal-cancel').onclick = () => done(null);
  });
}
const levelOptions = () => Object.keys(LEVELS).map((k) => [k, levelName(k)]);

// ---------- 3D card stack ----------
const stack = new SectorStack($('#stack'), $('#labels'));
stack.levelLabel = levelLabel;
new ResizeObserver(() => stack.resize()).observe($('#stage'));

// ---------- Rendering ----------
const SERVER_SVG = `<svg class="srv" viewBox="0 0 34 22" aria-hidden="true"><path d="M2 8 17 2l15 6-15 6z" fill="#f8fafc" stroke="#94a3b8" stroke-width=".6"/>
<path d="M2 8v6l15 6v-6z" fill="#cbd5e1" stroke="#94a3b8" stroke-width=".6"/><path d="M32 8v6l-15 6v-6z" fill="#94a3b8" stroke="#64748b" stroke-width=".6"/>
<circle cx="25" cy="14" r="1" fill="#22c55e"/></svg>`;

function renderSessions() {
  const list = $('#session-list');
  list.innerHTML = (state.doc?.sessions || []).map((s, i) => {
    const cls = `${i === state.si ? 'active' : ''} ${s.locked ? 'locked' : ''}`;
    if (s.locked) {
      const size = Object.values(s.raw).reduce((a, b) => a + b.length, 0);
      return `<li data-si="${i}" class="${cls}" data-hand><span class="lock-ico">${icon('lock')}</span>
        <div class="nm">${t('list.encrypted')}<small>${t('list.needPassword', { size: fmtSize(size) })}</small></div></li>`;
    }
    const n = s.sectors.reduce((a, x) => a + (x.files?.length || 0), 0);
    const nLocked = s.sectors.filter((x) => x.locked).length;
    return `<li data-si="${i}" class="${cls}" data-hand>${SERVER_SVG}
      <div class="nm">${s.dek ? `<span class="badge" title="${esc(t('list.protectedOpen'))}">${icon('unlock')}</span>` : ''}${esc(s.name)}<small>${t('count.sectors', { n: s.sectors.length })} · ${t('count.files', { n })}${nLocked ? ` · ${icon('lock', 'xs')} ${nLocked}` : ''}</small></div></li>`;
  }).join('');
  list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  const sec = state.doc?.security;
  $('#btn-lock').hidden = !hasOpenSecrets();
  $('#access-state').textContent = sec ? t('access.count', { n: sec.slots.length }) : t('access.unprotected');
}

/** Is any protected data (or an opened password) held in memory? Auto-lock checks this. */
function hasOpenSecrets() {
  if (!state.doc) return false;
  if (state.doc.security?.slots.some((s) => s.keys)) return true;
  return state.doc.sessions.some((s) => !s.locked && (s.dek || s.sectors.some((x) => x.dek && !x.locked)));
}

/** Lock card: shown for a locked session, or when a locked sector is opened. */
function renderLock() {
  const s = rawSession();
  const what = s?.locked ? 'session' : state.open && sector()?.locked ? 'sector' : null;
  const wasHidden = $('#locked').hidden;
  $('#locked').hidden = !what;
  if (!what) {
    hideKeyboard();
    return;
  }
  const sec = sector();
  $('#lock-title').textContent = what === 'session' ? t('lock.sessionTitle') : t('lock.sectorTitle', { level: levelLabel(sec) });
  $('#lock-text').textContent = what === 'session' ? t('lock.sessionText') : t('lock.sectorText', { session: s.name });
  $('#locked').classList.toggle('sector-lock', what === 'sector');
  if (wasHidden) {
    $('#unlock-pw').value = '';
    if (tracker.running || keyboardWanted()) showKeyboard();
    else setTimeout(() => $('#unlock-pw').focus(), 0);
  }
  renderThrottle();
}

function renderStack() {
  const s = session();
  stack.setSectors(s ? s.sectors : []);
  stack.focus = state.focus;
  stack.open = state.open ? state.focus : -1;
  $('#code-chip').hidden = !s;
  $('#code-chip').textContent = s ? s.code : '';
  $('#stage-hint').textContent = s && !s.sectors.length ? t('stage.noSectors') : '';
  renderLock();
}

function syncStack() {
  stack.focus = state.focus;
  stack.open = state.open ? state.focus : -1;
}

function thumbHTML(f) {
  const kind = kindOf(f.mime);
  const ext = (f.name.split('.').pop() || '').toUpperCase().slice(0, 5);
  let inner;
  if (kind === 'image') inner = `<img src="${urlFor(f)}" alt="" loading="lazy" draggable="false">`;
  else if (kind === 'video') inner = `<video src="${urlFor(f)}#t=0.5" muted preload="metadata"></video>`;
  else if (kind === 'audio') inner = `<canvas data-wave="${f.id}"></canvas>`;
  else if (kind === 'text') inner = `<pre>${esc(new TextDecoder().decode(f.bytes.subarray(0, 1400)))}</pre>`;
  else if (kind === 'pdf') inner = `<div class="doc"><h4>${esc(f.name.replace(/\.pdf$/i, '').toUpperCase())}</h4>${'<i></i>'.repeat(14)}</div>`;
  else inner = `<div class="big-ext">${esc(ext || 'FILE')}</div>`;
  return `<div class="thumb">${inner}</div><span class="ext ${kind}">${esc(ext)}</span>`;
}

function renderFiles() {
  const sec = sector();
  renderLock();
  $('#files').hidden = !state.open || !sec || sec.locked;
  if (!state.open || !sec || sec.locked) return;
  $('#crumb-session').textContent = session().name;
  $('#crumb-sector').textContent = sec.name;
  $('#crumb-level').textContent = levelLabel(sec);
  $('#crumb-level').style.background = sec.color;
  const grid = $('#file-grid');
  grid.innerHTML = sec.files.length
    ? sec.files.map((f, i) => `<div class="paper" data-fi="${i}" data-hand title="${esc(f.name)}">${thumbHTML(f)}
        <footer><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small></footer></div>`).join('')
    : `<div class="empty">${esc(t('files.empty'))}</div>`;
  grid.querySelectorAll('canvas[data-wave]').forEach((c) => drawWave(c, sec.files.find((f) => f.id === c.dataset.wave)));
}

let audioCtx;
const waveCache = new Map();
async function drawWave(canvas, f, color = '#c2410c') {
  try {
    if (!waveCache.has(f.id)) {
      audioCtx ||= new AudioContext();
      const buf = await audioCtx.decodeAudioData(f.bytes.slice().buffer);
      const data = buf.getChannelData(0), bars = 64, step = Math.floor(data.length / bars), peaks = [];
      for (let i = 0; i < bars; i++) {
        let m = 0;
        for (let j = 0; j < step; j += 16) m = Math.max(m, Math.abs(data[i * step + j]));
        peaks.push(m);
      }
      waveCache.set(f.id, { peaks, duration: buf.duration });
    }
    const { peaks } = waveCache.get(f.id);
    canvas.width = canvas.clientWidth * 2;
    canvas.height = canvas.clientHeight * 2;
    const g = canvas.getContext('2d'), bw = canvas.width / peaks.length, max = Math.max(...peaks, 0.01);
    g.fillStyle = color;
    peaks.forEach((p, i) => {
      const h = Math.max(2, (p / max) * canvas.height * 0.9);
      g.fillRect(i * bw + bw * 0.2, (canvas.height - h) / 2, bw * 0.6, h);
    });
  } catch { /* undecodable audio: no waveform */ }
}

function renderPreview() {
  const sec = sector();
  const f = sec?.files?.[state.preview];
  $('#preview').hidden = !f;
  const body = $('#pv-body');
  body.querySelectorAll('video, audio').forEach((m) => m.pause());
  if (!f) {
    body.innerHTML = '';
    return;
  }
  state.zoom = 1;
  const kind = kindOf(f.mime);
  const flavor = kind === 'text' ? textFlavor(f.name, f.mime) : null;
  const edited = f.modified ? ` · ${t('pv.modified', { date: new Date(f.modified).toLocaleString(getLang()) })}` : '';
  $('#pv-name').textContent = f.name;
  $('#pv-meta').textContent = `${flavor ? flavorLabel(flavor) : f.mime} · ${fmtSize(f.size)} · ${session().name} / ${sec.name}${edited}`;
  $('#pv-pos').textContent = `${state.preview + 1} / ${sec.files.length}`;
  $('#pv-edit').hidden = kind !== 'text' || !!state.edit;
  $('#pv-replace').hidden = !!state.edit;
  if (state.edit?.fileId === f.id) return renderEditor(f);
  const u = urlFor(f);
  if (kind === 'image') body.innerHTML = `<img src="${u}" alt="" draggable="false">`;
  else if (kind === 'video') body.innerHTML = `<video src="${u}" controls autoplay></video>`;
  else if (kind === 'pdf') body.innerHTML = `<iframe src="${u}"></iframe>`;
  else if (kind === 'text') body.innerHTML = `<div class="text-view ${flavor}">${renderFlavor(flavor, decodeText(f.bytes))}</div>`;
  else if (kind === 'audio') {
    body.innerHTML = `<div class="audio-card"><canvas></canvas><audio src="${u}" controls autoplay></audio></div>`;
    drawWave(body.querySelector('canvas'), f, '#1b6f7a');
  } else {
    body.innerHTML = `<div class="other-card"><div class="big-ext">${esc((f.name.split('.').pop() || 'FILE').toUpperCase())}</div>
      <p>${esc(f.name)}<br><small>${esc(f.mime)} · ${fmtSize(f.size)}</small></p>
      <button class="primary" id="pv-export-2">${icon('download')}<span>${esc(t('pv.saveToPc'))}</span></button></div>`;
    $('#pv-export-2').onclick = exportFile;
  }
}

// ---------- Text editor ----------
const decodeText = (bytes) => new TextDecoder().decode(bytes);

function renderEditor(f) {
  const ed = state.edit;
  const body = $('#pv-body');
  const live = ed.flavor === 'markdown' || ed.flavor === 'json' || ed.flavor === 'csv';
  body.innerHTML = `<div class="editor ${live && ed.split ? 'split' : ''}">
    <div class="ed-tools">
      <span class="ed-flavor">${icon('pencil')}${esc(flavorLabel(ed.flavor))}</span>
      ${ed.flavor === 'json' ? `<button type="button" id="ed-format" title="${esc(t('ed.formatTitle'))}">${icon('braces')}<span>${esc(t('ed.format'))}</span></button>` : ''}
      ${live ? `<button type="button" id="ed-split" class="${ed.split ? 'on' : ''}" title="${esc(t('ed.viewTitle'))}">${icon('columns')}<span>${esc(t('ed.view'))}</span></button>` : ''}
      <span id="ed-status"></span>
      <span class="grow"></span>
      <button type="button" id="ed-cancel">${esc(t('ed.cancel'))}</button>
      <button type="button" id="ed-save" class="primary">${icon('save')}<span>${esc(t('ed.save'))}</span></button>
    </div>
    <div class="ed-panes">
      <textarea id="ed-text" spellcheck="false" wrap="${ed.flavor === 'csv' || ed.flavor === 'code' ? 'off' : 'soft'}"></textarea>
      <div id="ed-preview" class="text-view ${ed.flavor}"></div>
    </div>
  </div>`;
  const ta = $('#ed-text');
  ta.value = ed.text;
  const update = () => {
    ed.text = ta.value;
    const changed = ed.text !== ed.original;
    const parts = [changed ? t('ed.changed') : t('ed.saved')];
    let bad = false;
    if (ed.flavor === 'json') {
      try {
        JSON.parse(ed.text);
        parts.push(t('ed.jsonOk'));
      } catch (e) {
        parts.push(t('view.jsonError', { msg: e.message }));
        bad = true;
      }
    }
    parts.push(t('count.lines', { n: ed.text.split('\n').length }));
    $('#ed-status').innerHTML = `${icon(bad ? 'alert' : changed ? 'dot' : 'check', 'xs')}${esc(parts.join(' · '))}`;
    $('#ed-status').classList.toggle('bad', bad);
    if (live && ed.split) $('#ed-preview').innerHTML = renderFlavor(ed.flavor, ed.text);
  };
  let t;
  ta.oninput = () => {
    clearTimeout(t);
    t = setTimeout(update, 120);
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      ta.oninput();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      cancelEdit();
    }
  };
  $('#ed-cancel').onclick = cancelEdit;
  $('#ed-save').onclick = () => commitEdit();
  if ($('#ed-split')) $('#ed-split').onclick = () => {
    ed.text = ta.value;
    ed.split = !ed.split;
    renderEditor(f);
  };
  if ($('#ed-format')) $('#ed-format').onclick = () => {
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      update();
    } catch (e) {
      toast(t('ed.formatFail', { msg: e.message }), 'error');
    }
  };
  update();
  ta.focus();
}

function startEdit() {
  const f = sector()?.files?.[state.preview];
  if (!f || kindOf(f.mime) !== 'text') return;
  const text = decodeText(f.bytes);
  const flavor = textFlavor(f.name, f.mime);
  state.edit = { fileId: f.id, original: text, text, flavor, split: flavor === 'markdown' };
  renderPreview();
}

/** Asks before discarding unsaved edits. Returns true when it is safe to continue. */
function confirmLeaveEdit() {
  const ed = state.edit;
  if (!ed) return true;
  if (ed.text !== ed.original && !confirm(t('ed.leave'))) return false;
  state.edit = null;
  return true;
}

function cancelEdit() {
  if (!confirmLeaveEdit()) return;
  renderPreview();
}

/** Applies the edit to the file in memory; with saveArchive=true the .mpage is saved too. */
async function commitEdit(saveArchive = false, force = false) {
  const ed = state.edit;
  const f = sector()?.files?.find((x) => x.id === ed?.fileId);
  if (!ed || !f) return;
  ed.text = $('#ed-text')?.value ?? ed.text;
  if (ed.flavor === 'json' && !force) {
    try {
      JSON.parse(ed.text);
    } catch (e) {
      if (!confirm(t('ed.jsonSaveAnyway', { msg: e.message }))) return;
    }
  }
  if (ed.text !== ed.original) {
    f.bytes = new TextEncoder().encode(ed.text);
    f.size = f.bytes.length;
    f.modified = new Date().toISOString();
    delete f.sha256;
    dropUrl(f);
    markDirty();
  }
  state.edit = null;
  renderFiles();
  renderPreview();
  toast(t('ed.updated', { name: f.name }) + (saveArchive ? '' : t('ed.saveHint')));
  if (saveArchive) await save(false);
}

/** Replaces a file with a newer version from disk (keeps its id and position). */
async function replaceFile() {
  const sec = sector();
  const f = sec?.files?.[state.preview];
  if (!f || !confirmLeaveEdit()) return;
  const [picked] = await host.pickFiles();
  if (!picked) return;
  const newMime = mimeFromName(picked.name);
  const sameExt = picked.name.split('.').pop().toLowerCase() === f.name.split('.').pop().toLowerCase();
  if (kindOf(newMime) !== kindOf(f.mime) && !confirm(t('ed.typeChange', { from: f.mime, to: newMime }))) return;
  f.bytes = picked.data;
  f.size = picked.data.length;
  f.mime = sameExt ? f.mime : newMime;
  if (!sameExt) f.name = picked.name;
  f.modified = new Date().toISOString();
  delete f.sha256;
  dropUrl(f);
  waveCache.delete(f.id);
  markDirty();
  renderFiles();
  renderPreview();
  toast(t('ed.replaced', { name: f.name, size: fmtSize(f.size) }));
}

async function newTextFile() {
  const sec = sector();
  if (!sec || sec.locked) return;
  const v = await ask(t('ed.newTitle'), [
    { name: 'name', label: t('ed.fileName'), value: t('ed.defaultName') },
    { name: 'kind', label: t('ed.kind'), value: 'md', options: [['md', t('ed.kindMd')], ['txt', t('ed.kindTxt')], ['json', t('ed.kindJson')], ['csv', t('ed.kindCsv')]] },
  ]);
  if (!v?.name) return;
  let name = v.name.trim();
  if (!/\.[a-z0-9]+$/i.test(name)) name += `.${v.kind}`;
  const starter = { md: t('ed.starterMd'), txt: '', json: '{\n  \n}\n', csv: t('ed.starterCsv') }[name.split('.').pop().toLowerCase()] ?? '';
  const f = newFile(name, new TextEncoder().encode(starter), mimeFromName(name));
  sec.files.push(f);
  markDirty();
  renderSessions();
  renderStack();
  renderFiles();
  openFile(sec.files.length - 1);
  startEdit();
}

function renderAll() {
  $('#welcome').hidden = !!state.doc;
  renderTitle();
  renderSessions();
  renderStack();
  renderFiles();
  renderPreview();
}

// ---------- Navigation ----------
function selectSession(i) {
  if (!state.doc || i < 0 || i >= state.doc.sessions.length) return;
  if (i === state.si || !confirmLeaveEdit()) return;
  state.si = i;
  state.focus = 0;
  state.open = false;
  state.preview = -1;
  stack.yaw = 0;
  renderSessions();
  renderStack();
  renderFiles();
  renderPreview();
}
function stepSession(d) {
  if (!state.doc) return;
  const n = state.doc.sessions.length;
  selectSession((state.si + d + n) % n);
}
function focusSector(i) {
  const n = session()?.sectors.length || 0;
  if (!n || !confirmLeaveEdit()) return;
  state.focus = (i + n) % n;
  state.preview = -1;
  syncStack();
  renderFiles();
  renderPreview();
}
function openSector(i = state.focus) {
  if (!session()?.sectors.length) return;
  state.focus = i;
  state.open = true;
  state.preview = -1;
  syncStack();
  renderFiles();
  renderPreview();
}
function closeSector() {
  if (!confirmLeaveEdit()) return;
  state.open = false;
  state.preview = -1;
  syncStack();
  renderFiles();
  renderPreview();
}
function openFile(i) {
  const n = sector()?.files?.length || 0;
  if (!n || !confirmLeaveEdit()) return;
  state.preview = (i + n) % n;
  renderPreview();
}
function closePreview() {
  if (!confirmLeaveEdit()) return;
  state.preview = -1;
  renderPreview();
}
function back() {
  if (!$('#modal').hidden) return;
  if (!$('#help').hidden) $('#help').hidden = true;
  else if (state.preview >= 0) closePreview();
  else if (state.open) closeSector();
}

// ---------- File operations ----------
function loadDoc(doc, path) {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  waveCache.clear();
  state.edit = null;
  state.doc = { id: doc.id, title: doc.title, created: doc.created, sessions: doc.sessions, security: doc.security || null };
  state.path = path;
  state.dirty = false;
  state.si = 0;
  state.focus = 0;
  state.open = false;
  state.preview = -1;
  renderAll();
}

async function confirmDiscard() {
  return !state.dirty || confirm(t('ops.discard'));
}

async function openBytes(bytes, path) {
  if (!(await confirmDiscard())) return;
  try {
    const doc = await readMpage(bytes);
    loadDoc(doc, path);
    const open = doc.sessions.filter((s) => !s.locked);
    const nFiles = open.reduce((a, s) => a + s.sectors.reduce((b, x) => b + (x.files?.length || 0), 0), 0);
    const nLocked = doc.sessions.length - open.length;
    if (doc.warnings.length) toast(t('ops.warning', { list: doc.warnings.join('; ') }), 'error');
    else toast(t('ops.opened', { title: doc.title, sessions: t('count.sessions', { n: doc.sessions.length }), files: t('count.files', { n: nFiles }) }) + (nLocked ? t('ops.lockedCount', { n: nLocked }) : ''));
  } catch (e) {
    toast(t('ops.openFail', { msg: e.message }), 'error');
  }
}
async function openPath(path) {
  try {
    const f = await host.readFile(path);
    await openBytes(f.data, f.path);
  } catch (e) {
    toast(t('ops.openFail', { msg: e.message }), 'error');
  }
}
async function openDialog() {
  const r = await host.pickFile();
  if (!r) return;
  if (typeof r === 'string') await openPath(r);
  else await openBytes(r.data, null);
}
async function newArchive() {
  if (!(await confirmDiscard())) return;
  const s = newSession('Session_01');
  s.sectors.push(newSector('SECTOR_001', 'confidential'));
  loadDoc({ id: null, title: t('app.newArchive'), created: null, sessions: [s] }, null);
  markDirty();
}

async function save(as = false) {
  if (!state.doc) return;
  try {
    const bytes = await writeMpage({ ...state.doc, generator: 'MPage/2.0' });
    const saved = await host.saveFile({ path: as ? null : state.path, data: bytes, title: state.doc.title });
    if (!saved) return;
    if (typeof saved === 'string') {
      state.path = saved;
      state.doc.title = saved.split(/[\\/]/).pop().replace(/\.mpage$/i, '');
    }
    state.dirty = false;
    renderTitle();
    toast(t('ops.saved', { size: fmtSize(bytes.length) }));
  } catch (e) {
    toast(t('ops.saveFail', { msg: e.message }), 'error');
  }
}

/** Current writable session: warns and returns null if locked; creates one if there is none. */
function writableSession() {
  if (rawSession()?.locked) {
    toast(t('ops.sessionLocked'), 'error');
    return null;
  }
  if (!session()) {
    state.doc.sessions.push(newSession('Session_01'));
    state.si = state.doc.sessions.length - 1;
  }
  return session();
}

/** Adds files to the current (or given) sector. */
function addFiles(list, target = sector()) {
  if (!state.doc || !list.length) return;
  if (!target && !writableSession()) return;
  if (target?.locked) return toast(t('ops.sectorLocked'), 'error');
  if (!target) {
    target = newSector('SECTOR_001');
    session().sectors.push(target);
    state.focus = session().sectors.length - 1;
  }
  for (const { name, data } of list) target.files.push(newFile(name, data, mimeFromName(name)));
  if (target === sector()) state.open = true;
  markDirty();
  renderSessions();
  renderStack();
  renderFiles();
  toast(t('ops.filesAdded', { n: list.length, target: target.name }));
}

/** Dropped folder: with subfolders it becomes a new session, otherwise a new sector. */
function importFolder(tree) {
  if (!state.doc) loadDoc({ title: t('app.newArchive'), sessions: [] }, null);
  const subdirs = tree.children.filter((c) => c.children);
  const files = (node, prefix = '') => node.children.flatMap((c) => (c.children ? files(c, `${prefix}${c.name}_`) : [{ name: prefix + c.name, data: c.data }]));
  if (subdirs.length) {
    const s = newSession(tree.name);
    for (const d of subdirs) s.sectors.push({ ...newSector(d.name), files: files(d).map((f) => newFile(f.name, f.data)) });
    const loose = tree.children.filter((c) => !c.children);
    if (loose.length) s.sectors.push({ ...newSector('General', 'public'), files: loose.map((f) => newFile(f.name, f.data)) });
    state.doc.sessions.push(s);
    state.si = state.doc.sessions.length - 1;
    state.focus = 0;
    state.open = false;
    toast(t('ops.sessionAdded', { name: s.name, n: t('count.sectors', { n: s.sectors.length }) }));
  } else {
    if (!writableSession()) return;
    session().sectors.push({ ...newSector(tree.name), files: files(tree).map((f) => newFile(f.name, f.data)) });
    state.focus = session().sectors.length - 1;
    state.open = true;
    toast(t('ops.sectorAdded', { name: tree.name }));
  }
  state.preview = -1;
  markDirty();
  renderAll();
}

async function addSession() {
  if (!state.doc) return newArchive();
  const v = await ask(t('ops.newSession'), [{ name: 'name', label: t('common.name'), value: `Session_${String(state.doc.sessions.length + 1).padStart(2, '0')}` }]);
  if (!v?.name) return;
  state.doc.sessions.push(newSession(v.name.trim()));
  state.si = state.doc.sessions.length - 1;
  state.focus = 0;
  state.open = false;
  markDirty();
  renderAll();
}
async function editSession() {
  const s = session();
  if (!s) return;
  const v = await ask(t('ops.editSession'), [{ name: 'name', label: t('common.name'), value: s.name }, { name: 'code', label: t('ops.code'), value: s.code }]);
  if (!v) return;
  s.name = v.name.trim() || s.name;
  s.code = v.code.trim() || s.code;
  markDirty();
  renderSessions();
  renderStack();
}
function deleteSession() {
  const s = rawSession();
  const what = s?.locked ? t('ops.delSessionLocked') : t('ops.delSessionNamed', { name: s?.name });
  if (!s || !confirm(t('ops.delSessionConfirm', { what }))) return;
  if (!s.locked) s.sectors.forEach((x) => x.files.forEach(dropUrl));
  state.doc.sessions.splice(state.si, 1);
  state.si = Math.max(0, state.si - 1);
  state.focus = 0;
  state.open = false;
  state.preview = -1;
  markDirty();
  renderAll();
}
async function addSector() {
  if (!state.doc) return newArchive();
  if (!writableSession()) return;
  const v = await ask(t('ops.newSector'), [
    { name: 'name', label: t('common.name'), value: `SECTOR_${String(session().sectors.length + 1).padStart(3, '0')}` },
    { name: 'level', label: t('ops.level'), value: 'confidential', options: levelOptions() },
  ]);
  if (!v?.name) return;
  session().sectors.push(newSector(v.name.trim(), v.level));
  state.focus = session().sectors.length - 1;
  state.open = true;
  markDirty();
  renderAll();
}
async function editSector() {
  const sec = sector();
  if (!sec) return;
  if (sec.locked) return toast(t('ops.editLockedSector'), 'error');
  const v = await ask(t('ops.editSector'), [
    { name: 'name', label: t('common.name'), value: sec.name },
    { name: 'level', label: t('ops.level'), value: sec.level, options: levelOptions() },
    { name: 'color', label: t('ops.color'), value: sec.color, type: 'color' },
  ]);
  if (!v) return;
  if (v.level !== sec.level && v.color === sec.color) v.color = LEVELS[v.level].color;
  Object.assign(sec, { name: v.name.trim() || sec.name, level: v.level, color: v.color });
  markDirty();
  renderStack();
  renderFiles();
}
function deleteSector() {
  const sec = sector();
  if (!sec) return;
  const what = sec.locked ? t('ops.delSectorLocked', { level: levelLabel(sec) }) : t('ops.delSectorNamed', { name: sec.name, files: t('count.files', { n: sec.files.length }) });
  if (!confirm(t('ops.delConfirm', { what }))) return;
  if (!sec.locked) sec.files.forEach(dropUrl);
  session().sectors.splice(state.focus, 1);
  state.focus = Math.max(0, state.focus - 1);
  state.open = false;
  state.preview = -1;
  markDirty();
  renderAll();
}
async function renameFile() {
  const f = sector()?.files?.[state.preview];
  if (!f) return;
  const v = await ask(t('ops.renameFile'), [{ name: 'name', label: t('common.name'), value: f.name }]);
  if (!v?.name) return;
  f.name = v.name.trim();
  markDirty();
  renderFiles();
  renderPreview();
}
function deleteFile() {
  const sec = sector();
  const f = sec?.files?.[state.preview];
  if (!f || !confirm(t('ops.delFile', { name: f.name }))) return;
  dropUrl(f);
  sec.files.splice(state.preview, 1);
  state.preview = sec.files.length ? Math.min(state.preview, sec.files.length - 1) : -1;
  markDirty();
  renderSessions();
  renderStack();
  renderFiles();
  renderPreview();
}
async function exportFile() {
  const f = sector()?.files?.[state.preview];
  if (!f) return;
  const r = await host.exportFile({ name: f.name, data: f.bytes });
  if (r) toast(t('ops.exported', { path: typeof r === 'string' ? r : f.name }));
}

// ---------- Passwords and access ----------
const MIN_BITS = 70;
const label = (id) => unitLabel(state.doc, id);

// --- Security preferences (per computer) ---
const SEC_KEY = 'mpage.security.v1';
const secPrefs = { autoLockMin: 5, lockOnHide: false, shuffleKeys: true, keyboard: false };
try {
  Object.assign(secPrefs, JSON.parse(localStorage.getItem(SEC_KEY) || '{}'));
} catch { /* defaults */ }
const saveSecPrefs = () => {
  try {
    localStorage.setItem(SEC_KEY, JSON.stringify(secPrefs));
  } catch { /* this session only */ }
};

// --- Attempt throttling ---
// The wait grows after consecutive failures. This only guards the UI; the real protection is a strong
// password plus Argon2id (offline guessing still costs 64 MB and ~0.3 s per attempt).
const THROTTLE_KEY = 'mpage.throttle.v1';
function throttleState() {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{}')[state.doc?.id] || { fails: 0, until: 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}
function setThrottle(t) {
  try {
    const all = JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{}');
    if (t.fails) all[state.doc.id] = t;
    else delete all[state.doc.id];
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: throttle applies to this window only */ }
}
const delayAfter = (fails) => (fails < 3 ? 0 : Math.min(300, 5 * 2 ** (fails - 3)) * 1000);

let throttleTimer = null;
function renderThrottle() {
  clearInterval(throttleTimer);
  const tick = () => {
    const th = throttleState();
    const left = Math.ceil((th.until - Date.now()) / 1000);
    const blocked = left > 0;
    $('#unlock-go').disabled = blocked || unlocking;
    $('#unlock-wait').innerHTML = blocked
      ? `${icon('clock', 'xs')}${esc(t('lock.wait', { n: th.fails, s: left }))}`
      : th.fails ? esc(t('lock.attempts', { n: th.fails })) : '';
    if (!blocked) clearInterval(throttleTimer);
  };
  tick();
  throttleTimer = setInterval(tick, 500);
}

// --- Unlocking ---
let unlocking = false;
async function unlockWith(password) {
  if (!password || unlocking) return;
  if (throttleState().until > Date.now()) {
    $('#unlock-pw').value = '';
    $('#unlock-count').textContent = '';
    return renderThrottle();
  }
  const btn = $('#unlock-go');
  unlocking = true;
  btn.disabled = true;
  $('#unlock-go-text').textContent = t('lock.computing');
  try {
    const keepS = rawSession()?.id;
    const keepSec = rawSession()?.locked ? null : sector()?.id;
    const r = await unlock(state.doc, password);
    setThrottle({ fails: 0, until: 0 });
    state.si = Math.max(0, state.doc.sessions.findIndex((s) => s.id === keepS));
    const fi = keepSec ? session()?.sectors.findIndex((x) => x.id === keepSec) : -1;
    if (fi >= 0) state.focus = fi;
    hideKeyboard();
    renderAll();
    toast(r.already ? t('sec.already') : t('sec.unlocked', { list: r.units.join(', ') }) + (r.recovery ? t('sec.recoveryNote') : ''));
    if (r.warnings.length) toast(r.warnings.join('; '), 'error');
    touch();
  } catch (e) {
    if (e.code === 'wrongPassword') {
      const th = throttleState();
      th.fails++;
      th.until = Date.now() + delayAfter(th.fails);
      setThrottle(th);
    }
    const card = $('#locked .card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    toast(e.message, 'error');
  } finally {
    unlocking = false;
    $('#unlock-go-text').textContent = t('lock.unlock');
    $('#unlock-pw').value = '';
    $('#unlock-count').textContent = '';
    renderThrottle();
  }
}

async function lockEverything(reason) {
  if (!state.doc || !hasOpenSecrets()) return;
  // Do not lose an open edit: apply it to the file first, then encrypt everything.
  if (state.edit) await commitEdit(false, true);
  await lockAll(state.doc);
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  waveCache.clear();
  state.preview = -1;
  ['#access', '#pw-dialog', '#recovery'].forEach((id) => ($(id).hidden = true));
  renderAll();
  toast(reason || t('sec.locked'));
}

// --- Auto-lock ---
let lastActivity = Date.now();
const touch = () => (lastActivity = Date.now());
['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, touch, { passive: true }));
setInterval(() => {
  const min = Number(secPrefs.autoLockMin);
  if (min > 0 && hasOpenSecrets() && Date.now() - lastActivity > min * 60000) {
    lockEverything(t('sec.autoLocked', { n: min }));
  }
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && secPrefs.lockOnHide && hasOpenSecrets()) lockEverything(t('sec.hiddenLocked'));
});

// --- Access manager dialog ---
function renderAccess() {
  const { known, hidden } = accessSummary(state.doc);
  const prot = [];
  for (const s of state.doc.sessions) {
    if (s.locked) continue;
    if (s.dek) prot.push(s.id);
    for (const sec of s.sectors) if (sec.dek && !sec.locked) prot.push(sec.id);
  }
  let pwN = 0;
  const T = (k, p) => esc(t(k, p));
  $('#access-body').innerHTML = `
    <h4>${T('access.openedHere')}</h4>
    ${known.length ? known.map((k, i) => `<div class="acc-row">
        <span class="key">${k.kind === 'recovery' ? `${icon('lifebuoy')}${T('access.recovery')}` : `${icon('key')}${T('access.password', { n: ++pwN })}`}</span>
        <span class="grants">${k.ids.map((id) => `<em>${esc(label(id))}</em>`).join(' ') || `<small>${T('access.nothing')}</small>`}</span>
        <span class="acts">${k.kind === 'recovery' ? '' : `<button data-chg="${i}">${T('access.change')}</button>`}<button data-rm="${i}">${T('access.remove')}</button></span></div>`).join('')
      : `<p class="muted">${T('access.noneYet')}</p>`}
    ${hidden ? `<p class="muted">${T('access.hidden', { n: hidden })}</p>` : ''}
    <h4>${T('access.protectedOpen')}</h4>
    ${prot.length ? prot.map((id) => `<div class="acc-row"><span>${icon('unlock')}</span><span>${esc(label(id))}</span>
        <span class="acts"><button data-unprot="${id}">${T('access.unprotect')}</button></span></div>`).join('') : `<p class="muted">${T('common.none')}</p>`}
    <h4>${T('access.thisPc')}</h4>
    <div class="acc-prefs">
      <label>${T('access.autoLock')}
        <select id="pref-autolock">${[0, 1, 5, 15, 30]
          .map((v) => `<option value="${v}" ${Number(secPrefs.autoLockMin) === v ? 'selected' : ''}>${v ? T('access.minutes', { n: v }) : T('access.off')}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="pref-hide" ${secPrefs.lockOnHide ? 'checked' : ''}> ${T('access.lockOnHide')}</label>
      <label class="chk"><input type="checkbox" id="pref-shuffle" ${secPrefs.shuffleKeys ? 'checked' : ''}> ${T('access.shuffle')}</label>
    </div>`;

  const body = $('#access-body');
  body.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
    const k = known[Number(b.dataset.rm)];
    // Removing this slot may permanently lock units that only it can open.
    const orphan = k.ids.filter((id) => !known.some((o) => o !== k && o.ids.includes(id)));
    const warn = orphan.length
      ? t('sec.orphan', { list: orphan.map(label).join(', ') }) + (hidden ? t('sec.orphanHidden') : t('sec.orphanNone'))
      : '';
    if (!confirm(t('sec.removeConfirm', { what: t(k.kind === 'recovery' ? 'sec.word.recovery' : 'sec.word.password'), warn }))) return;
    removePassword(state.doc, k.slot);
    markDirty();
    renderAccess();
    renderSessions();
  }));
  body.querySelectorAll('[data-chg]').forEach((b) => (b.onclick = () => passwordDialog({ mode: 'change', slot: known[Number(b.dataset.chg)].slot })));
  body.querySelectorAll('[data-unprot]').forEach((b) => (b.onclick = () => {
    if (!confirm(t('sec.unprotectConfirm', { name: label(b.dataset.unprot) }))) return;
    unprotect(state.doc, b.dataset.unprot);
    markDirty();
    renderAccess();
    renderSessions();
    renderStack();
  }));
  $('#pref-autolock').onchange = (e) => {
    secPrefs.autoLockMin = Number(e.target.value);
    saveSecPrefs();
  };
  $('#pref-hide').onchange = (e) => {
    secPrefs.lockOnHide = e.target.checked;
    saveSecPrefs();
  };
  $('#pref-shuffle').onchange = (e) => {
    secPrefs.shuffleKeys = e.target.checked;
    saveSecPrefs();
  };
}

function openAccess() {
  if (!state.doc) return toast(t('sec.openFirst'), 'error');
  renderAccess();
  $('#access').hidden = false;
}

function strengthText(bits) {
  if (!bits) return ['', 0];
  if (bits < 50) return [t('pw.veryWeak', { b: bits }), 0.15];
  if (bits < MIN_BITS) return [t('pw.weak', { b: bits, min: MIN_BITS }), 0.4];
  if (bits < 90) return [t('pw.strong', { b: bits }), 0.75];
  return [t('pw.veryStrong', { b: bits }), 1];
}

// --- Password dialog: new password or change an existing one ---
let pwMode = { mode: 'new' };
function passwordDialog(mode = { mode: 'new' }) {
  pwMode = mode;
  const isNew = mode.mode === 'new';
  if (isNew) {
    const tree = state.doc.sessions.filter((s) => !s.locked);
    if (!tree.length) return toast(t('sec.noOpenSession'), 'error');
    const preS = session()?.id;
    const preSec = state.open && sector() && !sector().locked ? sector().id : null;
    $('#pw-sessions').innerHTML = tree.map((s) => `
      <label class="chk"><input type="checkbox" value="${s.id}" ${!preSec && s.id === preS ? 'checked' : ''}>${icon(s.dek ? 'unlock' : 'server', 'xs')} <b>${esc(s.name)}</b> <small>— ${esc(t('pw.wholeSession'))}</small></label>
      ${s.sectors.filter((x) => !x.locked).map((x) => `<label class="chk sub"><input type="checkbox" value="${x.id}" ${x.id === preSec ? 'checked' : ''}>
        ${icon(x.dek ? 'unlock' : 'layers', 'xs')} ${esc(x.name)} <i class="lvl" style="background:${x.color}">${esc(levelLabel(x))}</i></label>`).join('')}`).join('');
  }
  $('#pw-title').textContent = isNew ? t('pw.titleNew') : t('pw.titleChange');
  $('#pw-grants').hidden = !isNew;
  $('#pw-save').textContent = isNew ? t('pw.add') : t('pw.change');
  $('#pw-1').value = '';
  $('#pw-2').value = '';
  $('#pw-1').type = $('#pw-2').type = 'password';
  updateStrength();
  $('#pw-dialog').hidden = false;
  $('#pw-1').focus();
}

function updateStrength() {
  const pw = $('#pw-1').value;
  const [text, frac] = strengthText(passwordBits(pw));
  $('#pw-strength i').style.width = `${frac * 100}%`;
  $('#pw-strength i').style.background = frac >= 0.75 ? '#16a34a' : frac >= 0.4 ? '#f59e0b' : '#dc2626';
  $('#pw-strength-text').textContent = text;
  const match = !$('#pw-2').value || $('#pw-2').value === pw;
  $('#pw-match').textContent = match ? '' : t('sec.mismatch');
}

async function submitPassword(e) {
  e.preventDefault();
  const pw = $('#pw-1').value;
  const ids = [...$('#pw-sessions').querySelectorAll('input:checked')].map((i) => i.value);
  const btn = $('#pw-save');
  const btnText = btn.textContent;
  try {
    if (pw !== $('#pw-2').value) throw new Error(t('sec.mismatch'));
    checkPasswordStrength(pw);
    if (pwMode.mode === 'new' && !ids.length) throw new Error(t('sec.pickOne'));
    btn.disabled = true;
    btn.textContent = t('lock.computing');
    if (pwMode.mode === 'new') await addPassword(state.doc, pw, ids);
    else await changePassword(state.doc, pwMode.slot, pw);
    $('#pw-dialog').hidden = true;
    markDirty();
    renderSessions();
    renderStack();
    if (!$('#access').hidden) renderAccess();
    toast(pwMode.mode === 'new' ? t('sec.pwAdded', { list: ids.map(label).join(', ') }) : t('sec.pwChanged'));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = btnText;
  }
}

// --- Recovery key ---
async function createRecoveryKey() {
  try {
    const { code } = await addRecoveryKey(state.doc);
    markDirty();
    $('#recovery-code').textContent = code;
    $('#recovery-ack').checked = false;
    $('#recovery-done').disabled = true;
    $('#recovery').hidden = false;
    renderAccess();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- On-screen keyboard (type a password by pinching or with the mouse) ---
const KB_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_.@'];
const KB_SHIFT = { 1: '!', 2: '#', 3: '$', 4: '%', 5: '&', 6: '*', 7: '(', 8: ')', 9: '+', 0: '=', '-': '?', _: ':', '.': ',', '@': '/' };
let kbShift = false;
const keyboardWanted = () => secPrefs.keyboard;

function shuffled(chars) {
  const a = [...chars];
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildKeyboard() {
  // Shuffling: an onlooker (or a camera) cannot tell which character was pressed from hand movement.
  let chars = KB_ROWS.join('').split('');
  if (secPrefs.shuffleKeys) chars = shuffled(chars);
  const rows = [];
  for (let i = 0, r = 0; r < KB_ROWS.length; i += KB_ROWS[r].length, r++) rows.push(chars.slice(i, i + KB_ROWS[r].length));
  const show = (c) => (kbShift ? KB_SHIFT[c] || c.toUpperCase() : c);
  $('#vkbd').innerHTML = rows.map((row) => `<div class="vk-row">${row.map((c) => `<button type="button" class="vk" data-c="${esc(c)}">${esc(show(c))}</button>`).join('')}</div>`).join('') + `
    <div class="vk-row">
      <button type="button" class="vk wide ${kbShift ? 'on' : ''}" data-act="shift">${icon('shift')}<span>${esc(t('kb.shift'))}</span></button>
      <button type="button" class="vk wide" data-act="space">${esc(t('kb.space'))}</button>
      <button type="button" class="vk" data-act="shuffle" title="${esc(t('kb.shuffle'))}">${icon('shuffle')}</button>
      <button type="button" class="vk" data-act="back" title="${esc(t('kb.back'))}">${icon('backspace')}</button>
      <button type="button" class="vk wide ok" data-act="ok">${icon('check')}<span>${esc(t('lock.unlock'))}</span></button>
    </div>`;
}

function showKeyboard() {
  kbShift = false;
  buildKeyboard();
  $('#vkbd').hidden = false;
  $('#btn-kbd').classList.add('on');
}
function hideKeyboard() {
  $('#vkbd').hidden = true;
  $('#btn-kbd').classList.remove('on');
}

$('#vkbd').addEventListener('click', (e) => {
  const b = e.target.closest('button.vk');
  if (!b) return;
  const pw = $('#unlock-pw');
  if (b.dataset.c) {
    const c = b.dataset.c;
    pw.value += kbShift ? KB_SHIFT[c] || c.toUpperCase() : c;
    if (kbShift) {
      kbShift = false;
      buildKeyboard();
    } else if (secPrefs.shuffleKeys) buildKeyboard();
  } else if (b.dataset.act === 'shift') {
    kbShift = !kbShift;
    buildKeyboard();
  } else if (b.dataset.act === 'space') pw.value += ' ';
  else if (b.dataset.act === 'back') pw.value = pw.value.slice(0, -1);
  else if (b.dataset.act === 'shuffle') {
    secPrefs.shuffleKeys = true;
    saveSecPrefs();
    buildKeyboard();
  } else if (b.dataset.act === 'ok') unlockWith(pw.value);
  $('#unlock-count').textContent = pw.value ? t('count.chars', { n: pw.value.length }) : '';
});
$('#unlock-pw').addEventListener('input', () => ($('#unlock-count').textContent = ''));

// --- Buttons ---
$('#unlock-form').onsubmit = (e) => {
  e.preventDefault();
  unlockWith($('#unlock-pw').value);
};
on('#btn-kbd', () => {
  secPrefs.keyboard = $('#vkbd').hidden;
  saveSecPrefs();
  if ($('#vkbd').hidden) showKeyboard();
  else hideKeyboard();
});
on('#btn-access', openAccess);
on('#btn-lock', () => lockEverything());
on('#access-close', () => ($('#access').hidden = true));
on('#access-new', () => passwordDialog({ mode: 'new' }));
on('#access-recovery', createRecoveryKey);
on('#access-lock', () => lockEverything());
on('#pw-cancel', () => ($('#pw-dialog').hidden = true));
on('#pw-gen', () => {
  const p = generatePassword();
  $('#pw-1').value = $('#pw-2').value = p;
  $('#pw-1').type = $('#pw-2').type = 'text';
  updateStrength();
  toast(t('sec.generated'));
});
on('#pw-show', () => ($('#pw-1').type = $('#pw-2').type = $('#pw-1').type === 'password' ? 'text' : 'password'));
$('#pw-1').oninput = updateStrength;
$('#pw-2').oninput = updateStrength;
$('#pw-form').onsubmit = submitPassword;
on('#recovery-copy', async () => {
  try {
    await navigator.clipboard.writeText($('#recovery-code').textContent);
    toast(t('rec.copied'));
  } catch {
    toast(t('rec.copyFail'), 'error');
  }
});
$('#recovery-ack').onchange = (e) => ($('#recovery-done').disabled = !e.target.checked);
on('#recovery-done', () => {
  $('#recovery-code').textContent = '';
  $('#recovery').hidden = true;
  toast(t('rec.added'));
});

// ---------- Mouse / keyboard ----------
$('#session-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-si]');
  if (li) selectSession(Number(li.dataset.si));
});
$('#session-list').addEventListener('dblclick', (e) => e.target.closest('li[data-si]') && editSession());
$('#file-grid').addEventListener('click', (e) => {
  const p = e.target.closest('.paper');
  if (p) openFile(Number(p.dataset.fi));
});

function stackClick(x, y) {
  const i = stack.pick(x, y);
  if (i < 0) return false;
  if (state.open && i === state.focus) closeSector();
  else openSector(i);
  return true;
}
let drag = null;
$('#stack').addEventListener('pointerdown', (e) => (drag = { x: e.clientX, moved: 0 }));
addEventListener('pointermove', (e) => {
  if (drag) {
    drag.moved += Math.abs(e.clientX - drag.x);
    stack.yaw += (e.clientX - drag.x) * 0.004;
    drag.x = e.clientX;
  } else if (e.target === $('#stack')) {
    stack.hover = stack.pick(e.clientX, e.clientY);
    $('#stack').style.cursor = stack.hover >= 0 ? 'pointer' : 'grab';
  }
});
addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 4 && e.target === $('#stack')) stackClick(e.clientX, e.clientY);
  drag = null;
});
$('#stack').addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) stack.zoom = Math.min(2.5, Math.max(0.5, stack.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
  else focusSector(state.focus + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });
$('#pv-body').addEventListener('wheel', (e) => {
  const img = $('#pv-body img');
  if (!img) return;
  e.preventDefault();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
function setZoom(z) {
  state.zoom = Math.min(8, Math.max(0.3, z));
  const img = $('#pv-body img');
  if (img) img.style.transform = `scale(${state.zoom})`;
}

addEventListener('keydown', (e) => {
  if (!$('#modal').hidden) {
    if (e.key === 'Escape') $('#modal-cancel').click();
    return;
  }
  for (const id of ['#recovery', '#pw-dialog', '#access']) {
    if (!$(id).hidden) {
      // The recovery dialog only closes via "I wrote it down".
      if (e.key === 'Escape' && id !== '#recovery') $(id).hidden = true;
      return;
    }
  }
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'o') { e.preventDefault(); openDialog(); }
    if (k === 's') { e.preventDefault(); state.edit ? commitEdit(true) : save(e.shiftKey); }
    if (k === 'n') { e.preventDefault(); newArchive(); }
    return;
  }
  if (e.target.closest?.('input, textarea, select, video, audio')) return;
  if (!state.doc) return;
  const inPreview = state.preview >= 0;
  switch (e.key) {
    case 'ArrowUp': focusSector(state.focus - 1); break;
    case 'ArrowDown': focusSector(state.focus + 1); break;
    case 'ArrowLeft': inPreview ? openFile(state.preview - 1) : stepSession(-1); break;
    case 'ArrowRight': inPreview ? openFile(state.preview + 1) : stepSession(1); break;
    case 'PageUp': stepSession(-1); break;
    case 'PageDown': stepSession(1); break;
    case 'Enter': if (!state.open) openSector(); else if (!inPreview) openFile(0); break;
    case 'Escape': back(); break;
    case 'Delete': inPreview ? deleteFile() : state.open ? deleteSector() : null; break;
    case 'F2': inPreview ? renameFile() : state.open ? editSector() : editSession(); break;
    case 'e': if (inPreview) startEdit(); else return; break;
    case 'F1': case 'h': $('#help').hidden = !$('#help').hidden; break;
    case 'c': toggleCamera(); break;
    case 'g': toggleCalib(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- Buttons ----------
on('#btn-open', openDialog);
on('#btn-save', () => save(false));
on('#btn-save-as', () => save(true));
on('#btn-new-session', addSession);
on('#btn-edit-session', editSession);
on('#btn-del-session', deleteSession);
on('#btn-new-sector', addSector);
on('#btn-edit-sector', editSector);
on('#btn-del-sector', deleteSector);
on('#btn-add-files', async () => addFiles(await host.pickFiles()));
on('#btn-close-sector', closeSector);
on('#pv-prev', () => openFile(state.preview - 1));
on('#pv-next', () => openFile(state.preview + 1));
on('#pv-close', closePreview);
on('#pv-edit', startEdit);
on('#pv-replace', replaceFile);
on('#btn-new-text', newTextFile);
on('#pv-export', exportFile);
on('#pv-delete', deleteFile);
on('#btn-help', () => ($('#help').hidden = !$('#help').hidden));
on('#help-close', () => ($('#help').hidden = true));
on('#btn-cam', () => toggleCamera());
on('#w-open', openDialog);
on('#w-new', newArchive);
on('#w-example', async () => {
  const p = await host.examplePath();
  if (p) openPath(p);
  else toast(t('ops.exampleMissing'), 'error');
});

// Drag & drop
addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
addEventListener('dragleave', (e) => !e.relatedTarget && document.body.classList.remove('dragging'));
addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const loose = [];
  for (const file of e.dataTransfer.files) {
    const p = host.pathForFile(file);
    if (/\.mpage$/i.test(file.name)) {
      await openBytes(new Uint8Array(await file.arrayBuffer()), p);
      return;
    }
    const tree = p ? await host.readFolder(p) : null;
    if (tree) importFolder(tree);
    else if (file.size || file.type) loose.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  }
  if (loose.length) {
    if (!state.doc) await newArchive();
    // dropped on a session: goes into that session's focused sector
    const li = e.target.closest?.('li[data-si]');
    if (li) selectSession(Number(li.dataset.si));
    addFiles(loose);
  }
});
addEventListener('beforeunload', (e) => state.dirty && e.preventDefault());

// ---------- Hand control ----------
const tracker = new HandTracker($('#cam-video'), $('#cam-overlay'));
const cursors = { Left: $('#cursor-left'), Right: $('#cursor-right') };
const hs = { Left: {}, Right: {} };   // per-hand gesture state
let twoHand = null;
let swipeCooldown = 0;
let hoverEl = null;

async function toggleCamera() {
  if (tracker.running) {
    tracker.stop();
    $('#cam').hidden = true;
    $('#btn-cam').classList.remove('on');
    Object.values(cursors).forEach((c) => (c.hidden = true));
    $('#gesture').textContent = '';
    setHover(null);
    return;
  }
  $('#cam').hidden = false;
  $('#cam-status').textContent = t('hand.loading');
  try {
    await tracker.start();
    $('#cam-status').textContent = '';
    $('#btn-cam').classList.add('on');
    toast(t('hand.on'));
  } catch (e) {
    $('#cam').hidden = true;
    toast(t('hand.fail', { msg: e.message }), 'error');
  }
}

function setHover(el) {
  if (hoverEl === el) return;
  hoverEl?.classList.remove('hand-hover');
  hoverEl = el;
  hoverEl?.classList.add('hand-hover');
}

/** Clickable element (or stack card) at a screen point. */
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el === $('#stack')) return { stack: stack.pick(x, y), el };
  return { el: el.closest('button, li[data-si], .paper, select, input, video, audio') || el };
}

function handClick(x, y) {
  const t = targetAt(x, y);
  if (!t) return;
  if (t.stack !== undefined) stackClick(x, y);
  else if (t.el.matches('video, audio')) t.el.paused ? t.el.play() : t.el.pause();
  else t.el.click();
}

function scrollableAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('[data-scroll], .text-view, .csv-wrap, #ed-text');
}

function swipe(dir) {
  const inPreview = state.preview >= 0;
  if (dir === 'up') focusSector(state.focus + 1);
  if (dir === 'down') focusSector(state.focus - 1);
  if (dir === 'left') inPreview ? openFile(state.preview + 1) : stepSession(1);
  if (dir === 'right') inPreview ? openFile(state.preview - 1) : stepSession(-1);
  const arrow = { up: 'arrowUp', down: 'arrowDown', left: 'arrowLeft', right: 'arrowRight' }[dir];
  $('#gesture').innerHTML = `${icon(arrow, 'xs')}${esc(t(`hand.swipe.${dir}`))}`;
}

const GESTURE_ICON = { open: 'hand', pinch: 'pinch', fist: 'back', point: 'pointer' };
/** Gesture name as plain text. */
const gestureName = (g) => (GESTURE_ICON[g] ? t(`hand.${g}`) : '');
const gestureHTML = (g) => (GESTURE_ICON[g] ? `${icon(GESTURE_ICON[g], 'xs')}${esc(gestureName(g))}` : '');

function handLoop(now) {
  const hands = tracker.update();
  if (hands.length) touch(); // hand movement counts as activity for auto-lock
  for (const label of ['Left', 'Right']) {
    const h = tracker.hands[label];
    const s = hs[label];
    const el = cursors[label];
    if (!hands.includes(h)) {
      el.hidden = true;
      hs[label] = {};
      continue;
    }
    const x = h.x * innerWidth, y = h.y * innerHeight;
    el.hidden = false;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.g = h.gesture;
    if (twoHand) continue;

    // Highlight the element under the cursor
    if (h === hands[0]) {
      const t = targetAt(x, y);
      if (t?.stack !== undefined) {
        stack.hover = t.stack;
        setHover(null);
      } else {
        stack.hover = -1;
        setHover(t?.el?.matches('button, li[data-si], .paper') ? t.el : null);
      }
    }

    // Pinch: short = click; hold and drag = scroll, or rotate the stack
    if (h.gesture === 'pinch') {
      if (!s.pinch) s.pinch = { t: now, x, y, lx: x, ly: y, moved: 0, scroll: scrollableAt(x, y), onStack: document.elementFromPoint(x, y) === $('#stack') };
      const p = s.pinch;
      p.moved += Math.hypot(x - p.lx, y - p.ly);
      if (p.moved > G.clickMove) {
        if (p.scroll) p.scroll.scrollTop -= (y - p.ly) * 2.2;
        else if (p.onStack) stack.yaw += (x - p.lx) * 0.006;
      }
      p.lx = x;
      p.ly = y;
    } else if (s.pinch) {
      const ms = Math.round(now - s.pinch.t), moved = Math.round(s.pinch.moved);
      if (moved < G.clickMove && ms < G.clickMs) {
        handClick(s.pinch.x, s.pinch.y);
        logGesture(t('log.click', { ms, px: moved }));
      } else logGesture(moved >= G.clickMove ? t('log.noClickMove', { px: moved }) : t('log.noClickLong', { ms }));
      s.pinch = null;
    }

    // Palm swipe: a large movement within a short time window
    if (h.gesture === 'open') {
      s.trail = (s.trail || []).filter((p) => now - p.t < G.swipeMs);
      s.trail.push({ t: now, x: h.x, y: h.y });
      const a = s.trail[0];
      const dx = h.x - a.x, dy = h.y - a.y;
      if (h === hands[0]) calib.swipe = { dx, dy };
      if (now > swipeCooldown && (Math.abs(dx) > G.swipeX || Math.abs(dy) > G.swipeY)) {
        const dir = Math.abs(dx) / G.swipeX > Math.abs(dy) / G.swipeY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        swipe(dir);
        logGesture(t('log.swipe', { dir }));
        swipeCooldown = now + G.swipeCooldown;
        s.trail = [];
      }
    } else {
      s.trail = [];
      if (h === hands[0]) calib.swipe = { dx: 0, dy: 0 };
    }

    // Fist held: back
    if (h.gesture === 'fist') {
      s.fist ||= now;
      if (!s.fistDone && now - s.fist > G.fistMs) {
        back();
        logGesture(t('log.back'));
        s.fistDone = true;
      }
    } else s.fist = s.fistDone = 0;
  }
  calib.hand = hands[0] || null;

  // Two-hand pinch: zoom (image or stack)
  const pinching = hands.filter((h) => h.gesture === 'pinch');
  if (pinching.length === 2) {
    const d = Math.hypot(pinching[0].x - pinching[1].x, pinching[0].y - pinching[1].y);
    if (!twoHand) {
      twoHand = { d0: d, z0: state.preview >= 0 ? state.zoom : stack.zoom };
      hs.Left = {};
      hs.Right = {};
    }
    const z = twoHand.z0 * (d / twoHand.d0);
    if (state.preview >= 0) setZoom(z);
    else stack.zoom = Math.min(2.5, Math.max(0.5, z));
  } else if (twoHand && pinching.length === 0) twoHand = null;

  if (now > swipeCooldown - G.swipeCooldown / 2) {
    $('#gesture').innerHTML = twoHand ? `${icon('pinch', 'xs')}${esc(t('hand.scale'))}`
      : hands[0] ? gestureHTML(hands[0].gesture) : esc(t('hand.missing'));
  }
  if (!$('#calib').hidden) renderCalibLive();
}

// ---------- Gesture tuning panel ----------
const calib = { hand: null, swipe: { dx: 0, dy: 0 }, log: [] };

function logGesture(text) {
  calib.log.unshift(`${new Date().toLocaleTimeString()}  ${text}`);
  calib.log.length = Math.min(calib.log.length, 8);
  if (!$('#calib').hidden) $('#calib-log').textContent = calib.log.join('\n');
}

function buildCalib() {
  $('#calib-params').innerHTML = GESTURE_PARAMS.map((p) => `<label><span>${esc(t(`g.${p.key}`))}</span>
    <input type="range" data-k="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${G[p.key]}">
    <output data-o="${p.key}">${G[p.key]}</output></label>`).join('');
  $('#calib-params').oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    G[k] = Number(e.target.value);
    $(`#calib-params output[data-o="${k}"]`).textContent = G[k];
    saveGestureConfig();
    renderCalibLive();
  };
  $('#calib-log').textContent = calib.log.join('\n');
}

/** Live meters: the marker on each bar is the threshold. */
function meter(id, value, max, marks) {
  const el = $(id);
  el.querySelector('i').style.width = `${Math.min(100, (Math.abs(value) / max) * 100)}%`;
  el.querySelectorAll('b').forEach((b, idx) => (b.style.left = `${Math.min(100, (marks[idx] / max) * 100)}%`));
}

function renderCalibLive() {
  const h = calib.hand;
  $('#cv-gesture').textContent = h ? `${gestureName(h.gesture) || h.gesture} · ${t(h.label === 'Right' ? 'hand.right' : 'hand.left')}` : t('hand.missing');
  $('#cv-pinch').textContent = h ? h.pinchRatio.toFixed(2) : '–';
  $('#cv-fingers').textContent = h ? `${h.fingers} / 4` : '–';
  $('#cv-swipe').textContent = `${calib.swipe.dx.toFixed(2)} / ${calib.swipe.dy.toFixed(2)}`;
  meter('#m-pinch', h ? h.pinchRatio : 0, 1, [G.pinchOn, G.pinchOff]);
  meter('#m-swipe-x', calib.swipe.dx, 0.5, [G.swipeX]);
  meter('#m-swipe-y', calib.swipe.dy, 0.5, [G.swipeY]);
}

function toggleCalib(show = $('#calib').hidden) {
  $('#calib').hidden = !show;
  $('#btn-calib').classList.toggle('on', show);
  if (show) {
    buildCalib();
    if (!tracker.running) toggleCamera();
  }
}
on('#btn-calib', () => toggleCalib());
on('#calib-close', () => toggleCalib(false));
on('#calib-reset', () => {
  resetGestureConfig();
  buildCalib();
  toast(t('calib.resetDone'));
});
on('#calib-copy', async () => {
  const text = JSON.stringify(G);
  try {
    await navigator.clipboard.writeText(text);
    toast(t('calib.copied'));
  } catch {
    toast(text);
  }
});

// ---------- Language ----------
const LANG_KEY = 'mpage.lang';

/** Applies the current language to static text (data-i18n attributes). */
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.documentElement.lang = getLang();
  host.setLanguage?.(getLang());
  document.querySelectorAll('[data-lang-switch] button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
}

function switchLanguage(lang) {
  setLang(lang);
  try {
    localStorage.setItem(LANG_KEY, getLang());
  } catch { /* this session only */ }
  applyI18n();
  // Re-render dynamic parts too (including 3D card textures).
  renderAll();
  if (!$('#access').hidden) renderAccess();
  if (!$('#calib').hidden) buildCalib();
  if (!$('#vkbd').hidden) buildKeyboard();
  if (!$('#pw-dialog').hidden) {
    $('#pw-title').textContent = pwMode.mode === 'new' ? t('pw.titleNew') : t('pw.titleChange');
    $('#pw-save').textContent = pwMode.mode === 'new' ? t('pw.add') : t('pw.change');
    updateStrength();
  }
}

function initLanguage() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch { /* not available */ }
  setLang(detect(saved, navigator.language, ...(navigator.languages || [])));
  document.querySelectorAll('[data-lang-switch]').forEach((box) => {
    box.innerHTML = `${icon('globe')}${LANGS.map((l) => `<button type="button" data-lang="${l}">${l.toUpperCase()}</button>`).join('')}`;
    box.onclick = (e) => {
      const b = e.target.closest('button[data-lang]');
      if (b) switchLanguage(b.dataset.lang);
    };
  });
  applyIcons();
  applyI18n();
}

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (tracker.running) handLoop(now);
  stack.tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

host.onOpenFile((p) => openPath(p));
initLanguage();
renderAll();
