import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const file = path => resolve(ROOT, path);
const read = path => readFile(file(path), 'utf8');
const LATER_SELECTION_FILES = [
  'src/features/sync/selection/selection-sync-controller.js',
];

test('R9-09 creates canonical SelectionHighlightSession and exports it only through the Sync public entry', async () => {
  const index = await read('src/features/sync/index.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(index, /R9-09/);
  assert.match(session, /export class SelectionHighlightSession/);
  assert.match(session, /export function createSelectionHighlightSession/);
  assert.match(index, /\.\/selection\/selection-highlight-session\.js/);
});

test('R9-09 Highlight Session owns highlight effects/remount intent only and contains no mapping feedback retry scroll or event authority', async () => {
  const source = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(source, /HIGHLIGHT_NAME = 'preview-selection-sync'/);
  assert.match(source, /new this\.HighlightCtor\(\.\.\.ranges\)/);
  assert.match(source, /this\.restoreFactory/);
  assert.match(source, /clearEffects\(\)/);
  assert.doesNotMatch(source, /selectionMapping|markdownEditorDocumentModel|editor\.value|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource|setTimeout|requestAnimationFrame|addEventListener|scrollTo|feedbackGuard|SelectionFeedbackGuard/);
});

test('R9-09 classic selection mapping only builds plans and delegates all CSS/class/text highlight effects to the scoped Session', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  assert.match(legacy, /markdownEditorSelectionHighlightSession/);
  assert.match(legacy, /selectionHighlightSession\.canPresent/);
  assert.match(legacy, /selectionHighlightSession\.show/);
  assert.match(legacy, /selectionHighlightSession\.clear\(\)/);
  assert.doesNotMatch(legacy, /CSS\.highlights|new Highlight\(|preview-atomic-selection-highlight|preview-text-highlight|preview-source-highlight/);
});

test('R9-09 preserves mapping builders and frozen selection mapping for R9-11 instead of moving algorithms into Highlight Session', async () => {
  const legacy = await read('public/app/scroll-sync.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(legacy, /highlightMappedSourceRangeInPreview/);
  assert.match(legacy, /createPreviewRangesForSourceSelection/);
  assert.match(legacy, /mapPreviewDomPointToSource/);
  assert.doesNotMatch(session, /createPreviewRangesForSourceSelection|mapPreviewDomPointToSource|buildNormalizedTextMap|normalizeSearchText/);
  const frozen = await read('src/sync/selection-mapping.js');
  assert.doesNotMatch(frozen, /R9-09/);
});

test('R9-09 composition creates one Session from preview-scoped DOM/CSS capabilities injects it and destroys it without a window highlight global', async () => {
  const main = await read('src/main.js');
  assert.match(main, /createSelectionHighlightSession/);
  assert.match(main, /const selectionHighlightSession = createSelectionHighlightSession\(\{/);
  assert.match(main, /markdownEditorSelectionHighlightSession = selectionHighlightSession/);
  assert.match(main, /highlightSession: selectionHighlightSession/);
  assert.match(main, /selectionHighlightSession\.destroy\(\)/);
  assert.doesNotMatch(main, /window\.markdownEditorSelectionHighlightSession/);
  assert.doesNotMatch(main, /\.\/features\/sync\/selection\/selection-highlight-session\.js/);
});

test('R9-09 virtual remount recovery is delegated by SelectionSyncController without Session-owned retry scheduling', async () => {
  const controller = await read('src/sync/selection-controller.js');
  const session = await read('src/features/sync/selection/selection-highlight-session.js');
  assert.match(controller, /this\.highlightSession\.restore\(\)/);
  assert.match(controller, /notifyPreviewMounted/);
  assert.match(controller, /this\.highlightSession\.clear\(\)/);
  assert.doesNotMatch(session, /MAX_RETRIES|setTimer|scheduleFrame|scheduleRetry|retryCount|retryTimer/);
});

test('R9-09 keeps prior owners and frozen mapping untouched and does not advance R9-11+', async () => {
  await access(file('src/features/sync/selection/editor-selection-reader.js'));
  await access(file('src/features/sync/selection/preview-selection-reader.js'));
  await access(file('src/features/sync/selection/selection-feedback-guard.js'));
  await access(file('src/sync/selection-mapping.js'));
  for (const path of LATER_SELECTION_FILES) await assert.rejects(access(file(path)), path);
});

test('R9-09 production inventory records one Highlight Session responsibility and cardinality 381 after R9-10 inventory growth', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  const records = new Map(inventory.modules.map(record => [record[0], record]));
  assert.equal(inventory.modules.length, 381);
  assert.equal(records.get('src/features/sync/selection/selection-highlight-session.js')?.[4], 'selection-highlight-session-lifecycle');
});
