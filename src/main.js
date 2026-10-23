import { createEditor } from './editor/editor.js';
import { LuaRuntime } from './lua/runtime.js';
import { API_DOCS, MATERIALS, PALETTE, MAX_RADIUS, scriptRadius } from './lua/api.js';
import { meshVoxels } from './voxel/mesher.js';
import { MAX_SURFACES, comboTextureNames } from './voxel/geometry.js';
import { TextureLibrary } from './textures/library.js';
import { Viewport } from './viewport/viewport.js';
import { exportGLB } from './export/gltf.js';
import { exportOBJ } from './export/obj.js';
import { platform } from './platform/index.js';
import { KeySound, SOUND_PROFILES } from './audio/keysound.js';
import { loadSettings, saveSettings } from './settings.js';
import {
  newProject, projectFromScript, makePart, uniqueName, cleanName, partOrder, wouldCycle, isSimple,
  toFolderFiles, fromFolderFiles, toBundle, fromBundle, saveDraft, loadDraft,
} from './project/project.js';
import { serializeAnim } from './anim/format.js';
import { renamePartInKeys } from './anim/evaluate.js';
import { Animator } from './anim/animator.js';

const $ = (sel) => document.querySelector(sel);

const ICON = {
  eye: '<svg viewBox="0 0 24 24"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17 17 0 0 1-3.3 4.1M6.4 6.5C3.4 8.4 1.5 12 1.5 12s4 7 10.5 7a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

const settings = loadSettings();
const persist = () => saveSettings(settings);

// ---------------------------------------------------------------- examples
// Single scripts (examples/NN-name.lua) and project folders (examples/NN-name/project.json ...).
const exampleFiles = import.meta.glob('./examples/**/*.{lua,json}', { query: '?raw', import: 'default', eager: true });
const examples = [];
const folders = new Map();
for (const [path, text] of Object.entries(exampleFiles)) {
  const rel = path.replace('./examples/', '');
  const slash = rel.indexOf('/');
  if (slash < 0) examples.push({ id: rel, file: rel, text, kind: 'script' });
  else {
    const dir = rel.slice(0, slash);
    if (!folders.has(dir)) folders.set(dir, new Map());
    folders.get(dir).set(rel.slice(slash + 1), text);
  }
}
for (const [dir, files] of folders) {
  const meta = JSON.parse(files.get('project.json'));
  examples.push({ id: dir, file: dir, files, kind: 'project', summary: meta.description || '' });
}
examples.sort((a, b) => a.id.localeCompare(b.id));
for (const ex of examples) {
  const title = ex.id.replace(/^\d+-/, '').replace(/\.lua$/, '').replace(/-/g, ' ');
  ex.title = title[0].toUpperCase() + title.slice(1) + (ex.kind === 'project' ? ' (animated)' : '');
  if (ex.kind === 'script') ex.summary = (/^--\s*(.+)$/m.exec(ex.text) || [, ''])[1];
}
const exampleProject = (ex) => (ex.kind === 'project'
  ? fromFolderFiles(ex.files, ex.id.replace(/^\d+-/, ''))
  : projectFromScript(ex.text, ex.file.replace(/^\d+-/, '')));

const NEW_SCRIPT = `-- New model
function voxel(x, y, z)
  if len(x, y, z) <= R - 1 then
    return WHITE
  end
end
`;
const NEW_PART_SCRIPT = `-- A new part. It shares the grid with every other part, so draw it
-- where it should sit on the model. Set its pivot with the gear (⚙) on its tab.
function voxel(x, y, z)
  if x == 0 and z == 0 and y >= 0 and y <= 2 then
    return ORANGE
  end
end
`;

// ---------------------------------------------------------------- state
const ANIM_TAB = 'anim';
let project = null;
let activeTab = null;              // part id | ANIM_TAB
const editorStates = new Map();    // tab id -> CodeMirror state (keeps undo per tab)
const results = new Map();         // part id -> { mesh, error, prints, ms }
let animError = null;
let animCanonical = true;          // Animation tab text equals the generated form of its data
let saveTarget = null;             // { kind: 'lua' | 'folder' | 'bundle', handle }
let savedSnapshot = '';
let lastRadius = null;

const snapshot = () => JSON.stringify(toFolderFiles(project));
const isDirty = () => !!project && snapshot() !== savedSnapshot;
const partById = (id) => project.parts.find((p) => p.id === id);
const partByName = (name) => project.parts.find((p) => p.name === name);
const activePart = () => (activeTab === ANIM_TAB ? null : partById(activeTab));

/** Grid radius shared by all parts: the largest RADIUS any part sets, else the toolbar's. */
function projectRadius() {
  const set = project.parts.map((p) => scriptRadius(p.code)).filter((r) => r != null);
  return set.length ? Math.max(...set) : settings.radius;
}

// ---------------------------------------------------------------- sound
const sound = new KeySound();
sound.enabled = settings.sound;
sound.profile = settings.soundProfile;
sound.volume = settings.soundVolume;

// ---------------------------------------------------------------- editor
let draftTimer = 0;
let suppressChange = false;
const editor = createEditor($('#editor'), {
  doc: '',
  onChange(text) {
    if (suppressChange || !project) return;
    if (activeTab === ANIM_TAB) {
      project.animText = text;
      scheduleAnimParse();
    } else {
      const part = activePart();
      if (!part) return;
      part.code = text;
      updateRadiusUI();
      if (settings.autoRun) scheduleRun([part.id]);
    }
    changed();
  },
  onRun: () => runNow(),
  onSave: (saveAs) => save(saveAs),
  onOpen: () => openFile(),
  textureNames: () => textures.names(),
  onKey: (e) => sound.handleKey(e),
  onKeyUp: (e) => sound.handleKeyUp(e),
});

// ---------------------------------------------------------------- viewport, runtime, textures
const viewport = new Viewport($('#viewport'));
const runtime = new LuaRuntime();
const animRuntime = new LuaRuntime(); // separate worker: parsing never cancels a model run
const textures = new TextureLibrary();

const animator = new Animator($('#timeline'), {
  viewport,
  eyeIcons: { on: ICON.eye, off: ICON.eyeOff },
  onToggleHidden(name, solo) { const part = partByName(name); if (part) togglePartVisibility(part, solo); },
  onEdit() {
    project.animText = serializeAnim(project.anim, project.parts.map((p) => p.name));
    animCanonical = true;
    animError = null;
    if (activeTab === ANIM_TAB) setEditorText(project.animText);
    else editorStates.delete(ANIM_TAB);
    renderTabs();
    changed();
  },
  onSelectPart(name) {
    const part = partByName(name);
    if (part && activeTab !== ANIM_TAB) switchTab(part.id);
  },
  confirmRewrite() {
    if (animCanonical) return true;
    const ok = window.confirm('The Animation tab has hand-written code (comments, loops, ...).\n'
      + 'Editing keys with the mouse rewrites it as plain key() lines. Continue?');
    if (ok) animCanonical = true;
    return ok;
  },
});
if (import.meta.env.DEV) window.__voxlua = { viewport, editor, animator, get project() { return project; }, results };

viewport.onPartClick = (name) => {
  if (!name) return;
  if (settings.mode === 'animate') animator.selectPart(name, { notify: true });
  else { const part = partByName(name); if (part) switchTab(part.id); }
};
viewport.onGizmoEnd = (name, mode, values) => animator.gizmoEnd(name, mode, values);
viewport.onPivotMoved = (name, pivot) => {
  const part = partByName(name);
  if (!part) return;
  part.pivot = pivot;
  rebuildViewport();
  if (partMenuFor === part.id) fillPartMenu(part);
  setStatus('ok', `Pivot of ${name} set to (${pivot.join(', ')})`);
  changed();
};

function setEditorText(text) {
  suppressChange = true;
  editor.setDoc(text);
  suppressChange = false;
}

// ---------------------------------------------------------------- status + console
function setStatus(kind, text, stats = null) {
  $('#status-dot').className = `dot ${kind}`;
  $('#status-text').textContent = text;
  $('#status-text').title = text;
  if (stats !== null) $('#status-stats').textContent = stats;
}

const consoleBody = $('#console-body');
function consoleLine(cls, text, line = 0) {
  const div = document.createElement('div');
  div.className = cls;
  if (line) {
    const a = document.createElement('a');
    a.textContent = `line ${line}`;
    a.onclick = () => editor.goToLine(line);
    div.append(text.split('{line}')[0], a, text.split('{line}')[1] ?? '');
  } else {
    div.textContent = text;
  }
  consoleBody.append(div);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

const KIND_LABEL = {
  compile: 'Syntax error', runtime: 'Error', return: 'Bad return value', api: 'Missing voxel()',
  timeout: 'Stopped', internal: 'Internal error', animation: 'Animation error',
};

function describeError(err, withLink = false) {
  const label = KIND_LABEL[err.kind] || 'Error';
  const at = err.at ? ` (at voxel(${err.at.join(', ')}))` : '';
  if (err.kind === 'return') return `${label} from voxel()${at}: ${err.message}`;
  const where = err.line ? (withLink ? ' on {line}' : ` on line ${err.line}`) : '';
  return `${label}${where}: ${err.message}${at}`;
}

const fmt = (n) => n.toLocaleString('en-US');

/** Console, editor marks and status for whatever tab is active. */
function showActiveResult() {
  consoleBody.textContent = '';
  if (activeTab === ANIM_TAB) {
    editor.setError(animError);
    if (animError) {
      consoleLine('err', describeError(animError, true), animError.line);
      setStatus('error', describeError(animError));
    } else {
      const unknown = [...new Set(project.anim.clips.flatMap((c) => c.keys.map((k) => k.part)))].filter((n) => !partByName(n));
      if (unknown.length) consoleLine('err', `Keys for parts that don't exist: ${unknown.join(', ')}`);
      consoleLine('info', `${project.anim.clips.length} clip(s). Keys update the timeline as you type.`);
      setStatus('ok', 'Animation OK');
    }
    $('#vp-stale').hidden = true;
    return;
  }
  const part = activePart();
  const r = part && results.get(part.id);
  if (!r) { editor.setError(null); return; }
  for (const line of r.prints ? r.prints.split('\n') : []) consoleLine('print', line);
  editor.setError(r.error);
  $('#vp-stale').hidden = !(r.error && r.mesh);
  if (r.error) {
    consoleLine('err', describeError(r.error, true), r.error.line);
    setStatus('error', `${part.name}: ${describeError(r.error)}`);
  } else {
    if (!r.prints) consoleLine('info', `Ran in ${Math.round(r.ms)} ms. print() output appears here.`);
    showOkStatus();
  }
}

function showOkStatus() {
  const meshes = project.parts.map((p) => results.get(p.id)?.mesh).filter(Boolean);
  const voxels = meshes.reduce((s, m) => s + m.count, 0);
  const tris = meshes.reduce((s, m) => s + m.faces.length * 2, 0);
  const S = 2 * projectRadius() + 1;
  const broken = project.parts.filter((p) => results.get(p.id)?.error).map((p) => p.name);
  const r = activePart() && results.get(activePart().id);
  setStatus(broken.length ? 'error' : 'ok',
    broken.length ? `Errors in: ${broken.join(', ')}` : `OK · ${S}×${S}×${S} grid${project.parts.length > 1 ? ` · ${project.parts.length} parts` : ''}`,
    `${fmt(voxels)} voxels · ${fmt(tris)} triangles${r ? ` · ${Math.round(r.ms)} ms` : ''}`);
}

// ---------------------------------------------------------------- running parts
// Parts run one at a time in the worker. Newer requests cancel the run in
// progress; the cancelled part goes back in the queue.
const pending = new Set();
let loopGen = 0;
let runTimer = 0;

function scheduleRun(ids, delay = 350) {
  ids.forEach((id) => pending.add(id));
  clearTimeout(runTimer);
  runTimer = setTimeout(() => runLoop(++loopGen), delay);
}

function runAll() {
  scheduleRun(project.parts.map((p) => p.id), 0);
}

function runNow() {
  if (activeTab === ANIM_TAB) { parseAnimNow(); return; }
  const r = projectRadius();
  scheduleRun(r !== lastRadius ? project.parts.map((p) => p.id) : [activeTab], 0);
}

async function runLoop(gen) {
  const radius = projectRadius();
  if (radius !== lastRadius) project.parts.forEach((p) => pending.add(p.id)); // grid changed: everything re-runs
  setStatus('busy', 'Running…');
  while (pending.size) {
    if (gen !== loopGen) return;
    const id = pending.has(activeTab) ? activeTab : pending.values().next().value;
    pending.delete(id);
    const part = partById(id);
    if (!part) continue;
    const res = await runtime.run(part.code, radius, textures.names());
    if (res.cancelled) { pending.add(id); return; }
    if (gen !== loopGen) { pending.add(id); return; }
    handleResult(part, res);
  }
  const reframe = lastRadius !== radius;
  lastRadius = radius;
  rebuildViewport({ frame: reframe });
  showActiveResult();
  updateExportNote();
}

function handleResult(part, res) {
  const prev = results.get(part.id);
  if (!res.ok) {
    results.set(part.id, { mesh: prev?.mesh || null, error: res.error, prints: res.prints, ms: res.ms });
  } else {
    const atlas = textures.atlas();
    viewport.setAtlas(atlas);
    // Texsets with see-through pixels don't hide their neighbours' faces.
    const names = res.model.textureNames;
    const cutoutSets = res.model.texsets.map((faces) => faces.some((t) => t > 0 && atlas.hasAlpha.get(names[t - 1])));
    results.set(part.id, { mesh: meshVoxels(res.model, cutoutSets), error: null, prints: res.prints, ms: res.ms });
  }
  renderTabs();
}

function viewportParts() {
  return partOrder(project).map((p) => ({ name: p.name, mesh: results.get(p.id)?.mesh || null, pivot: p.pivot, parent: p.parent, hidden: p.hidden }));
}

function rebuildViewport({ frame = false } = {}) {
  const parts = viewportParts();
  viewport.setAtlas(textures.atlas());
  viewport.setParts(parts, { radius: projectRadius(), frame });
  animator.setParts(project.parts.map((p) => p.name), project.parts.filter((p) => p.hidden).map((p) => p.name));
  animator.applyPose();
  const any = parts.some((p) => p.mesh && p.mesh.count);
  $('#vp-empty').hidden = any || !parts.every((p) => results.has(partByName(p.name).id));
}

// ---------------------------------------------------------------- Animation tab
let animTimer = 0;
function scheduleAnimParse() {
  clearTimeout(animTimer);
  animTimer = setTimeout(parseAnimNow, 300);
}

async function parseAnimNow() {
  clearTimeout(animTimer);
  const text = project.animText;
  const res = await animRuntime.runAnimation(text);
  if (res.cancelled || text !== project.animText) return;
  if (res.ok) {
    project.anim = res.anim;
    animError = null;
    animCanonical = serializeAnim(res.anim, project.parts.map((p) => p.name)) === text;
    animator.setAnim(project.anim);
  } else {
    animError = res.error;
  }
  renderTabs();
  if (activeTab === ANIM_TAB) showActiveResult();
  updateExportNote();
}

/** Rewrites the Animation tab from data (used after renaming or deleting parts). */
function rewriteAnimText() {
  project.animText = serializeAnim(project.anim, project.parts.map((p) => p.name));
  animCanonical = true;
  if (activeTab === ANIM_TAB) setEditorText(project.animText);
  else editorStates.delete(ANIM_TAB);
}

// ---------------------------------------------------------------- tabs
function switchTab(id) {
  if (id === activeTab) return;
  if (activeTab) editorStates.set(activeTab, editor.view.state);
  activeTab = id;
  let state = editorStates.get(id);
  if (!state) {
    state = editor.newState(id === ANIM_TAB ? project.animText : partById(id).code);
    editorStates.set(id, state);
  }
  editor.setState(state);
  const part = activePart();
  if (part) animator.selectPart(part.name);
  renderTabs();
  updateRadiusUI();
  showActiveResult();
}


function renderTabs() {
  const tabs = $('#tabs');
  tabs.textContent = '';
  for (const part of project.parts) {
    const b = document.createElement('button');
    b.className = 'tab' + (part.id === activeTab ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.title = `${part.name}${part.parent ? ` (child of ${part.parent})` : ''}. Double-click to rename.`;
    if (part.hidden) b.classList.add('hidden-part');
    const eye = document.createElement('span');
    eye.className = 'tab-icon tab-eye' + (part.hidden ? ' off' : '');
    eye.innerHTML = part.hidden ? ICON.eyeOff : ICON.eye;
    eye.title = part.hidden ? 'Hidden in the view (still exported). Click to show.' : 'Hide this part in the view. Alt+click: show only this part.';
    eye.onclick = (e) => { e.stopPropagation(); togglePartVisibility(part, e.altKey); };
    b.append(eye);
    if (results.get(part.id)?.error) b.append(Object.assign(document.createElement('span'), { className: 'tab-err' }));
    b.append(Object.assign(document.createElement('span'), { className: 'tab-label', textContent: part.name }));
    const gear = document.createElement('span');
    gear.className = 'tab-icon tab-gear';
    gear.innerHTML = ICON.gear;
    gear.title = 'Part settings: name, parent, pivot';
    gear.onclick = (e) => { e.stopPropagation(); openPartMenu(part, b); };
    b.append(gear);
    b.onclick = () => switchTab(part.id);
    b.ondblclick = () => renamePart(part);
    tabs.append(b);
  }
  const a = document.createElement('button');
  a.className = 'tab tab-anim' + (activeTab === ANIM_TAB ? ' active' : '');
  if (animError) a.append(Object.assign(document.createElement('span'), { className: 'tab-err' }));
  a.append('▶ Animation');
  a.title = 'Keyframes as Lua: edit here or pose with the mouse';
  a.onclick = () => switchTab(ANIM_TAB);
  tabs.append(a);
  $('#file-name').textContent = project.name;
  $('#file-name').title = `${project.name}: click to rename`;
  const dirty = isDirty();
  $('#dirty').classList.toggle('show', dirty);
  document.title = `${dirty ? '• ' : ''}${project.name} — VoxLua`;
}

/** Eye toggle. Alt+click shows only this part (or everything again if it already was the only one). */
function togglePartVisibility(part, solo = false) {
  if (solo) {
    const alreadySolo = !part.hidden && project.parts.every((p) => p === part || p.hidden);
    for (const p of project.parts) p.hidden = alreadySolo ? false : p !== part;
  } else {
    part.hidden = !part.hidden;
  }
  rebuildViewport();
  renderTabs();
  changed();
  const hidden = project.parts.filter((p) => p.hidden).length;
  setStatus('ok', hidden ? `${hidden} part(s) hidden in the view. They are still exported.` : 'All parts visible.');
}

/** Renames the model (file and export names). A one-part model's part follows, so its .lua gets the new name. */
function renameProject() {
  const answer = window.prompt('Name for this model (used for saving and exporting):', project.name);
  if (!answer) return;
  const name = cleanName(answer);
  if (!name || name === project.name) return;
  project.name = name;
  if (project.parts.length === 1) setPartName(project.parts[0], name);
  // The old file keeps its old name on disk; the next Save asks where to put the renamed one.
  if (saveTarget) saveTarget = null;
  changed();
  setStatus('ok', `Renamed to ${name}. The next Save asks where to save it.`);
}

function addPart() {
  const name = uniqueName(project, 'part');
  const part = makePart(name, NEW_PART_SCRIPT);
  project.parts.push(part);
  switchTab(part.id);
  scheduleRun([part.id], 0);
  changed();
}

function renamePart(part) {
  const answer = window.prompt('Part name (letters, digits, _):', part.name);
  if (!answer) return;
  setPartName(part, answer);
}

function setPartName(part, wanted) {
  const name = uniqueName(project, cleanName(wanted), part.id);
  if (name === part.name) return;
  const old = part.name;
  if (!animCanonical && project.anim.clips.some((c) => c.keys.some((k) => k.part === old))
    && !window.confirm(`Renaming updates key("${old}", ...) lines by rewriting the Animation tab in plain form. Continue?`)) return;
  part.name = name;
  for (const p of project.parts) if (p.parent === old) p.parent = name;
  renamePartInKeys(project.anim, old, name);
  rewriteAnimText();
  rebuildViewport();
  renderTabs();
  changed();
}

function deletePart(part) {
  if (project.parts.length === 1) { window.alert('A model needs at least one part.'); return; }
  if (!window.confirm(`Delete the part "${part.name}" and its script?`)) return;
  project.parts = project.parts.filter((p) => p !== part);
  for (const p of project.parts) if (p.parent === part.name) p.parent = part.parent;
  for (const clip of project.anim.clips) clip.keys = clip.keys.filter((k) => k.part !== part.name);
  rewriteAnimText();
  results.delete(part.id);
  editorStates.delete(part.id);
  if (activeTab === part.id) { activeTab = null; switchTab(project.parts[0].id); }
  closePartMenu();
  rebuildViewport();
  renderTabs();
  changed();
}

// ---------------------------------------------------------------- part settings menu
let partMenuFor = null;
const partMenu = $('#part-menu');

function openPartMenu(part, anchor) {
  closeMenus();
  partMenuFor = part.id;
  fillPartMenu(part);
  const rect = anchor.getBoundingClientRect();
  partMenu.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
  partMenu.style.top = `${rect.bottom + 4}px`;
  partMenu.classList.add('open');
}

function closePartMenu() {
  partMenu.classList.remove('open');
  partMenuFor = null;
}

function fillPartMenu(part) {
  $('#part-name').value = part.name;
  const sel = $('#part-parent');
  sel.textContent = '';
  sel.add(new Option('(none)', ''));
  for (const p of project.parts) {
    if (p === part || wouldCycle(project, part, p.name)) continue;
    sel.add(new Option(p.name, p.name));
  }
  sel.value = part.parent || '';
  ['x', 'y', 'z'].forEach((a, i) => { $(`#part-p${a}`).value = part.pivot[i]; });
}

partMenu.addEventListener('click', (e) => e.stopPropagation());
$('#part-name').onchange = (e) => { const p = partById(partMenuFor); if (p) { setPartName(p, e.target.value); fillPartMenu(p); } };
$('#part-parent').onchange = (e) => {
  const p = partById(partMenuFor);
  if (!p) return;
  p.parent = e.target.value || null;
  rebuildViewport();
  renderTabs();
  changed();
};
for (const [i, a] of ['x', 'y', 'z'].entries()) {
  $(`#part-p${a}`).onchange = (e) => {
    const p = partById(partMenuFor);
    const v = parseFloat(e.target.value);
    if (!p || !Number.isFinite(v)) return;
    p.pivot = p.pivot.map((old, j) => (j === i ? v : old));
    rebuildViewport();
    changed();
  };
}
$('#part-delete').onclick = () => { const p = partById(partMenuFor); if (p) deletePart(p); };
$('#tab-add').onclick = addPart;

// ---------------------------------------------------------------- project load / save
function changed() {
  renderTabs();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(project, { dirty: isDirty() }), 400);
}

function confirmDiscard() {
  return !isDirty() || window.confirm('Discard unsaved changes to the current model?');
}

function loadProject(p, target = null, { dirty = false } = {}) {
  project = p;
  saveTarget = target;
  results.clear();
  editorStates.clear();
  pending.clear();
  animError = null;
  activeTab = null;
  lastRadius = null;
  savedSnapshot = dirty ? '' : snapshot();
  switchTab(project.parts[0].id);
  closePartMenu();
  runAll();
  parseAnimNow();
  changed();
}

async function openFile() {
  if (!confirmDiscard()) return;
  try {
    const f = await platform.openText({ description: 'VoxLua script or project', extensions: ['.lua', '.json'] });
    if (!f) return;
    if (/\.json$/i.test(f.name)) loadProject(fromBundle(f.text, f.name), { kind: 'bundle', handle: f.handle });
    else loadProject(projectFromScript(f.text, f.name), { kind: 'lua', handle: f.handle });
    setStatus('ok', `Opened ${f.name}`);
  } catch (err) {
    setStatus('error', `Could not open the file: ${err.message}`);
  }
}

async function openFolder() {
  if (!confirmDiscard()) return;
  try {
    const f = await platform.openFolder();
    if (!f) return;
    loadProject(fromFolderFiles(f.files, f.name), { kind: 'folder', handle: f.handle });
    setStatus('ok', `Opened project folder ${f.name}`);
  } catch (err) {
    setStatus('error', `Could not open the folder: ${err.message}`);
  }
}

async function save(saveAs = false) {
  try {
    let target = saveAs ? null : saveTarget;
    if (target?.kind === 'lua' && !isSimple(project)) target = null; // grew into a project: needs a folder
    let res;
    if (target?.kind === 'lua' || (!target && isSimple(project))) {
      res = await platform.saveText({ name: `${project.name}.lua`, text: project.parts[0].code, handle: target?.handle, saveAs: !target });
      if (res) saveTarget = { kind: 'lua', handle: res.handle };
    } else if (target?.kind === 'folder' || (!target && platform.canSaveFolder)) {
      res = await platform.saveFolder({ handle: target?.handle, files: toFolderFiles(project) });
      if (res) saveTarget = { kind: 'folder', handle: res.handle };
    } else {
      res = await platform.saveText({
        name: `${project.name}.voxlua.json`, text: toBundle(project), handle: target?.handle, saveAs: !target,
        description: 'VoxLua project', extensions: ['.json'],
      });
      if (res) saveTarget = { kind: 'bundle', handle: res.handle };
    }
    if (!res) return;
    project.name = cleanName(res.name.replace(/\.voxlua\.json$|\.json$|\.lua$/i, '')) || project.name;
    savedSnapshot = snapshot();
    changed();
    setStatus('ok', `Saved ${res.name}${saveTarget.kind === 'folder' ? ' (project folder)' : ''}`);
  } catch (err) {
    setStatus('error', `Could not save: ${err.message}`);
  }
}

$('#file-new').onclick = () => { closeMenus(); if (confirmDiscard()) loadProject(newProject(NEW_SCRIPT)); };
$('#file-open').onclick = () => { closeMenus(); openFile(); };
$('#file-open-folder').onclick = () => { closeMenus(); openFolder(); };
$('#file-save').onclick = () => { closeMenus(); save(false); };
$('#file-save-as').onclick = () => { closeMenus(); save(true); };
$('#file-rename').onclick = () => { closeMenus(); renameProject(); };
$('#file-name').onclick = () => renameProject();
$('#btn-run').onclick = () => runNow();

// ---------------------------------------------------------------- menus
function setupMenu(button, menu) {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
}
function closeMenus() {
  document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  partMenuFor = null;
}
document.addEventListener('click', closeMenus);

setupMenu($('#btn-file'), $('#menu-file'));
setupMenu($('#btn-examples'), $('#menu-examples'));
setupMenu($('#btn-export'), $('#menu-export'));
setupMenu($('#btn-sound'), $('#menu-sound'));
setupMenu($('#btn-textures'), $('#menu-textures'));

for (const ex of examples) {
  const b = document.createElement('button');
  b.className = 'menu-item';
  b.innerHTML = `<span></span><small></small>`;
  b.firstChild.textContent = ex.title;
  b.lastChild.textContent = ex.summary;
  b.onclick = () => {
    closeMenus();
    if (!confirmDiscard()) return;
    loadProject(exampleProject(ex));
    if (ex.kind === 'project' && settings.mode !== 'animate') setStatus('ok', 'Animated example: switch to Animate (top bar) to see the timeline.');
  };
  $('#menu-examples').append(b);
}

// ---------------------------------------------------------------- keyboard
const typingTarget = (e) => e.target.closest?.('.cm-editor, input, select, textarea');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenus(); closePartMenu(); }
  if (e.defaultPrevented) return; // the editor already handled it
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); runNow(); return; }
  if (settings.mode !== 'animate' || mod || e.altKey || typingTarget(e)) return;
  // Animate-mode shortcuts (outside the code editor and inputs)
  const k = e.key.toLowerCase();
  const actions = {
    ' ': () => animator.togglePlay(), ',': () => animator.step(-1), '.': () => animator.step(1),
    home: () => { animator.pause(); animator.setFrame(0); }, delete: () => animator.deleteSelectedKey(), backspace: () => animator.deleteSelectedKey(),
    w: () => animator.setGizmoMode('translate'), e: () => animator.setGizmoMode('rotate'), r: () => animator.setGizmoMode('scale'),
    p: () => animator.setGizmoMode('pivot'), k: () => animator.keyCurrentPose(),
  };
  if (actions[k]) { e.preventDefault(); actions[k](); }
});
// Shift turns snapping off while held.
document.addEventListener('keydown', (e) => { if (e.key === 'Shift') viewport.setSnap(false); });
document.addEventListener('keyup', (e) => { if (e.key === 'Shift') viewport.setSnap(animator._snap.checked); });
window.addEventListener('blur', () => viewport.setSnap(animator._snap.checked));

