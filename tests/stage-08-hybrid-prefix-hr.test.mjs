import test from 'node:test';
import assert from 'node:assert/strict';
import { WidgetType } from '@codemirror/view';

import {
  createHorizontalRuleWidgetType,
  createHybridPrefixWidgetType,
  createTaskCheckboxWidgetType
} from '../src/features/hybrid-editor/index.js';

const HybridPrefixWidget = createHybridPrefixWidgetType(WidgetType);
const TaskCheckboxWidget = createTaskCheckboxWidgetType(WidgetType);
const HorizontalRuleWidget = createHorizontalRuleWidgetType(WidgetType);

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.type = '';
    this.attributes = new Map();
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...overrides
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

function installFakeDom() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

function createTaskView(text) {
  const dispatches = [];
  let focusCount = 0;
  return {
    view: {
      state: {
        doc: {
          sliceString(from, to) {
            return text.slice(from, to);
          }
        }
      },
      dispatch(transaction) {
        dispatches.push(transaction);
      },
      focus() {
        focusCount += 1;
      }
    },
    dispatches,
    get focusCount() { return focusCount; }
  };
}

test('Atomic 8.7 prefix presentation preserves bullet/ordered DOM and never owns source mutation', () => {
  const restore = installFakeDom();
  try {
    const bullet = new HybridPrefixWidget('bullet', { label: '•' });
    const ordered = new HybridPrefixWidget('ordered', { label: '12.' });
    const bulletDom = bullet.toDOM();
    const orderedDom = ordered.toDOM();

    assert.equal(bulletDom.className, 'cm-hybrid-list-prefix is-bullet');
    assert.equal(bulletDom.textContent, '•');
    assert.equal(bulletDom.getAttribute('aria-hidden'), 'true');
    assert.equal(orderedDom.className, 'cm-hybrid-list-prefix is-ordered');
    assert.equal(orderedDom.textContent, '12.');
    assert.equal(orderedDom.getAttribute('aria-hidden'), 'true');
    assert.equal(bullet.ignoreEvent(), true);
    assert.equal(ordered.ignoreEvent(), true);
    assert.equal(bullet.eq(new HybridPrefixWidget('bullet', { label: '•' })), true);
    assert.equal(bullet.eq(new HybridPrefixWidget('ordered', { label: '•' })), false);
    assert.equal(bulletDom.listeners.size, 0);
    assert.equal(orderedDom.listeners.size, 0);
  } finally {
    restore();
  }
});

test('Atomic 8.7 task checkbox writes only its current marker in exactly one transaction', () => {
  const restore = installFakeDom();
  try {
    const unchecked = new TaskCheckboxWidget({ checked: false, markerFrom: 3 });
    const harness = createTaskView('- [ ] item');
    const button = unchecked.toDOM(harness.view);

    assert.equal(button.type, 'button');
    assert.equal(button.className, 'cm-hybrid-task-box');
    assert.equal(button.getAttribute('role'), 'checkbox');
    assert.equal(button.getAttribute('aria-checked'), 'false');
    assert.equal(button.textContent, '');
    assert.equal(unchecked.ignoreEvent(), false);

    const down = button.dispatch('mousedown');
    assert.equal(down.defaultPrevented, true);
    const click = button.dispatch('click');
    assert.equal(click.defaultPrevented, true);
    assert.equal(click.propagationStopped, true);
    assert.equal(harness.dispatches.length, 1);
    assert.deepEqual(harness.dispatches[0], {
      changes: { from: 3, to: 4, insert: 'x' }
    });
    assert.equal(harness.focusCount, 1);

    const checkedHarness = createTaskView('- [x] item');
    const checkedButton = new TaskCheckboxWidget({ checked: true, markerFrom: 3 }).toDOM(checkedHarness.view);
    assert.equal(checkedButton.getAttribute('aria-checked'), 'true');
    assert.equal(checkedButton.textContent, '✓');
    checkedButton.dispatch('click');
    assert.equal(checkedHarness.dispatches.length, 1);
    assert.deepEqual(checkedHarness.dispatches[0], {
      changes: { from: 3, to: 4, insert: ' ' }
    });
  } finally {
    restore();
  }
});

test('Atomic 8.7 task checkbox rejects stale or invalid markers without dispatching', () => {
  const restore = installFakeDom();
  try {
    const stale = createTaskView('- [?] item');
    new TaskCheckboxWidget({ checked: false, markerFrom: 3 }).toDOM(stale.view).dispatch('click');
    assert.equal(stale.dispatches.length, 0);
    assert.equal(stale.focusCount, 0);

    const missing = createTaskView('- [ ] item');
    new TaskCheckboxWidget({ checked: false, markerFrom: -1 }).toDOM(missing.view).dispatch('click');
    assert.equal(missing.dispatches.length, 0);
    assert.equal(missing.focusCount, 0);
  } finally {
    restore();
  }
});

test('Atomic 8.7 horizontal rule remains presentation-only for single and double pointer interaction', () => {
  const restore = installFakeDom();
  try {
    const widget = new HorizontalRuleWidget();
    const dom = widget.toDOM();
    assert.equal(dom.className, 'cm-hybrid-horizontal-rule');
    assert.equal(dom.getAttribute('aria-hidden'), 'true');
    assert.equal(dom.innerHTML, '<span></span>');
    assert.equal(widget.eq(new HorizontalRuleWidget()), true);
    assert.equal(widget.ignoreEvent(), true);
    assert.equal(dom.listeners.has('click'), false);
    assert.equal(dom.listeners.has('dblclick'), false);
    assert.equal(dom.listeners.has('pointerdown'), false);
  } finally {
    restore();
  }
});
