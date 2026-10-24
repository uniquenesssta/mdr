// Audit implementation names and copy candidates without changing or removing files.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverProductionFiles } from '../stage-01/module-inventory-core.mjs';
import { getGitHead, listRepositoryFiles, loadOwnershipManifest } from './repository.mjs';

const REPORT = 'docs/audit/r16-11-module-naming.json';
const LEGAL_NAMES = new Map([
  ['docs/audit/windows-validation-final.json', 'Historical Windows acceptance evidence; final identifies that recorded decision, not an alternative implementation.'],
  ['docs/rewrite-progress/stage-02/02-11-old-shell-cutover.md', 'Historical Stage 2 cutover record describing the retired shell.'],
  ['tests/architecture/stage-09-final-sync-legacy-removal.test.mjs', 'R9-12 architecture cutover assertions; final identifies the completed migration task.'],
  ['tests/stage-09-final-sync-legacy-removal.test.mjs', 'R9-12 runtime sync behavior and disposal scenarios; independent of the architecture assertions.']
]);
const SCOPED_NAMES = [
  [['src/app/commands/command-registry.js', 'src/shared/commands/command-registry.js'], 'App registry owns typed command IDs and single-handler resolution; shared registry owns injected callback batches, atomic registration and terminal disposal. Separate contracts and instances.'],
  [['src-tauri/src/document_store/commands/search.rs', 'src-tauri/src/document_store/index/search.rs'], 'Tauri search adapter dispatches store work; index search implements UTF-16 query matching.'],
  [['src-tauri/src/document_store/paths.rs', 'src-tauri/src/performance_log/paths.rs'], 'Document-store slot paths and per-process telemetry log paths belong to separate storage domains.'],
  [['src-tauri/src/document_store/snapshot/writer.rs', 'src-tauri/src/performance_log/writer.rs'], 'Atomic snapshot publication and serialized JSONL append have different formats, locks and recovery contracts.'],
  [['src-tauri/src/document_store/types.rs', 'src-tauri/src/local_file/types.rs'], 'Document-store and local-file transport DTOs belong to separate native APIs.'],
  [['src-tauri/src/document_store/validation.rs', 'src-tauri/src/external_link/validation.rs', 'src-tauri/src/web_fetch/validation.rs'], 'Document IDs, external-link schemes and HTTP/public-address admission validate separate request contracts.'],
  [['src-tauri/src/external_link/command.rs', 'src-tauri/src/performance_log/command.rs', 'src-tauri/src/web_fetch/command.rs'], 'Rust module scopes distinguish link opening, telemetry receipt and HTTP fetch command adapters.']
];
const key = paths => [...paths].sort().join('\n');
const scopedDecisions = new Map(SCOPED_NAMES.map(([paths, reason]) => [key(paths), reason]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const groupBy = (values, identify) => {
  const groups = new Map();
  for (const value of values) {
    const id = identify(value);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(value);
  }
  return [...groups.values()].filter(group => group.length > 1);
};

export function inspectModulePaths(paths) {
  const findings = [], issues = [];
  for (const path of [...new Set(paths)].sort()) {
    const component = path.split('/').find(part => {
      return /(?:^|[-_.\s])(old|new|v\d+|final|copy)(?=$|[-_.\s\d(])/i.test(part)
        || /[a-z\d](?:Old|New|V\d+|Final|Copy)(?:[A-Z\d.]|$)/.test(part)
        || /(?:19|20)\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])(?:$|[-_.T\d])/.test(part)
        || /\s\(\d+\)(?:\.[a-z\d]+)*$/i.test(part);
    });
    if (!component) continue;
    const reason = LEGAL_NAMES.get(path) || null;
    findings.push({ path, component, decision: reason ? 'legitimate' : 'rejected', reason });
    if (!reason) issues.push({ rule: 'legacy-file-suffix', path, message: 'File or directory uses an unexplained migration, date or copy name.', detail: { component } });
  }
  for (const group of groupBy([...new Set(paths)], path => path.toLowerCase())) {
    issues.push({ rule: 'module-path-case-collision', path: group[0], message: 'Module paths collide on Windows.', detail: { paths: group.sort() } });
  }
  return { findings, issues };
}

export async function auditModuleNaming({ root = process.cwd() } = {}) {
  const [tracked, production, manifest] = await Promise.all([
    listRepositoryFiles(root), discoverProductionFiles(root), loadOwnershipManifest(root)
  ]);
  const paths = [...new Set([...tracked, ...production])].sort();
  const { findings, issues } = inspectModulePaths(paths);
  // Fixed malicious fixtures/data are not executable module candidates. Product files
  // include untracked discoveries; tracked build and reusable test hosts are included.
  const modules = paths.filter(path => /\.(?:js|mjs|cjs|rs|css|html)$/.test(path)
    && (production.includes(path) || /^(?:scripts|tests\/support|tests\/e2e\/lib)\//.test(path)));
  const inputs = await Promise.all(modules.map(async path => {
    const bytes = await readFile(resolve(root, path));
    return { path, sha256: digest(bytes), empty: /^\s*(?:export\s*\{\s*\}\s*;?)?\s*$/.test(bytes.toString('utf8')) };
  }));
  const identicalModules = groupBy(inputs.filter(row => !row.empty), row => row.sha256).map(group => ({
    paths: group.map(row => row.path), sha256: group[0].sha256
  }));
  for (const group of identicalModules) issues.push({ rule: 'duplicate-module-content', path: group.paths[0],
    message: 'Executable module content is duplicated; retain one owner or record an explicit scoped contract.', detail: group });
  const ownership = new Map(manifest.modules.map(row => [row.path, row]));
  const sameBasenames = groupBy(production.filter(path => /\.(?:js|rs)$/.test(path)), path => basename(path).toLowerCase()).map(group => {
    const name = basename(group[0]);
    const reason = ['index.js', 'mod.rs'].includes(name)
      ? 'Conventional directory public entry/module declaration; relative imports and enclosing module scope distinguish ownership.'
      : scopedDecisions.get(key(group)) || null;
    const result = { name, paths: group.sort(), decision: reason ? 'legitimate' : 'unreviewed', reason,
      owners: group.map(path => ({ path, responsibility: ownership.get(path)?.responsibility || null, stateOwner: ownership.get(path)?.stateOwner || null })) };
    if (!reason) issues.push({ rule: 'unreviewed-module-basename', path: group[0], message: 'Same-named production modules require a concrete responsibility review.', detail: result });
    return result;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const schemas = ['src-tauri/gen/schemas/desktop-schema.json', 'src-tauri/gen/schemas/windows-schema.json'];
  const schemaMetadata = schemas.every(path => tracked.includes(path)) ? {
    paths: schemas, sha256: await Promise.all(schemas.map(async path => digest(await readFile(resolve(root, path))))),
    reason: 'Tauri-generated desktop and Windows schema metadata; not executable modules or a copied product implementation.'
  } : null;
  return {
    schemaVersion: 1, stage: 'R16.11',
    scope: 'Tracked file/directory names, actual production discoveries, production modules, build scripts and reusable test hosts. No file mutation or semantic equivalence claim.',
    trackedPaths: tracked.length, productionFiles: production.length, moduleCandidates: modules.length,
    inputSha256: digest(JSON.stringify({ paths, production, inputs, ownership: manifest.modules })),
    nameFindings: findings, identicalModules, sameBasenames, schemaMetadata,
    limitations: ['Exact content and scoped basenames identify copy candidates, not arbitrary semantic equivalence.',
      'Historical records, fixed data fixtures and ignored local outputs are not executable implementations.',
      'Empty modules have no implementation body; equality alone does not establish duplicate business ownership.'],
    issues
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--write' && !arg.startsWith('--root='))) throw new Error('Only --write and --root= are supported.');
    const root = resolve(args.find(arg => arg.startsWith('--root='))?.slice(7) || process.cwd());
    const report = await auditModuleNaming({ root });
    if (args.includes('--write')) {
      const path = resolve(root, REPORT);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ baselineCommit: await getGitHead(root), ...report }, null, 2) + '\n');
    }
    console.log(JSON.stringify({ trackedPaths: report.trackedPaths, productionFiles: report.productionFiles,
      moduleCandidates: report.moduleCandidates, nameFindings: report.nameFindings.length, identicalModules: report.identicalModules.length, sameBasenames: report.sameBasenames.length, issues: report.issues }));
    if (report.issues.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
}
