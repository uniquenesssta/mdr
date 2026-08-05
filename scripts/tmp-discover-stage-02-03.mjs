import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const sourceRoots = ['public', 'src', 'tests'];
const allowedExtensions = new Set(['.html', '.js', '.mjs', '.css']);

async function collectFiles(directory, output = []) {
  const absolute = resolve(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(relative(root, child), output);
      continue;
    }
    const repositoryPath = relative(root, child).replaceAll('\\', '/');
    if (allowedExtensions.has(extname(repositoryPath))) output.push(repositoryPath);
  }
  return output;
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectMatches(source, expression, mapper) {
  const output = [];
  for (const match of source.matchAll(expression)) output.push(mapper(match));
  return output;
}

const files = [];
for (const directory of sourceRoots) await collectFiles(directory, files);
files.sort();

const definitions = [];
const uses = [];
const rawIconReferences = [];
const svgElements = [];

for (const path of files) {
  const source = await readFile(resolve(root, path), 'utf8');
  definitions.push(...collectMatches(source, /<symbol\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi, match => ({
    path,
    line: lineNumber(source, match.index),
    id: match[1],
    tag: match[0]
  })));
  uses.push(...collectMatches(source, /<use\b[^>]*(?:href|xlink:href)=["']([^"']+)["'][^>]*>/gi, match => ({
    path,
    line: lineNumber(source, match.index),
    href: match[1],
    tag: match[0]
  })));
  rawIconReferences.push(...collectMatches(source, /(?:#|\/assets\/icons\.svg#)(icon-[a-z0-9-]+)/gi, match => ({
    path,
    line: lineNumber(source, match.index),
    id: match[1],
    raw: match[0]
  })));
  svgElements.push(...collectMatches(source, /<svg\b[^>]*>/gi, match => ({
    path,
    line: lineNumber(source, match.index),
    tag: match[0]
  })));
}

const definitionIds = definitions.map(item => item.id);
const duplicates = [...new Set(definitionIds.filter((id, index) => definitionIds.indexOf(id) !== index))].sort();
const stableIdPattern = /^icon-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const invalidIds = [...new Set(definitionIds.filter(id => !stableIdPattern.test(id)))].sort();
const useIds = uses.map(item => item.href.split('#').at(-1)).filter(Boolean);
const missingDefinitions = [...new Set(useIds.filter(id => !definitionIds.includes(id)))].sort();
const unusedDefinitions = [...new Set(definitionIds.filter(id => !useIds.includes(id)))].sort();

const report = {
  schemaVersion: 1,
  branch: process.env.GITHUB_REF_NAME || null,
  commit: process.env.GITHUB_SHA || null,
  filesScanned: files.length,
  summary: {
    definitionCount: definitions.length,
    uniqueDefinitionCount: new Set(definitionIds).size,
    useCount: uses.length,
    rawIconReferenceCount: rawIconReferences.length,
    svgElementCount: svgElements.length,
    duplicateDefinitionCount: duplicates.length,
    invalidIdCount: invalidIds.length,
    missingDefinitionCount: missingDefinitions.length,
    unusedDefinitionCount: unusedDefinitions.length
  },
  definitions,
  uses,
  rawIconReferences,
  svgElements,
  duplicates,
  invalidIds,
  missingDefinitions,
  unusedDefinitions
};

await mkdir(resolve(root, 'artifacts/stage-02'), { recursive: true });
await writeFile(resolve(root, 'artifacts/stage-02/02-03-icon-discovery.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary));
