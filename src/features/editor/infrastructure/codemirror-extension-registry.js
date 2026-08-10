/**
 * Responsibility: Own CodeMirror Base, Markdown, Theme, Read-only and Hybrid extension slots and runtime reconfiguration state.
 * Imports: May import CodeMirror/Lezer primitives, sibling pointer-selection infrastructure and the existing Stage 8-bound hybrid facade; must not import document/session/UI/persistence state.
 * Exports: CODEMIRROR_EXTENSION_SLOT_NAMES and createCodeMirrorExtensionRegistry.
 * State/side effects: Owns Compartment instances, current extension configuration and one injected effect dispatcher; it does not own application theme or document state.
 * Lifecycle: Explicit instance lifecycle; attach() owns a detachable dispatcher binding and destroy() is idempotent and terminal.
 */
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder as editorPlaceholder
} from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown
} from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createPrecisePointerSelectionExtension } from './pointer-selection/precise-pointer-selection.js';
import {
  createHybridMarkdownConfiguration,
  createHybridMarkdownExtension
} from '../../../editor/hybrid-markdown.js';

export const CODEMIRROR_EXTENSION_SLOT_NAMES = Object.freeze([
  'base',
  'markdown',
  'theme',
  'readOnly',
  'hybrid'
]);

const continueMarkdownMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
const markdownEditingKeymap = Object.freeze([
  { key: 'Enter', run: continueMarkdownMarkup },
  { key: 'Backspace', run: deleteMarkupBackward }
]);
const filteredDefaultKeymap = Object.freeze(
  defaultKeymap.filter(binding => !/^(?:Mod-(?:z|y|s|b|i|u|k|f|o|n)|Shift-Mod-z|Tab)$/i.test(binding.key || ''))
);

function normalizeThemeExtensions(value) {
  if (value === null || value === undefined || value === false) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.filter(Boolean);
}

