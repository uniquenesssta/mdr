/**
 * Responsibility: Own submenu open/close interaction, viewport-aware geometry, delayed close timers and focus lifecycle.
 * Imports: None. Menu Model/View, business commands, persistence and Recent Files data are forbidden.
 * Exports: createSubmenuPositioner().
 * State/side effects: Owns submenu listener/timer/frame registrations and transient positioning styles only.
 * Lifecycle: Explicit idempotent start/closeAll/destroy; destroy removes every listener and cancels pending work.
 */

const DEFAULT_CLOSE_DELAY_MS = 1000;
const DEFAULT_VIEWPORT_MARGIN = 8;
const DEFAULT_GAP = 4;
const DEFAULT_TOP_OFFSET = 6;

function assertRoot(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('SubmenuPositioner requires a Menu root element.');
  }
}

function directSubmenuList(owner) {
  for (const child of owner?.children || []) {
    if (child?.classList?.contains?.('menu-submenu-list')) return child;
  }
  return null;
}

function resetPosition(submenu) {
  submenu?.style?.removeProperty?.('position');
  submenu?.style?.removeProperty?.('left');
  submenu?.style?.removeProperty?.('right');
  submenu?.style?.removeProperty?.('top');
}

function resolveViewport(runtime) {
  return Object.freeze({
    width: Math.max(0, Number(runtime?.innerWidth) || 0),
    height: Math.max(0, Number(runtime?.innerHeight) || 0)
  });
}

function positionSubmenu({ owner, submenu, runtime, viewportMargin, gap, topOffset }) {
  const ownerRect = owner.getBoundingClientRect();

  // Keep submenu coordinates local to the parent menu item. Top-level menu entrance animation uses transform;
  // fixed positioning would apply viewport coordinates again inside that transformed containing block.
  submenu.style.position = 'absolute';
  submenu.style.right = 'auto';
  submenu.style.left = `${Math.round(ownerRect.width + gap)}px`;
  submenu.style.top = `${-topOffset}px`;

  const submenuRect = submenu.getBoundingClientRect();
  const viewport = resolveViewport(runtime);
  const fitsRight = ownerRect.right + gap + submenuRect.width <= viewport.width - viewportMargin;
  const localLeft = fitsRight ? ownerRect.width + gap : -submenuRect.width - gap;
  const maxViewportTop = Math.max(viewportMargin, viewport.height - submenuRect.height - viewportMargin);
  const viewportTop = Math.max(viewportMargin, Math.min(ownerRect.top - topOffset, maxViewportTop));

  submenu.style.left = `${Math.round(localLeft)}px`;
  submenu.style.top = `${Math.round(viewportTop - ownerRect.top)}px`;
}

