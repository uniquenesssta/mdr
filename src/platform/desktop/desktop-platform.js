import { createDialogClient } from './dialog-client.js';
import { createDocumentStoreClient } from './document-store-client.js';
import { createDragDropClient } from './drag-drop-client.js';
import { createFileSystemClient } from './file-system-client.js';
import { createInvokeClient } from './invoke-client.js';
import { createLinkClient } from './link-client.js';
import { createPerformanceLogClient } from './performance-log-client.js';
import { createWebFetchClient } from './web-fetch-client.js';
import { createWindowClient } from './window-client.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveClient(options, name, createClient) {
  const injected = options[name];
  if (injected !== undefined) {
    if (!isObject(injected)) throw new TypeError(`desktop platform ${name} must be an object`);
    return injected;
  }
  return createClient();
}

function requireTextResult(result, operation) {
  if (typeof result === 'string') return result;
  if (typeof result?.content === 'string') return result.content;
  throw new TypeError(`desktop platform ${operation} did not return text content`);
}

function requireImageResult(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.dataUrl === 'string') return result.dataUrl;
  throw new TypeError('desktop platform readImage did not return a data URL');
}

/**
 * Composes the responsibility-focused desktop clients into implementations that
 * match the runtime-neutral Platform port contracts. Business state and caller
 * migration remain outside this module.
 */
export function createDesktopPlatform(options = {}) {
  if (!isObject(options)) throw new TypeError('desktop platform options must be an object');

  const invokeClient = resolveClient(options, 'invokeClient', () => createInvokeClient({
    ...(Object.hasOwn(options, 'invoke') ? { invoke: options.invoke } : {}),
    ...(Object.hasOwn(options, 'now') ? { now: options.now } : {}),
    ...(Object.hasOwn(options, 'record') ? { record: options.record } : {})
  }));
  const dialogClient = resolveClient(options, 'dialogClient', () => createDialogClient({
    ...(Object.hasOwn(options, 'now') ? { now: options.now } : {}),
    ...(Object.hasOwn(options, 'record') ? { record: options.record } : {})
  }));
  const documentStoreClient = resolveClient(options, 'documentStoreClient', () => createDocumentStoreClient({ invoke: invokeClient.invoke }));
  const dragDropClient = resolveClient(options, 'dragDropClient', () => createDragDropClient());
  const fileSystemClient = resolveClient(options, 'fileSystemClient', () => createFileSystemClient({ invoke: invokeClient.invoke }));
  const linkClient = resolveClient(options, 'linkClient', () => createLinkClient({ invoke: invokeClient.invoke }));
  const performanceLogClient = resolveClient(options, 'performanceLogClient', () => createPerformanceLogClient({ invoke: invokeClient.invoke }));
  const webFetchClient = resolveClient(options, 'webFetchClient', () => createWebFetchClient({ invoke: invokeClient.invoke }));
  const windowClient = resolveClient(options, 'windowClient', () => createWindowClient());

  const files = Object.freeze({
    async readText(path) {
      return requireTextResult(await fileSystemClient.readDroppedFile(path), 'readText');
    },
    writeText(path, content, details = {}) {
      return fileSystemClient.writeTextFile(path, content, details);
    },
    writeBinary(path, content, details = {}) {
      return fileSystemClient.writeBinaryFile(path, content, details);
    },
    listTextTree(documentPath) {
      return fileSystemClient.listTextFileTree(documentPath);
    },
    async readImage(source, documentPath = '') {
      return requireImageResult(await fileSystemClient.readLocalImage(source, documentPath));
    },
    getInitialPath() {
      return fileSystemClient.getInitialFilePath();
    }
  });

  const web = Object.freeze({
    async fetchText(url, options = {}) {
      const result = await webFetchClient.fetchUrl(url, options);
      if (typeof result === 'string') return result;
      if (typeof result?.html === 'string') return result.html;
      if (typeof result?.content === 'string') return result.content;
      throw new TypeError('desktop platform fetchText did not return text content');
    }
  });

  return Object.freeze({
    files,
    dialogs: dialogClient,
    window: windowClient,
    dragDrop: dragDropClient,
    documentStore: documentStoreClient,
    web,
    links: linkClient,
    logs: performanceLogClient
  });
}
