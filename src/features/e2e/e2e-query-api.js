/** Stable opt-in test capability. Only detached DTOs cross this boundary. No DOM or globals. */
export function createE2EQueryAPI(options = {}) {
  const names = ['readContext','readSnapshot','readPreviewStats','readText','importDocument','setLayout','setVisualEditing',
    'focus','select','scroll','findText','clearStorage','now','schedule','cancel','requestFrame','cancelFrame'];
  let ports = {};
  for (const name of names) { if (typeof options[name] !== 'function') throw new TypeError(`E2EQueryAPI requires ${name}`); ports[name] = options[name]; }
  const operations = new Set();
  let destroyed = false, cleanupFailed = false, writer = null, sequence = 0;
  const failures = new WeakSet();
  const error = code => { const value = new Error(`E2E ${code}`); failures.add(value); return value; };
  const protect = caught => failures.has(caught) ? caught : error('operation unavailable');
  const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, value) : 0;
  const text = (value, max = 512) => typeof value === 'string' ? value.slice(0, max) : '';
  const bool = value => value === true;
  const freeze = Object.freeze;
  function alive() { if (destroyed || cleanupFailed) throw error('query unavailable'); }
  function call(name, ...args) { alive(); try { return ports[name](...args); } catch (_) { throw error('port unavailable'); } }
  function context() {
    try {
    const value = call('readContext');
    if (!value || typeof value.documentId !== 'string' || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !Number.isSafeInteger(value.version) || value.version < 0) throw error('document context unavailable');
    return freeze({ documentId: value.documentId, generation: value.generation, version: value.version });
    } catch (caught) { throw protect(caught); }
  }
  const key = value => JSON.stringify([value.documentId,value.generation,value.version]);
  function check(op) { alive(); if (!op.active || key(context()) !== key(op.context)) throw error('document changed'); }
  function metrics(raw, fields) {
    const result = {}; for (const field of fields) result[field] = count(raw?.[field]); return freeze(result);
  }
  const presentationFields = ['visibleLines','decoratedLines','headingLines','sourceActiveLines','hiddenMarkers','renderedBlocks',
    'codeBlocks','tableBlocks','imageBlocks','mathBlocks','mermaidBlocks','htmlBlocks','htmlFallbackBlocks'];
  const previewFields = ['blocks','mountedBlocks','start','end','estimatedHeight','measuredHeights','cachedHeights','scopeStartLine','scopeEndLine','viewportWidth','viewportHeight','pendingMermaid','pendingEnhancements'];
  function snapshot() {
    alive(); const origin = context();
    try {
      const raw = call('readSnapshot') || {}, states = Array.isArray(raw.componentStates) ? raw.componentStates : [], components = Array.isArray(raw.components) ? raw.components : [];
      const active = raw.activeElement;
      const result = freeze({ ready: bool(raw.ready), layout: ['both','hybrid','edit','preview'].includes(raw.layout) ? raw.layout : 'both',
        presentationMode: typeof raw.presentationMode === 'string' ? text(raw.presentationMode,80) : null,
        documentId: origin.documentId, documentGeneration: origin.generation, documentVersion: origin.version,
        pendingMermaid: count(raw.pendingMermaid), documentLength: count(raw.documentLength), selectionStart: count(raw.selectionStart), selectionEnd: count(raw.selectionEnd),
        selectedText: typeof raw.selectedText === 'string' ? raw.selectedText : '',
        presentationStats: raw.presentationStats ? metrics(raw.presentationStats,presentationFields) : null,
        componentStates: freeze(states.slice(0,1000).map(row => freeze({ key:text(row?.key),type:text(row?.type,80),from:count(row?.from),
          mode:text(row?.mode,80),revision:count(row?.revision),version:count(row?.version),reason:text(row?.reason),updatedAt:count(row?.updatedAt) }))),
        componentStatesTruncated: states.length > 1000,
        components: freeze(components.slice(0,1000).map((row,index) => freeze({index,type:text(row?.type,80),directEditing:bool(row?.directEditing),sourceVisible:bool(row?.sourceVisible),connected:bool(row?.connected)}))),
        componentsTruncated: components.length > 1000,
        activeElement: active ? freeze({tagName:text(active.tagName,80),id:text(active.id),className:text(active.className),hybridBlockType:typeof active.hybridBlockType==='string'?text(active.hybridBlockType,80):null}) : null
      });
      if (destroyed || key(context()) !== key(origin)) throw error('document changed');
      return result;
    } catch (_) { throw error('snapshot unavailable'); }
  }
  function getPreviewStats() {
    const origin = context();
    try { const raw = call('readPreviewStats') || {}; const result=freeze({...metrics(raw,previewFields),active:bool(raw.active),scope:text(raw.scope,80)});
      if (key(context())!==key(origin)) throw error('document changed'); return result;
    } catch (_) { throw error('preview stats unavailable'); }
  }
  function safeCancel(fn, id) { if (id === null) return; try { fn(id); } catch (_) { cleanupFailed = true; } }
  function stop(op, reason) {
    if (!op.active) return; op.active = false; operations.delete(op); if (writer === op) writer = null; safeCancel(op.cancel,op.deadline); op.deadline=null;
    for (const wait of [...op.waits]) wait.reject(reason);
  }
  function wait(op, start, cancel) {
    check(op);
    return new Promise((resolve,reject) => {
      const item = { id:null, reject:reason=>settle(reject,reason) };
      const settle = (fn,value) => { if (!op.waits.delete(item)) return; safeCancel(cancel,item.id);item.id=null;fn(value); };
      op.waits.add(item);
      try { item.id=start(value=>{ if (op.active) settle(resolve,value); },reason=>settle(reject,reason)); }
      catch (_) { settle(reject,error('wait unavailable')); }
      if (!op.active || !op.waits.has(item)) { safeCancel(cancel,item.id);item.id=null; }
    });
  }
  const frame = op => wait(op,done=>ports.requestFrame(done),id=>op.cancelFrame(id));
  const delay = op => wait(op,done=>ports.schedule(done,16),id=>op.cancel(id));
  // Register the owned wait before invoking import: import may synchronously replace the active identity.
  const boundedImport = (op, content, name) => wait(op,(done,reject)=>{
    Promise.resolve(call('importDocument',content,name,()=>op.active&&!destroyed&&!cleanupFailed)).then(done,()=>reject(error('action failed')));return null;
  },()=>{});
  function normalize(input = {}) {
    try {
    const value = Number(input.timeoutMs);
    return freeze({ timeoutMs: Math.min(30000,Math.max(250,Number.isFinite(value)&&value?value:6000)),
      quietMs: Math.min(1000,Math.max(20,Number(input.quietMs)||80)),
      layout:['both','hybrid','edit','preview'].includes(input.layout)?input.layout:'hybrid',
      name:typeof input.name==='string'?input.name:'e2e-fixture.md',focusText:typeof input.focusText==='string'?input.focusText:'',
      selection:Number.isFinite(Number(input.selection))?Number(input.selection):null,
      preserveSelection:input.preserveSelection===true,behavior:input.behavior==='smooth'?'smooth':'auto',
      viewportRatio:Number.isFinite(Number(input.viewportRatio))?Math.min(1,Math.max(0,Number(input.viewportRatio))):0.5,
      codeVisualEditing:input.codeVisualEditing!==false,tableVisualEditing:input.tableVisualEditing!==false,
      code:Object.hasOwn(input,'code')?Boolean(input.code):undefined,table:Object.hasOwn(input,'table')?Boolean(input.table):undefined,
      from:Math.max(0,Number(input.from)||0),wrap:input.wrap!==false,edge:input.edge==='end'?'end':'start' });
    } catch (_) { throw error('options unavailable'); }
  }
  async function execute(mutation, input, body) {
    alive(); if (operations.size >= 8 || (mutation && writer)) throw error('operation busy');
    const settings = normalize(input), op={id:++sequence,active:true,context:context(),waits:new Set(),deadline:null,cancel:ports.cancel,cancelFrame:ports.cancelFrame};
    operations.add(op); if(mutation)writer=op;
    try {
      op.deadline=ports.schedule(()=>stop(op,error('operation timed out')),settings.timeoutMs);
      if(!op.active){safeCancel(op.cancel,op.deadline);throw error('operation timed out');}
      const value=await body(op,settings);check(op);return value;
    } catch (caught) { throw protect(caught); }
    finally {stop(op,error('operation ended'));}
  }
  async function idle(op, settings) {
    let previous='',stableSince=null;
    for(let i=0;i<2000;i++) {
      await frame(op);check(op);const value=snapshot(),preview=getPreviewStats();
      const pending=value.pendingMermaid+preview.pendingMermaid+preview.pendingEnhancements;
      const fingerprint=JSON.stringify({components:value.components,sourceActiveLines:value.presentationStats?.sourceActiveLines||0,active:value.activeElement,preview});
      const time=call('now');if(!Number.isFinite(time))throw error('clock unavailable');
      if(pending===0&&previous===fingerprint){if(stableSince===null)stableSince=time;if(time-stableSince>=settings.quietMs)return true;}
      else {previous=fingerprint;stableSince=null;}
      await delay(op);check(op);
    }
    throw error('idle limit exceeded');
  }
  async function reveal(op,position,settings) {
    check(op);const length=snapshot().documentLength,pos=Math.max(0,Math.min(length,Number(position)||0));
    if(!settings.preserveSelection){call('focus');check(op);await frame(op);check(op);call('select',pos);check(op);}
    call('scroll',pos,settings.behavior,settings.viewportRatio);check(op);
    for(let i=0;i<3;i++){await frame(op);check(op);}await idle(op,settings);return pos;
  }
  const api = {
    snapshot,getComponentStates:()=>snapshot().componentStates,getPreviewStats,
    getEditorValue(){const origin=context(),value=call('readText');if(key(context())!==key(origin))throw error('document changed');return typeof value==='string'?value:'';},
    waitForIdle:input=>execute(false,input,(op,settings)=>idle(op,settings)).catch(()=>false),
    setLayout:(mode,input)=>execute(true,input,async(op,settings)=>{const normalized=['both','hybrid','edit','preview'].includes(mode)?mode:'both';call('setLayout',normalized);check(op);await idle(op,settings);return normalized;}),
    setVisualEditing:input=>execute(true,input,async(op,settings)=>{call('setVisualEditing',freeze({code:settings.code,table:settings.table}));check(op);await idle(op,settings);}),
    revealPosition:(position,input)=>execute(true,input,(op,settings)=>reveal(op,position,settings)),
    revealText:(value,input)=>execute(true,input,async(op,settings)=>{const query=typeof value==='string'?value:'';if(!query)throw error('text query required');const match=call('findText',query,settings.from,{wrap:settings.wrap});check(op);if(!match||!Number.isFinite(match.from)||!Number.isFinite(match.to))throw error('text not found');return reveal(op,settings.edge==='end'?match.to:match.from,settings);}),
    loadMarkdown:(value,input)=>execute(true,input,async(op,settings)=>{
      const content=typeof value==='string'?value:String(value||'');
      const result=await boundedImport(op,content,settings.name);
      if(!op.active||destroyed||!result?.loaded)throw error('document import rejected');
      const adopted=context();if(key(adopted)!==key(result.context))throw error('document changed');op.context=adopted;
      // Editor text uses LF even when the explicit fixture contains CRLF or CR.
      const editorContent=content.replace(/\r\n?/g,'\n');
      if(call('readText')!==editorContent)throw error('document import mismatch');check(op);
      let position=settings.selection;
      if(position===null){const found=settings.focusText?editorContent.indexOf(settings.focusText):-1;const code=editorContent.match(/```(?!mermaid\b)[^\n]*\n/);position=found>=0?found:code?.index!==undefined?code.index+code[0].length:0;}
      await reveal(op,position,settings);check(op);
      call('setVisualEditing',freeze({code:settings.codeVisualEditing,table:settings.tableVisualEditing}));check(op);await idle(op,settings);
      call('setLayout',settings.layout);check(op);await idle(op,settings);await reveal(op,snapshot().selectionStart,settings);return snapshot();
    }),
    clearStorage(){alive();if(operations.size)throw error('operation busy');call('clearStorage');return true;},
    destroy(){if(destroyed)return;destroyed=true;for(const op of [...operations])stop(op,error('query destroyed'));ports=null;},
    getState:()=>freeze({destroyed,cleanupFailed,busy:writer!==null,activeOperations:operations.size,pendingWaits:[...operations].reduce((n,op)=>n+op.waits.size,0)})
  };
  return freeze(api);
}
