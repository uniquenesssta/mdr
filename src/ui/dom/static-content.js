import { createSafeElement, setSafeAttribute } from './safe-element.js';
import { createIconView } from '../components/icon-view.js';

/** Render trusted, declarative feature Views through the same safe DOM and icon boundaries. */
function createNode(doc, specification) {
  if (typeof specification === 'string') return doc.createTextNode(specification);
  if (!Array.isArray(specification) || specification.length !== 3) throw new TypeError('Static View requires tag, attributes and children.');
  const [tag, attributes, children] = specification;
  if (!Array.isArray(children)) throw new TypeError('Static View children must be an array.');
  let node;
  if (tag === 'svg') {
    const uses = children.filter(child => Array.isArray(child) && child[0] === 'use');
    if (uses.length !== 1 || children.some(child => typeof child !== 'string' && child !== uses[0])) throw new TypeError('Static icons require one sprite reference.');
    const href = uses[0][1].href;
    if (!/^\/assets\/icons\.svg#icon-[a-z0-9-]+$/.test(href)) throw new TypeError('Static icon must use the shared sprite.');
    node = createIconView(doc, href.split('#')[1], { className: attributes.class || '' });
    // Preserve the established View attributes; geometry still comes from the sole sprite.
    for (const attribute of [...node.attributes]) if (!Object.hasOwn(attributes, attribute.name)) node.removeAttribute(attribute.name);
    for (const [name, value] of Object.entries(attributes)) setSafeAttribute(node, name, value);
    return node;
  }
  if (tag === 'use' || tag === 'template') throw new TypeError('Static View cannot mount standalone SVG references or templates.');
  node = createSafeElement(doc, tag, { attributes });
  for (const child of children) node.appendChild(createNode(doc, child));
  return node;
}

export function mountStaticContent(groups) {
  const nodes = [];
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    const errors = [];
    for (const node of nodes.reverse()) try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
    nodes.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Feature content cleanup failed.');
  };
  try {
    // Construct every group before mutating the live tree, then retain exact ownership.
    const prepared = groups.map(([root, specifications]) => {
      if (!root?.ownerDocument || !Array.isArray(specifications)) throw new TypeError('Static View requires a live root and specifications.');
      return [root, specifications.map(specification => createNode(root.ownerDocument, specification))];
    });
    for (const [root, children] of prepared) for (const child of children) { nodes.push(child); root.appendChild(child); }
    return Object.freeze({ destroy });
  } catch (error) {
    try { destroy(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Feature content construction failed.'); }
    throw error;
  }
}
