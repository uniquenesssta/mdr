const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const EVENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function assertEventType(eventType) {
  if (typeof eventType !== 'string' || !EVENT_TYPE_PATTERN.test(eventType)) {
    throw new TypeError(
      'Event type must be a lower-case dotted identifier such as "document.changed".'
    );
  }
  return eventType;
}

export function defineEventTypes(definitions) {
  if (
    definitions === null ||
    typeof definitions !== 'object' ||
    Array.isArray(definitions)
  ) {
    throw new TypeError('Event type definitions must be an object.');
  }

  const catalog = {};
  const declaredTypes = new Set();

  for (const [name, eventType] of Object.entries(definitions)) {
    if (!EVENT_NAME_PATTERN.test(name)) {
      throw new TypeError(
        `Event constant name "${name}" must use upper snake case.`
      );
    }
    assertEventType(eventType);
    if (declaredTypes.has(eventType)) {
      throw new Error(`Event type "${eventType}" is declared more than once.`);
    }
    declaredTypes.add(eventType);
    catalog[name] = eventType;
  }

  return Object.freeze(catalog);
}
