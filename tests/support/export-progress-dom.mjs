// DOM/event/focus double for Progress View and its VM composition; no pixel or native-I/O claims.
class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }
  add(...values) {
    for (const value of values) this.values.add(String(value));
  }
  remove(...values) {
    for (const value of values) this.values.delete(String(value));
  }
  contains(value) {
    return this.values.has(String(value));
  }
  toggle(value, force) {
    if (force === true) this.add(value);
    else if (force === false) this.remove(value);
    else if (this.contains(value)) this.remove(value);
    else this.add(value);
    return this.contains(value);
  }
  toString() {
    return [...this.values].join(' ');
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
  dispatch(type, event = {}) {
    if (!('target' in event)) event.target = this;
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function parseAttributeSelector(selector) {
  const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\](?:\.([a-z0-9_-]+))?$/i);
  if (!match) return null;
  return { name: match[1], value: match[2], className: match[3] || '' };
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  const attribute = parseAttributeSelector(selector);
  if (attribute) {
    if (!element.hasAttribute(attribute.name)) return false;
    if (attribute.value !== undefined && element.getAttribute(attribute.name) !== attribute.value) return false;
    return !attribute.className || element.classList.contains(attribute.className);
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.childNodes = this.children;
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.style = { display: '' };
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.focusCalls = [];
  }
  set id(value) {
    const normalized = String(value || '');
    if (normalized) this.attributes.set('id', normalized);
    else this.attributes.delete('id');
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set className(value) {
    this.classList.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
  get className() {
    return this.classList.toString();
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(String(name));
  }
  removeAttribute(name) {
    this.attributes.delete(String(name));
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...nodes);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const results = [];
    const isTabbableQuery = selector.includes('button:not([disabled])');
    const visit = element => {
      for (const child of element.children) {
        if (isTabbableQuery) {
          const tag = child.tagName.toLowerCase();
          const tabindex = child.getAttribute('tabindex');
          if (!child.disabled && !child.hidden && ['a', 'button', 'input', 'select', 'textarea'].includes(tag)) results.push(child);
          else if (!child.disabled && !child.hidden && tabindex !== null && tabindex !== '-1') results.push(child);
        } else if (matchesSelector(child, selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
  remove() { this.parentNode?.removeChild(this); }
  dispatchEvent(event) { this.dispatch(event.type, event); return true; }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', target: this }); }
  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }
}

export class ExportProgressDocument {
  constructor() {
    this.body = this.createElement('body');
    this.activeElement = null;
    this.frames = [];
    this.defaultView = {
      requestAnimationFrame: callback => {
        this.frames.push(callback);
        return this.frames.length;
      }
    };
  }
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
  getElementById(id) { return this.body.querySelector('#' + id); }
  flushFrames() {
    const frames = this.frames.splice(0);
    for (const callback of frames) callback();
  }
}
