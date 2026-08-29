import {
  createEventScope,
  createFocusScope,
  createTransitionVisibility,
  isElementRef,
  requireElementRef
} from '../dom/index.js';

const ALLOWED_ROLES = new Set(['dialog', 'alertdialog']);
const CONSTRUCTOR_OPTION_KEYS = new Set(['panel', 'visibleClass', 'openDisplay', 'transitionTimeout']);
const OPTION_KEYS = new Set([
  'role',
  'ariaLabel',
  'labelledBy',
  'describedBy',
  'initialFocus',
  'returnFocus',
  'closeOnEscape',
  'closeOnBackdrop',
  'onClose'
]);

function assertOptions(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function normalizeOptionalId(value, label) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim();
  if (!normalized || /\s/.test(normalized)) throw new TypeError(`${label} must be a single element ID.`);
  return normalized;
}

function normalizeReason(value) {
  const reason = String(value || '').trim();
  if (!reason) throw new TypeError('Modal close reason must not be empty.');
  return reason;
}

function setOptionalAttribute(element, name, value) {
  if (value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

function captureAttribute(element, name) {
  return Object.freeze({ name, value: element.getAttribute(name) });
}

function restoreAttribute(element, snapshot) {
  if (snapshot.value === null) element.removeAttribute(snapshot.name);
  else element.setAttribute(snapshot.name, snapshot.value);
}

function isNodeRef(value, documentRef) {
  return Boolean(value && typeof value === 'object' && typeof value.nodeType === 'number' && value.ownerDocument === documentRef);
}

function normalizeContent(content, documentRef) {
  if (content === null || content === undefined) return null;
  if (isNodeRef(content, documentRef)) return [content];
  if (typeof content === 'string' || typeof content[Symbol.iterator] !== 'function') {
    throw new TypeError('Modal content must be a DOM node, an iterable of DOM nodes, or null.');
  }
  const nodes = [...content];
  if (!nodes.length || nodes.some(node => !isNodeRef(node, documentRef))) {
    throw new TypeError('Modal content iterable must contain only DOM nodes from the modal document.');
  }
  return nodes;
}

function scheduleFrame(documentRef, callback) {
  const requestFrame = documentRef.defaultView?.requestAnimationFrame;
  if (typeof requestFrame === 'function') return requestFrame.call(documentRef.defaultView, callback);
  return setTimeout(callback, 0);
}

function contains(root, element) {
  if (!element) return false;
  if (typeof root.contains === 'function') return root.contains(element);
  let current = element;
  while (current) {
    if (current === root) return true;
    current = current.parentNode || null;
  }
  return false;
}

export class ModalShell {
  constructor(root, options = {}) {
    const normalizedOptions = assertOptions(options, 'Modal shell options');
    for (const key of Object.keys(normalizedOptions)) {
      if (!CONSTRUCTOR_OPTION_KEYS.has(key)) throw new TypeError(`Unknown modal shell option: ${key}.`);
    }
    const {
      panel = root?.firstElementChild || null,
      visibleClass = 'show',
      openDisplay = 'flex',
      transitionTimeout = 220
    } = normalizedOptions;

    this.root = requireElementRef(root, 'modal shell root');
    this.panel = requireElementRef(panel, 'modal shell panel');
    if (!contains(this.root, this.panel)) {
      throw new TypeError('Modal shell panel must be contained by the modal root.');
    }
    if (!this.root.ownerDocument?.defaultView && typeof setTimeout !== 'function') {
      throw new TypeError('Modal shell requires a live document-backed root.');
    }
    if (typeof openDisplay !== 'string' || !openDisplay.trim()) {
      throw new TypeError('Modal shell openDisplay must be a non-empty string.');
    }

    this.document = this.root.ownerDocument;
    this.openDisplay = openDisplay.trim();
    this.visibleClass = String(visibleClass || '').trim();
    this.events = createEventScope();
    this.visibility = createTransitionVisibility(this.root, {
      visibleClass,
      hiddenAttribute: 'aria-hidden',
      timeout: transitionTimeout
    });
    this.focusScope = null;
    this.session = null;
    this.generation = 0;
    this.destroyed = false;

    this.original = Object.freeze({
      rootDisplay: this.root.style?.display ?? '',
      rootAriaHidden: captureAttribute(this.root, 'aria-hidden'),
      rootVisible: this.root.classList.contains(visibleClass),
      panelAttributes: Object.freeze([
        captureAttribute(this.panel, 'role'),
        captureAttribute(this.panel, 'aria-modal'),
        captureAttribute(this.panel, 'aria-label'),
        captureAttribute(this.panel, 'aria-labelledby'),
        captureAttribute(this.panel, 'aria-describedby'),
        captureAttribute(this.panel, 'tabindex')
      ])
    });

    const initialRole = String(this.panel.getAttribute('role') || '').trim();
    this.panel.setAttribute('role', ALLOWED_ROLES.has(initialRole) ? initialRole : 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    if (!this.panel.hasAttribute('tabindex')) this.panel.setAttribute('tabindex', '-1');
    if (!this.original.rootVisible) {
      this.root.setAttribute('aria-hidden', 'true');
      if (this.root.style) this.root.style.display = 'none';
    }

    this.events.listen(this.root, 'keydown', event => {
      if (!this.isOpen() || !this.session?.closeOnEscape || event?.key !== 'Escape') return;
      event.preventDefault?.();
      event.stopPropagation?.();
      this.close('escape');
    }, true);
    this.events.listen(this.root, 'mousedown', event => {
      if (!this.isOpen() || !this.session?.closeOnBackdrop || event?.target !== this.root) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      this.close('backdrop');
    });
  }

  assertActive() {
    if (this.destroyed) throw new Error('Modal shell has been destroyed.');
  }

  open(content, options = {}) {
    this.assertActive();
    const normalizedOptions = assertOptions(options, 'Modal open options');
    for (const key of Object.keys(normalizedOptions)) {
      if (!OPTION_KEYS.has(key)) throw new TypeError(`Unknown modal open option: ${key}.`);
    }

    const role = String(normalizedOptions.role || this.panel.getAttribute('role') || 'dialog').trim();
    if (!ALLOWED_ROLES.has(role)) throw new TypeError(`Unsupported modal role: ${role || '<empty>'}.`);
    const ariaLabel = String(normalizedOptions.ariaLabel || '').trim();
    const labelledBy = normalizeOptionalId(normalizedOptions.labelledBy, 'Modal labelledBy');
    const describedBy = normalizeOptionalId(normalizedOptions.describedBy, 'Modal describedBy');
    if (ariaLabel && labelledBy) throw new TypeError('Modal must use either ariaLabel or labelledBy, not both.');
    if (normalizedOptions.initialFocus !== undefined && normalizedOptions.initialFocus !== null
      && !isElementRef(normalizedOptions.initialFocus)) {
      throw new TypeError('Modal initialFocus must be an element reference or null.');
    }
    if (normalizedOptions.returnFocus !== undefined && normalizedOptions.returnFocus !== null
      && !isElementRef(normalizedOptions.returnFocus)) {
      throw new TypeError('Modal returnFocus must be an element reference or null.');
    }
    if (normalizedOptions.onClose !== undefined && typeof normalizedOptions.onClose !== 'function') {
      throw new TypeError('Modal onClose must be a function.');
    }
    for (const key of ['closeOnEscape', 'closeOnBackdrop']) {
      if (normalizedOptions[key] !== undefined && typeof normalizedOptions[key] !== 'boolean') {
        throw new TypeError(`Modal ${key} must be a boolean.`);
      }
    }

    const nodes = normalizeContent(content, this.document);
    if (nodes) this.panel.replaceChildren(...nodes);

    const existingLabel = this.panel.getAttribute('aria-label');
    const existingLabelledBy = this.panel.getAttribute('aria-labelledby');
    if (!ariaLabel && !labelledBy && !existingLabel && !existingLabelledBy) {
      throw new TypeError('Modal requires ariaLabel, labelledBy, or an existing accessible name.');
    }

    const wasOpen = this.isOpen();
    const previousSession = this.session;
    this.generation += 1;
    const generation = this.generation;
    this.focusScope?.destroy({ restoreFocus: false });
    this.focusScope = null;
    if (wasOpen) previousSession?.onClose?.('replaced');

    this.panel.setAttribute('role', role);
    this.panel.setAttribute('aria-modal', 'true');
    if (!this.panel.hasAttribute('tabindex')) this.panel.setAttribute('tabindex', '-1');
    if (ariaLabel) {
      this.panel.setAttribute('aria-label', ariaLabel);
      this.panel.removeAttribute('aria-labelledby');
    } else if (labelledBy) {
      this.panel.setAttribute('aria-labelledby', labelledBy);
      this.panel.removeAttribute('aria-label');
    }
    if (describedBy || normalizedOptions.describedBy !== undefined) {
      setOptionalAttribute(this.panel, 'aria-describedby', describedBy);
    }

    const returnFocus = normalizedOptions.returnFocus === undefined
      ? this.document.activeElement
      : normalizedOptions.returnFocus;
    this.session = Object.freeze({
      closeOnEscape: normalizedOptions.closeOnEscape ?? true,
      closeOnBackdrop: normalizedOptions.closeOnBackdrop ?? true,
      onClose: normalizedOptions.onClose || null
    });
    this.focusScope = createFocusScope(this.panel, {
      initialFocus: normalizedOptions.initialFocus || null,
      returnFocus: isElementRef(returnFocus) ? returnFocus : null,
      trap: true
    });

    if (this.root.style) this.root.style.display = this.openDisplay;
    this.visibility.show();
    scheduleFrame(this.document, () => {
      if (this.destroyed || generation !== this.generation || !this.isOpen()) return;
      this.focusScope?.focusInitial({ preventScroll: true });
    });
    return true;
  }

  close(reason = 'api') {
    this.assertActive();
    if (!this.isOpen()) return false;
    const normalizedReason = normalizeReason(reason);
    const closingSession = this.session;
    const closingFocusScope = this.focusScope;
    this.session = null;
    this.focusScope = null;
    this.generation += 1;
    const generation = this.generation;
    const hidden = this.visibility.hide();

    hidden.then(completed => {
      if (completed && !this.destroyed && generation === this.generation && !this.isOpen() && this.root.style) {
        this.root.style.display = 'none';
      }
    });
    scheduleFrame(this.document, () => {
      closingFocusScope?.destroy({
        restoreFocus: !this.destroyed && generation === this.generation && !this.isOpen()
      });
    });
    closingSession?.onClose?.(normalizedReason);
    return true;
  }

  isOpen() {
    return !this.destroyed && this.visibility.isVisible();
  }

  destroy() {
    if (this.destroyed) return;
    const wasOpen = this.isOpen();
    const closingSession = this.session;
    const closingFocusScope = this.focusScope;
    this.destroyed = true;
    this.generation += 1;
    this.session = null;
    this.focusScope = null;

    const errors = [];
    try { this.events.destroy(); } catch (error) { errors.push(error); }
    try { this.visibility.destroy(); } catch (error) { errors.push(error); }
    try { closingFocusScope?.destroy({ restoreFocus: wasOpen }); } catch (error) { errors.push(error); }
    try { if (wasOpen) closingSession?.onClose?.('destroy'); } catch (error) { errors.push(error); }

    if (this.original.rootVisible) this.root.classList.add(this.visibleClass);
    else this.root.classList.remove(this.visibleClass);
    if (this.root.style) this.root.style.display = this.original.rootDisplay;
    restoreAttribute(this.root, this.original.rootAriaHidden);
    for (const snapshot of this.original.panelAttributes) restoreAttribute(this.panel, snapshot);

    if (errors.length) throw new AggregateError(errors, 'Failed to destroy modal shell cleanly.');
  }

  isDestroyed() {
    return this.destroyed;
  }
}
