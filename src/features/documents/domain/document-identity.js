/**
 * Responsibility: Validate and create stable document identifiers without owning document state.
 * State/side effects: Pure except for explicitly injected clock/random providers used only when creating an id.
 */
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_DOCUMENT_ID_LENGTH = 160;

export function normalizeDocumentId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw new TypeError('Document id must not be empty.');
  if (id.length > MAX_DOCUMENT_ID_LENGTH || !DOCUMENT_ID_PATTERN.test(id)) {
    throw new TypeError('Document id contains unsupported characters.');
  }
  return id;
}

export function createDocumentId({ now = Date.now, random = Math.random } = {}) {
  if (typeof now !== 'function' || typeof random !== 'function') {
    throw new TypeError('Document id creation requires clock and random functions.');
  }
  const timestamp = Number(now());
  const entropy = Number(random());
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Document id timestamp must be a non-negative safe integer.');
  }
  if (!Number.isFinite(entropy) || entropy < 0 || entropy >= 1) {
    throw new TypeError('Document id entropy must be within [0, 1).');
  }
  return normalizeDocumentId('doc_' + timestamp + '_' + entropy.toString(36).slice(2, 8));
}
