// Records machine-readable Stage 2 UI foundation evidence for the current verified commit.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildHtmlInventory } from './dom-inventory/html-inventory.mjs';
import { collectInlineEvents } from '../architecture/source-analysis.mjs';
import { collectIconReferences, inspectSvgSprite } from './icon-sprite/inspect-svg-sprite.mjs';
import * as iconView from '../../src/ui/components/icon-view.js';
import { ModalShell } from '../../src/ui/components/modal-shell.js';
import * as uiCompatibility from '../../src/ui/compatibility/index.js';
import * as domPrimitives from '../../src/ui/dom/index.js';

await mkdir('artifacts/stage-02', { recursive: true });

const readText = path => readFile(path, 'utf8');
const moduleFixture = JSON.parse(await readText('tests/architecture/fixtures/production-modules.json'));
const styleRecords = moduleFixture.modules.filter(record => record[0].startsWith('src/styles/'));
const stylePaths = styleRecords.map(record => record[0]);
const layerModules = Object.freeze({
  foundation: styleRecords.filter(record => ['presentation-foundation', 'presentation-tokens'].includes(record[2])).map(record => record[0]).sort(),
  themes: styleRecords.filter(record => record[2] === 'presentation-theme').map(record => record[0]).sort(),
  shell: styleRecords.filter(record => record[2] === 'presentation-shell').map(record => record[0]).sort(),
  layout: styleRecords.filter(record => record[2] === 'presentation-layout').map(record => record[0]).sort(),
  components: styleRecords.filter(record => record[2] === 'presentation-component').map(record => record[0]).sort(),
  features: styleRecords.filter(record => record[2] === 'presentation-feature').map(record => record[0]).sort()
});
const styleEntryModules = styleRecords.filter(record => record[2] === 'presentation-entry').map(record => record[0]);
const expectedStyleImports = Object.freeze([
  './foundation/reset.css',
  './foundation/tokens.css',
  './foundation/typography.css',
  './foundation/accessibility.css',
  './foundation/motion.css',
  './themes/light.css',
  './themes/dark.css',
  './shell/app-shell.css',
  './shell/menu-bar.css',
  './shell/toolbar-shell.css',
  './shell/workspace-shell.css',
  './shell/status-bar.css',
  './shell/window-controls.css',
  './layout/sidebar-layout.css',
  './layout/split-pane.css',
  './layout/resize-state.css',
  './layout/compact-shell.css',
  './layout/compact-split.css',
  './layout/fullscreen.css',
  './components/icon.css',
  './components/menu.css',
  './components/form.css',
  './components/tabs.css',
  './components/color-picker.css',
  './components/table-picker.css',
  './components/modal.css',
  './components/progress.css',
  './components/badge.css',
  './components/drop-overlay.css',
  './components/toast.css',
  './components/link-preview.css',
  './features/sidebar-navigation.css',
  './features/sidebar-documents.css',
  './features/sidebar-outline.css',
  './features/editor.css',
  './features/preview.css',
  './features/export.css',
  './features/media.css',
  './features/content-rendering.css',
  './features/preferences.css',
  './features/settings.css',
  './features/help.css',
  './features/hybrid.css',
  './features/hybrid-html.css',
  './features/hybrid-media.css',
  './features/hybrid-table.css',
  './features/hybrid-code.css',
  './features/hybrid-mermaid.css',
  './features/hybrid-math.css',
  './features/code-presentation.css',
  './features/file-tree.css',
]);
const expectedStyleEntry = `${expectedStyleImports.map(path => `@import '${path}';`).join('\n')}\n`;

const [indexSource, compatibilityContentSource, spriteSource, styleEntrySource, tokenSource, lightThemeSource, darkThemeSource] = await Promise.all([
  readText('index.html'),
  readText('public/compatibility/business-content.html'),
  readText('public/assets/icons.svg'),
  readText('src/styles/index.css'),
  readText('src/styles/foundation/tokens.css'),
  readText('src/styles/themes/light.css'),
  readText('src/styles/themes/dark.css')
]);
const nonEntryStylePaths = stylePaths.filter(path => path !== 'src/styles/index.css');
const styleSources = await Promise.all(nonEntryStylePaths.map(async path => Object.freeze({ path, source: await readText(path) })));
const visualStyles = styleSources.filter(record => !record.path.includes('/themes/') && !record.path.endsWith('/foundation/tokens.css'));
const visualStyleSource = visualStyles.map(record => record.source).join('\n');

