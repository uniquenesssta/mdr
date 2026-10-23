import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const BUILD_FINGERPRINT_FILE = 'mdr-build-fingerprint.json';
const ROOT_INPUTS = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js'];
const INPUT_DIRECTORIES = ['src', 'public', 'scripts/build'];
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export const fingerprintEntries = files => hashBytes(JSON.stringify(files));

// Paths are portable manifest keys, never absolute paths or filesystem aliases.
export function assertFingerprintEntries(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Empty fingerprint entries');
  let prior = '';
  const names = new Set();
  for (const entry of files) {
    const path = entry?.path;
    if (typeof path !== 'string' || /[\\:\x00-\x1f]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || path <= prior || names.has(path.toLowerCase())) {
      throw new Error('Invalid fingerprint entry');
    }
    names.add(path.toLowerCase()); prior = path;
  }
}

export async function fingerprintFiles(root, paths) {
  const entries = [];
  for (const path of [...paths].sort()) {
    const file = resolve(root, path);
    if (!(await lstat(file)).isFile()) throw new Error('Expected regular file: ' + path);
    entries.push({ path, sha256: hashBytes(await readFile(file)) });
  }
  assertFingerprintEntries(entries);
  return entries;
}

export async function createSourceFingerprint(root) {
  const paths = [...ROOT_INPUTS];
  async function visit(path) {
    const stat = await lstat(resolve(root, path));
    if (stat.isFile()) { paths.push(path); return; }
    if (!stat.isDirectory()) throw new Error('Unsupported source entry: ' + path);
    for (const name of (await readdir(resolve(root, path))).sort()) await visit(path + '/' + name);
  }
  for (const path of INPUT_DIRECTORIES) await visit(path);
  const files = await fingerprintFiles(root, paths);
  return { sha256: fingerprintEntries(files), files };
}
