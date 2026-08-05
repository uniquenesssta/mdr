import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ICON_ID_PATTERN,
  ICON_SPRITE_URL,
  assertIconId,
  createIconView,
  getIconHref
} from '../src/ui/components/icon-view.js';
import {
  collectIconReferences,
  inspectSvgSprite
} from '../scripts/stage-02/icon-sprite/inspect-svg-sprite.mjs';

const root = process.cwd();
const readText = path => readFile(resolve(root, path), 'utf8');
const expectedIconIds = Object.freeze([
  'icon-save', 'icon-upload', 'icon-download', 'icon-globe', 'icon-help',
  'icon-menu-file', 'icon-menu-edit', 'icon-menu-view', 'icon-menu-insert',
  'icon-trash', 'icon-sun', 'icon-book', 'icon-folder', 'icon-image',
  'icon-search', 'icon-undo', 'icon-redo', 'icon-quote', 'icon-list',
  'icon-list-numbered', 'icon-task', 'icon-code', 'icon-braces', 'icon-link',
  'icon-table', 'icon-layout', 'icon-chevron-left', 'icon-chevron-right',
  'icon-close', 'icon-minimize', 'icon-maximize', 'icon-restore',
  'icon-upload-cloud', 'icon-chevron-down', 'icon-mermaid'
]);

class FakeSvgNode {
  constructor(namespace, tagName) {
    this.namespaceURI = namespace;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { this.children.push(child); return child; }
}

const fakeDocument = {
  createElementNS(namespace, tagName) {
    return new FakeSvgNode(namespace, tagName);
  }
};

test('Atomic Task 2.3 sprite has one stable definition for every preserved icon ID', async () => {
  const sprite = await readText('public/assets/icons.svg');
  const inspection = inspectSvgSprite(sprite);
  assert.deepEqual(inspection.ids, expectedIconIds);
  assert.equal(inspection.symbolCount, 35);
  assert.equal(inspection.uniqueSymbolCount, 35);
  assert.deepEqual(inspection.duplicates, []);
  assert.deepEqual(inspection.invalidIds, []);
  assert.deepEqual(inspection.missingViewBoxes, []);
  assert.equal(inspection.forbiddenMarkup, false);
  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  assert.doesNotMatch(sprite, /<script\b|\son[a-z]+\s*=|<title\b|<desc\b|\sdata-[\w-]+\s*=|\saria-label\s*=/i);
});

test('compatibility and dynamic callers reference the external sprite without a second geometry authority', async () => {
  const [shell, core, events, linkPreview, folderTree, browserTest] = await Promise.all([
    readText('public/compatibility/current-shell.html'),
    readText('public/app/core.js'),
    readText('public/app/events.js'),
    readText('src/runtime/link-preview.js'),
    readText('src/sidebar/folder-file-tree.js'),
    readText('tests/e2e/run-browser-tests.mjs')
  ]);
  const shellReferences = collectIconReferences(shell);
  assert.equal(shellReferences.length, 50);
  assert.ok(shellReferences.every(record => record.href === `${ICON_SPRITE_URL}#${record.iconId}`));
  assert.ok(shellReferences.every(record => expectedIconIds.includes(record.iconId)));
  assert.doesNotMatch(shell, /<symbol\b|class="icon-sprite"|href="#icon-/i);
  assert.match(core, /\/assets\/icons\.svg#icon-chevron-left/);
  assert.match(core, /\/assets\/icons\.svg#icon-chevron-right/);
  assert.match(events, /\/assets\/icons\.svg#icon-restore/);
  assert.match(events, /\/assets\/icons\.svg#icon-maximize/);
  assert.match(linkPreview, /import \{ createIconView \} from '\.\.\/ui\/components\/icon-view\.js'/);
  assert.match(folderTree, /import \{ createIconView, getIconHref \} from '\.\.\/ui\/components\/icon-view\.js'/);
  assert.doesNotMatch(folderTree, /function createIcon\(/);
  assert.doesNotMatch(browserTest, /<symbol\b[^>]*id="icon-/i);
});

test('icon-view is a pure generic renderer with decorative and labelled accessibility modes', () => {
  assert.equal(ICON_SPRITE_URL, '/assets/icons.svg');
  assert.ok(ICON_ID_PATTERN.test('icon-chevron-right'));
  assert.equal(assertIconId(' icon-close '), 'icon-close');
  assert.equal(getIconHref('icon-close'), '/assets/icons.svg#icon-close');
  assert.equal(getIconHref('icon-close', '/custom/sprite.svg'), '/custom/sprite.svg#icon-close');
  assert.throws(() => assertIconId('save-document'), /Invalid icon ID/);
  assert.throws(() => getIconHref('icon-close', '/sprite.svg#nested'), /without a fragment/);
  assert.throws(() => createIconView(null, 'icon-close'), /requires a document/);

  const decorative = createIconView(fakeDocument, 'icon-close', { className: 'icon icon-sm' });
  assert.equal(decorative.tagName, 'svg');
  assert.equal(decorative.getAttribute('class'), 'icon icon-sm');
  assert.equal(decorative.getAttribute('focusable'), 'false');
  assert.equal(decorative.getAttribute('aria-hidden'), 'true');
  assert.equal(decorative.getAttribute('role'), null);
  assert.equal(decorative.children[0].getAttribute('href'), '/assets/icons.svg#icon-close');

  const labelled = createIconView(fakeDocument, 'icon-help', { ariaLabel: '帮助' });
  assert.equal(labelled.getAttribute('aria-hidden'), null);
  assert.equal(labelled.getAttribute('role'), 'img');
  assert.equal(labelled.getAttribute('aria-label'), '帮助');
});
