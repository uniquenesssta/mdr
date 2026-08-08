import { dirname, join } from 'node:path';
import { getLineAndColumn, normalizePath } from './repository.mjs';

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function collectModuleSpecifiers(source) {
  const output = [];
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const location = getLineAndColumn(source, match.index);
      output.push({ specifier: match[1], ...location });
    }
  }
  return output;
}

function groupOccurrences(records, fields) {
  const grouped = new Map();
  for (const record of records) {
    const key = fields.map(field => String(record[field] ?? '')).join('\u0000');
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.lines.push(record.line);
    } else {
      grouped.set(key, {
        ...Object.fromEntries(fields.map(field => [field, record[field]])),
        count: 1,
        lines: [record.line]
      });
    }
  }
  return [...grouped.values()]
    .map(record => ({ ...record, lines: uniqueSorted(record.lines.map(String)).map(Number) }))
    .sort((left, right) => fields.map(field => String(left[field])).join(':')
      .localeCompare(fields.map(field => String(right[field])).join(':')));
}

export function collectInlineEvents(path, source) {
  const records = [];
  const pattern = /\s(on[a-z][a-z0-9:_-]*)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const location = getLineAndColumn(source, match.index);
    records.push({
      path: normalizePath(path),
      attribute: match[1].toLowerCase(),
      handler: match[3].trim().replace(/\s+/g, ' '),
      line: location.line
    });
  }
  return groupOccurrences(records, ['path', 'attribute', 'handler']);
}

function normalizePublicScriptSource(source) {
  const value = String(source || '').replace(/[?#].*$/, '');
  if (value.startsWith('/app/')) return `public${value}`;
  if (value === '/i18n.js' || value === 'i18n.js') return 'public/i18n.js';
  if (value === '/help-content.js' || value === 'help-content.js') return 'public/help-content.js';
  if (value.startsWith('/')) return value.slice(1);
  return normalizePath(value);
}

export function collectHtmlClassicScripts(path, source) {
  const records = [];
  const pattern = /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const attributes = `${match[1]} ${match[4]}`;
    if (/\btype\s*=\s*(["'])module\1/i.test(attributes)) continue;
    const location = getLineAndColumn(source, match.index);
    records.push({
      loader: normalizePath(path),
      script: normalizePublicScriptSource(match[3]),
      line: location.line
    });
  }
  return records;
}

export function collectDynamicClassicScripts(path, source) {
  if (!/createElement\(\s*['"]script['"]\s*\)/.test(source)) return [];
  if (!/\.appendChild\(\s*script\s*\)/.test(source)) return [];
  const records = [];
  const pattern = /(["'])(\/(?:app\/[^"']+\.js|i18n\.js|help-content\.js))\1/g;
  let match;
  while ((match = pattern.exec(source))) {
    const location = getLineAndColumn(source, match.index);
    records.push({
      loader: normalizePath(path),
      script: normalizePublicScriptSource(match[2]),
      line: location.line
    });
  }
  return records;
}

function stripComments(source) {
  let output = '';
  let index = 0;
  let quote = null;
  let templateExpressionDepth = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      output += char;
      if (char === '\\') {
        output += next || '';
        index += 2;
        continue;
      }
      if (quote === '`' && char === '$' && next === '{') {
        templateExpressionDepth += 1;
      } else if (quote === '`' && char === '}' && templateExpressionDepth > 0) {
        templateExpressionDepth -= 1;
      } else if (char === quote && templateExpressionDepth === 0) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

export function collectBusinessGlobalWrites(path, source) {
  const searchable = stripComments(source);
  const records = [];
  const patterns = [
    /\b(window|globalThis)\.([A-Za-z_$][\w$]*)\s*(?:=|\?\?=|\|\|=|&&=|\+=|-=|\*=|\/=)/g,
    /\b(window|globalThis)\s*\[\s*(["'])([A-Za-z_$][\w$]*)\2\s*\]\s*(?:=|\?\?=|\|\|=|&&=|\+=|-=|\*=|\/=)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(searchable))) {
      const location = getLineAndColumn(searchable, match.index);
      records.push({
        path: normalizePath(path),
        global: `${match[1]}.${match[3] || match[2]}`,
        line: location.line
      });
    }
  }
  return groupOccurrences(records, ['path', 'global']);
}

export function featureName(path) {
  const match = normalizePath(path).match(/^src\/features\/([^/]+)(?:\/|$)/);
  return match?.[1] || null;
}

export function isPublicFeatureEntry(path) {
  return /^src\/features\/[^/]+\/index\.(?:js|mjs)$/.test(normalizePath(path));
}

export function repositoryImportPath(importerPath, specifier) {
  return normalizePath(join(dirname(importerPath), specifier));
}
