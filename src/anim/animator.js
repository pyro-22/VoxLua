import { evaluate, findKey, setKey, deleteKey, moveKey, INTERPS } from './evaluate.js';

// Animate mode: timeline (clips, rows per part, keys, playhead), playback,
// pose fields and gizmo keyframing. Owns the parsed animation data; every
// edit calls onEdit() so main.js can rewrite the Animation tab text.

const CELL = 16; // px per frame
const PROP_OF_MODE = { translate: 'pos', rotate: 'rot', scale: 'scale' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export class Animator {
  /**
   * @param root container element (shown only in Animate mode)
   * @param opts { viewport, onEdit(), onSelectPart(name), confirmRewrite() -> bool }
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.viewport = opts.viewport;
    this.anim = { clips: [] };
    this.parts = [];
    this.clipIndex = 0;
    this.frame = 0;
    this.playing = false;
    this.selectedPart = null;
    this.selectedKey = null; // { part, frame }
    this.override = null;    // un-keyed gizmo pose: { part, props }
    this.autoKey = true;
    this.active = false;
    this.gizmoMode = 'translate';
    this._build();
  }

  get clip() { return this.anim.clips[this.clipIndex] || null; }

  // ------------------------------------------------------------------ data in

  setAnim(anim) {
    this.anim = anim;
    if (this.clipIndex >= anim.clips.length) this.clipIndex = Math.max(0, anim.clips.length - 1);
    if (this.selectedKey && !(this.clip && findKey(this.clip, this.selectedKey.part, this.selectedKey.frame))) this.selectedKey = null;
    this.refresh();
  }

  /** @param hidden names of parts hidden in the view (rows are dimmed) */
  setParts(names, hidden = []) {
    this.parts = names;
    this.hiddenParts = new Set(hidden);
    if (this.selectedPart && !names.includes(this.selectedPart)) this.selectedPart = null;
    this.refresh();
  }

  setActive(on) {
    this.active = on;
    if (!on) this.pause();
    this.viewport.setAnimating(on);
    this.viewport.select(on ? this.selectedPart : null);
    this.applyPose();
  }

  selectPart(name, { notify = false } = {}) {
    if (name === this.selectedPart) return;
    this.selectedPart = name;
    this.override = null;
    this.viewport.select(this.active ? name : null);
    if (notify && name) this.opts.onSelectPart(name);
    this.refresh();
  }

  // ------------------------------------------------------------------ poses

  /** Poses for every part at the current frame, or null for the rest pose. */
  currentPoses() {
    if (!this.active || this.gizmoMode === 'pivot') return null;
    const poses = {};
    for (const name of this.parts) {
      const pose = evaluate(this.clip, name, this.frame);
      if (this.override && this.override.part === name) {
        for (const [k, v] of Object.entries(this.override.props)) pose[k] = typeof v === 'number' ? [v, v, v] : [...v];
      }
      poses[name] = pose;
    }
    return poses;
  }

  applyPose() {
    this.viewport.setPose(this.currentPoses());
  }

  // ------------------------------------------------------------------ editing

  _ensureClip() {
    if (!this.clip) {
      this.anim.clips.push({ name: 'idle', fps: 12, frames: 24, loop: true, keys: [] });
      this.clipIndex = this.anim.clips.length - 1;
    }
    return this.clip;
  }

  _edit() {
    this.opts.onEdit();
    this.refresh();
  }

  /** Writes a key unless the Animation tab has hand-written code the user wants to keep. */
  _write(fn) {
    if (!this.opts.confirmRewrite()) return false;
    fn();
    this._edit();
    return true;
  }

  /** Gizmo released after moving / rotating / scaling a part. */
  gizmoEnd(part, mode, values) {
    const prop = PROP_OF_MODE[mode];
    if (!prop) return;
    let v = values[prop];
    if (prop === 'scale' && v[0] === v[1] && v[1] === v[2]) v = v[0];
    if (this.autoKey) {
      const ok = this._write(() => {
        const frame = Math.round(this.frame);
        setKey(this._ensureClip(), part, frame, { [prop]: v });
        this.selectedKey = { part, frame };
        this.override = null;
      });
      if (!ok) this.applyPose();
    } else {
      this.override = { part, props: { ...(this.override?.part === part ? this.override.props : {}), [prop]: v } };
      this.applyPose();
      this._renderBar();
    }
  }

  setFrame(f) {
    const max = this.clip ? this.clip.frames : 0;
    this.frame = Math.max(0, Math.min(max, f));
    this.override = null;
    this.applyPose();
    this._renderPlayhead();
    this._renderPose();
    this._renderBar();
  }

  play() {
    if (!this.clip || this.playing) return;
    if (this.frame >= this.clip.frames && !this.clip.loop) this.frame = 0;
    this.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const clip = this.clip;
      if (!clip) return this.pause();
      this.frame += ((now - last) / 1000) * clip.fps;
      last = now;
      if (this.frame >= clip.frames) {
        if (clip.loop) this.frame %= clip.frames;
        else { this.frame = clip.frames; this.pause(); }
      }
      this.applyPose();
      this._renderPlayhead();
      this._frameLabel.textContent = `${Math.floor(this.frame)} / ${clip.frames}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this._renderBar();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.frame = Math.round(this.frame);
    this.applyPose();
    this.refresh();
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  step(delta) {
    this.pause();
    this.setFrame(Math.round(this.frame) + delta);
  }

  deleteSelectedKey() {
    const k = this.selectedKey;
    if (!k || !this.clip) return;
    this._write(() => { deleteKey(this.clip, k.part, k.frame); this.selectedKey = null; });
  }

  // ------------------------------------------------------------------ DOM

  _build() {
    const r = this.root;
    r.textContent = '';
    r.classList.add('tl');

    const bar = (this._bar = el('div', 'tl-bar'));
    this._clipSel = el('select', 'tl-clip');
    this._clipSel.title = 'Animation clip';
    this._clipSel.onchange = () => { this.clipIndex = +this._clipSel.value; this.selectedKey = null; this.setFrame(0); this.refresh(); };
    const addClip = el('button', 'small', '+ Clip');
    addClip.title = 'New animation clip';
    addClip.onclick = () => this._newClip();
    this._fps = this._numField('fps', 1, 120, (v) => { this.clip.fps = v; });
    this._frames = this._numField('frames', 1, 10000, (v) => { this.clip.frames = Math.round(v); });
    this._loop = el('input');
    this._loop.type = 'checkbox';
    this._loop.onchange = () => this._write(() => { this.clip.loop = this._loop.checked; });
    const loopLabel = el('label', 'tl-check');
    loopLabel.append(this._loop, ' loop');
    const clipMenu = el('button', 'small ghost', '⋯');
    clipMenu.title = 'Rename or delete this clip';
    clipMenu.onclick = () => this._clipActions();

    const start = el('button', 'small', '⏮');
    start.title = 'First frame (Home)';
    start.onclick = () => { this.pause(); this.setFrame(0); };
    const prev = el('button', 'small', '◀');
    prev.title = 'Previous frame (,)';
    prev.onclick = () => this.step(-1);
    this._playBtn = el('button', 'small primary', '▶');
    this._playBtn.title = 'Play / pause (Space)';
    this._playBtn.onclick = () => this.togglePlay();
    const next = el('button', 'small', '▶');
    next.className = 'small tl-next';
    next.title = 'Next frame (.)';
    next.onclick = () => this.step(1);
    this._frameLabel = el('span', 'tl-frame', '0 / 0');

    this._tools = {};
    const tools = el('div', 'seg tl-tools');
    for (const [mode, label, title] of [['translate', 'Move', 'Move the part (W)'], ['rotate', 'Rotate', 'Rotate around the pivot (E)'],
      ['scale', 'Scale', 'Scale around the pivot (R)'], ['pivot', 'Pivot', 'Move the pivot point (P)']]) {
      const b = el('button', null, label);
      b.title = title;
      b.onclick = () => this.setGizmoMode(mode);
      this._tools[mode] = b;
      tools.append(b);
    }
    this._snap = el('input');
    this._snap.type = 'checkbox';
    this._snap.checked = true;
    this._snap.onchange = () => this.viewport.setSnap(this._snap.checked);
    const snapLabel = el('label', 'tl-check');
    snapLabel.title = 'Snap to whole voxels, 15° and 0.25 scale steps. Hold Shift while dragging to turn it off.';
    snapLabel.append(this._snap, ' snap');
    this._auto = el('input');
    this._auto.type = 'checkbox';
    this._auto.checked = true;
    this._auto.onchange = () => { this.autoKey = this._auto.checked; this.override = null; this.applyPose(); this._renderBar(); };
    const autoLabel = el('label', 'tl-check');
    autoLabel.title = 'Releasing the gizmo saves a keyframe at the current frame';
    autoLabel.append(this._auto, ' auto-key');
    this._keyPose = el('button', 'small', 'Key pose');
    this._keyPose.title = 'Save the shown pose of the selected part as a keyframe (K)';
    this._keyPose.onclick = () => this.keyCurrentPose();

    this._interp = el('select', 'tl-interp');
    this._interp.title = 'How the motion goes from this key to the next';
    for (const i of INTERPS) this._interp.add(new Option(i, i));
    this._interp.onchange = () => {
      const k = this.selectedKey && findKey(this.clip, this.selectedKey.part, this.selectedKey.frame);
      if (k) this._write(() => { if (this._interp.value === 'linear') delete k.interp; else k.interp = this._interp.value; });
    };
    this._delKey = el('button', 'small', 'Delete key');
    this._delKey.title = 'Delete the selected key (Delete)';
    this._delKey.onclick = () => this.deleteSelectedKey();
    this._keyInfo = el('span', 'tl-keyinfo');

    const sep = () => el('span', 'tl-sep');
    bar.append(this._clipSel, addClip, clipMenu, this._fps.wrap, this._frames.wrap, loopLabel, sep(),
      start, prev, this._playBtn, next, this._frameLabel, sep(), tools, snapLabel, autoLabel, this._keyPose,
      el('span', 'spacer'), this._keyInfo, this._interp, this._delKey);

    const body = el('div', 'tl-body');
    this._names = el('div', 'tl-names');
    this._scroll = el('div', 'tl-scroll');
    this._track = el('div', 'tl-track');
    this._ruler = el('div', 'tl-ruler');
    this._rows = el('div', 'tl-rows');
    this._playhead = el('div', 'tl-playhead');
    this._track.append(this._ruler, this._rows, this._playhead);
    this._scroll.append(this._track);
    this._pose = el('div', 'tl-pose');
    body.append(this._names, this._scroll, this._pose);
    this._empty = el('div', 'tl-empty');
    r.append(bar, body, this._empty);

    // Scrub: drag on the ruler or empty row space.
    const scrub = (e) => {
      const rect = this._track.getBoundingClientRect();
      this.pause();
      this.setFrame(Math.round((e.clientX - rect.left - CELL / 2) / CELL));
    };
    this._track.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('tl-key')) return;
      const row = e.target.closest('.tl-row');
      if (row) this.selectPart(row.dataset.part, { notify: true });
      this.selectedKey = null;
      scrub(e);
      this._track.setPointerCapture(e.pointerId);
      const move = (ev) => scrub(ev);
      const up = () => { this._track.removeEventListener('pointermove', move); this._track.removeEventListener('pointerup', up); this._renderRows(); this._renderBar(); };
      this._track.addEventListener('pointermove', move);
      this._track.addEventListener('pointerup', up);
    });
    this._names.addEventListener('click', (e) => {
      const row = e.target.closest('.tl-name');
      if (row) this.selectPart(row.dataset.part, { notify: true });
    });
  }

  _numField(label, min, max, apply) {
    const wrap = el('label', 'tl-num');
    const input = el('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (!(v >= min && v <= max) || !this.clip) { this.refresh(); return; }
      this._write(() => apply(v));
    };
    wrap.append(input, ` ${label}`);
    return { wrap, input };
  }

  _newClip() {
    const name = window.prompt('Name for the new clip (letters, digits, _):', this.anim.clips.length ? 'clip' + (this.anim.clips.length + 1) : 'idle');
    if (!name) return;
    const clean = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'clip';
    this._write(() => {
      this.anim.clips.push({ name: clean, fps: 12, frames: 24, loop: true, keys: [] });
      this.clipIndex = this.anim.clips.length - 1;
      this.frame = 0;
    });
  }

  _clipActions() {
    const clip = this.clip;
    if (!clip) return;
    const answer = window.prompt(`Rename clip "${clip.name}" (or type DELETE to remove it):`, clip.name);
    if (!answer || answer === clip.name) return;
    if (answer === 'DELETE') {
      this._write(() => { this.anim.clips.splice(this.clipIndex, 1); this.clipIndex = Math.max(0, this.clipIndex - 1); this.frame = 0; });
    } else {
      const clean = answer.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      if (clean) this._write(() => { clip.name = clean; });
    }
  }

  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this.override = null;
    this.viewport.setGizmoMode(mode);
    this.applyPose();
    this._renderBar();
  }

  keyCurrentPose() {
    const part = this.selectedPart;
    if (!part) return;
    const pose = evaluate(this.clip, part, this.frame);
    if (this.override?.part === part) Object.assign(pose, this.override.props);
    const s = pose.scale;
    const scale = Array.isArray(s) && s[0] === s[1] && s[1] === s[2] ? s[0] : s;
    this._write(() => {
      const frame = Math.round(this.frame);
      setKey(this._ensureClip(), part, frame, { pos: [...pose.pos], rot: [...pose.rot], scale });
      this.selectedKey = { part, frame };
      this.override = null;
    });
  }

  refresh() {
    this._renderBar();
    this._renderNames();
    this._renderRuler();
    this._renderRows();
    this._renderPlayhead();
    this._renderPose();
    this.applyPose();
  }

  _renderBar() {
    const clip = this.clip;
    this._clipSel.textContent = '';
    this.anim.clips.forEach((c, i) => this._clipSel.add(new Option(c.name, i)));
    this._clipSel.value = this.clipIndex;
    this._clipSel.disabled = !clip;
    for (const f of [this._fps, this._frames]) f.input.disabled = !clip;
    this._loop.disabled = !clip;
    if (clip) {
      if (document.activeElement !== this._fps.input) this._fps.input.value = clip.fps;
      if (document.activeElement !== this._frames.input) this._frames.input.value = clip.frames;
      this._loop.checked = clip.loop;
    }
    this._playBtn.textContent = this.playing ? '⏸' : '▶';
    this._frameLabel.textContent = clip ? `${Math.floor(this.frame)} / ${clip.frames}` : '–';
    for (const [mode, b] of Object.entries(this._tools)) b.setAttribute('aria-checked', String(mode === this.gizmoMode));
    this._keyPose.disabled = !this.selectedPart;
    this._keyPose.classList.toggle('attention', !!this.override);
    const k = this.selectedKey && clip && findKey(clip, this.selectedKey.part, this.selectedKey.frame);
    this._interp.disabled = this._delKey.disabled = !k;
    this._interp.value = k ? k.interp || 'linear' : 'linear';
    this._keyInfo.textContent = k ? `${k.part} @ ${k.frame}` : '';

    const empty = !this.parts.length ? 'Add a part to start animating.' : !clip
      ? 'No clips yet. Select a part and drag the gizmo (auto-key creates an "idle" clip), or click + Clip.' : '';
    this._empty.textContent = empty;
    this._empty.hidden = !empty;
  }

  _renderNames() {
    this._names.textContent = '';
    this._names.append(el('div', 'tl-name tl-head', 'Parts'));
    for (const name of this.parts) {
      const row = el('div', 'tl-name');
      row.dataset.part = name;
      row.classList.toggle('selected', name === this.selectedPart);
      const hidden = !!this.hiddenParts?.has(name);
      row.classList.toggle('hidden-part', hidden);
      if (this.opts.eyeIcons) {
        const eye = el('span', 'tl-eye' + (hidden ? ' off' : ''));
        eye.innerHTML = hidden ? this.opts.eyeIcons.off : this.opts.eyeIcons.on;
        eye.title = hidden ? 'Hidden in the view. Click to show.' : 'Hide in the view. Alt+click: show only this part.';
        eye.onclick = (e) => { e.stopPropagation(); this.opts.onToggleHidden(name, e.altKey); };
        row.append(eye);
      }
      row.append(el('span', 'tl-label', name));
      this._names.append(row);
    }
  }

  _renderRuler() {
    const frames = this.clip ? this.clip.frames : 0;
    this._track.style.width = `${(frames + 1) * CELL + 40}px`;
    this._ruler.textContent = '';
    for (let f = 0; f <= frames; f++) {
      const t = el('div', f % 5 === 0 ? 'tl-tick major' : 'tl-tick');
      t.style.left = `${f * CELL}px`;
      if (f % 5 === 0) t.textContent = f;
      this._ruler.append(t);
    }
  }

  _renderRows() {
    const clip = this.clip;
    this._rows.textContent = '';
    for (const name of this.parts) {
      const row = el('div', 'tl-row');
      row.dataset.part = name;
      row.classList.toggle('selected', name === this.selectedPart);
      if (clip) {
        for (const k of clip.keys) {
          if (k.part !== name) continue;
          const d = el('div', 'tl-key');
          d.style.left = `${k.frame * CELL + CELL / 2}px`;
          d.title = `${name} @ ${k.frame}${k.interp ? ` (${k.interp})` : ''}\n${['pos', 'rot', 'scale'].filter((p) => k[p] !== undefined).join(', ')}\nDrag to move, Alt+drag to copy`;
          if (k.interp === 'step') d.classList.add('step');
          if (this.selectedKey && this.selectedKey.part === name && this.selectedKey.frame === k.frame) d.classList.add('selected');
          d.addEventListener('pointerdown', (e) => this._dragKey(e, d, name, k.frame));
          row.append(d);
        }
      }
      this._rows.append(row);
    }
  }

  _dragKey(e, diamond, part, frame) {
    e.stopPropagation();
    this.pause();
    this.selectPart(part, { notify: true });
    this.selectedKey = { part, frame };
    this.setFrame(frame);
    this._renderRows();
    const d = this._rows.querySelector(`.tl-row[data-part="${part}"] .tl-key.selected`) || diamond;
    const rect = this._track.getBoundingClientRect();
    let to = frame;
    d.setPointerCapture(e.pointerId);
    const move = (ev) => {
      to = Math.max(0, Math.min(this.clip.frames, Math.round((ev.clientX - rect.left - CELL / 2) / CELL)));
      d.style.left = `${to * CELL + CELL / 2}px`;
      d.classList.toggle('copying', ev.altKey);
    };
    const up = (ev) => {
      d.removeEventListener('pointermove', move);
      d.removeEventListener('pointerup', up);
      if (to === frame) return;
      const copy = ev.altKey;
      const moved = this._write(() => { moveKey(this.clip, part, frame, to, copy); this.selectedKey = { part, frame: to }; });
      if (moved) this.setFrame(to);
      else this._renderRows();
    };
    d.addEventListener('pointermove', move);
    d.addEventListener('pointerup', up);
  }

  _renderPlayhead() {
    this._playhead.style.left = `${this.frame * CELL + CELL / 2}px`;
    this._playhead.hidden = !this.clip;
  }

  _renderPose() {
    const p = this._pose;
    p.textContent = '';
    const part = this.selectedPart;
    if (!part) {
      p.append(el('div', 'tl-pose-empty', 'Click a part (in the 3D view or the list) to pose it.'));
      return;
    }
    const pose = evaluate(this.clip, part, this.frame);
    if (this.override?.part === part) {
      for (const [k, v] of Object.entries(this.override.props)) pose[k] = typeof v === 'number' ? [v, v, v] : v;
    }
    p.append(el('div', 'tl-pose-title', part));
    const row = (label, prop, step) => {
      const r = el('div', 'tl-pose-row');
      r.append(el('span', null, label));
      pose[prop].forEach((v, i) => {
        const input = el('input');
        input.type = 'number';
        input.step = step;
        input.value = +v.toFixed(3);
        input.title = `${label} ${'xyz'[i]}`;
        input.className = `axis-${'xyz'[i]}`;
        input.onchange = () => {
          const n = parseFloat(input.value);
          if (!Number.isFinite(n)) { this._renderPose(); return; }
          const vals = pose[prop].map((x, j) => (j === i ? n : +x.toFixed(3)));
          const value = prop === 'scale' && vals.every((x) => x === vals[0]) ? vals[0] : vals;
          this._write(() => {
            const frame = Math.round(this.frame);
            setKey(this._ensureClip(), part, frame, { [prop]: value });
            this.selectedKey = { part, frame };
          });
        };
        r.append(input);
      });
      p.append(r);
    };
    row('Move', 'pos', 1);
    row('Rotate', 'rot', 15);
    row('Scale', 'scale', 0.25);
    p.append(el('div', 'tl-pose-note', this.override ? 'Not keyed yet: press Key pose (K).' : `Values at frame ${Math.round(this.frame)}. Typing saves a key.`));
  }
}
