import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Bounding box with numbered X/Y/Z ticks. Labels are HTML (CSS2D) so they
// stay crisp and readable; the edges they sit on follow the camera so the
// numbers are always on the side facing you.

export class AxesOverlay {
  constructor(container, scene) {
    this.renderer = new CSS2DRenderer();
    const dom = this.renderer.domElement;
    dom.className = 'axes-layer';
    container.appendChild(dom);

    this.group = new THREE.Group();
    scene.add(this.group);
    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.45 }),
    );
    this.group.add(this.box);

    this.ticks = { x: [], y: [], z: [] };
    this.titles = {};
    for (const axis of ['x', 'y', 'z']) {
      this.titles[axis] = this._label(axis.toUpperCase(), `axis-title axis-${axis}`);
    }
    this.radius = -1;
    this.visible = true;
    this._v = new THREE.Vector3();
  }

  _label(text, cls) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    this.group.add(obj);
    return obj;
  }

  setRadius(radius) {
    if (radius === this.radius) return;
    this.radius = radius;
    for (const axis of ['x', 'y', 'z']) {
      for (const t of this.ticks[axis]) { this.group.remove(t); t.element.remove(); }
      this.ticks[axis] = [];
    }
    const S = 2 * radius + 1;
    const step = S <= 21 ? 1 : S <= 41 ? 2 : 4;
    for (let v = -radius; v <= radius; v++) {
      if (v % step !== 0) continue;
      for (const axis of ['x', 'y', 'z']) {
        const t = this._label(String(v), `axis-tick axis-${axis}`);
        t.userData.value = v;
        this.ticks[axis].push(t);
      }
    }
    const M = radius + 0.5;
    this.box.scale.set(2 * M, 2 * M, 2 * M);
  }

  setColor(color) {
    this.box.material.color.set(color);
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    this.renderer.domElement.style.display = v ? '' : 'none';
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
  }

  /** Places labels on the edges nearest the camera, then draws them. */
  render(scene, camera) {
    if (!this.visible) return;
    const M = this.radius + 0.5;
    const o = 1.1; // gap between the box and the numbers
    const sx = camera.position.x >= 0 ? 1 : -1;
    const sz = camera.position.z >= 0 ? 1 : -1;

    // Vertical edge for Y: whichever of the two side corners is further left on screen.
    const left = (cx, cz) => this._v.set(cx * M, 0, cz * M).project(camera).x;
    const [cx, cz] = left(sx, -sz) < left(-sx, sz) ? [sx, -sz] : [-sx, sz];

    for (const t of this.ticks.x) t.position.set(t.userData.value, -M, sz * (M + o));
    for (const t of this.ticks.z) t.position.set(sx * (M + o), -M, t.userData.value);
    for (const t of this.ticks.y) t.position.set(cx * (M + o * 0.8), t.userData.value, cz * (M + o * 0.8));
    this.titles.x.position.set(0, -M - 1.6, sz * (M + o * 3));
    this.titles.z.position.set(sx * (M + o * 3), -M - 1.6, 0);
    this.titles.y.position.set(cx * (M + o * 0.8), M + 1.6, cz * (M + o * 0.8));

    this.renderer.render(scene, camera);
  }
}
