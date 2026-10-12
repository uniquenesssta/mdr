import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Actual WebView PNG -> final exporter -> Platform/Rust -> real file readback.
 * Only the native save-dialog result is automated, to the harness-owned root;
 * renderer, encoding, binary transport and safe writer remain unmodified.
 */
export async function verifyImageExportChain({ browser, ownedRoot, commit }) {
  const destination=join(ownedRoot,'完整图片😀.png'),blocked=join(ownedRoot,'image-export-directory.png');
  await mkdir(blocked);
  const result=await browser.execute(async (destination,blocked) => {
    const host=document.getElementById('compatibility-business-ports'),commands=host.markdownEditorDocumentUiCommandPort;
    const source='# Windows完整图片😀\n\n原文与公式 $x^2$\n\nKEEP NATIVE TAIL';
    if(!await commands.invoke('importTextContent','image-export-native.md',source,''))throw new Error('Real native document import failed.');
    const images=host.markdownEditorImageExportPort,requests=host.markdownEditorExportRequestPort,tasks=host.markdownEditorExportTaskPort;
    const request=requests.createRequest({format:'image',name:'完整图片😀.md',imageOptions:{ratio:'9:16',cropFit:false}});
    const rendered=await images.render({request});if(rendered.status!=='ready')throw new Error('Actual native PNG was not rendered.');
    const png=images.getPreview().dataUrl,image=new Image();image.src=png;await image.decode();
    const dimensions={width:image.naturalWidth,height:image.naturalHeight};
    const internals=window.__TAURI_INTERNALS__,descriptor=Object.getOwnPropertyDescriptor(internals,'invoke'),original=internals.invoke;
    let selected=destination,dialogs=0;
    const automatedInvoke=(command,args,options)=>{
      if(command==='plugin:dialog|save'){dialogs++;return Promise.resolve(selected);}
      return original.call(internals,command,args,options);
    };
    if(!Reflect.set(internals,'invoke',automatedInvoke))throw new Error('Owned native harness cannot automate save-dialog result.');
    try {
      const written=await images.save({request});if(written.status!=='written')throw new Error('Actual final image writer did not write.');
      selected=blocked;let directoryRejected=false;
      try{await images.save({request});}catch{directoryRejected=true;}
      selected=destination;const recovered=await images.save({request});
      const beforeStaleDialogs=dialogs;host.markdownEditorEditorControllerPort.setText('# Changed native image source');
      let staleRejected=false;try{await images.save({request});}catch(error){staleRejected=error.reason==='document-changed';}
      return {png,dimensions,directoryRejected,recovered:recovered.status==='written',staleRejected,
        staleDialogDelta:dialogs-beforeStaleDialogs,dialogs,captureReleased:document.getElementById('export-image-content').children.length===0,
        taskReleased:tasks.getSnapshot().activeTask===null,cacheCleared:images.getPreview()===null};
    } finally {
      if(internals.invoke===automatedInvoke){if(descriptor)Object.defineProperty(internals,'invoke',descriptor);else delete internals.invoke;}
    }
  },destination,blocked);
  const bytes=await readFile(destination);assert.deepEqual(bytes,Buffer.from(result.png.split(',')[1],'base64'));
  assert.deepEqual(Array.from(bytes.subarray(0,8)),[137,80,78,71,13,10,26,10]);assert.ok(bytes.length>100);
  assert.deepEqual(result.dimensions,{width:1080,height:1920});assert.equal(result.dialogs,3);assert.equal(result.staleDialogDelta,0);
  for(const key of ['directoryRejected','recovered','staleRejected','captureReleased','taskReleased','cacheCleared'])assert.equal(result[key],true,key);
  const {png,...observations}=result;
  return {commit,status:'passed',transport:'actual WebView PNG -> final Image Exporter -> actual Platform/Rust safe writer -> real file readback',
    automatedBoundary:'Only native save dialog returns harness-owned paths; no actual interactive dialog acceptance claimed.',
    byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),exactBytes:true,...observations};
}
