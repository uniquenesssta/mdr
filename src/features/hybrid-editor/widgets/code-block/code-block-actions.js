/**
 * Atomic 8.8 Code Block toolbar, copy and source-action button presentation.
 * Allowed imports: Hybrid code normalization plus Shared Widget UI primitives. Forbidden imports: CodeMirror, Session and document writeback.
 * API: copyCodeBlockText(), createCodeBlockToolbar(). State: none. Side effects: clipboard write/fallback and button-local listeners. Lifecycle: returned DOM owns only element-scoped listeners.
 */
import { getNormalizedCodeLanguage } from '../../code/code-highlighter.js';
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetActionGroup, createWidgetToolbar } from '../shared/widget-toolbar.js';

export async function copyCodeBlockText(value, options = {}) {
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

export function createCodeBlockToolbar(options = {}) {
  const header = createWidgetToolbar({ doubleZone: 'code-toolbar' });
  const languageGroup = document.createElement('span');
  languageGroup.className = 'cm-hybrid-code-label-group';
  const language = document.createElement('span');
  language.className = 'cm-hybrid-code-language';
  language.textContent = getNormalizedCodeLanguage(options.language) || 'text';
  languageGroup.appendChild(language);
  if (options.visualEditing) {
    const badge = document.createElement('span');
    badge.className = 'cm-hybrid-code-editing-badge';
    badge.textContent = '双击编辑';
    languageGroup.appendChild(badge);
  }
  header.appendChild(languageGroup);

  const actions = createWidgetActionGroup();
  actions.appendChild(createWidgetButton('复制', 'cm-hybrid-widget-action', async () => {
    try {
      await copyCodeBlockText(options.getCode?.());
      options.notify?.('代码已复制');
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
