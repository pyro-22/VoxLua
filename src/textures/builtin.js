// Built-in 16×16 pixel-art textures, drawn in code so they ship without
// image files. Seeded randomness keeps them identical on every load.

const SIZE = 16;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shade = ([r, g, b], f) => `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;

function make(seed, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  const px = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
  draw({ ctx, rand, px });
  return c;
}

// Each pixel picks one of a few brightness steps of the base color.
function speckle(px, rand, base, steps = [0.82, 0.92, 1, 1.08]) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) px(x, y, shade(base, steps[(rand() * steps.length) | 0]));
}

const GRASS = [99, 199, 77];
const DIRT = [143, 96, 62];
const STONE = [139, 147, 160];
const WOOD = [184, 132, 78];
const BARK = [104, 74, 48];

export const BUILTIN_TEXTURES = {
  grass_top: () => make(1, ({ px, rand }) => speckle(px, rand, GRASS)),

  dirt: () => make(2, ({ px, rand }) => {
    speckle(px, rand, DIRT);
    for (let i = 0; i < 10; i++) px((rand() * SIZE) | 0, (rand() * SIZE) | 0, shade(DIRT, 0.6));
  }),

  grass_side: () => make(3, ({ px, rand }) => {
    speckle(px, rand, DIRT);
    for (let x = 0; x < SIZE; x++) {
      const depth = 3 + ((rand() * 3) | 0);
      for (let y = 0; y < depth; y++) px(x, y, shade(GRASS, [0.85, 0.95, 1.05][(rand() * 3) | 0]));
    }
  }),

  stone: () => make(4, ({ px, rand }) => {
    speckle(px, rand, STONE, [0.85, 0.93, 1, 1.05]);
    for (let i = 0; i < 4; i++) {
      let x = (rand() * SIZE) | 0, y = (rand() * SIZE) | 0;
      for (let s = 0; s < 4; s++) {
        px(x, y, shade(STONE, 0.65));
        x = (x + (rand() < 0.5 ? 1 : 0)) % SIZE;
        y = (y + 1) % SIZE;
      }
    }
  }),

  brick: () => make(5, ({ px, rand }) => {
    const mortar = [206, 196, 182];
    const brick = [178, 74, 60];
    for (let y = 0; y < SIZE; y++) {
      const row = y >> 2;
      for (let x = 0; x < SIZE; x++) {
        const bx = (x + (row % 2 ? 4 : 0)) % 8;
        const isMortar = y % 4 === 3 || bx === 7;
        px(x, y, isMortar ? shade(mortar, 0.92 + rand() * 0.1) : shade(brick, 0.85 + rand() * 0.25));
      }
    }
  }),

  planks: () => make(6, ({ px, rand }) => {
    for (let y = 0; y < SIZE; y++) {
      const row = y >> 2;
      for (let x = 0; x < SIZE; x++) {
        const seam = y % 4 === 3;
        const end = (x + row * 5) % 16 === 0;
        px(x, y, seam || end ? shade(WOOD, 0.6) : shade(WOOD, 0.9 + rand() * 0.15 - (x % 5 === 2 ? 0.05 : 0)));
      }
    }
  }),

  log_side: () => make(7, ({ px, rand }) => {
    for (let x = 0; x < SIZE; x++) {
      const stripe = x % 4 === 0 ? 0.7 : 0.95;
      for (let y = 0; y < SIZE; y++) px(x, y, shade(BARK, stripe * (0.9 + rand() * 0.2)));
    }
  }),

  log_top: () => make(8, ({ px, rand }) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7) px(x, y, shade(BARK, 0.9 + rand() * 0.15));
      else px(x, y, shade(WOOD, (Math.floor(d) % 2 ? 0.82 : 1) * (0.95 + rand() * 0.08)));
    }
  }),

  // Transparent pixels make holes (cut-out), like leaves in block games.
  leaves: () => make(9, ({ px, rand }) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (rand() < 0.22) continue;
      px(x, y, shade([60, 150, 55], [0.7, 0.85, 1, 1.1][(rand() * 4) | 0]));
    }
  }),
};
