import { ModalShell } from '../components/modal-shell.js';
import { createEventScope, isElementRef, requireElementRef } from '../dom/index.js';

export const COMPATIBILITY_MODAL_OPEN_EVENT = 'markdown-editor:modal-shell-open';
export const COMPATIBILITY_MODAL_CLOSE_EVENT = 'markdown-editor:modal-shell-close';

const MODAL_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'link-modal', labelledBy: 'link-modal-title', initialFocus: '#link-url-input' }),
  Object.freeze({ id: 'url-modal', ariaLabel: '网页转 Markdown', initialFocus: '#url-input' }),
  Object.freeze({ id: 'find-modal', ariaLabel: '查找与替换', initialFocus: '#find-input' }),
  Object.freeze({
    id: 'export-progress-modal',
    labelledBy: 'export-progress-title',
    initialFocus: '#export-progress-cancel',
    closeOnEscape: false,
    closeOnBackdrop: false
  }),
  Object.freeze({ id: 'export-image-modal', ariaLabel: '导出图片', initialFocus: '.ratio-btn.active' }),
  Object.freeze({ id: 'image-modal', ariaLabel: '插入图片', initialFocus: '#image-url-input' }),
  Object.freeze({ id: 'mermaid-modal', ariaLabel: '插入 Mermaid 图表', initialFocus: '#mermaid-code' })
]);

const mounts = new WeakMap();

function assertOptions(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Compatibility modal options must be a plain object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Compatibility modal options must be a plain object.');
  }
  return value;
}

function resolveInitialFocus(root, value, fallbackSelector) {
  if (value === null) return null;
  if (isElementRef(value)) return value;
  const selector = String(value || fallbackSelector || '').trim();
  if (!selector) return null;
  return root.querySelector(selector);
}

function settleRequest(event, operation) {
  const detail = event?.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
  try {
    detail.result = operation(detail);
    detail.error = null;
  } catch (error) {
    detail.result = false;
    detail.error = error;
  }
}

export function mountCompatibilityModalShells(overlayRoot) {
  requireElementRef(overlayRoot, 'compatibility overlay root');
  const existing = mounts.get(overlayRoot);
  if (existing) return existing;

  const records = new Map();
  const events = createEventScope();
  try {
    for (const definition of MODAL_DEFINITIONS) {
      const root = requireElementRef(
        overlayRoot.querySelector(`#${definition.id}`),
        `compatibility modal ${definition.id}`
      );
      const panel = requireElementRef(root.firstElementChild, `compatibility modal panel ${definition.id}`);
      records.set(definition.id, Object.freeze({
        definition,
        root,
        shell: new ModalShell(root, { panel })
      }));
    }
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    for (const record of [...records.values()].reverse()) {
      try { record.shell.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct compatibility modal shells cleanly.');
  }

  let destroyed = false;
  function requireRecord(id) {
    if (destroyed) throw new Error('Compatibility modal shell bridge has been destroyed.');
    const normalizedId = String(id || '').trim();
    const record = records.get(normalizedId);
    if (!record) throw new Error(`Unknown compatibility modal: ${normalizedId || '<empty>'}.`);
    return record;
  }

  function openRecord(record, options = {}) {
    const normalizedOptions = assertOptions(options);
    const initialFocus = resolveInitialFocus(
      record.root,
      normalizedOptions.initialFocus,
      record.definition.initialFocus
    );
    return record.shell.open(null, {
      role: normalizedOptions.role || 'dialog',
      ariaLabel: normalizedOptions.ariaLabel ?? record.definition.ariaLabel ?? '',
      labelledBy: normalizedOptions.labelledBy ?? record.definition.labelledBy ?? '',
      describedBy: normalizedOptions.describedBy,
      initialFocus,
      returnFocus: normalizedOptions.returnFocus,
      closeOnEscape: normalizedOptions.closeOnEscape ?? record.definition.closeOnEscape ?? true,
      closeOnBackdrop: normalizedOptions.closeOnBackdrop ?? record.definition.closeOnBackdrop ?? true,
      onClose: normalizedOptions.onClose
    });
  }

  const api = Object.freeze({
    open(id, options = {}) {
      return openRecord(requireRecord(id), options);
    },
    close(id, reason = 'api') {
      return requireRecord(id).shell.close(reason);
    },
    isOpen(id) {
      return requireRecord(id).shell.isOpen();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      for (const record of [...records.values()].reverse()) {
        try { record.shell.destroy(); } catch (error) { errors.push(error); }
      }
      records.clear();
      mounts.delete(overlayRoot);
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy compatibility modal shells cleanly.');
    }
  });

  try {
    for (const record of records.values()) {
      events.listen(record.root, COMPATIBILITY_MODAL_OPEN_EVENT, event => {
        if (event?.target !== record.root) return;
        settleRequest(event, detail => openRecord(record, detail.options));
      });
      events.listen(record.root, COMPATIBILITY_MODAL_CLOSE_EVENT, event => {
        if (event?.target !== record.root) return;
        settleRequest(event, detail => record.shell.close(detail.reason ?? 'feature-close'));
      });
    }
  } catch (error) {
    const errors = [error];
    try { api.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to install compatibility modal event ports.');
  }

  mounts.set(overlayRoot, api);
  return api;
}
