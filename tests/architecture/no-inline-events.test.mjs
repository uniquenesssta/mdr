import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkLegacyRuntime } from '../../scripts/architecture/checks.mjs';
import { createArchitectureFixture, moduleRecord } from './helpers.mjs';

test('rejects any inline-event addition beyond the exact migration baseline', async () => {
  const root = await createArchitectureFixture({
    'index.html': '<button onclick="legacyOpen()">Open</button>\n<script src="/app/core.js"></script>\n',
    'public/app/core.js': 'window.legacyOpen = () => {};\n'
  }, [
    moduleRecord('index.html', { surface: 'html-entrypoint', migration: 'rewrite' }),
    moduleRecord('public/app/core.js', {
      surface: 'legacy-classic-script', lifecycle: 'classic-script', migration: 'rewrite'
    })
  ]);

  assert.deepEqual(await checkLegacyRuntime({ root }), []);
  await writeFile(
    join(root, 'index.html'),
    '<button onclick="legacyOpen()">Open</button>\n<button onfocus="newInline()">New</button>\n<script src="/app/core.js"></script>\n',
    'utf8'
  );
  const issues = await checkLegacyRuntime({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'inline-event-regression'
      && issue.path === 'index.html'
      && issue.line === 2
  )));
});

test('requires every classic script to be explicitly classified and baselined', async () => {
  const root = await createArchitectureFixture({
    'index.html': '<script src="/app/core.js"></script>\n',
    'public/app/core.js': 'window.core = {};\n',
    'public/app/extra.js': 'window.extra = {};\n'
  }, [
    moduleRecord('index.html', { surface: 'html-entrypoint', migration: 'rewrite' }),
    moduleRecord('public/app/core.js', {
      surface: 'legacy-classic-script', lifecycle: 'classic-script', migration: 'rewrite'
    }),
    moduleRecord('public/app/extra.js', {
      surface: 'legacy-classic-script', lifecycle: 'classic-script', migration: 'rewrite'
    })
  ]);

  await writeFile(
    join(root, 'index.html'),
    '<script src="/app/core.js"></script>\n<script src="/app/extra.js"></script>\n',
    'utf8'
  );
  const issues = await checkLegacyRuntime({ root });
  assert.ok(issues.some(issue => (
    issue.rule === 'legacy-classic-script-regression'
      && issue.message.includes('public/app/extra.js')
  )));
});
