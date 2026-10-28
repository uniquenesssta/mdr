/**
 * Responsibility: Apply approved icon presentation after command binding.
 * Imports: Existing public UI and caller-owned capabilities.
 * Exports: Explicit view factory.
 * State/side effects: Local presentation DOM only; business data remains caller-owned.
 * Lifecycle: Owned nodes follow the menu DOM lifetime.
 */
import { createIconView } from '../../../ui/components/icon-view.js';
const ICONS={
 'document.new':'icon-menu-file','file.open':'icon-folder','document.save':'icon-save','document.save-as':'icon-save',
 'document.rename-active':'icon-menu-edit','settings.open':'icon-layout','import.web':'icon-globe',
 'editor.link.open':'icon-link','editor.image.open':'icon-image','editor.table.insert-3x3':'icon-table','editor.mermaid.open':'icon-mermaid'
};
export function applyMenuPresentation(root){
 for(const node of root.querySelectorAll('[data-menu-command]')){
  const icon=ICONS[node.dataset.menuCommand];
  if(icon&&!node.querySelector(':scope > svg'))node.prepend(createIconView(root.ownerDocument,icon));
 }
 for(const [selector,icon]of [['#recent-files-menu-item','icon-folder'],['#file-menu > .menu-submenu:last-child','icon-download'],['#insert-menu > .menu-submenu:first-child','icon-menu-edit']]){
  const node=root.querySelector(selector);if(node&&!node.querySelector(':scope > svg'))node.prepend(createIconView(root.ownerDocument,icon));
 }
}
