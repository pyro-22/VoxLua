import * as THREE from 'three';
import { BUILTIN_TEXTURES } from './builtin.js';

// All textures the scripts can use: built-ins plus images the user adds.
// Everything is packed into one atlas image so a whole model needs a single
// texture (one draw call in the preview, one image in the exported file).

const STORAGE_KEY = 'voxlua.textures.v1';
const MAX_TILE = 256;

/** "My Brick Wall.png" -> "my_brick_wall" */
export function textureName(fileName) {
  return fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'texture';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not a readable image'));
    img.src = src;
  });
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export class TextureLibrary {
  constructor() {
    /** @type {{name: string, image: CanvasImageSource, builtin: boolean, dataUrl?: string}[]} */
    this.items = Object.entries(BUILTIN_TEXTURES).map(([name, draw]) => ({ name, image: draw(), builtin: true }));
    this._atlas = null;
    this.onChange = null;
  }

  names() { return this.items.map((t) => t.name); }

  /** Restores user textures saved in a previous session. */
  async load() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { /* storage unavailable */ }
    for (const { name, dataUrl } of saved) {
      try { this.items.push({ name, image: await loadImage(dataUrl), builtin: false, dataUrl }); } catch { /* skip broken entry */ }
    }
    this._changed(false);
  }

  /** Adds image files. Returns { added: [names], errors: [messages] }. */
  async addFiles(files) {
    const added = [], errors = [];
    for (const file of files) {
      try {
        let name = textureName(file.name);
        const existing = this.items.find((t) => t.name === name);
        if (existing?.builtin) name = `${name}_2`;
        const dataUrl = await readDataUrl(file);
        const image = await loadImage(dataUrl);
        const item = { name, image, builtin: false, dataUrl };
        const i = this.items.findIndex((t) => t.name === name);
        if (i >= 0) this.items[i] = item; else this.items.push(item);
        added.push(name);
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    if (added.length) this._changed(true);
    return { added, errors };
  }

  remove(name) {
    const i = this.items.findIndex((t) => t.name === name && !t.builtin);
    if (i < 0) return;
    this.items.splice(i, 1);
    this._changed(true);
  }

  _changed(save) {
    this._atlas?.texture.dispose();
    this._atlas = null;
    if (save) {
      const user = this.items.filter((t) => !t.builtin).map(({ name, dataUrl }) => ({ name, dataUrl }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      } catch {
        this.saveError = 'Textures could not be saved for next time (browser storage is full). They work until you reload.';
      }
    }
    if (this.onChange) this.onChange();
  }

  /**
   * The atlas: every texture scaled to one tile size, with a 1px border
   * copied from each tile's edge so neighbours never bleed in, plus a white
   * tile for untextured faces of a textured cube.
   * tiles: name -> {u0, v0, u1, v1} (three.js UVs, v = 0 at the bottom)
   */
  atlas() {
    if (this._atlas) return this._atlas;
    const sizes = this.items.map((t) => Math.max(t.image.width, t.image.height));
    const T = Math.min(MAX_TILE, Math.max(16, ...sizes));
    const P = T + 2;
    const count = this.items.length + 1;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * P;
    canvas.height = rows * P;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    const tiles = new Map();
    const hasAlpha = new Map();
    const W = canvas.width, H = canvas.height;
    const rect = (x, y) => ({ u0: (x + 1) / W, u1: (x + 1 + T) / W, v0: 1 - (y + 1 + T) / H, v1: 1 - (y + 1) / H });

    const slot = (i) => [(i % cols) * P, Math.floor(i / cols) * P];
    const [wx, wy] = slot(0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(wx, wy, P, P);
    const white = rect(wx, wy);

    this.items.forEach((t, i) => {
      const [x, y] = slot(i + 1);
      ctx.drawImage(t.image, x + 1, y + 1, T, T);
      // Extrude the edge pixels into the border.
      ctx.drawImage(canvas, x + 1, y + 1, T, 1, x + 1, y, T, 1);
      ctx.drawImage(canvas, x + 1, y + T, T, 1, x + 1, y + T + 1, T, 1);
      ctx.drawImage(canvas, x + 1, y, 1, P, x, y, 1, P);
      ctx.drawImage(canvas, x + T, y, 1, P, x + T + 1, y, 1, P);
      const data = ctx.getImageData(x + 1, y + 1, T, T).data;
      let alpha = false;
      for (let k = 3; k < data.length; k += 4) if (data[k] < 250) { alpha = true; break; }
      tiles.set(t.name, rect(x, y));
      hasAlpha.set(t.name, alpha);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.name = 'voxel_atlas';
    this._atlas = { canvas, texture, tiles, white, hasAlpha, tileSize: T };
    return this._atlas;
  }
}
