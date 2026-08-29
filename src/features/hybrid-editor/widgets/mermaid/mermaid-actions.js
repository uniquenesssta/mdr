/**
 * Atomic 8.12 Mermaid toolbar, copy and SOURCE action presentation.
 * Allowed imports: Shared Widget UI primitives. Forbidden imports: CodeMirror, Session, Preview and render-request state.
 * API: copyMermaidSource(), createMermaidToolbar(). State: none. Side effects: clipboard write/fallback and button-local listeners. Lifecycle: returned DOM owns only element-scoped listeners.
 */
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetActionGroup, createWidgetToolbar } from '../shared/widget-toolbar.js';

export async function copyMermaidSource(value, options = {}) {
  const text = String(value ?? '');
  const navigatorRef = options.navigatorRef || globalThis.navigator;
  if (navigatorRef?.clipboard?.writeText) {
    await navigatorRef.clipboard.writeText(text);
    return;
  }
  const documentRef = options.documentRef || globalThis.document;
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.className = 'c-clipboard-buffer';
  textarea.setAttribute('readonly', '');
  documentRef.body.appendChild(textarea);
  textarea.select();
  const copied = documentRef.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('无法复制代码');
}

export function createMermaidToolbar(options = {}) {
  const header = createWidgetToolbar({ doubleZone: 'mermaid-toolbar' });
  const labelGroup = document.createElement('span');
  labelGroup.className = 'cm-hybrid-code-label-group';
  const label = document.createElement('span');
  label.className = 'cm-hybrid-code-language';
  label.textContent = 'mermaid';
  labelGroup.appendChild(label);
  if (options.visualEditing) {
    const badge = document.createElement('span');
    badge.className = 'cm-hybrid-code-editing-badge';
    badge.textContent = '双击编辑';
    labelGroup.appendChild(badge);
  }
  header.appendChild(labelGroup);

  const actions = createWidgetActionGroup();
  actions.appendChild(createWidgetButton('复制源码', 'cm-hybrid-widget-action', async () => {
    try {
      await copyMermaidSource(options.getSource?.());
      options.notify?.('Mermaid 源码已复制');
    } catch (error) {
      options.notify?.(error?.message || '复制失败');
    }
  }));
  actions.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
    options.onSourceEdit?.();
  }));
  header.appendChild(actions);
  return header;
}
