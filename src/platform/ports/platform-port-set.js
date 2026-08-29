import { defineStoragePort } from './storage-port.js';
import { defineFilesPort } from './files-port.js';
import { defineDialogsPort } from './dialogs-port.js';
import { defineWindowPort } from './window-port.js';
import { defineDragDropPort } from './drag-drop-port.js';
import { defineDocumentStorePort } from './document-store-port.js';
import { defineWebPort } from './web-port.js';
import { defineLinksPort } from './links-port.js';
import { defineLogsPort } from './logs-port.js';
import { defineClipboardPort } from './clipboard-port.js';
import { defineFullscreenPort } from './fullscreen-port.js';
import { definePrintPort } from './print-port.js';

const PORT_DEFINITIONS = Object.freeze([
  Object.freeze(['storage', defineStoragePort]),
  Object.freeze(['files', defineFilesPort]),
  Object.freeze(['dialogs', defineDialogsPort]),
  Object.freeze(['window', defineWindowPort]),
  Object.freeze(['dragDrop', defineDragDropPort]),
  Object.freeze(['documentStore', defineDocumentStorePort]),
  Object.freeze(['web', defineWebPort]),
  Object.freeze(['links', defineLinksPort]),
  Object.freeze(['logs', defineLogsPort]),
  Object.freeze(['clipboard', defineClipboardPort]),
  Object.freeze(['fullscreen', defineFullscreenPort]),
  Object.freeze(['print', definePrintPort])
]);

export const PLATFORM_PORT_NAMES = Object.freeze(PORT_DEFINITIONS.map(([name]) => name));

function assertImplementations(implementations) {
  if (implementations === null || typeof implementations !== 'object' || Array.isArray(implementations)) {
    throw new TypeError('Platform port implementations must be an object.');
  }
}

export function createPlatformPortSet(implementations) {
  assertImplementations(implementations);
  const ports = {};
  for (const [name, definePort] of PORT_DEFINITIONS) {
    ports[name] = definePort(implementations[name]);
  }

  let destroyPromise = null;
  ports.destroy = () => {
    if (destroyPromise) return destroyPromise;
    destroyPromise = (async () => {
      const errors = [];
      for (let index = PLATFORM_PORT_NAMES.length - 1; index >= 0; index -= 1) {
        try {
          await ports[PLATFORM_PORT_NAMES[index]].destroy();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Platform port set destroy failed.');
    })();
    return destroyPromise;
  };

  return Object.freeze(ports);
}
