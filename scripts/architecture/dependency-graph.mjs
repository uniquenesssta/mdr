// Production source dependency facts and architecture admission share this owner.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAst } from 'rollup/parseAst';
import postcss from 'postcss';
import { discoverProductionFiles } from '../stage-01/module-inventory-core.mjs';
import { featureName, isPublicFeatureEntry } from './source-analysis.mjs';
import { getGitHead, getLineAndColumn, listRepositoryFiles, loadOwnershipManifest } from './repository.mjs';

const REPORT = 'docs/audit/r16-12-dependency-graph.json';
const sha = value => createHash('sha256').update(value).digest('hex');
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) walk(child, visit); }
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = literal(node.left), right = literal(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}
const importMetaUrl = node => node?.type === 'MemberExpression' && node.property?.name === 'url'
  && node.object?.type === 'MetaProperty' && node.object.meta.name === 'import';

export function collectJavaScriptDependencies(source) {
  const references = [], unresolved = [];
  const add = (node, argument, kind, domain) => {
    const specifier = literal(argument), location = getLineAndColumn(source, node.start);
    if (specifier === null) unresolved.push({ kind, ...location });
    else references.push({ specifier, kind, domain, ...location });
  };
  walk(parseAst(source), node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      add(node, node.source, node.type === 'ImportDeclaration' ? 'import' : 're-export', 'esm');
    } else if (node.type === 'ImportExpression') add(node, node.source, 'dynamic-import', 'esm');
    else if (node.type === 'NewExpression' && node.callee?.name === 'URL' && importMetaUrl(node.arguments[1])) {
      add(node, node.arguments[0], 'module-url', null);
    } else if (node.type === 'CallExpression' && ['require', 'importScripts'].includes(node.callee?.name)) {
      for (const argument of node.arguments) add(node, argument, node.callee.name, 'esm');
    } else if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
      && node.callee.object?.type === 'MetaProperty' && node.callee.object.meta?.name === 'import') {
      if (node.callee.property?.name === 'glob') {
        const values = node.arguments[0]?.type === 'ArrayExpression' ? node.arguments[0].elements : [node.arguments[0]];
        const query = node.arguments[1]?.properties?.find(row => (row.key.name || row.key.value) === 'query');
        const queryText = query ? literal(query.value) : '';
        if (queryText === null) unresolved.push({ kind: 'computed-glob-query', ...getLineAndColumn(source, node.start) });
        for (const argument of values) {
          const specifier = literal(argument);
          if (specifier === null) unresolved.push({ kind: 'computed-import-glob', ...getLineAndColumn(source, node.start) });
          else references.push({ specifier, kind: 'glob', domain: /raw|url|inline/.test(queryText || '') ? null : 'esm', query: queryText, ...getLineAndColumn(source, node.start) });
        }
      } else unresolved.push({ kind: 'unsupported-import-meta-loader', ...getLineAndColumn(source, node.start) });
    }
  });
  return { references, unresolved };
}

function collectStylesheetDependencies(source) {
  const references = [], unresolved = [];
  const stylesheet = postcss.parse(source);
  stylesheet.walkAtRules('import', node => {
    const match = node.params.match(/^(?:['"]([^'"]+)['"]|url\(\s*['"]?([^'"\s)]+)['"]?\s*\))/i);
    if (!match) unresolved.push({ kind: 'css-import', line: node.source.start.line, column: node.source.start.column });
    else references.push({ specifier: match[1] || match[2], kind: 'css-import', domain: 'css', ...node.source.start });
  });
  stylesheet.walkDecls(node => {
    for (const match of node.value.matchAll(/url\(\s*(?:['"]([^'"]*)['"]|([^)]*))\s*\)/gi)) {
      references.push({ specifier: (match[1] ?? match[2]).trim(), kind: 'css-url', domain: null, ...node.source.start });
    }
  });
  return { references, unresolved };
}

