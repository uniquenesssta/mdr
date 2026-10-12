    const exportCompatibilityHost = document.getElementById('compatibility-business-ports');
    const exportPreviewCommandPort = exportCompatibilityHost?.markdownEditorPreviewCommandPort;
    const exportRequestPort = exportCompatibilityHost?.markdownEditorExportRequestPort;
    const exportTaskPort = exportCompatibilityHost?.markdownEditorExportTaskPort;
    const exportImagePort = exportCompatibilityHost?.markdownEditorImageExportPort;
    const exportPdfPort = exportCompatibilityHost?.markdownEditorPdfExportPort;
    const exportWordPort = exportCompatibilityHost?.markdownEditorWordExportPort;
    const exportHtmlPort = exportCompatibilityHost?.markdownEditorHtmlExportPort;
    const exportMarkdownPort = exportCompatibilityHost?.markdownEditorMarkdownExportPort;
    if (!exportPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');
    if (!exportRequestPort) throw new Error('Export request compatibility port is unavailable.');
    if (!exportTaskPort) throw new Error('Export task compatibility port is unavailable.');
    if (!exportImagePort) throw new Error('Image exporter compatibility port is unavailable.');
    if (!exportPdfPort) throw new Error('PDF export compatibility port is unavailable.');
    if (!exportWordPort) throw new Error('Word export compatibility port is unavailable.');
    if (!exportHtmlPort) throw new Error('HTML export compatibility port is unavailable.');
    if (!exportMarkdownPort) throw new Error('Markdown export compatibility port is unavailable.');

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

    // 导出文件
    async function exportFile() {
      const request = readExportRequest('markdown');
      if (!request) return;
      try {
        const result = await exportMarkdownPort.export({ request });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (['written', 'downloaded'].includes(result.status)) showToast(t('toastExported'));
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) showToast('导出失败：' + (error?.message || String(error)));
      }
    }

    // Word 命令只提交不可变请求；正文、资源、任务和输出由公共 owner 管理。
    async function exportWord() {
      const request = readExportRequest('word');
      if (!request) return;
      try {
        const result = await exportWordPort.export({ request });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (['written', 'downloaded'].includes(result.status)) showToast(t('toastWordExported'));
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) {
          console.error('Word export failed:', error);
          showToast(error?.message || String(error));
        }
      }
    }

    // 导出 HTML：将 Markdown 渲染为独立 HTML 页面并下载
    async function exportHTML() {
      const request = readExportRequest('html');
      if (!request) return;
      try {
        const result = await exportHtmlPort.export({ request });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (['written', 'downloaded'].includes(result.status)) showToast(t('toastHtmlExported'));
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) {
          console.error('HTML export failed:', error);
          showToast(error?.message || String(error));
        }
      }
    }

    async function exportPDF() {
      const request = readExportRequest('pdf');
      if (!request) return;
      try {
        const result = await exportPdfPort.export({ request });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) {
          console.error('PDF export failed:', error);
          showToast(error?.message || String(error));
        }
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

    async function renderExportImagePreview() {
      const request = readExportRequest('image');
      if (!request) return;
      try {
        const result = await exportImagePort.render({ request });
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (result.status === 'ready') showToast(t('toastPreviewGenerated'));
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) {
          console.error(error);
          showToast(t('toastImageGenFailed', error?.message || String(error)));
        }
      }
    }

    async function downloadExportImage() {
      const request = readExportRequest('image');
      if (!request) return;
      try {
        const result = await exportImagePort.save({ request });
        if (result.status === 'no-preview') showToast(t('toastGeneratePreviewFirst'));
        if (result.status === 'busy') showToast('当前导出正在生成文件，请稍候');
        if (['written', 'downloaded'].includes(result.status)) showToast(t('toastImageDownloaded'));
      } catch (error) {
        if (!exportTaskPort.isCancelled(error)) showToast('图片导出失败：' + (error?.message || String(error)));
      }
    }

    // 切换主题
