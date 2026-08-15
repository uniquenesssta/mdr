/**
 * Atomic 8.10 Image WidgetType composition.
 * Owns image DOM, retry orchestration and generation-checked async lifecycle only.
 * Source resolution/cache, failure DOM and shared source/lifecycle mechanics remain delegated.
 */
import {
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle
} from '../../lifecycle/widget-lifecycle.js';
import { scheduleHybridWidgetGeometry } from '../../lifecycle/widget-geometry-scheduler.js';
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetToolbar } from '../shared/widget-toolbar.js';
import { bindWidgetSourceAction, openWidgetSource } from '../shared/widget-source-action.js';
import {
  invalidateHybridImageSource,
  resolveHybridImageSource
} from '../../image/image-source-resolver.js';
import { createImageErrorView } from './image-error-view.js';

export function createImageLoadVersionGuard() {
  let version = 0;
  let disposed = false;
  return {
    begin() {
      if (disposed) return null;
      version += 1;
      return version;
    },
    isCurrent(candidate) {
      return !disposed && Number(candidate) === version;
    },
    invalidate() {
      if (!disposed) version += 1;
      return version;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      version += 1;
    },
    get disposed() {
      return disposed;
    },
    get version() {
      return version;
    }
  };
}

export function createImageBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  const resolveImageSource = typeof options.resolveImageSource === 'function'
    ? options.resolveImageSource
    : resolveHybridImageSource;
  const invalidateImageSource = typeof options.invalidateImageSource === 'function'
    ? options.invalidateImageSource
    : invalidateHybridImageSource;

  return class ImageBlockWidget extends WidgetType {
    constructor(descriptor) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.urlFrom = descriptor.urlFrom ?? descriptor.from;
      this.urlTo = descriptor.urlTo ?? this.urlFrom;
      this.source = String(descriptor.source || '');
      this.alt = String(descriptor.alt || '');
      this.title = String(descriptor.title || '');
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.urlFrom === this.urlFrom
        && other.urlTo === this.urlTo
        && other.source === this.source
        && other.alt === this.alt
        && other.title === this.title;
    }

    toDOM(view) {
      const loadVersion = createImageLoadVersionGuard();
      const figure = document.createElement('figure');
      figure.className = 'cm-hybrid-block-widget cm-hybrid-image-widget is-loading';
      figure.dataset.hybridBlockType = 'image';
      const editDescriptor = {
        componentType: 'image',
        from: this.from,
        to: this.to,
        editFrom: this.urlFrom,
        editTo: this.urlTo,
        preferredPosition: this.urlFrom
      };
      const disposeSourceAction = bindWidgetSourceAction(figure, view, editDescriptor);

      const toolbar = createWidgetToolbar({ className: 'cm-hybrid-image-toolbar' });
      const labelGroup = document.createElement('span');
      labelGroup.className = 'cm-hybrid-image-label';
      const label = document.createElement('span');
      label.textContent = this.alt || '图片';
      labelGroup.appendChild(label);
      toolbar.appendChild(labelGroup);
      toolbar.appendChild(createWidgetButton(
        '编辑源码',
        'cm-hybrid-widget-action',
        () => openWidgetSource(view, editDescriptor, figure)
      ));
      figure.appendChild(toolbar);

      const frame = document.createElement('div');
      frame.className = 'cm-hybrid-image-frame';
      figure.appendChild(frame);

      let sourceBadge = null;
      let activeImage = null;
      let clearImageListeners = () => {};

      const clearBadge = () => {
        sourceBadge?.remove?.();
        sourceBadge = null;
      };

      const clearActiveImage = () => {
        clearImageListeners();
        clearImageListeners = () => {};
        activeImage = null;
      };

      const renderError = (error, version) => {
        if (!loadVersion.isCurrent(version)) return;
        clearActiveImage();
        figure.classList.remove('is-loading');
        figure.classList.add('is-error');
        frame.replaceChildren(createImageErrorView({
          error,
          source: this.source,
          onRetry: () => {
            if (loadVersion.disposed) return;
            invalidateImageSource(this.source);
            void loadImage();
          }
        }));
        scheduleHybridWidgetGeometry(view, 'image-error');
      };

      const loadImage = async () => {
        const version = loadVersion.begin();
        if (version === null) return;
        clearActiveImage();
        clearBadge();
        figure.classList.add('is-loading');
        figure.classList.remove('is-error');
        frame.replaceChildren();
        try {
          const resolved = await resolveImageSource(this.source);
          if (!loadVersion.isCurrent(version)) return;

          const image = document.createElement('img');
          activeImage = image;
          image.alt = this.alt;
          image.title = this.title;
          image.loading = 'lazy';
          image.decoding = 'async';

          const onLoad = () => {
            if (!loadVersion.isCurrent(version) || activeImage !== image) return;
            clearActiveImage();
            figure.classList.remove('is-loading', 'is-error');
            scheduleHybridWidgetGeometry(view, 'image-loaded');
          };
          const onError = () => {
            if (!loadVersion.isCurrent(version) || activeImage !== image) return;
            renderError(new Error(`图片加载失败：${this.source}`), version);
          };
          image.addEventListener('load', onLoad, { once: true });
          image.addEventListener('error', onError, { once: true });
          clearImageListeners = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
          };

          if (resolved.kind === 'local') {
            sourceBadge = document.createElement('small');
            sourceBadge.className = 'cm-hybrid-image-source-badge';
            sourceBadge.textContent = '本地';
            sourceBadge.title = resolved.resolvedPath || this.source;
            labelGroup.appendChild(sourceBadge);
          }
          image.src = resolved.url;
          frame.appendChild(image);
        } catch (error) {
          renderError(error, version);
        }
      };

      if (this.title && this.title !== this.alt) {
        const caption = document.createElement('figcaption');
        caption.textContent = this.title;
        figure.appendChild(caption);
      }

      const lifecycleCleanup = attachHybridWidgetLifecycle(figure, view, 'image');
      let cleaned = false;
      figure.__markdownEditorImageBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        loadVersion.destroy();
        clearActiveImage();
        clearBadge();
        disposeSourceAction();
        lifecycleCleanup();
      };
      void loadImage();
      return figure;
    }

    destroy(dom) {
      dom?.__markdownEditorImageBlockCleanup?.();
      if (dom) delete dom.__markdownEditorImageBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return false;
    }
  };
}
