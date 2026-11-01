// Sector stack: glass cards arranged like stairs along a diagonal (3D, Three.js).
import * as THREE from 'three';
import { t } from '../../../lib/i18n.js';
import { drawIcon, icon } from './icons.js';

const W = 2.3, H = 1.45;           // card size
const STEP = new THREE.Vector3(0, 0.3, -0.62); // offset between consecutive cards
const BASE_YAW = -1.05, BASE_PITCH = 0.14;

function cardTexture(sector, levelLabel, maxAniso) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 404;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, 'rgba(58,62,70,0.92)');
  grad.addColorStop(1, 'rgba(24,26,31,0.86)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // top-left highlight (glass effect)
  const shine = g.createLinearGradient(0, 0, c.width * 0.6, c.height * 0.6);
  shine.addColorStop(0, 'rgba(255,255,255,0.16)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);

  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '700 44px "Segoe UI", "Noto Sans", sans-serif';
  g.fillText(levelLabel, 40, 150);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '600 34px "Segoe UI", "Noto Sans", sans-serif';
  if (sector.locked) {
    drawIcon(g, 'lock', 38, 172, 40, 'rgba(255,255,255,0.8)', 2);
    g.fillText(t('card.encrypted'), 88, 205);
  } else {
    g.fillText(sector.name.toUpperCase().slice(0, 26), 40, 205);
  }
  g.font = '400 26px "Segoe UI", "Noto Sans", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  if (sector.locked) g.fillText(t('card.needPassword'), 40, 250);
  else {
    const text = t('count.files', { n: sector.files.length });
    g.fillText(text, 40, 250);
    if (sector.dek) drawIcon(g, 'unlock', 52 + g.measureText(text).width, 226, 28, 'rgba(94,234,212,0.85)', 2);
  }
  if (sector.locked) {
    // encrypted sector: diagonal hatching
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 10;
    for (let x = -c.height; x < c.width; x += 36) {
      g.beginPath();
      g.moveTo(x, c.height);
      g.lineTo(x + c.height, 0);
      g.stroke();
    }
  }
  // level color swatch
  g.fillStyle = sector.color;
  g.fillRect(c.width - 120, c.height - 150, 54, 96);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(c.width - 120, c.height - 150, 54, 10);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export class SectorStack {
  constructor(canvas, labelsEl) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.cards = [];
    this.focus = 0;
    this.open = -1;
    this.hover = -1;
    this.yaw = 0;      // user rotation
    this.zoom = 1;
    this.shiftX = 0.1; // shifts the stack towards the right of the stage (0..0.5)
    this.raycaster = new THREE.Raycaster();
    this.levelLabel = (s) => s.level;
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.setViewOffset(r.width, r.height, -r.width * this.shiftX, 0, r.width, r.height);
    this.camera.updateProjectionMatrix();
  }

  setSectors(sectors) {
    for (const c of this.cards) {
      c.mesh.geometry.dispose();
      c.front.map.dispose();
      c.front.dispose();
      c.glass.dispose();
      c.edges.geometry.dispose();
      c.edges.material.dispose();
      this.group.remove(c.pivot);
      c.label.remove();
    }
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.cards = sectors.map((sector, i) => {
      const pivot = new THREE.Group();
      // Only the front face is labeled; other faces are plain dark glass (no mirrored text from behind).
      const front = new THREE.MeshBasicMaterial({ map: cardTexture(sector, this.levelLabel(sector), aniso), transparent: true, opacity: 0.9, depthWrite: false });
      const glass = new THREE.MeshBasicMaterial({ color: '#2a2e35', transparent: true, opacity: 0.85, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.035), [glass, glass, glass, glass, front, glass]);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }),
      );
      mesh.add(edges);
      mesh.userData.index = i;
      pivot.add(mesh);
      pivot.position.copy(STEP.clone().multiplyScalar(i));
      this.group.add(pivot);
      const label = document.createElement('div');
      label.className = 'chip';
      label.style.background = sector.color;
      if (sector.locked) label.innerHTML = `${icon('lock', 'xs')}${this.levelLabel(sector).replace(/[&<>]/g, '')}`;
      else label.textContent = sector.name.toUpperCase();
      label.dataset.index = i;
      this.labelsEl.appendChild(label);
      return { sector, pivot, mesh, front, glass, edges, label, slide: 0 };
    });
    this.focus = Math.min(this.focus, Math.max(0, sectors.length - 1));
    this.open = -1;
    // center the stack at the origin
    const mid = STEP.clone().multiplyScalar((sectors.length - 1) / 2);
    this.group.children.forEach((p) => p.position.sub(mid));
    this.extent = Math.max(1, sectors.length);
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.cards.map((c) => c.mesh), false);
    // The front-most hit is picked.
    return hits.length ? hits[0].object.userData.index : -1;
  }

  tick(dt) {
    if (!this.width) return;
    const k = 1 - Math.exp(-dt * 10);
    // While a sector is open, the stack moves right, clear of the file panel.
    const shiftTo = this.open >= 0 ? 0.26 : 0.1;
    if (Math.abs(shiftTo - this.shiftX) > 1e-3) {
      this.shiftX += (shiftTo - this.shiftX) * k;
      this.camera.setViewOffset(this.width, this.height, -this.width * this.shiftX, 0, this.width, this.height);
    }
    this.group.rotation.set(BASE_PITCH, BASE_YAW + this.yaw, 0);
    this.fit = (this.fit ?? 1) + ((this.open >= 0 ? 1.3 : 1) - (this.fit ?? 1)) * k;
    const dist = ((9 + this.extent * 0.8) * this.fit) / this.zoom;
    this.camera.position.set(0, 0.2, dist);
    this.camera.lookAt(0, 0, 0);

    this.cards.forEach((c, i) => {
      const isOpen = i === this.open;
      const isFocus = i === this.focus;
      // the focused card slides out; the open one slides further
      const slideTo = isOpen ? 0.8 : isFocus ? 0.55 : i === this.hover ? 0.25 : 0;
      c.slide += (slideTo - c.slide) * k;
      c.mesh.position.set(c.slide, c.slide * 0.12, c.slide * 0.25);
      const dim = this.open >= 0 && !isOpen ? 0.45 : 0.9;
      c.front.opacity += (dim - c.front.opacity) * k;
      c.glass.opacity = c.front.opacity * 0.95;
      c.edges.material.color.set(isFocus || isOpen ? '#5eead4' : '#ffffff');
      c.edges.material.opacity = isFocus || isOpen ? 0.95 : 0.35;
    });
    this.group.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();

    this.cards.forEach((c, i) => {
      const isOpen = i === this.open;
      const isFocus = i === this.focus;
      // HTML label next to the bottom-right corner of the card
      const p = new THREE.Vector3(W / 2, -H / 2 + 0.05, 0).applyMatrix4(c.mesh.matrixWorld).project(this.camera);
      const x = (p.x * 0.5 + 0.5) * this.width, y = (-p.y * 0.5 + 0.5) * this.height;
      c.label.style.transform = `translate(${x + 6}px, ${y - 4}px)`;
      c.label.classList.toggle('active', isFocus || isOpen);
      c.label.style.opacity = this.open >= 0 && !isOpen ? 0.5 : 1;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
