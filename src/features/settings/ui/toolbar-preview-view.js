/**
 * Responsibility: Render a noninteractive preview of the current settings draft.
 * Imports: Existing public UI and caller-owned capabilities.
 * Exports: Explicit view factory.
 * State/side effects: Local presentation DOM only; business data remains caller-owned.
 * Lifecycle: Remove owned preview DOM on destroy.
 */
import { createSafeElement } from '../../../ui/dom/index.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { TOOLBAR_LABELS } from './settings-field-view.js';

const LABELS = { heading: '正文', bold: 'B', italic: 'I', underline: 'U', strikethrough: 'S', textColor: 'A', highlight: '高亮', link: '链接' };
export function createToolbarPreviewView(documentRef) {
  const root = createSafeElement(documentRef, 'div', { className: 'settings-toolbar-preview', attributes: { role: 'img', 'aria-label': '当前工具条配置预览' } });
  return Object.freeze({
    root,
    render(draft) {
      root.dataset.density = draft.toolbarDensity;
      const hidden = new Set(draft.toolbarHiddenItems || []);
      root.replaceChildren();
      const groups={heading:0,bold:1,italic:1,underline:1,strikethrough:1,script:1,textColor:2,highlight:2,link:3};
      let last=null;
      for (const id of draft.toolbarPrimaryItems || []) {
        if(hidden.has(id))continue;
        const group=groups[id]??3;
        if(last!==null&&group!==last)root.append(createSafeElement(documentRef,'i',{className:'preview-divider'}));
        const item=createSafeElement(documentRef,'span',{text:LABELS[id]||TOOLBAR_LABELS[id]||id,dataset:{toolbarItem:id}});
        if(id==='heading')item.append(createIconView(documentRef,'icon-chevron-down'));
        root.append(item);last=group;
      }
      if(last!==null)root.append(createSafeElement(documentRef,'i',{className:'preview-divider'}));
      root.append(createSafeElement(documentRef, 'span', { text: '更多' }));
    },
    destroy() { root.remove(); }
  });
}
