import test from 'node:test';
import assert from 'node:assert/strict';

import {
  configureHybridImageSourcePlatform,
  invalidateHybridImageSource,
  resolveHybridImageSource
} from '../src/features/hybrid-editor/image/image-source-resolver.js';
import { createImageErrorView } from '../src/features/hybrid-editor/widgets/image/image-error-view.js';
import { createImageLoadVersionGuard } from '../src/features/hybrid-editor/widgets/image/image-widget.js';

function configure(files, enabled, contextRef) {
  configureHybridImageSourcePlatform({
    files,
    enabled,
    getDocumentContext: () => contextRef.current
  });
}

test('Atomic 8.10 validates direct image sources without touching the local files port', async () => {
  let reads = 0;
  const contextRef = { current: { documentId: 'direct-doc', filePath: '/docs/direct.md' } };
  configure({ async readImage() { reads += 1; return 'data:image/png;base64,unused'; } }, true, contextRef);
  const direct = await resolveHybridImageSource('https://example.test/image.png');
  assert.deepEqual(direct, {
    url: 'https://example.test/image.png',
    kind: 'direct',
    displaySource: 'https://example.test/image.png'
  });
  await assert.rejects(resolveHybridImageSource('javascript:alert(1)'), /不支持此图片地址/);
  await assert.rejects(resolveHybridImageSource('   '), /图片地址为空/);
  assert.equal(reads, 0);
});

test('Atomic 8.10 keeps relative sources relative when local image loading is disabled', async () => {
  let reads = 0;
  const contextRef = { current: { documentId: 'relative-doc', filePath: '/docs/relative.md' } };
  configure({ async readImage() { reads += 1; return 'unused'; } }, false, contextRef);
  const result = await resolveHybridImageSource('./assets/a.png');
  assert.deepEqual(result, {
    url: './assets/a.png',
    kind: 'relative',
    displaySource: './assets/a.png'
  });
  assert.equal(reads, 0);
});

test('Atomic 8.10 local path resolution deduplicates pending and resolved reads by document context', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const contextRef = { current: { documentId: 'cache-doc', filePath: '/docs/cache.md' } };
  configure({
    async readImage(source, filePath) {
      calls.push({ source, filePath });
      await gate;
      return 'data:image/png;base64,cache';
    }
  }, true, contextRef);
  const first = resolveHybridImageSource('./cache.png');
  const second = resolveHybridImageSource('./cache.png');
  assert.equal(calls.length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.url, 'data:image/png;base64,cache');
  assert.equal(b.url, a.url);
  assert.equal(a.kind, 'local');
  assert.deepEqual(calls, [{ source: './cache.png', filePath: '/docs/cache.md' }]);
  const cached = await resolveHybridImageSource('./cache.png');
  assert.equal(cached.url, a.url);
  assert.equal(calls.length, 1);
});

test('Atomic 8.10 failed local reads leave no poisoned pending cache and can retry', async () => {
  let attempts = 0;
  const contextRef = { current: { documentId: 'failure-doc', filePath: '/docs/failure.md' } };
  configure({
    async readImage() {
      attempts += 1;
      if (attempts === 1) throw new Error('read failed');
      return 'data:image/png;base64,recovered';
    }
  }, true, contextRef);
  await assert.rejects(resolveHybridImageSource('./failure.png'), /read failed/);
  const recovered = await resolveHybridImageSource('./failure.png');
  assert.equal(recovered.url, 'data:image/png;base64,recovered');
  assert.equal(attempts, 2);
});

test('Atomic 8.10 invalidation is exact to the active document context and forces one new read', async () => {
  const calls = [];
  const contextRef = { current: { documentId: 'invalidate-a', filePath: '/docs/a.md' } };
  configure({
    async readImage(source, filePath) {
      calls.push({ source, filePath });
      return `data:image/png;base64,${calls.length}`;
    }
  }, true, contextRef);
  const a1 = await resolveHybridImageSource('./same.png');
  contextRef.current = { documentId: 'invalidate-b', filePath: '/docs/b.md' };
  const b1 = await resolveHybridImageSource('./same.png');
  assert.equal(calls.length, 2);
  contextRef.current = { documentId: 'invalidate-a', filePath: '/docs/a.md' };
  const aCached = await resolveHybridImageSource('./same.png');
  assert.equal(aCached.url, a1.url);
  assert.equal(invalidateHybridImageSource('./same.png'), true);
  const a2 = await resolveHybridImageSource('./same.png');
  assert.notEqual(a2.url, a1.url);
  assert.equal(calls.length, 3);
  contextRef.current = { documentId: 'invalidate-b', filePath: '/docs/b.md' };
  const bCached = await resolveHybridImageSource('./same.png');
  assert.equal(bCached.url, b1.url);
  assert.equal(calls.length, 3);
});

test('Atomic 8.10 image load version guard rejects stale and post-destroy async results', () => {
  const guard = createImageLoadVersionGuard();
  const first = guard.begin();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.begin();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
  const third = guard.begin();
  assert.equal(guard.isCurrent(third), true);
  guard.destroy();
  assert.equal(guard.isCurrent(third), false);
  assert.equal(guard.begin(), null);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.type = '';
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type) {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

test('Atomic 8.10 image error view isolates failure presentation and retry intent', () => {
  const previousDocument = globalThis.document;
  let retries = 0;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const view = createImageErrorView({
      error: new Error('boom'),
      source: './broken.png',
      onRetry: () => { retries += 1; }
    });
    assert.equal(view.className, 'cm-hybrid-image-error');
    assert.equal(view.children[0].textContent, 'boom');
    assert.equal(view.children[1].textContent, './broken.png');
    const retry = view.children[2];
    assert.match(retry.className, /cm-hybrid-image-retry/);
    const event = retry.dispatch('click');
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.equal(retries, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});
