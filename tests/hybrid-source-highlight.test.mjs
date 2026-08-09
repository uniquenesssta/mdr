import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldDecorateSourceActiveLine } from '../src/editor/hybrid/ranges.js';

test('source-active highlighting never leaks onto a rendered block placeholder line', () => {
  const editable = [{ from: 0, to: 80, revealBlock: true }];
  const blocks = [{ from: 0, to: 60 }];

  assert.equal(shouldDecorateSourceActiveLine(editable, blocks, 0, 3), false);
  assert.equal(shouldDecorateSourceActiveLine(editable, blocks, 20, 20), false);
  assert.equal(shouldDecorateSourceActiveLine(editable, blocks, 60, 60), true);
  assert.equal(shouldDecorateSourceActiveLine(editable, blocks, 61, 70), true);
});

test('hybrid source highlight wiring keeps code widgets compatible and suppresses false pointer warnings', async () => {
  const registry = await readFile(new URL('../src/editor/hybrid/block-registry.js', import.meta.url), 'utf8');
  const ranges = await readFile(new URL('../src/editor/hybrid/ranges.js', import.meta.url), 'utf8');
  const inline = await readFile(new URL('../src/editor/hybrid/inline-presentation.js', import.meta.url), 'utf8');
  const pointer = await readFile(new URL('../src/editor/pointer-selection/precise-pointer-selection.js', import.meta.url), 'utf8');

  assert.doesNotMatch(registry, /isClosedFencedCodeSource/);
  assert.match(ranges, /shouldDecorateSourceActiveLine/);
  assert.match(inline, /shouldDecorateSourceActiveLine/);
  assert.match(pointer, /if \(positionChanged \|\| lineChanged\)/);
});
