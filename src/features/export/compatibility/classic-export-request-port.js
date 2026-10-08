import { createExportRequest, EXPORT_IMAGE_RATIOS, ExportRequestValidationError } from '../application/export-request.js';

const PORT_KEY = 'markdownEditorExportRequestPort';

/** Scoped migration boundary only; owns its mount, never export/document/task state. */
export function mountClassicExportRequestPort(host, { getActiveDocumentId, hasDocument } = {}) {
  if (!host || typeof host !== 'object') throw new TypeError('Export request host is required.');
  if (typeof getActiveDocumentId !== 'function' || typeof hasDocument !== 'function') throw new TypeError('Export request document readers are required.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Export request port is already mounted.');
  let destroyed = false;
  const port = Object.freeze({
    imageRatios: EXPORT_IMAGE_RATIOS,
    createRequest(input) {
      if (destroyed) throw new Error('Export request port has been destroyed.');
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return createExportRequest(input);
      const request = createExportRequest({ ...input, documentId: input?.documentId === undefined ? getActiveDocumentId() : input.documentId });
      if (!hasDocument(request.documentId)) throw new ExportRequestValidationError('documentId', '要导出的文档已不存在');
      return request;
    }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
