// Canonical text form of the animation data: what the Animation tab shows
// after a mouse edit. One key per line, grouped by part, so diffs stay small
// and the file is easy to edit by hand (or by Claude).

const HEADER = `-- Animation keyframes. Edit them here, or with the mouse in Animate mode
-- (mouse edits rewrite this tab in this plain form).
--
--   clip "name" { fps = 12, frames = 24, loop = true }
--   key(part, frame, { pos = { x, y, z }, rot = { x, y, z }, scale = s, interp = "ease" })
--
-- pos is an offset in voxels, rot is in degrees around the part's pivot, scale is a
-- number or { x, y, z }. interp (linear, ease, in, out, step) shapes the motion from
-- this key to the next one. Lua works here too: loops can generate keys.
`;

export const DEFAULT_ANIM_TEXT = `${HEADER}`;

const num = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(3)));
const vec = (v) => `{ ${v.map(num).join(', ')} }`;

export function serializeKey(k) {
  const props = [];
  if (k.pos) props.push(`pos = ${vec(k.pos)}`);
  if (k.rot) props.push(`rot = ${vec(k.rot)}`);
  if (k.scale !== undefined) props.push(`scale = ${Array.isArray(k.scale) ? vec(k.scale) : num(k.scale)}`);
  if (k.interp && k.interp !== 'linear') props.push(`interp = "${k.interp}"`);
  return `key("${k.part}", ${k.frame}, { ${props.join(', ')} })`;
}

/** @param partOrder part names in tab order, so keys group the same way as the tabs */
export function serializeAnim(anim, partOrder = []) {
  const rank = (name) => { const i = partOrder.indexOf(name); return i < 0 ? 1e9 : i; };
  const out = [HEADER];
  for (const clip of anim.clips) {
    out.push(`clip "${clip.name}" { fps = ${num(clip.fps)}, frames = ${clip.frames}, loop = ${clip.loop} }`);
    const keys = [...clip.keys].sort((a, b) => rank(a.part) - rank(b.part) || a.part.localeCompare(b.part) || a.frame - b.frame);
    let last = null;
    for (const k of keys) {
      if (last !== null && k.part !== last) out.push('');
      out.push(serializeKey(k));
      last = k.part;
    }
    out.push('');
  }
  return out.join('\n');
}
