import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDragDropClient } from '../../../src/platform/index.js';

function createNativeWebview(log, options = {}) {
  return {
    async onDragDropEvent(handler) {
      log.push({ method: 'onDragDropEvent', handler });
      return options.disposer || (() => log.push('disposeDragDrop'));
    }
  };
}

test('Atomic Task 3.6 converts Tauri drag/drop payloads into immutable platform events', async () => {
  const log = [];
  const received = [];
  const client = createDragDropClient({ getCurrentWebview: () => createNativeWebview(log) });
  await client.subscribe(event => {
    received.push(event);
    return 'handled';
  });

  const nativeHandler = log[0].handler;
  const result = nativeHandler({
    event: 'tauri://drag-drop',
    payload: {
      type: 'drop',
      paths: ['C:\\docs\\readme.md', 'C:\\images\\preview.png'],
      position: { x: 24, y: 48 }
    }
  });

  assert.equal(result, 'handled');
  assert.deepEqual(received, [{
    type: 'drop',
    paths: ['C:\\docs\\readme.md', 'C:\\images\\preview.png'],
    position: { x: 24, y: 48 }
  }]);
  assert.ok(Object.isFrozen(received[0]));
  assert.ok(Object.isFrozen(received[0].paths));
  assert.ok(Object.isFrozen(received[0].position));
  assert.ok(Object.isFrozen(client));
});

test('drag/drop normalization is tolerant and does not classify file types', async () => {
  const log = [];
  const received = [];
  const client = createDragDropClient({ getCurrentWebview: () => createNativeWebview(log) });
  await client.subscribe(event => received.push(event));
  const nativeHandler = log[0].handler;

  nativeHandler({ payload: { type: 'over', paths: ['a.md', 'b.png', 'c.exe'], position: { x: '5', y: 6 } } });
  nativeHandler({ payload: { type: 'leave' } });
  nativeHandler(null);

  assert.deepEqual(received[0], {
    type: 'over',
    paths: ['a.md', 'b.png', 'c.exe'],
    position: { x: 5, y: 6 }
  });
  assert.deepEqual(received[1], { type: 'leave', paths: [], position: null });
  assert.deepEqual(received[2], { type: '', paths: [], position: null });

  const source = await readFile(new URL('../../../src/platform/desktop/drag-drop-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /readDroppedFile|\.markdown|\.txt|image\/|mime|extension/i);
});

test('subscription disposers are idempotent and destroy releases active subscriptions in reverse order', async () => {
  const log = [];
  let registration = 0;
  const client = createDragDropClient({
    getCurrentWebview: () => ({
      async onDragDropEvent(handler) {
        registration += 1;
        const id = registration;
        log.push({ method: 'subscribe', id, handler });
        return () => log.push(`dispose${id}`);
      }
    })
  });

  const first = await client.subscribe(() => {});
  await client.subscribe(() => {});
  await client.subscribe(() => {});
  await first();
  await first();
  const destroying = client.destroy();
  assert.equal(destroying, client.destroy());
  await destroying;
  assert.deepEqual(log.filter(value => typeof value === 'string'), ['dispose1', 'dispose3', 'dispose2']);
  await assert.rejects(client.subscribe(() => {}), /drag-drop client is destroyed/);
});

test('a subscription resolved after destroy is disposed immediately and never becomes active', async () => {
  let resolveSubscription;
  const log = [];
  const client = createDragDropClient({
    getCurrentWebview: () => ({
      async onDragDropEvent() {
        return new Promise(resolve => { resolveSubscription = resolve; });
      }
    })
  });

  const pending = client.subscribe(() => {});
  const destroying = client.destroy();
  resolveSubscription(() => log.push('lateDispose'));
  const disposer = await pending;
  await destroying;
  await disposer();
  assert.deepEqual(log, ['lateDispose']);
});

test('native registration and cleanup errors preserve their original identity', async () => {
  const registrationError = new Error('registration failed');
  const registrationClient = createDragDropClient({
    getCurrentWebview: () => ({ onDragDropEvent: async () => { throw registrationError; } })
  });
  await assert.rejects(registrationClient.subscribe(() => {}), error => error === registrationError);

  const cleanupError = new Error('cleanup failed');
  const cleanupClient = createDragDropClient({
    getCurrentWebview: () => ({ onDragDropEvent: async () => () => { throw cleanupError; } })
  });
  await cleanupClient.subscribe(() => {});
  await assert.rejects(cleanupClient.destroy(), error => error === cleanupError);
});

test('invalid dependencies, handlers and native subscription results fail at the adapter boundary', async () => {
  assert.throws(() => createDragDropClient(null), /options must be an object/);
  assert.throws(() => createDragDropClient({ getCurrentWebview: null }), /requires a getCurrentWebview function/);
  const invalidWebview = createDragDropClient({ getCurrentWebview: () => null });
  await assert.rejects(invalidWebview.subscribe(() => {}), /must return a webview object/);
  const invalidHandler = createDragDropClient({ getCurrentWebview: () => createNativeWebview([]) });
  await assert.rejects(invalidHandler.subscribe(null), /handler must be a function/);
  const invalidMethod = createDragDropClient({ getCurrentWebview: () => ({}) });
  await assert.rejects(invalidMethod.subscribe(() => {}), /requires onDragDropEvent/);
  const invalidDisposer = createDragDropClient({
    getCurrentWebview: () => ({ onDragDropEvent: async () => null })
  });
  await assert.rejects(invalidDisposer.subscribe(() => {}), /must return a disposer function/);
  const destroyed = createDragDropClient({ getCurrentWebview: () => createNativeWebview([]) });
  await destroyed.destroy();
  await assert.rejects(destroyed.subscribe(() => {}), /drag-drop client is destroyed/);
});

test('the drag/drop client is the sole production owner of the Tauri webview import', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../../tests/architecture/fixtures/production-modules.json', import.meta.url),
    'utf8'
  ));
  const owners = [];
  for (const [path] of fixture.modules) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    if (source.includes('@tauri-apps/api/webview')) owners.push(path);
  }
  assert.deepEqual(owners, ['src/platform/desktop/drag-drop-client.js']);
  const publicEntry = await readFile(new URL('../../../src/platform/index.js', import.meta.url), 'utf8');
  assert.match(publicEntry, /desktop\/drag-drop-client\.js/);
});

