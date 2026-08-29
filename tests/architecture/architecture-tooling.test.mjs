import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkGeneratedFiles,
  checkReadmeRecord
} from '../../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './helpers.mjs';

const verifyGeneratedFiles = resolve(
  import.meta.dirname,
  '../../scripts/verify-generated-files.mjs'
);

test('rejects new tracked generated output and forbidden migration suffixes', async () => {
  const root = await createArchitectureFixture({
    'src/main.js': 'export const ready = true;\n'
  }, [moduleRecord('src/main.js', { surface: 'esm-entrypoint' })]);

  const generated = join(root, 'logs/new.jsonl');
  await mkdir(dirname(generated), { recursive: true });
  await writeFile(generated, '{}\n', 'utf8');
  spawnSync('git', ['add', 'logs/new.jsonl'], { cwd: root });
  await writeFile(join(root, 'src/service-final.js'), 'export {};\n', 'utf8');
  spawnSync('git', ['add', 'src/service-final.js'], { cwd: root });

  const issues = await checkGeneratedFiles({ root });
  assert.ok(issues.some(issue => issue.rule === 'tracked-generated-file-regression'));
  assert.ok(issues.some(issue => (
    issue.rule === 'legacy-file-suffix' && issue.path === 'src/service-final.js'
  )));

  const cli = spawnSync(process.execPath, [verifyGeneratedFiles, `--root=${root}`], {
    encoding: 'utf8'
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /logs\/new\.jsonl/);
  assert.match(cli.stderr, /src\/service-final\.js/);
});

test('requires one newest-first README record for every Stage 1 detail document', async () => {
  const root = await createArchitectureFixture({
    'docs/rewrite-progress/stage-01/01-01-inventory.md': '# 1.1\n',
    'docs/rewrite-progress/stage-01/01-02-root.md': '# 1.2\n',
    'docs/README.md': [
      '# Fixture',
      '',
      '## Change Log',
      '<!-- stage-01-node:01-01 -->',
      '- 2026-08-05：1.1 complete.',
      ''
    ].join('\n')
  }, []);

  const issues = await checkReadmeRecord({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'readme-missing-stage-record'
      && issue.message.includes('01-02')
  )));
});
