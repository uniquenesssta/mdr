/**
 * Atomic 8.7 bullet / ordered-list prefix presentation.
 * The editor composition layer injects CodeMirror's WidgetType base so this
 * feature module remains safe to expose through the browser-loaded public entry.
 */
export function createHybridPrefixWidgetType(WidgetType) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');

  return class HybridPrefixWidget extends WidgetType {
    constructor(kind, options = {}) {
      super();
      this.kind = kind;
      this.label = String(options.label || '');
    }

    eq(other) {
      return other.kind === this.kind && other.label === this.label;
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = `cm-hybrid-list-prefix ${this.kind === 'ordered' ? 'is-ordered' : 'is-bullet'}`;
      span.setAttribute('aria-hidden', 'true');
      span.textContent = this.label;
      return span;
    }

    ignoreEvent() {
      return true;
    }
  };
}
