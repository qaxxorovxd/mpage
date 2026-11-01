'use strict';
// Bundles the MediaPipe hand-tracking model and WASM files into the app (so it works offline).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'app', 'renderer', 'vendor');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL = path.join(VENDOR, 'models', 'hand_landmarker.task');

async function main() {
  const wasmSrc = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const wasmDst = path.join(VENDOR, 'mediapipe', 'wasm');
  // Electron (Chromium) always supports WASM SIMD, so the non-SIMD build is not needed.
  fs.rmSync(wasmDst, { recursive: true, force: true });
  fs.mkdirSync(wasmDst, { recursive: true });
  for (const f of fs.readdirSync(wasmSrc)) {
    if (f.startsWith('vision_wasm_internal')) {
      fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));
    }
  }

  if (fs.existsSync(MODEL) && fs.statSync(MODEL).size > 1e6) {
    console.log('[ok] model already present');
    return;
  }
  fs.mkdirSync(path.dirname(MODEL), { recursive: true });
  console.log(`↓ ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  fs.writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
  console.log(`[ok] model saved (${(fs.statSync(MODEL).size / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
