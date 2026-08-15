/**
 * Atomic 8.7 horizontal-rule presentation.
 * The editor composition layer injects CodeMirror's WidgetType base; this widget
 * deliberately owns no click, double-click, focus, Session, or Activation behavior.
 */
export function createHorizontalRuleWidgetType(WidgetType) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');

  return class HorizontalRuleWidget extends WidgetType {
    eq() {
      return true;
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-hybrid-horizontal-rule';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = '<span></span>';
      return span;
    }

    ignoreEvent() {
      return true;
    }
  };
}
