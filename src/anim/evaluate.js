// Keyframe evaluation and editing. A clip is
//   { name, fps, frames, loop, keys: [{ part, frame, pos?, rot?, scale?, interp? }] }
// Each property (pos, rot, scale) is its own channel: it interpolates only
// between keys that set it. A key's interp shapes the segment after it.

export const INTERPS = ['linear', 'ease', 'in', 'out', 'step'];
const EASE = {
  linear: (t) => t,
  ease: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  step: () => 0,
};
const PROPS = ['pos', 'rot', 'scale'];
const DEFAULT = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };

const asVec = (prop, v) => (prop === 'scale' && typeof v === 'number' ? [v, v, v] : v);

/** Pose of one part at a (possibly fractional) frame: { pos, rot, scale } as arrays. */
export function evaluate(clip, part, frame) {
  const pose = { pos: [...DEFAULT.pos], rot: [...DEFAULT.rot], scale: [...DEFAULT.scale] };
  if (!clip) return pose;
  for (const prop of PROPS) {
    let a = null, b = null;
    for (const k of clip.keys) {
      if (k.part !== part || k[prop] === undefined) continue;
      if (k.frame <= frame && (!a || k.frame > a.frame)) a = k;
      if (k.frame > frame && (!b || k.frame < b.frame)) b = k;
    }
    if (!a && !b) continue;
    if (!a) { pose[prop] = [...asVec(prop, b[prop])]; continue; }
    if (!b) { pose[prop] = [...asVec(prop, a[prop])]; continue; }
    const t = EASE[a.interp || 'linear']((frame - a.frame) / (b.frame - a.frame));
    const va = asVec(prop, a[prop]), vb = asVec(prop, b[prop]);
    pose[prop] = va.map((v, i) => v + (vb[i] - v) * t);
  }
  return pose;
}

export function partHasKeys(clip, part) {
  return !!clip && clip.keys.some((k) => k.part === part);
}

export function findKey(clip, part, frame) {
  return clip.keys.find((k) => k.part === part && k.frame === frame) || null;
}

/** Merges props into the key at (part, frame), creating it if needed. */
export function setKey(clip, part, frame, props) {
  let k = findKey(clip, part, frame);
  if (!k) clip.keys.push((k = { part, frame }));
  Object.assign(k, props);
  return k;
}

export function deleteKey(clip, part, frame) {
  clip.keys = clip.keys.filter((k) => !(k.part === part && k.frame === frame));
}

/** Moves (or copies) a key to another frame, replacing whatever key was there. */
export function moveKey(clip, part, from, to, copy = false) {
  const k = findKey(clip, part, from);
  if (!k || from === to) return;
  clip.keys = clip.keys.filter((o) => !(o.part === part && o.frame === to));
  if (copy) clip.keys.push({ ...structuredClone(k), frame: to });
  else k.frame = to;
}

export function renamePartInKeys(anim, from, to) {
  for (const clip of anim.clips) for (const k of clip.keys) if (k.part === from) k.part = to;
}