function collectHtmlDependencies(source) {
  const references = [], unresolved = [];
  const attributes = tag => new Map([...tag.replace(/^<[\w:-]+/, '').matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '']));
  const commentsMasked = source.replace(/<!--[\s\S]*?-->/g, value => value.replace(/[^\r\n]/g, ' '));
  for (const script of commentsMasked.matchAll(/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/script\s*>)/gi)) {
    const attrs = attributes(script[1]), type = attrs.get('type') || '';
    if (attrs.has('src') || !['', 'module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const extracted = collectJavaScriptDependencies(script[2]);
    const start = getLineAndColumn(source, script.index + script[1].length);
    const relocate = reference => ({ ...reference, line: start.line + reference.line - 1,
      column: reference.line === 1 ? start.column + reference.column - 1 : reference.column });
    references.push(...extracted.references.map(relocate)); unresolved.push(...extracted.unresolved.map(relocate));
  }
  const searchable = commentsMasked
    .replace(/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/script\s*>)/gi,
      (_all, opening, body, closing) => opening + body.replace(/[^\r\n]/g, ' ') + closing);
  for (const tag of searchable.matchAll(/<(?:script|link|img|source)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    for (const [name, value] of attributes(tag[0])) {
      if (!['src', 'href'].includes(name)) continue;
      references.push({ specifier: value, kind: 'html-resource', domain: null, ...getLineAndColumn(source, tag.index) });
    }
  }
  return { references, unresolved };
}

// Rust declarations and namespace references are different edge kinds. A use of
// a parent namespace is valid Rust and is not an ESM initialization cycle.
function rustTokens(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.startsWith('//', index)) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue; }
    if (source.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('Unterminated Rust comment.');
      continue;
    }
    const start = index, remaining = source.slice(index);
    const raw = /^(?:b)?r(#{0,255})"/.exec(remaining);
    if (raw) {
      const end = source.indexOf('"' + raw[1], index + raw[0].length);
      if (end < 0) throw new Error('Unterminated Rust raw string.');
      tokens.push({ value: source.slice(index + raw[0].length, end), string: true, raw: true, start });
      index = end + raw[1].length + 1; continue;
    }
    const quoted = /^(?:b)?"(?:\\[\s\S]|[^"\\])*"/.exec(remaining);
    if (quoted) {
      const text = quoted[0].replace(/^b/, '');
      tokens.push({ value: text.slice(1, -1), string: true, raw: false, start }); index += quoted[0].length; continue;
    }
    if (source[index] === '"' || source.startsWith('b"', index)) throw new Error('Unterminated Rust string.');
    const character = /^'(?:\\.|[^'\\])'/.exec(remaining);
    if (character) { index += character[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z_\d]*/.exec(remaining);
    const value = name?.[0] || source[index];
    tokens.push({ value, string: false, start }); index += value.length;
  }
  return tokens;
}

function rustString(token) {
  if (token.raw) return token.value;
  return token.value.replace(/\\(?:u\{([\da-f]+)\}|x([\da-f]{2})|([\s\S]))/gi, (_match, unicode, byte, escaped) => {
    if (unicode || byte) return String.fromCodePoint(parseInt(unicode || byte, 16));
    const values = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
    if (!(escaped in values)) throw new Error('Unsupported Rust path escape.');
    return values[escaped];
  });
}

function rustIncludeValue(tokens, start) {
  const token = tokens[start];
  if (token?.string) return { value: rustString(token), next: start + 1, rootRelative: false };
  if (token?.value === 'env' && tokens[start + 3]?.string && rustString(tokens[start + 3]) === 'CARGO_MANIFEST_DIR') {
    return { value: 'src-tauri', next: start + 5, rootRelative: true };
  }
  if (token?.value !== 'concat' || tokens[start + 1]?.value !== '!' || tokens[start + 2]?.value !== '(') return null;
  let index = start + 3, value = '', rootRelative = false;
  while (tokens[index] && tokens[index].value !== ')') {
    const part = rustIncludeValue(tokens, index);
    if (!part) return null;
    value += part.value; rootRelative ||= part.rootRelative; index = part.next;
    if (tokens[index]?.value === ',') index++;
    else if (tokens[index]?.value !== ')') return null;
  }
  return { value, rootRelative, next: index + 1 };
}

