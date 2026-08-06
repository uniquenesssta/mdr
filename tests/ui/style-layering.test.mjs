import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import {
  STYLE_IMPORTS,
  collectTopLevelHeaders,
  expectedStyleEntry,
  readImportedStyles,
  readText,
  splitSelectors
} from './style-test-utils.mjs';

const expectedLayerCounts = Object.freeze({
  foundation: 5,
  themes: 2,
  shell: 6,
  layout: 6,
  components: 12,
  features: 20
});

const legacyShellClasses = Object.freeze([
  'app', 'menu-bar', 'editor-toolbar', 'workspace', 'sidebar', 'sidebar-resizer',
  'main', 'pane', 'editor-pane', 'preview-pane', 'resizer', 'statusbar', 'overlay-root'
]);

function classPattern(name) {
  return new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`, 'i');
}

function featureNamespaces(selector) {
  return new Set([...selector.matchAll(/\.f-([a-z0-9]+(?:-[a-z0-9]+)?)/gi)].map(match => match[1]));
}

test('Atomic Task 2.9 replaces consolidated CSS with explicit responsibility modules', async () => {
  const [entrySource, styles] = await Promise.all([
    readText('src/styles/index.css'),
    readImportedStyles()
  ]);

  assert.equal(entrySource, expectedStyleEntry());
  await assert.rejects(access('src/styles/main.css'));
  assert.equal(styles.length, 51);
  const counts = Object.fromEntries(Object.keys(expectedLayerCounts).map(layer => [layer, 0]));
  for (const { path, source } of styles) {
    const layer = path.split('/')[2];
    counts[layer] += 1;
    if (!path.endsWith('/tokens.css') && !path.includes('/themes/')) {
      assert.match(source, /^\/\* Responsibility: [^\n]+ \*\//, path);
    }
    collectTopLevelHeaders(source);
  }
  assert.deepEqual(counts, expectedLayerCounts);
});

test('each style module stays bounded to one declared responsibility', async () => {
  const styles = await readImportedStyles();
  const sourceByPath = new Map(styles.map(record => [record.path, record.source]));
  for (const { path, source } of styles) {
    assert.ok(source.split('\n').length <= 380, `${path} exceeds the bounded style-module size`);
  }

  const ownershipChecks = Object.freeze({
    'src/styles/foundation/reset.css': [/\.l-/, /\.c-/, /\.f-/],
    'src/styles/components/icon.css': [/\.l-menu-bar/],
    'src/styles/components/table-picker.css': [/\.l-workspace/],
    'src/styles/shell/status-bar.css': [/\.modal-overlay/],
    'src/styles/components/progress.css': [/\.toast\b/, /\.drop-overlay/, /\.editor-presentation-badge/],
    'src/styles/components/drop-overlay.css': [/\.export-image-stage/],
    'src/styles/features/media.css': [/\.l-app-shell/],
    'src/styles/features/content-rendering.css': [/\.l-toolbar-shell/],
    'src/styles/components/link-preview.css': [/\.sidebar-files-panel/],
    'src/styles/shell/window-controls.css': [/\.document-item/],
    'src/styles/layout/split-pane.css': [/\.document-/, /\.preview-content/, /\.menu-button-icon/],
    'src/styles/features/hybrid-media.css': [/\.menu-switch-item/],
    'src/styles/features/hybrid-table.css': [/\.cm-hybrid-code-label-group/],
    'src/styles/features/hybrid-code.css': [/\.cm-hybrid-mermaid-widget/],
    'src/styles/features/hybrid-mermaid.css': [/\.cm-hybrid-inline-math/],
    'src/styles/features/hybrid-math.css': [/\.preview-code-body/],
    'src/styles/features/code-presentation.css': [/html\.has-link-preview/]
  });
  for (const [path, forbiddenPatterns] of Object.entries(ownershipChecks)) {
    const source = sourceByPath.get(path);
    assert.ok(source, path);
    for (const pattern of forbiddenPatterns) assert.doesNotMatch(source, pattern, `${path}: ${pattern}`);
  }
});

test('visual CSS uses class contracts instead of IDs or legacy shell class authority', async () => {
  const styles = await readImportedStyles();
  const visualStyles = styles.filter(record => !record.path.includes('/themes/') && !record.path.endsWith('/tokens.css'));
  const selectors = visualStyles.flatMap(({ path, source }) => collectTopLevelHeaders(source)
    .flatMap(splitSelectors)
    .map(selector => ({ path, selector })));

  for (const { path, selector } of selectors) {
    assert.doesNotMatch(selector, /#[a-z_][a-z0-9_-]*/i, `${path}: ${selector}`);
    for (const legacy of legacyShellClasses) {
      assert.doesNotMatch(selector, classPattern(legacy), `${path}: legacy visual shell selector .${legacy}`);
    }
  }

  const allSelectors = selectors.map(record => record.selector).join('\n');
  for (const required of [
    '.l-app-shell', '.l-menu-bar', '.l-toolbar-shell', '.l-workspace', '.l-sidebar',
    '.l-split-pane', '.l-pane', '.c-modal--narrow', '.f-editor-surface',
    '.f-preview-surface', '.is-collapsed', '.has-link-preview'
  ]) assert.match(allSelectors, new RegExp(required.replace('.', '\\.')), required);
});

test('layered selectors do not cross independent feature namespaces', async () => {
  const styles = await readImportedStyles();
  for (const { path, source } of styles) {
    for (const selector of collectTopLevelHeaders(source).flatMap(splitSelectors)) {
      const namespaces = featureNamespaces(selector);
      assert.ok(namespaces.size <= 1, `${path}: cross-feature selector ${selector}`);
    }
  }
});

test('stable compatibility presentation has no inline style authority', async () => {
  const [markup, shellSources, clipperSource, exportSource] = await Promise.all([
    readText('public/compatibility/business-content.html'),
    Promise.all([
      'src/ui/shell/app-shell-view.js',
      'src/ui/shell/menu-bar-shell.js',
      'src/ui/shell/toolbar-shell.js',
      'src/ui/shell/sidebar-shell.js',
      'src/ui/shell/workspace-shell.js',
      'src/ui/shell/status-bar-shell.js',
      'src/ui/shell/overlay-root.js'
    ].map(readText)),
    readText('public/app/web-clipper.js'),
    readText('public/app/export.js')
  ]);

  assert.doesNotMatch(markup, /\sstyle\s*=/i);
  assert.match(markup, /class="modal c-modal c-modal--narrow"/);
  assert.match(markup, /class="color-swatch c-color-swatch--text-blue"/);
  assert.match(markup, /id="export-image-preview"[^>]+class="f-export-image-preview is-hidden"/);
  for (const source of shellSources) assert.doesNotMatch(source, /\.style\b|style\s*:/);
  assert.doesNotMatch(clipperSource, /\.style\.(?:display|color)\s*=/);
  assert.doesNotMatch(exportSource, /getElementById\('export-image-preview'\)[\s\S]{0,120}\.style\.display/);

  const stableStyleSources = await Promise.all([
    'public/app/preview.js',
    'public/app/export.js',
    'src/preview/preview-worker.js',
    'src/rendering/mermaid-presentation.js',
    'src/editor/hybrid/widgets.js'
  ].map(readText));
  const combinedStableSources = stableStyleSources.join('\n');
  assert.doesNotMatch(combinedStableSources, /<pre\s+style=/i);
  assert.doesNotMatch(combinedStableSources, /textarea\.style\.(?:position|opacity)/);
  assert.doesNotMatch(combinedStableSources, /svg\.style\.(?:maxWidth|height|background)/);
  assert.match(combinedStableSources, /f-raw-fallback/);
  assert.match(combinedStableSources, /f-mermaid-svg/);
  assert.match(combinedStableSources, /c-clipboard-buffer/);
});

test('prefixed shell classes are visual authority while legacy classes remain bounded compatibility hooks', async () => {
  const [shellSources, coreSource, bootstrapSource, editorToolsSource, linkPreviewSource] = await Promise.all([
    Promise.all([
      'src/ui/shell/app-shell-view.js',
      'src/ui/shell/menu-bar-shell.js',
      'src/ui/shell/toolbar-shell.js',
      'src/ui/shell/sidebar-shell.js',
      'src/ui/shell/workspace-shell.js',
      'src/ui/shell/status-bar-shell.js',
      'src/ui/shell/overlay-root.js'
    ].map(readText)),
    readText('public/app/core.js'),
    readText('public/app/bootstrap.js'),
    readText('public/app/editor-tools.js'),
    readText('src/runtime/link-preview.js')
  ]);
  const shellSource = shellSources.join('\n');
  for (const contract of [
    "className: 'l-app-shell app'",
    "className: 'l-menu-bar menu-bar'",
    "className: 'l-toolbar-shell editor-toolbar'",
    "className: 'l-sidebar sidebar'",
    "className: 'l-workspace workspace'",
    "className: 'l-split-pane main'",
    "className: 'l-pane f-editor-pane pane editor-pane'",
    "className: 'l-pane f-preview-pane pane preview-pane'",
    "className: 'l-status-bar statusbar'",
    "className: 'l-overlay-root overlay-root'"
  ]) assert.match(shellSource, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(coreSource, /classList\.toggle\('is-hidden'/);
  assert.match(coreSource, /classList\.toggle\('is-collapsed'/);
  assert.match(coreSource, /classList\.add\('resizing', 'sidebar-resizing', 'is-resizing', 'is-sidebar-resizing'\)/);
  assert.match(bootstrapSource, /classList\.add\('page-fullscreen', 'is-page-fullscreen'\)/);
  assert.match(editorToolsSource, /classList\.toggle\('is-page-fullscreen'\)/);
  assert.match(linkPreviewSource, /classList\.add\('link-preview-open', 'has-link-preview'\)/);
});
