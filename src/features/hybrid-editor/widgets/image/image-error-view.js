/**
 * Atomic 8.10 hybrid image error presentation.
 * Owns failed-image DOM plus retry intent projection only; cache invalidation and load lifecycle stay in the widget.
 */
import { createWidgetButton } from '../shared/widget-button.js';

export function createImageErrorView({ error, source, onRetry } = {}) {
  if (typeof onRetry !== 'function') throw new TypeError('Image retry handler is required');
  const wrapper = document.createElement('div');
  wrapper.className = 'cm-hybrid-image-error';

  const message = document.createElement('strong');
  message.textContent = error?.message || '图片加载失败';

  const sourceView = document.createElement('code');
  sourceView.textContent = String(source || '');

  const retry = createWidgetButton(
    '重新加载',
    'cm-hybrid-widget-action cm-hybrid-image-retry',
    onRetry
  );
  wrapper.append(message, sourceView, retry);
  return wrapper;
}
