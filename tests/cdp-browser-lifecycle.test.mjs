import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { CdpConnection, CdpPage, waitForJson, recoverChromiumStartup, getFreePort } from './e2e/lib/cdp-browser.mjs';

test('CDP navigation reports the actual browser failure before evaluating an error page', async () => {
  const methods = [], page = new CdpPage({ send: async method => { methods.push(method); return { errorText: 'net::ERR_UNSAFE_PORT' }; } });
  await assert.rejects(page.navigate('http://127.0.0.1:10080/'), /net::ERR_UNSAFE_PORT; url=http:\/\/127\.0\.0\.1:10080\//);
  assert.deepEqual(methods, ['Page.navigate']);
});

test('an unanswered CDP cleanup command rejects and releases its pending entry', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 20 });
  connection.socket = { readyState: WebSocket.OPEN, send() {}, close() {} };
  await assert.rejects(connection.send('Fetch.disable'), /Fetch.disable: CDP response timed out/);
  assert.equal(connection.pending.size, 0);
  connection.close();
});

test('explicit CDP close rejects in-flight commands without waiting for the socket event', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 10000 });
  let closed = 0;
  connection.socket = { readyState: WebSocket.OPEN, send() {}, close() { closed++; } };
  const rejected = assert.rejects(connection.send('Runtime.evaluate'), /CDP connection closed/);
  connection.close();
  await rejected;
  assert.equal(connection.pending.size, 0);
  assert.equal(connection.listeners.size, 0);
  assert.equal(closed, 1);
});

test('a synchronous socket send failure does not leave a timeout or pending command', async () => {
  const connection = new CdpConnection('unused', { commandTimeoutMs: 10000 });
  connection.socket = { readyState: WebSocket.OPEN, send() { throw new Error('socket failed'); }, close() {} };
  await assert.rejects(connection.send('Fetch.disable'), /socket failed/);
  assert.equal(connection.pending.size, 0);
  connection.close();
});


test('CDP readiness aborts an unresponsive HTTP probe within its total deadline', async () => {
  let aborted = false;
  await assert.rejects(waitForJson('http://127.0.0.1:1/json/list', 100, {
    fetch: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('probe aborted')); }, { once: true });
    })
  }), /CDP endpoint did not become ready: probe aborted/);
  assert.equal(aborted, true);
});

test('CDP startup reports an exited process before attempting another connection', async () => {
  let requested = false;
  await assert.rejects(waitForJson('unused', 30000, {
    checkProcess() { throw new Error('Chromium exited before CDP readiness: code=1'); },
    fetch: async () => { requested = true; }
  }), /Chromium exited.*code=1/);
  assert.equal(requested, false);
});

test('CDP startup keeps the connection error cause and successful target JSON', async () => {
  await assert.rejects(waitForJson('owned-endpoint', 100, {
    fetch: async () => { throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }
  }), error => {
    assert.match(error.message, /endpoint=owned-endpoint; cause=ECONNREFUSED/);
    assert.equal(error.cause.cause.code, 'ECONNREFUSED');
    return true;
  });
  const targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://owned' }];
  assert.equal(await waitForJson('owned-endpoint', 1000, {
    fetch: async () => ({ ok: true, json: async () => targets })
  }), targets);
});


test('a cleaned refused startup gets exactly one fresh launch and visible diagnostics', async () => {
  let attempts = 0;
  const reports = [];
  const browser = { page: {} };
  const failed = Object.assign(new Error('owned process cleaned; ECONNREFUSED'), {
    code: 'CDP_STARTUP_REFUSED_CLEANED'
  });
  assert.equal(await recoverChromiumStartup(async () => {
    if (++attempts === 1) throw failed;
    return browser;
  }, message => reports.push(message)), browser);
  assert.equal(attempts, 2);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /ECONNREFUSED/);
});

test('startup recovery preserves both failures and never starts a third process', async () => {
  let attempts = 0;
  const failures = [1, 2].map(n => Object.assign(new Error(`startup ${n}`), {
    code: 'CDP_STARTUP_REFUSED_CLEANED'
  }));
  await assert.rejects(recoverChromiumStartup(async () => {
    throw failures[attempts++];
  }, () => {}), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, failures);
    assert.match(error.message, /startup 1[\s\S]*startup 2/);
    return true;
  });
  assert.equal(attempts, 2);
});

test('ordinary startup errors, cleanup failures and test assertions are not retried', async () => {
  for (const failure of [new Error('Cleanup: process still alive'),
    new Error('No page target'), new assert.AssertionError({ message: 'drag assertion' })]) {
    let attempts = 0;
    await assert.rejects(recoverChromiumStartup(async () => {
      attempts++;
      throw failure;
    }, () => assert.fail('unexpected recovery')), error => error === failure);
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  const browser = await recoverChromiumStartup(async () => {
    attempts++;
    return { page: { evaluate() { throw new Error('test body failed'); } } };
  }, () => assert.fail('unexpected recovery'));
  assert.throws(() => browser.page.evaluate(), /test body failed/);
  assert.equal(attempts, 1);
});

test('R16-02 CDP discards blocked OS ports and closes every reservation before selecting a usable one', async () => {
  const ports = [6679, 10080, 6680], closed = [];
  const port = await getFreePort({ createServerImpl() {
    const selected = ports.shift();
    return { once() {}, listen(_port, _host, ready) { ready(); }, address: () => ({ port: selected }), close(done) { closed.push(selected); done(); } };
  } });
  assert.equal(port, 6680); assert.deepEqual(closed, [6679, 10080, 6680]);
});

test('R16-02 repeated unusable port allocation fails within its bound without launching a browser', async () => {
  let closed = 0;
  await assert.rejects(getFreePort({ createServerImpl: () => ({ once() {}, listen(_port, _host, ready) { ready(); },
    address: () => ({ port: 6679 }), close(done) { closed++; done(); } }) }), /after 32 attempts/);
  assert.equal(closed, 32);
});

test('R16-02 an actual allocated CDP port accepts HTTP Fetch and JSON readiness', async () => {
  const port = await getFreePort(), server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.end('{"ready":true}');
  });
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try { assert.deepEqual(await waitForJson(`http://127.0.0.1:${port}/json/list`), { ready: true }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
