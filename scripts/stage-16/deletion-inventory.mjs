// R16-01 owns a read-only, conservative deletion-evidence snapshot. No delete API.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectModuleSpecifiers, collectDynamicClassicScripts } from '../architecture/source-analysis.mjs';
import { normalizeOwnershipManifest, analyzeProductionSource } from '../stage-01/module-inventory-core.mjs';

const REPORT = 'docs/audit/r16-01-deletion-inventory.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const listed = root => git(root, ['ls-files', '-z']).split('\0').filter(Boolean).sort();
const fixedPaths = [
  'public/i18n.js', 'public/app/core.js', 'public/app/bootstrap.js', 'public/app/preview.js', 'public/app/export.js',
  'public/app/editor-tools.js', 'public/app/web-clipper.js', 'public/app/events.js', 'public/app/scroll-sync.js',
  'public/compatibility/business-content.html', 'src/ui/compatibility/business-content-port.js',
  'src/ui/compatibility/mount-modal-shells.js', 'src/ui/compatibility/index.js',
  ...['tauri', 'performance', 'e2e-bridge', 'link-preview', 'task-scheduler', 'vendor'].map(name => 'src/runtime/' + name + '.js'),
  'src/styles/main.css', 'src/editor/virtual-editor.js', 'src/editor/precise-pointer-selection.js', 'src/editor/hybrid-markdown.js',
  ...['widgets', 'inline-presentation', 'controller', 'component-state', 'double-activation', 'image-source',
    'widget-lifecycle', 'code-highlighter', 'code-presentation'].map(name => 'src/editor/hybrid/' + name + '.js'),
  ...['preview-worker-client', 'preview-worker', 'virtual-preview', 'enhancement-queue'].map(name => 'src/preview/' + name + '.js'),
  'src/storage/native-document-store.js', 'src/sidebar/folder-file-tree.js', 'src/sync/scroll-controller.js', 'src/sync/selection-controller.js',
  ...['document_store', 'external_link', 'local_file', 'performance_log', 'web_fetch'].map(name => 'src-tauri/src/' + name + '.rs')
];
function followup(path) {
  if (path.startsWith('public/app/') || path === 'public/i18n.js') return 'R16-02';
  if (path === 'src/styles/main.css') return 'R16-05';
  if (path.startsWith('src/runtime/')) return 'R16-07';
  if (path.startsWith('.vite/') || path.startsWith('logs/')) return 'R16-09';
  if (path.includes('/compatibility/') || posix.basename(path).startsWith('classic-')) return 'R16-08';
  return 'R16-06';
}
const audited = path => /^(?:src|public|tests|scripts|src-tauri|\.github|\.cargo)\//.test(path)
  || ['index.html', 'vite.config.js', 'package.json', 'package-lock.json', '.gitignore'].includes(path)
  || path.startsWith('.vite/');
