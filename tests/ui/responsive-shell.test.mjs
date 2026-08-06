import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

function cssBlocks(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')), match => match[1]);
}

function cssBlock(source, selector) {
  const blocks = cssBlocks(source, selector);
  assert.ok(blocks.length, `missing CSS block: ${selector}`);
  return blocks[0];
}

test('Atomic Task 2.10 owns a reusable CDP viewport boundary', async () => {
  const source = await read('tests/e2e/lib/cdp-browser.mjs');
  assert.match(source, /async setViewport\(options = \{\}\)/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride/);
  assert.match(source, /Viewport width and height must be positive finite numbers/);
});

test('responsive application verification covers every required width and short height', async () => {
  const source = await read('tests/e2e/run-browser-tests.mjs');
  for (const width of [1280, 900, 720, 600]) {
    assert.match(source, new RegExp(`width:\\s*${width}\\b`), `missing ${width}px viewport`);
  }
  assert.match(source, /height:\s*480\b/);
  assert.match(source, /responsive-shell-report\.json/);
  assert.match(source, /no structural overflow or clipped focus across required viewports/);
  assert.match(source, /viewportIssues/);
  assert.match(source, /focusIssues/);
  assert.match(source, /focus\(\{preventScroll:true\}\)/);
  assert.match(source, /reason:'page-scroll'/);
  assert.equal((source.match(/if\(document\.activeElement===source\)source\.blur\(\);/g) ?? []).length, 2);
  assert.equal((source.match(/source\?\.remove\(\);/g) ?? []).length, 2);
});

test('responsive shell CSS contains bounded flex and status-bar geometry', async () => {
  const [sidebarLayout, statusBar, compactSplit] = await Promise.all([
    read('src/styles/layout/sidebar-layout.css'),
    read('src/styles/shell/status-bar.css'),
    read('src/styles/layout/compact-split.css')
  ]);
  const splitPane = cssBlock(sidebarLayout, '.l-split-pane');
  assert.match(splitPane, /min-width:\s*0/);
  assert.match(splitPane, /min-height:\s*0/);

  const statusBlocks = cssBlocks(statusBar, '.l-status-bar');
  assert.ok(statusBlocks.some(block => /min-width:\s*0/.test(block) && /overflow:\s*hidden/.test(block)));
  const statusLeft = cssBlock(statusBar, '.statusbar-left');
  assert.match(statusLeft, /overflow:\s*hidden/);
  assert.match(statusLeft, /min-width:\s*0/);

  assert.match(compactSplit, /\.l-workspace,\s*\n\s*\.l-split-pane,\s*\n\s*\.l-pane\s*\{/);
});

test('Stage 2 workflow runs the 2.10 contract and uploads viewport evidence', async () => {
  const workflow = await read('.github/workflows/stage-02-atomic.yml');
  assert.match(workflow, /Verify Atomic Task 2\.10 responsive shell/);
  assert.match(workflow, /node --test tests\/ui\/responsive-shell\.test\.mjs/);
  assert.match(workflow, /E2E_ARTIFACT_DIR:\s*artifacts\/stage-02\/browser-app/);
});
