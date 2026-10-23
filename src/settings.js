// Per-user preferences (the project draft lives in project/project.js). localStorage works in the
// browser and in Electron; every access is guarded because it can throw
// (private mode, blocked storage).

const KEY = 'voxlua.settings.v1';

export const DEFAULTS = {
  theme: 'dark',          // 'light' | 'amber' | 'dark'
  sound: false,
  soundProfile: 'thock',
  soundVolume: 0.5,
  autoRun: true,
  radius: 8,
  showGrid: true,
  showAxes: true,
  cellShading: true,
  spin: false,
  fontSize: 14,
  split: 0.46,
  consoleOpen: true,
  exportFormat: 'glb',    // 'glb' | 'obj'
  exportScale: 0.1,
  exportOrigin: 'bottom', // 'bottom' | 'center' | 'grid'
  exportAnimations: true,
  exportLoopSuffix: true,
  mode: 'model',          // 'model' | 'animate'
};

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function loadSettings() {
  return { ...DEFAULTS, ...(read(KEY) || {}) };
}
export function saveSettings(s) { write(KEY, s); }

