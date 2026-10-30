import { createEventScope } from '../../../ui/dom/index.js';

/** Project the persisted reading preference; existing Preview geometry observers own remeasurement. */
export function createReadingWidthView({ root, settings, eventTarget, eventType }) {
  const events = createEventScope();
  const previous = root.style.getPropertyValue('--reading-width');
  const refresh = () => {
    const widths = { third: '33.333333%', half: '50%', full: '100%' };
    root.style.setProperty('--reading-width', widths[settings.get('readingWidth')] || widths.half);
  };
  refresh();
  events.listen(eventTarget, eventType, event => { if (event.detail?.changedIds?.includes('readingWidth')) refresh(); });
  return Object.freeze({ destroy() {
    events.destroy();
    if (previous) root.style.setProperty('--reading-width', previous);
    else root.style.removeProperty('--reading-width');
  } });
}
