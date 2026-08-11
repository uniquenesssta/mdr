/**
 * Responsibility: Own toolbar single/double-row boundary measurement and its observer/frame lifecycle.
 * Imports: Shared responsive breakpoint policy only.
 * Exports: createToolbarBoundaryController().
 * State/side effects: Measures injected toolbar DOM, projects only toolbar-boundary-wrap, owns one RAF and one ResizeObserver or resize-listener fallback.
 * Lifecycle: Explicit start/refresh/destroy; destroy disconnects observers/listeners, cancels scheduled work and is terminal.
 */
import { matchesNarrowInteractiveLayout } from '../shell/responsive-breakpoints.js';

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}
function parseLength(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

export function createToolbarBoundaryController({
  toolbar,
  formatGroup,
  actions,
  matchMedia = null,
  getStyle,
  createResizeObserver = null,
  resizeTarget = null,
  requestFrame,
  cancelFrame,
  fontsReady = null,
  record = () => {}
} = {}) {
  requireObject(toolbar, 'Toolbar Boundary toolbar');
  requireObject(toolbar.classList, 'Toolbar Boundary toolbar classList');
  requireObject(formatGroup, 'Toolbar Boundary format group');
  requireObject(actions, 'Toolbar Boundary actions');
  if (matchMedia !== null) requireFunction(matchMedia, 'Toolbar Boundary matchMedia');
  requireFunction(getStyle, 'Toolbar Boundary getStyle');
  if (createResizeObserver !== null) requireFunction(createResizeObserver, 'Toolbar Boundary ResizeObserver factory');
  if (resizeTarget !== null) {
    requireObject(resizeTarget, 'Toolbar Boundary resize target');
    requireFunction(resizeTarget.addEventListener, 'Toolbar Boundary resize target addEventListener');
    requireFunction(resizeTarget.removeEventListener, 'Toolbar Boundary resize target removeEventListener');
  }
  requireFunction(requestFrame, 'Toolbar Boundary requestFrame');
  requireFunction(cancelFrame, 'Toolbar Boundary cancelFrame');
  requireFunction(record, 'Toolbar Boundary recorder');

  let started = false;
  let destroyed = false;
  let wrapped = false;
  let evaluationFrame = 0;
  let observer = null;
  let fallbackResizeListening = false;
  let lifecycleGeneration = 0;

  function assertActive() {
    if (destroyed) throw new Error('Toolbar Boundary Controller is destroyed.');
  }

  function evaluate(reason = 'manual') {
    assertActive();
    if (toolbar.classList.contains('hidden')) {
      toolbar.classList.remove('toolbar-boundary-wrap');
      wrapped = false;
      return Object.freeze({ wrapped: false, hidden: true, reason });
    }

    const mediaWrap = matchesNarrowInteractiveLayout(matchMedia);
    if (!mediaWrap) {
      toolbar.classList.remove('toolbar-boundary-wrap');
      void toolbar.offsetWidth;
    }

    const style = getStyle(toolbar) || {};
    const horizontalPadding = parseLength(style.paddingLeft) + parseLength(style.paddingRight);
    const columnGap = parseLength(style.columnGap || style.gap);
    const availableWidth = Math.max(0, (Number(toolbar.clientWidth) || 0) - horizontalPadding);
    const requiredWidth = Math.ceil(
      (Number(formatGroup.scrollWidth) || 0)
      + (Number(actions.scrollWidth) || 0)
      + columnGap
    );
    const shouldWrap = mediaWrap || requiredWidth > availableWidth;
    const previousWrapped = wrapped;

    toolbar.classList.toggle('toolbar-boundary-wrap', shouldWrap);
    wrapped = shouldWrap;

    if (previousWrapped !== shouldWrap) {
      const rect = toolbar.getBoundingClientRect?.() || { width: Number(toolbar.clientWidth) || 0 };
      record('layout.toolbar-boundary-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: {
          wrapped: shouldWrap,
          toolbarWidth: Math.round(Number(rect.width) || 0),
          availableWidth: Math.round(availableWidth),
          requiredWidth: Math.round(requiredWidth)
        }
      });
    }

    return Object.freeze({
      wrapped: shouldWrap,
      hidden: false,
      mediaWrap,
      availableWidth,
      requiredWidth,
      reason
    });
  }

  function scheduleEvaluation(reason = 'manual') {
    if (destroyed) return false;
    if (evaluationFrame) cancelFrame(evaluationFrame);
    evaluationFrame = requestFrame(() => {
      evaluationFrame = 0;
      if (!destroyed) evaluate(reason);
    });
    return true;
  }

  function onObservedResize() {
    scheduleEvaluation('resize-observer');
  }

  function onFallbackResize() {
    scheduleEvaluation('resize');
  }

  const controller = Object.freeze({
    start() {
      assertActive();
      if (started) {
        scheduleEvaluation('restart');
        return controller;
      }
      started = true;
      lifecycleGeneration += 1;
      const generation = lifecycleGeneration;
      if (createResizeObserver) {
        observer = createResizeObserver(onObservedResize);
        requireObject(observer, 'Toolbar Boundary ResizeObserver');
        requireFunction(observer.observe, 'Toolbar Boundary ResizeObserver.observe');
        requireFunction(observer.disconnect, 'Toolbar Boundary ResizeObserver.disconnect');
        observer.observe(toolbar);
      } else if (resizeTarget) {
        resizeTarget.addEventListener('resize', onFallbackResize, { passive: true });
        fallbackResizeListening = true;
      }
      if (fontsReady && typeof fontsReady.then === 'function') {
        Promise.resolve(fontsReady).then(() => {
          if (!destroyed && started && lifecycleGeneration === generation) {
            scheduleEvaluation('fonts-ready');
          }
        }).catch(() => {});
      }
      scheduleEvaluation('start');
      return controller;
    },
    refresh() {
      assertActive();
      scheduleEvaluation('refresh');
      return controller;
    },
    evaluate,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      lifecycleGeneration += 1;
      if (evaluationFrame) cancelFrame(evaluationFrame);
      evaluationFrame = 0;
      observer?.disconnect();
      observer = null;
      if (fallbackResizeListening && resizeTarget) {
        resizeTarget.removeEventListener('resize', onFallbackResize);
      }
      fallbackResizeListening = false;
      toolbar.classList.remove('toolbar-boundary-wrap');
      wrapped = false;
    }
  });
  return controller;
}
