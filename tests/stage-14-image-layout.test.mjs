import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateImageLayout, createImageExportLayout, mountClassicImageLayoutPort, createExportRequest, EXPORT_IMAGE_RATIOS } from '../src/features/export/index.js';
import { EXPORT_IMAGE_RATIOS as layoutRatios } from '../src/features/export/formats/image/image-ratio-presets.js';
import { EXPORT_IMAGE_RATIOS as requestRatios } from '../src/features/export/application/export-request.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const sizes = [['9:16',1080,1920],['4:5',1080,1350],['3:4',1080,1440],['1:1',1080,1080],['16:9',1920,1080]];
const options = (ratio='9:16',cropFit=false) => createExportRequest({ format:'image',documentId:'doc',imageOptions:{ratio,cropFit} }).imageOptions;
function element(height=100) {
  const values=new Map(),priorities=new Map(),attributes=new Map();
  return { scrollHeight:height, style:{ getPropertyValue:n=>values.get(n)||'',getPropertyPriority:n=>priorities.get(n)||'',
    setProperty(n,v,p=''){values.set(n,String(v));priorities.set(n,p);},removeProperty(n){const v=values.get(n)||'';values.delete(n);priorities.delete(n);return v;} },
    getAttribute:n=>attributes.get(n)??null,hasAttribute:n=>attributes.has(n),setAttribute(n,v){attributes.set(n,String(v));},removeAttribute:n=>attributes.delete(n) };
}
const marker='data-export-image-layout';
const empty = node => { assert.equal(node.hasAttribute(marker),false);for(const key of ['width','height','padding-block','padding-inline','font-size'])assert.equal(node.style.getPropertyValue('--export-image-'+key),''); };

for (const [ratio,width,height] of sizes) for (const kind of ['empty','short','long','crop']) {
  test(`R14-13 ${ratio} ${kind} keeps canonical pixel geometry and immutable layout`,()=>{
    const natural=kind==='empty'?0:kind==='short'?height-1:height+345;
    const result=calculateImageLayout(options(ratio,kind==='crop'),natural);
    assert.deepEqual(result,{ratio,width,targetHeight:height,cropFit:kind==='crop',naturalHeight:natural,
      mode:kind==='long'?'long':kind==='crop'?'crop':'pad',captureHeight:kind==='long'?height+345:height,
      paddingBlock:Math.round(width*0.04),paddingInline:Math.round(width*0.045),fontSize:Math.round(width/36)});
    assert.equal(Object.isFrozen(result),true);assert.throws(()=>{result.width=1;},TypeError);
  });
}

test('R14-13 request and layout share the exact immutable five-ratio authority',()=>{
  assert.equal(EXPORT_IMAGE_RATIOS,layoutRatios);assert.equal(requestRatios,layoutRatios);
  assert.deepEqual(Object.entries(layoutRatios),sizes.map(([ratio,width,height])=>[ratio,{width,height}]));
  assert.equal(Object.isFrozen(layoutRatios),true);for(const value of Object.values(layoutRatios))assert.equal(Object.isFrozen(value),true);
});