test('desktop platform exposes DragDropPort directly and events consumes normalized Platform events', async () => {
  const desktop = await readFile(new URL('../../../src/platform/desktop/desktop-platform.js', import.meta.url), 'utf8');
  const events = await readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8');
  assert.match(desktop, /createDragDropClient\(/);
  assert.match(desktop, /dragDrop: dragDropClient/);
  assert.match(events, /call\('dragDrop', 'subscribe'/);
  assert.match(events, /payload\?\.type === 'over'/);
  assert.match(events, /payload\?\.type === 'drop'/);
  assert.doesNotMatch(events, /markdownEditorNative/);
});

test('file interpretation remains in the application layer, not the DragDrop client', async () => {
  const clientSource = await readFile(new URL('../../../src/platform/desktop/drag-drop-client.js', import.meta.url), 'utf8');
  const eventsSource = await readFile(new URL('../../../public/app/events.js', import.meta.url), 'utf8');
  assert.doesNotMatch(clientSource, /read_dropped_file|readDroppedFile|allowedText|\.markdown|image\//i);
  assert.match(eventsSource, /\['md', 'markdown', 'txt'\]/);
  assert.match(eventsSource, /\['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'\]/);
  assert.match(eventsSource, /call\('files', 'readText'/);
  assert.match(eventsSource, /call\('files', 'readImage'/);
});

test('Stage 3 verification keeps Atomic Task 3.6 after window and before later adapters', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/stage-03-atomic.yml', import.meta.url),
    'utf8'
  );
  const windowIndex = workflow.indexOf('Verify Atomic Task 3.5 window client');
  const dragDropIndex = workflow.indexOf('Verify Atomic Task 3.6 drag-drop client');
  const fileSystemIndex = workflow.indexOf('Verify Atomic Task 3.7 file-system client');
  const documentStoreIndex = workflow.indexOf('Verify Atomic Task 3.8 document-store client');
  const webLinkLogIndex = workflow.indexOf('Verify Atomic Task 3.9 web link log clients');
  const browserIndex = workflow.indexOf('Verify Atomic Task 3.10 browser adapters');
  const createPlatformIndex = workflow.indexOf('Verify Atomic Task 3.11 createPlatform');
  const cutoverIndex = workflow.indexOf('Verify Atomic Task 3.12 final Platform cutover');
  const architectureIndex = workflow.indexOf('Run architecture hard gate');
  assert.ok(windowIndex >= 0 && dragDropIndex > windowIndex && fileSystemIndex > dragDropIndex && documentStoreIndex > fileSystemIndex && webLinkLogIndex > documentStoreIndex && browserIndex > webLinkLogIndex && createPlatformIndex > browserIndex && cutoverIndex > createPlatformIndex && architectureIndex > cutoverIndex);
  assert.match(workflow, /node --test tests\/unit\/platform\/drag-drop-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/file-system-client\.test\.mjs/);
  assert.match(workflow, /node --test tests\/unit\/platform\/document-store-client\.test\.mjs/);
  assert.match(workflow, /03-12-architecture-scan\.json/);
  assert.match(workflow, /Verify Atomic Task 3\.12 final Platform cutover/);
});
