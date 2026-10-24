// Real default Windows Tauri entry; retain owned fixture/evidence files for review.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRetiredInputsAbsent } from '../../../scripts/stage-16/single-implementation.mjs';
import { verifyBuiltApplication } from '../lib/built-application-check.mjs';
import { verifySingleImplementationRuntime } from '../lib/single-implementation.mjs';
import { withEmbeddedSession } from './embedded-webdriver-session.mjs';

assert.equal(process.platform, 'win32', 'A real Windows Tauri run is required.');
assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_SHA && process.env.MARKDOWN_EDITOR_BINARY);
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const artifactRoot = resolve(process.env.RUNNER_TEMP, 'r12-22-webview');
await mkdir(artifactRoot, { recursive: true });
const evidence = { stage: 'R16.13', platform: 'tauri', commit: process.env.GITHUB_SHA, status: 'running' };
try {
  evidence.before = await verifyRetiredInputsAbsent({ projectRoot });
  evidence.build = await verifyBuiltApplication({ projectRoot });
  const ownedRoot = await mkdtemp(join(process.env.RUNNER_TEMP, 'r16-single-implementation-'));
  const canary = { path: join(ownedRoot, 'canary.md'), text: 'R16 real native entry canary\n' };
  await writeFile(canary.path, canary.text);
  await withEmbeddedSession({ label: 'r16-single-implementation', port: 4592,
    binaryPath: resolve(process.env.MARKDOWN_EDITOR_BINARY), repositoryRoot: projectRoot, artifactDirectory: artifactRoot
  }, async browser => {
    evidence.runtime = await verifySingleImplementationRuntime({ evaluate: (fn, ...args) => browser.inspect(fn, ...args),
      platform: 'tauri', paths: evidence.before.paths, canary });
    await browser.saveScreenshot(join(artifactRoot, 'r16-13-native.png'));
  });
  evidence.after = await verifyRetiredInputsAbsent({ projectRoot });
  evidence.status = 'passed';
  console.log('R16-13 real Windows Tauri single implementation passed.');
} catch (error) {
  evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error;
} finally {
  await writeFile(join(artifactRoot, 'r16-13-native.json'), JSON.stringify(evidence, null, 2) + '\n');
}
