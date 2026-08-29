const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const ICON_ID_PATTERN = /^icon-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ICON_SPRITE_URL = '/assets/icons.svg';

export function assertIconId(value) {
  const iconId = String(value || '').trim();
  if (!ICON_ID_PATTERN.test(iconId)) {
    throw new TypeError(`Invalid icon ID: ${iconId || '<empty>'}`);
  }
  return iconId;
}

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElementNS !== 'function') {
    throw new TypeError('createIconView requires a document with createElementNS().');
  }
}

function normalizeSpriteUrl(value) {
  const spriteUrl = String(value || '').trim();
  if (!spriteUrl || spriteUrl.includes('#')) {
    throw new TypeError('Icon sprite URL must be a non-empty URL without a fragment.');
  }
  return spriteUrl;
}

export function getIconHref(iconId, spriteUrl = ICON_SPRITE_URL) {
  return `${normalizeSpriteUrl(spriteUrl)}#${assertIconId(iconId)}`;
}

export function createIconView(documentRef, iconId, options = {}) {
  assertDocument(documentRef);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Icon view options must be an object.');
  }

  const {
    className = 'icon',
    ariaLabel = '',
    spriteUrl = ICON_SPRITE_URL
  } = options;
  const svg = documentRef.createElementNS(SVG_NAMESPACE, 'svg');
  const use = documentRef.createElementNS(SVG_NAMESPACE, 'use');
  const normalizedClassName = String(className || '').trim();
  const normalizedLabel = String(ariaLabel || '').trim();

  if (normalizedClassName) svg.setAttribute('class', normalizedClassName);
  svg.setAttribute('focusable', 'false');
  if (normalizedLabel) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', normalizedLabel);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  use.setAttribute('href', getIconHref(iconId, spriteUrl));
  svg.appendChild(use);
  return svg;
}
