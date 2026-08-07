import { createBrowserClipboard } from './browser/browser-clipboard.js';
import { createBrowserFileDownload } from './browser/browser-file-download.js';
import { createBrowserFileReader } from './browser/browser-file-reader.js';
import { createBrowserFullscreen } from './browser/browser-fullscreen.js';
import { createBrowserPrint } from './browser/browser-print.js';
import { createBrowserStorage } from './browser/browser-storage.js';
import { createDesktopPlatform } from './desktop/desktop-platform.js';
import { detectPlatformEnvironment } from './environment/platform-detection.js';
import { createRuntimeCapabilities } from './environment/runtime-capabilities.js';
import { createPlatformPortSet } from './ports/platform-port-set.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readMember(target, key) {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return undefined;
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

function fileName(path) {
  return String(path || '').split(/[\\/]/).pop() || 'download';
}

export class PlatformCapabilityUnavailableError extends Error {
  constructor(port, method, capability) {
    super(`Platform capability "${capability}" is unavailable for ${port}.${method}()`);
    this.name = 'PlatformCapabilityUnavailableError';
    this.code = 'PLATFORM_CAPABILITY_UNAVAILABLE';
    this.port = port;
    this.method = method;
    this.capability = capability;
  }
}

function unsupported(port, method, capability) {
  return () => {
    throw new PlatformCapabilityUnavailableError(port, method, capability);
  };
}

function unsupportedPort(port, methods, capability) {
  return Object.freeze(Object.fromEntries(
    methods.map(method => [method, unsupported(port, method, capability)])
  ));
}

function createBrowserFiles(runtime, capabilities) {
  const reader = capabilities.browser.fileRead
    ? createBrowserFileReader({ FileReaderClass: readMember(runtime, 'FileReader') })
    : null;
  const BlobClass = capabilities.browser.fileDownload ? readMember(runtime, 'Blob') : null;
  const downloader = capabilities.browser.fileDownload
    ? createBrowserFileDownload({
        documentObject: readMember(runtime, 'document'),
        urlApi: readMember(runtime, 'URL')
      })
    : null;

  function createDownloadBlob(content, type, method) {
    if (typeof BlobClass !== 'function') {
      throw new PlatformCapabilityUnavailableError('files', method, 'browser.fileDownload');
    }
    return new BlobClass(content, { type });
  }

  return Object.freeze({
    readText: reader
      ? file => reader.readText(file)
      : unsupported('files', 'readText', 'browser.fileRead'),
    writeText: downloader
      ? (path, content, options = {}) => downloader.downloadBlob(
          createDownloadBlob(
            [String(content ?? '')],
            String(options.mimeType || 'text/plain;charset=utf-8'),
            'writeText'
          ),
          fileName(path)
        )
      : unsupported('files', 'writeText', 'browser.fileDownload'),
    writeBinary: downloader
      ? (path, content, options = {}) => {
          const bytes = content instanceof Uint8Array ? content : new Uint8Array(content || []);
          return downloader.downloadBlob(
            createDownloadBlob(
              [bytes],
              String(options.mimeType || 'application/octet-stream'),
              'writeBinary'
            ),
            fileName(path)
          );
        }
      : unsupported('files', 'writeBinary', 'browser.fileDownload'),
    listTextTree: unsupported('files', 'listTextTree', 'desktop.fileSystem'),
    readImage: reader
      ? file => reader.readDataUrl(file)
      : unsupported('files', 'readImage', 'browser.fileRead'),
    getInitialPath: unsupported('files', 'getInitialPath', 'desktop.fileSystem')
  });
}

function createBrowserDialogs(runtime, capabilities) {
  const confirmMethod = capabilities.browser.confirm ? readMember(runtime, 'confirm') : null;
  const confirm = capabilities.browser.confirm
    ? (message => Boolean(confirmMethod.call(runtime, String(message || ''))))
    : unsupported('dialogs', 'confirm', 'browser.confirm');
  return Object.freeze({
    openFile: unsupported('dialogs', 'openFile', 'desktop.dialogs'),
    openDirectory: unsupported('dialogs', 'openDirectory', 'desktop.dialogs'),
    saveFile: unsupported('dialogs', 'saveFile', 'desktop.dialogs'),
    confirm
  });
}

function createBrowserWeb(runtime, capabilities) {
  if (!capabilities.browser.webFetch) {
    return unsupportedPort('web', ['fetchText'], 'browser.webFetch');
  }
  const fetchMethod = readMember(runtime, 'fetch');
  return Object.freeze({
    async fetchText(url, options = {}) {
      const response = await fetchMethod.call(runtime, url, options);
      if (!response || typeof response.text !== 'function') {
        throw new TypeError('Browser fetch did not return a text-capable response');
      }
      if (response.ok === false) {
        const status = Number(response.status) || 0;
        throw new Error(`Browser fetch failed with status ${status}`);
      }
      return response.text();
    }
  });
}