// ---------------------------------------------------------------- mode
function applyMode(mode) {
  settings.mode = mode;
  const on = mode === 'animate';
  document.body.classList.toggle('animate', on);
  $('#timeline').hidden = !on;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  if (!on && activeTab === ANIM_TAB) switchTab(project.parts[0].id);
  animator.setActive(on);
  if (on && !animator.selectedPart && activePart()) animator.selectPart(activePart().name);
}
for (const b of document.querySelectorAll('[data-mode]')) {
  b.onclick = () => { applyMode(b.dataset.mode); persist(); };
}

// ---------------------------------------------------------------- grid size
const RADII = [4, 6, 8, 10, 12, 16, 20, 24, MAX_RADIUS];
const radiusSel = $('#sel-radius');
for (const r of RADII) radiusSel.add(new Option(`R ${r}  (${2 * r + 1}³)`, r));
radiusSel.value = settings.radius;
radiusSel.onchange = () => {
  settings.radius = +radiusSel.value;
  persist();
  runAll();
};
function updateRadiusUI() {
  const set = project.parts.map((p) => scriptRadius(p.code)).filter((r) => r != null);
  if (set.length) {
    const r = Math.max(...set);
    if (![...radiusSel.options].some((o) => +o.value === r)) radiusSel.add(new Option(`R ${r}  (${2 * r + 1}³)`, r));
    radiusSel.value = r;
    radiusSel.disabled = true;
    radiusSel.title = 'Set by RADIUS = … in a script';
  } else {
    radiusSel.value = settings.radius;
    radiusSel.disabled = false;
    radiusSel.title = '';
  }
}

