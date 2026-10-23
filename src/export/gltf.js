import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildGeometry, groupByCombo, groupByMaterial, linearColor, materialDef, originOffset, unionBounds, MAX_SURFACES } from '../voxel/geometry.js';
import { evaluate } from '../anim/evaluate.js';

const DEG = Math.PI / 180;

/**
 * One mesh for one part: a surface per unique look (color + opacity +
 * material + texture), each a StandardMaterial3D in Godot. More than
 * MAX_SURFACES looks fall back to vertex colors. Positions are
 * coord * scale + offset.
 */
export function buildExportMesh(mesh, { scale = 0.1, offset = [0, 0, 0], name = 'VoxelModel', atlas = null } = {}) {
  const perCombo = mesh.combos.length <= MAX_SURFACES;
  const groups = perCombo ? groupByCombo(mesh) : groupByMaterial(mesh);
  const textured = !!atlas && mesh.combos.some((c) => c.tex);

  const allFaces = [];
  const ranges = [];
  for (const g of groups) {
    ranges.push([allFaces.length, g.faces.length]);
    for (const f of g.faces) allFaces.push(f);
  }
  const geometry = buildGeometry(mesh, allFaces, { scale, offset, vertexColors: !perCombo, atlas: textured ? atlas : null });
  const materials = groups.map((g, i) => {
    geometry.addGroup(ranges[i][0] * 6, ranges[i][1] * 6, i);
    return perCombo ? comboMaterial(g.combo, atlas) : vertexColorMaterial(g, atlas);
  });

  const obj = new THREE.Mesh(geometry, materials);
  obj.name = name;
  return obj;
}

function comboMaterial({ rgb, alpha, mat, tex, cutout }, atlas) {
  const def = materialDef(mat);
  const color = linearColor(rgb);
  const m = new THREE.MeshStandardMaterial({
    name: `${def.id}_${rgb.toString(16).padStart(6, '0')}${alpha < 255 ? `_a${Math.round((alpha / 255) * 100)}` : ''}${tex ? `_t${tex}` : ''}`,
    color,
    roughness: def.roughness,
    metalness: def.metalness,
    transparent: alpha < 255,
    opacity: alpha / 255,
    map: tex && atlas ? atlas.texture : null,
    alphaTest: cutout ? 0.5 : 0,
  });
  if (def.emissive) {
    m.emissive.copy(color);
    m.emissiveIntensity = def.emissive;
    if (m.map) m.emissiveMap = m.map;
  }
  return m;
}

function vertexColorMaterial({ mat, transparent, textured, cutout }, atlas) {
  const def = materialDef(mat);
  const m = new THREE.MeshStandardMaterial({
    name: `${def.id}${transparent ? '_transparent' : ''}${textured ? '_textured' : ''}`,
    vertexColors: true,
    roughness: def.roughness,
    metalness: def.metalness,
    transparent,
    map: textured && atlas ? atlas.texture : null,
    alphaTest: cutout ? 0.5 : 0,
  });
  if (def.emissive) {
    m.emissive.set(0xffffff);
    m.emissiveIntensity = def.emissive * 0.3;
  }
  return m;
}

/**
 * Node tree mirroring the preview rig: root (origin offset) -> one node per
 * part at its pivot (children under their parent) -> the part's mesh,
 * shifted by -pivot so geometry stays in place.
 * @param parts [{ name, mesh, pivot, parent }] with parents first
 */