test('R14-13 invalid ratio, forged dimensions and measurements fail before any DOM mutation',()=>{
  const good=options();
  for(const bad of [null,[],{},'9:16',{...good,ratio:'__proto__'},{...good,ratio:'invalid'},{...good,width:1920},{...good,height:1080},{...good,cropFit:'true'}])assert.throws(()=>calculateImageLayout(bad),TypeError);
  for(const height of [-1,NaN,Infinity,null,'100',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>calculateImageLayout(good,height),TypeError);
  const owner=createImageExportLayout(),root=element(),stage=element();assert.throws(()=>owner.mount({root,stage,options:{...good,width:1}}),TypeError);empty(root);empty(stage);owner.destroy();
});

test('R14-13 measure phase, exact-height boundary and fractional pixels preserve short crop and long semantics',()=>{
  const input=options('1:1');assert.equal(calculateImageLayout(input).mode,'measure');assert.equal(calculateImageLayout(input).captureHeight,null);
  assert.equal(calculateImageLayout(input,1080).mode,'long');assert.equal(calculateImageLayout(options('1:1',true),1080).mode,'crop');
  assert.equal(calculateImageLayout(input,1080.2).captureHeight,1081);assert.equal(calculateImageLayout(input,1079.2).mode,'long');
  assert.equal(calculateImageLayout(options('1:1',true),0).mode,'pad');
});

test('R14-13 layout lease snapshots options, remeasures natural content and restores original values and priorities',()=>{
  const owner=createImageExportLayout(),root=element(100),stage=element(),input={...options()};
  root.style.setProperty('--export-image-font-size','11px','important');root.setAttribute(marker,'prior');stage.style.setProperty('--export-image-width','222px','important');
  const lease=owner.mount({root,stage,options:input});input.ratio='16:9';input.width=1920;input.height=1080;input.cropFit=true;
  assert.equal(lease.layout.mode,'measure');assert.equal(root.style.getPropertyValue('--export-image-width'),'1080px');assert.equal(lease.measure().mode,'pad');
  root.scrollHeight=2200;assert.equal(lease.measure().mode,'long');assert.equal(stage.style.getPropertyValue('--export-image-height'),'2200px');
  root.scrollHeight=0;assert.equal(lease.measure().mode,'pad');lease.release();lease.release();
  assert.equal(root.getAttribute(marker),'prior');assert.equal(root.style.getPropertyValue('--export-image-font-size'),'11px');assert.equal(root.style.getPropertyPriority('--export-image-font-size'),'important');
  assert.equal(stage.style.getPropertyValue('--export-image-width'),'222px');assert.equal(stage.style.getPropertyPriority('--export-image-width'),'important');assert.equal(stage.hasAttribute(marker),false);
  assert.throws(()=>lease.measure(),e=>e.reason==='destroyed');owner.destroy();
});

test('R14-13 a cropped lease clears fixed projection before remeasurement',()=>{
  const owner=createImageExportLayout(),root=element(),stage=element();let natural=2500;
  Object.defineProperty(root,'scrollHeight',{get(){assert.equal(root.getAttribute(marker),'measure');assert.equal(root.style.getPropertyValue('--export-image-height'),'auto');return natural;}});
  const lease=owner.mount({root,stage,options:options('9:16',true)});assert.equal(lease.measure().mode,'crop');natural=200;assert.equal(lease.measure().mode,'pad');assert.equal(lease.layout.captureHeight,1920);lease.release();empty(root);empty(stage);owner.destroy();
});

test('R14-13 stage replacement invalidates old layout and late cleanup cannot touch independent or newer leases',()=>{
  const owner=createImageExportLayout(),root=element(),stage=element(),other=element(),otherStage=element();
  const first=owner.mount({root,stage,options:options()}),second=owner.mount({root:other,stage:otherStage,options:options('16:9')});
  assert.throws(()=>owner.mount({root,stage:element(),options:options()}),/overlap/);
  const replacement=owner.mount({root:element(1200),stage,options:options('1:1')});replacement.measure();first.release();
  assert.throws(()=>first.measure(),e=>e.reason==='destroyed');assert.equal(stage.style.getPropertyValue('--export-image-height'),'1200px');assert.equal(other.style.getPropertyValue('--export-image-width'),'1920px');
  replacement.release();empty(root);empty(stage);owner.mount({root,stage,options:options()}).release();second.release();owner.destroy();
});

test('R14-13 missing DOM capabilities and cross-document roots are rejected before layout projection',()=>{
  const owner=createImageExportLayout(),root=element(),stage=element();
  assert.throws(()=>owner.mount({root:{style:{}},stage,options:options()}),/CSS declaration/);
  root.ownerDocument={};stage.ownerDocument={};assert.throws(()=>owner.mount({root,stage,options:options()}),/one document/);empty(root);empty(stage);owner.destroy();
});

test('R14-13 construction and measurement failures preserve the original error and rollback both roots',()=>{
  for(const boundary of ['mount','read','projection']) {
    const owner=createImageExportLayout(),root=element(),stage=element(),failure=new Error(boundary);let once=true;
    const set=stage.style.setProperty.bind(stage.style);
    if(boundary==='mount')stage.style.setProperty=(...args)=>{if(once){once=false;throw failure;}return set(...args);};
    if(boundary==='mount')assert.throws(()=>owner.mount({root,stage,options:options()}),e=>e===failure);
    else {const lease=owner.mount({root,stage,options:options()});if(boundary==='read')Object.defineProperty(root,'scrollHeight',{get(){throw failure;}});
      else stage.style.setProperty=(...args)=>{if(once){once=false;throw failure;}return set(...args);};assert.throws(()=>lease.measure(),e=>e===failure);}
    empty(root);empty(stage);owner.mount({root:element(),stage,options:options()}).release();owner.destroy();
  }
});

test('R14-13 cleanup faults still release other properties and every independent stage',()=>{
  const owner=createImageExportLayout(),root=element(),stage=element(),other=element(),otherStage=element();
  owner.mount({root,stage,options:options()});owner.mount({root:other,stage:otherStage,options:options()});
  const remove=root.style.removeProperty.bind(root.style);root.style.removeProperty=name=>{if(name==='--export-image-width')throw new Error('remove fault');return remove(name);};
  assert.throws(()=>owner.destroy(),AggregateError);assert.equal(root.hasAttribute(marker),false);empty(stage);empty(other);empty(otherStage);owner.destroy();assert.throws(()=>owner.mount({}),e=>e.reason==='destroyed');
});

test('R14-13 independent idempotent destroy during a measurement prevents late projection',()=>{
  const owner=createImageExportLayout(),root=element(),stage=element();const lease=owner.mount({root,stage,options:options()});
  Object.defineProperty(root,'scrollHeight',{get(){owner.destroy();return 2500;}});
  assert.throws(()=>lease.measure(),e=>e.reason==='destroyed');empty(root);empty(stage);lease.release();owner.destroy();
});

test('R14-13 readonly scoped bridge has independent terminal unmount and preserves replacement ownership',()=>{
  const owner=createImageExportLayout(),host={},mount=mountClassicImageLayoutPort(host,owner),root=element(),stage=element();
  assert.equal(Object.isFrozen(mount.port),true);assert.equal(Object.keys(host).length,0);assert.throws(()=>mountClassicImageLayoutPort(host,owner),/already mounted/);
  const lease=mount.port.mount({root,stage,options:options()}),replacement={};Object.defineProperty(host,'markdownEditorImageLayoutPort',{value:replacement,configurable:true});mount.destroy();mount.destroy();assert.equal(host.markdownEditorImageLayoutPort,replacement);
  assert.throws(()=>mount.port.mount({}),/destroyed/);assert.equal(lease.measure().mode,'pad');lease.release();owner.mount({root,stage,options:options()}).release();owner.destroy();
});

test('R14-13 actual classic image encoding uses canonical layout for every ratio and releases all geometry',async()=>{
  for(const [ratio,width,height] of sizes) {
    const h=createExportVmHost({imageHeight:height+100}),presentation=h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort;
    h.evaluate('currentImageRatio='+JSON.stringify(ratio));h.context.document.getElementById('image-crop-fit').checked=true;
    presentation.loadDomToImage=async()=>({async toPng(root,input){assert.equal(input.width,width);assert.equal(input.height,height);assert.equal(root.getAttribute(marker),'crop');assert.equal(root.style.getPropertyValue('--export-image-font-size'),Math.round(width/36)+'px');
      assert.equal(h.taskPort.getSnapshot().activeTask.cancelable,false);assert.equal(h.context.document.getElementById('export-image-stage').style.getPropertyValue('--export-image-height'),height+'px');return 'data:image/png;base64,iVBORw0KGgo=';}});
    try{await h.invoke('renderExportImagePreview');empty(h.captureRoots.at(-1));empty(h.nodes.get('export-image-stage'));assert.equal(h.taskPort.getSnapshot().activeTask,null);assert.equal(h.imageData(),'data:image/png;base64,iVBORw0KGgo=');}finally{h.destroy();}
  }
});

test('R14-13 classic measurement, cancellation, encoder and cleanup failures finish tasks and recover',async()=>{
  for(const boundary of ['read','cancel','encoding','release']) {
    const h=createExportVmHost({sourceText:'$x^2$'}),presentation=h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort;let first=true,encodes=0;
    const create=h.context.document.createElement;
    if(boundary==='read')h.context.document.createElement=tag=>{const root=create(tag),height=root.scrollHeight;if(tag==='div')Object.defineProperty(root,'scrollHeight',{get(){if(first&&root.className==='preview-content'){first=false;throw new Error('measure failure');}return height;}});return root;};
    if(boundary==='cancel')presentation.math.renderTree=()=>{if(first){first=false;h.cancel();}};
    presentation.loadDomToImage=async()=>({async toPng(root){encodes++;if(boundary==='encoding'&&first){first=false;throw new Error('encoding failure');}
      if(boundary==='release'&&first){const remove=root.style.removeProperty.bind(root.style);root.style.removeProperty=name=>{if(first&&name==='--export-image-width'){first=false;throw new Error('release failure');}return remove(name);};}
      return 'data:image/png;base64,iVBORw0KGgo=';}});
    try{await h.invoke('renderExportImagePreview');const root=h.captureRoots.at(-1);if(boundary==='release'){assert.equal(root.hasAttribute(marker),false);assert.equal(root.style.getPropertyValue('--export-image-height'),'');assert.ok(h.calls.some(x=>x[0]==='error'&&x[1].includes('release image layout')));}else empty(root);
      empty(h.nodes.get('export-image-stage'));assert.equal(root.dataset.exportFormat,undefined);assert.equal(h.taskPort.getSnapshot().activeTask,null);assert.equal(h.imageData(),'');
      h.context.document.createElement=create;await h.invoke('renderExportImagePreview');assert.equal(h.imageData(),'data:image/png;base64,iVBORw0KGgo=');assert.equal(h.taskPort.getSnapshot().activeTask,null);assert.equal(encodes,['encoding','release'].includes(boundary)?2:1);}finally{h.destroy();}
  }
});
