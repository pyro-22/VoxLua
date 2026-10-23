// Browser implementation. Uses the File System Access API where available
// (Chrome, Edge) so Ctrl+S saves back to the same file; elsewhere it falls
// back to a file input and downloads.

const canPickSave = typeof window.showSaveFilePicker === 'function';
const canPickOpen = typeof window.showOpenFilePicker === 'function';
const canPickFolder = typeof window.showDirectoryPicker === 'function';

function isCancel(err) {
  return err && (err.name === 'AbortError' || err.name === 'NotAllowedError');
}

function pickerTypes(description, extensions, mime = 'application/octet-stream') {
  return [{ description, accept: { [mime]: extensions } }];
}

function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function writeHandle(handle, data) {
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

export const webPlatform = {
  name: 'web',

  async openText({ description = 'Lua script', extensions = ['.lua'] } = {}) {
    if (canPickOpen) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: pickerTypes(description, extensions, 'text/plain') });
        const file = await handle.getFile();
        return { name: file.name, text: await file.text(), handle };
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = extensions.join(',');
      input.onchange = async () => {
        const file = input.files[0];
        resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },

  canSaveFolder: canPickFolder,

  async saveText({ name, text, handle = null, saveAs = false, description = 'Lua script', extensions = ['.lua'] }) {
    if (canPickSave) {
      try {
        if (!handle || saveAs) {
          handle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes(description, extensions, 'text/plain') });
        }
        await writeHandle(handle, text);
        return { name: handle.name, handle };
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    download(name, text, 'text/plain');
    return { name, handle: null };
  },

  async saveBinary({ name, data, mime, description, extensions }) {
    if (canPickSave) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes(description, extensions, mime) });
        await writeHandle(handle, data);
        return { name: handle.name };
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    download(name, data, mime);
    return { name };
  },

  /** Reads a project folder: text files at the top level and one folder deep. */
  async openFolder() {
    if (!canPickFolder) throw new Error('this browser cannot open folders; open a .voxlua.json file instead');
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const files = new Map();
      const read = async (handle, prefix, depth) => {
        for await (const [name, entry] of handle.entries()) {
          if (entry.kind === 'file' && /\.(lua|json|txt)$/i.test(name)) files.set(prefix + name, await (await entry.getFile()).text());
          else if (entry.kind === 'directory' && depth < 1) await read(entry, `${prefix}${name}/`, depth + 1);
        }
      };
      await read(dir, '', 0);
      if (!files.has('project.json')) throw new Error(`"${dir.name}" has no project.json`);
      return { name: dir.name, files, handle: dir };
    } catch (err) {
      if (isCancel(err)) return null;
      throw err;
    }
  },

  /** Writes files ([{ path, text }]) into a folder; removes .lua files in parts/ that are no longer listed. */
  async saveFolder({ handle = null, files }) {
    try {
      const dir = handle || await window.showDirectoryPicker({ mode: 'readwrite' });
      const keepParts = new Set();
      for (const f of files) {
        const segs = f.path.split('/');
        let target = dir;
        for (const s of segs.slice(0, -1)) target = await target.getDirectoryHandle(s, { create: true });
        await writeHandle(await target.getFileHandle(segs.at(-1), { create: true }), f.text);
        if (segs[0] === 'parts') keepParts.add(segs.at(-1));
      }
      try {
        const parts = await dir.getDirectoryHandle('parts');
        for await (const [name, entry] of parts.entries()) {
          if (entry.kind === 'file' && name.endsWith('.lua') && !keepParts.has(name)) await parts.removeEntry(name);
        }
      } catch { /* no parts folder */ }
      return { name: dir.name, handle: dir };
    } catch (err) {
      if (isCancel(err)) return null;
      throw err;
    }
  },

  async openImages() {
    if (canPickOpen) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: 'Images', accept: { 'image/*': ['.png', '.gif', '.webp', '.jpg', '.jpeg'] } }],
        });
        return Promise.all(handles.map((h) => h.getFile()));
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*';
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve(null);
      input.click();
    });
  },

  async saveFiles(files) {
    if (canPickFolder) {
      try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        for (const f of files) {
          const handle = await dir.getFileHandle(f.name, { create: true });
          await writeHandle(handle, f.data);
        }
        return { folder: dir.name };
      } catch (err) {
        if (isCancel(err)) return null;
        throw err;
      }
    }
    for (const f of files) download(f.name, f.data, f.mime);
    return { folder: 'Downloads' };
  },
};
