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
    const exportDocumentPort = exportCompatibilityHost?.markdownEditorExportDocumentPort;
    const exportEnhancementPort = exportCompatibilityHost?.markdownEditorExportEnhancementPort;
    const exportStylePort = exportCompatibilityHost?.markdownEditorExportStylePort;
    if (!exportDocumentDomainPort) throw new Error('Document domain compatibility port is unavailable.');
    if (!exportDocumentSessionPort) throw new Error('Document session compatibility port is unavailable.');
    if (!exportDocumentControllerPort) throw new Error('Document controller compatibility port is unavailable.');
    if (!exportDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
    if (!exportSidebarControllerPort) throw new Error('Sidebar controller compatibility port is unavailable.');
    if (!exportPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');
    if (!exportPresentationPort) throw new Error('Presentation compatibility port is unavailable.');
    if (!exportRequestPort) throw new Error('Export request compatibility port is unavailable.');
    if (!exportTaskPort) throw new Error('Export task compatibility port is unavailable.');
    if (!exportDocumentPort) throw new Error('Export document compatibility port is unavailable.');
    if (!exportEnhancementPort) throw new Error('Export enhancement compatibility port is unavailable.');
    if (!exportStylePort) throw new Error('Export style compatibility port is unavailable.');

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
    function waitForExportFrame(task = null) {
      const frame = new Promise(resolve => requestAnimationFrame(() => resolve()));
      return task ? task.token.waitFor(frame) : frame;
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
        task?.token.throwIfCancelled();
        const selection = exportPlatformPort.call('dialogs', 'saveFile', preferredName, options);
        const path = await (task ? task.token.waitFor(selection) : selection);
        task?.token.throwIfCancelled();
        if (!path) return null;
        task?.lockCancellation('writing');
        task?.token.throwIfCancelled();
        const writing = exportPlatformPort.call('files', 'writeText', path, content, { extension: options.extension, reason: 'export' });
        await (task ? task.token.waitFor(writing) : writing);
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

        const body = await exportDocumentPort.build({ task, documentId: request.documentId });
        await exportEnhancementPort.enhance({ root: body, task, documentId: request.documentId });
        const bodyHtml = body.innerHTML;
        task.token.throwIfCancelled();
        task.update(92, '正在生成 Word 文件…', 'serializing');

        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeExportTitle(name.replace(/\.doc$/i, ''))}</title>
  <style>${exportStylePort.getCss('word')}</style>
</head>
<body class="export-document" data-export-format="word">
${bodyHtml}
</body>
</html>`;

      const savedPath = await exportTextContent(fullHtml, name, getExportSaveOptions(
        '导出 Word',
        request,
        'Word 文档'
      ), task);
      task.token.throwIfCancelled();
      if (savedPath === null) return;
      if (savedPath === false) {
        task.lockCancellation('writing');
        task.token.throwIfCancelled();
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

    // Export 自有文本转义；不依赖已退役的 Preview 全局绑定。
    function escapeExportTitle(value) {
      return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
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

        const body = await exportDocumentPort.build({ task, documentId: request.documentId });
        await exportEnhancementPort.enhance({ root: body, task, documentId: request.documentId });
        const bodyHtml = body.innerHTML;
        task.token.throwIfCancelled();
        task.update(92, '正在生成 HTML 文件…', 'serializing');

        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeExportTitle(name.replace(/\.html$/i, ''))}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>${exportStylePort.getCss('html')}</style>
</head>
<body class="export-document" data-export-format="html">
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
      task.token.throwIfCancelled();
      if (savedPath === null) return;
      if (savedPath === false) {
        task.lockCancellation('writing');
        task.token.throwIfCancelled();
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
      let printStyleLease = null;
      const restorePreview = () => {
        printStyleLease?.release();
        printStyleLease = null;
        exportPreviewCommandPort.reset();
        if (wasSource) exportPreviewCommandPort.setViewMode('source');
      };
      let replacedPreview = false;
      try {
        wasSource = exportPreviewCommandPort.getViewMode() === 'source';
        if (wasSource) exportPreviewCommandPort.setViewMode('preview');
        exportPreviewCommandPort.deactivateVirtual();
        const fullBody = await exportDocumentPort.build({ task, documentId: request.documentId });
        task.token.throwIfCancelled();
        await exportEnhancementPort.enhance({ root: fullBody, task, documentId: request.documentId });
        task.token.throwIfCancelled();
        printStyleLease = exportStylePort.apply(fullBody, 'pdf');
        preview.replaceChildren(fullBody);
        replacedPreview = true;
        task.token.throwIfCancelled();
        task.lockCancellation('printing');
        task.token.throwIfCancelled();
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
          printStyleLease?.release();
          printStyleLease = null;
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
        task?.token.throwIfCancelled();
        const img = imgs[index];
        if (img.src && !img.src.startsWith('data:')) {
          let loader;
          const loading = new Promise(resolve => {
            loader = new Image();
            loader.crossOrigin = 'anonymous';
            loader.onload = () => {
              if (!task?.token.cancelled) { img.crossOrigin = 'anonymous'; img.src = loader.src; }
              resolve();
            };
            loader.onerror = () => {
              if (!task?.token.cancelled) img.src = IMAGE_PLACEHOLDER;
              resolve();
            };
            const sep = img.src.includes('?') ? '&' : '?';
            loader.src = img.src + sep + '_cors=' + Date.now();
          });
          try {
            await (task ? task.token.waitFor(loading) : loading);
            task?.token.throwIfCancelled();
          } finally {
            if (loader) { loader.onload = null; loader.onerror = null; }
          }
        }
        task?.update(90 + Math.round(((index + 1) / Math.max(1, imgs.length)) * 5), `正在准备图片 ${index + 1}/${imgs.length}`, 'images');
        if ((index + 1) % 8 === 0) await waitForExportFrame(task);
      }
    }


    async function renderExportImagePreview() {
      const request = readExportRequest('image');
      if (!request) return;
      const task = beginExportTask('正在生成图片预览');
      if (!task) return;
      let outcome = 'completed';
      let clone = null;
      let imageStyleLease = null;
      try {
        let domToImageApi = null;
        if (!domToImageApi) {
          task.update(5, '正在加载图片导出模块…', 'loading');
          try {
            domToImageApi = await task.token.waitFor(exportPresentationPort.loadDomToImage());
          } catch (error) {
            if (exportTaskPort.isCancelled(error)) throw error;
            console.error('Image export library load error:', error);
          }
        }
        task.token.throwIfCancelled();
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
        const fullBody = await exportDocumentPort.build({ task, documentId: request.documentId });
        task.token.throwIfCancelled();
        clone.replaceChildren(fullBody);
        clone.style.width = preset.width + 'px';
        clone.style.padding = Math.round(preset.width * 0.04) + 'px ' + Math.round(preset.width * 0.045) + 'px';
        clone.style.fontSize = Math.round(preset.width / 36) + 'px';
        imageStyleLease = exportStylePort.apply(clone, 'image');
        container.appendChild(clone);

        stage.style.width = preset.width + 'px';
        stage.style.height = 'auto';

        await exportEnhancementPort.enhance({ root: fullBody, task, documentId: request.documentId });
        await prepareExportImages(clone, task);
        task.token.throwIfCancelled();

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
        task.lockCancellation('encoding');
        task.token.throwIfCancelled();
        const dataUrl = await task.token.waitFor(domToImageApi.toPng(clone, {
          width: preset.width,
          height: captureHeight,
          bgcolor: getComputedStyle(clone).backgroundColor || '#ffffff',
          cacheBust: true,
          imagePlaceholder: IMAGE_PLACEHOLDER
        }));
        task.token.throwIfCancelled();
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
        imageStyleLease?.release();
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
