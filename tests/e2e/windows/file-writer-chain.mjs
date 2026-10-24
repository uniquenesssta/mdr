import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// The child holds only a harness-owned output with Windows FileShare.None.
async function withExclusiveFile(path, script, operation) {
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Path',path],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  child.stdin.on('error',()=>{});
  let stderr='',stdout='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.setEncoding('utf8');
  const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Exclusive Windows file handle was not acquired: '+stderr)),10000);
      const finish=error=>{clearTimeout(timer);error?reject(error):resolve();};
      child.once('error',finish);child.once('exit',()=>finish(new Error('Lock helper exited before acquisition: '+stderr)));
      child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('MDR_EXPORT_LOCKED'))finish();});
    });
    return await operation();
  } finally {
    if(child.exitCode===null)child.stdin.end('release\n');
    let timer;const timeout=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('Windows lock helper did not release its handle.'));},5000);});
    try {assert.equal(await Promise.race([exited,timeout]),0,stderr);} finally {clearTimeout(timer);}
  }
}

/** All final format owners -> shared writer -> original native text/binary I/O.
 * Dialog protocol response only is automated. Writes/errors/readback are real.
 */
export async function verifyFileWriterChain({browser,ownedRoot,evidenceRoot,commit}) {
  const root=join(ownedRoot,'file-writer');await mkdir(root);
  const script=join(root,'hold-export-file.ps1');
  await writeFile(script,'param([string]$Path)\n$ErrorActionPreference="Stop"\n$handle=[System.IO.File]::Open($Path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)\ntry {[Console]::WriteLine("MDR_EXPORT_LOCKED");[Console]::Out.Flush();[Console]::ReadLine() | Out-Null} finally {$handle.Dispose()}\n');
  await browser.inspect(async()=>{
    const host=applicationCapabilities;
    if(!await host.markdownEditorDocumentUiCommandPort.invoke('importTextContent','shared-writer.md','\uFEFF# Shared Writer 原文😀\r\n\r\n公式 $x^2$\n\nKEEP WRITER TAIL',''))throw new Error('Native shared writer import failed.');
    const request=host.markdownEditorExportRequestPort.createRequest({format:'image',name:'原文.png',imageOptions:{ratio:'9:16',cropFit:false}});
    if((await host.markdownEditorImageExportPort.render({request})).status!=='ready')throw new Error('Native shared writer PNG failed.');
  });
  async function output(format,destination) {
    return browser.inspect(async(format,destination)=>{
      const host=applicationCapabilities,internals=window.__TAURI_INTERNALS__;
      const owners={markdown:host.markdownEditorMarkdownExportPort,html:host.markdownEditorHtmlExportPort,word:host.markdownEditorWordExportPort,image:host.markdownEditorImageExportPort};
      const request=host.markdownEditorExportRequestPort.createRequest({format,name:'统一输出😀.txt',imageOptions:format==='image'?{ratio:'9:16',cropFit:false}:undefined});
      const original=window.fetch,descriptor=Object.getOwnPropertyDescriptor(window,'fetch'),invoke=internals.invoke;
      const dialog=internals.convertFileSrc('plugin:dialog|save','ipc'),textUrl=internals.convertFileSrc('write_local_text_file','ipc'),binaryUrl=internals.convertFileSrc('write_local_binary_file','ipc');
      let dialogs=0,payloads=[];
      const wrapped=(url,options)=>{
        if(url===dialog&&options?.method==='POST'){dialogs++;return Promise.resolve(new Response(JSON.stringify(destination),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));}
        if((url===textUrl||url===binaryUrl)&&options?.method==='POST')payloads.push({binary:url===binaryUrl,payload:JSON.parse(options.body)});
        return original.call(window,url,options);
      };
      if(!Reflect.set(window,'fetch',wrapped)||window.fetch!==wrapped)throw new Error('Dialog response automation unavailable.');
      try {
        let result=null,error=null;
        try {result=await (format==='image'?owners[format].save({request}):owners[format].export({request}));}
        catch(failure){error=String(failure?.message||failure);}
        return {result,error,dialogs,payloads,taskReleased:host.markdownEditorExportTaskPort.getSnapshot().activeTask===null,invokeUnchanged:internals.invoke===invoke};
      } finally {
        if(window.fetch===wrapped){if(descriptor)Object.defineProperty(window,'fetch',descriptor);else delete window.fetch;}
        if(window.fetch!==original||internals.invoke!==invoke)throw new Error('Shared native writer transport restoration failed.');
      }
    },format,destination);
  }
  const observations=[];
  for(const [format,extension]of [['markdown','md'],['html','html'],['word','doc'],['image','png']]) {
    const destination=join(root,'共享保存😀.'+extension),initial=await output(format,destination);
    assert.equal(initial.error,null);assert.equal(initial.result.status,'written');assert.equal(initial.dialogs,1);assert.equal(initial.payloads.length,1);
    const payload=initial.payloads[0],expected=payload.binary?Buffer.from(payload.payload.contentBase64,'base64'):Buffer.from(payload.payload.content,'utf8');
    assert.equal(payload.payload.path,destination);assert.deepEqual(await readFile(destination),expected);
    if(payload.binary)assert.deepEqual(Array.from(expected.subarray(0,8)),[137,80,78,71,13,10,26,10]);
    else {assert.ok(expected.toString('utf8').includes('KEEP WRITER TAIL'));assert.ok(expected.toString('utf8').includes('Shared Writer 原文'));}
    await writeFile(join(evidenceRoot,'r14-17-native-writer.'+extension),expected);
    const cancel=await output(format,null);assert.equal(cancel.result.status,'cancelled');assert.equal(cancel.error,null);assert.equal(cancel.payloads.length,0);assert.equal(cancel.dialogs,1);
    const sentinel=Buffer.from('OWNED ORIGINAL '+format+' 😀\r\n');await writeFile(destination,sentinel);
    const failure=await withExclusiveFile(destination,script,()=>output(format,destination));
    assert.ok(failure.error);assert.equal(failure.result,null);assert.equal(failure.payloads.length,1);assert.deepEqual(await readFile(destination),sentinel);
    const recovered=await output(format,destination);assert.equal(recovered.result.status,'written');assert.equal(recovered.error,null);assert.deepEqual(await readFile(destination),expected);
    for(const state of [initial,cancel,failure,recovered]){assert.equal(state.taskReleased,true);assert.equal(state.invokeUnchanged,true);}
    const siblings=await readdir(root);assert.ok(siblings.every(name=>name==='hold-export-file.ps1'||/^共享保存😀\.(md|html|doc|png)$/.test(name)),'Native writer leaked an owned temporary file.');
    observations.push({format,byteLength:expected.length,sha256:createHash('sha256').update(expected).digest('hex'),exactBytes:true,cancelledQuietly:true,exclusiveHandleFailure:true,originalPreserved:true,recovered:true,noTemporaryLeak:true});
  }
  return {commit,status:'passed',transport:'actual final format -> shared File Writer -> unchanged Platform/Rust -> real Windows readback',dialogBoundary:'Only save protocol result automated; interactive user path selection not claimed.',observations};
}
