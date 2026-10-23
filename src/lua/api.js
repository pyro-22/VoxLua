// Single source of truth for the script API: palette, materials and the
// names the editor highlights, completes and documents on hover.

export const PALETTE = [
  ['BLACK', '1a1c2c'],
  ['WHITE', 'f4f4f4'],
  ['GRAY', '8b93a6'],
  ['DARK_GRAY', '3d4456'],
  ['RED', 'e43b44'],
  ['ORANGE', 'f77622'],
  ['YELLOW', 'fee761'],
  ['GREEN', '63c74d'],
  ['DARK_GREEN', '265c42'],
  ['CYAN', '2ce8f5'],
  ['BLUE', '3b6fe0'],
  ['NAVY', '262b6f'],
  ['PURPLE', '8a4fd8'],
  ['PINK', 'f47ab8'],
  ['BROWN', '8f563b'],
  ['TAN', 'e4a672'],
];

// Index in this list = material id stored per voxel.
export const MATERIALS = [
  { id: 'matte', label: 'Matte', roughness: 0.9, metalness: 0, doc: 'Rough, non-shiny surface (the default).' },
  { id: 'plastic', label: 'Plastic', roughness: 0.32, metalness: 0, doc: 'Smooth and slightly glossy.' },
  { id: 'metal', label: 'Metal', roughness: 0.35, metalness: 1, doc: 'Brushed metal tinted by the color.' },
  { id: 'chrome', label: 'Chrome', roughness: 0.05, metalness: 1, doc: 'Mirror-like polished metal.' },
  { id: 'glass', label: 'Glass', roughness: 0.04, metalness: 0, defaultAlpha: 0.35, doc: 'Glossy and see-through. Opacity defaults to 0.35.' },
  { id: 'glow', label: 'Glow', roughness: 1, metalness: 0, emissive: 1, doc: 'Emits light in its own color (emissive).' },
];

export const MIN_RADIUS = 1;
export const MAX_RADIUS = 32;
// Instruction budget for one run: a base plus an allowance per grid cell.
export const INSTRUCTION_BASE = 100_000_000;
export const INSTRUCTIONS_PER_CELL = 3_000;

