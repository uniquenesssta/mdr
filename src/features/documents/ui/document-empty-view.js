/**
 * Responsibility: Project the actual empty session and route document creation.
 * Imports: Existing public UI and caller-owned capabilities.
 * Exports: Explicit view factory.
 * State/side effects: Local presentation DOM only; business data remains caller-owned.
 * Lifecycle: Unsubscribe session and remove owned listeners and DOM.
 */
import { createSafeElement, createEventScope } from '../../../ui/dom/index.js';
import { createIconView } from '../../../ui/components/icon-view.js';
export function createDocumentEmptyView({root,session,onNew}) {
 const doc=root.ownerDocument,events=createEventScope();
 const surface=createSafeElement(doc,'section',{className:'document-empty',attributes:{'aria-label':'开始写作'}});
 const content=createSafeElement(doc,'div',{className:'document-empty-content'});
 const button=createSafeElement(doc,'button',{className:'primary',text:'新建文档',attributes:{type:'button'}});
 content.append(createIconView(doc,'icon-menu-file'),createSafeElement(doc,'h2',{text:'从一篇空白文档开始'}),createSafeElement(doc,'p',{text:'记录想法，让文字慢慢生长。'}),button);
 surface.append(content);root.append(surface);
 const originalEmptyClass=root.classList.contains('has-empty-document');
 const render=()=>{const empty=!session.activeId;surface.hidden=!empty;root.classList.toggle('has-empty-document',empty);};
 const unsubscribe=session.subscribe(render);render();
 events.listen(button,'click',onNew);
 return Object.freeze({destroy(){unsubscribe();events.destroy();surface.remove();root.classList.toggle('has-empty-document',originalEmptyClass);}});
}
