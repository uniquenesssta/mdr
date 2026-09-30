/**
 * Responsibility: Materialize untrusted document HTML as passive, bounded DOM.
 * Imports: DOMPurify only; no application commands, native ports or feature state.
 * Lifecycle: One isolated purifier per document; returned fragments own their link guards.
 */
import createDOMPurify from 'dompurify';

const purifiers = new WeakMap();
const tags = 'a abbr b blockquote br button caption cite code col colgroup dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q s samp small span strong sub summary sup table tbody td th thead time tr u ul var'.split(' ');
const attributes = 'alt checked class colspan datetime disabled height href id lang open reversed rowspan scope src start style title type width data-r12-probe data-r12-kind'.split(' ');

function safeUrl(value, image) {
  const text = String(value || '').trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text) || text.includes('\\')) return false;
  if (image && /^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(text)) return true;
  if (!image && text.startsWith('#')) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) return image && !text.startsWith('//');
  try {
    const url = new URL(text);
    if (url.hostname === 'ipc.localhost' || url.username || url.password) return false;
    return image
      ? ['http:', 'https:', 'asset:', 'blob:'].includes(url.protocol)
      : ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch { return false; }
}

function getPurifier(documentRef) {
  if (!documentRef?.defaultView?.document) throw new TypeError('Document HTML requires a real DOM document.');
  if (purifiers.has(documentRef)) return purifiers.get(documentRef);
  const purifier = createDOMPurify(documentRef.defaultView);
  if (!purifier.isSupported) throw new Error('Document HTML sanitizer is unavailable.');
  purifier.addHook('afterSanitizeAttributes', node => {
    const tag = node.tagName?.toLowerCase();
    for (const attribute of ['href', 'src']) {
      if (!node.hasAttribute(attribute)) continue;
      const permitted = attribute === 'src' ? tag === 'img' : tag === 'a';
      if (!permitted || !safeUrl(node.getAttribute(attribute), attribute === 'src')) node.removeAttribute(attribute);
      else if (attribute === 'href' && node.getAttribute(attribute).startsWith('#')) {
        node.setAttribute('href', '#user-content-' + node.getAttribute(attribute).slice(1));
      }
    }
    // Only presentation classes consumed by Markdown rendering may cross this boundary.
    if (node.hasAttribute('class')) {
      const classes = node.getAttribute('class').split(/\s+/).filter(value =>
        /^(?:language-[a-z0-9_-]+|task-list-item|contains-task-list)$/.test(value));
      if (classes.length) node.setAttribute('class', classes.join(' '));
      else node.removeAttribute('class');
    }
    // Preserve the editor's bounded color syntax, never CSS URLs, positioning or selectors.
    if (node.hasAttribute('style')) {
      const colors = node.getAttribute('style').split(';').map(value => value.trim())
        .filter(value => /^(?:color|background-color)\s*:\s*#[0-9a-f]{6}$/i.test(value));
      node.removeAttribute('style');
      if (colors.length) node.setAttribute('style', colors.join(';'));
    }
    if (tag === 'input') {
      if (node.getAttribute('type') !== 'checkbox') { node.remove(); return; }
      node.setAttribute('disabled', '');
    }
    if (tag === 'button') node.setAttribute('type', 'button');
    if (tag === 'img') node.setAttribute('referrerpolicy', 'no-referrer');
  });
  purifiers.set(documentRef, purifier);
  return purifier;
}

export function createDocumentHtmlFragment(source, documentRef = globalThis.document) {
  const fragment = getPurifier(documentRef).sanitize(String(source || ''), {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attributes,
    // DOMPurify's default URI list omits the desktop asset and browser blob schemes.
    // The element-specific hook still validates every surviving href/src.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|asset|blob):|data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'script', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'template'],
    FORBID_CONTENTS: ['style', 'script', 'svg', 'math', 'iframe', 'object', 'embed', 'template']
  });
  // The existing document capture handler owns approved link previews/system opens.
  // Prevent any otherwise unhandled click, keyboard activation or auxiliary navigation.
  for (const anchor of fragment.querySelectorAll('a[href]')) {
    const guard = event => {
      if (!anchor.getAttribute('href')?.startsWith('#')) event.preventDefault();
    };
    anchor.addEventListener('click', guard);
    anchor.addEventListener('auxclick', guard);
  }
  return fragment;
}
