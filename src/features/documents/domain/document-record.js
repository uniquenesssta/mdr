/**
 * Responsibility: Build immutable metadata-only document records. Document body/source is explicitly forbidden.
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

function assertMetadataOnly(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' must be an object.');
  }
  for (const key of BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(label + ' must not contain document body field ' + key + '.');
    }
  }
}

function normalizeTimestamp(value, fallback, label) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new TypeError(label + ' must be a non-negative safe integer timestamp.');
  }
  return candidate;
}

function pickRecordMetadata(source) {
  const picked = {};
  for (const key of RECORD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) picked[key] = source[key];
  }
  return picked;
}

export function createDocumentRecord(input = {}, { now = Date.now, random = Math.random } = {}) {
  assertMetadataOnly(input, 'Document record input');
  if (typeof now !== 'function') throw new TypeError('Document record creation requires a clock function.');
  const fallbackNow = Number(now());
  if (!Number.isSafeInteger(fallbackNow) || fallbackNow < 0) {
    throw new TypeError('Document record clock must return a non-negative safe integer.');
  }

  const id = input.id === undefined || input.id === null || input.id === ''
    ? createDocumentId({ now: () => fallbackNow, random })
    : normalizeDocumentId(input.id);
  const createdAt = normalizeTimestamp(input.createdAt, fallbackNow, 'Document createdAt');
  const updatedAt = normalizeTimestamp(input.updatedAt, createdAt, 'Document updatedAt');
  if (updatedAt < createdAt) throw new TypeError('Document updatedAt must not precede createdAt.');

  const record = {
    id,
    title: normalizeDocumentTitle(input.title, input.fallbackTitle),
    createdAt,
    updatedAt
  };
  const filePath = normalizeDocumentPath(input.filePath);
  if (filePath) record.filePath = filePath;

  const hasNativeMetadata = Object.prototype.hasOwnProperty.call(input, 'nativeBacked')
    || Object.prototype.hasOwnProperty.call(input, 'nativeVersion');
  if (hasNativeMetadata) {
    const native = normalizeDocumentNativeMetadata(input);
    if (native.nativeBacked || native.nativeVersion > 0) Object.assign(record, native);
  }
  return Object.freeze(record);
}

export function updateDocumentRecord(record, patch = {}, options = {}) {
  assertMetadataOnly(record, 'Document record');
  assertMetadataOnly(patch, 'Document record patch');
  if (Object.prototype.hasOwnProperty.call(patch, 'id') && normalizeDocumentId(patch.id) !== normalizeDocumentId(record.id)) {
    throw new TypeError('Document id is immutable.');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'createdAt') && Number(patch.createdAt) !== Number(record.createdAt)) {
    throw new TypeError('Document createdAt is immutable.');
  }
  return createDocumentRecord({
    ...pickRecordMetadata(record),
    ...pickRecordMetadata(patch),
    fallbackTitle: patch.fallbackTitle ?? options.fallbackTitle
  }, {
    now: () => Number(record.createdAt),
    random: options.random ?? Math.random
  });
}

export function pickDocumentRecordMetadata(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Document metadata source must be an object.');
  }
  return Object.freeze(pickRecordMetadata(source));
}
