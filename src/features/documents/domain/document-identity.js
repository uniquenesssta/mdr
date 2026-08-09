/**
 * Responsibility: Preserve existing document identifiers and create safe compatible identifiers for new documents without owning document state.
 * State/side effects: Pure except for explicitly injected clock/random providers used only when creating a new id.
 */
export function normalizeDocumentId(value) {
  const id = String(value ?? '');
  if (!id) throw new TypeError('Document id must not be empty.');
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
  return 'doc_' + timestamp + '_' + entropy.toString(36).slice(2, 8);
}
