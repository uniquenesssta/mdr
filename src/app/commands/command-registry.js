import { assertCommandId } from './command-ids.js';

export class DuplicateCommandRegistrationError extends Error {
  constructor(commandId) {
    super(`Command "${commandId}" already has a registered handler.`);
    this.name = 'DuplicateCommandRegistrationError';
    this.commandId = commandId;
  }
}

export class CommandNotRegisteredError extends Error {
  constructor(commandId) {
    super(`Command "${commandId}" does not have a registered handler.`);
    this.name = 'CommandNotRegisteredError';
    this.commandId = commandId;
  }
}

function assertCommandHandler(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('Command handler must be a function.');
  }
}

export function createCommandRegistry() {
  const entries = new Map();

  function register(commandId, handler) {
    assertCommandId(commandId);
    assertCommandHandler(handler);

    if (entries.has(commandId)) {
      throw new DuplicateCommandRegistrationError(commandId);
    }

    const entry = Object.freeze({ commandId, handler });
    entries.set(commandId, entry);
    let active = true;

    return function unregisterCommand() {
      if (!active) return false;
      active = false;
      if (entries.get(commandId) !== entry) return false;
      entries.delete(commandId);
      return true;
    };
  }

  function resolve(commandId) {
    assertCommandId(commandId);
    const entry = entries.get(commandId);
    if (!entry) throw new CommandNotRegisteredError(commandId);
    return entry.handler;
  }

  function has(commandId) {
    assertCommandId(commandId);
    return entries.has(commandId);
  }

  return Object.freeze({
    get size() {
      return entries.size;
    },
    register,
    resolve,
    has
  });
}
