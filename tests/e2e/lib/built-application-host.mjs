import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { isFetchCompatiblePort } from './cdp-browser.mjs';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf']
]);

// Serve actual dist bytes to the page and its Worker from the same native origin.
// CDP page-only interception cannot serve a separate Worker target.
export async function startBuiltApplicationHost(root, { createServerImpl = createServer } = {}) {
  const directory = resolve(root), requests = [];
  const server = createServerImpl(async (request, response) => {
    const record = { url: request.url, method: request.method, status: null };
    requests.push(record);
    const send = (status, content, type = 'text/plain; charset=utf-8') => {
      record.status = status;
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    };
    if (!['GET', 'HEAD'].includes(request.method)) { send(405, 'Method not allowed'); return; }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { send(400, 'Bad request'); return; }
    const file = resolve(directory, path === '/' ? 'index.html' : '.' + path);
    if (file !== directory && !file.startsWith(directory + sep)) { send(403, 'Forbidden'); return; }
    try { send(200, await readFile(file), mimeTypes.get(extname(file).toLowerCase()) || 'application/octet-stream'); }
    catch (error) { send(['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500, 'Unable to read asset'); }
  });
  let port;
  for (let attempt = 0; attempt < 32; attempt++) {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolveListen(); });
    });
    port = server.address()?.port;
    if (isFetchCompatiblePort(port)) break;
    await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    port = null;
  }
  if (!port) throw new Error('No browser-compatible application HTTP port was allocated after 32 attempts.');
  let closed = false;
  return {
    origin: 'http://127.0.0.1:' + port,
    requests,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolveClose, reject) => {
        server.close(error => error ? reject(error) : resolveClose());
        server.closeAllConnections();
      });
    }
  };
}
