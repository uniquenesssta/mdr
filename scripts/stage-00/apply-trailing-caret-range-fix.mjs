import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve('src/editor/hybrid/inline-presentation.js');
const source = await readFile(path, 'utf8');

const signature = `export function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {\n  const ranges = [];`;
const replacement = `function normalizeTrailingEmptyCaretRanges(view, editableRanges) {\n  const selection = view.state.selection.main;\n  const documentLength = view.state.doc.length;\n  if (view.hasFocus === false\n    || !selection.empty\n    || selection.head !== documentLength) return editableRanges;\n\n  const trailingLine = view.state.doc.lineAt(documentLength);\n  if (trailingLine.from !== documentLength || trailingLine.to !== documentLength) {\n    return editableRanges;\n  }\n\n  let replaced = false;\n  const normalized = [];\n  for (const range of editableRanges || []) {\n    const from = Number(range?.from);\n    const to = Number(range?.to);\n    if (range?.revealBlock\n      && Number.isFinite(from)\n      && Number.isFinite(to)\n      && from <= documentLength\n      && documentLength <= to) {\n      if (!replaced) {\n        normalized.push({\n          from: documentLength,\n          to: documentLength,\n          revealBlock: true\n        });\n        replaced = true;\n      }\n      continue;\n    }\n    normalized.push(range);\n  }\n  return replaced ? normalized : editableRanges;\n}\n\nexport function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {\n  editableRanges = normalizeTrailingEmptyCaretRanges(view, editableRanges);\n  const ranges = [];`;

if (source.includes(replacement)) {
  console.log('Trailing caret presentation range fix is already applied.');
} else {
  const first = source.indexOf(signature);
  const last = source.lastIndexOf(signature);
  if (first < 0) throw new Error('Inline presentation signature was not found.');
  if (first !== last) throw new Error('Inline presentation signature is not unique.');
  await writeFile(path, source.slice(0, first) + replacement + source.slice(first + signature.length), 'utf8');
  console.log('Trailing caret presentation range fix applied.');
}
