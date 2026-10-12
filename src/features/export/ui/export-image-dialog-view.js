import { ModalShell } from '../../../ui/components/modal-shell.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { createSafeElement, createEventScope, requireElementRef } from '../../../ui/dom/index.js';
import { EXPORT_IMAGE_RATIOS } from '../formats/image/image-ratio-presets.js';

/** Sole image modal/options/capture-stage DOM owner; no PNG or file workflow state. */
export function createExportImageDialogView({overlayRoot,onCommand,createModalShell=(root,options)=>new ModalShell(root,options),createIcon=(documentRef,id,options)=>createIconView(documentRef,id,options)}={}) {
  requireElementRef(overlayRoot,'Image export overlay root');
  if(typeof onCommand!=='function')throw new TypeError('Image export command callback is required.');
  const doc=overlayRoot.ownerDocument;
  if(doc.getElementById('export-image-modal')||doc.getElementById('export-image-stage'))throw new Error('Image export view already mounted.');
  const node=(parent,tag,options={})=>{const element=createSafeElement(doc,tag,options);parent?.append(element);return element;};
  const root=node(null,'div',{id:'export-image-modal',className:'modal-overlay'});
  const panel=node(root,'div',{className:'modal c-modal c-modal--preview'}),header=node(panel,'div',{className:'modal-header'});
  const title=node(header,'h3',{id:'export-image-title'});title.append(createIcon(doc,'icon-image',{className:'icon icon-lg'}));
  node(title,'span',{text:'导出图片',dataset:{i18n:'exportImageTitle'}});
  const close=node(header,'button',{attributes:{type:'button','aria-label':'关闭图片导出'},dataset:{exportAction:'closeImage'}});close.append(createIcon(doc,'icon-close'));
  const body=node(panel,'div',{className:'modal-body'});node(body,'label',{text:'分享比例',dataset:{i18n:'ratioLabel'}});
  const grid=node(body,'div',{className:'ratio-grid'}),buttons=[];
  for(const [ratio,key,label]of [['9:16','ratio9_16','手机竖屏/故事'],['4:5','ratio4_5','小红书/IG'],['3:4','ratio3_4','竖图'],['1:1','ratio1_1','方形'],['16:9','ratio16_9','横图']]){
    const button=node(grid,'button',{className:'ratio-btn'+(ratio==='9:16'?' active':''),text:ratio,attributes:{type:'button'},dataset:{ratio}});
    node(button,'br');node(button,'small',{text:label,dataset:{i18n:key}});buttons.push(button);
  }
  const row=node(body,'div',{className:'option-row'}),crop=node(row,'input',{id:'image-crop-fit',attributes:{type:'checkbox'}});
  node(row,'label',{text:'过长时裁剪为固定比例（默认生成长图）',attributes:{for:'image-crop-fit'},dataset:{i18n:'cropLabel'}});
  node(body,'label',{text:'预览',dataset:{i18n:'previewLabel'}});
  const wrap=node(body,'div',{id:'export-image-preview-wrap',className:'f-export-image-preview-wrap'});
  const previewImage=node(wrap,'img',{id:'export-image-preview',className:'f-export-image-preview is-hidden',attributes:{alt:'导出预览'},dataset:{i18nAlt:'exportImagePreviewAlt'}});
  node(body,'p',{className:'hint',text:'内容较长时将按内容高度生成长图，方便手机阅读。',dataset:{i18n:'exportImageHint'}});
  const footer=node(panel,'div',{className:'modal-footer'});
  for(const [action,key,label,primary]of [['closeImage','cancel','取消',false],['renderImage','refreshPreview','刷新预览',false],['saveImage','downloadPng','下载 PNG',true]])node(footer,'button',{text:label,className:primary?'primary':'',attributes:{type:'button'},dataset:{exportAction:action,i18n:key}});
  const stage=node(null,'div',{id:'export-image-stage',className:'export-image-stage',attributes:{'aria-hidden':'true'}}),container=node(stage,'div',{id:'export-image-content'});
  const events=createEventScope();let modal,ratio='9:16',destroyed=false;
  const alive=()=>{if(destroyed)throw new Error('Image export view is destroyed.');};
  const command=(action,payload)=>{if(destroyed)return;const result=onCommand(action,payload);result?.catch?.(()=>{});};
  const cleanup=()=>{const errors=[];for(const release of [()=>events.destroy(),()=>modal?.destroy(),()=>root.remove(),()=>stage.remove()])try{release();}catch(error){errors.push(error);}return errors;};
  try {
    modal=createModalShell(root,{panel});overlayRoot.append(root,stage);
    for(const button of buttons)events.listen(button,'click',()=>command('selectRatio',{ratio:button.dataset.ratio}));
    for(const button of [close,...footer.children])events.listen(button,'click',()=>command(button.dataset.exportAction));
    events.listen(crop,'change',()=>command('renderImage'));
  }catch(error){destroyed=true;const errors=[error,...cleanup()];if(errors.length===1)throw error;throw new AggregateError(errors,'Image export view construction failed.');}
  return Object.freeze({root,stage,container,previewImage,crop,buttons:Object.freeze(buttons),
    getOptions(){alive();return Object.freeze({ratio,cropFit:Boolean(crop.checked)});},
    setRatio(value){alive();if(!Object.hasOwn(EXPORT_IMAGE_RATIOS,value))throw new TypeError('请选择有效的图片比例');ratio=value;for(const button of buttons)button.classList.toggle('active',button.dataset.ratio===ratio);},
    resetCrop(){alive();crop.checked=false;},
    open(options={}){alive();return modal.open(null,{labelledBy:title.id,initialFocus:buttons.find(button=>button.dataset.ratio===ratio),closeOnEscape:options.closeOnEscape??true,closeOnBackdrop:options.closeOnBackdrop??true});},
    close(reason='feature-close'){if(destroyed)return false;return modal.close(reason);},isOpen(){return !destroyed&&modal.isOpen();},
    destroy(){if(destroyed)return;destroyed=true;const errors=cleanup();if(errors.length)throw new AggregateError(errors,'Image export view cleanup failed.');}
  });
}
