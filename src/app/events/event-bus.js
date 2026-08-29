import { assertEventType } from './event-types.js';

const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;

export class EventBusDestroyedError extends Error {
  constructor() {
    super('Event bus has been destroyed.');
    this.name = 'EventBusDestroyedError';
  }
}

export class InvalidEventPayloadError extends TypeError {
  constructor(path, reason) {
    super(`Event payload at "${path}" ${reason}.`);
    this.name = 'InvalidEventPayloadError';
    this.path = path;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('Event listener must be a function.');
  }
}

function assertErrorReporter(reporter) {
  if (typeof reporter !== 'function') {
    throw new TypeError('Event listener error reporter must be a function.');
  }
}

function reportToConsole(error, context, reporterError) {
  if (typeof console === 'undefined' || typeof console.error !== 'function') return;
  if (reporterError) {
    console.error(
      `Event listener error reporter failed for "${context.type}".`,
      reporterError,
      error
    );
    return;
  }
  console.error(`Event listener for "${context.type}" failed.`, error);
}

function defaultErrorReporter(error, context) {
  reportToConsole(error, context);
}

function isThenable(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  );
}

function cloneEventPayload(value, path = '$', seen = new WeakMap()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    if (typeof value === 'symbol') {
      throw new InvalidEventPayloadError(path, 'must not contain symbols');
    }
    return value;
  }

  if (typeof value === 'function') {
    throw new InvalidEventPayloadError(path, 'must contain data instead of functions');
  }

  const existing = seen.get(value);
  if (existing) return existing;

  if (Array.isArray(value)) {
    const clone = new Array(value.length);
    seen.set(value, clone);

    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !ARRAY_INDEX_PATTERN.test(key)) {
        throw new InvalidEventPayloadError(path, 'must not contain custom array properties');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new InvalidEventPayloadError(
          `${path}[${key}]`,
          'must be an enumerable data property'
        );
      }
      Object.defineProperty(clone, key, {
        value: cloneEventPayload(descriptor.value, `${path}[${key}]`, seen),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }

    return Object.freeze(clone);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidEventPayloadError(
      path,
      'must contain only primitives, arrays, and plain objects'
    );
  }

  const clone = Object.create(prototype);
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new InvalidEventPayloadError(path, 'must not contain symbol keys');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      throw new InvalidEventPayloadError(
        `${path}.${key}`,
        'must be an enumerable data property'
      );
    }
    Object.defineProperty(clone, key, {
      value: cloneEventPayload(descriptor.value, `${path}.${key}`, seen),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return Object.freeze(clone);
}

export function createEventBus(dependencies = {}) {
  if (!isObject(dependencies)) {
    throw new TypeError('Event bus dependencies must be an object.');
  }

  const onListenerError = Object.prototype.hasOwnProperty.call(
    dependencies,
    'onListenerError'
  )
    ? dependencies.onListenerError
    : defaultErrorReporter;
  assertErrorReporter(onListenerError);

  const listenersByType = new Map();
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new EventBusDestroyedError();
  }

  function removeEntry(eventType, entry) {
    if (!entry.active) return false;
    entry.active = false;
    const entries = listenersByType.get(eventType);
    if (!entries || !entries.delete(entry)) return false;
    if (entries.size === 0) listenersByType.delete(eventType);
    return true;
  }

  function addListener(eventType, listener, once) {
    assertActive();
    assertEventType(eventType);
    assertListener(listener);

    let entries = listenersByType.get(eventType);
    if (!entries) {
      entries = new Set();
      listenersByType.set(eventType, entries);
    }

    const entry = { listener, once, active: true };
    entries.add(entry);

    return function unsubscribeEventListener() {
      return removeEntry(eventType, entry);
    };
  }

  function reportListenerError(error, eventType, payload) {
    const context = Object.freeze({ type: eventType, payload });
    try {
      const reporting = onListenerError(error, context);
      if (isThenable(reporting)) {
        Promise.resolve(reporting).catch(reporterError => {
          reportToConsole(error, context, reporterError);
        });
      }
    } catch (reporterError) {
      reportToConsole(error, context, reporterError);
    }
  }

  function invokeListener(entry, eventType, payload) {
    try {
      const result = entry.listener(payload);
      if (isThenable(result)) {
        Promise.resolve(result).catch(error => {
          reportListenerError(error, eventType, payload);
        });
      }
    } catch (error) {
      reportListenerError(error, eventType, payload);
    }
  }

  return Object.freeze({
    subscribe(eventType, listener) {
      return addListener(eventType, listener, false);
    },
    once(eventType, listener) {
      return addListener(eventType, listener, true);
    },
    publish(eventType, payload) {
      assertActive();
      assertEventType(eventType);
      const immutablePayload = cloneEventPayload(payload);
      const entries = listenersByType.get(eventType);
      if (!entries) return;

      for (const entry of Array.from(entries)) {
        if (destroyed || !entry.active) continue;
        if (entry.once) removeEntry(eventType, entry);
        invokeListener(entry, eventType, immutablePayload);
      }
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      for (const entries of listenersByType.values()) {
        for (const entry of entries) entry.active = false;
      }
      listenersByType.clear();
      return true;
    }
  });
}
