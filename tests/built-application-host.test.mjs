import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBuiltApplicationHost } from './e2e/lib/built-application-host.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'built-app-host-'));
  let host;
  try {
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
    await writeFile(join(dist, 'assets/app.js'), "new Worker(new URL('./preview-worker.js', import.meta.url), {type:'module'});");
    await writeFile(join(dist, 'assets/preview-worker.js'), 'self.onmessage=()=>{};');
    await writeFile(join(root, 'outside.js'), 'outside root');
    host = await startBuiltApplicationHost(dist);
    await run(host);
  } finally {
    await host?.close();
    await rm(join(root, 'dist/assets/preview-worker.js'), { force: true });
    await rm(join(root, 'dist/assets/app.js'), { force: true });
    await rm(join(root, 'dist/index.html'), { force: true });
    await rm(join(root, 'outside.js'), { force: true });
  }
}

test('built app HTTP host serves native page, module and Worker bytes from one loopback origin', () => fixture(async host => {
  assert.match(host.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const [path, type, content] of [
    ['/?e2e=1', 'text/html; charset=utf-8', '<script type="module" src="/assets/app.js"></script>'],
    ['/assets/app.js', 'text/javascript; charset=utf-8', "new Worker(new URL('./preview-worker.js', import.meta.url), {type:'module'});"],
    ['/assets/preview-worker.js', 'text/javascript; charset=utf-8', 'self.onmessage=()=>{};']
  ]) {
    const response = await fetch(host.origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.equal(await response.text(), content);
  }
  assert.equal(host.requests.length, 3);
  assert.ok(host.requests.every(x => x.status === 200));
}));

test('built app HTTP host rejects traversal, malformed paths, missing files and unsupported methods', () => fixture(async host => {
  for (const [path, options, expected] of [
    ['/%2e%2e%2foutside.js', {}, 403], ['/%zz', {}, 400],
    ['/assets/missing.js', {}, 404], ['/assets/app.js', { method: 'POST' }, 405]
  ]) {
    const response = await fetch(host.origin + path, options);
    assert.equal(response.status, expected);
    assert.equal((await response.text()).includes('outside root'), false);
  }
}));

test('built app HTTP host supports HEAD and releases its listening port idempotently', () => fixture(async host => {
  const response = await fetch(host.origin + '/assets/preview-worker.js', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  await host.close();
  await host.close();
  await assert.rejects(fetch(host.origin));
}));

function portServer(allocate) {
  const closed = []; let port;
  return { closed, server: {
    once() {}, removeListener() {},
    listen(_port, _address, ready) { port = allocate(); ready(); },
    address: () => ({ port }),
    close(done) { closed.push(port); done(); }, closeAllConnections() {}
  } };
}

test('built app HTTP host closes restricted allocations before retaining a browser-compatible listening port', async () => {
  const ports = [10080, 6679, 6680], probe = portServer(() => ports.shift());
  const host = await startBuiltApplicationHost('.', { createServerImpl: () => probe.server });
  assert.equal(host.origin, 'http://127.0.0.1:6680'); assert.deepEqual(probe.closed, [10080, 6679]);
  await host.close(); await host.close(); assert.deepEqual(probe.closed, [10080, 6679, 6680]);
});

test('built app HTTP host fails bounded allocation with every rejected socket closed', async () => {
  const probe = portServer(() => 10080);
  await assert.rejects(startBuiltApplicationHost('.', { createServerImpl: () => probe.server }), /after 32 attempts/);
  assert.equal(probe.closed.length, 32); assert.ok(probe.closed.every(port => port === 10080));
});