function sameExtensions(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizePresentationMode(value) {
  return value === 'hybrid' ? 'hybrid' : 'source';
}

function createSnapshot(state) {
  return Object.freeze({
    placeholder: state.placeholder,
    readOnly: state.readOnly,
    presentationMode: state.presentationMode,
    hybridTableVisualEditing: state.hybridTableVisualEditing,
    hybridCodeVisualEditing: state.hybridCodeVisualEditing,
    themeExtensionCount: state.themeExtensions.length
  });
}

export function createCodeMirrorExtensionRegistry({
  placeholder = '',
  readOnly = false,
  presentationMode = 'source',
  hybridTableVisualEditing = false,
  hybridCodeVisualEditing = false,
  themeExtensions = []
} = {}) {
  const baseCompartment = new Compartment();
  const markdownCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const hybridCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const hybridMarkdownExtension = createHybridMarkdownExtension();

  let state = {
    placeholder: String(placeholder ?? ''),
    readOnly: Boolean(readOnly),
    presentationMode: normalizePresentationMode(presentationMode),
    hybridTableVisualEditing: Boolean(hybridTableVisualEditing),
    hybridCodeVisualEditing: Boolean(hybridCodeVisualEditing),
    themeExtensions: normalizeThemeExtensions(themeExtensions)
  };
  let dispatchEffects = null;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('CodeMirror extension registry has been destroyed.');
  };

  const assertAttached = () => {
    assertActive();
    if (typeof dispatchEffects !== 'function') {
      throw new Error('CodeMirror extension registry is not attached to an editor adapter.');
    }
  };

  const buildBaseExtensions = () => [
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    Prec.high(createPrecisePointerSelectionExtension()),
    history({ minDepth: 100, newGroupDelay: 500 }),
    keymap.of(filteredDefaultKeymap),
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      translate: 'no'
    })
  ];

  const buildMarkdownExtensions = () => [
    markdown({ extensions: GFM, addKeymap: false }),
    Prec.high(keymap.of(markdownEditingKeymap))
  ];

  const buildReadOnlyExtensions = value => [
    EditorState.readOnly.of(Boolean(value)),
    EditorView.editable.of(!value)
  ];

  const buildHybridExtensions = nextState => {
    const extensions = [
      createHybridMarkdownConfiguration({
        tableVisualEditing: nextState.hybridTableVisualEditing,
        codeVisualEditing: nextState.hybridCodeVisualEditing
      })
    ];
    if (nextState.presentationMode === 'hybrid') {
      extensions.push(
        hybridMarkdownExtension,
        EditorView.editorAttributes.of({ class: 'cm-hybrid-mode' })
      );
    }
    return extensions;
  };

  const getExtensions = () => {
    assertActive();
    return [
      baseCompartment.of(buildBaseExtensions()),
      markdownCompartment.of(buildMarkdownExtensions()),
      themeCompartment.of(state.themeExtensions),
      readOnlyCompartment.of(buildReadOnlyExtensions(state.readOnly)),
      hybridCompartment.of(buildHybridExtensions(state)),
      placeholderCompartment.of(editorPlaceholder(state.placeholder))
    ];
  };

  const commitEffect = (effect, nextState) => {
    assertAttached();
    const result = dispatchEffects(effect);
    if (result === false) throw new Error('CodeMirror extension registry effect dispatch was rejected.');
    state = nextState;
    return true;
  };

  const setPlaceholder = value => {
    assertActive();
    const nextPlaceholder = String(value ?? '');
    if (nextPlaceholder === state.placeholder) return false;
    return commitEffect(
      placeholderCompartment.reconfigure(editorPlaceholder(nextPlaceholder)),
      { ...state, placeholder: nextPlaceholder }
    );
  };

  const setReadOnly = value => {
    assertActive();
    const nextReadOnly = Boolean(value);
    if (nextReadOnly === state.readOnly) return false;
    return commitEffect(
      readOnlyCompartment.reconfigure(buildReadOnlyExtensions(nextReadOnly)),
      { ...state, readOnly: nextReadOnly }
    );
  };

  const setThemeExtensions = value => {
    assertActive();
    const nextThemeExtensions = normalizeThemeExtensions(value);
    if (sameExtensions(nextThemeExtensions, state.themeExtensions)) return false;
    return commitEffect(
      themeCompartment.reconfigure(nextThemeExtensions),
      { ...state, themeExtensions: nextThemeExtensions }
    );
  };

  const setHybridConfiguration = options => {
    assertActive();
    const values = options || {};
    const nextState = {
      ...state,
      presentationMode: values.presentationMode === undefined
        ? state.presentationMode
        : normalizePresentationMode(values.presentationMode),
      hybridTableVisualEditing: values.tableVisualEditing === undefined
        ? state.hybridTableVisualEditing
        : Boolean(values.tableVisualEditing),
      hybridCodeVisualEditing: values.codeVisualEditing === undefined
        ? state.hybridCodeVisualEditing
        : Boolean(values.codeVisualEditing)
    };
    if (
      nextState.presentationMode === state.presentationMode
      && nextState.hybridTableVisualEditing === state.hybridTableVisualEditing
      && nextState.hybridCodeVisualEditing === state.hybridCodeVisualEditing
    ) return false;
    return commitEffect(hybridCompartment.reconfigure(buildHybridExtensions(nextState)), nextState);
  };

  const attach = dispatcher => {
    assertActive();
    if (typeof dispatcher !== 'function') {
      throw new TypeError('CodeMirror extension registry requires an effect dispatcher.');
    }
    if (dispatchEffects) throw new Error('CodeMirror extension registry is already attached.');
    dispatchEffects = dispatcher;
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      if (dispatchEffects === dispatcher) dispatchEffects = null;
    };
  };

  return {
    get snapshot() {
      assertActive();
      return createSnapshot(state);
    },
    getExtensions,
    attach,
    setPlaceholder,
    setReadOnly,
    setThemeExtensions,
    setHybridConfiguration,
    setPresentationMode(value) {
      return setHybridConfiguration({ presentationMode: value });
    },
    setHybridTableVisualEditing(value) {
      return setHybridConfiguration({ tableVisualEditing: value });
    },
    setHybridCodeVisualEditing(value) {
      return setHybridConfiguration({ codeVisualEditing: value });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dispatchEffects = null;
      state = { ...state, themeExtensions: [] };
    }
  };
}
