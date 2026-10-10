import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import katex from 'katex';

test('R14-07 A10 pins the patched KaTeX engine for direct and Mermaid dependency paths', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(manifest.dependencies.katex, '0.18.2'); assert.equal(manifest.overrides.katex, '$katex'); assert.equal(katex.version, '0.18.2');
  const engines = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/katex$/.test(path));
  assert.ok(engines.length > 0); for (const [, value] of engines) assert.equal(value.version, '0.18.2');
  assert.equal(lock.packages['node_modules/mermaid'].version, '11.16.1');
});

for (const expression of ['\\href{javascript:alert(1)}{click}', '\\includegraphics{https://example.invalid/polluted.png}']) {
  test(`R14-07 patched engine ignores inherited trust for ${expression}`, () => {
    const options = Object.create({ trust: true }); options.throwOnError = false;
    const html = katex.renderToString(expression, options);
    assert.doesNotMatch(html, /<a\b|<img\b/);
    assert.ok(html.includes('katex'));
  });
}
test('R14-07 inherited default/processor/trust pollution cannot turn an untrusted formula into a link', () => {
  const descriptors = Object.fromEntries(['trust', 'default', 'processor'].map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    for (const [key, value] of [['trust', true], ['default', true], ['processor', () => true]]) Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
    const html = katex.renderToString('\\href{javascript:alert(1)}{click}', { throwOnError: false });
    assert.doesNotMatch(html, /<a\b|<img\b/);
  } finally { for (const [key, value] of Object.entries(descriptors)) value ? Object.defineProperty(Object.prototype, key, value) : delete Object.prototype[key]; }
});
test('R14-07 polluted namespace is not accepted as a macro definition', () => {
  const key = '\\pollutedMacro', descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  try {
    Object.defineProperty(Object.prototype, key, { value: '\\text{POLLUTEDTOKEN}', configurable: true, writable: true });
    // A polluted name can reach the function parser and get a different diagnostic.
    // The contract is a ParseError rejection, never an inherited macro expansion.
    assert.throws(() => katex.renderToString(key), error => error instanceof katex.ParseError && error.message.includes(key));
    const rejected = katex.renderToString(key, { throwOnError: false });
    assert.match(rejected, /katex-error/); assert.doesNotMatch(rejected, /POLLUTEDTOKEN/);
    // Explicit own macros must still work under the same inherited pollution.
    const own = katex.renderToString(key, { macros: { [key]: '\\text{OWNMACRO}' } });
    assert.match(own, /OWNMACRO/); assert.doesNotMatch(own, /POLLUTEDTOKEN/);
  } finally { descriptor ? Object.defineProperty(Object.prototype, key, descriptor) : delete Object.prototype[key]; }
});
test('R14-07 patched engine retains ordinary inline/block math, TeX errors and explicit untrusted links', () => {
  assert.ok(katex.renderToString('x^2').includes('katex'));
  assert.ok(katex.renderToString('\\frac{1}{2}', { displayMode: true }).includes('katex-display'));
  assert.throws(() => katex.renderToString('\\notACommand'), /Undefined control sequence/);
  assert.doesNotMatch(katex.renderToString('\\href{javascript:alert(1)}{click}', { trust: false, throwOnError: false }), /<a\b/);
});
