import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const SOURCE_ROOTS = ['public', 'src', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', 'target', '.cargo-target', 'artifacts']);
const EXCLUDED_FILES = new Set(['tests/ui/dom-asset-inventory.test.mjs']);

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

async function collectFiles(root, directory, output) {
  const absolute = resolve(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const child = join(absolute, entry.name);
    const repositoryPath = normalizePath(relative(root, child));
    if (entry.isDirectory()) {
      await collectFiles(root, repositoryPath, output);
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (EXCLUDED_FILES.has(repositoryPath)) continue;
    output.push(repositoryPath);
  }
}

export async function discoverReferenceFiles(root = process.cwd()) {
  const output = [];
  for (const directory of SOURCE_ROOTS) await collectFiles(root, directory, output);
  return output.sort();
}

function pushMatches(output, source, file, expression, kind, selectorGroup = 'selector') {
  const lines = source.split(/\r?\n/);
  for (const match of source.matchAll(expression)) {
    const prefix = source.slice(0, match.index);
    const line = prefix.split('\n').length;
    output.push({
      id: `${kind}:${file}:${line}:${output.length + 1}`,
      file,
      line,
      kind,
      selector: match.groups?.[selectorGroup] ?? match[2] ?? match[1],
      text: lines[line - 1]?.trim().slice(0, 500) || ''
    });
  }
}

function extractSelectorTokens(selector, kind) {
  if (kind === 'getElementById') return { ids: [selector], classes: [], dataAttributes: [] };
  const ids = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map(match => match[1]);
  const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1]);
  const dataAttributes = [...selector.matchAll(/\[(data-[\w-]+)(?:\s*=\s*['\"]?([^'\"\]]+)['\"]?)?\]/g)]
    .map(match => ({ name: match[1], value: match[2] || null }));
  return {
    ids: [...new Set(ids)].sort(),
    classes: [...new Set(classes)].sort(),
    dataAttributes
  };
}

function analyzeSelectors(source, file) {
  const selectors = [];
  pushMatches(
    selectors,
    source,
    file,
    /\bgetElementById\(\s*(['\"])(?<selector>[^'\"]+)\1\s*\)/g,
    'getElementById'
  );
  pushMatches(
    selectors,
    source,
    file,
    /\b(?<method>querySelector|querySelectorAll|closest|matches)\(\s*(['\"])(?<selector>[^'\"]+)\2\s*\)/g,
    'selector'
  );
  return selectors.map(record => ({
    ...record,
    tokens: extractSelectorTokens(record.selector, record.kind)
  }));
}

function analyzeClassMutations(source, file) {
  const output = [];
  const expressions = [
    /\bclassList\.(?<method>add|remove|toggle|replace)\((?<args>[^)]*)\)/g,
    /\.className\s*=\s*(?<args>[^;\n]+)/g,
    /\bsetAttribute\(\s*(['\"])class\1\s*,\s*(?<args>[^)]*)\)/g
  ];
  const lines = source.split(/\r?\n/);
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const line = source.slice(0, match.index).split('\n').length;
      const literals = [];
      for (const literalMatch of String(match.groups?.args || '').matchAll(/['\"]([^'\"]+)['\"]/g)) {
        literals.push(...literalMatch[1].split(/\s+/).filter(Boolean));
      }
      output.push({
        id: `class-mutation:${file}:${line}:${output.length + 1}`,
        file,
        line,
        method: match.groups?.method || 'assignment',
        literals: [...new Set(literals)].sort(),
        text: lines[line - 1]?.trim().slice(0, 500) || ''
      });
    }
  }
  return output;
}

export async function collectRepositoryReferences(root = process.cwd()) {
  const files = await discoverReferenceFiles(root);
  const runtimeSelectors = [];
  const testSelectors = [];
  const classMutations = [];
  for (const file of files) {
    const source = await readFile(resolve(root, file), 'utf8');
    const selectors = analyzeSelectors(source, file);
    const target = file.startsWith('tests/') ? testSelectors : runtimeSelectors;
    target.push(...selectors);
    if (!file.startsWith('tests/')) classMutations.push(...analyzeClassMutations(source, file));
  }
  const dynamicClassNames = [...new Set(classMutations.flatMap(record => record.literals))].sort();
  return {
    files,
    runtimeSelectors,
    testSelectors,
    classMutations,
    dynamicClassNames,
    summary: {
      scannedFileCount: files.length,
      runtimeSelectorCallCount: runtimeSelectors.length,
      testSelectorCallCount: testSelectors.length,
      classMutationCallCount: classMutations.length,
      dynamicClassLiteralCount: dynamicClassNames.length
    }
  };
}