$('#chk-autorun').checked = settings.autoRun;
$('#chk-autorun').onchange = (e) => { settings.autoRun = e.target.checked; persist(); if (settings.autoRun) runAll(); };

// ---------------------------------------------------------------- export
$('#exp-format').value = settings.exportFormat;
$('#exp-scale').value = settings.exportScale;
$('#exp-origin').value = settings.exportOrigin;
$('#exp-anim').checked = settings.exportAnimations;
$('#exp-loop').checked = settings.exportLoopSuffix;
$('#exp-format').onchange = (e) => { settings.exportFormat = e.target.value; persist(); updateExportNote(); };
$('#exp-scale').onchange = (e) => {
  const v = parseFloat(e.target.value);
  if (v > 0) { settings.exportScale = v; persist(); } else e.target.value = settings.exportScale;
  updateExportNote();
};
$('#exp-origin').onchange = (e) => { settings.exportOrigin = e.target.value; persist(); };
$('#exp-anim').onchange = (e) => { settings.exportAnimations = e.target.checked; persist(); updateExportNote(); };
$('#exp-loop').onchange = (e) => { settings.exportLoopSuffix = e.target.checked; persist(); };

function updateExportNote() {
  const note = $('#exp-note');
  if (!project) return;
  const meshes = project.parts.map((p) => results.get(p.id)?.mesh).filter(Boolean);
  if (!meshes.length) { note.textContent = 'Run a script first.'; return; }
  const S = 2 * projectRadius() + 1;
  const looks = meshes.reduce((s, m) => s + m.combos.length, 0);
  const lines = [`${project.parts.length} part(s) · ${looks} materials · grid is ${+(S * settings.exportScale).toFixed(3)} m wide.`];
  if (settings.exportFormat === 'glb') {
    if (meshes.some((m) => m.combos.length > MAX_SURFACES)) lines.push(`A part has more than ${MAX_SURFACES} looks, so its colors are exported as vertex colors.`);
    const clips = project.anim.clips.length;
    if (clips) lines.push(settings.exportAnimations ? `${clips} animation clip(s) included.` : 'Animations not included.');
  } else {
    lines.push('OBJ is the rest pose only (no animation), and can’t store glow strength. GLB is better for Godot.');
  }
  note.textContent = lines.join(' ');
}

