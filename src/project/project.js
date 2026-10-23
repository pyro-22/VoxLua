// A project = parts (one voxel() script each, with pivot and parent) plus
// the Animation tab text. Saved as a folder:
//   project.json      structure (parts, pivots, parents)
//   parts/<name>.lua  one script per part
//   animations.lua    keyframes as Lua (see src/anim/format.js)
// or as a single .voxlua.json bundle where folders aren't available.
import { DEFAULT_ANIM_TEXT } from '../anim/format.js';

const DRAFT_KEY = 'voxlua.project.v1';
const OLD_DRAFT_KEY = 'voxlua.draft.v1';

let nextId = 1;
export const uid = () => `p${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Part names are used as Lua strings, file names and Godot node names. */
export function cleanName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
}

export function uniqueName(project, base, exceptId = null) {
  const taken = new Set(project.parts.filter((p) => p.id !== exceptId).map((p) => p.name));
  let name = cleanName(base), i = 2;
  while (taken.has(name)) name = `${cleanName(base)}_${i++}`;
  return name;
}

/** hidden only affects the editor's view; hidden parts are still exported. */
export function makePart(name, code, pivot = [0, 0, 0], parent = null, hidden = false) {
  return { id: uid(), name: cleanName(name), code, pivot: [...pivot], parent, hidden };
}

export function newProject(code, name = 'untitled') {
  return { name, parts: [makePart('main', code)], animText: DEFAULT_ANIM_TEXT, anim: { clips: [] } };
}

/** A single .lua script opened on its own becomes a one-part project. */
export function projectFromScript(text, fileName) {
  const base = fileName.replace(/\.lua$/i, '');
  return { name: base, parts: [makePart(base, text)], animText: DEFAULT_ANIM_TEXT, anim: { clips: [] } };
}

/** True when the project is just one script with no animation (saves as a plain .lua). */
export function isSimple(project) {
  return project.parts.length === 1 && !project.anim.clips.length && !project.parts[0].parent;
}

/** Parts ordered so every parent comes before its children. */
export function partOrder(project) {
  const byName = new Map(project.parts.map((p) => [p.name, p]));
  const out = [], seen = new Set();
  const visit = (p, depth = 0) => {
    if (seen.has(p.id) || depth > 64) return;
    const parent = p.parent && byName.get(p.parent);
    if (parent && parent !== p) visit(parent, depth + 1);
    seen.add(p.id);
    out.push(p);
  };
  project.parts.forEach((p) => visit(p));
  return out;
}

/** Would making `parentName` the parent of `part` create a loop? */
export function wouldCycle(project, part, parentName) {
  const byName = new Map(project.parts.map((p) => [p.name, p]));
  let cur = byName.get(parentName);
  for (let i = 0; cur && i < 64; i++) {
    if (cur.id === part.id) return true;
    cur = cur.parent ? byName.get(cur.parent) : null;
  }
  return false;
}

// ---------------------------------------------------------------- folder / bundle

export function toFolderFiles(project) {
  const meta = {
    version: 1,
    name: project.name,
    parts: project.parts.map((p) => ({
      name: p.name, file: `parts/${p.name}.lua`, pivot: p.pivot, parent: p.parent, ...(p.hidden ? { hidden: true } : {}),
    })),
    animation: 'animations.lua',
  };
  return [
    { path: 'project.json', text: JSON.stringify(meta, null, 2) + '\n' },
    ...project.parts.map((p) => ({ path: `parts/${p.name}.lua`, text: p.code })),
    { path: 'animations.lua', text: project.animText },
  ];
}

/** @param files Map of relative path -> text */
export function fromFolderFiles(files, folderName = 'project') {
  const meta = JSON.parse(files.get('project.json'));
  const parts = (meta.parts || []).map((p) => {
    const code = files.get(p.file);
    if (code == null) throw new Error(`missing ${p.file}`);
    return makePart(p.name, code, p.pivot || [0, 0, 0], p.parent || null, !!p.hidden);
  });
  if (!parts.length) throw new Error('project.json lists no parts');
  return {
    name: meta.name || folderName,
    parts,
    animText: files.get(meta.animation || 'animations.lua') ?? DEFAULT_ANIM_TEXT,
    anim: { clips: [] },
  };
}

export function toBundle(project) {
  const files = Object.fromEntries(toFolderFiles(project).map((f) => [f.path, f.text]));
  return JSON.stringify({ voxlua: 1, files }, null, 2);
}

export function fromBundle(text, fileName) {
  const data = JSON.parse(text);
  if (!data.files) throw new Error('not a VoxLua project file');
  return fromFolderFiles(new Map(Object.entries(data.files)), fileName.replace(/\.voxlua\.json$|\.json$/i, ''));
}

// ---------------------------------------------------------------- draft (browser storage)

export function saveDraft(project, extra = {}) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: project.name,
      parts: project.parts.map(({ name, code, pivot, parent, hidden }) => ({ name, code, pivot, parent, hidden })),
      animText: project.animText,
      ...extra,
    }));
  } catch { /* storage unavailable */ }
}

/** Last session's project, migrating the old single-script draft. Returns { project, extra } or null. */
export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && d.parts?.length) {
      const { name, parts, animText, ...extra } = d;
      return {
        project: {
          name,
          parts: parts.map((p) => makePart(p.name, p.code, p.pivot, p.parent, !!p.hidden)),
          animText: animText ?? DEFAULT_ANIM_TEXT,
          anim: { clips: [] },
        },
        extra,
      };
    }
    const old = JSON.parse(localStorage.getItem(OLD_DRAFT_KEY));
    if (old?.text) return { project: projectFromScript(old.text, old.name || 'untitled.lua'), extra: { dirty: old.dirty } };
  } catch { /* storage unavailable or corrupt */ }
  return null;
}
