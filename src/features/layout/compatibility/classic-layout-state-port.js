/**
 * Responsibility: Scoped Stage 6 migration bridge exposing the one LayoutState owner to remaining classic layout callers.
 * Imports: Responsive breakpoint helpers only; LayoutState instance is injected.
 * Exports: mountClassicLayoutStatePort().
 * State/side effects: Owns one non-enumerable compatibility-host property; owns no layout values and removes the property on destroy.
 */
import {
  RESPONSIVE_BREAKPOINTS,
  RESPONSIVE_MEDIA_QUERIES,
  getCompactShellMaxWidth,
  getCompactSplitMaxWidth,
  matchesNarrowInteractiveLayout
} from '../shell/responsive-breakpoints.js';

const PORT_PROPERTY = 'markdownEditorLayoutStatePort';

function assertTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('Classic Layout State port target must be an object.');
}

function assertLayoutState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('Classic Layout State port requires LayoutState.');
  for (const method of ['setSidebar', 'setSplit', 'setMode', 'setCompact', 'setFullscreen', 'setResize', 'subscribe']) {
    if (typeof state[method] !== 'function') throw new TypeError(`Classic Layout State port requires ${method}().`);
  }
  if (!('snapshot' in state)) throw new TypeError('Classic Layout State port requires snapshot access.');
}

function defineForwardedProperty(api, name, read, write) {
  Object.defineProperty(api, name, {
    enumerable: true,
    configurable: false,
    get: read,
    set: write
  });
}

export function mountClassicLayoutStatePort(target, state) {
  assertTarget(target);
  assertLayoutState(state);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic Layout State port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Classic Layout State port is destroyed.');
  };
  const current = () => {
    assertActive();
    return state.snapshot;
  };
  const api = {
    get snapshot() { return current(); },
    get breakpoints() { assertActive(); return RESPONSIVE_BREAKPOINTS; },
    get mediaQueries() { assertActive(); return RESPONSIVE_MEDIA_QUERIES; },
    getCompactShellMaxWidth(active) { assertActive(); return getCompactShellMaxWidth(active); },
    getCompactSplitMaxWidth(active) { assertActive(); return getCompactSplitMaxWidth(active); },
    matchesNarrowInteractive(matchMedia) { assertActive(); return matchesNarrowInteractiveLayout(matchMedia); },
    subscribe(listener) { assertActive(); return state.subscribe(listener); }
  };

  defineForwardedProperty(api, 'sidebarVisible', () => current().sidebar.visible, value => state.setSidebar({ visible: value }));
  defineForwardedProperty(api, 'sidebarAutoCollapsed', () => current().sidebar.autoCollapsed, value => state.setSidebar({ autoCollapsed: value }));
  defineForwardedProperty(api, 'sidebarWidth', () => current().sidebar.width, value => state.setSidebar({ width: value }));
  defineForwardedProperty(api, 'editorCollapsed', () => current().split.editorCollapsed, value => state.setSplit({ editorCollapsed: value }));
  defineForwardedProperty(api, 'previewCollapsed', () => current().split.previewCollapsed, value => state.setSplit({ previewCollapsed: value }));
  defineForwardedProperty(api, 'editorRatio', () => current().split.ratio, value => state.setSplit({ ratio: value }));
  defineForwardedProperty(api, 'compactSplitActive', () => current().split.compactActive, value => state.setSplit({ compactActive: value }));
  defineForwardedProperty(api, 'compactSplitPane', () => current().split.compactPane, value => state.setSplit({ compactPane: value }));
  defineForwardedProperty(api, 'layoutMode', () => current().mode, value => state.setMode(value));
  defineForwardedProperty(api, 'compactShellActive', () => current().compact.shellActive, value => state.setCompact({ shellActive: value }));
  defineForwardedProperty(api, 'compactShellInitialized', () => current().compact.shellInitialized, value => state.setCompact({ shellInitialized: value }));
  defineForwardedProperty(api, 'pageFullscreen', () => current().fullscreen.page, value => state.setFullscreen({ page: value }));
  defineForwardedProperty(api, 'systemFullscreen', () => current().fullscreen.system, value => state.setFullscreen({ system: value }));
  defineForwardedProperty(api, 'isResizing', () => current().resize.splitActive, value => state.setResize({ splitActive: value }));
  defineForwardedProperty(api, 'isSidebarResizing', () => current().resize.sidebarActive, value => state.setResize({ sidebarActive: value }));
  defineForwardedProperty(api, 'windowResizeActiveUntil', () => current().resize.windowActiveUntil, value => state.setResize({ windowActiveUntil: value }));
  defineForwardedProperty(api, 'windowResizeBurstStartedAt', () => current().resize.windowBurstStartedAt, value => state.setResize({ windowBurstStartedAt: value }));
  defineForwardedProperty(api, 'windowResizeBurstEvents', () => current().resize.windowBurstEvents, value => state.setResize({ windowBurstEvents: value }));
  Object.freeze(api);

  Object.defineProperty(target, PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
