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
  `function createBlockDecoration(view, descriptor) {`,
  `function getBlockPresentationRange(view, descriptor) {
  const from = Math.max(0, Number(descriptor?.from) || 0);
  let to = Math.max(from, Number(descriptor?.to) || from);
  const type = String(descriptor?.type || '');
  if ((type === 'code' || type === 'mermaid')
    && to === view.state.doc.length
    && to > from
    && view.state.doc.sliceString(Math.max(from, to - 2), to) === '\\n\\n') {
    to -= 1;
  }
  return { from, to };
}

function createBlockDecoration(view, descriptor) {`,
  'block presentation range helper'
));

changes.push(await replaceExactly(
  'src/editor/hybrid/controller.js',
  `  if (!widget) return null;
  return Decoration.replace({ widget, block: true, inclusive: false }).range(descriptor.from, descriptor.to);`,
  `  if (!widget) return null;
  const presentationRange = getBlockPresentationRange(view, descriptor);
  return Decoration.replace({ widget, block: true, inclusive: false }).range(
    presentationRange.from,
    presentationRange.to
  );`,
  'block replacement presentation range'
));

changes.push(await replaceExactly(
  'src/editor/hybrid/controller.js',
  `    const blockRanges = blocks.map(block => ({ from: block.from, to: block.to }));`,
  `    const blockRanges = blocks.map(block => getBlockPresentationRange(view, block));`,
  'inline block presentation ranges'
));

console.log(changes.some(Boolean)
  ? 'Trailing-line presentation fix updated the working tree.'
  : 'Trailing-line presentation fix made no changes.');
