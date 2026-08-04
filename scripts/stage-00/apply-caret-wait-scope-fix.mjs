import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve('tests/e2e/run-browser-tests.mjs');
const source = await readFile(path, 'utf8');
const before = `        return editor?.selectionStart===trailingPoint.position\n          && editor?.selectionEnd===trailingPoint.position\n          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;`;
const after = `        return editor?.selectionStart===editor?.textLength\n          && editor?.selectionEnd===editor?.textLength\n          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;`;
if (source.includes(after)) {
  console.log('Caret wait scope fix is already applied.');
} else {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0) throw new Error('Expected caret wait block was not found.');
  if (first !== last) throw new Error('Expected caret wait block is not unique.');
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
  console.log('Caret wait scope fix applied.');
}