$('#exp-go').onclick = async () => {
  closeMenus();
  const parts = viewportParts();
  if (!parts.some((p) => p.mesh && p.mesh.count)) { setStatus('error', 'Nothing to export: run a script that produces voxels first.'); return; }
  const base = cleanName(project.name) || 'model';
  const opts = {
    scale: settings.exportScale, origin: settings.exportOrigin, name: base, atlas: textures.atlas(),
    animations: settings.exportAnimations, loopSuffix: settings.exportLoopSuffix,
  };
  const stale = project.parts.some((p) => results.get(p.id)?.error) ? ' (parts with errors use their last working version)' : '';
  try {
    if (settings.exportFormat === 'obj') {
      const { obj, mtl, atlasFile } = exportOBJ(parts, opts);
      const files = [
        { name: `${base}.obj`, data: obj, mime: 'text/plain' },
        { name: `${base}.mtl`, data: mtl, mime: 'text/plain' },
      ];
      if (atlasFile) {
        const png = await new Promise((resolve) => opts.atlas.canvas.toBlob(resolve, 'image/png'));
        files.push({ name: atlasFile, data: png, mime: 'image/png' });
      }
      const res = await platform.saveFiles(files);
      if (res) setStatus('ok', `Exported ${files.map((f) => f.name).join(' + ')} to ${res.folder}${stale}`);
    } else {
      const glb = await exportGLB(parts, project.anim, opts);
      const res = await platform.saveBinary({
        name: `${base}.glb`, data: glb, mime: 'model/gltf-binary', description: 'glTF binary model', extensions: ['.glb'],
      });
      if (res) setStatus('ok', `Exported ${res.name}${stale}`);
    }
  } catch (err) {
    setStatus('error', `Export failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------- sound menu
const profileSel = $('#snd-profile');
for (const [id, p] of Object.entries(SOUND_PROFILES)) profileSel.add(new Option(p.label, id));
profileSel.value = settings.soundProfile;
$('#snd-enabled').checked = settings.sound;
$('#snd-volume').value = settings.soundVolume;
function updateSoundButton() {
  $('#btn-sound').textContent = settings.sound ? 'Sound: on' : 'Sound: off';
  $('#btn-sound').classList.toggle('on', settings.sound);
}
$('#snd-enabled').onchange = (e) => {
  settings.sound = sound.enabled = e.target.checked;
  persist();
  updateSoundButton();
  if (sound.enabled) sound.play('key');
};
profileSel.onchange = () => { settings.soundProfile = sound.profile = profileSel.value; persist(); sound.play('key', 1); };
$('#snd-volume').oninput = (e) => { settings.soundVolume = sound.volume = +e.target.value; persist(); };
$('#snd-volume').onchange = () => sound.play('key');
$('#snd-test').onclick = () => {
  const clicky = SOUND_PROFILES[sound.profile].clicky;
  ['key', 'key', 'space', 'key', 'back', 'enter'].forEach((k, i) => {
    setTimeout(() => sound.play(k), i * 140);
    if (clicky) setTimeout(() => sound.playRelease(k), i * 140 + 75);
  });
};
updateSoundButton();

// ---------------------------------------------------------------- theme
function applyTheme(name) {
  settings.theme = name;
  document.documentElement.dataset.theme = name;
  for (const b of document.querySelectorAll('[data-theme-btn]')) {
    b.setAttribute('aria-checked', String(b.dataset.themeBtn === name));
  }
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  viewport.setColors({
    bg: v('--vp-bg'), grid1: v('--vp-grid1'), grid2: v('--vp-grid2'), box: v('--vp-box'), hover: v('--vp-hover'), accent: v('--accent'),
  });
}
for (const b of document.querySelectorAll('[data-theme-btn]')) {
  b.onclick = () => { applyTheme(b.dataset.themeBtn); persist(); };
}

// ---------------------------------------------------------------- viewport tools
function setupToggle(btn, key, apply) {
  btn.classList.toggle('on', settings[key]);
  apply(settings[key]);
  btn.onclick = () => {
    settings[key] = !settings[key];
    btn.classList.toggle('on', settings[key]);
    apply(settings[key]);
    persist();
  };
}
setupToggle($('#btn-axes'), 'showAxes', (v) => viewport.setAxesVisible(v));
setupToggle($('#btn-cells'), 'cellShading', (v) => viewport.setCellShading(v));
setupToggle($('#btn-grid'), 'showGrid', (v) => viewport.setGridVisible(v));
setupToggle($('#btn-spin'), 'spin', (v) => viewport.setSpin(v));
$('#btn-frame').onclick = () => viewport.frame();

// Coordinates of the cube under the mouse.
const coordsEl = $('#vp-coords');
viewport.onHover = (info) => {
  coordsEl.hidden = !info;
  if (!info) return;
  const { rgb, alpha, mat } = info.combo;
  const hex = '#' + rgb.toString(16).padStart(6, '0');
  const part = partByName(info.part);
  const mesh = part && results.get(part.id)?.mesh;
  const texNames = mesh ? comboTextureNames(mesh, info.combo).join(', ') : '';
  const extra = [MATERIALS[mat].id, alpha < 255 ? `${Math.round((alpha / 255) * 100)}%` : '', texNames && `tex ${texNames}`].filter(Boolean).join(' · ');
  coordsEl.innerHTML = `<span class="swatch"></span><b class="axis-x">x ${info.x}</b><b class="axis-y">y ${info.y}</b><b class="axis-z">z ${info.z}</b><span class="dim"></span>`;
  coordsEl.querySelector('.swatch').style.background = hex;
  coordsEl.querySelector('.dim').textContent = `${project.parts.length > 1 ? `${info.part} · ` : ''}${hex} · ${extra}`;
};

// ---------------------------------------------------------------- layout
const leftPane = $('.pane-left');
leftPane.style.width = `${settings.split * 100}%`;
$('#splitter').addEventListener('pointerdown', (e) => {
  const splitter = e.currentTarget;
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add('dragging');
  const rect = $('#main').getBoundingClientRect();
  const move = (ev) => {
    settings.split = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
    leftPane.style.width = `${settings.split * 100}%`;
  };
  const up = () => {
    splitter.classList.remove('dragging');
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
    persist();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});

function applyFontSize() { document.documentElement.style.setProperty('--editor-font-size', `${settings.fontSize}px`); }
$('#font-up').onclick = () => { settings.fontSize = Math.min(26, settings.fontSize + 1); applyFontSize(); persist(); };
$('#font-down').onclick = () => { settings.fontSize = Math.max(10, settings.fontSize - 1); applyFontSize(); persist(); };
applyFontSize();

const consoleEl = $('#console');
consoleEl.classList.toggle('collapsed', !settings.consoleOpen);
$('#btn-console').onclick = () => {
  settings.consoleOpen = !settings.consoleOpen;
  consoleEl.classList.toggle('collapsed', !settings.consoleOpen);
  persist();
};
$('#btn-clear').onclick = () => { consoleBody.textContent = ''; };

// ---------------------------------------------------------------- help
function buildHelp() {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const rows = (kind) => Object.entries(API_DOCS).filter(([name, d]) => d.kind === kind && name !== 'clip' && name !== 'key')
    .map(([, d]) => `<tr><td>${esc(d.sig)}</td><td>${esc(d.doc)}</td></tr>`).join('');
  $('#help-body').innerHTML = `
    <h3>How it works</h3>
    <p>Your script defines <code>voxel(x, y, z)</code>. It is called once for every cell of the grid
    (x, y, z from <code>-R</code> to <code>R</code>, with <b>y pointing up</b>). Return a color to fill the cell,
    or <code>nil</code> / nothing to leave it empty.</p>
    <pre>${esc(`function voxel(x, y, z)
  if len(x, y, z) <= 6 then
    return RED              -- palette color
  end
end`)}</pre>
    <h3>Return values</h3>
    <pre>${esc(`return RED                     -- color
return GREEN, 0.5              -- color, opacity (0-1)
return BLUE, METAL             -- color, material
return CYAN, 0.4, GLASS        -- color, opacity, material (either order)
return { GREEN, alpha = 0.5, mat = METAL }   -- table form
return rgb(255, 128, 0)        -- any color: rgb(), hex(0xff8000), hsv(0.08, 1, 1)
return nil                     -- empty (also: 0, false, or no return)`)}</pre>
    <h3>Textures</h3>
    <pre>${esc(`return tex("brick")                          -- same texture on all faces
return tex{ top = "grass_top", side = "grass_side", bottom = "dirt" }
return RED, tex("stone")                     -- tint it with a color
return tex("planks"), METAL, 0.8             -- plus material / opacity, any order
local BRICK = tex("brick")                   -- store it once, reuse it`)}</pre>
    <p>Faces: <code>all</code>, <code>side</code>, <code>top</code>, <code>bottom</code>, <code>north</code> (−z), <code>south</code> (+z),
    <code>east</code> (+x), <code>west</code> (−x). Add PNGs in the <b>Textures</b> panel or drop them on the window;
    the file name becomes the texture name. Transparent pixels become holes (good for leaves).</p>
    <h3>Parts</h3>
    <p>A model can have several <b>parts</b> (tabs above the editor, <b>+ Part</b> adds one). Each part has its own
    <code>voxel()</code> script and they all share the same grid. The gear (⚙) on a tab sets the part's <b>pivot</b>
    (the point it rotates around) and its <b>parent</b> (it moves along with the parent).</p>
    <h3>Animation</h3>
    <p>Switch to <b>Animate</b> in the top bar. Click a part, then drag the gizmo: <b>Move</b> (W), <b>Rotate</b> (E),
    <b>Scale</b> (R), <b>Pivot</b> (P). With auto-key on, releasing the mouse saves a keyframe at the current frame.
    Drag keys on the timeline to retime them (Alt+drag copies), Delete removes the selected key, Space plays.
    Snapping is on by default; hold Shift while dragging to turn it off.</p>
    <p>The <b>▶ Animation</b> tab shows the same keyframes as Lua, so animation can be written as code too:</p>
    <pre>${esc(`clip "slash" { fps = 12, frames = 16, loop = false }
key("blade", 0, { rot = { 0, 0, 0 } })
key("blade", 5, { rot = { 0, 0, 40 }, interp = "ease" })
key("blade", 8, { rot = { 0, 0, -110 }, interp = "out" })
key("flame", 7, { scale = 0, interp = "step" })   -- hidden until frame 8
key("flame", 8, { scale = 1 })

for f = 0, 24, 6 do                               -- loops can generate keys
  key("gem", f, { pos = { 0, sin(f / 24 * 2 * pi), 0 } })
end`)}</pre>
    <p><code>pos</code> is an offset in voxels, <code>rot</code> is in degrees (x, y, z), <code>scale</code> is a number
    or <code>{ x, y, z }</code>. <code>interp</code> (linear, ease, in, out, step) shapes the motion from that key to the next.</p>
    <h3>Palette</h3>
    <div class="palette-grid">${PALETTE.map(([n, h], i) => `<span><span class="swatch" style="background:#${h}"></span>${n} <small>${i + 1}</small></span>`).join('')}</div>
    <h3>Materials</h3>
    <table>${MATERIALS.map((m) => `<tr><td>${m.id.toUpperCase()}</td><td>${esc(m.doc)}</td></tr>`).join('')}</table>
    <h3>Functions</h3>
    <table>${rows('fn')}</table>
    <h3>Constants</h3>
    <table>${rows('const')}</table>
    <h3>Keys</h3>
    <table>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Run (scripts also re-run while you type when Auto-run is on)</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Save as</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>O</kbd></td><td>Open</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Space</kbd></td><td>Show completions</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>Find / replace</td></tr>
      <tr><td><kbd>Space</kbd> <kbd>,</kbd> <kbd>.</kbd></td><td>Animate mode: play / pause, previous / next frame</td></tr>
      <tr><td><kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>P</kbd> <kbd>K</kbd></td><td>Animate mode: move, rotate, scale, pivot tool; K saves the shown pose as a key</td></tr>
    </table>
    <h3>Godot</h3>
    <p>Export as <b>GLB</b> and drop the file into your Godot project. Each part becomes a node (placed at its pivot)
    under the model, and each clip becomes an animation in the AnimationPlayer; clips ending in <code>_loop</code> loop.
    Each color/opacity/material combination becomes its own surface with a StandardMaterial3D.
    <i>Voxel size</i> sets how big one cube is in meters.</p>`;
}
buildHelp();
$('#btn-help').onclick = () => $('#help').showModal();
$('#help-close').onclick = () => $('#help').close();
$('#help').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------------------------------------------------------------- textures
function renderTexturePanel() {
  const grid = $('#tex-grid');
  grid.textContent = '';
  for (const t of textures.items) {
    const item = document.createElement('div');
    item.className = 'tex-item';
    item.title = `Click to insert tex("${t.name}")`;
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t.image, 0, 0, 16, 16);
    const label = document.createElement('span');
    label.textContent = t.name;
    item.append(c, label);
    if (t.builtin) {
      const s = document.createElement('small');
      s.textContent = 'built-in';
      item.append(s);
    } else {
      const del = document.createElement('button');
      del.className = 'tex-remove ghost';
      del.textContent = '×';
      del.title = 'Remove';
      del.onclick = (e) => { e.stopPropagation(); textures.remove(t.name); };
      item.append(del);
    }
    item.onclick = () => {
      const view = editor.view;
      view.dispatch(view.state.replaceSelection(`tex("${t.name}")`));
      closeMenus();
      view.focus();
    };
    grid.append(item);
  }
  const err = $('#tex-error');
  err.hidden = !textures.saveError;
  err.textContent = textures.saveError || '';
}

async function addTextureFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const { added, errors } = await textures.addFiles(images);
  if (added.length) setStatus('ok', `Added texture${added.length > 1 ? 's' : ''}: ${added.join(', ')}. Use tex("${added[0]}")`);
  if (errors.length) setStatus('error', `Could not add: ${errors.join('; ')}`);
}

textures.onChange = () => {
  viewport.setAtlas(textures.atlas());
  renderTexturePanel();
  if (project) runAll();
};
$('#tex-add').onclick = async () => {
  try {
    const files = await platform.openImages();
    if (files) await addTextureFiles(files);
  } catch (err) {
    setStatus('error', `Could not open images: ${err.message}`);
  }
};

// Drag and drop: images become textures; a .lua or .voxlua.json file opens.
let dragDepth = 0;
const dropHint = $('#drop-hint');
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropHint.hidden = false;
});
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true; } });
document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const files = [...e.dataTransfer.files];
  const doc = files.find((f) => /\.(lua|json)$/i.test(f.name));
  if (doc && confirmDiscard()) {
    try {
      const text = await doc.text();
      loadProject(/\.json$/i.test(doc.name) ? fromBundle(text, doc.name) : projectFromScript(text, doc.name));
    } catch (err) {
      setStatus('error', `Could not open ${doc.name}: ${err.message}`);
    }
  }
  await addTextureFiles(files);
});

// ---------------------------------------------------------------- start
applyTheme(settings.theme);
renderTexturePanel();
const draft = loadDraft();
if (draft) loadProject(draft.project, null, { dirty: !!draft.extra.dirty });
else loadProject(exampleProject(examples[0]));
applyMode(settings.mode);
textures.load(); // restores saved textures, then re-runs through onChange
