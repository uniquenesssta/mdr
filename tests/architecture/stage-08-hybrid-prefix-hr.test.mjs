import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFile(path.join(ROOT, relative), 'utf8');

test('Atomic 8.7 exposes Prefix, Task Checkbox and Horizontal Rule only through the Hybrid Editor public entry', async () => {
  const source = await read('src/features/hybrid-editor/index.js');
  assert.match(source, /from '\.\/widgets\/prefix\/prefix-widget\.js'/);
  assert.match(source, /from '\.\/widgets\/prefix\/task-checkbox-widget\.js'/);
  assert.match(source, /from '\.\/widgets\/horizontal-rule\/horizontal-rule-widget\.js'/);

  const module = await import(new URL('../../src/features/hybrid-editor/index.js', import.meta.url));
  assert.equal(typeof module.createHybridPrefixWidgetType, 'function');
  assert.equal(typeof module.createTaskCheckboxWidgetType, 'function');
  assert.equal(typeof module.createHorizontalRuleWidgetType, 'function');
});

test('Atomic 8.7 migrated widgets have narrow responsibility boundaries and no shared component policy', async () => {
  const prefix = await read('src/features/hybrid-editor/widgets/prefix/prefix-widget.js');
  const task = await read('src/features/hybrid-editor/widgets/prefix/task-checkbox-widget.js');
  const hr = await read('src/features/hybrid-editor/widgets/horizontal-rule/horizontal-rule-widget.js');

  assert.doesNotMatch(prefix, /view\.dispatch|transitionHybridComponent|registerHybridComponentCloser|bindWidgetSourceAction|addEventListener/);
  assert.equal((task.match(/view\.dispatch\(/g) || []).length, 1);
  assert.match(task, /from: this\.markerFrom,\s*to: this\.markerFrom \+ 1,/s);
  assert.doesNotMatch(task, /transitionHybridComponent|registerHybridComponentCloser|bindWidgetSourceAction|document\.addEventListener|window\.addEventListener/);
  assert.doesNotMatch(hr, /addEventListener|bindWidgetSourceAction|bindStrictDoubleActivation|transitionHybridComponent|registerHybridComponentCloser/);
  assert.doesNotMatch(prefix + task + hr, /componentType|HYBRID_COMPONENT_MODES|sourceEdit/i);
  assert.doesNotMatch(prefix + task + hr, /from '@codemirror\/view'/);
  assert.match(prefix, /createHybridPrefixWidgetType\(WidgetType\)/);
  assert.match(task, /createTaskCheckboxWidgetType\(WidgetType\)/);
  assert.match(hr, /createHorizontalRuleWidgetType\(WidgetType\)/);
});

test('Atomic 8.7 inline presentation consumes migrated widgets through the public entry and leaves Inline Math in the legacy module', async () => {
  const inline = await read('src/editor/hybrid/inline-presentation.js');
  assert.match(inline, /import \{ InlineMathWidget \} from '\.\/widgets\.js';/);
  assert.match(inline, /createHorizontalRuleWidgetType,[\s\S]*createHybridPrefixWidgetType,[\s\S]*createTaskCheckboxWidgetType[\s\S]*from '\.\.\/\.\.\/features\/hybrid-editor\/index\.js';/);
  assert.match(inline, /import \{ Decoration, WidgetType \} from '@codemirror\/view';/);
  assert.match(inline, /const HybridPrefixWidget = createHybridPrefixWidgetType\(WidgetType\);/);
  assert.match(inline, /const TaskCheckboxWidget = createTaskCheckboxWidgetType\(WidgetType\);/);
  assert.match(inline, /const HorizontalRuleWidget = createHorizontalRuleWidgetType\(WidgetType\);/);
  assert.match(inline, /new TaskCheckboxWidget\(\{\s*checked: task\[3\]\.toLowerCase\(\) === 'x',\s*markerFrom\s*\}\)/s);
  assert.match(inline, /new HybridPrefixWidget\('bullet', \{ label: '•' \}\)/);
  assert.match(inline, /new HybridPrefixWidget\('ordered', \{ label: ordered\[2\] \}\)/);
  assert.match(inline, /new HorizontalRuleWidget\(\)/);
  assert.doesNotMatch(inline, /features\/hybrid-editor\/widgets\//);
});

test('Atomic 8.7 removes legacy Prefix, Task Checkbox and HR authority without starting Code Block migration', async () => {
  const legacy = await read('src/editor/hybrid/widgets.js');
  assert.doesNotMatch(legacy, /class HybridPrefixWidget/);
  assert.doesNotMatch(legacy, /class HorizontalRuleWidget/);
  assert.doesNotMatch(legacy, /cm-hybrid-task-box|cm-hybrid-list-prefix|cm-hybrid-horizontal-rule/);
  assert.doesNotMatch(legacy, /markerFrom/);

  await assert.rejects(fs.access(path.join(ROOT, 'src/features/hybrid-editor/widgets/code-block/code-block-widget.js')));
  await assert.rejects(fs.access(path.join(ROOT, 'src/features/hybrid-editor/widgets/code-block/code-block-direct-editor.js')));
});

test('Atomic 8.7 production inventory advances by exactly three responsibility-specific modules', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 346);
  const paths = new Set(inventory.modules.map(item => item[0]));
  for (const expected of [
    'src/features/hybrid-editor/widgets/prefix/prefix-widget.js',
    'src/features/hybrid-editor/widgets/prefix/task-checkbox-widget.js',
    'src/features/hybrid-editor/widgets/horizontal-rule/horizontal-rule-widget.js'
  ]) {
    assert.equal(paths.has(expected), true, expected);
  }
});
