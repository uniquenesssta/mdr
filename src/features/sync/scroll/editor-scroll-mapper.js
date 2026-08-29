/**
 * Responsibility: Map editor document positions and source lines to CodeMirror content geometry without owning scroll source, target writes, DOM measurement or document text.
 * Imports: None; consumes an injected neutral CodeMirror geometry adapter and the frozen DocumentModel line-range API.
 * Exports: EditorScrollMapper and createEditorScrollMapper.
 * State/side effects: Owns lifecycle only; reads model line ranges and editor geometry snapshots without mutating either dependency.
 * Lifecycle: Explicit instance lifecycle; destroy() is idempotent and all later reads are rejected.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function assertCapabilities(editorApi, model) {
  const editorMethods = [
    'getSelection',
    'getScrollMetrics',
    'getLineAtHeight',
    'getHeightForLine',
    'getHeightForPosition'
  ];
  const modelMethods = [
    'getTextLength',
    'getLineCount',
    'getLineNumberAtPosition',
    'getLineStart',
    'getLineEnd'
  ];
  if (!editorApi || editorMethods.some(name => typeof editorApi[name] !== 'function')) {
    throw new TypeError('EditorScrollMapper requires neutral CodeMirror geometry capabilities');
  }
  if (!model || modelMethods.some(name => typeof model[name] !== 'function')) {
    throw new TypeError('EditorScrollMapper requires frozen DocumentModel line-range capabilities');
  }
}

function finiteGeometry(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export class EditorScrollMapper {
  constructor({ editorApi, model } = {}) {
    assertCapabilities(editorApi, model);
    this.editorApi = editorApi;
    this.model = model;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw new Error('EditorScrollMapper has been destroyed');
  }

  getLineCount() {
    this.assertActive();
    return Math.max(1, Math.floor(Number(this.model.getLineCount()) || 1));
  }

  getTextLength() {
    this.assertActive();
    return Math.max(0, Math.floor(Number(this.model.getTextLength()) || 0));
  }

  getLineNumberAtPosition(position) {
    this.assertActive();
    const safePosition = clamp(position, 0, this.getTextLength());
    return clamp(this.model.getLineNumberAtPosition(safePosition), 1, this.getLineCount());
  }

  getLineRange(lineNumber) {
    this.assertActive();
    const line = Math.floor(clamp(lineNumber, 1, this.getLineCount()));
    const textLength = this.getTextLength();
    const start = clamp(this.model.getLineStart(line), 0, textLength);
    const end = clamp(this.model.getLineEnd(line), start, textLength);
    return Object.freeze({ lineNumber: line, start, end });
  }

  getCursorLine() {
    this.assertActive();
    const selection = this.editorApi.getSelection();
    const position = Number(selection?.start ?? selection?.anchor) || 0;
    return this.getLineNumberAtPosition(position);
  }

  getLineAtContentY(contentY) {
    this.assertActive();
    const lineCount = this.getLineCount();
    const mapped = Number(this.editorApi.getLineAtHeight(Math.max(0, Number(contentY) || 0)));
    return clamp(Number.isFinite(mapped) ? mapped : 1, 1, lineCount + 0.999);
  }

  getContentYForLine(lineFloat) {
    this.assertActive();
    const lineCount = this.getLineCount();
    const safeLine = clamp(lineFloat, 1, lineCount + 0.999);
    const lineNumber = Math.min(lineCount, Math.floor(safeLine));
    this.getLineRange(lineNumber);
    return finiteGeometry(this.editorApi.getHeightForLine(safeLine));
  }

  getContentYForPosition(position) {
    this.assertActive();
    const safePosition = clamp(position, 0, this.getTextLength());
    const lineNumber = this.getLineNumberAtPosition(safePosition);
    const range = this.getLineRange(lineNumber);
    const boundedPosition = clamp(safePosition, range.start, range.end);
    return finiteGeometry(this.editorApi.getHeightForPosition(boundedPosition));
  }

  getTopVisibleLine(offsetPx = 8) {
    this.assertActive();
    const metrics = this.editorApi.getScrollMetrics() || {};
    const contentY = Math.max(0, Number(metrics.top) || 0) + Math.max(0, Number(offsetPx) || 0);
    return Math.max(1, Math.floor(this.getLineAtContentY(contentY)));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editorApi = null;
    this.model = null;
  }
}

export function createEditorScrollMapper(options = {}) {
  return new EditorScrollMapper(options);
}
