import { createSafeElement, requireElementRef } from '../dom/index.js';
import { mountCompatibilityModalShells } from './mount-modal-shells.js';

const mounts = new WeakMap();
const CONTENT_SLOTS = Object.freeze(['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay']);
const REQUIRED_TEMPLATES = Object.freeze([...CONTENT_SLOTS, 'ports']);

function assertRoot(root) {
  requireElementRef(root, '#app-root');
  if (root.id !== 'app-root' || !root.ownerDocument?.body) {
    throw new TypeError('Compatibility business content requires the live #app-root element.');
  }
}

function assertSlots(root, slots, documentRef) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new TypeError('Compatibility business content requires App Shell slots.');
  }
  for (const name of CONTENT_SLOTS) {
    const slot = requireElementRef(slots[name], `App Shell slot ${name}`);
    if (slot.ownerDocument !== documentRef) {
      throw new TypeError(`App Shell slot ${name} belongs to another document.`);
    }
    if (!root.contains(slot)) {
      throw new TypeError(`App Shell slot ${name} is outside the current application root.`);
    }
  }
}

function collectTemplates(fragment) {
  const elements = [...fragment.children];
  if (!elements.length || elements.some(element => element.tagName !== 'TEMPLATE')) {
    throw new Error('Compatibility business content must contain only top-level templates.');
  }
  const templates = new Map();
  for (const element of elements) {
    const name = String(element.dataset.compatSlot || '').trim();
    if (!REQUIRED_TEMPLATES.includes(name)) throw new Error(`Unknown compatibility template: ${name || '<empty>'}.`);
    if (templates.has(name)) throw new Error(`Duplicate compatibility template: ${name}.`);
    templates.set(name, element);
  }
  const missing = REQUIRED_TEMPLATES.filter(name => !templates.has(name));
  if (missing.length) throw new Error(`Missing compatibility templates: ${missing.join(', ')}.`);
  return templates;
}

function appendTemplate(template, target, mountedNodes) {
  requireElementRef(target, 'compatibility template target');
  const nodes = [...template.content.childNodes];
  target.append(template.content);
  mountedNodes.push(...nodes);
}

function removeNodes(nodes, errors) {
  for (const node of [...nodes].reverse()) {
    try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
  }
  nodes.length = 0;
}

export function createCompatibilityBusinessContentPort(root, slots, { theme = 'light' } = {}) {
  assertRoot(root);
  const documentRef = root.ownerDocument;
  assertSlots(root, slots, documentRef);
  const existing = mounts.get(root);
  if (existing) return existing;

  const body = requireElementRef(documentRef.body, 'document body');
  const previousTheme = body.getAttribute('data-theme');
  const portsHost = createSafeElement(documentRef, 'div', {
    id: 'compatibility-business-ports',
    attributes: { hidden: true, 'aria-hidden': 'true' },
    dataset: { compatibilityPort: 'business-content' }
  });
  const mountedNodes = [];
  let modalShells = null;
  let mounted = false;
  let destroyed = false;

  function restoreTheme() {
    if (previousTheme === null) body.removeAttribute('data-theme');
    else body.setAttribute('data-theme', previousTheme);
  }

  const api = Object.freeze({
    mount(markup) {
      if (destroyed) throw new Error('Compatibility business content port has been destroyed.');
      if (mounted) return false;
      if (typeof markup !== 'string' || markup.trim().length === 0) {
        throw new TypeError('Compatibility business content must be non-empty markup.');
      }
      if (/<script\b/i.test(markup)) throw new Error('Compatibility business content must not contain scripts.');

      const template = createSafeElement(documentRef, 'template');
      template.innerHTML = markup;
      const templates = collectTemplates(template.content);
      const errors = [];
      try {
        for (const name of CONTENT_SLOTS) appendTemplate(templates.get(name), slots[name], mountedNodes);
        slots.overlay.append(portsHost);
        appendTemplate(templates.get('ports'), portsHost, mountedNodes);
        modalShells = mountCompatibilityModalShells(slots.overlay);
        if (previousTheme === null) body.setAttribute('data-theme', theme);
        mounted = true;
        return true;
      } catch (error) {
        errors.push(error);
        try { modalShells?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
        modalShells = null;
        removeNodes(mountedNodes, errors);
        try { portsHost.remove(); } catch (cleanupError) { errors.push(cleanupError); }
        restoreTheme();
        if (errors.length === 1) throw error;
        throw new AggregateError(errors, 'Failed to mount compatibility business content.');
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { modalShells?.destroy(); } catch (error) { errors.push(error); }
      modalShells = null;
      removeNodes(mountedNodes, errors);
      try { portsHost.remove(); } catch (error) { errors.push(error); }
      restoreTheme();
      mounted = false;
      mounts.delete(root);
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy compatibility business content.');
    }
  });

  mounts.set(root, api);
  return api;
}
