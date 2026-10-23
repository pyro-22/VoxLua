// Main-thread side of the Lua worker. One script runs at a time; starting a
// new run cancels the previous one (useful while typing with auto-run on).

const TIMEOUT_MS = 20_000;

export class LuaRuntime {
  constructor() {
    this.worker = null;
    this.pending = null;
    this.seq = 0;
  }

  _spawn() {
    this.worker = new Worker(new URL('./lua.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending;
      if (!p || p.id !== data.id) return;
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve(data);
    };
    this.worker.onerror = (ev) => {
      const p = this.pending;
      if (!p) return;
      clearTimeout(p.timer);
      this.pending = null;
      this._kill();
      p.resolve(failure('internal', ev.message || 'The Lua worker crashed.'));
    };
  }

  _kill() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }

  /** Resolves to {ok, model, prints, ms} | {ok:false, error, prints} | {cancelled:true}. */
  run(code, radius, textures = []) {
    return this._post({ code, radius, textures });
  }

  /** Parses the Animation tab: {ok, anim: {clips}} | {ok:false, error} | {cancelled:true}. */
  runAnimation(code) {
    return this._post({ mode: 'anim', code });
  }

  _post(message) {
    if (this.pending) {
      // The old run may be stuck in a loop: the only way to stop it is to kill the worker.
      clearTimeout(this.pending.timer);
      this.pending.resolve({ cancelled: true });
      this.pending = null;
      this._kill();
    }
    if (!this.worker) this._spawn();
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this._kill();
        resolve(failure('timeout',
          `script ran for more than ${TIMEOUT_MS / 1000} s and was stopped (infinite loop?)`));
      }, TIMEOUT_MS);
      this.pending = { id, resolve, timer };
      this.worker.postMessage({ id, ...message });
    });
  }
}

function failure(kind, message) {
  return { ok: false, prints: '', error: { kind, message, line: 0, at: null } };
}
