import { confirm as tauriConfirm, open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';

const DIALOG_CATEGORY = 'native.dialog';

function defaultNow() {
  const value = globalThis.performance?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

function readTimestamp(now) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : 0;
  } catch (_) {
    return 0;
  }
}

function errorMessage(error) {
  return error?.message || String(error);
}

function recordSafely(record, operation, entry) {
  if (!record) return;
  try {
    record(operation, entry);
  } catch (_) {
    // Dialog telemetry is observational and must not replace native semantics.
  }
}

function normalizeSaveFileName(name, extension = 'md', acceptedExtensions = [extension]) {
  const fallback = `未命名文档.${extension}`;
  const value = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  if (!value) return fallback;
  const hasAcceptedExtension = acceptedExtensions.some(item => new RegExp(`\\.${item}$`, 'i').test(value));
  return hasAcceptedExtension ? value : `${value}.${extension}`;
}

function joinNativePath(directory, fileName) {
  const base = String(directory || '').trim().replace(/[\\/]+$/, '');
  if (!base) return String(fileName || '');
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base}${separator}${fileName}`;
}

/**
 * Creates the desktop dialog adapter. Cancellation is represented as null/false,
 * while native errors are rethrown unchanged.
 */
export function createDialogClient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('dialog client options must be an object');
  }

  const openDialog = Object.hasOwn(options, 'open') ? options.open : tauriOpen;
  const saveDialog = Object.hasOwn(options, 'save') ? options.save : tauriSave;
  const confirmDialog = Object.hasOwn(options, 'confirm') ? options.confirm : tauriConfirm;
  const now = Object.hasOwn(options, 'now') ? options.now : defaultNow;
  const record = Object.hasOwn(options, 'record') ? options.record : null;

  if (typeof openDialog !== 'function') throw new TypeError('dialog client requires an open function');
  if (typeof saveDialog !== 'function') throw new TypeError('dialog client requires a save function');
  if (typeof confirmDialog !== 'function') throw new TypeError('dialog client requires a confirm function');
  if (typeof now !== 'function') throw new TypeError('dialog client now must be a function');
  if (record !== null && record !== undefined && typeof record !== 'function') {
    throw new TypeError('dialog client record must be a function when provided');
  }

  async function measure(operation, details, invoke, resolveStatus) {
    const started = readTimestamp(now);
    try {
      const result = await invoke();
      recordSafely(record, operation, {
        category: DIALOG_CATEGORY,
        durationMs: Math.max(0, readTimestamp(now) - started),
        status: resolveStatus(result),
        ...(details === undefined ? {} : { details })
      });
      return result;
    } catch (error) {
      const errorDetails = details && typeof details === 'object' && !Array.isArray(details)
        ? { ...details, error: errorMessage(error) }
        : { error: errorMessage(error) };
      recordSafely(record, operation, {
        category: DIALOG_CATEGORY,
        durationMs: Math.max(0, readTimestamp(now) - started),
        status: 'error',
        details: errorDetails
      });
      throw error;
    }
  }

  async function openFile(dialogOptions = {}) {
    const selectedPath = await measure(
      'native.open-file-dialog',
      undefined,
      () => openDialog({
        title: String(dialogOptions.title || '打开 Markdown'),
        multiple: false,
        directory: false,
        filters: [{
          name: String(dialogOptions.filterName || 'Markdown 和文本文件'),
          extensions: Array.isArray(dialogOptions.extensions) && dialogOptions.extensions.length
            ? dialogOptions.extensions.map(item => String(item).replace(/^\./, '')).filter(Boolean)
            : ['md', 'markdown', 'txt']
        }]
      }),
      result => result ? 'ok' : 'cancelled'
    );
    return typeof selectedPath === 'string' ? selectedPath : null;
  }

  async function openDirectory(dialogOptions = {}) {
    const selectedPath = await measure(
      'native.open-directory-dialog',
      undefined,
      () => openDialog({
        title: String(dialogOptions.title || '选择目录'),
        multiple: false,
        directory: true,
        defaultPath: String(dialogOptions.defaultPath || '').trim() || undefined
      }),
      result => result ? 'ok' : 'cancelled'
    );
    return typeof selectedPath === 'string' ? selectedPath : null;
  }

  async function saveFile(preferredName, dialogOptions = {}) {
    const extension = String(dialogOptions.extension || 'md').replace(/^\./, '') || 'md';
    const acceptedExtensions = (Array.isArray(dialogOptions.extensions) && dialogOptions.extensions.length
      ? dialogOptions.extensions
      : [extension])
      .map(item => String(item).replace(/^\./, '').trim())
      .filter(Boolean);
    const defaultName = normalizeSaveFileName(preferredName, extension, acceptedExtensions);
    const defaultPath = joinNativePath(dialogOptions.defaultDirectory, defaultName);
    const selectedPath = await measure(
      'native.save-file-dialog',
      { extension },
      () => saveDialog({
        title: String(dialogOptions.title || '另存为'),
        defaultPath,
        filters: [{
          name: String(dialogOptions.filterName || 'Markdown 文档'),
          extensions: Array.isArray(dialogOptions.extensions) && dialogOptions.extensions.length
            ? dialogOptions.extensions.map(item => String(item).replace(/^\./, '')).filter(Boolean)
            : [extension, 'markdown']
        }]
      }),
      result => result ? 'ok' : 'cancelled'
    );
    if (!selectedPath) return null;
    const hasAcceptedExtension = acceptedExtensions.some(item => new RegExp(`\\.${item}$`, 'i').test(selectedPath));
    return hasAcceptedExtension ? selectedPath : `${selectedPath}.${extension}`;
  }

  async function confirm(message, dialogOptions = {}) {
    return confirmDialog(String(message || ''), {
      title: String(dialogOptions.title || 'Markdown Editor'),
      kind: dialogOptions.kind || 'warning',
      okLabel: String(dialogOptions.okLabel || '确定'),
      cancelLabel: String(dialogOptions.cancelLabel || '取消')
    });
  }

  return Object.freeze({ openFile, openDirectory, saveFile, confirm });
}
