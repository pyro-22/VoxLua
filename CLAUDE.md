# VoxLua

Replicube-style voxel model creator: a Lua script defines `voxel(x, y, z)`, which returns a color
(plus optional opacity, material, texture) per grid cell; the app previews it in 3D, animates it, and
exports GLB / OBJ for Godot. Browser app (Vite), to be packaged with Electron — keep that path open.

## Commands

```bash
npm run dev      # http://localhost:5173 (strictPort on purpose: localStorage is per origin+port)
npm run build    # static build in dist/, relative paths so it loads from file:// (Electron)
```

No test runner. To check Lua changes, run `src/lua/runner.lua` through wasmoon in Node
(load the runner text, set the `__*` input globals as `lua.worker.js` does, call `doStringSync`,
read `__STATUS` / `__DATA` / `__ERR_*`; `anim_runner.lua` works the same way). Then verify in a
browser. In dev, `window.__voxlua` exposes `{ viewport, editor, animator, project, results }` for debugging.

If port 5173 is already taken, a dev server is probably running; don't start a second one on it.

## Data flow

```
editor text ──► LuaRuntime (main thread) ──► lua.worker.js ──► runner.lua (fresh Lua state per run)
                                                   │ "__DATA": idx,rgb,alpha,mat,texset per voxel
                                                   ▼
            meshVoxels() (mesher.js) ── visible faces + "combos" (unique rgb+alpha+mat+texset)
                 │
                 ├─► Viewport.setParts()   preview rig: one pivot node per part, meshes grouped by material/transparency/texture
                 ├─► exportGLB()           node per part + animation clips; one surface per combo (≤256, else vertex colors)
                 └─► exportOBJ()           rest pose, object per part, material per combo, + atlas PNG if textured

Animation tab text ──► LuaRuntime.runAnimation (second worker) ──► anim_runner.lua ──► { clips } ──► Animator
Animator edits (gizmo, timeline, pose fields) ──► serializeAnim() ──► Animation tab text
```

## Layout

| Path | Role |
|---|---|
| `src/main.js` | App wiring: project state, part tabs (eye/gear icons from `ICON`), visibility, rename, run queue (one part at a time, newest request wins), Model/Animate mode, files, export, menus, help |
| `src/project/project.js` | Project model (parts with pivot/parent/hidden + Animation tab text), folder/bundle (de)serialization, `partOrder`, `isSimple`, draft in localStorage (migrates the old single-script draft) |
| `src/anim/format.js` | Canonical Animation-tab text from data (`serializeAnim`); mouse edits rewrite the tab with it |
| `src/anim/evaluate.js` | Keyframe evaluation (per-channel pos/rot/scale, interp per segment) and key editing helpers |
| `src/anim/animator.js` | Timeline UI (rows with eye toggles), playback, pose inspector, gizmo → key (auto-key), clip management |
| `src/lua/anim_runner.lua` | Parses the Animation tab (`clip`, `key`, loops allowed) into JSON; run via `LuaRuntime.runAnimation` on its own worker |
| `src/lua/api.js` | **Single source of truth** for palette, materials, API docs (editor highlight/completion/hover and help all read it), `scriptRadius()` |
| `src/lua/runner.lua` | Sandbox env, helpers (noise/fbm/hash, rgb/hex/hsv, tex), return-value validation, instruction-count hook, error reporting |
| `src/lua/lua.worker.js` | Runs the runner in wasmoon; parses `__DATA` into typed arrays |
| `src/lua/runtime.js` | Worker lifecycle: one run at a time, a new run kills the old worker, 20 s timeout |
| `src/voxel/mesher.js` | `DIRS` / `FACE_CORNERS` (face order +x,-x,+y,-y,+z,-z), hidden-face culling, combos, `grid` lookup |
| `src/voxel/geometry.js` | BufferGeometry from face lists (positions, normals, vertex colors, atlas UVs), grouping helpers, origin offset, `MAX_SURFACES` |
| `src/viewport/viewport.js` | three.js preview: part rig + poses, TransformControls gizmo (move/rotate/scale/pivot, snapping), selective bloom (GLOW only), cell-shading shader patch, hover picking (visible parts only), render-on-demand loop |
| `src/viewport/axes.js` | Bounding box + CSS2D X/Y/Z tick labels that follow the camera |
| `src/editor/editor.js` | CodeMirror 6: Lua stream mode, CSS-variable highlight style, API decorations + swatches, completion, hover docs, error line |
| `src/export/gltf.js`, `obj.js` | Exporters (GLTFExporter for GLB; hand-written OBJ/MTL) |
| `src/textures/` | `builtin.js` (code-drawn 16×16 textures), `library.js` (user PNGs in localStorage, atlas packing, cut-out detection) |
| `src/platform/` | **All file I/O.** `index.js` picks `globalThis.voxelNative ?? webPlatform` |
| `src/audio/keysound.js` | Synthesized typing sounds (Web Audio); `blue` profile also clicks on key release |
| `src/settings.js` | Preferences in localStorage (theme, mode, sound, export options...; every access try/catch) |
| `src/examples/` | `NN-name.lua` single-script examples (first comment line = menu summary) and `NN-name/` project folders (`description` in project.json), loaded via `import.meta.glob` |
| `src/style.css` | Three themes (`light`, `amber`, `dark`) as CSS variables on `:root[data-theme]`; editor and viewport colors come from these vars |

