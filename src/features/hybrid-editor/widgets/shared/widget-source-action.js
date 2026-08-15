/**
 * Atomic 8.6 reusable widget source-action primitive.
 * Owns generic source-open descriptor projection and element activation wiring only.
 */
import { bindSourceActivation } from '../../activation/source-activation.js';
import { bindStrictDoubleActivation } from '../../activation/strict-double-activation.js';
import { getClassicHybridSourceEditControllerPort } from '../../compatibility/classic-hybrid-source-edit-controller-port.js';
import { bindWidgetFocusPolicy, isWidgetInteractiveTarget } from './widget-focus-policy.js';

function resolveComponentType(descriptor, anchorElement) {
  return String(descriptor?.componentType
    || anchorElement?.closest?.('[data-hybrid-block-type]')?.getAttribute?.('data-hybrid-block-type')
    || 'block');
}

function resolveAnchorRect(anchorElement) {
  const rect = anchorElement?.getBoundingClientRect?.();
  return rect
    ? { top: Number(rect.top) || 0, height: Number(rect.height) || 0 }
    : null;
}

export function openWidgetSource(view, descriptor, anchorElement = null) {
  const sourceEditPort = getClassicHybridSourceEditControllerPort(view);
  if (!sourceEditPort) throw new Error('Hybrid Source Edit Controller unavailable');
  const componentType = resolveComponentType(descriptor, anchorElement);
  return sourceEditPort.open(
    { ...descriptor, componentType },
    { anchorRect: resolveAnchorRect(anchorElement) }
  );
}

export function bindWidgetSourceAction(element, view, descriptor, options = {}) {
  if (!element?.addEventListener) {
    throw new TypeError('Widget source action requires an event target element');
  }

  element.title = options.title || '双击编辑 Markdown 源码';
  element.tabIndex = 0;

  const disposeFocus = bindWidgetFocusPolicy(element);
  const disposeDoubleActivation = bindStrictDoubleActivation(element, (event, gesture) => {
    options.onOpen?.('doubleclick', gesture);
    openWidgetSource(view, descriptor, element);
  }, {
    exclude: event => isWidgetInteractiveTarget(event.target) || Boolean(options.exclude?.(event)),
    getTargetKey: event => options.getTargetKey?.(event)
      || event.target?.closest?.('[data-hybrid-double-zone]')?.getAttribute?.('data-hybrid-double-zone')
      || 'source-root'
  });
  const disposeKeyboardActivation = bindSourceActivation(element, () => {
    openWidgetSource(view, descriptor, element);
  }, {
    sourceKeys: options.sourceKeys
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    disposeKeyboardActivation();
    disposeDoubleActivation();
    disposeFocus();
  };
}
