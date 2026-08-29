const REQUEST_TYPES = new Set([
  'reset',
  'transactions',
  'render-window',
  'focus',
  'cancel'
]);

export const PREVIEW_WORKER_MESSAGE_TYPES = Object.freeze({
  RESET: 'reset',
  TRANSACTIONS: 'transactions',
  RENDER_WINDOW: 'render-window',
  FOCUS: 'focus',
  CANCEL: 'cancel',
  ERROR: 'error',
  ACK: 'ack'
});

const MESSAGE_TYPES = new Set(Object.values(PREVIEW_WORKER_MESSAGE_TYPES));

function assertSafeInteger(value, name, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`Preview Worker Protocol ${name} must be a safe integer >= ${min}`);
  }
}

function assertEnvelope(message) {
  assertSafeInteger(message.generation, 'generation');
  assertSafeInteger(message.version, 'version');
  assertSafeInteger(message.requestId, 'requestId', { min: 1 });
}

function assertResetPayload(message) {
  const hasSource = typeof message.source === 'string';
  const hasChunks = Array.isArray(message.sourceChunks);
  if (!hasSource && !hasChunks) {
    throw new TypeError('Preview Worker Protocol reset requires source or sourceChunks');
  }
}

function assertTransactionsPayload(message) {
  if (!Array.isArray(message.transactions)) {
    throw new TypeError('Preview Worker Protocol transactions requires a transactions array');
  }
}

function assertRenderWindowPayload(message) {
  if (!Array.isArray(message.ids) && !(message.window && typeof message.window === 'object')) {
    throw new TypeError('Preview Worker Protocol render-window requires ids or window');
  }
}

function assertFocusPayload(message) {
  if (!Number.isSafeInteger(message.focusLine) || message.focusLine < 1) {
    throw new TypeError('Preview Worker Protocol focus requires a positive focusLine');
  }
}

function assertCancelPayload(message) {
  assertSafeInteger(message.targetRequestId, 'cancel targetRequestId', { min: 1 });
}

function assertAckPayload(message) {
  if (!REQUEST_TYPES.has(message.acknowledges)) {
    throw new TypeError('Preview Worker Protocol ack requires a request message type in acknowledges');
  }
}

function assertErrorPayload(message) {
  if (typeof message.operation !== 'string' || !message.operation.trim()) {
    throw new TypeError('Preview Worker Protocol error requires operation');
  }
  if (typeof message.message !== 'string' || !message.message.trim()) {
    throw new TypeError('Preview Worker Protocol error requires a non-empty message');
  }
  if (message.code != null && (typeof message.code !== 'string' || !message.code.trim())) {
    throw new TypeError('Preview Worker Protocol error code must be a non-empty string');
  }
}

function assertPayload(message) {
  switch (message.type) {
    case PREVIEW_WORKER_MESSAGE_TYPES.RESET:
      assertResetPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.TRANSACTIONS:
      assertTransactionsPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.RENDER_WINDOW:
      assertRenderWindowPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.FOCUS:
      assertFocusPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.CANCEL:
      assertCancelPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.ACK:
      assertAckPayload(message);
      break;
    case PREVIEW_WORKER_MESSAGE_TYPES.ERROR:
      assertErrorPayload(message);
      break;
    default:
      throw new TypeError(`Preview Worker Protocol unknown type: ${String(message.type)}`);
  }
}

export function parsePreviewWorkerMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('Preview Worker Protocol message must be an object');
  }
  if (!MESSAGE_TYPES.has(message.type)) {
    throw new TypeError(`Preview Worker Protocol unknown type: ${String(message.type)}`);
  }
  assertEnvelope(message);
  assertPayload(message);
  return message;
}

export function createPreviewWorkerMessage(type, envelope, payload = {}) {
  const message = {
    ...payload,
    type,
    generation: envelope?.generation,
    version: envelope?.version,
    requestId: envelope?.requestId
  };
  parsePreviewWorkerMessage(message);
  return Object.freeze(message);
}

export function createPreviewWorkerAck(request, payload = {}) {
  const parsed = parsePreviewWorkerMessage(request);
  if (!REQUEST_TYPES.has(parsed.type)) {
    throw new TypeError('Preview Worker Protocol ack source must be a request message');
  }
  return createPreviewWorkerMessage(
    PREVIEW_WORKER_MESSAGE_TYPES.ACK,
    parsed,
    { ...payload, acknowledges: parsed.type }
  );
}

export function createPreviewWorkerError(request, error, { code = 'PREVIEW_WORKER_ERROR' } = {}) {
  const parsed = parsePreviewWorkerMessage(request);
  if (!REQUEST_TYPES.has(parsed.type)) {
    throw new TypeError('Preview Worker Protocol error source must be a request message');
  }
  return createPreviewWorkerMessage(
    PREVIEW_WORKER_MESSAGE_TYPES.ERROR,
    parsed,
    {
      operation: parsed.type,
      code,
      message: error instanceof Error ? error.message : String(error || 'Preview worker failed')
    }
  );
}
