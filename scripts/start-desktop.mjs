import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cli = resolve(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');

// Bind the socket before starting Tauri: no probe/release race and no need to
// terminate or trust an unrelated service on the project's usual dev port.
const server = await createServer({
  root,
  configLoader: 'native',
  server: { host: '127.0.0.1', port: 16663, strictPort: false, open: false }
});

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No frontend TCP address.');
  const devUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[MDR] Frontend: ${devUrl}`);
  const child = spawn(process.execPath, [cli, 'dev', '--config', JSON.stringify({
    build: { beforeDevCommand: '', devUrl }
  })], { cwd: root, stdio: 'inherit' });
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
} finally {
  await server.close();
}
