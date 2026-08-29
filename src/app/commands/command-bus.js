import { createCommandRegistry } from './command-registry.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertCommandRegistry(registry) {
  if (
    !isObject(registry) ||
    typeof registry.register !== 'function' ||
    typeof registry.resolve !== 'function'
  ) {
    throw new TypeError(
      'Command bus registry must implement register() and resolve().'
    );
  }
}

export function createCommandBus(dependencies = {}) {
  if (!isObject(dependencies)) {
    throw new TypeError('Command bus dependencies must be an object.');
  }

  const registry = dependencies.registry ?? createCommandRegistry();
  assertCommandRegistry(registry);

  return Object.freeze({
    register(commandId, handler) {
      return registry.register(commandId, handler);
    },
    execute(commandId, payload) {
      let handler;
      try {
        handler = registry.resolve(commandId);
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve().then(() => handler(payload));
    }
  });
}
