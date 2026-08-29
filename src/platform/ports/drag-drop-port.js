import { definePlatformPort } from './port-contract.js';

/** @typedef {() => void | Promise<void>} PlatformDisposer */
/**
 * @typedef {Object} DragDropPortImplementation
 * @property {(handler: (event: object) => void) => PlatformDisposer | Promise<PlatformDisposer>} subscribe
 * @property {(() => void | Promise<void>)=} destroy
 */

/** File drag-and-drop event subscription contract. */
export const DRAG_DROP_PORT_METHODS = Object.freeze(['subscribe']);

/** @param {DragDropPortImplementation} implementation */
export function defineDragDropPort(implementation) {
  return definePlatformPort({
    name: 'dragDrop',
    methods: DRAG_DROP_PORT_METHODS,
    subscriptions: DRAG_DROP_PORT_METHODS
  }, implementation);
}
