// Line icons (24×24, stroke = currentColor) that follow the color of their button.
// Paths only, so icons such as "lock" can also be drawn onto 3D card textures via Path2D.

const P = {
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 7.7-1.5',
  key: 'M10.6 12.4a4.5 4.5 0 1 1-6.4 6.4 4.5 4.5 0 0 1 6.4-6.4zM10.6 12.4 20 3m-4 4 3 3m-5.5-.5 2 2',
  folderOpen: 'M3 18V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2M3 18l2.4-6.6A2 2 0 0 1 7.3 10H21l-2.5 7.2A2 2 0 0 1 16.6 18.5H4z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7',
  saveAs: 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.1L4.5 15.5a1.5 1.5 0 0 1 2.3-1.9L8 15',
  pointer: 'M9 11V4.5a1.5 1.5 0 0 1 3 0V11l5.2 1a2 2 0 0 1 1.6 2.2l-.6 4.3A3 3 0 0 1 15.2 21H11a4 4 0 0 1-3.2-1.6L5 15.5a1.5 1.5 0 0 1 2.4-1.8L9 15.5',
  pinch: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 4l4 4M8 4v4H4M20 4l-4 4M16 4v4h4M4 20l4-4M4 16h4v4M20 20l-4-4M20 16h-4v4',
  back: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  help: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.2v.3',
  keyboard: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  shuffle: 'M3 7h3c4 0 6 10 10 10h5m-3-3 3 3-3 3M3 17h3c1.5 0 2.7-1.4 3.7-3.2m3.6-3.6C14.3 8.4 15.5 7 17 7h4m-3-3 3 3-3 3',
  backspace: 'M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM12 9l6 6m0-6-6 6',
  check: 'm5 12 5 5L20 7',
  shift: 'M12 4 4 12h4v7h8v-7h4z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  lifebuoy: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM5.6 5.6l3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  fileText: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  filePlus: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6',
  braces: 'M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1',
  columns: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 4v16',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5',
  layersPlus: 'm12 3 9 5-9 5-9-5zM3 13l9 5 4-2.2M19 14v6M16 17h6',
  layersEdit: 'm12 3 9 5-9 5-9-5zM3 13l9 5 2-1.1M15 20h2l4-4-2-2-4 4z',
  layersX: 'm12 3 9 5-9 5-9-5zM3 13l9 5 2.5-1.4M17 15l4 4m0-4-4 4',
  server: 'M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM7 7.5h.01M7 16.5h.01',
  serverEdit: 'M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM11 13H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h6M7 7.5h.01M15 20h2l4-4-2-2-4 4z',
  serverX: 'M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 13H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h7M7 7.5h.01M16 14l5 5m0-5-5 5',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  arrowUp: 'M12 19V5m-6 6 6-6 6 6',
  arrowDown: 'M12 5v14m-6-6 6 6 6-6',
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  alert: 'M12 3 2 20h20zM12 10v5M12 17.5v.3',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  square: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z',
  checkSquare: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8 12l3 3 5-6',
  dot: 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  camera: 'M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 10a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
};

export const ICON_PATHS = P;

/** SVG icon markup. */
export function icon(name, cls = '') {
  const d = P[name];
  if (!d) return '';
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

/** Replaces <i data-icon="…"> placeholders with SVG icons. */
export function applyIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className);
  });
}

/** Draws an icon onto a canvas (used for 3D card textures). */
export function drawIcon(ctx, name, x, y, size, color, lineWidth = 1.8) {
  const d = P[name];
  if (!d) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}
