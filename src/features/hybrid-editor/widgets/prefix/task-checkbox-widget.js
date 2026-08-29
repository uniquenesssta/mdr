import { createWidgetButton } from '../shared/widget-button.js';

/**
 * Atomic 8.7 task-checkbox widget.
 * Owns only checkbox DOM and one-character Markdown marker writeback; the editor
 * composition layer injects CodeMirror's WidgetType base.
 */
export function createTaskCheckboxWidgetType(WidgetType) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');

  return class TaskCheckboxWidget extends WidgetType {
    constructor(options = {}) {
      super();
      this.checked = Boolean(options.checked);
      this.markerFrom = Number.isFinite(Number(options.markerFrom))
        ? Number(options.markerFrom)
        : -1;
    }

    eq(other) {
      return other.checked === this.checked && other.markerFrom === this.markerFrom;
    }

    toDOM(view) {
      const button = createWidgetButton(
        this.checked ? '✓' : '',
        'cm-hybrid-task-box',
        () => {
          if (this.markerFrom < 0) return;
          const current = view.state.doc.sliceString(this.markerFrom, this.markerFrom + 1);
          if (current !== ' ' && current.toLowerCase() !== 'x') return;
          view.dispatch({
            changes: {
              from: this.markerFrom,
              to: this.markerFrom + 1,
              insert: this.checked ? ' ' : 'x'
            }
          });
          view.focus();
        }
      );
      button.setAttribute('role', 'checkbox');
      button.setAttribute('aria-checked', this.checked ? 'true' : 'false');
      return button;
    }

    ignoreEvent() {
      return false;
    }
  };
}
