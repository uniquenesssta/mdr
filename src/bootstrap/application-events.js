/**
 * Responsibility: Bind document editing and application shortcuts to explicit feature commands.
 * Imports: Explicit startup capabilities and lifetime scope.
 * Exports: createApplicationEvents.
 * State/side effects: Owns startup/event lifetime only; document and settings authorities remain in their features.
 * Lifecycle: Explicit start and idempotent destroy with cancellation of late results.
 */
import { createApplicationLifetime } from './application-lifetime.js';
export function createApplicationEvents({ document, window, editor, eventsEditorControllerPort, eventsEditorUiCommandPort, eventsPreviewCommandPort, eventsDocumentUiCommandPort, ensureCurrentDocumentForEditing, updateLargeDocumentMode, closeAppMenus, closeContextMenus, showToast, newDocument, toggleSidebar, renameCurrentDocument }) {
  const lifetime = createApplicationLifetime();
  try {
    lifetime.own(eventsEditorControllerPort.subscribeTransactions(transaction => {
      if (!transaction.interactive) return;
      ensureCurrentDocumentForEditing();
      updateLargeDocumentMode();
      eventsEditorUiCommandPort.invoke('preparePreviewEditorMetrics');
      eventsPreviewCommandPort.scheduleUpdate();
      eventsPreviewCommandPort.scheduleCountUpdate();
      eventsEditorUiCommandPort.invoke('requestDocumentPersistence', 'editor-transaction');
    }));
    lifetime.own(eventsEditorUiCommandPort.register({
      selectionChanged: () => eventsPreviewCommandPort.scheduleFocusUpdate()
    }));





    // Settings menu trigger preserves the legacy menu-close side effect without inline handlers.
    const settingsTrigger = document.querySelector('[data-settings-open]');
    if (settingsTrigger) lifetime.listen(settingsTrigger, 'click', closeAppMenus);

    // 点击外部关闭下拉菜单
    lifetime.listen(document, 'click', (e) => {
      if (!e.target.closest('.context-menu')) {
        closeContextMenus();
      }
      if (!e.target.closest('.menu-dropdown')) {
        closeAppMenus();
      }

    });


    // 快捷键
    function isEditorShortcutTarget(target) {
      return target === editor || Boolean(editor?.contains?.(target));
    }

    function isTextControlOutsideEditor(target) {
      if (!(target instanceof window.Element) || isEditorShortcutTarget(target)) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function invokeShortcut(action) {
      try {
        const result = action();
        if (result && typeof result.catch === 'function') {
          result.catch(error => showToast(error?.message || String(error)));
        }
      } catch (error) {
        showToast(error?.message || String(error));
      }
    }

    function handleAppKeydown(e) {
      const tableCellInput = e.target instanceof window.Element
        ? e.target.closest('[data-hybrid-table-cell-input]')
        : null;
      const codeBlockEditor = e.target instanceof window.Element
        ? e.target.closest('[data-hybrid-code-editor]')
        : null;
      const key = String(e.key || '').toLowerCase();
      const modifier = e.ctrlKey || e.metaKey;
      if (tableCellInput) {
        // 单元格输入保留浏览器原生文本撤销；保存前先同步当前单元格，
        // 避免 Ctrl/Cmd+S 保存到尚未写回 Markdown 的旧值。
        if (modifier && key === 's') {
          e.preventDefault();
          e.stopPropagation();
          tableCellInput.__markdownEditorCommitTableCell?.();
          invokeShortcut(() => eventsEditorUiCommandPort.invoke(e.shiftKey ? 'saveAsMarkdown' : 'saveCurrentFile'));
        }
        return;
      }
      if (codeBlockEditor) {
        // 代码块深度编辑时保留 textarea 原生撤销；保存前先写回 Markdown。
        if (modifier && key === 's') {
          e.preventDefault();
          e.stopPropagation();
          codeBlockEditor.__markdownEditorCommitCodeBlock?.();
          invokeShortcut(() => eventsEditorUiCommandPort.invoke(e.shiftKey ? 'saveAsMarkdown' : 'saveCurrentFile'));
        }
        return;
      }
      const outsideTextControl = isTextControlOutsideEditor(e.target);
      let action = null;

      if (modifier) {
        if (key === 's' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('saveAsMarkdown');
        else if (key === 's') action = () => eventsEditorUiCommandPort.invoke('saveCurrentFile');
        else if (key === 'o') action = () => eventsDocumentUiCommandPort.invoke('importFile');
        else if (key === 'n') action = newDocument;
        else if (key === 'b' && e.shiftKey) action = toggleSidebar;
        else if (!outsideTextControl && key === 'z' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'redo');
        else if (!outsideTextControl && key === 'y') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'redo');
        else if (!outsideTextControl && key === 'z') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'undo');
        else if (!outsideTextControl && key === 'k' && e.shiftKey) action = () => eventsEditorUiCommandPort.invoke('openImage');
        else if (!outsideTextControl && key === 'b') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'bold');
        else if (!outsideTextControl && key === 'u') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'underline');
        else if (!outsideTextControl && key === 'i') action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'italic');
        else if (!outsideTextControl && key === 'k') action = () => eventsEditorUiCommandPort.invoke('openLink');
        else if (!outsideTextControl && key === 'f') action = () => eventsEditorUiCommandPort.invoke('openFind', false);
        else if (!outsideTextControl && key === 'h') action = () => eventsEditorUiCommandPort.invoke('openFind', true);
      } else if (key === 'f2') {
        action = renameCurrentDocument;
      } else if (key === 'f11') {
        action = () => eventsEditorUiCommandPort.invoke('executeEditorAction', 'page-fullscreen');
      }

      if (action) {
        e.preventDefault();
        e.stopPropagation();
        invokeShortcut(action);
        return;
      }

      if (key === 'tab' && isEditorShortcutTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.setRangeText('    ', start, end, 'end');
      }
    }
    lifetime.listen(document, 'keydown', handleAppKeydown, true);


    return Object.freeze({ destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
