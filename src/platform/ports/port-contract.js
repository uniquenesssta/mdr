/**
 * Owns structural validation and lifecycle enforcement shared by platform ports.
 * It does not know runtime detection, desktop APIs, browser globals, or business state.
 */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPromiseLike(value) {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
}

function assertContractDefinition(name, methods, subscriptionMethods) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Platform port name must be a non-empty string.');
  }
  if (!Array.isArray(methods) || !methods.length) {
    throw new TypeError(`Platform port "${name}" must declare at least one method.`);
  }

  const uniqueMethods = new Set();
  for (const method of methods) {
    if (typeof method !== 'string' || !method.trim()) {
      throw new TypeError(`Platform port "${name}" method names must be non-empty strings.`);
    }
    if (method === 'destroy') {
      throw new TypeError(`Platform port "${name}" cannot declare destroy() as a capability method.`);
    }
    if (uniqueMethods.has(method)) {
      throw new TypeError(`Platform port "${name}" declares duplicate method "${method}".`);
    }
    uniqueMethods.add(method);
  }

  for (const method of subscriptionMethods) {
    if (!uniqueMethods.has(method)) {
      throw new TypeError(
        `Platform port "${name}" subscription method "${method}" is not a declared method.`
      );
    }
  }
}

function assertImplementation(name, implementation, methods) {
  if (!isObject(implementation)) {
    throw new TypeError(`Platform port "${name}" implementation must be an object.`);
  }
  for (const method of methods) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Platform port "${name}" must implement ${method}().`);
    }
  }
  if (implementation.destroy !== undefined && typeof implementation.destroy !== 'function') {
    throw new TypeError(`Platform port "${name}" destroy must be a function when provided.`);
  }
}

function createAggregateError(name, errors) {
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, `Platform port "${name}" destroy failed.`);
}

export function definePlatformPort({ name, methods, subscriptions = [] }, implementation) {
  const declaredMethods = Object.freeze([...methods]);
  const subscriptionMethods = new Set(subscriptions);
  assertContractDefinition(name, declaredMethods, subscriptionMethods);
  assertImplementation(name, implementation, declaredMethods);

  let destroyed = false;
  let destroyPromise = null;
  const activeDisposers = [];
  const pendingSubscriptions = new Set();

  function assertActive() {
    if (destroyed) throw new Error(`Platform port "${name}" is destroyed.`);
  }

  function registerDisposer(method, disposer) {
    if (typeof disposer !== 'function') {
      throw new TypeError(`Platform port "${name}" ${method}() must return a disposer function.`);
    }

    let active = true;
    const trackedDisposer = async () => {
      if (!active) return;
      active = false;
      const index = activeDisposers.indexOf(trackedDisposer);
      if (index >= 0) activeDisposers.splice(index, 1);
      return disposer();
    };

    if (destroyed) {
      return Promise.resolve(trackedDisposer()).then(() => trackedDisposer);
    }

    activeDisposers.push(trackedDisposer);
    return trackedDisposer;
  }

  function invokeMethod(method, args) {
    assertActive();
    const result = implementation[method](...args);
    if (!subscriptionMethods.has(method)) return result;
    if (isPromiseLike(result)) {
      const pending = Promise.resolve(result)
        .then(disposer => registerDisposer(method, disposer))
        .finally(() => pendingSubscriptions.delete(pending));
      pendingSubscriptions.add(pending);
      return pending;
    }
    return registerDisposer(method, result);
  }

  const port = {};
  for (const method of declaredMethods) {
    port[method] = (...args) => invokeMethod(method, args);
  }

  port.destroy = () => {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    destroyPromise = (async () => {
      const errors = [];
      if (pendingSubscriptions.size) {
        const pendingResults = await Promise.allSettled([...pendingSubscriptions]);
        for (const result of pendingResults) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
      }
      while (activeDisposers.length) {
        const disposer = activeDisposers[activeDisposers.length - 1];
        try {
          await disposer();
        } catch (error) {
          errors.push(error);
        }
      }
      if (typeof implementation.destroy === 'function') {
        try {
          await implementation.destroy();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw createAggregateError(name, errors);
    })();
    return destroyPromise;
  };

  return Object.freeze(port);
}
