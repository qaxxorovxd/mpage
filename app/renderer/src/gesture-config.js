// Hand gesture thresholds, editable in the tuning panel and stored per computer.
// Labels live in the dictionary as g.<key> (lib/i18n.js).
const KEY = 'mpage.gestures.v1';

export const GESTURE_PARAMS = [
  { key: 'pinchOn', min: 0.15, max: 0.6, step: 0.01, def: 0.32 },
  { key: 'pinchOff', min: 0.25, max: 0.9, step: 0.01, def: 0.48 },
  { key: 'extendRatio', min: 1.0, max: 1.4, step: 0.01, def: 1.12 },
  { key: 'stableFrames', min: 1, max: 8, step: 1, def: 3 },
  { key: 'smooth', min: 0.1, max: 1, step: 0.05, def: 0.45 },
  { key: 'reach', min: 1, max: 2.2, step: 0.05, def: 1.35 },
  { key: 'clickMove', min: 5, max: 80, step: 1, def: 25 },
  { key: 'clickMs', min: 200, max: 1500, step: 50, def: 600 },
  { key: 'swipeX', min: 0.06, max: 0.4, step: 0.01, def: 0.17 },
  { key: 'swipeY', min: 0.06, max: 0.4, step: 0.01, def: 0.15 },
  { key: 'swipeMs', min: 150, max: 800, step: 10, def: 350 },
  { key: 'swipeCooldown', min: 200, max: 1500, step: 50, def: 650 },
  { key: 'fistMs', min: 100, max: 1500, step: 50, def: 400 },
];

export const gestureConfig = Object.fromEntries(GESTURE_PARAMS.map((p) => [p.key, p.def]));

try {
  Object.assign(gestureConfig, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch { /* nothing saved or unreadable: defaults */ }

export function saveGestureConfig() {
  try {
    localStorage.setItem(KEY, JSON.stringify(gestureConfig));
  } catch { /* still works for this session */ }
}

export function resetGestureConfig() {
  for (const p of GESTURE_PARAMS) gestureConfig[p.key] = p.def;
  saveGestureConfig();
}
