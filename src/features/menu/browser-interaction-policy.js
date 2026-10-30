import { createEventScope } from '../../ui/dom/index.js';

/** Suppress WebView chrome while retaining the app's own menus, links and shortcuts. */
export function createBrowserInteractionPolicy(documentRef) {
  const events = createEventScope();
  events.listen(documentRef, 'contextmenu', event => event.preventDefault(), true);
  events.listen(documentRef, 'keydown', event => {
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (key === 'f5' || key === 'f12' || ['browserback', 'browserforward', 'browserrefresh'].includes(key)
      || (event.altKey && ['arrowleft', 'arrowright', 'home'].includes(key))
      || (modifier && (key === 'r' || key === 'p' || (event.shiftKey && ['i', 'j', 'c'].includes(key))))) {
      event.preventDefault();
    }
  }, true);
  const preventUnhandledNavigation = event => {
    const anchor = event.target?.closest?.('a[href]');
    if (anchor && !event.defaultPrevented && !anchor.getAttribute('href').startsWith('#')) event.preventDefault();
  };
  events.listen(documentRef, 'click', preventUnhandledNavigation);
  events.listen(documentRef, 'auxclick', preventUnhandledNavigation);
  return Object.freeze({ destroy: events.destroy });
}
