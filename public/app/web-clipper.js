    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');
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
    function openUrlModal() { return webClipperDocumentUiCommandPort.invoke('openWebClipper'); }

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

    // Toast 提示
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // 事件监听
