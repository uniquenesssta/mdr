const APPLICATION_PORT_METHODS = Object.freeze({
  commands: Object.freeze(['register', 'execute']),
  events: Object.freeze(['subscribe', 'publish']),
  lifecycle: Object.freeze(['start', 'destroy'])
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPort(name, value, methods) {
  if (!isObject(value) || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(
      `Application dependency "${name}" must implement ${methods.map(method => `${method}()`).join(' and ')}.`
    );
  }
}

export function createApplicationContext(dependencies) {
  if (!isObject(dependencies)) {
    throw new TypeError('Application dependencies must be an object.');
  }

  const context = {};
  for (const [name, methods] of Object.entries(APPLICATION_PORT_METHODS)) {
    const port = dependencies[name];
    assertPort(name, port, methods);
    context[name] = port;
  }

  return Object.freeze(context);
}