function collectRustDependencies(source, importer, production) {
  const references = [], namespaces = [], unresolved = [], tokens = rustTokens(source);
  const directory = /\/(?:main|lib|mod)\.rs$/.test(importer) ? posix.dirname(importer) : importer.slice(0, -3);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]; if (token.string) continue;
    if (token.value === 'mod' && !tokens[index + 1]?.string && tokens[index + 2]?.value === ';') {
      let explicit = null;
      for (let before = index - 1; before >= 0 && ![';', '{', '}'].includes(tokens[before].value); before--) {
        if (tokens[before].value === 'path' && tokens[before + 1]?.value === '=' && tokens[before + 2]?.string) { explicit = rustString(tokens[before + 2]); break; }
      }
      const name = tokens[index + 1].value;
      const targets = explicit ? [posix.normalize(posix.join(posix.dirname(importer), explicit))]
        : [directory + '/' + name + '.rs', directory + '/' + name + '/mod.rs'];
      const selected = targets.find(path => production.has(path)) || targets[0];
      references.push({ specifier: selected, rootRelative: true, kind: explicit ? 'rust-path-module' : 'rust-module',
        domain: selected.startsWith('src-tauri/tests/') ? null : 'rust-declaration', ...getLineAndColumn(source, token.start) });
    } else if (token.value === 'use') {
      let end = index + 1; while (end < tokens.length && tokens[end].value !== ';') end++;
      namespaces.push({ specifier: tokens.slice(index + 1, end).map(row => row.value).join(''), ...getLineAndColumn(source, token.start) });
    } else if (/^include(?:_str|_bytes)?$/.test(token.value) && tokens[index + 1]?.value === '!') {
      const argument = rustIncludeValue(tokens, index + 3);
      if (argument) references.push({ specifier: argument.value, rootRelative: argument.rootRelative, kind: 'rust-include', domain: null, ...getLineAndColumn(source, token.start) });
      else unresolved.push({ kind: 'computed-rust-include', ...getLineAndColumn(source, token.start) });
    }
  }
  return { references, unresolved, namespaces };
}

export function findDependencyCycles(graph) {
  const state = new Map(), stack = [], cycles = new Map();
  function visit(node) {
    state.set(node, 1); stack.push(node);
    for (const target of graph.get(node) || []) {
      if (!graph.has(target)) continue;
      if (!state.has(target)) visit(target);
      else if (state.get(target) === 1) {
        const body = stack.slice(stack.indexOf(target));
        const variants = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
        variants.sort((a, b) => a.join('>').localeCompare(b.join('>')));
        const cycle = [...variants[0], variants[0][0]]; cycles.set(cycle.join('>'), cycle);
      }
    }
    stack.pop(); state.set(node, 2);
  }
  for (const node of [...graph.keys()].sort()) if (!state.has(node)) visit(node);
  return [...cycles.values()].sort((a, b) => a.join('>').localeCompare(b.join('>')));
}

