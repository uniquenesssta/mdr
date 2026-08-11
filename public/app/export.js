    const exportCompatibilityHost = document.getElementById('compatibility-business-ports');
    const exportPlatformPort = exportCompatibilityHost?.markdownEditorPlatformPort;
    const exportDocumentDomainPort = exportCompatibilityHost?.markdownEditorDocumentDomainPort;
    const exportDocumentSessionPort = exportCompatibilityHost?.markdownEditorDocumentSessionPort;
    const exportDocumentControllerPort = exportCompatibilityHost?.markdownEditorDocumentControllerPort;
    const exportDocumentUiCommandPort = exportCompatibilityHost?.markdownEditorDocumentUiCommandPort;
    if (!exportDocumentDomainPort) throw new Error('Document domain compatibility port is unavailable.');
    if (!exportDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
    if (!exportDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
    if (!exportDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
    exportDocumentUiCommandPort.register({ importFile: () => triggerImportFile() });
    let saveTimer;
    function autoSave() {
      clearTimeout(saveTimer);
      if (!autoSaveEnabled) {
        updateStatusBar();
        return;
      }
      setSaveStatus('queued');
      saveTimer = setTimeout(() => {
        setSaveStatus('saving');
        // Tauri 中的超大文档会提交到 Rust 后台增量日志；浏览器模式继续使用本地存储。
        saveCurrentDocumentState(false).then(result => {
          if (result?.stale) return;
          if (result?.error) setSaveStatus('error', '保存失败：' + result.error);
          else if (!result?.native) showSaveHint();
        }).catch(error => {
          console.error('Auto save failed:', error);
          setSaveStatus('error', '保存失败：' + (error?.message || String(error)));
        });
      }, autoSaveDelay);
    }

    function showSaveHint() {
      setSaveStatus('saved');
    }


    class ExportCancelledError extends Error {
      constructor() {
        super('EXPORT_CANCELLED');
        this.name = 'ExportCancelledError';
      }
    }

    let exportTaskId = 0;
    let activeExportTask = null;

    function waitForExportFrame() {
      return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function beginExportTask(title) {
      if (activeExportTask && !activeExportTask.cancelable) {
        showToast('当前导出正在生成文件，请稍候');
        return null;
      }
      if (activeExportTask) activeExportTask.cancelled = true;
      const task = {
        id: ++exportTaskId,
        title,
        cancelled: false,
        cancelable: true,
        modalOpened: false,
        update(progress, message) {
          if (activeExportTask !== task) return;
          const modal = document.getElementById('export-progress-modal');
          const value = document.getElementById('export-progress-value');
          const status = document.getElementById('export-progress-status');
          const heading = document.getElementById('export-progress-title');
          if (heading) heading.textContent = task.title;
          if (value) value.style.width = Math.max(0, Math.min(100, Number(progress) || 0)) + '%';
          if (status) status.textContent = message || '正在处理…';
          if (modal && !task.modalOpened) {
            task.modalOpened = true;
            const request = {
              options: { initialFocus: document.getElementById('export-progress-cancel') }
            };
            modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
            if (request.error) throw request.error;
          }
        },
        setCancelable(value) {
          task.cancelable = Boolean(value);
          const button = document.getElementById('export-progress-cancel');
          if (button) {
            button.disabled = !task.cancelable;
            button.textContent = task.cancelable ? '取消导出' : '正在生成文件…';
          }
        },
        throwIfCancelled() {
          if (task.cancelled || activeExportTask !== task) throw new ExportCancelledError();
        }
      };
      activeExportTask = task;
      task.setCancelable(true);
      task.update(2, '正在准备文档…');
      return task;
    }

    function finishExportTask(task) {
      if (!task || activeExportTask !== task) return;
      activeExportTask = null;
      const modal = document.getElementById('export-progress-modal');
      const request = { reason: 'export-finished' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function cancelActiveExport() {
      if (!activeExportTask?.cancelable) return;
      activeExportTask.cancelled = true;
      activeExportTask.update(0, '正在取消导出…');
    }

    async function createFullPreviewBodyForExport(task = null) {
      const body = document.createElement('div');
      body.className = 'markdown-body';
      const editorVersion = documentModel?.getDocumentVersion?.() ?? editor.virtualEditor?.getDocumentVersion?.();
      const workerBlocks = previewWorkerClient
        && previewWorkerClient.workerVersion === editorVersion
        && Array.isArray(previewWorkerClient.blocks)
        ? previewWorkerClient.blocks
        : null;

      if (workerBlocks?.length) {
        const batchSize = editor.textLength >= 400000 ? 48 : 96;
        for (let start = 0; start < workerBlocks.length; start += batchSize) {
          task?.throwIfCancelled();
          const fragment = document.createDocumentFragment();
          const end = Math.min(workerBlocks.length, start + batchSize);
          for (let index = start; index < end; index += 1) {
            fragment.append(...createPreviewNodesForBlock(workerBlocks[index]));
          }
          body.append(fragment);
          task?.update(8 + Math.round((end / workerBlocks.length) * 52), `正在构建导出内容 ${end}/${workerBlocks.length} 块`);
          if (end < workerBlocks.length) await waitForExportFrame();
        }
        return body;
      }

      task?.update(12, '正在解析完整文档…');
      await waitForExportFrame();
      task?.throwIfCancelled();
      const source = documentModel?.createSnapshot?.('full-preview-export') ?? editor.value;
      try {
        if (typeof marked !== 'undefined') {
          const mathApi = window.markdownEditorMath;
          const protectedMath = typeof mathApi?.protectSource === 'function'
            ? mathApi.protectSource(source, 'EXPORT_MATH')
            : { text: source, placeholders: [] };
          const rendered = marked.parse(protectedMath.text);
          body.innerHTML = typeof mathApi?.restoreSource === 'function'
            ? mathApi.restoreSource(rendered, protectedMath.placeholders)
            : rendered;
        } else {
          body.innerHTML = '<pre class="f-raw-fallback">' + escapeHtml(source) + '</pre>';
        }
      } catch (error) {
        console.error('Export preview render error:', error);
        body.innerHTML = '<pre class="f-raw-fallback">' + escapeHtml(source) + '</pre>';
      }
      task?.throwIfCancelled();
      task?.update(60, '完整文档已解析');
      return body;
    }

    async function enhanceFullPreviewForExport(root, task = null) {
      const children = Array.from(root.children || []);
      const batchSize = 18;
      if (!children.length) return;
      for (let start = 0; start < children.length; start += batchSize) {
        task?.throwIfCancelled();
        const batch = children.slice(start, start + batchSize);
        styleTaskLists(batch);
        const mathRenderer = window.markdownEditorPresentation?.math || window.markdownEditorMath;
        if (mathRenderer?.renderTree || typeof renderMathInElement !== 'undefined') {
          batch.forEach(node => {
            if (!(mathRenderer?.containsMath?.(node.textContent) ?? node.textContent?.includes('$'))) return;
            if (mathRenderer?.renderTree) {
              mathRenderer.renderTree(node, { delimiters: mathRenderer.delimiters });
              return;
            }
            renderMathInElement(node, {
              delimiters: window.markdownEditorMath?.delimiters,
              throwOnError: false
            });
          });
        }
        for (const node of batch) {
          task?.throwIfCancelled();
          if (node.querySelector?.('pre code.language-mermaid') || node.matches?.('pre') && node.querySelector?.('code.language-mermaid')) {
            await renderMermaidBlocks([node], () => Boolean(task?.cancelled));
          }
        }
        const end = Math.min(children.length, start + batchSize);
        task?.update(62 + Math.round((end / children.length) * 28), `正在增强导出内容 ${end}/${children.length}`);
        if (end < children.length) await waitForExportFrame();
      }
    }


    function getExportSaveOptions(title, extension, filterName, extensions = [extension]) {
      return {
        title,
        extension,
        extensions,
        filterName,
        defaultDirectory: exportDirectory
      };
    }

    async function exportTextContent(content, preferredName, options) {
      if (exportPlatformPort?.supports('desktop.dialogs') && exportPlatformPort?.supports('desktop.fileSystem')) {
        const path = await exportPlatformPort.call('dialogs', 'saveFile', preferredName, options);
        if (!path) return null;
        await exportPlatformPort.call('files', 'writeText', path, content, { extension: options.extension, reason: 'export' });
        return path;
      }
      return false;
    }

    function dataUrlToBytes(dataUrl) {
      const value = String(dataUrl || '');
      const comma = value.indexOf(',');
      if (comma < 0) throw new Error('图片数据无效');
      const header = value.slice(0, comma);
      const payload = value.slice(comma + 1);
      if (!/;base64/i.test(header)) return new TextEncoder().encode(decodeURIComponent(payload));
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }

    // 手动保存
    async function saveToLocal() {
      const generation = exportDocumentControllerPort.generation;
      try {
        setSaveStatus('saving', '正在手动保存…');
        const saveResult = await saveCurrentDocumentState(true, { waitForNative: true, forceSnapshot: true });
        if (saveResult?.stale || !exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
        const doc = exportDocumentControllerPort.getActiveRecord();
        exportDocumentControllerPort.persistLegacyActiveSnapshot({
          title: filenameInput.value,
          content: documentModel?.createSnapshot?.('manual-local-save') ?? editor.value,
          nativeBacked: Boolean(doc?.nativeBacked && window.markdownEditorDocumentStore?.available)
        });
        if (!exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
        updateStatusBar();
        showSaveHint();
        showToast(t('toastSaved'));
        return true;
      } catch (error) {
        if (exportDocumentControllerPort.isStaleError(error)) return false;
        setSaveStatus('error', '保存失败：' + (error?.message || String(error)));
        showToast(error?.message || String(error));
        return false;
      }
    }

    async function saveMarkdownWithPicker(contentFactory, preferredName, snapshotReason = 'save-as-markdown') {
      const normalizedName = normalizeDocumentTitle(preferredName || t('filenameDefault'));
      if (exportPlatformPort?.supports('desktop.dialogs') && exportPlatformPort?.supports('desktop.fileSystem')) {
        const path = await exportPlatformPort.call('dialogs', 'saveFile', normalizedName, {
          title: '另存为 Markdown',
          extension: 'md',
          extensions: ['md', 'markdown'],
          filterName: 'Markdown 文档'
        });
        if (!path) return false;
        const content = typeof contentFactory === 'function' ? await contentFactory() : String(contentFactory ?? '');
        await exportPlatformPort.call('files', 'writeText', path, content, { extension: 'md', reason: snapshotReason });
        return path;
      }
      const content = typeof contentFactory === 'function' ? await contentFactory() : String(contentFactory ?? '');
      exportMarkdownContent(content, normalizedName);
      return true;
    }

    function getFileNameFromPath(path) {
      return String(path || '').split(/[\\/]/).pop() || '';
    }

    function bindDocumentFilePath(doc, path) {
      if (!doc || typeof path !== 'string' || !path) return;
      const fileName = getFileNameFromPath(path);
      const result = exportDocumentControllerPort.bindDocumentFilePath(doc.id, path, {
        title: fileName || '',
        fallbackTitle: t('filenameDefault')
      });
      if (!result.bound) return;
      if (result.active && fileName) filenameInput.value = result.record.title;
      renderDocumentList();
    }

    async function saveCurrentFile() {
      const generation = exportDocumentControllerPort.generation;
      try {
        setSaveStatus('saving', '正在保存文件…');
        const saveResult = await saveCurrentDocumentState(true, { waitForNative: true, forceSnapshot: true });
        if (saveResult?.stale || !exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
        const doc = exportDocumentControllerPort.getActiveRecord();
        if (!doc) throw new Error('当前没有可保存的文档');
        const content = documentModel?.createSnapshot?.('save-current-file') ?? editor.value;

        if (exportPlatformPort?.supports('desktop.fileSystem') && doc.filePath) {
          if (!exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
          await exportPlatformPort.call('files', 'writeText', doc.filePath, content, {
            extension: doc.title?.split('.').pop() || 'md',
            reason: 'save-current-file'
          });
        } else {
          const savedPath = await saveMarkdownWithPicker(
            content,
            doc.title || filenameInput.value || t('filenameDefault'),
            'save-current-file'
          );
          if (!savedPath) {
            if (exportDocumentControllerPort.isCurrentGeneration(generation)) setSaveStatus('saved');
            return false;
          }
          if (!exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
          if (typeof savedPath === 'string') bindDocumentFilePath(doc, savedPath);
        }

        if (!exportDocumentControllerPort.isCurrentGeneration(generation)) return false;
        setSaveStatus('saved');
        showToast('文件已保存');
        return true;
      } catch (error) {
        if (exportDocumentControllerPort.isStaleError(error)) return false;
        setSaveStatus('error', '保存失败：' + (error?.message || String(error)));
        showToast('保存失败：' + (error?.message || String(error)));
        window.markdownEditorPerf?.record?.('document.file-save-error', {
          category: 'document.error',
          status: 'error',
          details: { message: error?.message || String(error) }
        });
        return false;
      }
    }

    async function saveAsMarkdown() {
      try {
        const currentName = filenameInput.value.trim() || t('filenameDefault');
        const savedPath = await saveMarkdownWithPicker(
          () => documentModel?.createSnapshot?.('save-as-markdown') ?? editor.value,
          currentName,
          'save-as-markdown'
        );
        if (savedPath) {
          if (typeof savedPath === 'string') bindDocumentFilePath(exportDocumentControllerPort.getActiveRecord(), savedPath);
          showToast('已另存为 Markdown');
        }
      } catch (error) {
        showToast('另存为失败：' + (error?.message || String(error)));
        window.markdownEditorPerf?.record?.('document.save-as-error', {
          category: 'document.error',
          status: 'error',
          details: { message: error?.message || String(error) }
        });
      }
    }

    // 导出文件
    async function exportFile() {
      try {
        const content = documentModel?.createSnapshot?.('export-markdown') ?? editor.value;
        const name = filenameInput.value.trim() || '未命名文档.md';
        const savedPath = await exportTextContent(content, name, getExportSaveOptions(
          '导出 Markdown',
          'md',
          'Markdown 文档',
          ['md', 'markdown']
        ));
        if (savedPath === null) return;
        if (savedPath === false) exportMarkdownContent(content, name);
        showToast(t('toastExported'));
      } catch (error) {
        showToast('导出失败：' + (error?.message || String(error)));
      }
    }

    // 导出 Word：将 Markdown 渲染为 HTML 并伪装成 .doc 下载
    async function exportWord() {
      const task = beginExportTask('正在导出 Word');
      if (!task) return;
      try {
        let name = filenameInput.value.trim();
      if (!name) name = '未命名文档.md';
      name = name.replace(/\.md$/i, '').replace(/\.markdown$/i, '') + '.doc';

        const bodyHtml = (await createFullPreviewBodyForExport(task)).innerHTML;
        task.throwIfCancelled();
        task.update(92, '正在生成 Word 文件…');

        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(name.replace(/\.doc$/i, ''))}</title>
  <style>
    body { font-family: "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif; font-size: 12pt; line-height: 1.6; color: #000; }
    h1 { font-size: 20pt; font-weight: bold; margin: 18pt 0 10pt; }
    h2 { font-size: 16pt; font-weight: bold; margin: 14pt 0 8pt; }
    h3 { font-size: 14pt; font-weight: bold; margin: 12pt 0 6pt; }
    h4, h5, h6 { font-size: 12pt; font-weight: bold; margin: 10pt 0 6pt; }
    p { margin: 6pt 0; }
    pre, code { font-family: Consolas, "Courier New", monospace; }
    pre { background: #f5f5f5; padding: 8pt; border-radius: 4px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 1pt 3pt; border-radius: 2px; }
    blockquote { border-left: 3px solid #ccc; margin: 6pt 0; padding: 4pt 10pt; color: #555; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    th, td { border: 1px solid #ccc; padding: 5pt 8pt; }
    th { background: #f5f5f5; font-weight: bold; }
    ul, ol { margin: 6pt 0; padding-left: 24pt; }
    li { margin: 3pt 0; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #ccc; margin: 12pt 0; }
    a { color: #0563c1; text-decoration: underline; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

      const savedPath = await exportTextContent(fullHtml, name, getExportSaveOptions(
        '导出 Word',
        'doc',
        'Word 文档',
        ['doc']
      ));
      if (savedPath === null) return;
      if (savedPath === false) {
        const blob = new Blob([fullHtml], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
        task.update(100, 'Word 文件已生成');
        showToast(t('toastWordExported'));
      } catch (error) {
        if (!(error instanceof ExportCancelledError)) {
          console.error('Word export failed:', error);
          showToast(error?.message || String(error));
        }
      } finally {
        finishExportTask(task);
      }
    }

    // 导出 HTML：将 Markdown 渲染为独立 HTML 页面并下载
    async function exportHTML() {
      const task = beginExportTask('正在导出 HTML');
      if (!task) return;
      try {
        let name = filenameInput.value.trim();
      if (!name) name = '未命名文档.md';
      name = name.replace(/\.md$/i, '').replace(/\.markdown$/i, '') + '.html';

        const bodyHtml = (await createFullPreviewBodyForExport(task)).innerHTML;
        task.throwIfCancelled();
        task.update(92, '正在生成 HTML 文件…');

        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.html$/i, ''))}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.7; max-width: 820px; margin: 40px auto; padding: 0 20px; color: #212529; background: #fff; }
    h1, h2, h3, h4, h5, h6 { margin: 24px 0 12px; font-weight: 600; line-height: 1.25; color: #212529; }
    h1 { font-size: 2em; border-bottom: 1px solid #dee2e6; padding-bottom: 8px; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #dee2e6; padding-bottom: 6px; }
    h3 { font-size: 1.25em; }
    p { margin: 0 0 14px; }
    a { color: #0d6efd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul, ol { margin: 0 0 14px; padding-left: 2em; }
    li { margin: 4px 0; }
    li.task-item { list-style: none; margin-left: -1.4em; }
    ul.task-list { padding-left: 1.8em; }
    code { background: #f1f3f5; padding: 2px 6px; border-radius: 4px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
    pre { background: #f1f3f5; padding: 14px; border-radius: 8px; overflow-x: auto; margin: 0 0 14px; }
    pre code { background: transparent; padding: 0; font-size: 0.9em; }
    blockquote { margin: 0 0 14px; padding: 8px 16px; border-left: 4px solid #8a93a1; background: #f1f3f5; color: #6c757d; font-size: 0.95em; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
    th, td { border: 1px solid #dee2e6; padding: 8px 12px; text-align: left; }
    th { background: #f1f3f5; font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    hr { border: none; border-top: 1px solid #dee2e6; margin: 20px 0; }
    .katex { font-size: 1.1em; }
    .katex-display { margin: 16px 0; padding: .45em 2px; overflow: visible; }
  </style>
</head>
<body>
${bodyHtml}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js">${'</scr' + 'ipt>'}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js">${'</scr' + 'ipt>'}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }
  });
${'</scr' + 'ipt>'}
</body>
</html>`;

      const savedPath = await exportTextContent(fullHtml, name, getExportSaveOptions(
        '导出 HTML',
        'html',
        'HTML 文档',
        ['html', 'htm']
      ));
      if (savedPath === null) return;
      if (savedPath === false) {
        const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
        task.update(100, 'HTML 文件已生成');
        showToast(t('toastHtmlExported'));
      } catch (error) {
        if (!(error instanceof ExportCancelledError)) {
          console.error('HTML export failed:', error);
          showToast(error?.message || String(error));
        }
      } finally {
        finishExportTask(task);
      }
    }

    async function exportPDF() {
      const task = beginExportTask('正在准备 PDF');
      if (!task) return;
      const wasSource = previewMode === 'source';
      if (wasSource) setPreviewMode('preview');
      const restorePreview = () => {
        resetPreviewPipeline();
        if (wasSource) setPreviewMode('source');
      };
      let replacedPreview = false;
      try {
        virtualPreviewController?.deactivate();
        const fullBody = await createFullPreviewBodyForExport(task);
        task.throwIfCancelled();
        preview.replaceChildren(fullBody);
        replacedPreview = true;
        observedPreviewBody = null;
        invalidatePreviewAnchorStructure();
        await enhanceFullPreviewForExport(fullBody, task);
        task.throwIfCancelled();
        task.update(100, 'PDF 内容已准备完成');
        finishExportTask(task);
        showToast(t('toastChoosePdf'));
        let restored = false;
        const restoreOnce = () => {
          if (restored) return;
          restored = true;
          restorePreview();
        };
        window.addEventListener('afterprint', restoreOnce, { once: true });
        setTimeout(() => {
          window.print();
          setTimeout(restoreOnce, 1200);
        }, 80);
      } catch (error) {
        if (!(error instanceof ExportCancelledError)) {
          console.error('PDF export failed:', error);
          showToast(error?.message || String(error));
        }
        if (replacedPreview || error instanceof ExportCancelledError) restorePreview();
        finishExportTask(task);
      }
    }


    function toggleExportMenu() {
      document.getElementById('export-menu').classList.toggle('show');
    }

    function closeExportMenu() {
      document.getElementById('export-menu').classList.remove('show');
    }

    function toggleImportMenu() {
      document.getElementById('import-menu').classList.toggle('show');
    }

    function closeImportMenu() {
      document.getElementById('import-menu').classList.remove('show');
    }

    // 导出图片
    let currentImageRatio = '9:16';
    let currentImageDataUrl = '';

    const RATIO_PRESETS = {
      '9:16':  { width: 1080, height: 1920 },
      '4:5':   { width: 1080, height: 1350 },
      '3:4':   { width: 1080, height: 1440 },
      '1:1':   { width: 1080, height: 1080 },
      '16:9':  { width: 1920, height: 1080 }
    };

    const IMAGE_PLACEHOLDER = 'data:image/svg+xml;base64,' + btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
      '<rect width="120" height="80" fill="#e9ecef"/>' +
      '<text x="60" y="44" text-anchor="middle" font-size="12" fill="#6c757d">Image unavailable</text>' +
      '</svg>'
    );

    function openExportImageModal() {
      if (previewMode !== 'preview') {
        setPreviewMode('preview');
      }
      document.getElementById('image-crop-fit').checked = false;
      selectImageRatio(currentImageRatio);
      const modal = document.getElementById('export-image-modal');
      const request = {
        options: { initialFocus: document.querySelector('#export-image-modal .ratio-btn.active') }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
    }

    function closeExportImageModal() {
      const modal = document.getElementById('export-image-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function selectImageRatio(ratio) {
      currentImageRatio = ratio;
      document.querySelectorAll('.ratio-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === ratio);
      });
      renderExportImagePreview();
    }

    async function prepareExportImages(root, task = null) {
      const imgs = Array.from(root.querySelectorAll('img'));
      for (let index = 0; index < imgs.length; index += 1) {
        task?.throwIfCancelled();
        const img = imgs[index];
        if (img.src && !img.src.startsWith('data:')) {
          await new Promise(resolve => {
            const test = new Image();
            test.crossOrigin = 'anonymous';
            test.onload = () => {
              img.crossOrigin = 'anonymous';
              img.src = test.src;
              resolve();
            };
            test.onerror = () => {
              img.src = IMAGE_PLACEHOLDER;
              resolve();
            };
            const sep = img.src.includes('?') ? '&' : '?';
            test.src = img.src + sep + '_cors=' + Date.now();
          });
        }
        task?.update(90 + Math.round(((index + 1) / Math.max(1, imgs.length)) * 5), `正在准备图片 ${index + 1}/${imgs.length}`);
        if ((index + 1) % 8 === 0) await waitForExportFrame();
      }
    }


    async function renderExportImagePreview() {
      const task = beginExportTask('正在生成图片预览');
      if (!task) return;
      let clone = null;
      try {
        if (typeof domtoimage === 'undefined') {
          task.update(5, '正在加载图片导出模块…');
          try {
            await window.markdownEditorVendors?.loadDomToImage?.();
          } catch (error) {
            console.error('Image export library load error:', error);
          }
        }
        if (typeof domtoimage === 'undefined') {
          showToast(t('toastImageLibMissing'));
          return;
        }

        const preset = RATIO_PRESETS[currentImageRatio];
        const stage = document.getElementById('export-image-stage');
        const container = document.getElementById('export-image-content');

        container.innerHTML = '';
        clone = document.createElement('div');
        clone.className = 'preview-content';
        clone.replaceChildren(await createFullPreviewBodyForExport(task));
        clone.style.width = preset.width + 'px';
        clone.style.padding = Math.round(preset.width * 0.04) + 'px ' + Math.round(preset.width * 0.045) + 'px';
        clone.style.fontSize = Math.round(preset.width / 36) + 'px';
        clone.style.lineHeight = '1.7';
        clone.style.boxSizing = 'border-box';
        clone.style.background = 'var(--color-surface-raised)';
        clone.style.color = 'var(--color-text-primary)';
        clone.style.overflow = 'visible';
        clone.style.maxWidth = 'none';
        clone.style.margin = '0';
        container.appendChild(clone);

        const markdownBody = clone.querySelector('.markdown-body');
        if (markdownBody) {
          markdownBody.style.maxWidth = 'none';
          markdownBody.style.width = '100%';
          markdownBody.style.margin = '0';
        }

        stage.style.width = preset.width + 'px';
        stage.style.height = 'auto';

        await enhanceFullPreviewForExport(clone, task);
        await prepareExportImages(clone, task);
        task.throwIfCancelled();

        const cropFit = document.getElementById('image-crop-fit').checked;
        const targetHeight = preset.height;
        const naturalHeight = clone.scrollHeight;

        let captureHeight;
        if (naturalHeight < targetHeight) {
          clone.style.minHeight = targetHeight + 'px';
          clone.style.height = targetHeight + 'px';
          captureHeight = targetHeight;
        } else if (cropFit) {
          clone.style.height = targetHeight + 'px';
          clone.style.overflow = 'hidden';
          captureHeight = targetHeight;
        } else {
          clone.style.height = 'auto';
          clone.style.overflow = 'visible';
          captureHeight = naturalHeight;
        }

        stage.style.height = captureHeight + 'px';
        task.update(96, '正在生成 PNG，此阶段完成前不能立即取消…');
        task.setCancelable(false);
        const dataUrl = await domtoimage.toPng(clone, {
          width: preset.width,
          height: captureHeight,
          bgcolor: getComputedStyle(clone).backgroundColor || '#ffffff',
          cacheBust: true,
          imagePlaceholder: IMAGE_PLACEHOLDER
        });
        task.update(100, '图片预览已生成');
        currentImageDataUrl = dataUrl;
        const previewImg = document.getElementById('export-image-preview');
        previewImg.src = dataUrl;
        previewImg.classList.remove('is-hidden');
        showToast(t('toastPreviewGenerated'));
      } catch (error) {
        if (!(error instanceof ExportCancelledError)) {
          console.error(error);
          showToast(t('toastImageGenFailed', error?.message || String(error)));
        }
      } finally {
        if (clone) {
          clone.style.height = '';
          clone.style.minHeight = '';
          clone.style.overflow = '';
        }
        finishExportTask(task);
      }
    }


    async function downloadExportImage() {
      if (!currentImageDataUrl) {
        showToast(t('toastGeneratePreviewFirst'));
        return;
      }
      let name = filenameInput.value.trim();
      if (!name) name = '未命名文档.md';
      name = name.replace(/\.(md|markdown|txt|html|doc)$/i, '') + '.png';

      try {
        if (exportPlatformPort?.supports('desktop.dialogs') && exportPlatformPort?.supports('desktop.fileSystem')) {
          const path = await exportPlatformPort.call('dialogs', 'saveFile', name, getExportSaveOptions(
            '导出图片',
            'png',
            'PNG 图片',
            ['png']
          ));
          if (!path) return;
          await exportPlatformPort.call('files', 'writeBinary', path, dataUrlToBytes(currentImageDataUrl), { extension: 'png' });
        } else {
          const a = document.createElement('a');
          a.href = currentImageDataUrl;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        showToast(t('toastImageDownloaded'));
      } catch (error) {
        showToast('图片导出失败：' + (error?.message || String(error)));
      }
    }

    function getEditorNormalizedLength(text) {
      const source = String(text ?? '');
      let crlfPairs = 0;
      for (let index = 0; index < source.length - 1; index += 1) {
        if (source.charCodeAt(index) === 13 && source.charCodeAt(index + 1) === 10) {
          crlfPairs += 1;
          index += 1;
        }
      }
      return source.length - crlfPairs;
    }

    async function loadDocumentFromContentLoader(name, loadContent, filePath = '', details = {}) {
      const normalizedName = name || t('filenameDefault');
      try {
        clearTimeout(saveTimer);
        const result = await exportDocumentControllerPort.openExternalDocument({
          title: normalizedName,
          filePath,
          currentTitle: filenameInput.value,
          fallbackTitle: t('filenameDefault'),
          loadContent,
          expectedTextLength: getEditorNormalizedLength
        });
        if (!exportDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
        filenameInput.value = result.record.title;
        if (!await applyDocumentLifecycleUi(result)) return false;
        if (!exportDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
        showSaveHint();
        if (!exportDocumentControllerPort.isCurrentGeneration(result.generation)) return false;
        setSidebarTab('docs');
        window.markdownEditorPerf?.record?.('document.imported', {
          category: 'document.operation',
          status: 'ok',
          details: {
            documentId: result.record.id,
            sourceCharacters: result.sourceCharacters,
            editorCharacters: result.editorCharacters,
            normalizedCrLf: result.sourceCharacters - result.editorCharacters,
            ...details
          }
        });
        showToast(t('toastFileImported'));
        return true;
      } catch (error) {
        if (exportDocumentControllerPort.isStaleError(error)) return false;
        showToast(recordDocumentOperationError('import', error, {
          fileName: String(name || ''),
          ...details
        }));
        return false;
      }
    }

    async function loadTextContentAsDocument(name, content, filePath = '') {
      const source = String(content ?? '');
      return loadDocumentFromContentLoader(name, async () => source, filePath, { sourceCharacters: source.length });
    }

    function loadFile(file) {
      if (!file) return Promise.resolve(false);
      return loadDocumentFromContentLoader(file.name, () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target?.result ?? '');
        reader.onerror = () => reject(reader.error || new Error('无法读取所选文档'));
        reader.onabort = () => reject(new Error('文档读取已取消'));
        reader.readAsText(file);
      }), '', { fileBytes: Number(file.size) || 0 });
    }

    // 导入文件
    function importFile(input) {
      const file = input.files[0];
      if (file) loadFile(file);
      input.value = '';
    }

    // 切换主题
