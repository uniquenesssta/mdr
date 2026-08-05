import { createUI } from '../create-ui.js';
import { createSafeElement, requireElementRef } from '../dom/index.js';

const mounts = new WeakMap();
const REQUIRED_COMPATIBILITY_SLOTS = Object.freeze([
  'menu',
  'toolbar',
  'sidebar',
  'editor',
  'preview',
  'status',
  'overlay',
  'ports'
]);

function assertMountRoot(root) {
  requireElementRef(root, '#app-root');
  if (root.id !== 'app-root' || typeof root.append !== 'function') {
    throw new TypeError('mountCurrentShell requires the #app-root element.');
  }
  if (!root.ownerDocument?.body || typeof root.ownerDocument.createElement !== 'function') {
    throw new TypeError('mountCurrentShell requires a live document-backed root.');
  }
}

function collectSlotTemplates(fragment) {
  const elements = [...fragment.children];
  if (!elements.length || elements.some(element => element.tagName !== 'TEMPLATE')) {
    throw new Error('Current shell markup must contain only top-level compatibility templates.');
  }

  const templates = new Map();
  for (const element of elements) {
    const slotName = String(element.dataset.compatSlot || '').trim();
    if (!REQUIRED_COMPATIBILITY_SLOTS.includes(slotName)) {
      throw new Error('Unknown compatibility slot: ' + (slotName || '<empty>'));
    }
    if (templates.has(slotName)) {
      throw new Error('Duplicate compatibility slot: ' + slotName);
    }
    templates.set(slotName, element);
  }

  const missing = REQUIRED_COMPATIBILITY_SLOTS.filter(slotName => !templates.has(slotName));
  if (missing.length) throw new Error('Missing compatibility slots: ' + missing.join(', '));
  return templates;
}

function mountTemplate(template, target) {
  requireElementRef(target, 'compatibility slot target');
  if (!template?.content || typeof target.append !== 'function') {
    throw new TypeError('Compatibility slot target is unavailable.');
  }
  target.append(template.content);
}

export function mountCurrentShell(root, markup, {
  theme = 'light',
  createUIImpl = createUI
} = {}) {
  assertMountRoot(root);
  if (typeof markup !== 'string' || markup.trim().length === 0) {
    throw new TypeError('mountCurrentShell requires non-empty shell markup.');
  }
  if (/<script\b/i.test(markup)) {
    throw new Error('Current shell markup must not contain script elements.');
  }
  if (typeof createUIImpl !== 'function') {
    throw new TypeError('mountCurrentShell requires a createUI implementation.');
  }

  const existing = mounts.get(root);
  if (existing) return existing;

  const documentRef = root.ownerDocument;
  const body = requireElementRef(documentRef.body, 'document body');
  const template = createSafeElement(documentRef, 'template');
  template.innerHTML = markup;
  const slotTemplates = collectSlotTemplates(template.content);
  const previousTheme = body.getAttribute('data-theme');
  const ui = createUIImpl(root);

  try {
    for (const slotName of ['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay']) {
      mountTemplate(slotTemplates.get(slotName), ui[slotName]);
    }
    mountTemplate(slotTemplates.get('ports'), root);
    if (previousTheme === null) body.setAttribute('data-theme', theme);
  } catch (error) {
    ui.destroy();
    throw error;
  }

  let destroyed = false;
  const handle = Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ui.destroy();
      if (previousTheme === null) body.removeAttribute('data-theme');
      else body.setAttribute('data-theme', previousTheme);
      mounts.delete(root);
    }
  });
  mounts.set(root, handle);
  return handle;
}
