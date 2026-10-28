/**
 * Responsibility: Own captured selection and pending colors; commit through existing editor commands.
 * Imports: Existing public UI and caller-owned capabilities.
 * Exports: Explicit view factory.
 * State/side effects: Local presentation DOM only; business data remains caller-owned.
 * Lifecycle: Destroy listeners and captured selection explicitly.
 */
import { createEventScope, createSafeElement } from '../../../ui/dom/index.js';

const CONFIG=Object.freeze({
 text:{button:'text-color-button',menu:'text-color-menu',indicator:'text-color-indicator',input:'custom-text-color',title:'文字颜色'},
 highlight:{button:'highlight-color-button',menu:'highlight-color-menu',indicator:'highlight-color-indicator',input:'custom-highlight-color',title:'高亮颜色'}
});
const validHex=value=>/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
export function createInlineColorMenuView({root,selection,commands,notify=()=>{},collapseSelection=()=>false}={}){
 if(!root?.ownerDocument)throw new TypeError('Inline Color Menu View requires a toolbar root.');
 if(!selection||typeof selection.snapshot!=='function')throw new TypeError('Inline Color Menu View requires Selection Service.');
 if(!commands||typeof commands.execute!=='function')throw new TypeError('Inline Color Menu View requires a command boundary.');
 const events=createEventScope(),controls=new Map(),doc=root.ownerDocument;let captured=null,destroyed=false;
 for(const [kind,c]of Object.entries(CONFIG)){
  const menu=root.querySelector('#'+c.menu);menu.dataset.palette=kind;menu.querySelector('strong').textContent=c.title;
  const old=menu.querySelector('#'+c.input),actions=menu.querySelector('.color-menu-actions');
  const input=createSafeElement(doc,'input',{id:c.input,className:'color-hex-input',attributes:{type:'text',value:old?.value||'#253A71','aria-label':c.title+'十六进制值',spellcheck:'false',maxlength:'7'}});
  const reset=createSafeElement(doc,'button',{text:'恢复默认',attributes:{type:'button','data-inline-color-clear':kind}});
  const apply=createSafeElement(doc,'button',{className:'primary',text:'应用',attributes:{type:'button','data-inline-color-apply':kind}});
  actions.replaceChildren(reset,apply);menu.insertBefore(input,actions);controls.set(kind,{input,apply});
  for(const swatch of menu.querySelectorAll('[data-inline-color]')){swatch.setAttribute('aria-label',swatch.title);swatch.setAttribute('aria-pressed','false');}
 }
 const sync=kind=>{const c=CONFIG[kind],control=controls.get(kind),value=control.input.value.trim();control.input.setAttribute('aria-invalid',String(!validHex(value)));control.apply.disabled=!validHex(value);for(const s of root.querySelectorAll('#'+c.menu+' [data-inline-color]'))s.setAttribute('aria-pressed',String(s.dataset.inlineColor.toLowerCase()===value.toLowerCase()));};
 const close=()=>{for(const c of Object.values(CONFIG)){root.querySelector('#'+c.menu)?.classList.remove('show');root.querySelector('#'+c.button)?.setAttribute('aria-expanded','false');}};
 const updateAvailability=()=>{const value=selection.snapshot(),available=value.start<value.end;for(const c of Object.values(CONFIG)){const button=root.querySelector('#'+c.button);if(button)button.disabled=!available;}if(!available)captured=null;return available;};
 const toggle=kind=>{const c=CONFIG[kind];if(!c)return;const value=selection.snapshot();if(value.start===value.end){notify('请先选择需要设置颜色的文字');close();return;}captured=value;const menu=root.querySelector('#'+c.menu),willShow=!menu.classList.contains('show');close();if(willShow){menu.classList.add('show');root.querySelector('#'+c.button).setAttribute('aria-expanded','true');sync(kind);}};
 const apply=(kind,color,clear=false)=>{const target=captured||selection.snapshot();if(target.start===target.end){notify('请先选择需要设置颜色的文字');return;}if(!clear&&!validHex(color))return;
  const result=commands.execute(clear?'clear-color':'set-color',{kind,color,selection:target,collapse:Boolean(collapseSelection())});
  const indicator=root.querySelector('#'+CONFIG[kind].indicator);if(result?.applied&&indicator)indicator.style.background=clear?'':String(color||'');
  if(result?.applied&&!clear)controls.get(kind).input.value=String(color);
  captured=result?.selection?Object.freeze({...target,...result.selection}):null;close();updateAvailability();return result;};
 events.listen(root,'click',event=>{
  const toggleButton=event.target?.closest?.('[data-color-menu-kind]');if(toggleButton){event.preventDefault?.();toggle(toggleButton.dataset.colorMenuKind);return;}
  const swatch=event.target?.closest?.('[data-inline-color]');if(swatch){event.preventDefault?.();controls.get(swatch.dataset.inlineColorKind).input.value=swatch.dataset.inlineColor;sync(swatch.dataset.inlineColorKind);return;}
  const clear=event.target?.closest?.('[data-inline-color-clear]');if(clear){event.preventDefault?.();apply(clear.dataset.inlineColorClear,'',true);return;}
  const confirm=event.target?.closest?.('[data-inline-color-apply]');if(confirm){event.preventDefault?.();const kind=confirm.dataset.inlineColorApply;apply(kind,controls.get(kind).input.value.trim());}
 });
 for(const [kind,c]of controls)events.listen(c.input,'input',()=>sync(kind));
 events.listen(doc,'mousedown',event=>{if(!event.target?.closest?.('.color-dropdown'))close();});
 updateAvailability();
 return Object.freeze({toggle,close,updateAvailability,destroy(){if(destroyed)return;destroyed=true;close();captured=null;events.destroy();}});
}
