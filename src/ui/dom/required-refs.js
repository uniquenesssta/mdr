function normalizeLabel(label) {
  const normalized = String(label || '').trim();
  if (!normalized) throw new TypeError('Required reference label must not be empty.');
  return normalized;
}

export function isElementRef(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.tagName === 'string'
    && value.ownerDocument
    && typeof value.setAttribute === 'function'
  );
}

export function requireElementRef(value, label) {
  const normalizedLabel = normalizeLabel(label);
  if (!isElementRef(value)) throw new TypeError(`Missing required element reference: ${normalizedLabel}.`);
  return value;
}

export function collectRequiredRefs(root, selectors) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('collectRequiredRefs requires a queryable root.');
  }
  if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)) {
    throw new TypeError('collectRequiredRefs selectors must be a plain object.');
  }

  const refs = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const normalizedName = normalizeLabel(name);
    const normalizedSelector = String(selector || '').trim();
    if (!normalizedSelector) throw new TypeError(`Selector for ${normalizedName} must not be empty.`);
    refs[normalizedName] = requireElementRef(root.querySelector(normalizedSelector), `${normalizedName} (${normalizedSelector})`);
  }
  return Object.freeze(refs);
}
