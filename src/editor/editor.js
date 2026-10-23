import { EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration, MatchDecorator,
  ViewPlugin, WidgetType, hoverTooltip,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage, syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, syntaxTree, indentUnit,
} from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { API_DOCS } from '../lua/api.js';

// Colors come from CSS variables so switching the UI theme restyles the code.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.standard(t.variableName), color: 'var(--syn-builtin)' },
  { tag: t.variableName, color: 'var(--syn-variable)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-punct)' },
]);

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--syn-variable)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: 'var(--editor-font-size)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--cursor)', padding: '10px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cursor)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--gutter)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--selection-match)', outline: '1px solid var(--gutter)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-completionDetail': { opacity: 0.7, fontStyle: 'normal' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-error-line': { backgroundColor: 'var(--error-line)' },
});

// ---- API names: own colors, palette swatches -----------------------------

class SwatchWidget extends WidgetType {
  constructor(color) { super(); this.color = color; }
  eq(other) { return other.color === this.color; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-swatch';
    s.style.background = this.color;
    return s;
  }
}

const KIND_CLASS = { entry: 'cm-api-entry', fn: 'cm-api-fn', const: 'cm-api-const', color: 'cm-api-color', mat: 'cm-api-mat' };
const kindDeco = Object.fromEntries(Object.entries(KIND_CLASS).map(([k, c]) => [k, Decoration.mark({ class: c })]));
const literalDeco = Decoration.mark({ class: 'cm-literal' });
const LITERALS = new Set(['true', 'false', 'nil']);
const swatches = new Map();

const apiMatcher = new MatchDecorator({
  regexp: new RegExp(`\\b(${[...Object.keys(API_DOCS), ...LITERALS].join('|')})\\b`, 'g'),
  decorate(add, from, to, match, view) {
    const node = syntaxTree(view.state).resolveInner(from, 1);
    if (/comment|string/.test(node.name)) return;
    const word = match[1];
    if (LITERALS.has(word)) return add(from, to, literalDeco);
    const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : '';
    if (before === '.' || before === ':') return; // math.floor, obj:len ...
    const info = API_DOCS[word];
    if (info.kind === 'color') {
      if (!swatches.has(word)) swatches.set(word, Decoration.widget({ widget: new SwatchWidget(info.hex), side: -1 }));
      add(from, from, swatches.get(word));
    }
    add(from, to, kindDeco[info.kind]);
  },
});

const apiHighlighter = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = apiMatcher.createDeco(view); }
  update(u) {
    // Re-scan fully when the parse tree changes so comments/strings are respected.
    if (syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = apiMatcher.createDeco(u.view);
    else this.decorations = apiMatcher.updateDeco(u, this.decorations);
  }
}, { decorations: (v) => v.decorations });

const apiHover = hoverTooltip((view, pos) => {
  const word = view.state.wordAt(pos);
  if (!word) return null;
  const info = API_DOCS[view.state.doc.sliceString(word.from, word.to)];
  if (!info) return null;
  return {
    pos: word.from, end: word.to, above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'api-tip';
      const sig = document.createElement('code');
      sig.textContent = info.sig;
      const doc = document.createElement('div');
      doc.textContent = info.doc;
      dom.append(sig, doc);
      return { dom };
    },
  };
});

// ---- Completion ----------------------------------------------------------

const COMPLETION_TYPE = { entry: 'function', fn: 'function', const: 'constant', color: 'constant', mat: 'enum' };
const LUA_KEYWORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'];
const completionOptions = [
  snippetCompletion('function voxel(x, y, z)\n\t${}\nend', { label: 'voxel', detail: 'function template', type: 'function', boost: 10 }),
  snippetCompletion('for ${i} = ${1}, ${10} do\n\t${}\nend', { label: 'for', detail: 'loop', type: 'keyword' }),
  snippetCompletion('if ${condition} then\n\t${}\nend', { label: 'if', detail: 'block', type: 'keyword' }),
  ...Object.entries(API_DOCS)
    .filter(([name]) => name !== 'voxel')
    .map(([label, info]) => ({ label, type: COMPLETION_TYPE[info.kind], detail: info.kind === 'color' ? info.hex : '', info: `${info.sig}\n${info.doc}` })),
  ...LUA_KEYWORDS.filter((k) => k !== 'for' && k !== 'if').map((label) => ({ label, type: 'keyword' })),
];

