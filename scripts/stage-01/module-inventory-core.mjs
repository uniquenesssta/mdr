import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const PRODUCTION_EXTENSIONS = new Set(['.js', '.css', '.html', '.rs']);
const ROOT_FILES = new Set(['index.html', 'vite.config.js', 'src-tauri/build.rs']);
const ROOT_DIRECTORIES = ['public', 'src', 'src-tauri/src'];

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function collectDirectoryFiles(root, directory, output) {
  const absolute = resolve(root, directory);
  if (!await pathExists(absolute)) return;
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      await collectDirectoryFiles(root, normalizePath(relative(root, child)), output);
      continue;
    }
    const repositoryPath = normalizePath(relative(root, child));
    if (PRODUCTION_EXTENSIONS.has(extname(repositoryPath))) output.push(repositoryPath);
  }
}

export function normalizeOwnershipManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.modules)) throw new TypeError('A module manifest is required.');
  if (!Array.isArray(manifest.fields)) return manifest;
  const fields = manifest.fields;
  return {
    ...manifest,
    modules: manifest.modules.map((values, index) => {
      if (!Array.isArray(values) || values.length !== fields.length) {
        throw new Error(`Invalid compact module record at index ${index}.`);
      }
      return Object.fromEntries(fields.map((field, fieldIndex) => [field, values[fieldIndex]]));
    })
  };
}

export async function discoverProductionFiles(root = process.cwd()) {
  const files = [];
  for (const file of ROOT_FILES) {
    if (await pathExists(resolve(root, file))) files.push(file);
  }
  for (const directory of ROOT_DIRECTORIES) {
    await collectDirectoryFiles(root, directory, files);
  }
  return files.sort();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function collectMatches(source, expression, mapper = match => match[1]) {
  const values = [];
  for (const match of source.matchAll(expression)) values.push(mapper(match));
  return uniqueSorted(values);
}

function analyzeJavaScript(source) {
  const staticImports = collectMatches(
    source,
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  );
  const dynamicImports = collectMatches(source, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g);
  const declaredExports = collectMatches(
    source,
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  );
  const exportLists = collectMatches(source, /\bexport\s*\{([^}]+)\}/g, match => (
    match[1].split(',').map(item => item.trim().split(/\s+as\s+/i).at(-1)).filter(Boolean)
  )).flat();
  const listeners = collectMatches(
    source,
    /([A-Za-z_$][\w$.[\]()?]*)\.addEventListener\(\s*['"]([^'"]+)['"]/g,
    match => `${match[1]}:${match[2]}`
  );
  const globalWrites = collectMatches(
    source,
    /\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/g
  );
  const timers = collectMatches(source, /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/g);
  const observers = collectMatches(source, /\bnew\s+(MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/g);
  const workers = collectMatches(source, /\bnew\s+(Worker|SharedWorker)\s*\(/g);
  const tauriCommands = collectMatches(source, /\binvoke\(\s*['"]([^'"]+)['"]/g);
  return {
    imports: uniqueSorted([...staticImports, ...dynamicImports]),
    exports: uniqueSorted([...declaredExports, ...exportLists]),
    listeners,
    globalWrites,
    sideEffects: {
      domAccess: /\b(?:document|window)\.|\bquerySelector\s*\(|\bgetElementById\s*\(/.test(source),
      storageAccess: /\b(?:localStorage|sessionStorage)\b/.test(source),
      networkAccess: /\bfetch\s*\(/.test(source),
      timers,
      observers,
      workers,
      tauriCommands
    }
  };
}

function analyzeRust(source) {
  return {
    imports: collectMatches(source, /^\s*(?:use|mod)\s+([^;{]+)[;{]/gm),
    exports: collectMatches(
      source,
      /^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([A-Za-z_][\w]*)/gm
    ),
    listeners: [],
    globalWrites: collectMatches(source, /^\s*(?:pub\s+)?static\s+(?:mut\s+)?([A-Za-z_][\w]*)/gm),
    sideEffects: {
      tauriCommands: collectMatches(
        source,
        /#\[tauri::command(?:\([^\]]*\))?\][\s\S]{0,240}?\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/g
      ),
      fileSystem: /\b(?:std::fs|tokio::fs|File::|OpenOptions::)/.test(source),
      networkAccess: /\b(?:reqwest|ureq|TcpStream|Url::)/.test(source),
      processAccess: /\b(?:std::process|Command::)/.test(source),
      synchronization: /\b(?:Mutex|RwLock|Atomic[A-Za-z0-9_]*)\b/.test(source)
    }
  };
}

function analyzeHtml(source) {
  return {
    imports: collectMatches(source, /<script\b[^>]*\bsrc=['"]([^'"]+)['"][^>]*>/gi),
    exports: [],
    listeners: collectMatches(source, /\s(on[a-z]+)\s*=\s*['"]/gi),
    globalWrites: [],
    sideEffects: {
      inlineEventAttributes: collectMatches(source, /\s(on[a-z]+)\s*=\s*['"]/gi),
      classicScripts: collectMatches(
        source,
        /<script\b(?![^>]*\btype=['"]module['"])[^>]*\bsrc=['"]([^'"]+)['"][^>]*>/gi
      ),
      moduleScripts: collectMatches(
        source,
        /<script\b[^>]*\btype=['"]module['"][^>]*\bsrc=['"]([^'"]+)['"][^>]*>/gi
      )
    }
  };
}

function analyzeCss(source) {
  const ruleCount = (source.match(/(^|})\s*[^@{}][^{}]*\{/gm) || []).length;
  return {
    imports: collectMatches(source, /@import\s+(?:url\()?['"]?([^'"\s)]+)['"]?\)?/g),
    exports: [],
    listeners: [],
    globalWrites: [],
    sideEffects: {
      ruleCount,
      customProperties: collectMatches(source, /(--[A-Za-z0-9_-]+)\s*:/g)
    }
  };
}

export function analyzeProductionSource(path, source) {
  if (path.endsWith('.js')) return analyzeJavaScript(source);
  if (path.endsWith('.rs')) return analyzeRust(source);
  if (path.endsWith('.html')) return analyzeHtml(source);
  if (path.endsWith('.css')) return analyzeCss(source);
  throw new Error(`Unsupported production source: ${path}`);
}

export async function buildModuleInventory({ root = process.cwd(), manifest }) {
  const normalizedManifest = normalizeOwnershipManifest(manifest);
  const discovered = await discoverProductionFiles(root);
  const ownershipByPath = new Map(normalizedManifest.modules.map(record => [record.path, record]));
  const modules = [];
  for (const path of discovered) {
    const ownership = ownershipByPath.get(path);
    if (!ownership) throw new Error(`Production module is not classified: ${path}`);
    const source = await readFile(resolve(root, path), 'utf8');
    modules.push({
      ...ownership,
      bytes: Buffer.byteLength(source),
      lines: source.split(/\r?\n/).length,
      sha256: createHash('sha256').update(source).digest('hex'),
      detected: analyzeProductionSource(path, source)
    });
  }
  return {
    schemaVersion: normalizedManifest.schemaVersion,
    generatedAt: new Date().toISOString(),
    baseline: normalizedManifest.baseline,
    moduleCount: modules.length,
    modules
  };
}
