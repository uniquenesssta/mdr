import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const [, , checkId, command, ...args] = process.argv;

if (!checkId || !command) {
  console.error('Usage: node scripts/stage-00/run-check.mjs <check-id> <command> [...args]');
  process.exit(2);
}

const reportRoot = resolve(process.env.STAGE0_REPORT_DIR || 'artifacts/stage-00');
const checksDirectory = resolve(reportRoot, 'checks');
await mkdir(checksDirectory, { recursive: true });

const startedAt = new Date();
const startedHighResolution = process.hrtime.bigint();
const outputChunks = [];

function capture(streamName, chunk) {
  const text = String(chunk);
  outputChunks.push(`[${streamName}] ${text}`);
  const stream = streamName === 'stderr' ? process.stderr : process.stdout;
  stream.write(text);
}

let exitCode = 1;
let signal = null;
let launchError = null;

try {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => capture('stdout', chunk));
  child.stderr.on('data', chunk => capture('stderr', chunk));

  const result = await new Promise(resolveResult => {
    child.once('error', error => resolveResult({ error }));
    child.once('close', (code, closeSignal) => resolveResult({ code, signal: closeSignal }));
  });

  if (result.error) {
    launchError = result.error;
    capture('stderr', `${result.error.stack || result.error.message}\n`);
    exitCode = 127;
  } else {
    exitCode = Number.isInteger(result.code) ? result.code : 1;
    signal = result.signal || null;
  }
} catch (error) {
  launchError = error;
  capture('stderr', `${error.stack || error.message}\n`);
  exitCode = 127;
}

const finishedAt = new Date();
const durationMs = Number(process.hrtime.bigint() - startedHighResolution) / 1_000_000;
const commandLine = [command, ...args].map(value => JSON.stringify(value)).join(' ');
const record = {
  id: checkId,
  command,
  args,
  commandLine,
  cwd: process.cwd(),
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: Math.round(durationMs),
  exitCode,
  signal,
  status: exitCode === 0 ? 'passed' : 'failed',
  launchError: launchError ? String(launchError.stack || launchError.message || launchError) : null,
  runner: {
    os: process.platform,
    architecture: process.arch,
    node: process.version
  }
};

await Promise.all([
  writeFile(resolve(checksDirectory, `${checkId}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8'),
  writeFile(resolve(checksDirectory, `${checkId}.log`), outputChunks.join(''), 'utf8')
]);

console.log(`\n[stage-00] ${checkId}: ${record.status} (exit ${exitCode}, ${record.durationMs} ms)`);
process.exit(exitCode);
