const COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const COMMAND_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function assertCommandId(commandId) {
  if (typeof commandId !== 'string' || !COMMAND_ID_PATTERN.test(commandId)) {
    throw new TypeError(
      'Command ID must be a lower-case dotted identifier such as "document.save-as".'
    );
  }
  return commandId;
}

export function defineCommandIds(definitions) {
  if (
    definitions === null ||
    typeof definitions !== 'object' ||
    Array.isArray(definitions)
  ) {
    throw new TypeError('Command ID definitions must be an object.');
  }

  const catalog = {};
  const declaredIds = new Set();

  for (const [name, commandId] of Object.entries(definitions)) {
    if (!COMMAND_NAME_PATTERN.test(name)) {
      throw new TypeError(
        `Command constant name "${name}" must use upper snake case.`
      );
    }
    assertCommandId(commandId);
    if (declaredIds.has(commandId)) {
      throw new Error(`Command ID "${commandId}" is declared more than once.`);
    }
    declaredIds.add(commandId);
    catalog[name] = commandId;
  }

  return Object.freeze(catalog);
}
