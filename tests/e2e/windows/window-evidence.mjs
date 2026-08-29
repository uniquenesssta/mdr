import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function createWindowEvidence({
  outputPath = 'artifacts/stage-03/windows-window/window-automation-evidence.json',
  metadata = {}
} = {}) {
  const evidence = {
    schemaVersion: 1,
    kind: 'stage-03-windows-native-window-automation',
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    metadata: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      githubRunId: process.env.GITHUB_RUN_ID || null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      githubSha: process.env.GITHUB_SHA || null,
      ...metadata
    },
    checks: []
  };
  const absoluteOutput = resolve(outputPath);

  async function persist() {
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  return Object.freeze({
    async record(name, run) {
      const check = {
        name,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'running',
        details: null,
        error: null
      };
      evidence.checks.push(check);
      await persist();

      try {
        check.details = await run();
        check.status = 'passed';
        return check.details;
      } catch (error) {
        check.status = 'failed';
        check.error = {
          name: error?.name || 'Error',
          message: error?.message || String(error),
          stack: error?.stack || null
        };
        throw error;
      } finally {
        check.completedAt = new Date().toISOString();
        await persist();
      }
    },

    async complete(status = 'passed') {
      evidence.status = status;
      evidence.completedAt = new Date().toISOString();
      await persist();
      return evidence;
    },

    snapshot() {
      return structuredClone(evidence);
    }
  });
}