export async function buildDependencyGraph({ root = process.cwd() } = {}) {
  const [production, tracked, manifest] = await Promise.all([discoverProductionFiles(root), listRepositoryFiles(root, { includeUntracked:true }), loadOwnershipManifest(root)]);
  const known = new Set(production), files = new Set([...tracked, ...production]);
  const nodes = new Map(production.map(path => [path, { id: path, kind: posix.extname(path).slice(1), feature: featureName(path) }]));
  const pending = [...production], visited = new Set();
  const edges = [], issues = [], namespaces = [], inputs = [];
  const issue = (rule, path, message, reference = {}) => issues.push({ rule, path, line: reference.line ?? null,
    column: reference.column ?? null, message, detail: reference.detail ?? null });
  const read = async path => { const bytes = await readFile(resolve(root, path)); inputs.push({ path, sha256: sha(bytes) }); return bytes.toString('utf8'); };
  const optional = async path => { try { return await read(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const packageText = await optional('package.json'), lockText = await optional('package-lock.json');
  const packages = packageText ? JSON.parse(packageText) : {}, lock = lockText ? JSON.parse(lockText) : {};
  const declared = { ...packages.dependencies, ...packages.devDependencies };
  const cargo = await optional('src-tauri/Cargo.toml');
  const cargoLock = await optional('src-tauri/Cargo.lock');
  const nativePackages = [];
  let cargoSection = '';
  for (const line of (cargo || '').split(/\r?\n/)) {
    const section = /^\[([^\]]+)\]/.exec(line); if (section) { cargoSection = section[1]; continue; }
    const dependency = /^([\w-]+)\s*=/.exec(line);
    if (dependency && /(?:^|\.)(?:dependencies|build-dependencies|dev-dependencies)$/.test(cargoSection)) nativePackages.push({ name: dependency[1], section: cargoSection });
  }
  const ownerPaths = new Set(manifest.modules.map(row => row.path));
  for (const path of production) if (!ownerPaths.has(path)) issue('production-inventory', path, 'Production dependency node has no ownership record.');
  for (const path of ownerPaths) if (!known.has(path)) issue('production-inventory', path, 'Ownership record has no production dependency node.');

  function linkRustNamespace(importer, reference) {
    const prefix = reference.specifier.replace(/^::/, '').split(/::|\{/).filter(Boolean);
    const name = prefix[0];
    let target = null;
    if (['std', 'core', 'alloc'].includes(name)) {
      target = 'rust:' + name; nodes.set(target, { id: target, kind: 'rust-standard-library', feature: null });
    } else if (nativePackages.some(row => row.name.replaceAll('-', '_') === name)) {
      target = 'cargo:' + nativePackages.find(row => row.name.replaceAll('-', '_') === name).name;
    } else {
      let base = /\/(?:main|lib|mod)\.rs$/.test(importer) ? posix.dirname(importer) : importer.slice(0, -3);
      if (prefix[0] === 'crate') { base = 'src-tauri/src'; prefix.shift(); }
      else if (prefix[0] === 'self') prefix.shift();
      while (prefix[0] === 'super') { base = posix.dirname(base); prefix.shift(); }
      const options = [base];
      for (const part of prefix) { if (!/^\w+$/.test(part)) break; base += '/' + part; options.push(base); }
      for (const option of options.reverse()) {
        target = [option + '.rs', option + '/mod.rs', option + '/main.rs'].find(path => known.has(path)) || null;
        if (target) break;
      }
    }
    if (target) edges.push({ from: importer, to: target, kind: 'rust-namespace', domain: null, ...reference });
    namespaces.push({ from: importer, ...reference, modulePrefix: target,
      resolution: 'Module/package prefix only; defining symbols, traits, cfg and macros are resolved by the mandatory Rust compiler gates.' });
  }

  async function link(importer, reference) {
    const specifier = reference.specifier;
    if (!specifier || specifier.startsWith('#')) return;
    if (reference.kind === 'glob') {
      const vendor = /^(?:\.\.\/)+node_modules\/(.+)$/.exec(specifier);
      if (vendor) {
        if (vendor[1].includes('\\') || vendor[1].split('/').includes('..')) {
          issue('dependency-outside-package', importer, 'Vendor glob may not traverse outside its declared package: ' + specifier, reference); return;
        }
        const name = vendor[1].startsWith('@') ? vendor[1].split('/').slice(0, 2).join('/') : vendor[1].split('/')[0];
        if (!declared[name]) issue('undeclared-package-import', importer, 'Vendor glob package is not declared: ' + name, reference);
        const target = 'npm-glob:' + vendor[1];
        nodes.set(target, { id: target, kind: 'npm-asset-glob', feature: null, package: name,
          declaredVersion: declared[name] || null, lockedVersion: lock.packages?.['node_modules/' + name]?.version || null });
        edges.push({ from: importer, to: target, ...reference, domain: null }); return;
      }
      if (!/^\.?\.?\//.test(specifier) || /[{}[\]\\]/.test(specifier)) { issue('unsupported-module-glob', importer, 'Glob cannot be resolved from production paths: ' + specifier, reference); return; }
      const pattern = posix.normalize(posix.join(posix.dirname(importer), specifier));
      if (pattern.startsWith('../')) { issue('dependency-outside-repository', importer, 'Glob leaves the repository: ' + specifier, reference); return; }
      const matcher = new RegExp('^' + pattern.split(/(\*\*\/|\*\*|\*|\?)/).map(part =>
        part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
      const targets = [...files].filter(path => matcher.test(path));
      for (const target of targets) await link(importer, { ...reference, specifier: target, rootRelative: true, kind: 'glob-match' });
      return;
    }
    if (/^(?:https?:|data:|blob:)/.test(specifier)) {
      const target = specifier.startsWith('data:') ? 'inline:' + sha(specifier) : 'resource:' + specifier;
      nodes.set(target, { id: target, kind: 'external-resource', feature: null });
      edges.push({ from: importer, to: target, ...reference, specifier: specifier.startsWith('data:') ? 'data:' + sha(specifier) : specifier }); return;
    }
    const local = reference.rootRelative || /^(?:\.|\/)/.test(specifier);
    if (!local) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      const builtin = specifier.startsWith('node:');
      if (!builtin && !declared[name]) issue('undeclared-package-import', importer, 'Package import is not declared: ' + name, reference);
      const target = builtin ? 'builtin:' + specifier : 'npm:' + name;
      nodes.set(target, { id: target, kind: builtin ? 'node-builtin' : 'npm-package', feature: null,
        declaredVersion: declared[name] || null, lockedVersion: lock.packages?.['node_modules/' + name]?.version || null });
      edges.push({ from: importer, to: target, ...reference }); return;
    }
    let clean;
    try { clean = decodeURIComponent(specifier.split(/[?#]/)[0]); }
    catch { issue('invalid-dependency-path', importer, 'Malformed dependency URL: ' + specifier, reference); return; }
    const base = reference.rootRelative ? clean : clean.startsWith('/')
      ? clean.startsWith('/src/') ? clean.slice(1) : 'public' + clean
      : posix.join(posix.dirname(importer), clean);
    const normalized = posix.normalize(base);
    if (normalized.startsWith('../') || posix.isAbsolute(normalized)) { issue('dependency-outside-repository', importer, 'Dependency leaves the repository: ' + specifier, reference); return; }
    const candidates = posix.extname(normalized) ? [normalized] : [normalized, normalized + '.js', normalized + '.mjs', normalized + '/index.js', normalized + '/index.mjs'];
    const target = candidates.find(path => files.has(path));
    if (!target) {
      const casing = candidates.find(path => [...files].some(file => file.toLowerCase() === path.toLowerCase()));
      issue(casing ? 'dependency-path-case-mismatch' : 'unresolved-local-dependency', importer, 'Cannot resolve dependency: ' + specifier, reference); return;
    }
    const rustTest = target.startsWith('src-tauri/tests/') && importer.endsWith('.rs');
    const buildInput = (importer === 'vite.config.js' || importer.startsWith('scripts/build/')) && target.startsWith('scripts/build/');
    if (!known.has(target) && /\.(?:js|mjs|cjs|rs|css|html)$/.test(target) && !rustTest && !buildInput) issue('unowned-local-dependency', importer, 'Dependency is outside the production inventory: ' + target, reference);
    if (!nodes.has(target)) {
      nodes.set(target, { id: target, kind: rustTest ? 'native-test-input' : buildInput ? 'build-input' : 'asset', feature: featureName(target) });
      if (buildInput) pending.push(target); else await read(target);
    }
    const importerFeature = featureName(importer), targetFeature = featureName(target);
    if (importerFeature && target.startsWith('src/app/')) issue('feature-imports-composition-root', importer, 'Feature must not import composition internals: ' + target, reference);
    if (importerFeature && targetFeature && importerFeature !== targetFeature && !isPublicFeatureEntry(target)) issue('cross-feature-internal-import', importer, 'Cross-feature dependency must use the public entry: ' + target, reference);
    if (importer.startsWith('src/platform/') && target.startsWith('src/features/')) issue('platform-imports-feature', importer, 'Platform must not import feature code: ' + target, reference);
    if (importer.startsWith('src/model-kernel/') && /^(?:src\/(?:app|platform|features|ui)\/)/.test(target)) issue('model-kernel-import-direction', importer, 'Model kernel must not import higher layers: ' + target, reference);
    edges.push({ from: importer, to: target, ...reference,
      domain: /[?](?:raw|url|worker)(?:[&#]|$)/.test(specifier) ? null : reference.domain });
  }

  for (const path of pending) {
    if (visited.has(path)) continue;
    visited.add(path);
    const source = await read(path); let extracted;
    try {
      extracted = /\.(?:js|mjs|cjs)$/.test(path) ? collectJavaScriptDependencies(source)
        : path.endsWith('.css') ? collectStylesheetDependencies(source)
        : path.endsWith('.html') ? collectHtmlDependencies(source)
        : path.endsWith('.rs') ? collectRustDependencies(source, path, known) : { references: [], unresolved: [] };
    } catch (error) { issue('dependency-source-parse', path, error.message); continue; }
    for (const unresolved of extracted.unresolved) issue('computed-module-dependency', path, 'Dependency cannot be statically resolved: ' + unresolved.kind, unresolved);
    for (const reference of extracted.references) await link(path, reference);
    for (const namespace of extracted.namespaces || []) linkRustNamespace(path, namespace);
  }
  const cycles = [];
  for (const domain of ['esm', 'css', 'rust-declaration']) {
    const graph = new Map([...visited].map(path => [path, []]));
    for (const edge of edges.filter(edge => edge.domain === domain)) graph.get(edge.from)?.push(edge.to);
    for (const cycle of findDependencyCycles(graph)) {
      cycles.push({ domain, path: cycle }); issue('circular-dependency', cycle[0], 'Circular dependency: ' + cycle.join(' -> '), { detail: cycle });
    }
  }
  if (packageText) {
    nodes.set('package.json', { id: 'package.json', kind: 'configuration', feature: null });
    for (const name of Object.keys(declared).sort()) {
      const target = 'npm:' + name;
      if (!nodes.has(target)) nodes.set(target, { id: target, kind: 'npm-package', feature: null, declaredVersion: declared[name], lockedVersion: lock.packages?.['node_modules/' + name]?.version || null });
      edges.push({ from: 'package.json', to: target, kind: 'package-declaration', domain: null, specifier: name });
    }
  }
  if (cargo) {
    nodes.set('src-tauri/Cargo.toml', { id: 'src-tauri/Cargo.toml', kind: 'configuration', feature: null });
    for (const { name, section } of nativePackages) {
      nodes.set('cargo:' + name, { id: 'cargo:' + name, kind: 'cargo-declaration', feature: null });
      edges.push({ from: 'src-tauri/Cargo.toml', to: 'cargo:' + name, kind: 'cargo-declaration', section, specifier: name, domain: null });
    }
  }
  const compare = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  return { schemaVersion: 1, stage: 'R16.12', productionFiles: production.length,
    inputSha256: sha(JSON.stringify(inputs.sort((a, b) => a.path.localeCompare(b.path)))),
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort(compare), cycles,
    rustCompilerReferences: namespaces.sort(compare),
    nativeLockSha256: cargoLock ? sha(cargoLock) : null,
    scope: ['Every actual production file is a node, including isolated modules; resolved assets and conditional Rust test inputs are explicit.',
      'ESM imports/re-exports/literal dynamic imports, module-relative URLs, CSS imports/URLs, HTML resources and Rust file declarations/includes are recorded.',
      'ESM and CSS imports and native file declarations have independent cycle domains. Worker/resource launches do not create same-realm ESM initialization edges.',
      'Rust namespace edges resolve module/package prefixes, not symbols; valid parent namespace references are not ESM cycles. Computed file includes fail admission.',
      'Cargo target resolution, macros, symbols and external transitive dependency safety retain the mandatory Windows Rust/dependency CI gates. Vendor globs are recorded against declared locked packages; Vite validates their external file expansion.'],
    issues: issues.sort(compare) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--write' && !arg.startsWith('--root='))) throw new Error('Only --write and --root= are supported.');
    const root = resolve(args.find(arg => arg.startsWith('--root='))?.slice(7) || process.cwd());
    const graph = await buildDependencyGraph({ root });
    if (args.includes('--write')) {
      const path = resolve(root, REPORT); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ baselineCommit: getGitHead(root), ...graph }, null, 2) + '\n');
    }
    console.log(JSON.stringify({ productionFiles: graph.productionFiles, nodes: graph.nodes.length, edges: graph.edges.length, cycles: graph.cycles, issues: graph.issues }));
    if (graph.issues.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
}
