/**
 * Responsibility: Build immutable metadata-only document records while preserving legacy persisted metadata tolerance. Document body/source is explicitly forbidden.
 * State/side effects: Pure except delegated id creation when id is absent.
 */
import { createDocumentId, normalizeDocumentId } from './document-identity.js';
import { normalizeDocumentNativeMetadata } from './document-native-metadata.js';
import { normalizeDocumentPath } from './document-path.js';
import { normalizeDocumentTitle } from './document-title.js';

const BODY_KEYS = Object.freeze(['content', 'contentChunks', 'body', 'text', 'source', 'markdown']);
const RECORD_KEYS = Object.freeze([
  'id', 'title', 'filePath', 'createdAt', 'updatedAt', 'nativeBacked', 'nativeVersion'
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertMetadataOnly(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' must be an object.');
  }
  for (const key of BODY_KEYS) {
    if (hasOwn(value, key)) {
      throw new TypeError(label + ' must not contain document body field ' + key + '.');
    }
  }
}

function normalizeLegacyNumber(value, fallback = 0) {
  return Number(value) || Number(fallback) || 0;
}

function pickRecordMetadata(source) {
  const picked = {};
  for (const key of RECORD_KEYS) {
    if (hasOwn(source, key)) picked[key] = source[key];
  }
  return picked;
}

export function createDocumentRecord(input = {}, { now = Date.now, random = Math.random } = {}) {
  assertMetadataOnly(input, 'Document record input');
  if (typeof now !== 'function') throw new TypeError('Document record creation requires a clock function.');

  const fallbackNow = normalizeLegacyNumber(now(), 0);
  const hasExistingId = input.id !== undefined && input.id !== null && input.id !== '';
  const id = hasExistingId
    ? normalizeDocumentId(input.id)
    : createDocumentId({ now: () => fallbackNow, random });

  const record = {
    id,
    title: normalizeDocumentTitle(input.title, input.fallbackTitle)
  };

  const hasCreatedAt = hasOwn(input, 'createdAt');
  if (!hasExistingId || hasCreatedAt) {
    record.createdAt = normalizeLegacyNumber(input.createdAt, fallbackNow);
  }
  record.updatedAt = normalizeLegacyNumber(
    input.updatedAt,
    hasOwn(record, 'createdAt') ? record.createdAt : fallbackNow
  );

  const filePath = normalizeDocumentPath(input.filePath);
  if (filePath) record.filePath = filePath;

  const hasNativeMetadata = hasOwn(input, 'nativeBacked') || hasOwn(input, 'nativeVersion');
  if (hasNativeMetadata) {
    Object.assign(record, normalizeDocumentNativeMetadata(input));
  }
  return Object.freeze(record);
}

export function updateDocumentRecord(record, patch = {}, options = {}) {
  assertMetadataOnly(record, 'Document record');
  assertMetadataOnly(patch, 'Document record patch');
  if (hasOwn(patch, 'id') && normalizeDocumentId(patch.id) !== normalizeDocumentId(record.id)) {
    throw new TypeError('Document id is immutable.');
  }
  if (hasOwn(record, 'createdAt') && hasOwn(patch, 'createdAt')
      && Number(patch.createdAt) !== Number(record.createdAt)) {
    throw new TypeError('Document createdAt is immutable.');
  }

  const fallbackNow = normalizeLegacyNumber(
    hasOwn(patch, 'updatedAt') ? patch.updatedAt : record.updatedAt,
    hasOwn(record, 'createdAt') ? record.createdAt : (typeof options.now === 'function' ? options.now() : Date.now())
  );
  return createDocumentRecord({
    ...pickRecordMetadata(record),
    ...pickRecordMetadata(patch),
    fallbackTitle: patch.fallbackTitle ?? options.fallbackTitle
  }, {
    now: () => fallbackNow,
    random: options.random ?? Math.random
  });
}

export function pickDocumentRecordMetadata(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Document metadata source must be an object.');
  }
  return Object.freeze(pickRecordMetadata(source));
}
