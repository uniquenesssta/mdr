import assert from 'node:assert/strict';

export function rustFunction(text, name) {
  const match = text.match(new RegExp(`^(?:pub(?:\\(super\\))? )?(?:async )?fn ${name}\\b[\\s\\S]*?^}`, 'm'));
  assert.ok(match, `missing log function ${name}`);
  const declaration = match[0].indexOf('{');
  return (match[0].slice(0, declaration).replace(/,\s*\)/g, ')') + match[0].slice(declaration))
    .replace(/^pub(?:\(super\))? /, '');
}
