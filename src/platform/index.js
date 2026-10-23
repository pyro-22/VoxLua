// Everything that touches the user's files goes through `platform`, so the
// desktop build only has to provide a different implementation.
//
// Interface (all async; return null when the user cancels a dialog):
//   openText({ description, extensions })      -> { name, text, handle }
//   saveText({ name, text, handle, saveAs })   -> { name, handle }
//   saveBinary({ name, data, mime, description, extensions }) -> { name }
//   saveFiles([{ name, data, mime }])          -> { folder }   (several files side by side)
//   openImages()                               -> [File]       (images for the texture library)
//   openFolder()                               -> { name, files: Map(path -> text), handle }
//   saveFolder({ handle, files: [{ path, text }] }) -> { name, handle }
//   canSaveFolder                              boolean: folders available (else projects save as one .voxlua.json)
// saveText also takes { description, extensions } for its file dialog.
//
// For Electron: expose an object with these methods from the preload script
// as `window.voxelNative` (contextBridge.exposeInMainWorld) and it is used
// instead of the browser version below.
import { webPlatform } from './web.js';

export const platform = globalThis.voxelNative ?? webPlatform;
