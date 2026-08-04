import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const reportRoot = resolve(process.env.STAGE0_REPORT_DIR || 'artifacts/stage-00');
const baselineDirectory = resolve(reportRoot, 'baseline');
const contractsDirectory = resolve(baselineDirectory, 'contracts');
await mkdir(contractsDirectory, { recursive: true });

function execute(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.stack || result.error.message || result.error) : null
  };
}

function git(args) {
  return execute('git', args);
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function writeText(path, value) {
  await writeFile(path, String(value ?? ''), 'utf8');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeLines(value) {
  return String(value || '').replace(/\r\n/g, '\n').split('\n');
}

function addMatch(target, category, path, lineNumber, text, detail = null) {
  target.push({ category, path, line: lineNumber, text: text.trim(), detail });
}

const gitStatus = git(['status', '--short', '--branch']);
const gitHead = git(['rev-parse', 'HEAD']);
const gitBranch = git(['branch', '--show-current']);
const gitDiffStat = git(['diff', '--stat']);
const gitUntracked = git(['ls-files', '--others', '--exclude-standard']);
const gitTracked = git(['ls-files', '-z']);
const trackedFiles = gitTracked.stdout.split('\0').filter(Boolean).sort();

await Promise.all([
  writeText(resolve(baselineDirectory, 'git-status.txt'), gitStatus.stdout + gitStatus.stderr),
  writeText(resolve(baselineDirectory, 'git-head.txt'), gitHead.stdout + gitHead.stderr),
  writeText(resolve(baselineDirectory, 'git-branch.txt'), gitBranch.stdout + gitBranch.stderr),
  writeText(resolve(baselineDirectory, 'git-diff-stat.txt'), gitDiffStat.stdout + gitDiffStat.stderr),
  writeText(resolve(baselineDirectory, 'git-untracked.txt'), gitUntracked.stdout + gitUntracked.stderr),
  writeText(resolve(baselineDirectory, 'tracked-files.txt'), `${trackedFiles.join('\n')}\n`)
]);

const environmentCommands = {
  uname: execute('uname', ['-a']),
  osRelease: execute('bash', ['-lc', 'cat /etc/os-release 2>/dev/null || true']),
  git: execute('git', ['--version']),
  node: execute('node', ['--version']),
  npm: execute('npm', ['--version']),
  rustc: execute('rustc', ['--version']),
  cargo: execute('cargo', ['--version']),
  chrome: execute('bash', ['-lc', 'for c in google-chrome google-chrome-stable chromium chromium-browser; do command -v "$c" >/dev/null 2>&1 && "$c" --version && exit 0; done; exit 1'])
};

const metadata = {
  collectedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || null,
  workflow: process.env.GITHUB_WORKFLOW || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  eventName: process.env.GITHUB_EVENT_NAME || null,
  ref: process.env.GITHUB_REF || null,
  refName: process.env.GITHUB_REF_NAME || gitBranch.stdout.trim(),
  sha: process.env.GITHUB_SHA || gitHead.stdout.trim(),
  actor: process.env.GITHUB_ACTOR || null,
  runner: {
    os: process.env.RUNNER_OS || process.platform,
    architecture: process.env.RUNNER_ARCH || process.arch,
    name: process.env.RUNNER_NAME || null
  },
  environmentCommands
};
await writeJson(resolve(baselineDirectory, 'environment.json'), metadata);

const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rs', '.html', '.css', '.json', '.toml', '.md', '.yaml', '.yml']);
const sourceManifest = [];
const readableSourceFiles = [];

for (const relativePath of trackedFiles) {
  const absolutePath = resolve(root, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) continue;
    const extension = extname(relativePath).toLowerCase();
    const buffer = await readFile(absolutePath);
    const lineCount = sourceExtensions.has(extension)
      ? normalizeLines(buffer.toString('utf8')).length
      : null;
    sourceManifest.push({
      path: relativePath,
      bytes: fileStat.size,
      lines: lineCount,
      extension,
      sha256: hashBuffer(buffer)
    });
    if (sourceExtensions.has(extension) && buffer.length <= 5 * 1024 * 1024) {
      readableSourceFiles.push({ path: relativePath, content: buffer.toString('utf8') });
    }
  } catch (error) {
    sourceManifest.push({ path: relativePath, error: String(error.message || error) });
  }
}
await writeJson(resolve(baselineDirectory, 'source-manifest.json'), sourceManifest);

const trackedRuntimeOutput = trackedFiles.filter(path => (
  path === 'dist' || path.startsWith('dist/') ||
  path === '.vite' || path.startsWith('.vite/') ||
  path === 'logs' || path.startsWith('logs/') ||
  path === 'src-tauri/target' || path.startsWith('src-tauri/target/') ||
  path.endsWith('.log')
));
await writeText(resolve(baselineDirectory, 'tracked-runtime-output.txt'), `${trackedRuntimeOutput.join('\n')}\n`);

const frozenModelPaths = [
  'src/document/document-model.js',
  'src/preview/incremental-preview.js',
  'src/editor/hybrid/table-model.js',
  'src/editor/hybrid/math-ranges.js',
  'src/editor/hybrid/ranges.js',
  'src/sync/selection-mapping.js',
  'src/preview/math-source.js',
  'src/editor/hybrid/block-registry.js',
  'src-tauri/src/document_store.rs'
];
const frozenModels = [];
for (const relativePath of frozenModelPaths) {
  const manifestEntry = sourceManifest.find(entry => entry.path === relativePath);
  frozenModels.push({
    path: relativePath,
    present: Boolean(manifestEntry && !manifestEntry.error),
    bytes: manifestEntry?.bytes ?? null,
    lines: manifestEntry?.lines ?? null,
    sha256: manifestEntry?.sha256 ?? null,
    scope: relativePath === 'src-tauri/src/document_store.rs'
      ? 'data format and behavior contract; file may be decomposed later'
      : 'algorithm and public behavior frozen'
  });
}
await writeJson(resolve(contractsDirectory, 'frozen-model-hashes.json'), frozenModels);

const contractMatches = [];
const localStorageKeys = new Map();
const tauriCommands = new Map();
const rustHandlerCommands = new Set();
const exportFunctions = new Set();
const rustStorageSymbols = new Set();

for (const { path, content } of readableSourceFiles) {
  const lines = normalizeLines(content);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(/.test(line)) {
      addMatch(contractMatches, 'storage-access', path, lineNumber, line);
    }
    if (/\b(?:Ctrl|Cmd|Meta|Control|Alt|Shift)\b|addEventListener\(\s*['"]keydown['"]|\.key\s*===/.test(line)) {
      addMatch(contractMatches, 'shortcut-or-keyboard', path, lineNumber, line);
    }
    if (/\b(?:MAX|MIN|LIMIT|THRESHOLD|TIMEOUT|DELAY|INTERVAL|CHUNK|WINDOW|DEBOUNCE|BATCH|RETRY)[A-Z0-9_]*\b/.test(line)) {
      addMatch(contractMatches, 'threshold-or-limit', path, lineNumber, line);
    }
    if (/\bwindow\.markdownEditor[A-Za-z0-9_]*/.test(line)) {
      addMatch(contractMatches, 'global-business-api', path, lineNumber, line);
    }
    if (/createElement\(\s*['"]script['"]\)|APP_MODULES|loadClassicScript/.test(line)) {
      addMatch(contractMatches, 'classic-script-loader', path, lineNumber, line);
    }
    if (/\bon[a-z]+\s*=/.test(line) && path.endsWith('.html')) {
      addMatch(contractMatches, 'inline-event-handler', path, lineNumber, line);
    }
    if (/\b(?:export|saveAs|download|print)[A-Z][A-Za-z0-9_]*\s*\(/.test(line) && path.endsWith('.js')) {
      addMatch(contractMatches, 'export-entry', path, lineNumber, line);
    }
  });

  for (const match of content.matchAll(/\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(\s*(['"`])([^'"`]+)\1/g)) {
    const key = match[2];
    const locations = localStorageKeys.get(key) || [];
    locations.push(path);
    localStorageKeys.set(key, locations);
  }
  for (const match of content.matchAll(/\b[A-Z][A-Z0-9_]*_KEY\s*=\s*(['"`])([^'"`]+)\1/g)) {
    const key = match[2];
    const locations = localStorageKeys.get(key) || [];
    locations.push(path);
    localStorageKeys.set(key, locations);
  }

  if (path.endsWith('.rs')) {
    for (const match of content.matchAll(/#\s*\[\s*tauri::command\s*\][\s\S]{0,600}?\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/g)) {
      const command = match[1];
      const locations = tauriCommands.get(command) || [];
      locations.push(path);
      tauriCommands.set(command, locations);
    }
    for (const match of content.matchAll(/generate_handler!\s*\[([\s\S]*?)\]/g)) {
      for (const name of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
        rustHandlerCommands.add(name.replace(/\s+/g, ''));
      }
    }
    if (path === 'src-tauri/src/document_store.rs') {
      for (const match of content.matchAll(/\b(?:struct|enum|const|static)\s+([A-Za-z0-9_]+)/g)) {
        rustStorageSymbols.add(match[1]);
      }
    }
  }

  if (path.endsWith('/export.js') || path === 'public/app/export.js') {
    for (const match of content.matchAll(/\b(?:async\s+)?function\s+([A-Za-z0-9_]*(?:export|save|print|download)[A-Za-z0-9_]*)\s*\(/gi)) {
      exportFunctions.add(match[1]);
    }
  }
}

const localStorageContract = [...localStorageKeys.entries()]
  .map(([key, locations]) => ({ key, locations: [...new Set(locations)].sort() }))
  .sort((left, right) => left.key.localeCompare(right.key));
const tauriCommandContract = [...tauriCommands.entries()]
  .map(([name, locations]) => ({ name, locations: [...new Set(locations)].sort(), registered: rustHandlerCommands.has(name) }))
  .sort((left, right) => left.name.localeCompare(right.name));

await Promise.all([
  writeJson(resolve(contractsDirectory, 'contract-locations.json'), contractMatches),
  writeJson(resolve(contractsDirectory, 'storage-keys.json'), localStorageContract),
  writeJson(resolve(contractsDirectory, 'tauri-commands.json'), {
    annotated: tauriCommandContract,
    invokeHandlerEntries: [...rustHandlerCommands].sort()
  }),
  writeJson(resolve(contractsDirectory, 'export-entries.json'), [...exportFunctions].sort()),
  writeJson(resolve(contractsDirectory, 'document-store-symbols.json'), [...rustStorageSymbols].sort())
]);

let packageScripts = {};
try {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  packageScripts = packageJson.scripts || {};
} catch (error) {
  packageScripts = { error: String(error.message || error) };
}
await writeJson(resolve(contractsDirectory, 'package-scripts.json'), packageScripts);

const largestFiles = sourceManifest
  .filter(entry => Number.isFinite(entry.lines))
  .sort((left, right) => right.lines - left.lines)
  .slice(0, 30)
  .map(entry => ({ path: entry.path, lines: entry.lines, bytes: entry.bytes, sha256: entry.sha256 }));
await writeJson(resolve(baselineDirectory, 'largest-source-files.json'), largestFiles);

const summary = [
  '# Stage 0 baseline collection',
  '',
  `- Collected at: ${metadata.collectedAt}`,
  `- Repository: ${metadata.repository || 'unknown'}`,
  `- Branch: ${metadata.refName || 'unknown'}`,
  `- Commit: ${metadata.sha || 'unknown'}`,
  `- Tracked files: ${trackedFiles.length}`,
  `- Source manifest entries: ${sourceManifest.length}`,
  `- Frozen model entries: ${frozenModels.length}`,
  `- Tauri command annotations: ${tauriCommandContract.length}`,
  `- Registered invoke handler entries: ${rustHandlerCommands.size}`,
  `- Storage keys discovered: ${localStorageContract.length}`,
  `- Contract locations discovered: ${contractMatches.length}`,
  `- Tracked runtime/generated outputs: ${trackedRuntimeOutput.length}`,
  '',
  '## Largest tracked source files',
  '',
  ...largestFiles.slice(0, 15).map(entry => `- ${entry.path}: ${entry.lines} lines, ${entry.bytes} bytes`),
  ''
].join('\n');
await writeText(resolve(baselineDirectory, 'baseline-summary.md'), summary);

console.log(summary);
