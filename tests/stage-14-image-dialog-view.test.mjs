import assert from 'node:assert/strict';import test from 'node:test';
import {createExportImageDialogView} from '../src/features/export/index.js';
import {ExportProgressDocument} from './support/export-progress-dom.mjs';
function fixture(t,extra={}){const doc=new ExportProgressDocument(),overlay=doc.createElement('div'),launcher=doc.createElement('button'),calls=[];doc.body.append(launcher,overlay);launcher.focus();const view=createExportImageDialogView({overlayRoot:overlay,onCommand:(...args)=>calls.push(args),createIcon:doc=>doc.createElement('span'),...extra});t.after(()=>view.destroy());return{doc,overlay,launcher,view,calls};}
test('R14-18 image view exclusively constructs one modal/capture stage and five ratio controls',t=>{
  const h=fixture(t);assert.throws(()=>createExportImageDialogView({overlayRoot:h.overlay,onCommand:()=>{}}),/already/);assert.equal(h.view.buttons.length,5);assert.deepEqual(h.view.getOptions(),{ratio:'9:16',cropFit:false});assert.equal(h.doc.getElementById('export-image-preview'),h.view.previewImage);
});
test('R14-18 image UI ratio/crop/save/close controls invoke commands without encoding or file effects',t=>{
  const h=fixture(t);h.view.buttons[1].dispatch('click');assert.deepEqual(h.calls[0],['selectRatio',{ratio:'4:5'}]);h.view.setRatio('4:5');h.view.crop.checked=true;h.view.crop.dispatch('change');assert.deepEqual(h.calls[1],['renderImage',undefined]);assert.deepEqual(h.view.getOptions(),{ratio:'4:5',cropFit:true});assert.throws(()=>h.view.setRatio('bad'),/图片比例/);assert.equal(h.view.getOptions().ratio,'4:5');
  const footer=h.view.root.firstElementChild.children[2];footer.children[2].dispatch('click');footer.children[0].dispatch('click');assert.deepEqual(h.calls.slice(-2),[['saveImage',undefined],['closeImage',undefined]]);
});
test('R14-18 image ModalShell owns accessibility, initial focus, Escape and return focus',t=>{
  const h=fixture(t);h.view.open();h.doc.flushFrames();assert.equal(h.doc.activeElement,h.view.buttons[0]);assert.equal(h.view.root.firstElementChild.getAttribute('role'),'dialog');h.view.root.dispatch('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});h.doc.flushFrames();assert.equal(h.view.isOpen(),false);assert.equal(h.doc.activeElement,h.launcher);
});
test('R14-18 image view independent terminal destroy removes every owned node and listener',t=>{
  const h=fixture(t);h.view.open();h.doc.flushFrames();h.view.destroy();h.view.destroy();h.view.buttons[0].dispatch('click');assert.equal(h.calls.length,0);assert.equal(h.doc.getElementById('export-image-modal'),null);assert.equal(h.doc.getElementById('export-image-stage'),null);assert.throws(()=>h.view.getOptions(),/destroyed/);
});
test('R14-18 construction event failure releases already-mounted roots and ModalShell',t=>{
  const doc=new ExportProgressDocument(),overlay=doc.createElement('div');doc.body.append(overlay);const original=doc.createElement.bind(doc);doc.createElement=tag=>{const node=original(tag);if(tag==='input')node.addEventListener=()=>{throw new Error('listener denied');};return node;};assert.throws(()=>createExportImageDialogView({overlayRoot:overlay,onCommand:()=>{},createIcon:doc=>doc.createElement('span')}),/listener denied/);assert.equal(doc.getElementById('export-image-modal'),null);assert.equal(doc.getElementById('export-image-stage'),null);
});
