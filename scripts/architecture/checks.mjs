import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  getGitHead,
  getLineAndColumn,
  listRepositoryFiles,
  loadArchitectureBaseline,
  loadOwnershipManifest,
  normalizePath,
  pathExists,
  readRepositoryText,
  resolveRelativeModule
} from './repository.mjs';
import {
  collectBusinessGlobalWrites,
  collectDynamicClassicScripts,
  collectHtmlClassicScripts,
  collectInlineEvents,
  collectModuleSpecifiers,
  featureName,
  isPublicFeatureEntry
} from './source-analysis.mjs';

const DEFAULT_BASELINE_PATH = 'tests/architecture/fixtures/architecture-baseline.json';
const GENERATED_RUNTIME_PATTERNS = [
  /^(?:dist|\.vite|logs)(?:\/|$)/,
  /^src-tauri\/target(?:\/|$)/,
  /\.log$/i
];
const LEGACY_SUFFIX_PATTERN = /(?:^|[-_.])(old|new|v\d+|final|copy)$/i;
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

function shouldScanLegacySuffix(path) {
  if (path.startsWith('docs/')) return false;
  if (path.startsWith('.git/')) return false;
  if (path === 'package-lock.json') return false;
  return /^(?:src|public|tests|scripts|src-tauri|\.github)(?:\/|$)|^(?:index\.html|vite\.config\.js|package\.json)$/.test(path);
}

export async function checkGeneratedFiles({
  root = process.cwd(),
  baselinePath = DEFAULT_BASELINE_PATH
} = {}) {
  const baseline = await loadArchitectureBaseline(root, baselinePath);
  assertBaselineShape(baseline);
  const files = await listRepositoryFiles(root);
  const actualGenerated = files
    .filter(path => GENERATED_RUNTIME_PATTERNS.some(pattern => pattern.test(path)))
    .sort();
  const expectedGenerated = [...baseline.trackedGeneratedFiles].sort();
  const issues = [];

  const expected = new Set(expectedGenerated);
  const actual = new Set(actualGenerated);
  for (const path of actualGenerated) {
    if (!expected.has(path)) {
      issues.push(architectureIssue(
        'tracked-generated-file-regression',
        path,
        'New generated or runtime output is tracked by Git.'
      ));
    }
  }
  for (const path of expectedGenerated) {
    if (!actual.has(path)) {
      issues.push(architectureIssue(
        'generated-file-baseline-stale',
        path,
        'Tracked generated-file baseline changed without updating the exact baseline.'
      ));
    }
  }

  for (const path of files.filter(shouldScanLegacySuffix)) {
    const extension = extname(path);
    const stem = basename(path, extension);
    const match = stem.match(LEGACY_SUFFIX_PATTERN);
    if (match) {
      issues.push(architectureIssue(
        'legacy-file-suffix',
        path,
        `File name uses forbidden migration suffix "${match[1]}".`
      ));
    }
  }
  return issues;
}

function canonicalCycle(cycle) {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)]);
  rotations.sort((left, right) => left.join('>').localeCompare(right.join('>')));
  const canonical = rotations[0];
  return [...canonical, canonical[0]];
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = new Map();

  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const target of graph.get(node) || []) {
      if (!graph.has(target)) continue;
      if (!state.has(target)) visit(target);
      else if (state.get(target) === 1) {
        const index = stack.indexOf(target);
        const cycle = [...stack.slice(index), target];
        const canonical = canonicalCycle(cycle);
        cycles.set(canonical.join('>'), canonical);
      }
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles.values()];
}

export async function checkDependencyBoundaries({ root = process.cwd() } = {}) {
  const manifest = await loadOwnershipManifest(root);
  const javascriptModules = manifest.modules
    .map(record => normalizePath(record.path))
    .filter(path => /\.(?:js|mjs)$/.test(path));
  const knownModules = new Set(javascriptModules);
  const graph = new Map(javascriptModules.map(path => [path, []]));
  const issues = [];

  for (const importer of javascriptModules) {
    const source = await readRepositoryText(root, importer);
    for (const imported of collectModuleSpecifiers(source)) {
      const target = await resolveRelativeModule(root, importer, imported.specifier, knownModules);
      if (!target || !knownModules.has(target)) continue;
      graph.get(importer).push(target);

      const importerFeature = featureName(importer);
      const targetFeature = featureName(target);
      if (importerFeature && target.startsWith('src/app/')) {
        issues.push(architectureIssue(
          'feature-imports-composition-root',
          importer,
          `Feature ${importerFeature} must not import application composition internals: ${target}.`,
          { line: imported.line, column: imported.column }
        ));
      }
      if (importerFeature && targetFeature && importerFeature !== targetFeature && !isPublicFeatureEntry(target)) {
        issues.push(architectureIssue(
          'cross-feature-internal-import',
          importer,
          `Feature ${importerFeature} must import feature ${targetFeature} through ${`src/features/${targetFeature}/index.js`}, not ${target}.`,
          { line: imported.line, column: imported.column }
        ));
      }
      if (importer.startsWith('src/platform/') && target.startsWith('src/features/')) {
        issues.push(architectureIssue(
          'platform-imports-feature',
          importer,
          `Platform module must not import feature module ${target}.`,
          { line: imported.line, column: imported.column }
        ));
      }
      if (importer.startsWith('src/model-kernel/') && /^(?:src\/(?:app|platform|features|ui)\/)/.test(target)) {
        issues.push(architectureIssue(
          'model-kernel-import-direction',
          importer,
          `Model kernel must not import higher layer ${target}.`,
          { line: imported.line, column: imported.column }
        ));
      }
    }
    graph.set(importer, [...new Set(graph.get(importer))].sort());
  }

  for (const cycle of findCycles(graph)) {
    issues.push(architectureIssue(
      'circular-dependency',
      cycle[0],
      `Circular dependency: ${cycle.join(' -> ')}.`,
      { detail: cycle }
    ));
  }
  return issues;
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
  const readmePath = 'README.md';
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

export async function checkArchitecture(options = {}) {
  const checks = await Promise.all([
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
