import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildGeometry, groupByMaterial, materialDef } from '../voxel/geometry.js';
import { AxesOverlay } from './axes.js';

const VIEW_DIR = new THREE.Vector3(1, 0.8, 1.35).normalize();
const BLACK = new THREE.Color(0x000000);
const DARK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const DEG = Math.PI / 180;
export const SNAP = { move: 1, rotate: 15, scale: 0.25 };

// Adds the glow-only bloom image on top of the normal render.
const MIX_SHADER = {
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: null } },
  vertexShader: `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(bloomTexture, vUv).rgb, 0.0); }`,
};

// Cell shading: darkens a thin band along every cube edge so single cubes
// stay readable inside flat surfaces. Positions are in voxel units, so cube
// boundaries sit at k + 0.5 on each axis.
const CELL_VERTEX = `#include <begin_vertex>
vVoxPos = position;
vVoxNormal = normal;`;
const CELL_FRAGMENT = `if (uCell > 0.0) {
  vec3 dEdge = 0.5 - abs(fract(vVoxPos + 0.5) - 0.5); // distance to the cube's border, per axis
  dEdge += abs(vVoxNormal) * 10.0;                    // ignore the axis the face points along
  float e = min(dEdge.x, min(dEdge.y, dEdge.z));
  float aa = fwidth(e);
  float width = max(0.035, aa * 0.8);                 // at least about a pixel when far away
  float line = 1.0 - smoothstep(width - aa, width + aa, e);
  outgoingLight *= 1.0 - uCell * line;
}
#include <opaque_fragment>`;
const CELL_STRENGTH = { opaque: 0.55, transparent: 0.25 };

// Rig: every part is a pivot node (placed at its pivot, relative to its
// parent's pivot) holding the part's meshes shifted back by -pivot, so the
// geometry keeps world voxel coordinates (cell shading and picking rely on that).
// Animation poses move, rotate and scale the pivot nodes.

