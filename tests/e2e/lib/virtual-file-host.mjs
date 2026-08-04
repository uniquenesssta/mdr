import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf']
]);

function safePath(root, pathname) {
  const decoded = decodeURIComponent(pathname || '/');
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = resolve(root, relative || 'index.html');
  const normalizedRoot = resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) return null;
  return candidate;
}

export async function installVirtualFileHost(page, options = {}) {
  const root = resolve(options.root || process.cwd());
  const origin = new URL(options.origin || 'https://markdown-editor.test');
  const hostname = origin.hostname;
  const errors = [];

  const unsubscribe = page.connection.on('Fetch.requestPaused', event => {
    void (async () => {
      const requestId = event.requestId;
      try {
        const url = new URL(event.request.url);
        if (url.hostname !== hostname) {
          await page.connection.send('Fetch.continueRequest', { requestId });
          return;
        }
        let filePath = safePath(root, url.pathname);
        if (!filePath) {
          await page.connection.send('Fetch.fulfillRequest', { requestId, responseCode: 403, body: Buffer.from('Forbidden').toString('base64') });
          return;
        }
        let info;
        try {
          info = await stat(filePath);
        } catch (_) {
          await page.connection.send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: Buffer.from('Not found').toString('base64') });
          return;
        }
        if (info.isDirectory()) {
          filePath = join(filePath, 'index.html');
          info = await stat(filePath);
        }
        const body = await readFile(filePath);
        await page.connection.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream' },
            { name: 'Cache-Control', value: 'no-store, max-age=0' },
            { name: 'Access-Control-Allow-Origin', value: '*' }
          ],
          body: body.toString('base64')
        });
      } catch (error) {
        errors.push(error);
        try {
          await page.connection.send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
        } catch (_) {}
      }
    })();
  });

  await page.connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return {
    root,
    origin: origin.origin,
    errors,
    async close() {
      unsubscribe();
      try { await page.connection.send('Fetch.disable'); } catch (_) {}
    }
  };
}
