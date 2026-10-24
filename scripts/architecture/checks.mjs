import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverProductionFiles } from '../stage-01/module-inventory-core.mjs';
import { auditModuleNaming } from './module-naming.mjs';
import { buildDependencyGraph } from './dependency-graph.mjs';
import {
  getGitHead,
  getLineAndColumn,
  listRepositoryFiles,
  loadArchitectureBaseline,
  loadOwnershipManifest,
  normalizePath,
  pathExists,
  readRepositoryText
} from './repository.mjs';
import {
  collectBusinessGlobalWrites,
  collectDynamicClassicScripts,
  collectHtmlClassicScripts,
  collectInlineEvents
} from './source-analysis.mjs';

const DEFAULT_BASELINE_PATH = 'tests/architecture/fixtures/architecture-baseline.json';
const RUNTIME_LOG_PATH = /^logs(?:\/|$)/i;
const GENERATED_RUNTIME_PATTERNS = [
  /(?:^|\/)(?:dist|target|\.vite|node_modules)(?:\/|$)/i,
  /^(?:logs|artifacts|\.cargo-target|\.(?:windows-driver-host|markdown-editor-windows-driver-host))(?:\/|$)/i,
  /^\.(?:windows-driver-host|markdown-editor-windows-driver-host)\.zip$/i,
  /\.log$/i
];
const REQUIRED_GENERATED_IGNORES = [
  'node_modules/', '.vite/', 'dist/', 'target/', 'src-tauri/target/',
  'artifacts/', '.cargo-target/', '.windows-driver-host/', '.windows-driver-host.zip',
  '.markdown-editor-windows-driver-host/', '.markdown-editor-windows-driver-host.zip', 'runtime.log'
];
const STRICT_IMPORT_ZONES = [
  'src/app/',
  'src/model-kernel/',
  'src/features/',
  'src/platform/',
  'src/ui/',
  'src/i18n/'
];

export function architectureIssue(rule, path, message, options = {}) {
  return {
    rule,
    path: normalizePath(path || '.'),
    line: Number.isInteger(options.line) ? options.line : null,
    column: Number.isInteger(options.column) ? options.column : null,
    message,
    detail: options.detail ?? null
  };
}

function stableKey(record, fields) {
  return fields.map(field => JSON.stringify(record[field] ?? null)).join('\u0000');
}

function compareExactRecords({ rule, label, actual, expected, fields }) {
  const issues = [];
  const actualByKey = new Map(actual.map(record => [stableKey(record, fields), record]));
  const expectedByKey = new Map(expected.map(record => [stableKey(record, fields), record]));

  for (const [key, record] of actualByKey) {
    const baselineRecord = expectedByKey.get(key);
    if (!baselineRecord || Number(baselineRecord.count ?? 1) !== Number(record.count ?? 1)) {
      issues.push(architectureIssue(
        rule,
        record.path || record.loader || '.',
        `New or changed ${label}: ${fields.map(field => `${field}=${JSON.stringify(record[field])}`).join(', ')}.`,
        { line: record.lines?.[0] ?? record.line ?? null, detail: { actual: record, baseline: baselineRecord || null } }
      ));
    }
  }

  for (const [key, record] of expectedByKey) {
    const actualRecord = actualByKey.get(key);
    if (!actualRecord || Number(actualRecord.count ?? 1) !== Number(record.count ?? 1)) {
      issues.push(architectureIssue(
        rule,
        record.path || record.loader || '.',
        `Migration baseline ${label} changed or disappeared without updating the exact baseline: ${fields.map(field => `${field}=${JSON.stringify(record[field])}`).join(', ')}.`,
        { detail: { actual: actualRecord || null, baseline: record } }
      ));
    }
  }
  return issues;
}

function assertBaselineShape(baseline) {
  if (!baseline || baseline.schemaVersion !== 1) {
    throw new Error('Architecture baseline must use schemaVersion 1.');
  }
  if (baseline.kind !== 'stage-01-exact-migration-regression-baseline') {
    throw new Error('Architecture baseline kind is invalid.');
  }
  const serialized = JSON.stringify(baseline);
  if (serialized.includes('*')) {
    throw new Error('Architecture baseline must not contain wildcard exemptions.');
  }
  for (const key of ['legacyClassicScripts', 'inlineEvents', 'businessGlobalWrites', 'trackedGeneratedFiles']) {
    if (!Array.isArray(baseline[key])) throw new Error(`Architecture baseline is missing ${key}.`);
  }
}