export class Viewport {
  constructor(el) {
    this.el = el;
    this.radius = 8;
    this.dirty = true;
    this.materials = new Map();
    this.colors = { bg: '#101218', grid1: '#3a4152', grid2: '#232835', box: '#888888', hover: '#ffffff', accent: '#7aa2ff' };
    this.cellShading = true;
    this.rig = new Map();       // part name -> { node, holder, rest, part, mesh }
    this.meshCache = new Map(); // part name -> { mesh, atlas, objects }
    this.onHover = null;        // (info | null) => void
    this.onPartClick = null;    // (name | null) => void
    this.onGizmoEnd = null;     // (name, mode, { pos, rot, scale }) => void
    this.onPivotMoved = null;   // (name, [x, y, z]) => void
    this.selected = null;
    this.gizmoMode = 'translate';
    this.animating = false;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    el.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.autoRotateSpeed = 1.5;
    this.controls.addEventListener('change', () => (this.dirty = true));

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.5));
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 1.5));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    this.grid = null;
    this.showGrid = true;
    this.model = new THREE.Group();
    scene.add(this.model);

    // Selective bloom: only GLOW voxels bloom, however bright other surfaces are.
    // Pass 1 renders glow meshes alone (everything else black) and blurs them;
    // pass 2 is the normal render with that image added on top.
    this.hasGlow = false;
    this.bloomComposer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.25, 0);
    this.bloomComposer.addPass(this.bloom);

    // HDR target with MSAA so anti-aliasing survives post-processing.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.mixPass = new ShaderPass(new THREE.ShaderMaterial(MIX_SHADER), 'baseTexture');
    this.mixPass.material.uniforms.bloomTexture.value = this.bloomComposer.renderTarget2.texture;
    this.composer.addPass(this.mixPass);
    this.composer.addPass(new OutputPass());

    this.axes = new AxesOverlay(el, scene);

    // Outline of the cube under the mouse (follows the part's pose).
    this.hoverBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    this.hoverBox.renderOrder = 10;
    this.hoverBox.visible = false;
    this.hoverBox.matrixAutoUpdate = false;
    scene.add(this.hoverBox);

    // Pivot of the selected part, and the object the gizmo drags in pivot mode.
    this.pivotMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.pivotMarker.renderOrder = 11;
    this.pivotMarker.visible = false;
    scene.add(this.pivotMarker);

    this.gizmo = new TransformControls(this.camera, r.domElement);
    this.gizmo.setSize(0.9);
    scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      this.gizmoDragging = e.value;
      if (!e.value) this._gizmoReleased();
    });
    this.gizmo.addEventListener('change', () => (this.dirty = true));
    this.setSnap(true);

    this.raycaster = new THREE.Raycaster();
    this.pointer = null;
    r.domElement.addEventListener('pointermove', (e) => {
      if (e.buttons || this.gizmoDragging) { this._setHover(null); return; } // dragging
      this.pointer = this._ndc(e);
      this._pickPending = true;
    });
    r.domElement.addEventListener('pointerleave', () => { this.pointer = null; this._setHover(null); });
    // A click (not a drag) on a part selects it.
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || this.gizmo.dragging || this.gizmoDragging) { down = null; return; }
      down = null;
      if (this.gizmo.axis) return; // released on a gizmo handle
      const hit = this._raycast(this._ndc(e));
      if (this.onPartClick) this.onPartClick(hit ? hit.object.userData.part : null);
    });

    this._layoutScene(this.radius, -this.radius);
    this.frame();

    new ResizeObserver(() => this._resize()).observe(el);
    this._resize();
    const loop = () => {
      requestAnimationFrame(loop);
      const moved = this.controls.update();
      if (this._pickPending) { this._pickPending = false; this._pick(); }
      if (this.dirty || moved) {
        this.dirty = false;
        this._render();
      }
    };
    loop();
  }

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Voxel meshes of visible parts (raycasting ignores visibility, so filter here). */
  _voxelMeshes() {
    const out = [];
    this.model.traverse((o) => { if (o.isMesh && o.userData.part && o.parent.visible) out.push(o); });
    return out;
  }

  _render() {
    this.mixPass.enabled = this.hasGlow;
    if (this.hasGlow) {
      const background = this.scene.background;
      const swapped = [];
      const helpers = [this.gizmo.getHelper(), this.pivotMarker, this.hoverBox];
      const helperVis = helpers.map((h) => h.visible);
      helpers.forEach((h) => (h.visible = false));
      this.scene.background = BLACK;
      this.grid.visible = false;
      this.ground.visible = false;
      for (const obj of this._voxelMeshes()) {
        if (obj.userData.glow) continue;
        swapped.push([obj, obj.material, obj.visible]);
        // See-through meshes are hidden so glow behind glass still blooms.
        if (obj.material.transparent) obj.visible = false;
        else obj.material = DARK;
      }
      this.bloomComposer.render();
      for (const [obj, material, visible] of swapped) { obj.material = material; obj.visible = visible; }
      helpers.forEach((h, i) => (h.visible = helperVis[i]));
      this.scene.background = background;
      this.grid.visible = this.showGrid;
      this.ground.visible = true;
    }
    this.composer.render();
    this.axes.render(this.scene, this.camera);
  }

  _raycast(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(this._voxelMeshes(), false)[0] || null;
  }

  _pick() {
    if (!this.pointer) return this._setHover(null);
    const hit = this._raycast(this.pointer);
    if (!hit) return this._setHover(null);
    const obj = hit.object;
    const entry = this.rig.get(obj.userData.part);
    if (!entry) return this._setHover(null);
    // Geometry is in world voxel coordinates; step half a cube inward from the face.
    const p = obj.worldToLocal(hit.point.clone());
    const n = hit.face.normal;
    const c = [p.x - n.x * 0.5, p.y - n.y * 0.5, p.z - n.z * 0.5].map(Math.round);
    const mesh = entry.mesh, R = mesh.radius, S = 2 * R + 1;
    if (c.some((v) => v < -R || v > R)) return this._setHover(null);
    const i = mesh.grid[(c[2] + R) * S * S + (c[1] + R) * S + (c[0] + R)] - 1;
    if (i < 0) return this._setHover(null);
    this._setHover({ part: obj.userData.part, x: c[0], y: c[1], z: c[2], combo: mesh.combos[mesh.comboOf[i]], object: obj });
  }

  _setHover(info) {
    const key = info ? `${info.part}:${info.x},${info.y},${info.z}` : '';
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this._hoverInfo = info;
    this._placeHoverBox();
    if (this.onHover) this.onHover(info);
  }

  _placeHoverBox() {
    const info = this._hoverInfo;
    this.hoverBox.visible = !!info;
    if (info) {
      info.object.updateWorldMatrix(true, false);
      this.hoverBox.matrix.copy(info.object.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(info.x, info.y, info.z));
    }
    this.dirty = true;
  }

  _resize() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomComposer.setSize(w, h);
    this.axes.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  _material({ key, mat, transparent, textured, cutout }) {
    let m = this.materials.get(key);
    if (m) return m;
    const def = materialDef(mat);
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: def.roughness,
      metalness: def.metalness,
      transparent,
      depthWrite: !transparent,
      map: textured && this.atlas ? this.atlas.texture : null,
      alphaTest: cutout ? 0.5 : 0,
    });
    const glow = !!def.emissive;
    if (glow) {
      // Emission-only: lighting on top would wash the color out to white.
      m.color.set(0x000000);
      m.emissive.set(0xffffff);
      m.emissiveIntensity = def.emissive;
    }
    m.userData.cellStrength = transparent ? CELL_STRENGTH.transparent : CELL_STRENGTH.opaque;
    m.userData.uCell = { value: this.cellShading ? m.userData.cellStrength : 0 };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCell = m.userData.uCell;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVoxPos;\nvarying vec3 vVoxNormal;')
        .replace('#include <begin_vertex>', CELL_VERTEX);
      let frag = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVoxPos;\nvarying vec3 vVoxNormal;\nuniform float uCell;')
        .replace('#include <opaque_fragment>', CELL_FRAGMENT);
      // Glow: emission follows each vertex's color instead of one uniform color.
      // A glowing texture glows in the texture's colors.
      if (glow) {
        frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
\ttotalEmissiveRadiance *= vColor.rgb;
#ifdef USE_MAP
\ttotalEmissiveRadiance *= texture2D(map, vMapUv).rgb;
#endif`);
      }
      shader.fragmentShader = frag;
    };
    m.customProgramCacheKey = () => (glow ? 'voxel-glow' : 'voxel');
    this.materials.set(key, m);
    return m;
  }

  /** Meshes for one part's voxel data, reused while the data doesn't change. */
  _partObjects(name, mesh) {
    const cached = this.meshCache.get(name);
    if (cached && cached.mesh === mesh && cached.atlas === this.atlas) return cached.objects;
    if (cached) for (const o of cached.objects) o.geometry.dispose();
    const objects = groupByMaterial(mesh).map((group) => {
      const atlas = group.textured ? this.atlas : null;
      const obj = new THREE.Mesh(buildGeometry(mesh, group.faces, { vertexColors: true, atlas }), this._material(group));
      obj.castShadow = !group.transparent;
      obj.receiveShadow = true;
      if (group.transparent) obj.renderOrder = 1;
      obj.userData.glow = !!materialDef(group.mat).emissive;
      obj.userData.part = name;
      return obj;
    });
    this.meshCache.set(name, { mesh, atlas: this.atlas, objects });
    return objects;
  }

  /**
   * Shows the project's parts.
   * @param parts [{ name, mesh, pivot: [x,y,z], parent, hidden }] with parents first; mesh may be null
   */
  setParts(parts, { radius, frame = false } = {}) {
    for (const entry of this.rig.values()) entry.holder.clear();
    this.model.clear();
    this.rig.clear();
    const names = new Set(parts.map((p) => p.name));
    for (const name of [...this.meshCache.keys()]) {
      if (!names.has(name)) {
        for (const o of this.meshCache.get(name).objects) o.geometry.dispose();
        this.meshCache.delete(name);
      }
    }

    let minY = Infinity;
    for (const part of parts) {
      const node = new THREE.Group();
      node.name = part.name;
      const holder = new THREE.Group();
      holder.position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
      holder.visible = !part.hidden; // hides this part's cubes only; child parts keep their own setting
      node.add(holder);
      if (part.mesh) {
        holder.add(...this._partObjects(part.name, part.mesh));
        if (part.mesh.bounds) minY = Math.min(minY, part.mesh.bounds.min[1]);
      }
      const parent = part.parent && this.rig.get(part.parent);
      const base = parent ? parent.part.pivot : [0, 0, 0];
      const rest = new THREE.Vector3(part.pivot[0] - base[0], part.pivot[1] - base[1], part.pivot[2] - base[2]);
      node.position.copy(rest);
      (parent ? parent.node : this.model).add(node);
      this.rig.set(part.name, { node, holder, rest, part, mesh: part.mesh });
    }

    this.hasGlow = this._voxelMeshes().some((o) => o.userData.glow);
    this._layoutScene(radius ?? this.radius, minY === Infinity ? -(radius ?? this.radius) - 0.5 : minY - 0.5);
    this._hoverKey = null;
    this._hoverInfo = null;
    this.hoverBox.visible = false;
    this._pickPending = true;
    this._attachGizmo();
    if (frame) this.frame();
    this.dirty = true;
  }

  /** Applies poses: { partName: { pos, rot, scale } }. Missing parts (or null) stay at rest. */
  setPose(poses) {
    for (const [name, { node, rest }] of this.rig) {
      const p = poses && poses[name];
      if (p) {
        node.position.set(rest.x + p.pos[0], rest.y + p.pos[1], rest.z + p.pos[2]);
        node.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
        node.scale.set(p.scale[0] || 1e-4, p.scale[1] || 1e-4, p.scale[2] || 1e-4);
      } else {
        node.position.copy(rest);
        node.rotation.set(0, 0, 0);
        node.scale.set(1, 1, 1);
      }
    }
    if (this._hoverInfo) this._placeHoverBox();
    this._placePivotMarker();
    this.dirty = true;
  }

  // ------------------------------------------------------------ animate mode / gizmo

  setAnimating(on) {
    this.animating = on;
    this._attachGizmo();
  }

  select(name) {
    this.selected = name;
    this._attachGizmo();
  }

  /** 'translate' | 'rotate' | 'scale' | 'pivot' */
  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this._attachGizmo();
  }

  setSnap(on) {
    this.snap = on;
    this.gizmo.setTranslationSnap(on ? SNAP.move : null);
    this.gizmo.setRotationSnap(on ? SNAP.rotate * DEG : null);
    this.gizmo.setScaleSnap(on ? SNAP.scale : null);
  }

  _attachGizmo() {
    const entry = this.selected && this.rig.get(this.selected);
    if (!this.animating || !entry) {
      this.gizmo.detach();
      this.pivotMarker.visible = false;
      this.dirty = true;
      return;
    }
    const pivot = this.gizmoMode === 'pivot';
    this.gizmo.setMode(pivot ? 'translate' : this.gizmoMode);
    this.gizmo.setSpace(this.gizmoMode === 'translate' || pivot ? 'world' : 'local');
    this._placePivotMarker();
    this.gizmo.attach(pivot ? this.pivotMarker : entry.node);
    this.dirty = true;
  }

  _placePivotMarker() {
    const entry = this.animating && this.selected && this.rig.get(this.selected);
    this.pivotMarker.visible = !!entry;
    if (!entry || (this.gizmoDragging && this.gizmoMode === 'pivot')) return;
    if (this.gizmoMode === 'pivot') this.pivotMarker.position.set(...entry.part.pivot); // pivots are edited at rest
    else entry.node.getWorldPosition(this.pivotMarker.position);
  }

  _gizmoReleased() {
    const entry = this.selected && this.rig.get(this.selected);
    if (!entry) return;
    if (this.gizmoMode === 'pivot') {
      const p = this.pivotMarker.position;
      const round = (v) => Math.round(v * 2) / 2; // pivots snap to half voxels (cube centers or edges)
      if (this.onPivotMoved) this.onPivotMoved(entry.part.name, [round(p.x), round(p.y), round(p.z)]);
      return;
    }
    const { node, rest } = entry;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const values = {
      pos: [r3(node.position.x - rest.x), r3(node.position.y - rest.y), r3(node.position.z - rest.z)],
      rot: [r3(node.rotation.x / DEG), r3(node.rotation.y / DEG), r3(node.rotation.z / DEG)],
      scale: [r3(node.scale.x), r3(node.scale.y), r3(node.scale.z)],
    };
    if (this.onGizmoEnd) this.onGizmoEnd(entry.part.name, this.gizmoMode, values);
  }

  // ------------------------------------------------------------ scene layout

  _layoutScene(radius, floorY) {
    this.radius = radius;
    const S = 2 * radius + 1;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    this.grid = new THREE.GridHelper(S, S, this.colors.grid1, this.colors.grid2);
    this.grid.position.y = floorY - 0.001;
    this.grid.visible = this.showGrid;
    this.scene.add(this.grid);

    this.axes.setRadius(radius);
    this.ground.scale.set(S * 4, S * 4, 1);
    this.ground.position.y = floorY;

    const reach = S * 1.2;
    this.sun.position.set(reach * 0.6, reach * 1.4, reach * 0.9);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -S;
    cam.right = cam.top = S;
    cam.near = 0.1;
    cam.far = reach * 4;
    cam.updateProjectionMatrix();
  }

  frame() {
    const S = 2 * this.radius + 1;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    // Extra room so the axis box and its labels fit on narrow viewports.
    const dist = ((S * 0.5 * Math.sqrt(3)) / Math.sin(fov / 2)) * 1.2;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(VIEW_DIR).multiplyScalar(dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }

  setGridVisible(v) {
    this.showGrid = v;
    if (this.grid) this.grid.visible = v;
    this.dirty = true;
  }

  /** New texture atlas: textured materials and cached meshes are rebuilt on the next setParts. */
  setAtlas(atlas) {
    if (atlas === this.atlas) return;
    this.atlas = atlas;
    for (const [key, m] of this.materials) {
      if (m.map) { m.dispose(); this.materials.delete(key); }
    }
  }

  setAxesVisible(v) {
    this.axes.setVisible(v);
    this.dirty = true;
  }

  setCellShading(v) {
    this.cellShading = v;
    for (const m of this.materials.values()) m.userData.uCell.value = v ? m.userData.cellStrength : 0;
    this.dirty = true;
  }

  setSpin(v) {
    this.controls.autoRotate = v;
    this.dirty = true;
  }

  setColors(colors) {
    this.colors = colors;
    this.scene.background = new THREE.Color(colors.bg);
    this.axes.setColor(colors.box);
    this.hoverBox.material.color.set(colors.hover);
    this.pivotMarker.material.color.set(colors.accent || '#ffffff');
    this._layoutScene(this.radius, this.grid ? this.grid.position.y + 0.001 : -this.radius - 0.5);
    this.dirty = true;
  }
}
