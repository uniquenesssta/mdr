import { createDocumentHtmlFragment } from '../../../shared/security/document-html.js';

const CANDIDATES = ['article', '[role="main"]', '.post-content', '.entry-content', '.article-content', '.content', '#content', 'main'];
// Editorial selection only. Executable attributes/URLs are owned by document-html.
const UNWANTED = 'script, style, title, meta, link, base, nav, aside, header, footer, form, iframe, object, embed, img, picture, svg, math, video, audio, canvas, template, .ad, .ads, .advertisement, .sidebar, .comments, .comment, #comments, [class*="ad-"], [class*="ads-"], [id*="ad-"], [class*="comment"], [id*="comment"]';

/** Synchronous, detached HTML extraction; never attaches untrusted nodes or emits Markdown. */
export function extractHtml(source, documentRef = globalThis.document) {
  if (typeof source !== 'string') throw new TypeError('HTML source must be a string.');
  if (!documentRef?.createElement) throw new TypeError('HTML extraction requires a document.');
  const template = documentRef.createElement('template');
  // Template contents belong to an inert document: no scripts, custom elements or resource loads.
  template.innerHTML = source;
  const root = template.content;
  const text = selector => root.querySelector(selector)?.textContent?.trim() || '';
  const attr = (selector, name) => root.querySelector(selector)?.getAttribute(name)?.trim() || '';
  const meta = Object.freeze({
    title: text('title') || text('h1'),
    author: attr('meta[name="author"]', 'content') || attr('meta[property="article:author"]', 'content') || text('[rel="author"]'),
    published: attr('meta[property="article:published_time"]', 'content') || attr('meta[name="publishdate"]', 'content') || attr('meta[name="date"]', 'content') || attr('time', 'datetime') || text('time')
  });
  // Remove noise before choosing a candidate so an article inside an advert cannot win.
  root.querySelectorAll(UNWANTED).forEach(node => node.remove());
  let selected = root;
  for (const selector of CANDIDATES) {
    const candidate = root.querySelector(selector);
    if (candidate) { selected = candidate; break; }
  }
  const serialization = template.content.ownerDocument.createElement('div');
  serialization.append(selected.cloneNode(true));
  const content = documentRef.createElement('div');
  content.append(createDocumentHtmlFragment(serialization.innerHTML, documentRef));
  return Object.freeze({ meta, content });
}
