'use strict';
// Tiny rasterizer plus PNG/ICO/WAV encoders, used to generate sample media
// without external libraries.
const zlib = require('zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * h * 4);
  }

  /** Calls fn(x, y) → [r,g,b,a] (0..1) for every pixel and composites it "over" the canvas. */
  shade(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = fn(x + 0.5, y + 0.5);
        if (!c || c[3] <= 0) continue;
        const i = (y * this.w + x) * 4;
        const a = Math.min(1, c[3]);
        for (let k = 0; k < 3; k++) this.px[i + k] = c[k] * a + this.px[i + k] * (1 - a);
        this.px[i + 3] = a + this.px[i + 3] * (1 - a);
      }
    }
    return this;
  }

  /** Fills where sdf(x, y) < 0 (inside), with anti-aliasing. */
  fill(sdf, color) {
    const col = typeof color === 'function' ? color : () => color;
    return this.shade((x, y) => {
      const d = sdf(x, y);
      const cov = Math.max(0, Math.min(1, 0.5 - d));
      if (cov <= 0) return null;
      const c = col(x, y);
      return [c[0], c[1], c[2], (c[3] ?? 1) * cov];
    });
  }

  toPNG() {
    const { w, h } = this;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      for (let x = 0; x < w * 4; x++) {
        const v = this.px[y * w * 4 + x];
        raw[y * (w * 4 + 1) + 1 + x] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

// --- SDF helpers ---
const sdf = {
  circle: (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r,
  ellipse: (cx, cy, rx, ry) => (x, y) => {
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return (k - 1) * Math.min(rx, ry);
  },
  roundRect: (x0, y0, x1, y1, r) => (x, y) => {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
    const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
  },
  /** Polygon (either winding order). */
  polygon: (pts) => (x, y) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j], [bx, by] = pts[i];
      const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? -d : d;
  },
  union: (...fs) => (x, y) => Math.min(...fs.map((f) => f(x, y))),
  subtract: (a, b) => (x, y) => Math.max(a(x, y), -b(x, y)),
};

const hex = (h, a = 1) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** ICO containing PNG images (Windows Vista+). */
function toICO(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.png)]);
}

/** Mono 16-bit WAV from a Float32Array of samples (-1..1). */
function toWAV(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}

module.exports = { Canvas, sdf, hex, mix, toICO, toWAV };
