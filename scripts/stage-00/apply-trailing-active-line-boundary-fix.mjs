import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve('src/editor/hybrid/inline-presentation.js');
let source = await readFile(path, 'utf8');

const oldHelper = `function normalizeTrailingEmptyCaretRanges(view, editableRanges) {
  const selection = view.state.selection.main;
  const documentLength = view.state.doc.length;
  if (view.hasFocus === false
    || !selection.empty
    || selection.head !== documentLength) return editableRanges;

  const trailingLine = view.state.doc.lineAt(documentLength);
  if (trailingLine.from !== documentLength || trailingLine.to !== documentLength) {
    return editableRanges;
  }

  let replaced = false;
  const normalized = [];
  for (const range of editableRanges || []) {
    const from = Number(range?.from);
    const to = Number(range?.to);
    if (range?.revealBlock
      && Number.isFinite(from)
      && Number.isFinite(to)
      && from <= documentLength
      && documentLength <= to) {
      if (!replaced) {
        normalized.push({
          from: documentLength,
          to: documentLength,
          revealBlock: true
        });
        replaced = true;
      }
      continue;
    }
    normalized.push(range);
  }
  return replaced ? normalized : editableRanges;
}

export function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {
  editableRanges = normalizeTrailingEmptyCaretRanges(view, editableRanges);
  const ranges = [];`;

const newHelper = `function getTrailingEmptyCaretLineFrom(view) {
  const selection = view.state.selection.main;
  const documentLength = view.state.doc.length;
  if (view.hasFocus === false
    || !selection.empty
    || selection.head !== documentLength) return null;
  const trailingLine = view.state.doc.lineAt(documentLength);
  return trailingLine.from === documentLength && trailingLine.to === documentLength
    ? trailingLine.from
    : null;
}

function shouldDecoratePresentationSourceActiveLine(
  editableRanges,
  blockRanges,
  from,
  to,
  trailingEmptyCaretLineFrom
) {
  if (trailingEmptyCaretLineFrom !== null) {
    const safeFrom = Math.max(0, Number(from) || 0);
    const safeTo = Math.max(safeFrom + 1, Number(to) || safeFrom);
    return safeFrom === trailingEmptyCaretLineFrom
      && !overlapsRanges(blockRanges, safeFrom, safeTo);
  }
  return shouldDecorateSourceActiveLine(editableRanges, blockRanges, from, to);
}

export function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {
  const trailingEmptyCaretLineFrom = getTrailingEmptyCaretLineFrom(view);
  const ranges = [];`;

if (source.includes(newHelper)) {
  console.log('Trailing active-line helper is already applied.');
} else {
  const first = source.indexOf(oldHelper);
  const last = source.lastIndexOf(oldHelper);
  if (first < 0) throw new Error('Existing trailing caret helper was not found.');
  if (first !== last) throw new Error('Existing trailing caret helper is not unique.');
  source = source.slice(0, first) + newHelper + source.slice(first + oldHelper.length);
}

const oldCall = `shouldDecorateSourceActiveLine(editableRanges, blockRanges, line.from, line.to)`;
const newCall = `shouldDecoratePresentationSourceActiveLine(
        editableRanges,
        blockRanges,
        line.from,
        line.to,
        trailingEmptyCaretLineFrom
      )`;

if (!source.includes(newCall)) {
  const matches = source.split(oldCall).length - 1;
  if (matches !== 2) throw new Error(`Expected 2 source-active call sites, found ${matches}.`);
  source = source.split(oldCall).join(newCall);
}

await writeFile(path, source, 'utf8');
console.log('Trailing active-line boundary fix applied.');
