/**
 * Responsibility: Project Persistence status and Preview strategy into existing shell elements.
 * Imports: Explicit caller capabilities and application lifetime management.
 * Exports: createWorkspaceStatus.
 * State/side effects: Owns only this feature's projections, listeners and pending UI work.
 * Lifecycle: Explicit construction, rollback on failure and idempotent destroy.
 */
import { createApplicationLifetime } from '../../../bootstrap/application-lifetime.js';

export function createWorkspaceStatus({ document, editor, coreI18nPort, corePreviewCommandPort, coreSettingsStorePort, coreSaveStatusStorePort, coreDocumentSessionPort, coreLayoutStatePort, coreEditorUiCommandPort }) {
  const lifetime = createApplicationLifetime();
  const setTimeout = lifetime.setTimeout, clearTimeout = lifetime.clearTimeout;
  try {
const LARGE_DOCUMENT_CHARS = corePreviewCommandPort.thresholds.scheduling.postprocess.deferChars;
    const ULTRA_LARGE_DOCUMENT_CHARS = corePreviewCommandPort.thresholds.mode.virtualChars;
const corePreviewBehaviorThresholds = corePreviewCommandPort.thresholds;
    let saveStatusResetTimer = 0;
    const getActiveDocumentId = () => coreDocumentSessionPort.activeId;
    function updatePreviewStrategyBadge(mode = 'full', details = {}) {
      const badge = document.getElementById('preview-strategy-badge');
      if (!badge) return;
      const resolved = corePreviewCommandPort.normalizePerformanceMode(mode === 'standard' ? 'full' : mode);
      const labels = { full: '完整预览', virtual: '虚拟预览', chapter: '当前章节' };
      const shouldShow = resolved !== 'full' || coreSettingsStorePort.get('previewPerformanceMode') !== 'auto' || editor.textLength >= corePreviewBehaviorThresholds.mode.badgeChars;
      badge.hidden = !shouldShow;
      badge.textContent = labels[resolved] || labels.full;
      badge.dataset.mode = resolved;
      const blockCount = Number(details.blockCount) || 0;
      const mountedBlocks = Number(details.mountedBlocks) || 0;
      badge.title = resolved === 'chapter'
        ? '超大文档仅实时预览光标所在章节'
        : resolved === 'virtual'
          ? `全文虚拟预览：${mountedBlocks || 0}/${blockCount || 0} 个块已挂载`
          : '完整实时预览';
      document.body.dataset.previewPerformanceMode = resolved;
    }

    function t(key, ...args) {
      return coreI18nPort.t(key, ...args);
    }

    function refreshClassicLocalizedState() {
      updateCollapseBtnLabels();
      if (coreEditorUiCommandPort.has('refreshToolbarLayoutLabel')) coreEditorUiCommandPort.invoke('refreshToolbarLayoutLabel');
      updateStatusBar();
      corePreviewCommandPort.updateCount();
      if (coreEditorUiCommandPort.has('refreshToolbarBoundary')) coreEditorUiCommandPort.invoke('refreshToolbarBoundary');
    }

    function updateCollapseBtnLabels() {
      const editorBtn = document.getElementById('editor-collapse-btn');
      const previewBtn = document.getElementById('preview-collapse-btn');
      if (editorBtn) editorBtn.title = coreLayoutStatePort.editorCollapsed ? t('expandEditor') : t('collapseEditor');
      if (previewBtn) previewBtn.title = coreLayoutStatePort.previewCollapsed ? t('expandPreview') : t('collapsePreview');
    }

    function updateLargeDocumentMode(length = editor.textLength) {
      document.body.classList.toggle('large-document', length >= LARGE_DOCUMENT_CHARS);
      document.body.classList.toggle('ultra-large-document', length >= ULTRA_LARGE_DOCUMENT_CHARS);
    }

    function getSaveStatusSnapshot() {
      return coreSaveStatusStorePort.snapshot;
    }

    function resolveSaveStatusMessage(snapshot, state) {
      const explicit = String(snapshot?.message || '');
      if (state === 'error') {
        if (explicit.startsWith('保存失败')) return explicit;
        return '保存失败：' + (explicit || '未知错误');
      }
      if (explicit) return explicit;
      if (state === 'queued') return '等待保存…';
      if (state === 'saving') {
        const progress = Number(snapshot?.progress);
        if (Number.isFinite(progress)) {
          return `正在分段创建安全快照… ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;
        }
        return snapshot?.backendVersion === 0 ? '正在创建安全快照…' : '正在后台保存…';
      }
      if (state === 'saved') return snapshot?.snapshotCreated ? '✓ 已保存并生成快照' : '✓ ' + t('saved');
      return '✓ ' + t('saved');
    }

    function renderSaveHint(snapshot = getSaveStatusSnapshot()) {
      const hint = document.getElementById('save-hint');
      if (!hint) return;
      const state = snapshot?.state === 'idle' ? 'saved' : String(snapshot?.state || 'saved');
      if (state === 'loading') return;
      clearTimeout(saveStatusResetTimer);
      saveStatusResetTimer = 0;
      hint.dataset.state = state;
      hint.textContent = resolveSaveStatusMessage(snapshot, state);
      hint.classList.toggle('show', state !== 'saved');
      if (state === 'saved') {
        hint.classList.add('show');
        saveStatusResetTimer = setTimeout(() => hint.classList.remove('show'), 1500);
      }
    }

    function updateStatusBar() {
      const autoSaveEnabled = Boolean(coreSettingsStorePort.get('autoSaveEnabled'));
      const autoSaveDelay = Number(coreSettingsStorePort.get('autoSaveDelay'));
      const statusLeft = document.getElementById('status-left');
      if (statusLeft) statusLeft.textContent = autoSaveEnabled
        ? `自动保存已启用 · ${Math.round(autoSaveDelay) / 1000} 秒`
        : '自动保存已关闭';
      if (!autoSaveEnabled) {
        clearTimeout(saveStatusResetTimer);
        saveStatusResetTimer = 0;
        const hint = document.getElementById('save-hint');
        if (hint) {
          hint.dataset.state = 'disabled';
          hint.textContent = '自动保存关闭';
          hint.classList.remove('show');
        }
        return;
      }
      renderSaveHint(getSaveStatusSnapshot());
    }

    function renderPersistenceStatus(snapshot) {
      if (!snapshot || (snapshot.documentId && snapshot.documentId !== getActiveDocumentId())) return;
      if (snapshot.operation === 'load') {
        const statusLeft = document.getElementById('status-left');
        if (!statusLeft) return;
        if (snapshot.state === 'loading') {
          if (snapshot.phase === 'index') statusLeft.textContent = '正在读取文档索引…';
          else if (snapshot.phase === 'manifest') statusLeft.textContent = '索引已恢复，正在读取正文…';
          else {
            const progress = Math.max(0, Math.min(100, Math.round((Number(snapshot.progress) || 0) * 100)));
            statusLeft.textContent = `正在分段恢复文档… ${progress}%`;
          }
        } else if (snapshot.state === 'error') {
          statusLeft.textContent = '文档恢复失败';
        } else if (snapshot.state === 'idle') {
          updateStatusBar();
        }
        return;
      }
      renderSaveHint(snapshot);
    }
    lifetime.own(coreI18nPort.subscribe(() => refreshClassicLocalizedState()));
    lifetime.own(coreSaveStatusStorePort.subscribe(event => renderPersistenceStatus(event.current)));
    renderPersistenceStatus(getSaveStatusSnapshot());
    return Object.freeze({ updateStatusBar, updateLargeDocumentMode, refreshClassicLocalizedState, updatePreviewStrategyBadge, destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
