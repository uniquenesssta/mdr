import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMAND_IDS as C, createRecentFilesMenuController } from '../../../src/features/menu/index.js';

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

function createDocument() {
  const documentRef = { createElement: () => createElement(documentRef) };
  return documentRef;
}

function createElement(documentRef) {
  const listeners = new Map();
  const attrs = new Map();
  const element = {
    ownerDocument: documentRef,
    children: [],
    parentElement: null,
    dataset: {},
    className: '',
    classList: createClassList(),
    textContent: '',
    title: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    appendChild(child) { child.parentElement = element; element.children.push(child); return child; },
    replaceChildren(...children) {
      element.children.forEach(child => { child.parentElement = null; });
      element.children = [];
      children.forEach(child => element.appendChild(child));
    },
    contains(target) { for (let node = target; node; node = node.parentElement) if (node === element) return true; return false; },
    closest(selector) {
      if (selector === '[data-recent-files-action]' && element.dataset.recentFilesAction) return element;
      return element.parentElement?.closest?.(selector) || null;
    },
    emitClick(target) {
      let prevented = 0;
      let stopped = 0;
      listeners.get('click')?.({
        target,
        preventDefault() { prevented += 1; },
        stopPropagation() { stopped += 1; }
      });
      return { prevented, stopped };
    },
    listenerCount() { return listeners.size; }
  };
  return element;
}

function createSource(entries = []) {
  let snapshot = Object.freeze({ entries: Object.freeze(entries), revision: 0 });
  const listeners = new Set();
  return {
    get snapshot() { return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(nextEntries) {
      const previous = snapshot;
      snapshot = Object.freeze({ entries: Object.freeze(nextEntries), revision: previous.revision + 1 });
      const event = Object.freeze({ previous, snapshot });
      [...listeners].forEach(listener => listener(event));
    },
    get listenerCount() { return listeners.size; }
  };
}

test('Atomic 6.12 Recent Files Menu renders read-only snapshots and emits open/clear commands', () => {
  const documentRef = createDocument();
  const owner = createElement(documentRef);
  const list = createElement(documentRef);
  const source = createSource([
    Object.freeze({ path: 'C:/Notes/A.md', name: 'A.md', openedAt: 2 }),
    Object.freeze({ path: 'C:/Notes/B.md', name: 'B.md', openedAt: 1 })
  ]);
  const calls = [];
  const commands = { execute(commandId, payload) { calls.push({ commandId, payload }); return true; } };
  const controller = createRecentFilesMenuController({ owner, list, source, commands, available: true });

  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  assert.equal(source.listenerCount, 1);
  assert.equal(list.children.length, 4);
  assert.equal(list.children[0].className, 'menu-item recent-file-item');
  assert.equal(list.children[0].title, 'C:/Notes/A.md');
  assert.equal(list.children[0].children[0].textContent, 'A.md');
  assert.equal(list.children[2].className, 'menu-separator');
  assert.equal(list.children[3].textContent, '清空记录');

  const openEvent = list.emitClick(list.children[0].children[0]);
  assert.deepEqual(openEvent, { prevented: 1, stopped: 1 });
  assert.equal(calls[0].commandId, C.RECENT_FILE_OPEN);
  assert.equal(calls[0].payload.path, 'C:/Notes/A.md');

  list.emitClick(list.children[3]);
  assert.equal(calls[1].commandId, C.RECENT_FILES_CLEAR);

  source.publish([]);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, '暂无记录');

  controller.destroy();
  controller.destroy();
  assert.equal(source.listenerCount, 0);
  assert.equal(list.listenerCount(), 0);
  assert.equal(list.children.length, 0);
  source.publish([{ path: 'C:/After.md', name: 'After.md' }]);
  assert.equal(list.children.length, 0);
  assert.throws(() => controller.start(), /destroyed/);
});

test('Atomic 6.12 Recent Files Menu preserves desktop-only state without exposing file commands', () => {
  const documentRef = createDocument();
  const owner = createElement(documentRef);
  const list = createElement(documentRef);
  const source = createSource([{ path: 'C:/Notes/A.md', name: 'A.md' }]);
  const calls = [];
  const controller = createRecentFilesMenuController({
    owner,
    list,
    source,
    commands: { execute(...args) { calls.push(args); } },
    available: false
  });
  controller.start();
  assert.equal(owner.classList.contains('disabled'), true);
  assert.equal(owner.getAttribute('aria-disabled'), 'true');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, '桌面版可用');
  list.emitClick(list.children[0]);
  assert.deepEqual(calls, []);
  controller.destroy();
  assert.equal(owner.classList.contains('disabled'), false);
  assert.equal(owner.getAttribute('aria-disabled'), null);
});

test('Atomic 6.12 Recent Files Menu contains synchronous and asynchronous command failures', async () => {
  const documentRef = createDocument();
  const owner = createElement(documentRef);
  const list = createElement(documentRef);
  const source = createSource([{ path: 'C:/Notes/A.md', name: 'A.md' }]);
  const errors = [];
  let mode = 'sync';
  const controller = createRecentFilesMenuController({
    owner,
    list,
    source,
    commands: {
      execute() {
        if (mode === 'sync') throw new Error('sync-fail');
        return Promise.reject(new Error('async-fail'));
      }
    },
    reportError(message, error) { errors.push([message, error.message]); }
  });
  controller.start();
  list.emitClick(list.children[0]);
  mode = 'async';
  list.emitClick(list.children[0]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map(item => item[1]), ['sync-fail', 'async-fail']);
  controller.destroy();
});
