import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { launchChromium } from './lib/cdp-browser.mjs';

const source = await readFile(new URL('../../src/features/import/web-clipper/web-fetch-coordinator.js', import.meta.url), 'utf8');
const html = '<article>真实 HTTP 中文 ' + 'content '.repeat(30) + '</article>';
let slowSeen, slowClosed;
const seen = new Promise(resolve => { slowSeen = resolve; });
const closed = new Promise(resolve => { slowClosed = resolve; });
const requests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://owned.test').pathname;
  requests.push(path);
  if (path === '/coordinator.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(source);
  } else if (path === '/local') {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ success: true, html }));
  } else if (path === '/raw') {
    response.writeHead(503); response.end('owned failure');
  } else if (path === '/json') {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ contents: html }));
  } else if (path === '/slow') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"html":"');
    response.on('close', slowClosed); slowSeen();
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Owned web-fetch test</title>');
  }
});
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned HTTP event missing')), 5000); })]); }
  finally { clearTimeout(timer); }
};
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await launchChromium();
  await browser.page.navigate(origin);
  await browser.page.waitFor(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`);
  const results = await browser.page.evaluate(`(async () => {
    const { createWebFetchCoordinator } = await import('/coordinator.js');
    const coordinator = createWebFetchCoordinator({ browserFetch: (url, options) => {
      if (url.startsWith('https://api.allorigins.win/raw')) return fetch('/raw', options);
      if (url.startsWith('https://api.allorigins.win/get')) return fetch('/json', options);
      if (url.startsWith('https://')) throw new Error('External network is forbidden in this test');
      return fetch(url, options);
    } });
    window.ownedCoordinator = coordinator;
    const local = await coordinator.fetchUrl('https://example.test/article', { useLocalProxy: true, proxyUrl: location.origin + '/local' });
    const fallback = await coordinator.fetchUrl('https://example.test/article');
    window.ownedPending = coordinator.fetchUrl('https://example.test/slow', { useLocalProxy: true, proxyUrl: location.origin + '/slow' });
    return { local, fallback };
  })()`);
  assert.equal(results.local.html, html); assert.equal(results.local.source, 'local-proxy');
  assert.equal(results.fallback.html, html); assert.equal(results.fallback.source, 'public-proxy');
  assert.deepEqual(requests.filter(path => ['/raw', '/json'].includes(path)), ['/raw', '/json']);
  await bounded(seen);
  const cancelled = await browser.page.evaluate(`(async () => {
    const manual = ownedCoordinator.manualHtml('<p>manual</p>');
    const cancelled = await ownedPending;
    ownedCoordinator.destroy();
    return { manual, cancelled };
  })()`);
  assert.equal(cancelled.manual.html, '<p>manual</p>');
  assert.equal(cancelled.cancelled.status, 'cancelled');
  await bounded(closed);
  console.log('ok - R13.9 actual browser HTTP local/ordered fallback and body cancellation observed by owned server');
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
