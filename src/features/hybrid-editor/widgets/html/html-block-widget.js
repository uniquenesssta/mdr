/**
 * Atomic 8.13 HTML WidgetType composition.
 * Owns HTML SOURCE activation, telemetry delegation and explicit widget lifecycle teardown.
 * WidgetType and application telemetry are injected at the editor composition boundary.
 */
import { attachHybridWidgetLifecycle, destroyHybridWidgetLifecycle } from '../../lifecycle/widget-lifecycle.js';
import { bindWidgetSourceAction, openWidgetSource } from '../shared/widget-source-action.js';
import { createHtmlBlockView } from './html-block-view.js';

export function createHtmlBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};

  return class HtmlBlockWidget extends WidgetType {
    constructor(descriptor) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.source = String(descriptor.source || '');
      this.fingerprint = descriptor.fingerprint || this.source;
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.fingerprint === this.fingerprint;
    }

    toDOM(view) {
      const editDescriptor = {
        componentType: 'html',
        from: this.from,
        to: this.to,
        editFrom: this.from,
        editTo: this.to,
        preferredPosition: this.from
      };

      let section = null;
      section = createHtmlBlockView({
        from: this.from,
        source: this.source,
        onSourceEdit: () => {
          recordInteraction('hybrid.html-source-open', {
            htmlFrom: this.from,
            trigger: 'button'
          });
          openWidgetSource(view, editDescriptor, section);
        }
      });

      const disposeSourceAction = bindWidgetSourceAction(section, view, editDescriptor, {
        sourceKeys: [],
        title: '双击编辑 HTML 源码；也可点击“编辑源码”',
        exclude: event => Boolean(event.target?.closest?.('summary, button, a, input, textarea, select, option, label')),
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.html-source-open', {
          htmlFrom: this.from,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });
      const disposeLifecycle = attachHybridWidgetLifecycle(section, view, 'html');
      let cleaned = false;
      section.__markdownEditorHtmlBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
        disposeLifecycle();
      };
      return section;
    }

    destroy(dom) {
      dom?.__markdownEditorHtmlBlockCleanup?.();
      if (dom) delete dom.__markdownEditorHtmlBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return true;
    }
  };
}
