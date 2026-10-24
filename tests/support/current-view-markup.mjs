import { readFile } from 'node:fs/promises';
import { parseAst } from 'rollup/parseAst';

const sources = [
  'menu/ui/menu-content-view.js', 'editor/ui/editor-toolbar-view.js',
  'editor/ui/editor-content-view.js', 'sidebar/ui/sidebar-content-view.js',
  'preview/ui/preview-content-view.js', 'persistence/ui/status-content-view.js',
  'documents/ui/document-content-view.js', 'import/ui/import-content-view.js'
];
const attribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const encode = node => {
  if (typeof node === 'string') return node;
  const [tag, attributes, children] = node;
  return '<' + tag + Object.entries(attributes).map(([name, value]) =>
    value === true ? ' ' + name : ' ' + name + '="' + attribute(value) + '"').join('') + '>'
    + children.map(encode).join('') + '</' + tag + '>';
};

// Read current feature-owned literal specifications, never the retired HTML or
// characterization baseline. Real DOM equivalence is separately browser-tested.
export async function readCurrentViewMarkup() {
  const result = [];
  for (const path of sources) {
    const source = await readFile(new URL('../../src/features/' + path, import.meta.url), 'utf8');
    let found = false;
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.name === 'mountStaticContent') {
        found = true;
        for (const group of node.arguments[0].elements) {
          const specification = group.elements[1];
          result.push(...JSON.parse(source.slice(specification.start, specification.end)).map(encode));
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(parseAst(source));
    if (!found) throw new Error('Missing current static View specifications: ' + path);
  }
  return result.join('\n');
}