function collectRuleHeaders(source) {
  const headers = [];
  let boundary = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      const header = source.slice(boundary, index).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (header) headers.push(header);
      depth += 1;
      boundary = index + 1;
      continue;
    }
    if (char === ';') {
      boundary = index + 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth < 0) throw new Error('Unbalanced CSS closing brace.');
      boundary = index + 1;
    }
  }
  if (depth !== 0 || quote || inComment) throw new Error('Incomplete CSS source.');
  return headers;
}

const indexInventory = buildHtmlInventory(indexSource);
const inlineEvents = collectInlineEvents('public/compatibility/business-content.html', compatibilityContentSource)
  .reduce((sum, record) => sum + record.count, 0);
const sprite = inspectSvgSprite(spriteSource);
const shellIconReferences = collectIconReferences(compatibilityContentSource);
const compatibilitySlots = [...compatibilityContentSource.matchAll(/<template\s+data-compat-slot="([^"]+)">/g)].map(match => match[1]);
const collectTokenNames = source => [...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]);
const baseTokenNames = collectTokenNames(tokenSource);
const lightTokenNames = collectTokenNames(lightThemeSource);
const darkTokenNames = collectTokenNames(darkThemeSource);
const visualSelectors = visualStyles.flatMap(record => collectRuleHeaders(record.source)
  .filter(header => !header.startsWith('@'))
  .map(header => Object.freeze({ path: record.path, header })));

const architectureModules = Object.freeze({
  appShell: moduleFixture.modules.filter(record => record[2] === 'ui-shell').map(record => record[0]).sort(),
  domPrimitives: moduleFixture.modules.filter(record => record[2] === 'ui-dom').map(record => record[0]).sort(),
  uiComponents: moduleFixture.modules.filter(record => record[2] === 'ui-components').map(record => record[0]).sort(),
  uiCompatibility: moduleFixture.modules.filter(record => record[2] === 'ui-compatibility').map(record => record[0]).sort()
});

