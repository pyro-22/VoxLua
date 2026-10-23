import { DIRS } from '../voxel/mesher.js';
import { buildGeometry, groupByCombo, materialDef, originOffset, unionBounds } from '../voxel/geometry.js';

const f6 = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6));

/**
 * Wavefront OBJ + MTL in the rest pose (OBJ has no animation): one object
 * per part, one material per unique look. OBJ can't store vertex colors or
 * emission strength, so prefer GLB for Godot. Textured models reference
 * `<name>_atlas.png`, which the caller saves next to them.
 * @param parts [{ name, mesh }]
 * @returns {{ obj: string, mtl: string, atlasFile: string | null }}
 */
export function exportOBJ(parts, { scale = 0.1, origin = 'bottom', name = 'model', atlas = null } = {}) {
  const live = parts.filter((p) => p.mesh && p.mesh.count);
  const offset = originOffset(unionBounds(live.map((p) => p.mesh)), origin, scale);
  const textured = !!atlas && live.some((p) => p.mesh.combos.some((c) => c.tex));
  const atlasFile = textured ? `${name}_atlas.png` : null;
  const o = [`# Exported from VoxLua`, `mtllib ${name}.mtl`];
  for (const d of DIRS) o.push(`vn ${d[0]} ${d[1]} ${d[2]}`);
  const mtl = [`# Exported from VoxLua`];

  let vertex = 1;
  let texVertex = 1; // vt lines are numbered separately from v lines
  let materialIndex = 0;
  for (const part of live) {
    const mesh = part.mesh;
    o.push(`o ${part.name}`);
    for (const g of groupByCombo(mesh)) {
      const { rgb, alpha, mat, tex } = g.combo;
      const def = materialDef(mat);
      const hex = rgb.toString(16).padStart(6, '0');
      const mname = `m${materialIndex++}_${def.id}_${hex}${alpha < 255 ? `_a${Math.round((alpha / 255) * 100)}` : ''}${tex ? `_t${tex}` : ''}`;
      const r = ((rgb >> 16) & 255) / 255, gr = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
      const spec = def.metalness > 0 ? [r, gr, b] : [0.5 * (1 - def.roughness), 0.5 * (1 - def.roughness), 0.5 * (1 - def.roughness)];
      mtl.push(
        '', `newmtl ${mname}`,
        `Kd ${f6(r)} ${f6(gr)} ${f6(b)}`,
        `Ka 0 0 0`,
        `Ks ${f6(spec[0])} ${f6(spec[1])} ${f6(spec[2])}`,
        `Ns ${f6((1 - def.roughness) ** 2 * 900 + 10)}`,
        `d ${f6(alpha / 255)}`,
        `Pr ${f6(def.roughness)}`,
        `Pm ${f6(def.metalness)}`,
        def.emissive ? `Ke ${f6(r)} ${f6(gr)} ${f6(b)}` : `Ke 0 0 0`,
        `illum 2`,
      );
      if (tex && textured) mtl.push(`map_Kd ${atlasFile}`);

      o.push(`usemtl ${mname}`);
      const geo = buildGeometry(mesh, g.faces, { scale, offset, atlas: tex && textured ? atlas : null });
      const pos = geo.attributes.position.array;
      const uv = geo.attributes.uv?.array;
      const faces = [];
      for (let f = 0; f < g.faces.length; f++) {
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          o.push(`v ${f6(pos[i * 3])} ${f6(pos[i * 3 + 1])} ${f6(pos[i * 3 + 2])}`);
          if (uv) o.push(`vt ${f6(uv[i * 2])} ${f6(uv[i * 2 + 1])}`);
        }
        const n = (g.faces[f] % 6) + 1;
        const ref = (k) => (uv ? `${vertex + k}/${texVertex + k}/${n}` : `${vertex + k}//${n}`);
        faces.push(`f ${ref(0)} ${ref(1)} ${ref(2)} ${ref(3)}`);
        vertex += 4;
        if (uv) texVertex += 4;
      }
      geo.dispose();
      o.push(...faces);
    }
  }

  return { obj: o.join('\n') + '\n', mtl: mtl.join('\n') + '\n', atlasFile };
}
