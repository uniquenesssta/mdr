import {
  HYBRID_COMPONENT_MODES,
  clearHybridComponentStates,
  createHybridComponentKey,
  getHybridComponentStateMachine,
  registerHybridComponentCloser,
  transitionHybridComponent,
  closeHybridComponent
} from '../../../src/editor/hybrid/component-state.js';
import { bindStrictDoubleActivation } from '../../../src/editor/hybrid/double-activation.js';
import { clearMermaidRenderCache, renderMermaidDiagram } from '../../../src/features/preview/render/presentation/mermaid-presentation.js';

const view = {};
const machine = getHybridComponentStateMachine(view);
const cleanup = [];
const logElement = document.getElementById('event-log');
const events = [];
let layout = 'hybrid';

function record(type, details={}) { events.push({type,details,at:performance.now()}); logElement.textContent=events.slice(-30).map(e=>`${e.type} ${JSON.stringify(e.details)}`).join('\n'); }
function componentElement(type){ return document.querySelector(`[data-component="${type}"]`); }
function render(type){
  const element=componentElement(type); const state=machine.get(createHybridComponentKey(type,0)); const mode=state?.mode||'presented';
  element.dataset.mode=mode;
  const existing=element.querySelector('textarea');
  if(mode==='presented'){
    existing?.remove(); element.querySelector('.component-body').hidden=false;
  } else {
    element.querySelector('.component-body').hidden=true;
    if(!existing){ const area=document.createElement('textarea'); area.dataset.editor=mode; area.value=mode==='source'?`source:${type}`:`direct:${type}`; element.appendChild(area); requestAnimationFrame(()=>area.focus()); }
    else existing.dataset.editor=mode;
  }
}
function close(type, reason='outside'){
  closeHybridComponent(view,createHybridComponentKey(type,0),reason,{componentType:type}); render(type); record('close',{type,reason});
}
function open(type,mode,reason){
  transitionHybridComponent(view,{key:createHybridComponentKey(type,0),type,from:0,mode,reason});
  for(const item of ['code','table','math']) render(item);
  record('open',{type,mode,reason});
}
for(const type of ['code','table','math']){
  machine.transition({type,from:0,mode:HYBRID_COMPONENT_MODES.PRESENTED,reason:'initial'}); render(type);
  const key=createHybridComponentKey(type,0);
  cleanup.push(registerHybridComponentCloser(view,key,({reason='superseded'}={})=>close(type,reason)));
  const element=componentElement(type); const body=element.querySelector('.component-body');
  if(type!=='math') cleanup.push(bindStrictDoubleActivation(body,()=>open(type,HYBRID_COMPONENT_MODES.DIRECT,'doubleclick'),{getTargetKey:e=>`${type}:${e.target.closest('[data-double-zone]')?.dataset.doubleZone||'body'}`}));
  else cleanup.push(bindStrictDoubleActivation(body,()=>open(type,HYBRID_COMPONENT_MODES.SOURCE,'doubleclick'),{getTargetKey:()=>`${type}:formula`}));
  element.querySelector('[data-source]').addEventListener('click',event=>{event.stopPropagation();open(type,HYBRID_COMPONENT_MODES.SOURCE,'button');});
}
document.querySelector('.outside').addEventListener('pointerdown',()=>{ const active=machine.getActive(); if(active) close(active.type,'pointer-outside'); });
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{ const active=machine.getActive(); if(active) close(active.type,'layout-change'); layout=button.dataset.view; record('layout',{layout}); }));

window.__interactionHarness=Object.freeze({
  ready:true,
  snapshot(){ return {layout,states:machine.snapshot(),active:machine.getActive(),events:[...events],selection:String(getSelection()?.toString()||'')}; },
  reset(){ for(const type of ['code','table','math']) close(type,'reset'); events.length=0; layout='hybrid'; getSelection()?.removeAllRanges(); return true; },
  async renderMermaidParity(theme='default'){
    document.body.setAttribute('data-theme',theme==='dark'?'dark':'light');
    clearMermaidRenderCache();
    const calls=[];
    window.mermaid={
      initialize(options){calls.push({type:'initialize',theme:options.theme});},
      async render(id,source){calls.push({type:'render',id,source});return {svg:`<svg viewBox=\"0 0 120 40\" height=\"40\"><text x=\"4\" y=\"24\">${source}</text></svg>`};}
    };
    delete window.__markdownEditorMermaidTheme;
    const hybrid=document.querySelector('[data-render-surface=hybrid]');
    const preview=document.querySelector('[data-render-surface=preview]');
    hybrid.replaceChildren(); preview.replaceChildren();
    const source='flowchart LR; A-->B';
    const hybridResult=await renderMermaidDiagram(hybrid,source,{theme,cacheKey:'hybrid:1',renderIdPrefix:'hybrid'});
    const previewResult=await renderMermaidDiagram(preview,source,{theme,cacheKey:'preview:1',renderIdPrefix:'preview'});
    const inspect=element=>{const svg=element.querySelector('svg');return {html:element.innerHTML,role:svg?.getAttribute('role'),label:svg?.getAttribute('aria-label'),className:svg?.getAttribute('class')||'',heightAttribute:svg?.getAttribute('height'),inlineStyle:svg?.getAttribute('style'),theme:element.dataset.mermaidTheme};};
    return {hybrid:inspect(hybrid),preview:inspect(preview),hybridResult,previewResult,calls};
  }
});
window.addEventListener('beforeunload',()=>{cleanup.forEach(fn=>fn());clearHybridComponentStates(view);});