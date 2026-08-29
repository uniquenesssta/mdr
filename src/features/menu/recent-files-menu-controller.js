/**
 * Responsibility: Project Documents recent-file snapshots into the Recent Files submenu and emit stable Menu commands.
 * Imports: Stable Menu command IDs only; Documents internals, persistence, platform I/O and submenu geometry are forbidden.
 * Exports: createRecentFilesMenuController().
 * State/side effects: Owns one read-only source subscription, one delegated click listener and transient rendered DOM only.
 * Lifecycle: Explicit idempotent start/destroy; destroy removes listeners/subscriptions and generated rows.
 */
import { MENU_COMMAND_IDS as C } from './menu-command-bindings.js';

const DEFAULT_LABELS = Object.freeze({
  desktopOnly: '桌面版可用',
  empty: '暂无记录',
  clear: '清空记录'
});

function assertElement(value, label) {
  if (!value || typeof value.addEventListener !== 'function' || typeof value.replaceChildren !== 'function') {
    throw new TypeError(`RecentFilesMenuController requires ${label}.`);
  }
}

function normalizeSnapshot(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  return Object.freeze({ entries });
}

export function createRecentFilesMenuController({
  owner,
  list,
  source,
  commands,
  available = true,
  labels = DEFAULT_LABELS,
  reportError = (message, error) => console.error(message, error)
} = {}) {
  assertElement(owner, 'a submenu owner element');
  assertElement(list, 'a submenu list element');
  if (!source || typeof source.subscribe !== 'function') {
    throw new TypeError('RecentFilesMenuController requires a read-only Documents source.');
  }
  if (!commands || typeof commands.execute !== 'function') {
    throw new TypeError('RecentFilesMenuController requires a Menu command port.');
  }
  if (typeof reportError !== 'function') throw new TypeError('RecentFilesMenuController error reporter must be a function.');

  const documentRef = list.ownerDocument || owner.ownerDocument;
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('RecentFilesMenuController requires a DOM document.');
  }

  const text = Object.freeze({ ...DEFAULT_LABELS, ...(labels || {}) });
  const isAvailable = Boolean(available);
  let destroyed = false;
  let started = false;
  let unsubscribe = null;
  let currentEntries = Object.freeze([]);
  let clickListener = null;

  const assertActive = () => {
    if (destroyed) throw new Error('RecentFilesMenuController is destroyed.');
  };

  function createMessage(label) {
    const element = documentRef.createElement('div');
    element.className = 'menu-item recent-file-empty';
    element.textContent = label;
    return element;
  }

  function render(snapshot = source.snapshot) {
    if (destroyed) return false;
    const normalized = normalizeSnapshot(snapshot);
    currentEntries = Object.freeze(normalized.entries.slice());
    list.replaceChildren();

    if (!isAvailable) {
      owner.classList?.add?.('disabled');
      owner.setAttribute?.('aria-disabled', 'true');
      list.appendChild(createMessage(text.desktopOnly));
      return true;
    }

    owner.classList?.remove?.('disabled');
    owner.setAttribute?.('aria-disabled', 'false');
    if (!currentEntries.length) {
      list.appendChild(createMessage(text.empty));
      return true;
    }

    currentEntries.forEach((entry, index) => {
      const item = documentRef.createElement('div');
      item.className = 'menu-item recent-file-item';
      item.title = String(entry?.path || '');
      item.dataset.recentFilesAction = 'open';
      item.dataset.recentFileIndex = String(index);
      const label = documentRef.createElement('span');
      label.textContent = String(entry?.name || entry?.path || '');
      item.appendChild(label);
      list.appendChild(item);
    });

    const separator = documentRef.createElement('div');
    separator.className = 'menu-separator';
    list.appendChild(separator);

    const clear = documentRef.createElement('div');
    clear.className = 'menu-item';
    clear.textContent = text.clear;
    clear.dataset.recentFilesAction = 'clear';
    list.appendChild(clear);
    return true;
  }

  function report(commandId, error) {
    try { reportError(`Recent files menu command failed: ${commandId}.`, error); }
    catch (reportingError) { console.error('Recent files menu error reporter failed:', reportingError, error); }
  }

  function execute(commandId, payload) {
    if (destroyed) return false;
    let result;
    try {
      result = commands.execute(commandId, payload);
    } catch (error) {
      report(commandId, error);
      return false;
    }
    if (result && typeof result.then === 'function') result.catch(error => report(commandId, error));
    return result;
  }

  function handleClick(event) {
    const actionElement = event?.target?.closest?.('[data-recent-files-action]');
    if (!actionElement || !list.contains?.(actionElement)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const action = actionElement.dataset?.recentFilesAction;
    if (action === 'clear') {
      execute(C.RECENT_FILES_CLEAR, Object.freeze({ source: 'recent-files-menu' }));
      return;
    }
    if (action !== 'open') return;
    const index = Number.parseInt(actionElement.dataset?.recentFileIndex || '', 10);
    const entry = Number.isInteger(index) ? currentEntries[index] : null;
    const path = String(entry?.path || '').trim();
    if (!path) return;
    execute(C.RECENT_FILE_OPEN, Object.freeze({ path, source: 'recent-files-menu' }));
  }

  return Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      clickListener = event => handleClick(event);
      list.addEventListener('click', clickListener);
      render(source.snapshot);
      unsubscribe = source.subscribe(event => render(event?.snapshot || source.snapshot));
      started = true;
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const dispose = unsubscribe;
      unsubscribe = null;
      try { dispose?.(); } finally {
        if (clickListener) list.removeEventListener('click', clickListener);
        clickListener = null;
        currentEntries = Object.freeze([]);
        list.replaceChildren();
        owner.classList?.remove?.('disabled');
        owner.removeAttribute?.('aria-disabled');
        started = false;
      }
    }
  });
}
