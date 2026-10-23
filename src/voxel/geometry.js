import * as THREE from 'three';
import { DIRS, FACE_CORNERS } from './mesher.js';
import { MATERIALS } from '../lua/api.js';

// Godot allows at most 256 surfaces per mesh; past that, exports fall back
// to vertex colors grouped by material.
export const MAX_SURFACES = 256;

/** Linear-space color of a combo, as three.js and glTF expect. */
export function linearColor(rgb) {
  return new THREE.Color().setHex(rgb, THREE.SRGBColorSpace);
}

// Texture axes per face direction: [right, up] as seen from outside, so
// textures stand upright on the sides and read correctly from above.
const FACE_UV_AXES = [
  [[0, 0, -1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]],
];

/** Atlas tile for one face of a voxel's combo; untextured faces use the white tile. */
function faceTile(mesh, combo, d, atlas) {
  if (!combo.tex) return atlas.white;
  const texIndex = mesh.texsets[combo.tex - 1]?.[d];
  if (!texIndex) return atlas.white;
  return atlas.tiles.get(mesh.textureNames[texIndex - 1]) || atlas.white;
}

/**
 * Writes the faces in `faceList` into one BufferGeometry.
 * Positions are (voxel coord + corner) * scale + offset. With `atlas`, adds UVs.
 */
export function buildGeometry(mesh, faceList, { scale = 1, offset = [0, 0, 0], vertexColors = false, atlas = null } = {}) {
  const n = faceList.length;
  const pos = new Float32Array(n * 12);
  const nor = new Float32Array(n * 12);
  const col = vertexColors ? new Float32Array(n * 16) : null;
  const uv = atlas ? new Float32Array(n * 8) : null;
  const index = new Uint32Array(n * 6);
  const colorCache = new Map();

  for (let f = 0; f < n; f++) {
    const code = faceList[f];
    const v = Math.floor(code / 6), d = code % 6;
    const cx = mesh.coords[v * 3], cy = mesh.coords[v * 3 + 1], cz = mesh.coords[v * 3 + 2];
    const corners = FACE_CORNERS[d];
    const dir = DIRS[d];
    for (let k = 0; k < 4; k++) {
      const o = (f * 4 + k) * 3;
      pos[o] = (cx + corners[k][0]) * scale + offset[0];
      pos[o + 1] = (cy + corners[k][1]) * scale + offset[1];
      pos[o + 2] = (cz + corners[k][2]) * scale + offset[2];
      nor[o] = dir[0]; nor[o + 1] = dir[1]; nor[o + 2] = dir[2];
    }
    if (uv) {
      const t = faceTile(mesh, mesh.combos[mesh.comboOf[v]], d, atlas);
      const [U, V] = FACE_UV_AXES[d];
      for (let k = 0; k < 4; k++) {
        const c = corners[k];
        const u01 = c[0] * U[0] + c[1] * U[1] + c[2] * U[2] + 0.5;
        const v01 = c[0] * V[0] + c[1] * V[1] + c[2] * V[2] + 0.5;
        uv[(f * 4 + k) * 2] = t.u0 + u01 * (t.u1 - t.u0);
        uv[(f * 4 + k) * 2 + 1] = t.v0 + v01 * (t.v1 - t.v0);
      }
    }
    if (col) {
      const combo = mesh.combos[mesh.comboOf[v]];
      let c = colorCache.get(combo);
      if (!c) colorCache.set(combo, (c = linearColor(combo.rgb)));
      const a = combo.alpha / 255;
      for (let k = 0; k < 4; k++) {
        const o = (f * 4 + k) * 4;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; col[o + 3] = a;
      }
    }
    const b = f * 4, i = f * 6;
    index[i] = b; index[i + 1] = b + 1; index[i + 2] = b + 2;
    index[i + 3] = b; index[i + 4] = b + 2; index[i + 5] = b + 3;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Faces grouped by material, transparency and texturing: few draw calls for the preview. */
export function groupByMaterial(mesh) {
  const groups = new Map();
  for (const code of mesh.faces) {
    const combo = mesh.combos[mesh.comboOf[Math.floor(code / 6)]];
    const transparent = combo.alpha < 255, textured = combo.tex > 0;
    const key = `${combo.mat}:${+transparent}:${+textured}:${+combo.cutout}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, mat: combo.mat, transparent, textured, cutout: combo.cutout, faces: [] }));
    g.faces.push(code);
  }
  return [...groups.values()];
}

/** Texture names used by a combo, for display. */
export function comboTextureNames(mesh, combo) {
  if (!combo.tex) return [];
  const ids = new Set(mesh.texsets[combo.tex - 1]?.filter(Boolean));
  return [...ids].map((i) => mesh.textureNames[i - 1]);
}

/** Faces grouped by exact look (color + opacity + material): one surface each. */
export function groupByCombo(mesh) {
  const groups = mesh.combos.map((combo) => ({ combo, faces: [] }));
  for (const code of mesh.faces) groups[mesh.comboOf[Math.floor(code / 6)]].faces.push(code);
  return groups.filter((g) => g.faces.length);
}

/** Combined bounds of several meshes, shaped like a mesh for originOffset(). */
export function unionBounds(meshes) {
  let min = null, max = null;
  for (const m of meshes) {
    if (!m || !m.bounds) continue;
    min = min ? min.map((v, i) => Math.min(v, m.bounds.min[i])) : [...m.bounds.min];
    max = max ? max.map((v, i) => Math.max(v, m.bounds.max[i])) : [...m.bounds.max];
  }
  return { bounds: min ? { min, max } : null };
}

/** Offset that places the model according to the chosen origin. */
export function originOffset(mesh, origin, scale) {
  if (!mesh.bounds || origin === 'grid') return [0, 0, 0];
  const { min, max } = mesh.bounds;
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  if (origin === 'center') return [-c[0] * scale, -c[1] * scale, -c[2] * scale];
  // 'bottom': centered on X/Z, resting on y = 0
  return [-c[0] * scale, -(min[1] - 0.5) * scale, -c[2] * scale];
}

export function materialDef(id) {
  return MATERIALS[id] || MATERIALS[0];
}