function surface(path) {
  if (['tests/architecture/fixtures/production-modules.json', 'tests/architecture/fixtures/architecture-baseline.json'].includes(path)) return 'governance';
  if (path.startsWith('tests/') || path.startsWith('src-tauri/tests/')) return 'tests';
  if (/^(?:scripts|\.github|\.cargo|\.vite)\//.test(path) || /^(?:vite\.config\.js|package.*\.json|\.gitignore)$/.test(path)) return 'build';
  if (path.startsWith('src-tauri/')) return 'rust';
  return 'production';
}

export async function buildDeletionInventory({ root = process.cwd(), baselineCommit }) {
  if (!/^[a-f0-9]{40}$/.test(baselineCommit || '')) throw new Error('R16-01 requires an explicit 40-character baseline commit.');
  const paths = listed(root), known = new Set(paths), sources = new Map(), snapshot = [];
  for (const path of paths.filter(audited)) {
    const bytes = await readFile(resolve(root, path));
    snapshot.push({ path, sha256: sha256(bytes) });
    if (/\.(?:js|mjs|cjs|html|css|rs|json|toml|yml|yaml|sh|ps1)$/.test(path)) sources.set(path, bytes.toString('utf8'));
  }
  const manifest = normalizeOwnershipManifest(JSON.parse(await readFile(resolve(root, 'tests/architecture/fixtures/production-modules.json'), 'utf8')));
  const ownership = new Map(manifest.modules.map(entry => [entry.path, entry]));
  const protectedPaths = new Set(manifest.modules.filter(entry => entry.frozen).map(entry => entry.path));
  protectedPaths.add('src/model-kernel/index.js');
  const candidates = new Set(fixedPaths);
  for (const path of paths) {
    if (/^(?:public\/app\/|src\/runtime\/|src\/editor\/|src\/preview\/|src\/rendering\/|src\/storage\/|\.vite\/|logs\/)/.test(path)
      || (/^(?:src|public)\//.test(path) && (path.includes('/compatibility/') || posix.basename(path).startsWith('classic-')))) candidates.add(path);
  }
  // The original log paths stay visible as already-retired candidates, not local inputs.
  const architecture = JSON.parse(await readFile(resolve(root, 'tests/architecture/fixtures/architecture-baseline.json'), 'utf8'));
  for (const log of architecture.auditCorrections?.r15RuntimeLogRetirement?.removedTrackedGeneratedFiles || []) candidates.add(log.path);
  const references = new Map(), rustModules = [], uncertainties = [];
  const lineAt = (text, index) => text.slice(0, index).split('\n').length;
  const targetsFor = (from, value) => {
    if (typeof value !== 'string' || value.includes('${') || /^(?:https?:|data:|node:)/.test(value)) return [];
    const clean = value.replace(/[?#].*$/, '');
    let base;
    if (clean.startsWith('/app/') || clean === '/i18n.js') base = 'public' + clean;
    else if (clean.startsWith('/')) base = clean.slice(1);
    else if (clean.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), clean));
    else base = clean;
    return [base, base + '.js', base + '.mjs', base + '/index.js', base + '/index.mjs'].filter(path => candidates.has(path));
  };
  const add = (from, target, kind, line) => {
    if (!candidates.has(target)) return;
    const key = from + '\0' + target + '\0' + line;
    if (!references.has(key)) references.set(key, { from, target, surface: surface(from), kind, line });
  };
  for (const [from, text] of sources) {
    // Governance source is hashed for drift, but its candidate strings are not application uses.
    if (from.startsWith('scripts/stage-16/') || from === 'tests/stage-16-deletion-inventory.test.mjs') continue;
    if (/\.(?:js|mjs|cjs)$/.test(from)) {
      for (const spec of collectModuleSpecifiers(text)) for (const target of targetsFor(from, spec.specifier)) add(from, target, 'module', spec.line);
      for (const script of collectDynamicClassicScripts(from, text)) add(from, script.script, 'classic-script', script.line);
      for (const match of text.matchAll(/\bimport\s*\(\s*(?![\s'"`])[^)]/g)) uncertainties.push({ from, line: lineAt(text, match.index), kind: 'computed-import' });
    }
    if (from.endsWith('.html')) for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/g)) {
      for (const target of targetsFor(from, match[2])) add(from, target, 'html-resource', lineAt(text, match.index));
    }
    if (from.endsWith('.rs')) {
      const moduleDirectory = /\/(?:main|lib|mod)\.rs$/.test(from) ? posix.dirname(from) : from.slice(0, -3);
      for (const match of text.matchAll(/(?:#\[path\s*=\s*"([^"]+)"\]\s*)?(?:pub(?:\([^)]*\))?\s+)?\bmod\s+(\w+)\s*;/g)) {
        const options = match[1] ? [posix.normalize(posix.join(posix.dirname(from), match[1]))]
          : [moduleDirectory + '/' + match[2] + '.rs', moduleDirectory + '/' + match[2] + '/mod.rs'];
        const target = options.find(path => known.has(path)) || null, line = lineAt(text, match.index);
        rustModules.push({ from, line, module: match[2], target });
        if (target) add(from, target, match[1] ? 'rust-path' : 'rust-mod', line);
        else uncertainties.push({ from, line, kind: 'unresolved-rust-mod' });
      }
      for (const match of text.matchAll(/\binclude(?:_str|_bytes)?!\(\s*"([^"]+)"\s*\)/g)) {
        const target = posix.normalize(posix.join(posix.dirname(from), match[1]));
        add(from, target, 'rust-include', lineAt(text, match.index));
      }
      if (/\binclude(?:_str|_bytes)?!\(\s*(?![\s"])/.test(text)) uncertainties.push({ from, line: 1, kind: 'computed-rust-include' });
    }
    for (const match of text.matchAll(/(['"`])([^'"`\r\n]{1,300})\1/g)) {
      for (const target of targetsFor(from, match[2])) add(from, target, 'path-literal', lineAt(text, match.index));
    }
  }
  // This project's unchanged Vite build copies public/. Removing an import alone is insufficient.
  for (const path of paths.filter(path => path.startsWith('public/'))) add('vite.config.js', path, 'public-copy', null);
  const snapshotByPath = new Map(snapshot.map(entry => [entry.path, entry.sha256]));
  const orderedReferences = [...references.values()].sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const entries = [...candidates].sort().map(path => {
    const refs = orderedReferences.filter(entry => entry.target === path), source = sources.get(path), owner = ownership.get(path);
    const consumers = refs.filter(entry => entry.surface !== 'governance');
    const status = protectedPaths.has(path) ? 'protected' : !known.has(path) ? 'absent' : consumers.length ? 'referenced' : 'unproven';
    return { path, tracked: known.has(path), sha256: snapshotByPath.get(path) || null, status, deletionAllowed: false,
      followup: protectedPaths.has(path) ? 'retain-frozen-contract' : followup(path),
      ownership: owner ? { responsibility: owner.responsibility, stateOwner: owner.stateOwner, lifecycle: owner.lifecycle } : null,
      detected: source !== undefined && /\.(?:js|rs|html|css)$/.test(path) ? analyzeProductionSource(path, source) : null,
      references: refs,
      requiredProof: status === 'protected' ? 'Frozen contract; excluded from deletion.' : status === 'absent' ? 'Already absent from tracked checkout; historical/test mentions are retained separately.'
        : 'Recheck every reference, replace/remove callers in its authorized Atomic, prove equivalent behavior and rebuild before deletion; zero text matches alone is insufficient.' };
  });
  return { schemaVersion: 1, stage: 'R16-01', baselineCommit, deletionAuthorized: false,
    scope: 'Conservative tracked import/HTML/test/build/Rust evidence; no file deletion or runtime migration.',
    checkedEntrypoints: ['index.html', 'src/bootstrap/module-entry.js', 'src/main.js', 'package.json', 'vite.config.js', 'src-tauri/Cargo.toml', 'src-tauri/src/main.rs'],
    limitations: ['Static extraction is not a complete language parser or proof of absence of dynamic/global uses.',
      'Computed imports/includes, shared classic lexical bindings, external data and platform cfg require manual/runtime review.',
      'Public copy evidence uses the current unchanged Vite public directory contract.',
      'References include test source and historical fixture metadata; they are not all live runtime calls.',
      'Only tracked files are inspected. Ignored local logs/cache and user data are neither scanned nor deleted.'],
    inputs: snapshot, inputSha256: sha256(JSON.stringify(snapshot)),
    protectedModels: [...protectedPaths].sort().map(path => ({ path, sha256: snapshotByPath.get(path) || null })),
    rustModules, uncertainties, candidates: entries,
    summary: Object.fromEntries(['protected', 'absent', 'referenced', 'unproven'].map(status => [status, entries.filter(entry => entry.status === status).length])) };
}

export async function verifyDeletionInventory({ root = process.cwd(), frozen }) {
  const current = await buildDeletionInventory({ root, baselineCommit: frozen.baselineCommit });
  if (JSON.stringify(current) !== JSON.stringify(frozen)) throw new Error('R16-01 deletion evidence drifted; review source, references and decisions before explicitly freezing a new snapshot. No deletion is authorized.');
  return current.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd(), write = process.argv.includes('--write');
  if (process.argv.slice(2).some(value => value !== '--write')) throw new Error('Only --write is supported.');
  if (write) {
    const report = await buildDeletionInventory({ root, baselineCommit: git(root, ['rev-parse', 'HEAD']) });
    await writeFile(resolve(root, REPORT), JSON.stringify(report, null, 2) + '\n');
    console.log('R16-01 evidence frozen; no deletion authorized. ' + JSON.stringify(report.summary));
  } else {
    const frozen = JSON.parse(await readFile(resolve(root, REPORT), 'utf8'));
    git(root, ['merge-base', '--is-ancestor', frozen.baselineCommit, 'HEAD']);
    console.log('R16-01 frozen evidence verified: ' + JSON.stringify(await verifyDeletionInventory({ root, frozen })));
  }
}