async function collectActualArchitectureBaseline(root) {
  const manifest = await loadOwnershipManifest(root);
  const repositoryFiles = await listRepositoryFiles(root);
  const inlineEvents = [];
  const classicScripts = [];
  const businessGlobalWrites = [];

  for (const record of manifest.modules) {
    const path = normalizePath(record.path);
    if (!await pathExists(resolve(root, path))) continue;
    const source = await readRepositoryText(root, path);
    if (path.endsWith('.html')) {
      inlineEvents.push(...collectInlineEvents(path, source));
      classicScripts.push(...collectHtmlClassicScripts(path, source));
    }
    if (path.endsWith('.js')) {
      businessGlobalWrites.push(...collectBusinessGlobalWrites(path, source));
      classicScripts.push(...collectDynamicClassicScripts(path, source));
    }
  }

  const legacyClassicScripts = [...new Map(
    classicScripts.map(record => [`${record.loader}\u0000${record.script}`, {
      loader: record.loader,
      script: record.script,
      count: classicScripts.filter(candidate => (
        candidate.loader === record.loader && candidate.script === record.script
      )).length
    }])
  ).values()].sort((a, b) => `${a.loader}:${a.script}`.localeCompare(`${b.loader}:${b.script}`));

  const trackedGeneratedFiles = repositoryFiles
    .filter(path => GENERATED_RUNTIME_PATTERNS.some(pattern => pattern.test(path)))
    .sort();

  return {
    schemaVersion: 1,
    kind: 'stage-01-exact-migration-regression-baseline',
    sourceCommit: getGitHead(root),
    policy: {
      exactEntriesOnly: true,
      wildcardExemptions: false,
      additionsRequireMigrationRemovalOrBaselineReview: true
    },
    legacyClassicScripts,
    inlineEvents,
    businessGlobalWrites,
    trackedGeneratedFiles
  };
}

