// Turns voxel data into the list of visible faces. Geometry is built from
// that list separately for the preview and for each export format.

export const DIRS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// Four corners per face (offsets from the voxel center), counter-clockwise
// seen from outside. Winding is checked against the normal so it can't drift.
export const FACE_CORNERS = DIRS.map((d) => {
  const axis = d.findIndex((v) => v !== 0);
  const [u, v] = [0, 1, 2].filter((a) => a !== axis);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([cu, cv]) => {
    const p = [0, 0, 0];
    p[axis] = d[axis] * 0.5;
    p[u] = cu * 0.5;
    p[v] = cv * 0.5;
    return p;
  });
  const e1 = sub(corners[1], corners[0]);
  const e2 = sub(corners[2], corners[0]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0 ? corners.reverse() : corners;
});

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/**
 * @param model {radius, count, idx, rgb, alpha, mat, tex, texsets, textureNames} from the Lua worker
 * @param cutoutSets cutoutSets[texset - 1] is true when that texset has see-through pixels
 * @returns mesh data: combos (unique color+alpha+material+texset), per-voxel coords,
 *          and visible faces encoded as voxel * 6 + dir.
 */
export function meshVoxels(model, cutoutSets = []) {
  const { radius: R, count, idx, rgb, alpha, mat } = model;
  const tex = model.tex || new Uint16Array(count);
  const S = 2 * R + 1;
  const S2 = S * S;
  const grid = new Int32Array(S * S2);
  for (let i = 0; i < count; i++) grid[idx[i]] = i + 1;

  const comboIds = new Map();
  const combos = [];
  const comboOf = new Int32Array(count);
  const coords = new Int16Array(count * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < count; i++) {
    const key = ((rgb[i] * 256 + alpha[i]) * 16 + mat[i]) * 4096 + tex[i];
    let c = comboIds.get(key);
    if (c === undefined) {
      c = combos.length;
      comboIds.set(key, c);
      combos.push({ rgb: rgb[i], alpha: alpha[i], mat: mat[i], tex: tex[i], cutout: !!cutoutSets[tex[i] - 1] });
    }
    comboOf[i] = c;
    const p = idx[i];
    const x = p % S, y = Math.floor(p / S) % S, z = Math.floor(p / S2);
    coords[i * 3] = x - R;
    coords[i * 3 + 1] = y - R;
    coords[i * 3 + 2] = z - R;
    if (x - R < min[0]) min[0] = x - R;
    if (y - R < min[1]) min[1] = y - R;
    if (z - R < min[2]) min[2] = z - R;
    if (x - R > max[0]) max[0] = x - R;
    if (y - R > max[1]) max[1] = y - R;
    if (z - R > max[2]) max[2] = z - R;
  }

  // Solid = hides whatever is behind it: fully opaque and no texture holes.
  const solid = new Uint8Array(count);
  for (let i = 0; i < count; i++) solid[i] = alpha[i] === 255 && !combos[comboOf[i]].cutout ? 1 : 0;

  // A face is drawn when the neighbour can't fully hide it:
  //  opaque voxel      -> neighbour empty or not solid (cut-outs keep inner faces, like leaves in block games)
  //  see-through voxel -> neighbour not solid, with a different look
  const faces = [];
  for (let i = 0; i < count; i++) {
    const x = coords[i * 3] + R, y = coords[i * 3 + 1] + R, z = coords[i * 3 + 2] + R;
    const opaque = alpha[i] === 255;
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      let j = -1;
      if (nx >= 0 && ny >= 0 && nz >= 0 && nx < S && ny < S && nz < S) j = grid[nz * S2 + ny * S + nx] - 1;
      let visible;
      if (j < 0) visible = true;
      else if (opaque) visible = !solid[j];
      else visible = !solid[j] && comboOf[j] !== comboOf[i];
      if (visible) faces.push(i * 6 + d);
    }
  }

  return {
    radius: R,
    count,
    grid, // voxel index + 1 per cell (0 = empty), for lookups like hovering
    combos,
    comboOf,
    coords,
    texsets: model.texsets || [],
    textureNames: model.textureNames || [],
    faces: Uint32Array.from(faces),
    bounds: count ? { min, max } : null,
  };
}
