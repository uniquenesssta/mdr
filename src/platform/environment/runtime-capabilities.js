/**
 * Pure capability snapshot construction from an explicit environment and
 * guarded runtime-surface probes. This module owns no state or behavior.
 */

import { PLATFORM_ENVIRONMENTS } from './platform-detection.js';

function readMember(target, key) {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
    return undefined;
  }
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

function hasMethod(target, key) {
  return typeof readMember(target, key) === 'function';
}

function hasConstructor(runtime, key) {
  return typeof readMember(runtime, key) === 'function';
}

function freezeCapabilities(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) Object.freeze(child);
  }
  return Object.freeze(value);
}

function assertEnvironment(environment) {
  if (!environment || typeof environment !== 'object') {
    throw new TypeError('platform environment must be an object');
  }
  const isDesktop = environment.kind === PLATFORM_ENVIRONMENTS.DESKTOP
    && environment.isDesktop === true
    && environment.isBrowser === false;
  const isBrowser = environment.kind === PLATFORM_ENVIRONMENTS.BROWSER
    && environment.isDesktop === false
    && environment.isBrowser === true;
  if (!isDesktop && !isBrowser) {
    throw new TypeError('platform environment must be a detected browser or desktop snapshot');
  }
}

export function createRuntimeCapabilities(environment, runtime = globalThis) {
  assertEnvironment(environment);

  const documentObject = readMember(runtime, 'document');
  const navigatorObject = readMember(runtime, 'navigator');
  const clipboardObject = readMember(navigatorObject, 'clipboard');
  const storageObject = readMember(runtime, 'localStorage');
  const urlObject = readMember(runtime, 'URL');
  const elementConstructor = readMember(runtime, 'Element');
  const elementPrototype = readMember(elementConstructor, 'prototype');
  const isDesktop = environment.isDesktop;

  const browser = Object.freeze({
    storage: hasMethod(storageObject, 'getItem')
      && hasMethod(storageObject, 'setItem')
      && hasMethod(storageObject, 'removeItem')
      && hasMethod(storageObject, 'clear'),
    fileRead: hasConstructor(runtime, 'FileReader'),
    fileDownload: hasMethod(documentObject, 'createElement')
      && hasMethod(urlObject, 'createObjectURL')
      && hasMethod(urlObject, 'revokeObjectURL'),
    clipboard: hasMethod(clipboardObject, 'writeText') || hasMethod(documentObject, 'execCommand'),
    fullscreen: readMember(documentObject, 'fullscreenEnabled') === true
      && hasMethod(elementPrototype, 'requestFullscreen')
      && hasMethod(documentObject, 'exitFullscreen')
      && hasMethod(documentObject, 'addEventListener'),
    print: hasMethod(runtime, 'print'),
    webFetch: hasMethod(runtime, 'fetch'),
    externalLinks: hasMethod(runtime, 'open'),
    confirm: hasMethod(runtime, 'confirm')
  });

  const desktop = Object.freeze({
    invoke: isDesktop,
    dialogs: isDesktop,
    window: isDesktop,
    dragDrop: isDesktop,
    fileSystem: isDesktop,
    documentStore: isDesktop,
    webFetch: isDesktop,
    externalLinks: isDesktop,
    performanceLogs: isDesktop
  });

  return freezeCapabilities({
    runtime: environment.kind,
    isDesktop,
    isBrowser: environment.isBrowser,
    desktop,
    browser
  });
}
