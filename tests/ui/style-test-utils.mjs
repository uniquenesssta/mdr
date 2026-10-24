import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const root = process.cwd();
export const readText = path => readFile(resolve(root, path), 'utf8');

export const STYLE_IMPORTS = Object.freeze([
  'foundation/reset.css',
  'foundation/tokens.css',
  'foundation/typography.css',
  'foundation/accessibility.css',
  'foundation/motion.css',
  'themes/light.css',
  'themes/dark.css',
  'shell/app-shell.css',
  'shell/menu-bar.css',
  'shell/toolbar-shell.css',
  'shell/workspace-shell.css',
  'shell/status-bar.css',
  'shell/window-controls.css',
  'layout/sidebar-layout.css',
  'layout/split-pane.css',
  'layout/resize-state.css',
  'layout/compact-shell.css',
  'layout/compact-split.css',
  'layout/fullscreen.css',
  'components/icon.css',
  'components/menu.css',
  'components/form.css',
  'components/tabs.css',
  'components/color-picker.css',
  'components/table-picker.css',
  'components/modal.css',
  'components/progress.css',
  'components/badge.css',
  'components/drop-overlay.css',
  'components/toast.css',
  'components/link-preview.css',
  'features/sidebar-navigation.css',
  'features/sidebar-documents.css',
  'features/sidebar-outline.css',
  'features/editor.css',
  'features/preview.css',
  'features/export.css',
  'features/media.css',
  'features/content-rendering.css',
  'features/preferences.css',
  'features/settings.css',
  'features/help.css',
  'features/hybrid.css',
  'features/hybrid-html.css',
  'features/hybrid-media.css',
  'features/hybrid-table.css',
  'features/hybrid-code.css',
  'features/hybrid-mermaid.css',
  'features/hybrid-math.css',
  'features/code-presentation.css',
  'features/file-tree.css',
]);

export function expectedStyleEntry() {
  return `${STYLE_IMPORTS.map(path => `@import './${path}';`).join('\n')}\n`;
}

export async function readImportedStyles() {
  return Promise.all(STYLE_IMPORTS.map(async path => Object.freeze({
    path: `src/styles/${path}`,
    source: await readText(`src/styles/${path}`)
  })));
}

export function extractRule(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`missing CSS rule: ${selector}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unclosed CSS rule: ${selector}`);
}

export function collectDefinitions(source) {
  return new Map([...source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
    .map(match => [match[1], match[2].trim()]));
}

export function collectTopLevelHeaders(source) {
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
      if (depth < 0) throw new Error('CSS has an unmatched closing brace.');
      boundary = index + 1;
    }
  }
  if (depth !== 0 || quote || inComment) throw new Error('CSS source is structurally incomplete.');
  return headers;
}

export function splitSelectors(header) {
  if (header.startsWith('@')) return [];
  const selectors = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index <= header.length; index += 1) {
    const char = header[index] || ',';
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && round === 0 && square === 0) {
      const selector = header.slice(start, index).trim();
      if (selector) selectors.push(selector);
      start = index + 1;
    }
  }
  return selectors;
}
