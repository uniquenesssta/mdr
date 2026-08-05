import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'artifacts', 'dist', 'target'
]);

export function normalizePath(value) {
  return String(value || '').split(sep).join('/').replace(/^\.\//, '');
}

export function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function walkDirectory(root, directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, output);
    } else if (entry.isFile()) {
      output.push(normalizePath(relative(root, absolutePath)));
    }
  }
}

export async function listRepositoryFiles(root = process.cwd()) {
  const git = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (git.status === 0 && git.stdout) {
    return git.stdout.split('\0').filter(Boolean).map(normalizePath).sort();
  }

  const output = [];
  await walkDirectory(root, root, output);
  return output.sort();
}

export async function readRepositoryText(root, repositoryPath) {
  return readFile(resolve(root, repositoryPath), 'utf8');
}

export async function readRepositoryJson(root, repositoryPath) {
  return JSON.parse(await readRepositoryText(root, repositoryPath));
}

export function normalizeOwnershipManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.modules)) {
    throw new TypeError('Architecture verification requires a production module manifest.');
  }
  if (!Array.isArray(manifest.fields)) return manifest;
  return {
    ...manifest,
    modules: manifest.modules.map((values, index) => {
      if (!Array.isArray(values) || values.length !== manifest.fields.length) {
        throw new Error(`Invalid compact production module record at index ${index}.`);
      }
      return Object.fromEntries(
        manifest.fields.map((field, fieldIndex) => [field, values[fieldIndex]])
      );
    })
  };
}

export async function loadOwnershipManifest(root = process.cwd()) {
  const raw = await readRepositoryJson(
    root,
    'tests/architecture/fixtures/production-modules.json'
  );
  return normalizeOwnershipManifest(raw);
}

export async function loadArchitectureBaseline(
  root = process.cwd(),
  baselinePath = 'tests/architecture/fixtures/architecture-baseline.json'
) {
  return readRepositoryJson(root, baselinePath);
}

export function getLineAndColumn(source, index) {
  const safeIndex = Math.max(0, Math.min(String(source).length, Number(index) || 0));
  const before = String(source).slice(0, safeIndex);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function getGitHead(root = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export async function resolveRelativeModule(root, importerPath, specifier, knownModules) {
  if (!String(specifier).startsWith('.')) return null;
  const base = normalizePath(join(dirname(importerPath), specifier));
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`, `${base}/index.mjs`];
  for (const candidate of candidates) {
    if (knownModules?.has(candidate)) return candidate;
    if (await pathExists(resolve(root, candidate))) return candidate;
  }
  return null;
}

export async function repositoryFileRecord(root, path) {
  const absolutePath = resolve(root, path);
  const metadata = await stat(absolutePath);
  const content = await readFile(absolutePath, 'utf8');
  return {
    path: normalizePath(path),
    bytes: metadata.size,
    lines: content.split(/\r?\n/).length,
    sha256: hashText(content),
    content
  };
}