## Script API rules (runner.lua)

- Grid is centered: x, y, z ∈ [-R, R], y up. `RADIUS = n` at the top of a script (read by regex in `scriptRadius`) overrides the toolbar.
- Return: color first, then opacity (number), material (string constant), `tex()` marker — any order; or a table `{ color, alpha=, mat=, tex= }`.
- Colors are numbers: palette index 1..16, or `CUSTOM (0x1000000) + rgb` from `rgb()/hex()/hsv()`. `0`/`nil`/`false` = empty.
- The env is strict: reading an undefined global errors ("unknown name"), which catches typos.
- Error kinds: `compile`, `runtime`, `return` (bad value; line = `voxel` definition), `api`, `timeout`, `internal`. `return f()` is a tail call that loses the line, so runtime errors fall back to the `voxel` line.
- Instruction budget = `INSTRUCTION_BASE + INSTRUCTIONS_PER_CELL * cells` (api.js), enforced by a count hook.

## Animation design

- Keyframes are data; the mouse and the Animation tab (plain Lua: `clip "name" { fps, frames, loop }` +
  `key(part, frame, { pos, rot, scale, interp })`) are two editors for the same data. Mouse edits rewrite
  the tab in canonical form, asking first if hand-written loops or comments would be lost.
- Each property (pos, rot, scale) is its own channel; a key's `interp` (linear, ease, in, out, step) shapes
  the segment after it.
- Model mode hides every animation element (timeline, Animation tab, gizmo, pose inspector) and shows the rest pose.
- Parts are tabs: each has its own `voxel()` script, name, pivot and parent; all share world coordinates.

## Conventions and gotchas

- Adding an API name, color or material: edit `api.js` (and `runner.lua` if it is a function); everything else picks it up.
- File access only through `platform` (`openText`, `saveText`, `saveBinary`, `saveFiles`, `openImages`, `openFolder`, `saveFolder`, `canSaveFolder`). Electron will provide the same object as `window.voxelNative` from preload.
- Saving: a simple project (one part, no clips, no parent) saves as `<project name>.lua`; anything else as a project folder, or a `.voxlua.json` bundle where folders aren't available. Renaming the model clears the save target (the next Save asks), and a one-part model's part is renamed with it.
- Part visibility (`part.hidden`, eye buttons on tabs and timeline rows, Alt+click = solo) is view-only: it is saved in project.json but hidden parts are still exported. Hiding a part hides only its own cubes (the holder), not its child parts.
- Keep click targets large (tab bar 44 px, icon buttons 28 px).
- Combo key packs rgb/alpha/mat/texset into one number (`((rgb*256+alpha)*16+mat)*4096+tex`) — keep fields within those ranges.
- Culling: "solid" = alpha 255 and no cut-out texture. Cut-outs keep inner faces; same-look transparent neighbours hide shared faces.
- Godot: max 256 surfaces per mesh → export falls back to vertex colors above that. glTF has no visibility, so animations use scale 0 to hide.
- Preview-only effects (cell shading, bloom) must not leak into exports.
- Rig: part pivot node (at pivot, relative to parent pivot) → holder at −pivot → meshes in world voxel coords. Export mirrors it (node at pivot·scale, geometry offset −pivot·scale). Never put `pivot` in `userData`: three.js r186 GLTFLoader treats `userData.pivot` as its own pivot convention and shifts nodes.
- Rotations are Euler XYZ in degrees in the data; export samples per frame into quaternions (sign-continuous) and adds a hold sample before a step change.
- Example projects live in `src/examples/NN-name/` in the same folder format the app saves.
- Theme-dependent 3D colors are read from CSS vars in `applyTheme()` → `viewport.setColors()`.
- Keep comment density low and match the existing style; no framework, plain DOM.

## Roadmap

See "Status and roadmap" in [README.md](README.md).
