import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const enforce = process.argv.includes('--enforce');
const reportRoot = resolve(process.env.STAGE0_REPORT_DIR || 'artifacts/stage-00');
const checksDirectory = resolve(reportRoot, 'checks');
const summaryDirectory = resolve(reportRoot, 'summary');
await mkdir(summaryDirectory, { recursive: true });

const requiredChecks = new Set([
  'rust-toolchain',
  'tauri-system-deps',
  'npm-ci',
  'npm-test',
  'browser-contract',
  'frontend-build',
  'browser-app',
  'cargo-test',
  'cargo-check'
]);
const extendedChecks = new Set(['tauri-build']);

let files = [];
try {
  files = (await readdir(checksDirectory)).filter(name => name.endsWith('.json')).sort();
} catch (_) {
  files = [];
}

const records = [];
for (const file of files) {
  try {
    records.push(JSON.parse(await readFile(resolve(checksDirectory, file), 'utf8')));
  } catch (error) {
    records.push({
      id: file.replace(/\.json$/, ''),
      status: 'invalid-record',
      exitCode: null,
      error: String(error.message || error)
    });
  }
}

const byId = new Map(records.map(record => [record.id, record]));
const requiredResults = [...requiredChecks].map(id => byId.get(id) || ({ id, status: 'missing', exitCode: null }));
const extendedResults = [...extendedChecks].map(id => byId.get(id) || ({ id, status: 'missing', exitCode: null }));
const requiredFailures = requiredResults.filter(record => record.status !== 'passed');
const extendedFailures = extendedResults.filter(record => record.status !== 'passed');

const summary = {
  generatedAt: new Date().toISOString(),
  requiredChecks: requiredResults,
  extendedChecks: extendedResults,
  requiredPassed: requiredFailures.length === 0,
  extendedPassed: extendedFailures.length === 0,
  stageGate: requiredFailures.length === 0 ? 'passed' : 'failed',
  requiredFailures: requiredFailures.map(record => ({ id: record.id, status: record.status, exitCode: record.exitCode })),
  extendedFailures: extendedFailures.map(record => ({ id: record.id, status: record.status, exitCode: record.exitCode }))
};

const formatRecord = record => {
  const duration = Number.isFinite(record.durationMs) ? `, ${record.durationMs} ms` : '';
  const exitCode = record.exitCode === null || record.exitCode === undefined ? '' : `, exit ${record.exitCode}`;
  return `- ${record.id}: ${record.status}${exitCode}${duration}`;
};

const markdown = [
  '# Stage 0 verification summary',
  '',
  `- Generated at: ${summary.generatedAt}`,
  `- Required gate: ${summary.stageGate}`,
  `- Extended Tauri build: ${summary.extendedPassed ? 'passed' : 'failed or missing'}`,
  '',
  '## Required checks',
  '',
  ...requiredResults.map(formatRecord),
  '',
  '## Extended checks',
  '',
  ...extendedResults.map(formatRecord),
  ''
].join('\n');

await Promise.all([
  writeFile(resolve(summaryDirectory, 'verification-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
  writeFile(resolve(summaryDirectory, 'verification-summary.md'), markdown, 'utf8')
]);

console.log(markdown);
if (enforce && requiredFailures.length > 0) process.exit(1);
