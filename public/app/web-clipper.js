    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');
    const webClipperPlatformPort = webClipperCompatibilityHost?.markdownEditorPlatformPort;
    const webClipperHtmlMarkdownPort = webClipperCompatibilityHost?.markdownEditorHtmlMarkdownPort;
    if (!webClipperHtmlMarkdownPort) throw new Error('HTML Markdown compatibility port is unavailable.');
    const webClipperHtmlExtractorPort = webClipperCompatibilityHost?.markdownEditorHtmlExtractorPort;
    if (!webClipperHtmlExtractorPort) throw new Error('HTML extractor compatibility port is unavailable.');
    const webClipperFetchPort = webClipperCompatibilityHost?.markdownEditorWebFetchPort;
    if (!webClipperFetchPort) throw new Error('Web Fetch compatibility port is unavailable.');
    const webClipperEditorUiCommandPort = webClipperCompatibilityHost?.markdownEditorEditorUiCommandPort;
    const webClipperDocumentUiCommandPort = webClipperCompatibilityHost?.markdownEditorDocumentUiCommandPort;
const webClipperPreviewCommandPort = webClipperCompatibilityHost?.markdownEditorPreviewCommandPort;
    if (!webClipperEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
    if (!webClipperDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
if (!webClipperPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');
    webClipperEditorUiCommandPort.register({
      getFindSearchOptions: setStatus => createFindSearchOptions(setStatus),
      afterFindMatch: match => afterFindMatch(match)
    });
    webClipperDocumentUiCommandPort.register({ openWebClipper: () => openUrlModal() });

    function setClipperHidden(element, hidden) {
      element?.classList.toggle('is-hidden', Boolean(hidden));
    }

    function setClipperStatusTone(element, tone = 'muted') {
      if (!element) return;
      element.classList.remove('is-muted', 'is-success', 'is-error');
      element.classList.add(tone === 'success' ? 'is-success' : tone === 'error' ? 'is-error' : 'is-muted');
    }

    webClipperFetchPort.watchInputs(['url-input', 'proxy-url', 'use-local-proxy', 'manual-html'].map(id => document.getElementById(id)), () => {
      fetchedHtml = '';
      document.getElementById('url-status').textContent = '';
      setClipperStatusTone(document.getElementById('url-status'), 'muted');
    });

    function openUrlModal() {
      webClipperFetchPort.cancel();
      document.getElementById('url-input').value = '';
      document.getElementById('url-status').textContent = '';
      setClipperStatusTone(document.getElementById('url-status'), 'muted');
      setClipperHidden(document.getElementById('manual-area'), true);
      document.getElementById('manual-html').value = '';
      document.getElementById('use-local-proxy').checked = Boolean(webClipperPlatformPort?.supports('desktop.webFetch'));
      setClipperHidden(document.getElementById('proxy-url'), true);
      toggleProxyInput();
      fetchedHtml = '';
      const modal = document.getElementById('url-modal');
      const request = {
        options: {
          initialFocus: document.getElementById('url-input'),
          onClose: () => { webClipperFetchPort.cancel(); fetchedHtml = ''; }
        }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
    }
    function closeUrlModal() {
      const modal = document.getElementById('url-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    // Atomic 5.12：Find/Replace 对话框已迁移，classic 只保留 native 搜索与预览同步桥。
    function createFindSearchOptions(setStatus = () => {}) {
      const currentDoc = getCurrentDocument?.();
      const nativeStore = window.markdownEditorDocumentStore;
      const documentLength = documentModel.getTextLength();
      const useNativeSearch = Boolean(
        currentDoc?.nativeBacked
        && nativeStore?.search
        && documentLength >= ULTRA_LARGE_DOCUMENT_CHARS
      );
      if (!useNativeSearch) return {};
      return {
        async nativeSearch({ query, from, wrap }) {
          setStatus('正在后台查找…');
          await saveCurrentDocumentState(false, { waitForNative: true });
          return nativeStore.search(currentDoc.id, query, from, wrap);
        },
        onNativeSearchError(error) {
          console.warn('Native document search fallback:', error);
        }
      };
    }

    function afterFindMatch(match) {
      if (!match) return false;
      if (webClipperPreviewCommandPort.snapshot.mode === 'chapter') {
        webClipperPreviewCommandPort.update().then(() => {
          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        });
      } else {
        requestAnimationFrame(() => {
          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        });
      }
      return true;
    }

    function toggleProxyInput() {
      const checked = document.getElementById('use-local-proxy').checked;
      const proxyInput = document.getElementById('proxy-url');
      if (!proxyInput) return;

      if (webClipperPlatformPort?.supports('desktop.webFetch')) {
        setClipperHidden(proxyInput, true);
        return;
      }

      setClipperHidden(proxyInput, !checked);
    }

    // UI only: source routing, cancellation and request generations belong to Import.
    async function fetchUrl() {
      const status = document.getElementById('url-status');
      const manualArea = document.getElementById('manual-area');
      fetchedHtml = '';
      status.textContent = t('urlStatusFetching');
      setClipperStatusTone(status, 'muted');
      const result = await webClipperFetchPort.fetchUrl(document.getElementById('url-input').value, {
        useLocalProxy: document.getElementById('use-local-proxy').checked,
        proxyUrl: document.getElementById('proxy-url').value
      });
      if (!webClipperFetchPort.isCurrent(result)) return;
      if (result.status === 'empty') {
        status.textContent = t('urlStatusEmptyUrl');
        setClipperStatusTone(status, 'error');
        return;
      }
      if (result.status === 'success') {
        fetchedHtml = result.html;
        status.textContent = t(result.source === 'public-proxy' ? 'urlStatusPublicSuccess' : 'urlStatusLocalSuccess');
        setClipperStatusTone(status, 'success');
        setClipperHidden(manualArea, true);
        return;
      }
      status.textContent = t(result.source === 'public-proxy' ? 'urlStatusPublicFailed' : 'urlStatusLocalFailed', result.error)
        + (result.hint ? '\n' + result.hint : '');
      setClipperStatusTone(status, 'error');
      setClipperHidden(manualArea, false);
    }

    // 转换并插入到编辑器
    function convertAndInsert() {
      const manualHtml = document.getElementById('manual-html').value.trim();
      const html = fetchedHtml || webClipperFetchPort.manualHtml(manualHtml).html;
      if (!html) {
        showToast(t('toastNoContent'));
        return;
      }
      try {
        const extracted = webClipperHtmlExtractorPort.extract(html);
        const markdown = webClipperHtmlMarkdownPort.convert(extracted);

        if (!markdown) {
          showToast(t('toastExtractFailed'));
          return;
        }
        const currentLength = documentModel.getTextLength();
        const isEmpty = documentModel.getNonWhitespaceCount() === 0;
        if (isEmpty) {
          documentModel.replaceRange(markdown, 0, currentLength, 'end');
        } else {
          documentModel.replaceRange('\n\n' + markdown, currentLength, currentLength, 'end');
        }
        webClipperPreviewCommandPort.update();
        webClipperPreviewCommandPort.updateCount();
        saveToLocal();
        closeUrlModal();
        showToast(t('toastInsertedMd'));
      } catch (err) {
        showToast(t('toastConvertFailed', err.message));
      }
    }

    // Toast 提示
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // 事件监听