export function buildExportScene(parts, { scale = 0.1, origin = 'bottom', name = 'VoxelModel', atlas = null } = {}) {
  const root = new THREE.Group();
  root.name = name;
  root.position.fromArray(originOffset(unionBounds(parts.map((p) => p.mesh)), origin, scale));
  // Note: not userData.pivot. three.js reserves that name (GLTFLoader treats it as its own pivot convention).
  const nodes = new Map();
  const pivots = new Map();
  for (const part of parts) {
    const node = new THREE.Group();
    node.name = part.name;
    const parent = part.parent && nodes.get(part.parent);
    const base = parent ? pivots.get(part.parent) : [0, 0, 0];
    node.position.set((part.pivot[0] - base[0]) * scale, (part.pivot[1] - base[1]) * scale, (part.pivot[2] - base[2]) * scale);
    pivots.set(part.name, part.pivot);
    if (part.mesh && part.mesh.count) {
      const offset = part.pivot.map((v) => -v * scale);
      node.add(buildExportMesh(part.mesh, { scale, offset, name: `${part.name}_mesh`, atlas }));
    }
    (parent || root).add(node);
    nodes.set(part.name, node);
  }
  return root;
}

/**
 * Animation clips sampled once per frame. Where a step key holds a value,
 * an extra sample just before the next frame keeps the jump sharp instead
 * of blending over one frame.
 */
export function buildClips(anim, parts, { scale = 0.1, loopSuffix = true } = {}) {
  const byName = new Map(parts.map((p) => [p.name, p]));
  return anim.clips.map((clip) => {
    const tracks = [];
    for (const part of parts) {
      const keys = clip.keys.filter((k) => k.part === part.name);
      if (!keys.length) continue;
      const parent = part.parent && byName.get(part.parent);
      const base = parent ? parent.pivot : [0, 0, 0];
      const rest = part.pivot.map((v, i) => v - base[i]);
      const has = { pos: keys.some((k) => k.pos), rot: keys.some((k) => k.rot), scale: keys.some((k) => k.scale !== undefined) };

      const times = [];
      const frames = [];
      for (let f = 0; f <= clip.frames; f++) {
        times.push(f / clip.fps);
        frames.push(f);
        if (f < clip.frames) {
          const a = evaluate(clip, part.name, f), b = evaluate(clip, part.name, f + 1), h = evaluate(clip, part.name, f + 0.999);
          const held = ['pos', 'rot', 'scale'].some((p) => h[p].some((v, i) => Math.abs(v - (a[p][i] + (b[p][i] - a[p][i]) * 0.999)) > 1e-4));
          if (held) { times.push((f + 0.999) / clip.fps); frames.push(f + 0.999); }
        }
      }
      const poses = frames.map((f) => evaluate(clip, part.name, f));

      if (has.pos) {
        tracks.push(new THREE.VectorKeyframeTrack(`${part.name}.position`, times,
          poses.flatMap((p) => p.pos.map((v, i) => (rest[i] + v) * scale))));
      }
      if (has.rot) {
        const q = new THREE.Quaternion(), prev = new THREE.Quaternion(), e = new THREE.Euler();
        const values = [];
        poses.forEach((p, i) => {
          q.setFromEuler(e.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG, 'XYZ'));
          if (i && q.dot(prev) < 0) q.set(-q.x, -q.y, -q.z, -q.w); // keep the shortest path between samples
          prev.copy(q);
          values.push(q.x, q.y, q.z, q.w);
        });
        tracks.push(new THREE.QuaternionKeyframeTrack(`${part.name}.quaternion`, times, values));
      }
      if (has.scale) {
        tracks.push(new THREE.VectorKeyframeTrack(`${part.name}.scale`, times,
          poses.flatMap((p) => p.scale.map((v) => Math.max(v, 1e-4)))));
      }
    }
    // Godot imports clips whose name ends in "_loop" as looping.
    const name = clip.loop && loopSuffix ? `${clip.name}_loop` : clip.name;
    return new THREE.AnimationClip(name, clip.frames / clip.fps, tracks);
  });
}

/** Returns the .glb file as an ArrayBuffer. */
export async function exportGLB(parts, anim, opts) {
  const root = buildExportScene(parts, opts);
  const animations = opts.animations && anim ? buildClips(anim, parts, opts).filter((c) => c.tracks.length) : [];
  try {
    return await new GLTFExporter().parseAsync(root, { binary: true, animations });
  } finally {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of o.material) m.dispose(); // the atlas texture itself is shared; not disposed
    });
  }
}
