/** Stable public entry for platform contracts and runtime capability detection. */
export * from './ports/index.js';
export { detectPlatformEnvironment, PLATFORM_ENVIRONMENTS } from './environment/platform-detection.js';
export { createRuntimeCapabilities } from './environment/runtime-capabilities.js';