function createBrowserLinks(runtime, capabilities) {
  if (!capabilities.browser.externalLinks) {
    return unsupportedPort('links', ['openExternal'], 'browser.externalLinks');
  }
  const openMethod = readMember(runtime, 'open');
  return Object.freeze({
    openExternal(url) {
      const opened = openMethod.call(runtime, String(url || ''), '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('Browser blocked external link opening');
    }
  });
}

function createBrowserImplementations(runtime, capabilities) {
  const documentObject = readMember(runtime, 'document');
  const navigatorObject = readMember(runtime, 'navigator');
  return Object.freeze({
    storage: capabilities.browser.storage
      ? createBrowserStorage({ storage: readMember(runtime, 'localStorage') })
      : unsupportedPort('storage', ['get', 'set', 'remove', 'clear'], 'browser.storage'),
    files: createBrowserFiles(runtime, capabilities),
    dialogs: createBrowserDialogs(runtime, capabilities),
    web: createBrowserWeb(runtime, capabilities),
    links: createBrowserLinks(runtime, capabilities),
    clipboard: capabilities.browser.clipboard
      ? createBrowserClipboard({ navigatorObject, documentObject })
      : unsupportedPort('clipboard', ['writeText'], 'browser.clipboard'),
    fullscreen: capabilities.browser.fullscreen
      ? createBrowserFullscreen({ documentObject })
      : unsupportedPort('fullscreen', ['isEnabled', 'isActive', 'enter', 'exit', 'subscribe'], 'browser.fullscreen'),
    print: capabilities.browser.print
      ? createBrowserPrint({ windowObject: runtime })
      : unsupportedPort('print', ['print'], 'browser.print')
  });
}

function resolveDesktopPlatform(options, capabilities) {
  if (!capabilities.isDesktop) return null;
  if (options.desktopPlatform !== undefined) {
    if (!isObject(options.desktopPlatform)) {
      throw new TypeError('createPlatform desktopPlatform must be an object');
    }
    return options.desktopPlatform;
  }
  return createDesktopPlatform({
    ...(Object.hasOwn(options, 'invoke') ? { invoke: options.invoke } : {}),
    ...(Object.hasOwn(options, 'now') ? { now: options.now } : {}),
    ...(Object.hasOwn(options, 'record') ? { record: options.record } : {})
  });
}

function selectDesktopOrFallback(desktopPlatform, desktopAvailable, name, fallback) {
  if (!desktopAvailable) return fallback;
  const implementation = desktopPlatform?.[name];
  if (!isObject(implementation)) {
    throw new TypeError(`desktop platform must provide ${name}`);
  }
  return implementation;
}

/**
 * Creates the immutable runtime-neutral Platform facade from a capability
 * snapshot. This is the only runtime composition root for the platform layer.
 */
export function createPlatform(options = {}) {
  if (!isObject(options)) throw new TypeError('createPlatform options must be an object');
  const runtime = Object.hasOwn(options, 'runtime') ? options.runtime : globalThis;
  const environment = detectPlatformEnvironment(runtime);
  const capabilities = createRuntimeCapabilities(environment, runtime);
  const browser = createBrowserImplementations(runtime, capabilities);
  const desktop = resolveDesktopPlatform(options, capabilities);

  const implementations = {
    storage: browser.storage,
    files: selectDesktopOrFallback(desktop, capabilities.desktop.fileSystem, 'files', browser.files),
    dialogs: selectDesktopOrFallback(desktop, capabilities.desktop.dialogs, 'dialogs', browser.dialogs),
    window: selectDesktopOrFallback(
      desktop,
      capabilities.desktop.window,
      'window',
      unsupportedPort('window', ['startDrag', 'minimize', 'toggleMaximize', 'isMaximized', 'subscribeResize', 'subscribeCloseRequest', 'requestClose', 'forceClose'], 'desktop.window')
    ),
    dragDrop: selectDesktopOrFallback(
      desktop,
      capabilities.desktop.dragDrop,
      'dragDrop',
      unsupportedPort('dragDrop', ['subscribe'], 'desktop.dragDrop')
    ),
    documentStore: selectDesktopOrFallback(
      desktop,
      capabilities.desktop.documentStore,
      'documentStore',
      unsupportedPort('documentStore', ['save', 'beginSnapshotUpload', 'appendSnapshotChunk', 'commitSnapshotUpload', 'abortSnapshotUpload', 'load', 'loadManifest', 'readChunk', 'search', 'remove'], 'desktop.documentStore')
    ),
    web: selectDesktopOrFallback(desktop, capabilities.desktop.webFetch, 'web', browser.web),
    links: selectDesktopOrFallback(desktop, capabilities.desktop.externalLinks, 'links', browser.links),
    logs: selectDesktopOrFallback(
      desktop,
      capabilities.desktop.performanceLogs,
      'logs',
      unsupportedPort('logs', ['writePerformance'], 'desktop.performanceLogs')
    ),
    clipboard: browser.clipboard,
    fullscreen: browser.fullscreen,
    print: browser.print
  };

  const ports = createPlatformPortSet(implementations);
  return Object.freeze({ capabilities, ...ports });
}
