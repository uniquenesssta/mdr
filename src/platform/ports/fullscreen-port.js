import { definePlatformPort } from './port-contract.js';

/** @typedef {() => void | Promise<void>} PlatformDisposer */
/**
 * @typedef {Object} FullscreenPortImplementation
 * @property {() => boolean} isEnabled
 * @property {() => boolean} isActive
 * @property {() => Promise<void>} enter
 * @property {() => Promise<void>} exit
 * @property {(handler: (active: boolean) => void) => PlatformDisposer | Promise<PlatformDisposer>} subscribe
 * @property {(() => void | Promise<void>)=} destroy
 */

/** Fullscreen capability, state transition and change subscription contract. */
export const FULLSCREEN_PORT_METHODS = Object.freeze([
  'isEnabled',
  'isActive',
  'enter',
  'exit',
  'subscribe'
]);

/** @param {FullscreenPortImplementation} implementation */
export function defineFullscreenPort(implementation) {
  return definePlatformPort({
    name: 'fullscreen',
    methods: FULLSCREEN_PORT_METHODS,
    subscriptions: ['subscribe']
  }, implementation);
}
