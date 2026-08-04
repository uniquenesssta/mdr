function isE2EEnabled() {
  try {
    return globalThis.__MARKDOWN_EDITOR_E2E__ === true
      || new URL(globalThis.location?.href || 'http://localhost/').searchParams.get('e2e') === '1';
  } catch (_) {
    return false;
  }
}

function waitForAnimationFrames(count = 2) {
  return new Promise(resolve => {
    const step = remaining => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(Math.max(0, Number(count) || 0));
  });
}

function getEditor() {
  return document.getElementById('editor');
}

function getLayoutMode() {
  const stored = localStorage.getItem('md_editor_layout_mode')
    || localStorage.getItem('md_editor_view_mode')
    || 'both';
  if (document.body.classList.contains('hybrid-view-mode')) return 'hybrid';
  const editorPane = document.querySelector('.editor-pane');
  const previewPane = document.querySelector('.preview-pane');
  const editorCollapsed = editorPane?.classList.contains('collapsed');
  const previewCollapsed = previewPane?.classList.contains('collapsed');
  if (editorCollapsed && !previewCollapsed) return 'preview';
  if (!editorCollapsed && previewCollapsed) return 'edit';
  return ['both', 'hybrid', 'edit', 'preview'].includes(stored) ? stored : 'both';
}

function describeActiveElement() {
  const element = document.activeElement;
  if (!(element instanceof Element)) return null;
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: String(element.className || ''),
    hybridBlockType: element.closest?.('[data-hybrid-block-type]')?.getAttribute?.('data-hybrid-block-type') || null
  };
}

function getComponentDomSnapshot() {
  return Array.from(document.querySelectorAll('[data-hybrid-block-type]')).map((element, index) => ({
    index,
    type: element.getAttribute('data-hybrid-block-type') || '',
    directEditing: Boolean(element.querySelector('[data-hybrid-code-editor], [data-hybrid-table-cell-input]')),
    sourceVisible: false,
    connected: element.isConnected
  }));
}

async function waitForIdle(options = {}) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs) || 4000);
  const quietMs = Math.max(20, Number(options.quietMs) || 80);
  const started = performance.now();
  let stableSince = 0;
  let previous = '';

  while (performance.now() - started < timeoutMs) {
    await waitForAnimationFrames(1);
    const pendingMermaid = document.querySelectorAll('[data-mermaid-rendering="true"], .cm-hybrid-mermaid-status:not(.is-error)').length;
    const snapshot = JSON.stringify({
      pendingMermaid,
      blocks: getComponentDomSnapshot(),
      sourceActiveLines: getEditor()?.virtualEditor?.getPresentationStats?.().sourceActiveLines || 0,
      active: describeActiveElement()
    });
    if (pendingMermaid === 0 && snapshot === previous) {
      if (!stableSince) stableSince = performance.now();
      if (performance.now() - stableSince >= quietMs) return true;
    } else {
      stableSince = 0;
      previous = snapshot;
    }
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  return false;
}

async function setLayout(mode) {
  const normalized = ['both', 'hybrid', 'edit', 'preview'].includes(mode) ? mode : 'both';
  if (typeof globalThis.setLayoutMode !== 'function') {
    throw new Error('setLayoutMode is unavailable');
  }
  globalThis.setLayoutMode(normalized, false);
  await waitForIdle();
  return normalized;
}

async function setVisualEditing(options = {}) {
  const editor = getEditor();
  if (!editor?.virtualEditor) throw new Error('virtual editor is unavailable');
  if (Object.hasOwn(options, 'code')) {
    editor.virtualEditor.setHybridCodeVisualEditing?.(Boolean(options.code));
    localStorage.setItem('md_editor_code_visual_editing', options.code ? 'true' : 'false');
  }
  if (Object.hasOwn(options, 'table')) {
    editor.virtualEditor.setHybridTableVisualEditing?.(Boolean(options.table));
    localStorage.setItem('md_editor_table_visual_editing', options.table ? 'true' : 'false');
  }
  await waitForIdle();
}

async function loadApplicationDocument(source, options = {}) {
  if (typeof globalThis.loadTextContentAsDocument !== 'function') {
    throw new Error('application document import flow is unavailable');
  }
  const content = String(source || '');
  const loaded = await globalThis.loadTextContentAsDocument(
    String(options.name || 'e2e-fixture.md'),
    content,
    ''
  );
  if (!loaded) throw new Error('application document import flow rejected the E2E fixture');

  const editor = getEditor();
  if (!editor?.virtualEditor) throw new Error('virtual editor is unavailable after document import');
  const requestedSelection = Number(options.selection);
  const selection = Math.max(
    0,
    Math.min(editor.textLength, Number.isFinite(requestedSelection) ? requestedSelection : 0)
  );
  editor.setSelectionRange(selection, selection);
  return editor;
}

async function loadMarkdown(source, options = {}) {
  await loadApplicationDocument(source, options);
  await setVisualEditing({
    code: options.codeVisualEditing !== false,
    table: options.tableVisualEditing !== false
  });
  await setLayout(options.layout || 'hybrid');
  await waitForIdle({ timeoutMs: options.timeoutMs || 6000 });
  return snapshot();
}

function snapshot() {
  const editor = getEditor();
  return {
    ready: document.documentElement.classList.contains('app-ready'),
    layout: getLayoutMode(),
    presentationMode: editor?.virtualEditor?.getPresentationMode?.() || null,
    documentLength: editor?.textLength || 0,
    selectionStart: editor?.selectionStart || 0,
    selectionEnd: editor?.selectionEnd || 0,
    selectedText: editor?.value?.slice?.(editor.selectionStart || 0, editor.selectionEnd || 0) || '',
    presentationStats: editor?.virtualEditor?.getPresentationStats?.() || null,
    componentStates: editor?.virtualEditor?.getHybridComponentStates?.() || [],
    components: getComponentDomSnapshot(),
    activeElement: describeActiveElement()
  };
}

export function installMarkdownEditorE2EBridge() {
  if (!isE2EEnabled() || globalThis.__markdownEditorE2E) return null;
  const bridge = Object.freeze({
    loadMarkdown,
    setLayout,
    setVisualEditing,
    waitForIdle,
    snapshot,
    clearStorage() {
      localStorage.clear();
      return true;
    },
    getEditorValue() {
      return getEditor()?.value || '';
    }
  });
  Object.defineProperty(globalThis, '__markdownEditorE2E', {
    configurable: true,
    value: bridge
  });
  return bridge;
}