export function createSubmenuPositioner({
  root,
  runtime = root?.ownerDocument?.defaultView || globalThis,
  closeDelayMs = DEFAULT_CLOSE_DELAY_MS,
  viewportMargin = DEFAULT_VIEWPORT_MARGIN,
  gap = DEFAULT_GAP,
  topOffset = DEFAULT_TOP_OFFSET
} = {}) {
  assertRoot(root);
  if (!runtime || typeof runtime.setTimeout !== 'function' || typeof runtime.clearTimeout !== 'function') {
    throw new TypeError('SubmenuPositioner requires timer-capable runtime.');
  }
  if (![closeDelayMs, viewportMargin, gap, topOffset].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) {
    throw new TypeError('SubmenuPositioner timing and geometry options must be non-negative finite numbers.');
  }

  const delay = Number(closeDelayMs);
  const margin = Number(viewportMargin);
  const submenuGap = Number(gap);
  const offset = Number(topOffset);
  const entries = new Map();
  let started = false;
  let destroyed = false;

  const requestFrame = typeof runtime.requestAnimationFrame === 'function'
    ? callback => runtime.requestAnimationFrame(callback)
    : callback => runtime.setTimeout(callback, 0);
  const cancelFrame = typeof runtime.cancelAnimationFrame === 'function'
    ? handle => runtime.cancelAnimationFrame(handle)
    : handle => runtime.clearTimeout(handle);

  const assertActive = () => {
    if (destroyed) throw new Error('SubmenuPositioner is destroyed.');
  };

  function cancelClose(entry) {
    if (!entry.closeTimer) return;
    runtime.clearTimeout(entry.closeTimer);
    entry.closeTimer = 0;
  }

  function cancelPosition(entry) {
    if (!entry.frame) return;
    cancelFrame(entry.frame);
    entry.frame = 0;
  }

  function resetEntry(entry) {
    cancelClose(entry);
    cancelPosition(entry);
    entry.owner.classList?.remove?.('is-submenu-open');
    resetPosition(entry.submenu);
  }

  function open(entry) {
    if (destroyed || entry.owner.classList?.contains?.('disabled')) return false;
    cancelClose(entry);
    cancelPosition(entry);
    entry.owner.classList?.add?.('is-submenu-open');
    entry.frame = requestFrame(() => {
      entry.frame = 0;
      if (destroyed || !entry.owner.classList?.contains?.('is-submenu-open')) return;
      positionSubmenu({
        owner: entry.owner,
        submenu: entry.submenu,
        runtime,
        viewportMargin: margin,
        gap: submenuGap,
        topOffset: offset
      });
    });
    return true;
  }

  function scheduleClose(entry) {
    if (destroyed) return;
    cancelClose(entry);
    entry.closeTimer = runtime.setTimeout(() => {
      entry.closeTimer = 0;
      if (destroyed) return;
      const activeElement = entry.owner.ownerDocument?.activeElement || root.ownerDocument?.activeElement || null;
      if (
        entry.owner.matches?.(':hover') ||
        entry.submenu.matches?.(':hover') ||
        (activeElement && entry.owner.contains?.(activeElement))
      ) return;
      entry.owner.classList?.remove?.('is-submenu-open');
      cancelPosition(entry);
      resetPosition(entry.submenu);
    }, delay);
  }

  function bind(owner) {
    const submenu = directSubmenuList(owner);
    if (!submenu) return;
    const entry = {
      owner,
      submenu,
      closeTimer: 0,
      frame: 0,
      onPointerEnter: null,
      onPointerLeave: null,
      onFocusIn: null,
      onFocusOut: null
    };
    entry.onPointerEnter = () => open(entry);
    entry.onPointerLeave = () => scheduleClose(entry);
    entry.onFocusIn = () => open(entry);
    entry.onFocusOut = () => scheduleClose(entry);

    owner.addEventListener('pointerenter', entry.onPointerEnter);
    owner.addEventListener('pointerleave', entry.onPointerLeave);
    owner.addEventListener('focusin', entry.onFocusIn);
    owner.addEventListener('focusout', entry.onFocusOut);
    submenu.addEventListener('pointerenter', entry.onPointerEnter);
    submenu.addEventListener('pointerleave', entry.onPointerLeave);
    entries.set(owner, entry);
  }

  function closeAllEntries() {
    for (const entry of entries.values()) resetEntry(entry);
  }

  return Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      for (const owner of root.querySelectorAll('.menu-submenu')) bind(owner);
      started = true;
      return true;
    },
    closeAll() {
      assertActive();
      closeAllEntries();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeAllEntries();
      for (const entry of entries.values()) {
        entry.owner.removeEventListener('pointerenter', entry.onPointerEnter);
        entry.owner.removeEventListener('pointerleave', entry.onPointerLeave);
        entry.owner.removeEventListener('focusin', entry.onFocusIn);
        entry.owner.removeEventListener('focusout', entry.onFocusOut);
        entry.submenu.removeEventListener('pointerenter', entry.onPointerEnter);
        entry.submenu.removeEventListener('pointerleave', entry.onPointerLeave);
      }
      entries.clear();
      started = false;
    }
  });
}
