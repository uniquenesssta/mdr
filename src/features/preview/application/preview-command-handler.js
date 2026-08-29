import { normalizePreviewModeSetting, resolvePreviewMode } from '../pipeline/preview-mode-resolver.js';
import { PREVIEW_BEHAVIOR_THRESHOLDS } from '../pipeline/preview-thresholds.js';

const PORT_KEY = 'markdownEditorPreviewCommandPort';

function requireController(controller) {
  const methods = [
    'update', 'scheduleUpdate', 'scheduleFocusUpdate', 'reset', 'updateCount', 'scheduleCountUpdate',
    'setViewMode', 'getViewMode', 'suspendForHybridMode', 'deactivateVirtual', 'getVirtualStats',
    'isVirtualActive', 'containsVirtualLine', 'containsVirtualLineRange', 'hasVirtualLineRangeMounted',
    'ensureVirtualLineVisible', 'ensureVirtualLineRangeVisible', 'getVirtualMountedAnchors', 'getVirtualMetrics',
    'getVirtualContentYForLine', 'getVirtualLineForContentY', 'requestLayoutRefresh', 'focusLine',
    'getStateSnapshot', 'destroy'
  ];
  if (!controller || methods.some(name => typeof controller[name] !== 'function')) {
    throw new TypeError('Preview Command Handler requires a Preview Controller.');
  }
  return controller;
}

/**
 * Responsibility: Expose the single PreviewController command/policy surface to remaining classic callers during staged rewrite.
 * State/side effects: No duplicated Preview state; runtime commands delegate to the controller and policy reads use canonical pure modules.
 * Lifecycle: destroy() unmounts only the port it installed.
 */
export function mountPreviewCommandHandler(host, controllerValue) {
  if (!host || typeof host !== 'object') throw new TypeError('Preview Command Handler requires a host.');
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Preview Command Handler is already mounted.');
  const controller = requireController(controllerValue);
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Command Handler is destroyed.');
  };
  const virtual = Object.freeze({
    get active() { assertActive(); return controller.isVirtualActive(); },
    getStats() { assertActive(); return controller.getVirtualStats(); },
    getMountedAnchors() { assertActive(); return controller.getVirtualMountedAnchors(); },
    getMetrics() { assertActive(); return controller.getVirtualMetrics(); },
    getContentYForLine(line) { assertActive(); return controller.getVirtualContentYForLine(line); },
    getLineForContentY(y) { assertActive(); return controller.getVirtualLineForContentY(y); },
    containsLineRange(from, to) { assertActive(); return controller.containsVirtualLineRange(from, to); },
    hasLineRangeMounted(from, to) { assertActive(); return controller.hasVirtualLineRangeMounted(from, to); },
    ensureLineRangeVisible(from, to) { assertActive(); return controller.ensureVirtualLineRangeVisible(from, to); },
    ensureLineVisible(line) { assertActive(); return controller.ensureVirtualLineVisible(line); }
  });
  const port = Object.freeze({
    get snapshot() { assertActive(); return controller.getStateSnapshot(); },
    thresholds: PREVIEW_BEHAVIOR_THRESHOLDS,
    virtual,
    normalizePerformanceMode(value) { assertActive(); return normalizePreviewModeSetting(value); },
    resolvePerformanceMode(settings, sourceLength, blockCount) {
      assertActive();
      return resolvePreviewMode(settings, sourceLength, blockCount);
    },
    update: () => { assertActive(); return controller.update(); },
    scheduleUpdate: () => { assertActive(); return controller.scheduleUpdate(); },
    scheduleFocusUpdate: () => { assertActive(); return controller.scheduleFocusUpdate(); },
    reset: () => { assertActive(); return controller.reset(); },
    updateCount: () => { assertActive(); return controller.updateCount(); },
    scheduleCountUpdate: () => { assertActive(); return controller.scheduleCountUpdate(); },
    setViewMode: (mode, skipRefresh) => { assertActive(); return controller.setViewMode(mode, skipRefresh); },
    getViewMode: () => { assertActive(); return controller.getViewMode(); },
    suspendForHybridMode: () => { assertActive(); return controller.suspendForHybridMode(); },
    requestLayoutRefresh: options => { assertActive(); return controller.requestLayoutRefresh(options); },
    focusLine: (line, options) => { assertActive(); return controller.focusLine(line, options); },
    deactivateVirtual: () => { assertActive(); return controller.deactivateVirtual(); },
    getVirtualStats: () => { assertActive(); return controller.getVirtualStats(); },
    isVirtualActive: () => { assertActive(); return controller.isVirtualActive(); },
    containsVirtualLine: line => { assertActive(); return controller.containsVirtualLine(line); },
    ensureVirtualLineVisible: line => { assertActive(); return controller.ensureVirtualLineVisible(line); }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