export async function writeArchitectureBaseline({
  root = process.cwd(),
  output = DEFAULT_BASELINE_PATH
} = {}) {
  const baseline = await collectActualArchitectureBaseline(root);
  const absoluteOutput = resolve(root, output);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

export async function checkLegacyRuntime({
  root = process.cwd(),
  baselinePath = DEFAULT_BASELINE_PATH
} = {}) {
  const baseline = await loadArchitectureBaseline(root, baselinePath);
  assertBaselineShape(baseline);
  const actual = await collectActualArchitectureBaseline(root);
  const issues = [];

  issues.push(...compareExactRecords({
    rule: 'legacy-classic-script-regression',
    label: 'classic script',
    actual: actual.legacyClassicScripts,
    expected: baseline.legacyClassicScripts,
    fields: ['loader', 'script']
  }));
  issues.push(...compareExactRecords({
    rule: 'inline-event-regression',
    label: 'inline event handler',
    actual: actual.inlineEvents,
    expected: baseline.inlineEvents,
    fields: ['path', 'attribute', 'handler']
  }));
  issues.push(...compareExactRecords({
    rule: 'business-global-regression',
    label: 'business global write',
    actual: actual.businessGlobalWrites,
    expected: baseline.businessGlobalWrites,
    fields: ['path', 'global']
  }));

  const manifest = await loadOwnershipManifest(root);
  const manifestByPath = new Map(manifest.modules.map(record => [normalizePath(record.path), record]));
  for (const record of actual.legacyClassicScripts) {
    const target = manifestByPath.get(record.script);
    if (!target || target.surface !== 'legacy-classic-script') {
      issues.push(architectureIssue(
        'legacy-script-classification',
        record.loader,
        `Classic script ${record.script} must be explicitly classified as legacy-classic-script.`,
        { line: record.line }
      ));
    }
  }
  for (const record of actual.businessGlobalWrites) {
    if (STRICT_IMPORT_ZONES.some(prefix => record.path.startsWith(prefix))) {
      issues.push(architectureIssue(
        'strict-zone-business-global',
        record.path,
        `Strict architecture module must not write ${record.global}.`,
        { line: record.lines?.[0] }
      ));
    }
  }
  return issues;
}

export async function checkGeneratedFiles({
  root = process.cwd(),
  baselinePath = DEFAULT_BASELINE_PATH
} = {}) {
  const baseline = await loadArchitectureBaseline(root, baselinePath);
  assertBaselineShape(baseline);
  const files = await listRepositoryFiles(root);
  const actualGenerated = files
    .filter(path => RUNTIME_LOG_PATH.test(path) || GENERATED_RUNTIME_PATTERNS.some(pattern => pattern.test(path)))
    .sort();
  const expectedGenerated = [...baseline.trackedGeneratedFiles].sort();
  const issues = [];

  const actual = new Set(actualGenerated);
  for (const path of actualGenerated) {
    if (RUNTIME_LOG_PATH.test(path)) {
      issues.push(architectureIssue(
        'tracked-runtime-log', path,
        'Runtime logs must not be tracked by Git, including force-added or previously exempted files.'
      ));
    } else {
      issues.push(architectureIssue(
        'tracked-generated-file-regression',
        path,
        'New generated or runtime output is tracked by Git.'
      ));
    }
  }
  for (const path of expectedGenerated) {
    if (RUNTIME_LOG_PATH.test(path)) {
      issues.push(architectureIssue(
        'runtime-log-baseline-exemption', path,
        'Runtime logs cannot be exempted by the generated-file baseline; remove this active exemption.'
      ));
    } else {
      issues.push(architectureIssue(
        'generated-file-baseline-exemption', path,
        'Generated output cannot be exempted by the active architecture baseline.'
      ));
    }
    if (!actual.has(path)) {
      issues.push(architectureIssue(
        'generated-file-baseline-stale',
        path,
        'Tracked generated-file baseline changed without updating the exact baseline.'
      ));
    }
  }

  // Ask Git to evaluate the directory itself, including negation semantics.
  // Local/global excludes are not a portable repository policy.
  const ignorePaths = ['logs/', ...REQUIRED_GENERATED_IGNORES];
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--verbose', '--non-matching', '--stdin', '-z'], {
    cwd: root, input: ignorePaths.join('\0') + '\0', encoding: 'utf8'
  });
  if (ignored.error || ![0, 1].includes(ignored.status)) {
    issues.push(architectureIssue(
      'runtime-logs-ignore-check-failed', '.gitignore',
      'Unable to evaluate the shared logs/ ignore rule with git check-ignore.'
    ));
  } else {
    const records = (ignored.stdout || '').split('\0');
    for (let index = 0; index < ignorePaths.length; index++) {
      const [ignoreSource, , ignorePattern, ignoredPath] = records.slice(index * 4, index * 4 + 4);
      const output = ignorePaths[index];
      if (ignoreSource === '.gitignore' && ignorePattern && !ignorePattern.startsWith('!') && ignoredPath === output) continue;
      issues.push(architectureIssue(
        output === 'logs/' ? 'runtime-logs-ignore-missing' : 'generated-output-ignore-missing', '.gitignore',
        `The repository .gitignore must ignore ${output}, including the whole directory for directory outputs.`,
        { detail: { output } }
      ));
    }
  }

  for (const issue of (await auditModuleNaming({ root })).issues) {
    issues.push(architectureIssue(issue.rule, issue.path, issue.message, { detail: issue.detail }));
  }
  return issues;
}

export async function checkDependencyBoundaries(options = {}) {
  return (await buildDependencyGraph(options)).issues;
}

function strictImportModules(manifest) {
  return manifest.modules
    .map(record => normalizePath(record.path))
    .filter(path => /\.(?:js|mjs)$/.test(path))
    .filter(path => STRICT_IMPORT_ZONES.some(prefix => path.startsWith(prefix)));
}

function importProbeSource(absolutePath) {
  const href = pathToFileURL(absolutePath).href;
  return `
const unavailable = ['document','window','localStorage','sessionStorage','Worker','SharedWorker','MutationObserver','ResizeObserver','IntersectionObserver','__TAURI_INTERNALS__'];
for (const name of unavailable) Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:undefined});
for (const name of ['addEventListener','removeEventListener','setTimeout','setInterval','requestAnimationFrame','requestIdleCallback','fetch']) {
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:(...args)=>{throw new Error('forbidden import-time runtime access: '+name);}});
}
await import(${JSON.stringify(`${href}?architecture-import-probe=1`)});
`;
}

