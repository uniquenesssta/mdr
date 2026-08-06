import { definePlatformPort } from './port-contract.js';

/** @typedef {() => void | Promise<void>} PlatformDisposer */
/**
 * @typedef {Object} WindowPortImplementation
 * @property {() => Promise<void>} startDrag
 * @property {() => Promise<void>} minimize
 * @property {() => Promise<boolean>} toggleMaximize
 * @property {() => Promise<boolean>} isMaximized
 * @property {(handler: (event: object) => void) => PlatformDisposer | Promise<PlatformDisposer>} subscribeResize
 * @property {(handler: (event: object) => void) => PlatformDisposer | Promise<PlatformDisposer>} subscribeCloseRequest
 * @property {() => Promise<void>} requestClose
 * @property {() => Promise<void>} forceClose
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Application window controls and lifecycle event subscriptions. */
export const WINDOW_PORT_METHODS = Object.freeze([
  'startDrag',
  'minimize',
  'toggleMaximize',
  'isMaximized',
  'subscribeResize',
  'subscribeCloseRequest',
  'requestClose',
  'forceClose'
]);

export const WINDOW_PORT_SUBSCRIPTIONS = Object.freeze([
  'subscribeResize',
  'subscribeCloseRequest'
]);

/** @param {WindowPortImplementation} implementation */
export function defineWindowPort(implementation) {
  return definePlatformPort({
    name: 'window',
    methods: WINDOW_PORT_METHODS,
    subscriptions: WINDOW_PORT_SUBSCRIPTIONS
  }, implementation);
}
