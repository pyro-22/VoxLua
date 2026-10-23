// Runs user scripts off the main thread so a slow script never freezes the UI.
// The main thread kills this worker if it stops answering (see runtime.js).
import { LuaFactory } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import runnerSrc from './runner.lua?raw';
import animRunnerSrc from './anim_runner.lua?raw';
import { PALETTE, MATERIALS, INSTRUCTION_BASE, INSTRUCTIONS_PER_CELL } from './api.js';

const factory = new LuaFactory(wasmUrl);
const PALETTE_STR = PALETTE.map(([n, h]) => `${n}=${h}`).join(',');
const MATERIALS_STR = MATERIALS.map((m) => m.id).join(',');
const GLASS_ALPHA = MATERIALS.find((m) => m.id === 'glass').defaultAlpha;

// The Animation tab: Lua that declares clips and keys -> { clips } data.
async function parseAnimation(id, code) {
  let lua = null;
  try {
    lua = await factory.createEngine({ injectObjects: false, enableProxy: false });
    const g = lua.global;
    g.set('__SRC', code);
    g.set('__LIMIT', INSTRUCTION_BASE);
    lua.doStringSync(animRunnerSrc);
    if (g.get('__STATUS') === 'ok') {
      self.postMessage({ id, ok: true, anim: JSON.parse(g.get('__JSON')) });
    } else {
      self.postMessage({ id, ok: false, error: { kind: 'animation', message: g.get('__ERR_MSG'), line: g.get('__ERR_LINE') || 0, at: null } });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: { kind: 'internal', message: String(err && err.message || err), line: 0, at: null } });
  } finally {
    if (lua) lua.global.close();
  }
}

self.onmessage = async ({ data: { id, mode, code, radius, textures = [] } }) => {
  if (mode === 'anim') return parseAnimation(id, code);
  const t0 = performance.now();
  let lua = null;
  try {
    lua = await factory.createEngine({ injectObjects: false, enableProxy: false });
    const g = lua.global;
    g.set('__SRC', code);
    g.set('__RADIUS', radius);
    g.set('__PALETTE', PALETTE_STR);
    g.set('__MATERIALS', MATERIALS_STR);
    g.set('__GLASS_ALPHA', GLASS_ALPHA);
    g.set('__TEXTURES', textures.join(','));
    g.set('__LIMIT', INSTRUCTION_BASE + INSTRUCTIONS_PER_CELL * (2 * radius + 1) ** 3);
    lua.doStringSync(runnerSrc);

    const prints = g.get('__PRINTS') || '';
    const ms = performance.now() - t0;
    if (g.get('__STATUS') !== 'ok') {
      const at = g.get('__ERR_AT');
      self.postMessage({
        id, ok: false, prints, ms,
        error: {
          kind: g.get('__ERR_KIND'),
          message: g.get('__ERR_MSG'),
          line: g.get('__ERR_LINE') || 0,
          at: at ? at.split(',').map(Number) : null,
        },
      });
      return;
    }
    const count = g.get('__COUNT');
    const model = parseData(g.get('__DATA'), count, radius);
    const sets = g.get('__TEXSETS');
    model.texsets = sets ? sets.split(';').map((s) => s.split(',').map(Number)) : [];
    model.textureNames = textures;
    self.postMessage({ id, ok: true, prints, ms, model },
      [model.idx.buffer, model.rgb.buffer, model.alpha.buffer, model.mat.buffer, model.tex.buffer]);
  } catch (err) {
    self.postMessage({
      id, ok: false, prints: '', ms: performance.now() - t0,
      error: { kind: 'internal', message: String(err && err.message || err), line: 0, at: null },
    });
  } finally {
    if (lua) lua.global.close();
  }
};

// "index,rgb,alpha,mat,texset,index,..." -> typed arrays. Hand-rolled: split()
// on a multi-megabyte string is several times slower.
function parseData(str, count, radius) {
  const idx = new Int32Array(count);
  const rgb = new Uint32Array(count);
  const alpha = new Uint8Array(count);
  const mat = new Uint8Array(count);
  const tex = new Uint16Array(count);
  const cols = [idx, rgb, alpha, mat, tex];
  let field = 0, v = 0, k = 0;
  for (let i = 0, n = str.length; i <= n; i++) {
    const c = i < n ? str.charCodeAt(i) : 44;
    if (c === 44) {
      cols[field][k] = v;
      v = 0;
      if (++field === 5) { field = 0; k++; }
    } else {
      v = v * 10 + (c - 48);
    }
  }
  return { radius, count, idx, rgb, alpha, mat, tex };
}