let getTextureNames = () => [];

function apiCompletions(ctx) {
  // Inside tex("...") or tex{ top = "..." }: offer texture names.
  const texArg = ctx.matchBefore(/(?:tex\s*\(\s*|=\s*)["']\w*/);
  if (texArg) {
    const quote = texArg.text.search(/["']/);
    return {
      from: texArg.from + quote + 1,
      options: getTextureNames().map((label) => ({ label, type: 'text', detail: 'texture' })),
      validFor: /^\w*$/,
    };
  }
  const word = ctx.matchBefore(/[A-Za-z_][A-Za-z_0-9]*/);
  if (!word && !ctx.explicit) return null;
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  if (/comment|string/.test(node.name)) return null;
  const before = word && word.from > 0 ? ctx.state.doc.sliceString(word.from - 1, word.from) : '';
  if (before === '.' || before === ':') return null;
  return { from: word ? word.from : ctx.pos, options: completionOptions, validFor: /^\w*$/ };
}

// ---- Error line ----------------------------------------------------------

const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(e.value)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Public --------------------------------------------------------------

/**
 * @param parent DOM element
 * @param opts { doc, onChange(text), onRun(), onSave(saveAs), onOpen(), onKey(event), onKeyUp(event), textureNames() }
 */
export function createEditor(parent, opts) {
  if (opts.textureNames) getTextureNames = opts.textureNames;
  const commands = keymap.of([
    { key: 'Mod-Enter', run: () => (opts.onRun(), true) },
    { key: 'Mod-s', preventDefault: true, run: () => (opts.onSave(false), true) },
    { key: 'Mod-Shift-s', preventDefault: true, run: () => (opts.onSave(true), true) },
    { key: 'Mod-o', preventDefault: true, run: () => (opts.onOpen(), true) },
  ]);

  const extensions = [
        commands,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        StreamLanguage.define(lua),
        indentOnInput(),
        syntaxHighlighting(highlight),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [apiCompletions], icons: true }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        apiHighlighter,
        apiHover,
        lintGutter(),
        errorLineField,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        baseTheme,
        EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
        EditorView.domEventHandlers({
          keydown: (e) => { opts.onKey(e); return false; },
          keyup: (e) => { opts.onKeyUp(e); return false; },
        }),
  ];
  // One EditorState per tab keeps each tab's undo history and cursor.
  const newState = (doc) => EditorState.create({ doc, extensions });
  const view = new EditorView({ parent, state: newState(opts.doc) });

  return {
    view,
    newState,
    /** Shows another tab's state (no change events fire). */
    setState(state) { view.setState(state); },
    getDoc: () => view.state.doc.toString(),
    setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
    },
    /** Shows an error at its line, or clears errors when `err` is null. */
    setError(err) {
      const doc = view.state.doc;
      if (!err || !err.line || err.line > doc.lines) {
        view.dispatch(setDiagnostics(view.state, []));
        view.dispatch({ effects: setErrorLine.of(null) });
        return;
      }
      const line = doc.line(err.line);
      const indent = /^\s*/.exec(line.text)[0].length;
      view.dispatch(setDiagnostics(view.state, [{
        from: line.from + Math.min(indent, line.length), to: line.to, severity: 'error', message: err.message,
      }]));
      view.dispatch({ effects: setErrorLine.of(line.from) });
    },
    goToLine(n) {
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    },
    focus: () => view.focus(),
  };
}
