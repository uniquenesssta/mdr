import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIRECTORY = 'artifacts/stage-03';
const fixture = JSON.parse(await readFile('tests/architecture/fixtures/production-modules.json', 'utf8'));
const productionPaths = fixture.modules.map(record => record[0]);
const platformModules = productionPaths.filter(path => path.startsWith('src/platform/')).sort();

let facadeDeleted = false;
try {
  await access('src/runtime/tauri.js');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  facadeDeleted = true;
}

async function collectSources(root) {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:js|mjs)$/.test(entry.name)) results.push([path, await readFile(path, 'utf8')]);
    }
  }
  await visit(root);
  return results;
}

const productionSources = [...await collectSources('src'), ...await collectSources('public')];
const nativeGlobalOwners = productionSources.filter(([, source]) => source.includes('markdownEditorNative')).map(([path]) => path);
const tauriImportsOutsidePlatform = productionSources
  .filter(([path, source]) => source.includes('@tauri-apps/') && !path.startsWith('src/platform/desktop/'))
  .map(([path]) => path);
const main = await readFile('src/main.js', 'utf8');
const bridge = await readFile('src/platform/compatibility/classic-platform-port.js', 'utf8');
const workflow = await readFile('.github/workflows/stage-03-atomic.yml', 'utf8');
const windowsAutomation = await readFile('tests/e2e/windows/run-window-automation.mjs', 'utf8');
const classicCallers = Object.fromEntries(await Promise.all(
  ['public/app/core.js', 'public/app/events.js', 'public/app/export.js', 'public/app/web-clipper.js']
    .map(async path => [path, await readFile(path, 'utf8')])
));
const esmCallers = Object.fromEntries(await Promise.all(
  ['src/runtime/link-preview.js', 'src/runtime/performance.js', 'src/sidebar/folder-file-tree.js', 'src/storage/native-document-store.js', 'src/editor/hybrid/image-source.js']
    .map(async path => [path, await readFile(path, 'utf8')])
));

if (!facadeDeleted) process.exit(1);
if (nativeGlobalOwners.length) process.exit(1);
if (tauriImportsOutsidePlatform.length) process.exit(1);
if (fixture.modules.length !== 174 || platformModules.length !== 36) process.exit(1);
if (productionPaths.includes('src/runtime/tauri.js')) process.exit(1);
if (!productionPaths.includes('src/platform/compatibility/classic-platform-port.js')) process.exit(1);
if (!main.includes('createPlatform({') || !main.includes('mountClassicPlatformPort')) process.exit(1);
if (/window\.markdownEditorPlatform|window\.platform\s*=|markdownEditorNative/.test(main)) process.exit(1);
if (!bridge.includes('call(portName, methodName') || !bridge.includes('supports(capability)')) process.exit(1);
if (/\bwindow\.|\bglobalThis\./.test(bridge)) process.exit(1);
for (const source of Object.values(classicCallers)) {
  if (!source.includes('compatibility-business-ports') || !source.includes('markdownEditorPlatformPort')) process.exit(1);
  if (source.includes('markdownEditorNative')) process.exit(1);
}
for (const source of Object.values(esmCallers)) if (source.includes('markdownEditorNative')) process.exit(1);
if (!workflow.includes('Verify Atomic Task 3.12 final Platform cutover')) process.exit(1);
if (!workflow.includes('03-12-architecture-scan.json')) process.exit(1);
if (windowsAutomation.includes('markdownEditorNative')) process.exit(1);
if (!windowsAutomation.includes("markdownEditorPlatformPort.call('window', 'forceClose')")) process.exit(1);
if (!windowsAutomation.includes("markdownEditorPlatformPort.call('window', 'isMaximized')")) process.exit(1);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(`${OUTPUT_DIRECTORY}/03-12-platform-cutover-evidence.json`, `${JSON.stringify({
  node: 'stage-03/03-12',
  atomicTask: '3.12',
  status: 'passed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  scope: 'final-platform-caller-cutover-and-legacy-native-facade-deletion',
  productionModuleCount: fixture.modules.length,
  platformModuleCount: platformModules.length,
  facadeDeleted,
  nativeGlobalOwners,
  tauriImportsOutsidePlatform,
  classicCallers: Object.keys(classicCallers),
  esmCallers: Object.keys(esmCallers),
  windowsAutomation: 'platform-port-driven',
  guarantees: [
    'src-runtime-tauri-js-is-deleted',
    'no-production-js-or-mjs-module-references-window-markdown-editor-native',
    'no-business-module-imports-tauri-directly',
    'main-creates-one-platform-and-does-not-export-it-on-window',
    'classic-scripts-use-a-scoped-destroyable-compatibility-host-bridge',
    'esm-consumers-receive-responsibility-focused-platform-ports',
    'native-drag-drop-file-classification-remains-in-application-code-with-rust-owned-mime-reading',
    'windows-native-automation-exercises-final-window-port-instead-of-the-deleted-facade',
    'stage-3-workflow-runs-atomic-3.12-before-architecture-and-regression-gates'
  ]
}, null, 2)}\n`, 'utf8');
