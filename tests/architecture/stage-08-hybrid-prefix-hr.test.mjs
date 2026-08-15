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

test('Atomic 8.7 Prefix and HR presentation ownership remains intact after Atomic 8.11 Inline Math migration', async () => {
  const [inline, legacy] = await Promise.all([
    read('src/editor/hybrid/inline-presentation.js'),
    read('src/editor/hybrid/widgets.js')
  ]);
  assert.doesNotMatch(inline, /import \{ InlineMathWidget \} from '\.\/widgets\.js';/);
  assert.match(inline, /createHorizontalRuleWidgetType,[\s\S]*createHybridPrefixWidgetType,[\s\S]*createInlineMathWidgetType,[\s\S]*createTaskCheckboxWidgetType[\s\S]*from '\.\.\/\.\.\/features\/hybrid-editor\/index\.js';/);
  assert.match(inline, /import \{ Decoration, WidgetType \} from '@codemirror\/view';/);
  assert.match(inline, /const HybridPrefixWidget = createHybridPrefixWidgetType\(WidgetType\);/);
  assert.match(inline, /const TaskCheckboxWidget = createTaskCheckboxWidgetType\(WidgetType\);/);
  assert.match(inline, /const HorizontalRuleWidget = createHorizontalRuleWidgetType\(WidgetType\);/);
  assert.match(inline, /const InlineMathWidget = createInlineMathWidgetType\(WidgetType,/);
  assert.match(inline, /new TaskCheckboxWidget\(\{\s*checked: task\[3\]\.toLowerCase\(\) === 'x',\s*markerFrom\s*\}\)/s);
  assert.match(inline, /new HybridPrefixWidget\('bullet', \{ label: '•' \}\)/);
  assert.match(inline, /new HybridPrefixWidget\('ordered', \{ label: ordered\[2\] \}\)/);
  assert.match(inline, /new HorizontalRuleWidget\(\)/);
  assert.doesNotMatch(inline, /features\/hybrid-editor\/widgets\//);
  assert.doesNotMatch(legacy, /class InlineMathWidget/);
});

test('Atomic 8.7 Prefix, Task Checkbox and HR authority remains removed after Atomic 8.8', async () => {
  const legacy = await read('src/editor/hybrid/widgets.js');
  assert.doesNotMatch(legacy, /class HybridPrefixWidget/);
  assert.doesNotMatch(legacy, /class HorizontalRuleWidget/);
  assert.doesNotMatch(legacy, /cm-hybrid-task-box|cm-hybrid-list-prefix|cm-hybrid-horizontal-rule/);
  assert.doesNotMatch(legacy, /markerFrom/);
});

test('Atomic 8.7 production inventory keeps the three responsibility-specific Prefix/HR modules after Atomic 8.11', async () => {
  const inventory = JSON.parse(await read('tests/architecture/fixtures/production-modules.json'));
  assert.equal(inventory.modules.length, 360);
  const paths = new Set(inventory.modules.map(item => item[0]));
  for (const expected of [
    'src/features/hybrid-editor/widgets/prefix/prefix-widget.js',
    'src/features/hybrid-editor/widgets/prefix/task-checkbox-widget.js',
    'src/features/hybrid-editor/widgets/horizontal-rule/horizontal-rule-widget.js'
  ]) {
    assert.equal(paths.has(expected), true, expected);
  }
});
