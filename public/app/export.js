    const exportCompatibilityHost = document.getElementById('compatibility-business-ports');
    const exportPlatformPort = exportCompatibilityHost?.markdownEditorPlatformPort;
    const exportDocumentDomainPort = exportCompatibilityHost?.markdownEditorDocumentDomainPort;
    const exportDocumentSessionPort = exportCompatibilityHost?.markdownEditorDocumentSessionPort;
    const exportDocumentControllerPort = exportCompatibilityHost?.markdownEditorDocumentControllerPort;
    const exportDocumentUiCommandPort = exportCompatibilityHost?.markdownEditorDocumentUiCommandPort;
    const exportSidebarControllerPort = exportCompatibilityHost?.markdownEditorSidebarControllerPort;
    const exportPreviewCommandPort = exportCompatibilityHost?.markdownEditorPreviewCommandPort;
    const exportPresentationPort = exportCompatibilityHost?.markdownEditorPresentationPort;
    const exportRequestPort = exportCompatibilityHost?.markdownEditorExportRequestPort;
    const exportTaskPort = exportCompatibilityHost?.markdownEditorExportTaskPort;
    if (!exportDocumentDomainPort) throw new Error('Document domain compatibility port is unavailable.');
    if (!exportDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
    if (!exportDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
    if (!exportDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
    if (!exportSidebarControllerPort) throw new Error('Sidebar controller compatibility port is unavailable.');
    if (!exportPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');
    if (!exportPresentationPort) throw new Error('Presentation compatibility port is unavailable.');
    if (!exportRequestPort) throw new Error('Export request compatibility port is unavailable.');
    if (!exportTaskPort) throw new Error('Export task compatibility port is unavailable.');

    function readExportRequest(format) {
      try {
        return exportRequestPort.createRequest({
          format,
          name: filenameInput.value,
          directory: exportDirectory,
          ...(format === 'image' ? { imageOptions: { ratio: currentImageRatio, cropFit: document.getElementById('image-crop-fit').checked } } : {})
        });
      } catch (error) {
        showToast('导出参数无效：' + (error?.message || String(error)));
        return null;
      }
    }
    // UI projection only; task/progress/cancellation/phase authority is the public controller.
    // This classic DOM adapter is received by 14.5 and removed with callers in 14.18.
    let exportProgressModalOpened = false;
    exportTaskPort.subscribe(snapshot => {
      const task = snapshot.activeTask;
      const modal = document.getElementById('export-progress-modal');
      if (!task) {
        if (!exportProgressModalOpened) return;
        exportProgressModalOpened = false;
        const request = { reason: snapshot.destroyed ? 'export-destroyed' : 'export-finished' };
        modal?.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
        if (request.error) throw request.error;
        return;
      }
      const value = document.getElementById('export-progress-value');
      const status = document.getElementById('export-progress-status');
      const heading = document.getElementById('export-progress-title');
      const button = document.getElementById('export-progress-cancel');
      if (heading) heading.textContent = task.title;
      if (value) value.style.width = task.progress + '%';
      if (status) status.textContent = task.message;
      if (button) {
        button.disabled = !task.cancelable;
        button.textContent = task.cancelable ? '取消导出' : '正在生成文件…';
      }
      if (modal && !exportProgressModalOpened) {
        exportProgressModalOpened = true;
        const request = { options: { initialFocus: button } };
        modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
        if (request.error) throw request.error;
      }
    });

    function waitForExportFrame() {
      return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function beginExportTask(title) {
      try {
        const task = exportTaskPort.begin(title);
        if (!task) showToast('当前导出正在生成文件，请稍候');
        return task;
      } catch (error) {
        showToast('导出失败：' + (error?.message || String(error)));
        return null;
      }
    }

    function finishExportTask(task, outcome) {
      try { return exportTaskPort.finish(task, outcome); }
      catch (error) { showToast('导出清理失败：' + (error?.message || String(error))); return false; }
    }

    function cancelActiveExport() {
      exportTaskPort.cancel();
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
          task?.update(8 + Math.round((end / workerBlocks.length) * 52), `正在构建导出内容 ${end}/${workerBlocks.length} 块`, 'building');
          if (end < workerBlocks.length) await waitForExportFrame();
        }
        return body;
      }

      task?.update(12, '正在解析完整文档…', 'building');
      await waitForExportFrame();
      task?.throwIfCancelled();
      const source = documentModel?.createSnapshot?.('full-preview-export') ?? editor.value;
      try {
        if (Boolean(exportPresentationPort.markdown?.parse)) {
          const mathApi = exportPresentationPort.math;
          const protectedMath = typeof mathApi?.protectSource === 'function'
            ? mathApi.protectSource(source, 'EXPORT_MATH')
            : { text: source, placeholders: [] };
          const rendered = exportPresentationPort.markdown.parse(protectedMath.text);
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
      task?.update(60, '完整文档已解析', 'building');
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
        const mathRenderer = exportPresentationPort.math;
        if (mathRenderer?.renderTree || Boolean(exportPresentationPort.math?.renderTree)) {
          batch.forEach(node => {
            if (!(mathRenderer?.containsMath?.(node.textContent) ?? node.textContent?.includes('$'))) return;
            if (mathRenderer?.renderTree) {
              mathRenderer.renderTree(node, { delimiters: mathRenderer.delimiters });
              return;
            }
            exportPresentationPort.math.renderTree(node, {
              delimiters: exportPresentationPort.math.delimiters,
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
        task?.update(62 + Math.round((end / children.length) * 28), `正在增强导出内容 ${end}/${children.length}`, 'enhancing');
        if (end < children.length) await waitForExportFrame();
      }
    }


    function getExportSaveOptions(title, request, filterName) {
      return {
        title,
        extension: request.extension,
        extensions: request.extensions,
        filterName,
        defaultDirectory: request.directory
      };
    }

    async function exportTextContent(content, preferredName, options, task = null) {
      if (exportPlatformPort?.supports('desktop.dialogs') && exportPlatformPort?.supports('desktop.fileSystem')) {
        const path = await exportPlatformPort.call('dialogs', 'saveFile', preferredName, options);
        task?.throwIfCancelled();
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

    // 导出文件
    async function exportFile() {
      const request = readExportRequest('markdown');
      if (!request) return;
      try {
        const content = documentModel?.createSnapshot?.('export-markdown') ?? editor.value;
        const name = request.name;
        const savedPath = await exportTextContent(content, name, getExportSaveOptions(
          '导出 Markdown',
          request,
          'Markdown 文档'
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
      const request = readExportRequest('word');
      if (!request) return;
      const task = beginExportTask('正在导出 Word');
      if (!task) return;
      let outcome = 'completed';
      try {
        const name = request.name;

        const bodyHtml = (await createFullPreviewBodyForExport(task)).innerHTML;
        task.throwIfCancelled();
        task.update(92, '正在生成 Word 文件…', 'serializing');

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
        request,
        'Word 文档'
      ), task);
      task.throwIfCancelled();
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
        outcome = 'failed';
        if (!exportTaskPort.isCancelled(error)) {
          console.error('Word export failed:', error);
          showToast(error?.message || String(error));
        }
      } finally {
        finishExportTask(task, outcome);
      }
    }

    // 导出 HTML：将 Markdown 渲染为独立 HTML 页面并下载
    async function exportHTML() {
      const request = readExportRequest('html');
      if (!request) return;
      const task = beginExportTask('正在导出 HTML');
      if (!task) return;
      let outcome = 'completed';
      try {
        const name = request.name;

        const bodyHtml = (await createFullPreviewBodyForExport(task)).innerHTML;
        task.throwIfCancelled();
        task.update(92, '正在生成 HTML 文件…', 'serializing');

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
    if (Boolean(exportPresentationPort.math?.renderTree)) {
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
        request,
        'HTML 文档'
      ), task);
      task.throwIfCancelled();
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
        outcome = 'failed';
        if (!exportTaskPort.isCancelled(error)) {
          console.error('HTML export failed:', error);
          showToast(error?.message || String(error));
        }
      } finally {
        finishExportTask(task, outcome);
      }
    }

    async function exportPDF() {
      const request = readExportRequest('pdf');
      if (!request) return;
      const task = beginExportTask('正在准备 PDF');
      if (!task) return;
      let wasSource = false;
      const restorePreview = () => {
        exportPreviewCommandPort.reset();
        if (wasSource) exportPreviewCommandPort.setViewMode('source');
      };
      let replacedPreview = false;
      try {
        wasSource = exportPreviewCommandPort.getViewMode() === 'source';
        if (wasSource) exportPreviewCommandPort.setViewMode('preview');
        exportPreviewCommandPort.deactivateVirtual();
        const fullBody = await createFullPreviewBodyForExport(task);
        task.throwIfCancelled();
        preview.replaceChildren(fullBody);
        replacedPreview = true;
        observedPreviewBody = null;
        await enhanceFullPreviewForExport(fullBody, task);
        task.throwIfCancelled();
        task.update(100, 'PDF 内容已准备完成', 'printing');
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
        if (!exportTaskPort.isCancelled(error)) {
          console.error('PDF export failed:', error);
          showToast(error?.message || String(error));
        }
        try {
          if (task.current && (replacedPreview || exportTaskPort.isCancelled(error))) restorePreview();
        } finally { finishExportTask(task, 'failed'); }
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

    const IMAGE_PLACEHOLDER = 'data:image/svg+xml;base64,' + btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
      '<rect width="120" height="80" fill="#e9ecef"/>' +
      '<text x="60" y="44" text-anchor="middle" font-size="12" fill="#6c757d">Image unavailable</text>' +
      '</svg>'
    );

    function openExportImageModal() {
      if (exportPreviewCommandPort.getViewMode() !== 'preview') {
        exportPreviewCommandPort.setViewMode('preview');
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
        task?.update(90 + Math.round(((index + 1) / Math.max(1, imgs.length)) * 5), `正在准备图片 ${index + 1}/${imgs.length}`, 'images');
        if ((index + 1) % 8 === 0) await waitForExportFrame();
      }
    }


    async function renderExportImagePreview() {
      const request = readExportRequest('image');
      if (!request) return;
      const task = beginExportTask('正在生成图片预览');
      if (!task) return;
      let outcome = 'completed';
      let clone = null;
      try {
        let domToImageApi = null;
        if (!domToImageApi) {
          task.update(5, '正在加载图片导出模块…', 'loading');
          try {
            domToImageApi = await exportPresentationPort.loadDomToImage();
          } catch (error) {
            console.error('Image export library load error:', error);
          }
        }
        task.throwIfCancelled();
        if (!domToImageApi) {
          outcome = 'failed';
          showToast(t('toastImageLibMissing'));
          return;
        }

        const preset = request.imageOptions;
        const stage = document.getElementById('export-image-stage');
        const container = document.getElementById('export-image-content');

        container.innerHTML = '';
        clone = document.createElement('div');
        clone.className = 'preview-content';
        const fullBody = await createFullPreviewBodyForExport(task);
        task.throwIfCancelled();
        clone.replaceChildren(fullBody);
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

        const cropFit = request.imageOptions.cropFit;
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
        task.update(96, '正在生成 PNG，此阶段完成前不能立即取消…', 'encoding');
        task.setCancelable(false);
        const dataUrl = await domToImageApi.toPng(clone, {
          width: preset.width,
          height: captureHeight,
          bgcolor: getComputedStyle(clone).backgroundColor || '#ffffff',
          cacheBust: true,
          imagePlaceholder: IMAGE_PLACEHOLDER
        });
        task.throwIfCancelled();
        task.update(100, '图片预览已生成');
        currentImageDataUrl = dataUrl;
        const previewImg = document.getElementById('export-image-preview');
        previewImg.src = dataUrl;
        previewImg.classList.remove('is-hidden');
        showToast(t('toastPreviewGenerated'));
      } catch (error) {
        outcome = 'failed';
        if (!exportTaskPort.isCancelled(error)) {
          console.error(error);
          showToast(t('toastImageGenFailed', error?.message || String(error)));
        }
      } finally {
        if (clone) {
          clone.style.height = '';
          clone.style.minHeight = '';
          clone.style.overflow = '';
        }
        finishExportTask(task, outcome);
      }
    }


    async function downloadExportImage() {
      const request = readExportRequest('image');
      if (!request) return;
      if (!currentImageDataUrl) {
        showToast(t('toastGeneratePreviewFirst'));
        return;
      }
      const name = request.name;

      try {
        if (exportPlatformPort?.supports('desktop.dialogs') && exportPlatformPort?.supports('desktop.fileSystem')) {
          const path = await exportPlatformPort.call('dialogs', 'saveFile', name, getExportSaveOptions(
            '导出图片',
            request,
            'PNG 图片'
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

    // 切换主题
