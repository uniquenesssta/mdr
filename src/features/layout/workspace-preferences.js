import { telemetry } from '../telemetry/index.js';
/**
 * Responsibility: Project Settings and Layout into the editor and toolbar without owning persisted settings.
 * Imports: Explicit caller capabilities and application lifetime management.
 * Exports: createWorkspacePreferences.
 * State/side effects: Owns only this feature's projections, listeners and pending UI work.
 * Lifecycle: Explicit construction, rollback on failure and idempotent destroy.
 */
import { createApplicationLifetime } from '../../bootstrap/application-lifetime.js';

export function createWorkspacePreferences({ document, window, editor, preview, documentModel, coreSettingsStorePort, coreEditorUiCommandPort, coreLayoutStatePort, corePreviewCommandPort, splitController, t, showToast, updateStatusBar, updateInlineColorToolAvailability }) {
  const lifetime = createApplicationLifetime();
  const setTimeout = lifetime.setTimeout, clearTimeout = lifetime.clearTimeout;
  try {
const LARGE_DOCUMENT_CHARS = corePreviewCommandPort.thresholds.scheduling.postprocess.deferChars;
    const editorToolsSettingsStorePort = coreSettingsStorePort, editorToolsEditorUiCommandPort = coreEditorUiCommandPort, editorToolsLayoutStatePort = coreLayoutStatePort, editorToolsSplitControllerPort = splitController, editorToolsPreviewCommandPort = corePreviewCommandPort;
    let activeLayoutTransition = null;
    function isWindowResizeBurstActive() {
      return performance.now() < coreLayoutStatePort.windowResizeActiveUntil;
    }

    function consumeViewTransitionPromise(promise) {
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    }

    function silenceViewTransition(transition) {
      if (!transition) return;
      consumeViewTransitionPromise(transition.ready);
      consumeViewTransitionPromise(transition.updateCallbackDone);
      consumeViewTransitionPromise(transition.finished);
    }

    function runLayoutTransition(commit, kind = 'layout') {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const canUseViewTransition = typeof document.startViewTransition === 'function'
        && document.documentElement.classList.contains('app-ready')
        && !reduceMotion
        && !coreLayoutStatePort.isResizing
        && !coreLayoutStatePort.isSidebarResizing
        && !isWindowResizeBurstActive();
      if (!canUseViewTransition) {
        commit();
        return null;
      }

      try {
        if (activeLayoutTransition) {
          silenceViewTransition(activeLayoutTransition);
          activeLayoutTransition.skipTransition?.();
        }
        document.documentElement.dataset.layoutTransition = kind;
        const transition = document.startViewTransition(commit);
        silenceViewTransition(transition);
        activeLayoutTransition = transition;
        const clear = () => {
          if (activeLayoutTransition !== transition) return;
          activeLayoutTransition = null;
          delete document.documentElement.dataset.layoutTransition;
        };
        transition.finished.then(clear, clear);
        return transition;
      } catch (_) {
        delete document.documentElement.dataset.layoutTransition;
        commit();
        return null;
      }
    }

    function toggleSidebar() {
      if (coreLayoutStatePort.sidebarAutoCollapsed) {
        showToast('当前窗口较窄，侧边栏已自动折叠');
        return;
      }
      const nextVisible = !coreLayoutStatePort.sidebarVisible;
      coreSettingsStorePort.set('sidebarVisible', nextVisible);
      runLayoutTransition(() => { coreLayoutStatePort.sidebarVisible = nextVisible; }, 'sidebar');
      showToast(coreLayoutStatePort.sidebarVisible ? '已显示侧边栏' : '已隐藏侧边栏');
    }

    function updateToolbarItemVisibility() {
      document.querySelectorAll('[data-toolbar-item]').forEach(item => {
        item.classList.toggle('toolbar-item-hidden', new Set(coreSettingsStorePort.get('toolbarHiddenItems')).has(item.dataset.toolbarItem));
      });

      const formatGroup = document.querySelector('.editor-toolbar .format-group');
      if (!formatGroup) return;
      const children = Array.from(formatGroup.children);
      children.filter(child => child.classList.contains('divider'))
        .forEach(divider => divider.classList.add('toolbar-divider-hidden'));

      let hasVisibleItem = false;
      let pendingDivider = null;
      for (const child of children) {
        if (child.classList.contains('divider')) {
          if (hasVisibleItem) pendingDivider = child;
          continue;
        }
        if (child.classList.contains('toolbar-item-hidden')) continue;
        if (pendingDivider) {
          pendingDivider.classList.remove('toolbar-divider-hidden');
          pendingDivider = null;
        }
        hasVisibleItem = true;
      }
      if (coreEditorUiCommandPort.has('refreshToolbarBoundary')) coreEditorUiCommandPort.invoke('refreshToolbarBoundary');
    }

    function applyEditorPreferences() {
      document.documentElement.style.setProperty('--editor-font-size', coreSettingsStorePort.get('editorFontSize') + 'px');
      if (coreSettingsStorePort.get('editorTextColor')) document.body.style.setProperty('--color-editor-text', coreSettingsStorePort.get('editorTextColor'));
      else document.body.style.removeProperty('--color-editor-text');
      if (coreSettingsStorePort.get('activeLineColor')) document.body.style.setProperty('--color-editor-active-line', coreSettingsStorePort.get('activeLineColor'));
      else document.body.style.removeProperty('--color-editor-active-line');
      const toolbar = document.querySelector('.editor-toolbar');
      if (toolbar) {
        toolbar.classList.toggle('hidden', !coreSettingsStorePort.get('toolbarVisible'));
        toolbar.classList.toggle('is-hidden', !coreSettingsStorePort.get('toolbarVisible'));
      }
      updateToolbarItemVisibility();
      updateInlineColorToolAvailability();
      if (coreEditorUiCommandPort.has('preparePreviewEditorMetrics')) coreEditorUiCommandPort.invoke('preparePreviewEditorMetrics');
      if (coreEditorUiCommandPort.has('invalidatePreviewAnchorMetrics')) coreEditorUiCommandPort.invoke('invalidatePreviewAnchorMetrics');
    }
    function updateTableVisualEditingToggle() {
      const item = document.getElementById('table-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', coreSettingsStorePort.get('tableVisualEditing'));
      item.setAttribute('aria-checked', coreSettingsStorePort.get('tableVisualEditing') ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = coreSettingsStorePort.get('tableVisualEditing') ? '开' : '关';
    }

    function applyTableVisualEditingSetting(options = {}) {
      const enabled = Boolean(coreSettingsStorePort.get('tableVisualEditing'));
      editor.virtualEditor?.setHybridTableVisualEditing?.(enabled);
      updateTableVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('tableVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '表格深度可视化编辑已开启：双击单元格直接编辑，也可点击“编辑源码”切换源码'
          : '表格深度可视化编辑已关闭：恢复为只读展示与源码切换');
      }
      return enabled;
    }

    function toggleTableVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !coreSettingsStorePort.get('tableVisualEditing');
      try {
        editorToolsSettingsStorePort.set('tableVisualEditing', nextEnabled);
      } catch (error) {
        showToast('表格可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      applyTableVisualEditingSetting({ persist: false });
    }

    function updateCodeVisualEditingToggle() {
      const item = document.getElementById('code-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', coreSettingsStorePort.get('codeVisualEditing'));
      item.setAttribute('aria-checked', coreSettingsStorePort.get('codeVisualEditing') ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = coreSettingsStorePort.get('codeVisualEditing') ? '开' : '关';
    }

    function applyCodeVisualEditingSetting(options = {}) {
      const enabled = Boolean(coreSettingsStorePort.get('codeVisualEditing'));
      editor.virtualEditor?.setHybridCodeVisualEditing?.(enabled);
      updateCodeVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('codeVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '代码块深度可视化编辑已开启：双击有语言或无语言代码块直接编辑'
          : '代码块深度可视化编辑已关闭：恢复为高亮展示与源码切换');
      }
      return enabled;
    }

    function toggleCodeVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !coreSettingsStorePort.get('codeVisualEditing');
      try {
        editorToolsSettingsStorePort.set('codeVisualEditing', nextEnabled);
      } catch (error) {
        showToast('代码块可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      applyCodeVisualEditingSetting({ persist: false });
    }

    function getLayoutMode() {
      return editorToolsLayoutStatePort.layoutMode;
    }

    function isHybridLayoutMode() {
      return getLayoutMode() === 'hybrid';
    }

    function applyEditorPresentationMode(mode) {
      const hybrid = mode === 'hybrid' && Boolean(editor.virtualEditor?.setPresentationMode);
      document.body.classList.toggle('hybrid-view-mode', hybrid);
      editor.virtualEditor?.setPresentationMode?.(hybrid ? 'hybrid' : 'source');
      const actualMode = editor.virtualEditor?.getPresentationMode?.() || 'source';
      if (actualMode !== (hybrid ? 'hybrid' : 'source')) {
        telemetry.diagnostic?.('hybrid.presentation-mode-mismatch', {
          category: 'editor.hybrid',
          status: 'error',
          dedupeKey: 'hybrid.presentation-mode-mismatch',
          minIntervalMs: 5000,
          details: {
            requestedMode: hybrid ? 'hybrid' : 'source',
            actualMode,
            layoutMode: mode,
            documentVersion: documentModel?.getDocumentVersion?.() || 0
          }
        });
      }
      const badge = document.getElementById('editor-presentation-badge');
      if (badge) {
        badge.hidden = !hybrid;
        badge.textContent = t('viewHybrid');
      }
      if (hybrid) editorToolsPreviewCommandPort.suspendForHybridMode();
      return hybrid;
    }

    function setLayoutMode(mode, animate = document.documentElement.classList.contains('app-ready'), persist = true) {
      const previousMode = getLayoutMode();
      const previewWasHidden = editorToolsLayoutStatePort.previewCollapsed || previousMode === 'hybrid';
      let nextMode = ['both', 'hybrid', 'edit', 'preview'].includes(mode) ? mode : 'both';
      if (nextMode === 'hybrid' && !editor.virtualEditor?.setPresentationMode) nextMode = 'edit';
      if (persist) editorToolsSettingsStorePort.set('layoutMode', nextMode);
      editorToolsLayoutStatePort.layoutMode = nextMode;

      if (editorToolsEditorUiCommandPort.has('refreshToolbarLayoutLabel')) {
        editorToolsEditorUiCommandPort.invoke('refreshToolbarLayoutLabel', nextMode);
      }

      const involvesHybridMode = previousMode === 'hybrid' || nextMode === 'hybrid';
      const documentLength = documentModel?.getTextLength?.() ?? editor.textLength;
      const shouldAnimate = animate && !involvesHybridMode && documentLength < LARGE_DOCUMENT_CHARS;
      const commit = () => {
        applyEditorPresentationMode(nextMode);
        editorToolsSplitControllerPort.applyMode(nextMode, {
          resetCompactPane: previousMode !== 'both' && nextMode === 'both'
        });
      };
      if (shouldAnimate) runLayoutTransition(commit, 'panes');
      else commit();

      if (nextMode === 'hybrid') {
        editorToolsPreviewCommandPort.scheduleUpdate();
      } else if (!editorToolsLayoutStatePort.previewCollapsed) {
        const previewBody = preview.querySelector('.markdown-body');
        editorToolsPreviewCommandPort.requestLayoutRefresh({
          forceRender: previewWasHidden
            || !editorToolsPreviewCommandPort.snapshot.lastStableResult
            || !previewBody
            || previewBody.classList.contains('preview-loading')
            || previewBody.childElementCount === 0,
          reason: `layout:${previousMode}->${nextMode}`
        });
      }
      telemetry.record('layout.mode-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: {
          previousMode,
          nextMode,
          presentation: nextMode === 'hybrid' ? 'hybrid' : 'source',
          animated: shouldAnimate,
          documentLength
        }
      });
    }
    function applySettings(event) {
      const applied = event?.detail?.snapshot;
      if (!applied || !Array.isArray(event?.detail?.changedIds)) return;
      const changedIds = event.detail.changedIds;
      if (changedIds.includes('sidebarVisible')) coreLayoutStatePort.sidebarVisible = applied.sidebarVisible;
      if (changedIds.includes('layoutMode') || changedIds.includes('previewPerformanceMode')) setLayoutMode(applied.layoutMode, false, false);
      if (['editorFontSize', 'editorTextColor', 'activeLineColor', 'toolbarVisible', 'toolbarHiddenItems'].some(id => changedIds.includes(id))) applyEditorPreferences();
      updateStatusBar(); showToast('设置已保存');
    }
    lifetime.listen(document, 'markdown-editor:settings-changed', applySettings);
    const sidebarHide = document.querySelector('[data-sidebar-hide]');
    if (sidebarHide) lifetime.listen(sidebarHide, 'click', toggleSidebar);
    lifetime.own(() => { silenceViewTransition(activeLayoutTransition); activeLayoutTransition?.skipTransition?.(); activeLayoutTransition = null; delete document.documentElement.dataset.layoutTransition; });
    lifetime.own(coreEditorUiCommandPort.register({ getLayoutMode, setLayoutMode, toggleSidebar, toggleTableVisualEditing, toggleCodeVisualEditing, getPreviewRuntimeSettings: () => ({ previewPerformanceMode: coreSettingsStorePort.get('previewPerformanceMode'), editorFontSize: coreSettingsStorePort.get('editorFontSize') }) }));
    return Object.freeze({ setLayoutMode, getLayoutMode, isHybridLayoutMode, toggleSidebar, applyEditorPreferences, applyTableVisualEditingSetting, applyCodeVisualEditingSetting, destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
