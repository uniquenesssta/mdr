/**
 * Responsibility: Restore editor preferences, initialize the session and open the launch path in order.
 * Imports: Explicit startup capabilities and lifetime scope.
 * Exports: createWorkspaceStartup.
 * State/side effects: Owns startup/event lifetime only; document and settings authorities remain in their features.
 * Lifecycle: Explicit start and idempotent destroy with cancellation of late results.
 */
import { createApplicationLifetime } from './application-lifetime.js';
import { createLaunchOpenController } from '../features/documents/index.js';
export function createWorkspaceStartup({ editor, preview, filenameInput, t, localStorage, platform, documentCommands, bootstrapSettingsStorePort, bootstrapEditorControllerPort, bootstrapLayoutStatePort, bootstrapPreviewCommandPort, bootstrapHelpPort, applyEditorPreferences, applyTableVisualEditingSetting, applyCodeVisualEditingSetting, setupDocuments, updateStatusBar, updateLargeDocumentMode, setLayoutMode, isHybridLayoutMode, refreshClassicLocalizedState }) {
  const lifetime = createApplicationLifetime();
  const LARGE_DOCUMENT_CHARS = bootstrapPreviewCommandPort.thresholds.scheduling.postprocess.deferChars;
    async function start() {
      if (!lifetime.alive) throw new Error('Application startup destroyed.');
      const restoredSettings = bootstrapSettingsStorePort.snapshot;

      // 每次启动都建立新的会话文档。上次打开的外部路径仅迁移到“最近打开”，
      // 不再先恢复旧正文或文档元数据，避免侧栏历史和后台快照重新进入当前会话。
      bootstrapEditorControllerPort.setText('');
      filenameInput.value = t('filenameDefault');
      bootstrapLayoutStatePort.setSidebar({ visible: restoredSettings.sidebarVisible });
      applyEditorPreferences();
      applyTableVisualEditingSetting({ persist: false, notify: false });
      applyCodeVisualEditingSetting({ persist: false, notify: false });
      await setupDocuments();
      if (!lifetime.alive) return false;
      updateStatusBar();
      localStorage.setItem('md_editor_preview_mode', 'preview');

      updateLargeDocumentMode();
      if (editor.getTextLength() >= LARGE_DOCUMENT_CHARS) {
        preview.innerHTML = '<div class="markdown-body preview-loading">正在生成实时预览…</div>';
      }
      bootstrapPreviewCommandPort.updateCount();
      bootstrapPreviewCommandPort.setViewMode('preview', true);


      // 恢复用户选择的布局；单视图模式复用同一 CodeMirror 文档状态。
      const savedLayoutMode = restoredSettings.layoutMode;
      if (['both', 'hybrid', 'edit', 'preview'].includes(savedLayoutMode)) {
        setLayoutMode(savedLayoutMode, false, false);
      } else {
        setLayoutMode('both', false);
      }
      if (!bootstrapLayoutStatePort.snapshot.split.previewCollapsed && !isHybridLayoutMode()) {
        bootstrapPreviewCommandPort.requestLayoutRefresh({ forceRender: true, reason: 'startup-layout' });
      }


      bootstrapHelpPort.openFirstRun();
      refreshClassicLocalizedState();
      if (platform.capabilities.isDesktop) {
        const launchOpen = createLaunchOpenController({ launch: platform.launch,
          openPath: path => documentCommands.invoke('openImportPath', path),
          reportError: error => { console.error('打开请求处理失败：', error); } });
        lifetime.own(() => launchOpen.destroy());
        await launchOpen.start();
      } else {
        const initialPath = platform.capabilities.desktop.fileSystem ? await platform.files.getInitialPath() : null;
        if (!lifetime.alive) return false;
        if (initialPath) await documentCommands.invoke('openImportPath', initialPath);
      }
      return lifetime.alive;
    }


  return Object.freeze({ start, destroy: lifetime.destroy });
}