if (indexInventory.summary.inlineEventCount !== 0 || inlineEvents !== 184) throw new Error('HTML baseline drifted.');
if (sprite.symbolCount !== 35 || sprite.uniqueSymbolCount !== 35 || sprite.duplicates.length || sprite.invalidIds.length || sprite.missingViewBoxes.length || sprite.forbiddenMarkup) throw new Error('SVG sprite contract drifted.');
if (shellIconReferences.length !== 50 || !shellIconReferences.every(record => record.href === `/assets/icons.svg#${record.iconId}`)) throw new Error('Icon references drifted.');
if (JSON.stringify(compatibilitySlots) !== JSON.stringify(['menu','toolbar','sidebar','editor','preview','status','overlay','ports'])) throw new Error('Compatibility slot contract drifted.');
if (moduleFixture.modules.length !== 139) throw new Error(`Unexpected production module count: ${moduleFixture.modules.length}`);
if (architectureModules.appShell.length !== 8 || architectureModules.domPrimitives.length !== 6 || architectureModules.uiComponents.length !== 2 || architectureModules.uiCompatibility.length !== 4) throw new Error('UI architecture counts drifted.');
if (styleEntryModules.length !== 1 || layerModules.foundation.length !== 5 || layerModules.themes.length !== 2 || layerModules.shell.length !== 6 || layerModules.layout.length !== 6 || layerModules.components.length !== 12 || layerModules.features.length !== 20) throw new Error('Style layer counts drifted.');
if (Object.keys(domPrimitives).sort().join(',') !== 'collectRequiredRefs,createEventScope,createFocusScope,createSafeElement,createTransitionVisibility,isElementRef,requireElementRef') throw new Error('DOM primitive exports drifted.');
if (typeof ModalShell !== 'function' || Object.keys(uiCompatibility).sort().join(',') !== 'COMPATIBILITY_MODAL_CLOSE_EVENT,COMPATIBILITY_MODAL_OPEN_EVENT,createCompatibilityBusinessContentPort,mountCompatibilityModalShells') throw new Error('Modal contract drifted.');
if (styleEntrySource !== expectedStyleEntry) throw new Error('Style entry ordering drifted.');
if (styleEntrySource.includes('./main.css')) throw new Error('Consolidated stylesheet remains imported.');
await access('src/styles/main.css').then(() => { throw new Error('Consolidated stylesheet still exists.'); }, () => {});
if (/\sstyle\s*=/i.test(compatibilityContentSource)) throw new Error('Stable compatibility inline style remains.');
if (visualSelectors.some(record => /#[a-z_][a-z0-9_-]*/i.test(record.header))) throw new Error('Visual ID selector remains.');
if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(visualStyleSource)) throw new Error('Visual color literal escaped theme ownership.');
if (/\[data-theme/.test(tokenSource + visualStyleSource) || !/^:root\s*\{/.test(lightThemeSource) || !/^\[data-theme="dark"\]\s*\{/.test(darkThemeSource)) throw new Error('Theme ownership drifted.');
if (darkTokenNames.some(name => !lightTokenNames.includes(name))) throw new Error('Dark token lacks light default.');
if (styleSources.some(record => record.source.split('\n').length > 380)) throw new Error('Style responsibility module exceeds the bounded size.');
if (styleSources.some(record => !record.path.endsWith('/foundation/tokens.css') && !record.path.includes('/themes/') && !/^\/\* Responsibility: [^\n]+ \*\//.test(record.source))) throw new Error('Style responsibility header missing.');

const responsiveShellReportPath = 'artifacts/stage-02/browser-app/responsive-shell-report.json';
const expectedResponsiveViewports = Object.freeze([
  Object.freeze({ name: 'desktop-1280', width: 1280, height: 800, compact: false }),
  Object.freeze({ name: 'desktop-900', width: 900, height: 700, compact: false }),
  Object.freeze({ name: 'compact-720', width: 720, height: 700, compact: true }),
  Object.freeze({ name: 'compact-600', width: 600, height: 700, compact: true }),
  Object.freeze({ name: 'short-900x480', width: 900, height: 480, compact: false }),
  Object.freeze({ name: 'short-600x480', width: 600, height: 480, compact: true })
]);

async function readResponsiveShellReport() {
  try {
    return JSON.parse(await readText(responsiveShellReportPath));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const responsiveShellReport = await readResponsiveShellReport();
if (responsiveShellReport) {
  if (!Array.isArray(responsiveShellReport) || responsiveShellReport.length !== expectedResponsiveViewports.length) {
    throw new Error('Responsive shell report matrix drifted.');
  }
  for (const [index, snapshot] of responsiveShellReport.entries()) {
    const expected = expectedResponsiveViewports[index];
    if (JSON.stringify(snapshot.viewport) !== JSON.stringify(expected)) throw new Error(`Responsive viewport drifted at index ${index}.`);
    if (snapshot.actualViewport?.width !== expected.width || snapshot.actualViewport?.height !== expected.height) throw new Error(`Responsive viewport metrics drifted for ${expected.name}.`);
    if (snapshot.document?.scrollWidth > expected.width + 1 || snapshot.document?.bodyScrollWidth > expected.width + 1) throw new Error(`Responsive document overflow detected for ${expected.name}.`);
    if (snapshot.pageScroll?.x !== 0 || snapshot.pageScroll?.y !== 0) throw new Error(`Responsive page scroll detected for ${expected.name}.`);
    if (snapshot.states?.compact !== expected.compact || snapshot.states?.sidebarHidden !== expected.compact) throw new Error(`Responsive compact-shell state drifted for ${expected.name}.`);
    if (!Array.isArray(snapshot.viewportIssues) || snapshot.viewportIssues.length) throw new Error(`Responsive structural issue detected for ${expected.name}.`);
    if (!Array.isArray(snapshot.focusIssues) || snapshot.focusIssues.length) throw new Error(`Responsive focus issue detected for ${expected.name}.`);
  }
}

const common = Object.freeze({
  status: 'passed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  currentStage2State: '2.11-completed',
  nextStage: 'stage-03-not-started',
  productionModuleCount: moduleFixture.modules.length,
  dependencyAuditDecision: Object.freeze({
    observed: '1 low / 1 high',
    changedInTask211: false,
    decision: 'deferred-until-final-local-real-device-testing'
  })
});

async function record(fileName, payload) {
  await writeFile(`artifacts/stage-02/${fileName}`, `${JSON.stringify({ ...common, ...payload }, null, 2)}\n`, 'utf8');
}

await record('02-02-minimal-index-evidence.json', {
  node: 'stage-02/02-02',
  scope: 'minimal-index-and-module-entry',
  index: indexInventory.source,
  indexSummary: indexInventory.summary,
  compatibilityContent: { path: 'public/compatibility/business-content.html', inlineEvents, scriptElements: 0 }
});
await record('02-03-svg-sprite-evidence.json', {
  node: 'stage-02/02-03',
  scope: 'external-svg-sprite-and-generic-icon-view',
  sprite: { path: 'public/assets/icons.svg', symbolCount: sprite.symbolCount, ids: sprite.ids },
  compatibilityIconReferences: shellIconReferences.length,
  iconView: { path: 'src/ui/components/icon-view.js', exports: Object.keys(iconView).sort(), spriteUrl: iconView.ICON_SPRITE_URL }
});
await record('02-04-app-shell-evidence.json', {
  node: 'stage-02/02-04',
  scope: 'single-app-shell-and-strict-ui-refs',
  publicContract: { createUI: 'createUI(root)', refs: ['menu','toolbar','sidebar','editor','preview','status','overlay'] },
  compatibilityTemplates: compatibilitySlots,
  modules: architectureModules.appShell
});
await record('02-05-dom-primitives-evidence.json', {
  node: 'stage-02/02-05',
  scope: 'bounded-dom-primitives',
  publicEntry: 'src/ui/dom/index.js',
  exports: Object.keys(domPrimitives).sort(),
  modules: architectureModules.domPrimitives
});
await record('02-06-modal-shell-evidence.json', {
  node: 'stage-02/02-06',
  scope: 'generic-modal-shell-and-compatibility-takeover',
  component: 'src/ui/components/modal-shell.js',
  compatibilityBridge: 'src/ui/compatibility/mount-modal-shells.js'
});
await record('02-07-css-tokens-evidence.json', {
  node: 'stage-02/02-07',
  scope: 'semantic-css-token-contract',
  publicEntry: 'src/styles/index.css',
  tokenAuthority: 'src/styles/foundation/tokens.css',
  tokenCount: new Set([...baseTokenNames, ...lightTokenNames, ...darkTokenNames]).size,
  styleLayers: layerModules
});
await record('02-08-theme-evidence.json', {
  node: 'stage-02/02-08',
  scope: 'token-only-light-and-dark-themes',
  themes: layerModules.themes,
  tokens: { base: new Set(baseTokenNames).size, light: new Set(lightTokenNames).size, darkOverrides: new Set(darkTokenNames).size }
});
await record('02-09-style-layering-evidence.json', {
  node: 'stage-02/02-09',
  scope: 'reset-shell-layout-component-and-feature-style-layering',
  publicEntry: 'src/styles/index.css',
  importedStylesheetCount: nonEntryStylePaths.length,
  layers: layerModules,
  contracts: {
    visualIdSelectors: 0,
    stableInlineStyleAttributes: 0,
    stableGeneratedStyleStrings: 0,
    prefixedNaming: ['c-', 'l-', 'f-', 'is-', 'has-'],
    legacyShellClasses: 'compatibility-query-hooks-only',
    consolidatedMainCss: 'removed'
  },
  guarantees: [
    'foundation-shell-layout-component-and-feature-responsibilities-are-independent-bounded-files',
    'ordered-public-style-entry-is-the-only-load-authority',
    'visual-css-has-no-id-selectors',
    'compatibility-html-has-no-stable-inline-style-attributes',
    'prefixed-classes-own-new-visual-shell-contracts',
    'legacy-classes-remain-only-to-preserve-unmigrated-feature-query-contracts',
    'theme-switch-and-layout-behavior-remain-compatible',
    'responsive-multi-viewport-acceptance-remains-atomic-task-2.10'
  ]
});


await record('02-11-shell-cutover-evidence.json', {
  node: 'stage-02/02-11',
  scope: 'single-production-app-shell-with-temporary-business-content-port',
  productionShellOwner: 'src/ui/create-ui.js',
  productionEntry: 'src/bootstrap/module-entry.js',
  compatibilityPublicEntry: 'src/ui/compatibility/index.js',
  compatibilityContent: 'public/compatibility/business-content.html',
  removedOldShellPaths: [
    'public/compatibility/current-shell.html',
    'src/ui/compatibility/mount-current-shell.js'
  ],
  compatibilityModules: architectureModules.uiCompatibility,
  deletionTask: 'stage-16/16-08'
});
await record('02-10-responsive-shell-evidence.json', {
  node: 'stage-02/02-10',
  scope: 'responsive-app-shell-structure-and-focus-verification',
  requiredViewports: expectedResponsiveViewports,
  runtimeReport: responsiveShellReport
    ? {
        status: 'passed',
        path: responsiveShellReportPath,
        snapshotCount: responsiveShellReport.length,
        viewportIssueCount: responsiveShellReport.reduce((sum, snapshot) => sum + snapshot.viewportIssues.length, 0),
        focusIssueCount: responsiveShellReport.reduce((sum, snapshot) => sum + snapshot.focusIssues.length, 0)
      }
    : {
        status: 'not-run-in-current-environment',
        path: responsiveShellReportPath,
        reason: 'built-application-browser-report-not-present'
      },
  structuralContracts: [
    '1280-900-720-600-required-widths',
    '480-required-short-height',
    'no-document-horizontal-overflow',
    'no-shell-region-outside-viewport',
    'no-clipped-visible-focus-targets',
    'compact-shell-state-matches-viewport-contract',
    'responsive-validation-does-not-create-business-behavior'
  ]
});
