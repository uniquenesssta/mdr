import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderStageVerificationRecord } from './persistence/render-stage-record.mjs';
import { renderStage0ReadmeEntry, updateStage0Readme } from './persistence/update-readme-record.mjs';

const root = process.cwd();
const reportRoot = resolve(process.env.STAGE0_REPORT_DIR || 'artifacts/stage-00');
const stageDirectory = resolve(root, 'docs/rewrite-progress/stage-00');
const evidenceDirectory = resolve(stageDirectory, 'evidence');
await mkdir(evidenceDirectory, { recursive: true });

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptional(path, fallback = '') {
  try {
    return await readFile(path, 'utf8');
  } catch (_) {
    return fallback;
  }
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

const summary = await readJson(resolve(reportRoot, 'summary/verification-summary.json'));
const environment = await readJson(resolve(reportRoot, 'baseline/environment.json'));
const frozenModels = await readJson(resolve(reportRoot, 'baseline/contracts/frozen-model-hashes.json'));
const tauriCommands = await readJson(resolve(reportRoot, 'baseline/contracts/tauri-commands.json'));
const storageKeys = await readJson(resolve(reportRoot, 'baseline/contracts/storage-keys.json'));
const sourceManifest = await readJson(resolve(reportRoot, 'baseline/source-manifest.json'));
const trackedRuntimeOutput = await readOptional(resolve(reportRoot, 'baseline/tracked-runtime-output.txt'));
const browserLog = await readOptional(resolve(reportRoot, 'checks/browser-app.log'));
const cargoTestLog = await readOptional(resolve(reportRoot, 'checks/cargo-test.log'));
const cargoCheckLog = await readOptional(resolve(reportRoot, 'checks/cargo-check.log'));
const tauriBuildLog = await readOptional(resolve(reportRoot, 'checks/tauri-build.log'));

const checkoutSha = runGit(['rev-parse', 'HEAD']);
const checkoutBranch = runGit(['branch', '--show-current'])
  || process.env.GITHUB_HEAD_REF
  || 'rewrite/modular-rebuild';
const runId = process.env.GITHUB_RUN_ID || 'unknown';
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || 'unknown';
const workflowName = process.env.GITHUB_WORKFLOW || 'Stage 0 Baseline Verification';
const artifactName = `stage-00-baseline-${runId}-${runAttempt}`;
const date = new Date().toISOString().slice(0, 10);
const recordFileName = summary.stageGate === 'passed'
  ? '00-03-baseline-blocker-repair.md'
  : '00-02-baseline-verification-run.md';

const record = renderStageVerificationRecord({
  summary,
  environment,
  frozenModels,
  tauriCommands,
  storageKeys,
  sourceManifest,
  trackedRuntimeOutput,
  browserLog,
  cargoTestLog,
  cargoCheckLog,
  tauriBuildLog,
  workflowName,
  runId,
  runAttempt,
  artifactName,
  checkoutBranch,
  checkoutSha
});
await writeFile(resolve(stageDirectory, recordFileName), record, 'utf8');

const evidenceCopies = [
  ['summary/verification-summary.json', 'verification-summary.json'],
  ['baseline/contracts/frozen-model-hashes.json', 'frozen-model-hashes.json'],
  ['baseline/contracts/tauri-commands.json', 'tauri-commands.json'],
  ['baseline/contracts/storage-keys.json', 'storage-keys.json'],
  ['baseline/baseline-summary.md', 'baseline-summary.md'],
  ['baseline/tracked-runtime-output.txt', 'tracked-runtime-output.txt']
];
for (const [source, target] of evidenceCopies) {
  await copyFile(resolve(reportRoot, source), resolve(evidenceDirectory, target));
}

const readmePath = resolve(root, 'docs/README.md');
const readme = await readFile(readmePath, 'utf8');
const readmeEntry = renderStage0ReadmeEntry({ date, runId, runAttempt, summary });
await writeFile(readmePath, updateStage0Readme(readme, readmeEntry), 'utf8');

console.log(`Persisted Stage 0 run ${runId} as ${recordFileName}; gate=${summary.stageGate}.`);