export async function checkModuleImportSideEffects({ root = process.cwd() } = {}) {
  const manifest = await loadOwnershipManifest(root);
  const issues = [];
  for (const path of strictImportModules(manifest)) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', importProbeSource(resolve(root, path))], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0 || result.error) {
      const detail = String(result.stderr || result.stdout || result.error?.message || 'unknown import failure').trim();
      issues.push(architectureIssue(
        'module-import-side-effect',
        path,
        'Strict architecture module cannot be imported without runtime/platform access.',
        { detail }
      ));
    }
  }
  return issues;
}

export async function checkReadmeRecord({ root = process.cwd() } = {}) {
  const readmePath = 'docs/README.md';
  const readme = await readRepositoryText(root, readmePath);
  const files = await listRepositoryFiles(root);
  const markerPattern = /<!--\s*stage-01-node:(01-\d{2})\s*-->/g;
  const markers = [];
  let match;
  while ((match = markerPattern.exec(readme))) {
    const location = getLineAndColumn(readme, match.index);
    markers.push({ node: match[1], line: location.line, index: match.index });
  }
  const issues = [];
  const markerCounts = new Map();
  for (const marker of markers) {
    markerCounts.set(marker.node, (markerCounts.get(marker.node) || 0) + 1);
  }
  for (const [node, count] of markerCounts) {
    if (count !== 1) {
      issues.push(architectureIssue(
        'readme-duplicate-stage-record',
        readmePath,
        `README must contain exactly one ${node} marker; found ${count}.`,
        { line: markers.find(marker => marker.node === node)?.line }
      ));
    }
  }

  const stageDocs = files
    .map(path => ({ path, match: path.match(/^docs\/rewrite-progress\/stage-01\/(01-\d{2})-[^/]+\.md$/) }))
    .filter(record => record.match)
    .map(record => ({ path: record.path, node: record.match[1] }))
    .sort((left, right) => left.node.localeCompare(right.node));
  for (const record of stageDocs) {
    if (!markerCounts.has(record.node)) {
      issues.push(architectureIssue(
        'readme-missing-stage-record',
        readmePath,
        `README is missing the canonical ${record.node} record required by ${record.path}.`
      ));
    }
  }

  const uniqueNodes = markers.map(marker => marker.node);
  for (let index = 1; index < uniqueNodes.length; index += 1) {
    if (uniqueNodes[index - 1].localeCompare(uniqueNodes[index]) <= 0) {
      issues.push(architectureIssue(
        'readme-stage-order',
        readmePath,
        `Stage 1 records must be newest-first; ${uniqueNodes[index - 1]} precedes ${uniqueNodes[index]}.`,
        { line: markers[index].line }
      ));
    }
  }

  for (const marker of markers) {
    const nextMarkerIndex = markers.find(candidate => candidate.index > marker.index)?.index ?? readme.length;
    const section = readme.slice(marker.index, nextMarkerIndex);
    if (!/^<!--[^\n]+-->\r?\n-\s+\d{4}-\d{2}-\d{2}：/m.test(section)) {
      issues.push(architectureIssue(
        'readme-stage-record-shape',
        readmePath,
        `${marker.node} marker must be followed by one dated Change Log bullet.`,
        { line: marker.line }
      ));
    }
  }
  return issues;
}

export async function checkProductionInventory({ root = process.cwd() } = {}) {
  const manifest = await loadOwnershipManifest(root);
  const actual = new Set(await discoverProductionFiles(root));
  const seen = new Set();
  const issues = [];
  for (const record of manifest.modules) {
    const path = record.path;
    if (seen.has(path)) issues.push(architectureIssue('production-inventory', path, 'Duplicate ownership record.'));
    if (!actual.has(path)) issues.push(architectureIssue('production-inventory', path, 'Ownership record has no production file.'));
    seen.add(path);
  }
  for (const path of actual) {
    if (!seen.has(path)) issues.push(architectureIssue('production-inventory', path, 'Production file has no ownership record.'));
  }
  return issues;
}

export async function checkArchitecture(options = {}) {
  const checks = await Promise.all([
    checkProductionInventory(options),
    checkDependencyBoundaries(options),
    checkModuleImportSideEffects(options),
    checkLegacyRuntime(options),
    checkGeneratedFiles(options),
    checkReadmeRecord(options)
  ]);
  return checks.flat().sort((left, right) => (
    `${left.path}:${left.line ?? 0}:${left.rule}`.localeCompare(`${right.path}:${right.line ?? 0}:${right.rule}`)
  ));
}
