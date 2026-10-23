/**
 * Responsibility: Bridge native Find search and Preview selection with explicit document/save capabilities.
 * Imports: Explicit document, persistence and Preview capabilities plus lifetime scope.
 * Exports: createFindPreviewCommands.
 * State/side effects: Owns command registration and pending selection frames; document text remains in the model.
 * Lifecycle: Explicit start and idempotent destroy with cancellation of late results.
 */
import { createApplicationLifetime } from '../../../bootstrap/application-lifetime.js';
export function createFindPreviewCommands({ nativeStore, documentModel, getCurrentDocument, saveDocument, webClipperEditorUiCommandPort, webClipperPreviewCommandPort, requestAnimationFrame, cancelAnimationFrame, reportError = error => console.warn('Find preview update failed:', error) }) {
  const lifetime = createApplicationLifetime();
  const ULTRA_LARGE_DOCUMENT_CHARS = webClipperPreviewCommandPort.thresholds.mode.virtualChars;
    function createFindSearchOptions(setStatus = () => {}) {
      const currentDoc = getCurrentDocument?.();
      const documentLength = documentModel.getTextLength();
      const useNativeSearch = Boolean(
        currentDoc?.nativeBacked
        && nativeStore?.search
        && documentLength >= ULTRA_LARGE_DOCUMENT_CHARS
      );
      if (!useNativeSearch) return {};
      return {
        async nativeSearch({ query, from, wrap }) {
          const version = documentModel.getDocumentVersion();
          setStatus('正在后台查找…');
          await saveDocument();
          if (!lifetime.alive || getCurrentDocument()?.id !== currentDoc.id || documentModel.getDocumentVersion() !== version) throw new Error('Find document changed during save.');
          const result = await nativeStore.search(currentDoc.id, query, from, wrap);
          if (!lifetime.alive || getCurrentDocument()?.id !== currentDoc.id || documentModel.getDocumentVersion() !== version) throw new Error('Find document changed during search.');
          return result;
        },
        onNativeSearchError(error) {
          console.warn('Native document search fallback:', error);
        }
      };
    }

    function afterFindMatch(match) {
      if (!lifetime.alive || !match) return false;
      const id = getCurrentDocument()?.id, version = documentModel.getDocumentVersion();
      const current = () => lifetime.alive && getCurrentDocument()?.id === id && documentModel.getDocumentVersion() === version;
      if (webClipperPreviewCommandPort.snapshot.mode === 'chapter') {
        webClipperPreviewCommandPort.update().then(() => {
          if (current() && webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        }).catch(reportError);
      } else {
        const frame = requestAnimationFrame(() => {
          if (current() && webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        });
        lifetime.own(() => cancelAnimationFrame(frame));
      }
      return true;
    }


  try {
    lifetime.own(webClipperEditorUiCommandPort.register({ getFindSearchOptions: setStatus => createFindSearchOptions(setStatus), afterFindMatch }));
    return Object.freeze({ createFindSearchOptions, afterFindMatch, destroy: lifetime.destroy });
  } catch (error) { lifetime.destroy(); throw error; }
}
