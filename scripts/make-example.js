'use strict';
// Sample archive: examples/src/demo/<Session>/<Sector>/<files> → examples/demo.mpage
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Canvas, sdf, hex, mix, toWAV } = require('./lib/raster');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'examples', 'src', 'demo');
const OUT = path.join(ROOT, 'examples', 'demo.mpage');
fs.rmSync(SRC, { recursive: true, force: true });

// ---------- media generators ----------
function maskImage() {
  const S = 640, c = new Canvas(S, S), k = S / 768;
  c.shade((x, y) => [...mix(hex('#312e81'), hex('#020617'), Math.hypot(x - S / 2, y - S / 2) / (S * 0.7)).slice(0, 3), 1]);
  const e = (cx, cy, rx, ry) => sdf.ellipse(cx * k, cy * k, rx * k, ry * k);
  const face = sdf.subtract(sdf.subtract(e(384, 380, 230, 290), sdf.union(e(296, 330, 62, 34), e(472, 330, 62, 34))), e(384, 560, 70, 18));
  c.fill(face, (x, y) => mix(hex('#f472b6'), hex('#7df9ff'), y / S));
  c.fill((x, y) => Math.abs(e(384, 380, 230, 290)(x, y)) - 6 * k, hex('#facc15'));
  return c.toPNG();
}

function landscapeImage() {
  const W = 960, H = 540, c = new Canvas(W, H);
  c.shade((x, y) => [...mix(hex('#0ea5e9'), hex('#f97316'), Math.pow(y / H, 1.4)).slice(0, 3), 1]);
  c.fill(sdf.circle(680, 250, 70), hex('#fde68a'));
  const ridge = (base, amp, f, ph, col) => c.fill((x, y) => base - amp * (0.6 * Math.sin(x * f + ph) + 0.4 * Math.sin(x * f * 2.7 + ph * 2)) - y, col);
  ridge(350, 70, 0.008, 1, hex('#7c3aed'));
  ridge(410, 50, 0.012, 3, hex('#4c1d95'));
  ridge(470, 40, 0.017, 5, hex('#1e1b4b'));
  return c.toPNG();
}

function plasmaImage() {
  const S = 420, c = new Canvas(S, S);
  c.shade((x, y) => {
    const u = x / S, v = y / S;
    const t = (Math.sin(u * 10) + Math.sin(v * 12 + u * 4) + Math.sin(Math.hypot(u - 0.5, v - 0.5) * 22) + 3) / 6;
    return [0.5 + 0.5 * Math.sin(t * 6.28), 0.5 + 0.5 * Math.sin(t * 6.28 + 2.1), 0.5 + 0.5 * Math.sin(t * 6.28 + 4.2), 1];
  });
  return c.toPNG();
}

/** Blueprint-style schematic (blue background, white lines). */
function schematicImage(seed) {
  const W = 900, H = 640, c = new Canvas(W, H);
  c.shade((x, y) => {
    const g = (x % 40 < 1 || y % 40 < 1) ? 0.08 : 0;
    return [0.06 + g, 0.2 + g, 0.42 + g, 1];
  });
  const line = (w) => (f) => (x, y) => Math.abs(f(x, y)) - w;
  const white = [0.92, 0.96, 1, 0.95];
  const cx = 450, cy = 320;
  c.fill(line(2)(sdf.roundRect(cx - 300, cy - 60, cx + 220, cy + 60, 60)), white);
  c.fill(line(2)(sdf.polygon([[cx + 220, cy - 60], [cx + 330, cy], [cx + 220, cy + 60]])), white);
  for (let i = 0; i < 4; i++) {
    const x0 = cx - 280 + i * 30 + seed * 10;
    c.fill(line(2)(sdf.polygon([[x0, cy - 60], [x0 + 40, cy - 150], [x0 + 70, cy - 60]])), white);
  }
  c.fill(line(1.5)(sdf.circle(cx - 40, cy, 36)), white);
  c.fill(line(1.5)(sdf.circle(cx + 90, cy, 22)), white);
  c.fill((x, y) => (Math.abs(y - (cy + 120)) - 1) + (x < cx - 300 || x > cx + 330 ? 99 : 0), white);
  return c.toPNG();
}

function ambientAudio(notes, secs = 6) {
  const rate = 22050, n = rate * secs, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let s = 0;
    notes.forEach((f, k) => (s += Math.sin(2 * Math.PI * f * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.2 * (k + 1) * t))));
    out[i] = (s / notes.length) * 0.5 * Math.min(1, t / 0.4, (secs - t) / 0.4);
  }
  return toWAV(out, rate);
}

