import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyCodeMirrorParseBudget, codeMirrorParseBudgetPlugin } from '../scripts/build/codemirror-parse-budget.mjs';

test('CodeMirror scheduling patch changes only the two reviewed idle-slice constants', async () => {
  const path=fileURLToPath(import.meta.resolve('@codemirror/language'));
  const source=await readFile(path,'utf8'),changed=applyCodeMirrorParseBudget(source);
  assert.equal(changed.replace('8 /* Work.Slice */','100 /* Work.Slice */').replace('8 /* Work.MinSlice */','25 /* Work.MinSlice */'),source);
  assert.equal((await codeMirrorParseBudgetPlugin().transform(source,path)).code,changed);
  assert.equal(await codeMirrorParseBudgetPlugin().transform(source,'src/other.js'),null);
});

test('dependency scheduling drift fails loudly for production and development preprocessing', async () => {
  assert.throws(()=>applyCodeMirrorParseBudget('unsupported'),/Unsupported/);
  const path=fileURLToPath(import.meta.resolve('@codemirror/language')),source=await readFile(path,'utf8');
  assert.throws(()=>applyCodeMirrorParseBudget(source.replace('100 /* Work.Slice */','101 /* Work.Slice */')),/seam changed/);
  const configuration=codeMirrorParseBudgetPlugin().config();let hook;
  configuration.optimizeDeps.esbuildOptions.plugins[0].setup({onLoad({filter},callback){assert.ok(filter.test(path));hook=callback;}});
  const result=await hook({path});assert.equal(result.contents,applyCodeMirrorParseBudget(source));assert.equal(result.loader,'js');
});
