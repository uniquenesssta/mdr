import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function replaceExactly(path, before, after, label) {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath, 'utf8');
  if (source.includes(after)) {
    console.log(`${label}: already applied`);
    return false;
  }
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block was not found`);
  if (first !== last) throw new Error(`${label}: expected source block is not unique`);
  await writeFile(absolutePath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
  console.log(`${label}: applied`);
  return true;
}

const changes = [];

changes.push(await replaceExactly(
  'src/editor/hybrid/controller.js',
  `import { clearHybridComponentStates } from './component-state.js';\nimport {`,
  `import { clearHybridComponentStates } from './component-state.js';\nimport { scheduleHybridWidgetGeometry } from './widget-lifecycle.js';\nimport {`,
  'hybrid geometry scheduler import'
));

changes.push(await replaceExactly(
  'src/runtime/e2e-bridge.js',
  `  if (options.preserveSelection !== true) {\n    editor.setSelectionRange(safePosition, safePosition);\n    editor.focus({ preventScroll: true });\n  }`,
  `  if (options.preserveSelection !== true) {\n    editor.focus({ preventScroll: true });\n    await waitForAnimationFrames(1);\n    editor.setSelectionRange(safePosition, safePosition);\n  }`,
  'focused E2E selection update'
));

changes.push(await replaceExactly(
  'tests/e2e/run-browser-tests.mjs',
  `      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });\n      const snapshot = await browser.page.evaluate`,
  `      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });\n      await browser.page.waitFor(() => document.getElementById('editor')?.virtualEditor?.getPresentationStats?.().sourceActiveLines === 1, { description: 'trailing source active line' });\n      const snapshot = await browser.page.evaluate`,
  'trailing active-line stabilization'
));

console.log(changes.some(Boolean)
  ? 'Final Stage 0 browser fixes updated the working tree.'
  : 'Final Stage 0 browser fixes made no changes.');