const FUNCTIONS = {
  voxel: { kind: 'entry', sig: 'function voxel(x, y, z) ... end', doc: 'You write this. Called once per grid cell; return a color (plus optional opacity and material), or nil to leave the cell empty.' },
  rgb: { kind: 'fn', sig: 'rgb(r, g, b)', doc: 'Any color from red, green, blue in 0-255.' },
  hex: { kind: 'fn', sig: 'hex(0xff8800) | hex("#ff8800")', doc: 'Color from a hex number or "#rrggbb" string.' },
  hsv: { kind: 'fn', sig: 'hsv(h, s, v)', doc: 'Color from hue (0-1, wraps around), saturation and value (0-1).' },
  tex: { kind: 'fn', sig: 'tex("name") | tex{ top = "a", side = "b", bottom = "c" }', doc: 'Texture from the Textures panel. Return it alone, or with a color to tint it. Faces: all, side, top, bottom, north, south, east, west.' },
  len: { kind: 'fn', sig: 'len(x, y [, z])', doc: 'Length of a 2D or 3D vector: sqrt(x² + y² + z²).' },
  dist: { kind: 'fn', sig: 'dist(x1, y1, z1, x2, y2, z2)', doc: 'Distance between two points.' },
  clamp: { kind: 'fn', sig: 'clamp(v, lo, hi)', doc: 'Limits v to the range lo..hi.' },
  mix: { kind: 'fn', sig: 'mix(a, b, t)', doc: 'Linear blend: a when t = 0, b when t = 1.' },
  lerp: { kind: 'fn', sig: 'lerp(a, b, t)', doc: 'Same as mix.' },
  round: { kind: 'fn', sig: 'round(v)', doc: 'Rounds to the nearest integer.' },
  sign: { kind: 'fn', sig: 'sign(v)', doc: '-1, 0 or 1.' },
  noise: { kind: 'fn', sig: 'noise(x [, y, z])', doc: 'Smooth value noise in 0..1. Divide coordinates to make it larger: noise(x/8, y/8, z/8).' },
  fbm: { kind: 'fn', sig: 'fbm(x, y, z [, octaves])', doc: 'Layered noise (fractal) in 0..1. Good for terrain. Default 4 octaves.' },
  hash: { kind: 'fn', sig: 'hash(x [, y, z])', doc: 'Pseudo-random number in 0..1 that is always the same for the same integer cell.' },
  random: { kind: 'fn', sig: 'random([m [, n]])', doc: 'math.random. Seeded the same way every run, so results are repeatable.' },
  seed: { kind: 'fn', sig: 'seed(n)', doc: 'Changes the random seed.' },
  print: { kind: 'fn', sig: 'print(...)', doc: 'Writes to the console panel below the editor.' },
  abs: { kind: 'fn', sig: 'abs(v)', doc: 'math.abs' },
  floor: { kind: 'fn', sig: 'floor(v)', doc: 'math.floor' },
  ceil: { kind: 'fn', sig: 'ceil(v)', doc: 'math.ceil' },
  sqrt: { kind: 'fn', sig: 'sqrt(v)', doc: 'math.sqrt' },
  sin: { kind: 'fn', sig: 'sin(a)', doc: 'math.sin (radians)' },
  cos: { kind: 'fn', sig: 'cos(a)', doc: 'math.cos (radians)' },
  tan: { kind: 'fn', sig: 'tan(a)', doc: 'math.tan (radians)' },
  atan: { kind: 'fn', sig: 'atan(y [, x])', doc: 'math.atan; with two arguments it returns the angle of (x, y).' },
  min: { kind: 'fn', sig: 'min(a, b, ...)', doc: 'math.min' },
  max: { kind: 'fn', sig: 'max(a, b, ...)', doc: 'math.max' },
  exp: { kind: 'fn', sig: 'exp(v)', doc: 'math.exp' },
  log: { kind: 'fn', sig: 'log(v [, base])', doc: 'math.log' },
};

// Animation tab only (highlighted everywhere, harmless in part scripts).
FUNCTIONS.clip = { kind: 'fn', sig: 'clip "name" { fps = 12, frames = 24, loop = true }', doc: 'Animation tab: starts a clip. The keys after it belong to it.' };
FUNCTIONS.key = { kind: 'fn', sig: 'key(part, frame, { pos = {x,y,z}, rot = {x,y,z}, scale = s, interp = "ease" })', doc: 'Animation tab: a keyframe. pos in voxels, rot in degrees, interp: linear, ease, in, out, step.' };

const CONSTANTS = {
  R: { kind: 'const', sig: 'R', doc: 'Grid radius. x, y and z run from -R to R.' },
  SIZE: { kind: 'const', sig: 'SIZE', doc: 'Grid width in cells (2·R + 1).' },
  RADIUS: { kind: 'const', sig: 'RADIUS = 8', doc: `Put "RADIUS = n" at the top of a script (1-${MAX_RADIUS}) to choose its grid size. Overrides the toolbar.` },
  pi: { kind: 'const', sig: 'pi', doc: 'math.pi' },
};

export const API_DOCS = { ...FUNCTIONS, ...CONSTANTS };
PALETTE.forEach(([name, hex], i) => {
  API_DOCS[name] = { kind: 'color', sig: `${name}  (#${hex}, palette ${i + 1})`, doc: 'Palette color.', hex: `#${hex}` };
});
MATERIALS.forEach((m) => {
  API_DOCS[m.id.toUpperCase()] = { kind: 'mat', sig: `${m.id.toUpperCase()}  (material)`, doc: m.doc };
});

/** Reads "RADIUS = n" from the top level of a script, or null. */
export function scriptRadius(code) {
  const m = /^RADIUS\s*=\s*(\d+)/m.exec(code);
  if (!m) return null;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, parseInt(m[1], 10)));
}
