// Test-only structural inventory. It identifies declared cases and direct retired
// source reads; it never redirects file reads or treats names as behavior proof.
import { parseAst } from 'rollup/parseAst';

export const retiredSurfacePaths = Object.freeze([
  'public/app/core.js', 'public/app/bootstrap.js', 'public/app/editor-tools.js',
  'public/app/events.js', 'public/app/web-clipper.js'
]);

export function walkTestSyntax(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walkTestSyntax(child, visit);
    } else if (value && typeof value === 'object') walkTestSyntax(value, visit);
  }
}

function literalText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = literalText(node.left), right = literalText(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

export function inspectTestSource(source) {
  const cases = [], caseContracts = [], disabledCases = [], retiredReads = [], readerImports = [];
  const ast = parseAst(source);
  walkTestSyntax(ast, node => {
    if (node.type === 'ImportDeclaration' && node.source.value.endsWith('/application-surface-source.mjs')) {
      readerImports.push({ start: node.start, end: node.end, names: node.specifiers.map(item => item.imported?.name || item.local.name) });
    }
    if (node.type === 'ImportExpression' && literalText(node.source)?.endsWith('/application-surface-source.mjs')) {
      readerImports.push({ start: node.start, end: node.end, names: [], dynamic: true });
    }
    if (node.type !== 'CallExpression') return;
    if (node.callee.type === 'Identifier' && node.callee.name === 'test' && node.arguments.length) {
      const argument = node.arguments[0];
      const name = literalText(argument) ?? 'expression:' + source.slice(argument.start, argument.end);
      cases.push(name);
      const assertions = [];
      walkTestSyntax(node.arguments.at(-1), child => {
        if (child.type === 'CallExpression' && child.callee.type === 'MemberExpression' && child.callee.object.name === 'assert') {
          assertions.push(source.slice(child.start, child.end));
        }
      });
      caseContracts.push({ name, assertions });
      const options = node.arguments[1];
      if (options?.type === 'ObjectExpression' && options.properties.some(property => ['skip', 'todo', 'only'].includes(property.key.name || property.key.value))) disabledCases.push(name);
    }
    if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'test' && ['skip', 'todo', 'only'].includes(node.callee.property.name)) disabledCases.push(source.slice(node.start, node.end));
    const reader = node.callee.type === 'Identifier' ? node.callee.name : null;
    if (!['readFile', 'readFileSync', 'read', 'source', 'readText'].includes(reader)) return;
    let argument = node.arguments[0];
    if (argument?.type === 'NewExpression' && argument.callee.name === 'URL') argument = argument.arguments[0];
    if (argument?.type === 'CallExpression' && ['resolve', 'join'].includes(argument.callee.name || argument.callee.property?.name)) argument = argument.arguments.at(-1);
    const text = literalText(argument);
    if (text === null) return;
    const path = retiredSurfacePaths.find(path => text === path || text.endsWith('/' + path));
    if (path) retiredReads.push({ path, reader, start: node.start, end: node.end, argumentStart: argument.start, argumentEnd: argument.end });
  });
  return { cases, caseContracts, disabledCases, retiredReads, readerImports };
}
