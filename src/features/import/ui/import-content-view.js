import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the import feature markup; event policy and domain state stay in its existing controllers. */
export function createImportContentView(slots) {
  return mountStaticContent([
    [slots.overlay,[
      ["div",{"class":"drop-overlay","id":"drop-overlay","aria-hidden":"true"},[]],
      ["input",{"type":"file","id":"importFile","accept":".md,.markdown,.txt","hidden":true,"class":"c-file-input"},[]]
    ]],
  ]);
}
