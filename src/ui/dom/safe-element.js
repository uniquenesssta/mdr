const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const DATASET_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const FORBIDDEN_TAGS = new Set(['base', 'embed', 'link', 'meta', 'object', 'script', 'style']);
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', 'style']);
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src', 'xlink:href']);
const EXECUTABLE_URL_PATTERN = /^(?:data|javascript|vbscript):/i;
const OPTION_KEYS = new Set(['id', 'className', 'text', 'attributes', 'dataset']);

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('createSafeElement requires a document with createElement().');
  }
}

function assertRecord(value, label) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function setSafeAttribute(element, name, value) {
  const normalizedName = String(name || '').trim();
  if (!ATTRIBUTE_NAME_PATTERN.test(normalizedName)) {
    throw new TypeError(`Invalid attribute name: ${normalizedName || '<empty>'}.`);
  }
  const lowerName = normalizedName.toLowerCase();
  if (/^on/i.test(normalizedName) || FORBIDDEN_ATTRIBUTES.has(lowerName)) {
    throw new TypeError(`Unsafe attribute is not allowed: ${normalizedName}.`);
  }
  if (value === false || value === null || value === undefined) return;
  const normalizedValue = value === true ? '' : String(value);
  if (URL_ATTRIBUTES.has(lowerName)) {
    const compactValue = normalizedValue.trim().replace(/[\u0000-\u0020\u007f]+/g, '');
    if (EXECUTABLE_URL_PATTERN.test(compactValue)) {
      throw new TypeError(`Executable URL is not allowed for ${normalizedName}.`);
    }
  }
  element.setAttribute(normalizedName, normalizedValue);
}

export function createSafeElement(documentRef, tagName, options = {}) {
  assertDocument(documentRef);
  const normalizedTag = String(tagName || '').trim().toLowerCase();
  if (!TAG_NAME_PATTERN.test(normalizedTag) || FORBIDDEN_TAGS.has(normalizedTag)) {
    throw new TypeError(`Unsafe or invalid element tag: ${normalizedTag || '<empty>'}.`);
  }

  const normalizedOptions = assertRecord(options, 'createSafeElement options');
  for (const key of Object.keys(normalizedOptions)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`Unknown createSafeElement option: ${key}.`);
  }

  const element = documentRef.createElement(normalizedTag);
  if (normalizedOptions.id !== undefined) {
    const id = String(normalizedOptions.id).trim();
    if (!id) throw new TypeError('Element id must not be empty.');
    element.id = id;
  }
  if (normalizedOptions.className !== undefined) {
    if (typeof normalizedOptions.className !== 'string') {
      throw new TypeError('Element className must be a string.');
    }
    element.className = normalizedOptions.className.trim();
  }
  if (normalizedOptions.text !== undefined) element.textContent = String(normalizedOptions.text);

  const attributes = assertRecord(normalizedOptions.attributes, 'Element attributes');
  for (const [name, value] of Object.entries(attributes)) setSafeAttribute(element, name, value);

  const dataset = assertRecord(normalizedOptions.dataset, 'Element dataset');
  for (const [key, value] of Object.entries(dataset)) {
    if (!DATASET_KEY_PATTERN.test(key)) throw new TypeError(`Invalid dataset key: ${key}.`);
    if (value === null || value === undefined) continue;
    element.dataset[key] = String(value);
  }
  return element;
}