/** Minimal text PDF (Helvetica), one or more pages. */
function makePdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?');
  const pages = [];
  for (let i = 0; i < lines.length; i += 40) pages.push(lines.slice(i, i + 40));
  if (!pages.length) pages.push([]);
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add(null), pagesObj = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = [];
  pages.forEach((pl, pi) => {
    let s = `BT /F2 16 Tf 56 790 Td (${esc(title)}) Tj ET\n0.2 w 56 778 m 540 778 l S\nBT /F1 10 Tf 56 756 Td 14 TL\n`;
    for (const l of pl) s += `(${esc(l)}) '\n`;
    s += `ET\nBT /F1 8 Tf 500 30 Td (${pi + 1} / ${pages.length}) Tj ET`;
    const content = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function invoice(no, from, to, items) {
  return makePdf(`INVOICE / ARRIVAL NOTICE  No. ${no}`, [
    `Shipper: ${from}`, `Consignee: ${to}`, `Port of loading: Long Beach        Port of discharge: Karachi`,
    `Departure: 05/19/2026        Arrival: 06/14/2026`, '', 'Contents description:', '',
    ...items.map((it, i) => `  ${String.fromCharCode(65 + i)}.  ${it}`), '',
    'SPECIAL CARGO INSTRUCTIONS', '',
    'All goods are to be handled with care. The carrier shall not be held responsible',
    'for loss or damage arising from improper packing. Release only upon receipt of',
    'the endorsed original bill of lading.', '', 'Payable at: destination',
  ]);
}

// ---------- tree ----------
const lorem = (n) => Array.from({ length: n }, (_, i) => `${i + 1}. Entry: inspection result recorded, status: stable.`).join('\n');

const tree = {
  '456_SPG_425XVC': {
    code: '456_SPG_425XVC',
    sectors: {
      'SECTOR_004': { level: 'confidential', files: {
        '2365_SHIPPING_LS.pdf': invoice('2365', 'ACME Line Shipping LLC', 'Harbor Logistics', ['Surface-to-air units', 'Control command panel', 'Target tracking unit', 'Spare parts kit']),
        'bill_of_lading.pdf': makePdf('ORIGINAL BILL OF LADING  MXZR2867501', ['Containing 412 boxes', 'Weight: 200 kg each', 'Description: machine parts', '', 'Payable at: destination']),
        'manifest.csv': 'id,item,qty,weight_kg\n1,Panel A,12,40\n2,Panel B,8,35\n3,Sensor kit,24,6\n',
      } },
      'SECTOR_017': { level: 'restricted', files: {
        '114_SHIPPING_54.pdf': invoice('114', 'North Cargo', 'Port Authority', ['Generators', 'Cable reels', 'Antenna masts']),
        'route.json': JSON.stringify({ from: 'Long Beach', to: 'Karachi', stops: ['Honolulu', 'Singapore', 'Colombo'] }, null, 2),
      } },
      'SECTOR_022': { level: 'top-secret', files: {
        'RS_SCHEMATIC_03.png': schematicImage(0),
        'RS_SCHEMATIC_04.png': schematicImage(2),
        'notes.md': '# Schematic notes\n\n- Hull: 5.2 m\n- Stabilizers: 4\n- [x] Drawing reviewed\n- [ ] Field test\n\n| Part | Status |\n|---|---|\n| Hull | ok |\n| Fins | pending |\n',
      } },
      'SECTOR_031': { level: 'ultra-secret', files: {
        'PHX_PROTOTYPE_V2.png': schematicImage(4),
        'test_log.txt': lorem(30),
      } },
      'SECTOR_036': { level: 'ultra-secret', files: {
        'MASK.png': maskImage(),
        'signal_A.wav': ambientAudio([220, 277.18, 329.63]),
      } },
      'SECTOR_042': { level: 'secret', files: {
        'SPG_2201_RTX407.pdf': makePdf('SPG 2201 / RTX407', ['Status: active', 'Owner: Operations', '', lorem(12)].join('\n').split('\n')),
        'surveillance.png': landscapeImage(),
      } },
      'SECTOR_050': { level: 'cosmic', files: {
        'INSP6_245_23376.png': plasmaImage(),
        'readme.txt': 'Cosmic sector: access by permission only.\n',
      } },
    },
  },
  'ServerBkp_1923465': { code: '219_BKP_923465', sectors: {
    'BACKUP_01': { level: 'internal', files: { 'backup_report.pdf': makePdf('Backup report', ['Files: 18 245', 'Size: 412 GB', 'Status: OK']), 'checksum.txt': 'sha256 ok\n' } },
    'BACKUP_02': { level: 'internal', files: { 'snapshot.json': JSON.stringify({ snapshot: 2, ok: true }, null, 2) } },
  } },
  'Media_Lab_34': { code: '034_MED_118LAB', sectors: {
    'IMAGES': { level: 'public', files: { 'landscape.png': landscapeImage(), 'plasma.png': plasmaImage(), 'mask.png': maskImage() } },
    'AUDIO': { level: 'public', files: { 'chord_A.wav': ambientAudio([220, 277.18, 329.63, 440]), 'chord_D.wav': ambientAudio([293.66, 369.99, 440]) } },
  } },
  'Archive_2007': { code: '200_ARC_7XKQ01', sectors: {
    'LEGACY': { level: 'confidential', files: { 'archive_index.pdf': makePdf('Archive index 2007', lorem(55).split('\n')) } },
  } },
};

for (const [sName, s] of Object.entries(tree)) {
  const sDir = path.join(SRC, sName);
  fs.mkdirSync(sDir, { recursive: true });
  fs.writeFileSync(path.join(sDir, '_session.json'), JSON.stringify({ code: s.code }));
  for (const [secName, sec] of Object.entries(s.sectors)) {
    const secDir = path.join(sDir, secName);
    fs.mkdirSync(secDir, { recursive: true });
    fs.writeFileSync(path.join(secDir, '_sector.json'), JSON.stringify({ level: sec.level }));
    for (const [fName, data] of Object.entries(sec.files)) fs.writeFileSync(path.join(secDir, fName), data);
  }
}

execFileSync(process.execPath, [path.join(ROOT, 'cli', 'mpage.js'), 'pack', SRC, '-o', OUT], { stdio: 'inherit' });
