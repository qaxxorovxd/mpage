// Webcam + MediaPipe HandLandmarker: tracks hands and classifies gestures.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { gestureConfig as C } from './gesture-config.js';

const WASM_PATH = 'vendor/mediapipe/wasm';
const MODEL_PATH = 'vendor/models/hand_landmarker.task';

// Landmark indices
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9, PINKY_MCP = 17;
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, PIP]

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

class TrackedHand {
  constructor(label) {
    this.label = label;
    this.gesture = 'none';
    this.candidate = 'none';
    this.candidateFrames = 0;
    this.pinching = false;
    this.x = 0.5;
    this.y = 0.5;
    this.palm = 0.1;
    this.roll = 0;
    this.seen = 0;
  }

  update(lm, now) {
    const palm = dist(lm[WRIST], lm[MIDDLE_MCP]);
    // Distances are relative to palm size, so gestures work at any distance from the camera.
    const pinchRatio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm;
    this.pinching = this.pinching ? pinchRatio < Math.max(C.pinchOff, C.pinchOn) : pinchRatio < C.pinchOn;

    const extended = FINGERS.map(([tip, pip]) => dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * C.extendRatio);
    const count = extended.filter(Boolean).length;
    this.pinchRatio = pinchRatio;
    this.fingers = count;

    let g = 'other';
    if (this.pinching) g = 'pinch';
    else if (count >= 4) g = 'open';
    else if (count === 0) g = 'fist';
    else if (extended[0] && count === 1) g = 'point';

    // Pinch is accepted immediately (responsive clicks); other gestures must be stable for a few frames.
    if (g === this.candidate) this.candidateFrames++;
    else {
      this.candidate = g;
      this.candidateFrames = 1;
    }
    if (g === 'pinch' || (this.gesture === 'pinch' && g !== 'pinch') || this.candidateFrames >= C.stableFrames) this.gesture = g;

    // The cursor is always the midpoint of the thumb and index tips, so it does not jump when a pinch starts.
    // X is mirrored like a mirror image.
    const p = { x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2 };
    // reach > 1 maps the central part of the camera frame to the whole screen (less arm movement).
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const tx = clamp(0.5 + (0.5 - p.x) * C.reach), ty = clamp(0.5 + (p.y - 0.5) * C.reach);
    const k = this.seen && now - this.seen < 200 ? C.smooth : 1;
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.palm += (palm - this.palm) * (this.seen ? 0.3 : 1);
    // Palm roll: angle of the index-MCP → pinky-MCP line (mirrored).
    this.roll = Math.atan2(lm[PINKY_MCP].y - lm[INDEX_MCP].y, -(lm[PINKY_MCP].x - lm[INDEX_MCP].x));
    this.seen = now;
    this.landmarks = lm;
  }
}

export class HandTracker {
  constructor(videoEl, overlayCanvas) {
    this.video = videoEl;
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.hands = { Left: new TrackedHand('Left'), Right: new TrackedHand('Right') };
    this.active = [];
    this.lastVideoTime = -1;
  }

  async start() {
    if (this.running) return;
    if (!this.landmarker) {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        this.landmarker = await make('GPU');
      } catch {
        this.landmarker = await make('CPU');
      }
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.active = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Called every frame. Returns the list of visible hands. */
  update() {
    if (!this.running || this.video.readyState < 2) return this.active;
    if (this.video.currentTime === this.lastVideoTime) return this.active;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    const res = this.landmarker.detectForVideo(this.video, now);
    const active = [];
    (res.landmarks || []).forEach((lm, i) => {
      // MediaPipe reports handedness for the unmirrored image; swap it to match the user's point of view.
      const raw = res.handednesses?.[i]?.[0]?.categoryName || (i ? 'Left' : 'Right');
      const label = raw === 'Left' ? 'Right' : 'Left';
      const hand = this.hands[label];
      if (active.includes(hand)) return;
      hand.update(lm, now);
      active.push(hand);
    });
    for (const h of Object.values(this.hands)) {
      if (!active.includes(h)) {
        h.gesture = 'none';
        h.pinching = false;
        h.seen = 0;
      }
    }
    this.active = active;
    this.draw();
    return active;
  }

  draw() {
    const { canvas, ctx } = this;
    if (canvas.width !== canvas.clientWidth) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const h of this.active) {
      const pts = h.landmarks.map((p) => [(1 - p.x) * canvas.width, p.y * canvas.height]);
      ctx.strokeStyle = h.gesture === 'pinch' ? '#f472b6' : h.gesture === 'open' ? '#7df9ff' : '#c4b5fd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(...pts[a]);
        ctx.lineTo(...pts[b]);
      }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const [x, y] of pts) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
}
