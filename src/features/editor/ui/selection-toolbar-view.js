/**
 * Responsibility: Project configured formatting tools and density; route More to settings.
 * Imports: Existing public UI and caller-owned capabilities.
 * Exports: Explicit view factory.
 * State/side effects: Local presentation DOM only; business data remains caller-owned.
 * Lifecycle: Destroy events, preference subscription and queued frame.
 */
import { createEventScope, createSafeElement } from '../../../ui/dom/index.js';
import { createIconView } from '../../../ui/components/icon-view.js';

const DEFAULT_PRIMARY = ['heading', 'bold', 'italic', 'textColor', 'highlight', 'link'];
const groups = { heading:0, bold:1, italic:1, underline:1, strikethrough:1, script:1, textColor:2, highlight:2, link:3 };

export function createSelectionToolbarView({ root, selection, preferences, getLayoutMode, customize }) {
  const group = root.querySelector('.format-group'), menu=root.querySelector('#format-more-menu'), more=root.querySelector('#format-more-dropdown');
  const documentRef=root.ownerDocument, runtime=documentRef.defaultView, events=createEventScope();
  const items=[...root.querySelectorAll('[data-toolbar-item]')];
  const strip=createSafeElement(documentRef,'div',{className:'selection-toolbar-items'});group.insertBefore(strip,more);
  const pin=createSafeElement(documentRef,'button',{attributes:{type:'button','data-editor-action':'pin-toolbar','aria-label':'取消固定工具条',title:'取消固定工具条'}});
  pin.append(createIconView(documentRef,'icon-search'));pin.hidden=true;group.append(pin);
  let pinned=false,destroyed=false,frame=0,previewInteraction=false,projectedKey='',pointerSelecting=false;
  function inPreviewContext(){
    if(getLayoutMode()==='preview')return true;
    if(getLayoutMode()!=='both')return false;
    const preview=documentRef.querySelector('#preview'),editor=documentRef.querySelector('#editor');
    const native=runtime.getSelection?.();
    return Boolean(preview?.contains(native?.anchorNode)||preview?.contains(native?.focusNode)
      ||(previewInteraction&&!editor?.contains(documentRef.activeElement)));
  }
  function projectItems() {
    const settings=preferences?.read?.()||{};
    const key=JSON.stringify([settings.density,settings.primaryItems||DEFAULT_PRIMARY,settings.hiddenItems||[],pinned]);
    // Keep pressed controls connected across pointerdown/frame/pointerup.
    if(key===projectedKey)return;
    projectedKey=key;
    group.dataset.density=settings.density==='standard'?'standard':'compact';
    const primary=new Set(settings.primaryItems||DEFAULT_PRIMARY),hidden=new Set(settings.hiddenItems||[]);
    for(const divider of group.querySelectorAll('.toolbar-divider'))divider.remove();
    let last=null;
    for(const item of items){
      const visible=primary.has(item.dataset.toolbarItem)&&!hidden.has(item.dataset.toolbarItem);
      item.classList.toggle('toolbar-item-hidden',!visible);
      if(!visible){menu.append(item);continue;}
      const section=groups[item.dataset.toolbarItem]??3;
      if(last!==null&&section!==last){const separator=createSafeElement(documentRef,'span',{className:'toolbar-divider',attributes:{'aria-hidden':'true'}});strip.append(separator);}
      strip.append(item);last=section;
    }
    if(last!==null)strip.append(createSafeElement(documentRef,'span',{className:'toolbar-divider',attributes:{'aria-hidden':'true'}}));
    pin.hidden=!pinned;pin.setAttribute('aria-pressed',String(pinned));
  }
  function positionSubmenus(){
    for(const popup of group.querySelectorAll('.dropdown-menu.show')){
      const anchor=popup.parentElement.querySelector('button')?.getBoundingClientRect();if(!anchor)continue;
      const box=popup.getBoundingClientRect(),width=runtime.innerWidth,height=runtime.innerHeight;
      popup.style.position='fixed';popup.style.right='auto';
      popup.style.left=Math.max(8,Math.min(anchor.left,width-box.width-8))+'px';
      const below=anchor.bottom+8;popup.style.top=Math.max(8,below+box.height<=height-8?below:anchor.top-box.height-8)+'px';
    }
  }
  function refresh(){
    if(destroyed||!selection||pointerSelecting)return;
    const current=selection.snapshot();
    const blocked=inPreviewContext()||root.classList.contains('is-hidden')||documentRef.querySelector('.modal-overlay.show,.settings-workspace:not([hidden]),.writing-find-panel:not([hidden]),.menu-dropdown-list.show,.context-menu.show');
    const visible=!blocked&&(current.start<current.end||pinned);
    group.classList.toggle('has-selection',Boolean(visible));
    if(!visible){if(blocked)for(const popup of group.querySelectorAll('.dropdown-menu.show'))popup.classList.remove('show');return;}
    projectItems();
    const range=runtime.getSelection?.(),rect=range?.rangeCount?range.getRangeAt(0).getBoundingClientRect():null,host=documentRef.querySelector('#editor')?.getBoundingClientRect();
    const {width,height}=group.getBoundingClientRect();
    let left=(host?.left||0)+((host?.width||720)-width)/2,top=(host?.top||116)+8;
    if(!pinned&&rect?.height){left=(rect.left+rect.right-width)/2;top=rect.top-height-8;if(top<(host?.top||0)+8)top=rect.bottom+16;}
    group.style.left=Math.max(8,Math.min(left,runtime.innerWidth-width-8))+'px';group.style.top=Math.max(8,Math.min(top,runtime.innerHeight-height-8))+'px';positionSubmenus();
  }
  const schedule=()=>{if(!frame)frame=runtime.requestAnimationFrame(()=>{frame=0;refresh();});};
  events.listen(documentRef,'pointerdown',event=>{
    if(documentRef.querySelector('#preview')?.contains(event.target))previewInteraction=true;
    else if(documentRef.querySelector('#editor')?.contains(event.target))previewInteraction=false;
    if(event.button===0&&documentRef.querySelector('#editor')?.contains(event.target))pointerSelecting=true;
    schedule();
  },true);
  const finishPointer=()=>{pointerSelecting=false;schedule();};
  events.listen(documentRef,'pointerup',finishPointer,true);
  events.listen(documentRef,'pointercancel',finishPointer,true);
  events.listen(documentRef,'selectionchange',schedule);
  events.listen(documentRef,'contextmenu',schedule,true);
  for(const name of ['pointerup','click','keyup'])events.listen(documentRef,name,schedule);
  events.listen(documentRef,'scroll',()=>schedule(),true);
  events.listen(runtime,'resize',schedule);
  events.listen(documentRef,'keydown',event=>{if(!event.altKey||event.key!=='F10'||inPreviewContext())return;event.preventDefault();pinned=!pinned;refresh();if(pinned)group.querySelector('button:not([disabled])')?.focus();});
  const unsubscribe=preferences?.subscribe?.(schedule);
  return Object.freeze({
    refresh,
    close(){menu.classList.remove('show');},
    handle(action){
      if(action==='toggle-more'||action==='customize-toolbar'){menu.classList.remove('show');customize();return true;}
      if(action==='pin-toolbar'){pinned=!pinned;refresh();return true;}
      return false;
    },
    destroy(){destroyed=true;if(frame)runtime.cancelAnimationFrame(frame);unsubscribe?.();events.destroy();pin.remove();for(const item of items)menu.append(item);strip.remove();for(const divider of group.querySelectorAll('.toolbar-divider'))divider.remove();}
  });
}
