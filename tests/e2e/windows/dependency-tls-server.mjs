// Test-owned loopback TLS 1.3 server. The checked-in fixture key is public test data.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';

if (process.platform !== 'win32') throw new Error('R12-23 TLS behavior is verified on Windows only.');
const server = createServer({
  key: await readFile(new URL('../../fixtures/dependency-tls/server-key.pem', import.meta.url)),
  cert: await readFile(new URL('../../fixtures/dependency-tls/server-cert.pem', import.meta.url)),
  minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3'
}, (request, response) => {
  if (request.url !== '/owned') { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('R12-23 owned TLS 1.3 中文🙂');
});
server.on('tlsClientError', (_error, socket) => socket.destroy());
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\n'));
