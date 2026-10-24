import assert from 'node:assert/strict';
import test from 'node:test';
import { imageDataUrlToBytes, ImageDataEncodingError, isExportCancelledError } from '../src/features/export/index.js';
import { createFileSystemClient } from '../src/platform/desktop/file-system-client.js';
import { createExportVmHost } from './support/export-vm-host.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const same = (source, expected) => assert.deepEqual(Array.from(imageDataUrlToBytes(source)), expected);

const cases = [
  ['PNG signature', PNG, signature],
  ['percent binary octets', 'data:application/octet-stream,%00%80%ff%FE%7f', [0,128,255,254,127]],
  ['empty percent body', 'data:,', []],
  ['empty base64 body', 'data:;base64,', []],
  ['percent spaces', 'data:text/plain,hello%20world', Array.from(new TextEncoder().encode('hello world'))],
  ['raw Unicode pair', 'data:text/plain,汉😀𠮷', Array.from(new TextEncoder().encode('汉😀𠮷'))],
  ['percent Unicode', 'data:text/plain,%E6%B1%89%F0%9F%98%80', Array.from(new TextEncoder().encode('汉😀'))],
  ['lone high surrogate', 'data:,'+'\uD800', [239,191,189]],
  ['lone low surrogate', 'data:,'+'\uDC00', [239,191,189]],
  ['two separate surrogates', 'data:,'+'\uD800a\uDC00', [239,191,189,97,239,191,189]],
  ['mixed Unicode and binary', 'data:,😀%00%FF', [...new TextEncoder().encode('😀'),0,255]],
  ['raw BOM retained', 'data:,'+'\uFEFF', [239,187,191]],
  ['invalid UTF-8 octets retained', 'data:,%C0%AF%ED%A0%80', [192,175,237,160,128]],
  ['literal plus not a form space', 'data:,a+b', [97,43,98]],
  ['additional commas remain payload', 'data:,a,b,c', [97,44,98,44,99]],
  ['fragment excluded', 'data:,a%23b#ignored', [97,35,98]],
  ['malformed percent remains literal', 'data:,%Z0%0%', [37,90,48,37,48,37]],
  ['percent decode happens once', 'data:,%2520', [37,50,48]],
  ['percent encoded base64', 'data:;base64,%2B%2F8%3D', [251,255]],
  ['unpadded base64 two chars', 'data:;base64,/w', [255]],
  ['unpadded base64 three chars', 'data:;base64,AP8', [0,255]],
  ['ASCII whitespace base64', 'data:;base64, AP%0C8%3D ', [0,255]],
  ['case insensitive scheme/marker', 'DATA:image/png;BASE64,iVBORw0KGgo=', signature],
  ['spaces before base64 marker', 'data: image/png;  base64 ,iVBORw0KGgo=', signature],
  ['charset metadata does not transcode octets', 'data:text/plain;charset=iso-8859-1,%E9', [233]],
  ['base64 parameter is not a marker', 'data:text/plain;base64=1,AP8=', [65,80,56,61]],
  ['non-final base64 is metadata', 'data:;base64;charset=utf-8,AP8=', [65,80,56,61]]
];
for (const [name, source, expected] of cases) test('R14-15 '+name+' preserves exact byte contract', () => same(source, expected));

for (const source of [null,undefined,0,{},[], '', 'not-data', 'https://image.test/a.png', 'data:image/png', 'data:;base64,A',
  'data:;base64,AP8===','data:;base64,_w==','data:;base64,AP%008=','data:;base64,😀']) {
  test('R14-15 invalid data rejects without input coercion: '+String(source), () => {
    assert.throws(() => imageDataUrlToBytes(source), ImageDataEncodingError);
  });
}

test('R14-15 caller coercion cannot execute and every returned byte array is independent', () => {
  const hostile = { toString() { throw new Error('coerced'); } };
  assert.throws(() => imageDataUrlToBytes(hostile), ImageDataEncodingError);
  const first=imageDataUrlToBytes(PNG), second=imageDataUrlToBytes(PNG);first[0]=0;
  assert.equal(second[0],137);assert.notEqual(first.buffer,second.buffer);
});

test('R14-15 all 256 octets and long payload cross conversion chunks without loss', () => {
  const expected=Buffer.from(Array.from({length:256*1025},(_,i)=>i%256));
  const decoded=imageDataUrlToBytes('data:application/octet-stream;base64,'+expected.toString('base64'));
  assert.equal(decoded.constructor,Uint8Array);assert.deepEqual(Buffer.from(decoded),expected);
  same('data:,'+Array.from({length:256},(_,i)=>'%'+i.toString(16).padStart(2,'0')).join(''),Array.from(expected.subarray(0,256)));
});

test('R16-08 direct image byte encoding returns independent buffers without a mutable host capability', () => {
  const before = Object.getOwnPropertyNames(globalThis);
  const first = imageDataUrlToBytes(PNG), second = imageDataUrlToBytes(PNG);
  same(PNG, Array.from(second)); assert.notEqual(first, second);
  first[0] = 0; assert.equal(second[0], 137);
  assert.throws(() => imageDataUrlToBytes(null), ImageDataEncodingError);
  assert.deepEqual(Object.getOwnPropertyNames(globalThis), before);
});

test('R14-15 actual desktop adapter preserves every decoded octet at the Rust command boundary', async () => {
  const expected=Buffer.from(Array.from({length:65537},(_,i)=>i%256)),calls=[];
  const client=createFileSystemClient({invoke:async(...args)=>calls.push(args)});
  await client.writeBinaryFile('C:\\owned\\原文😀.png',imageDataUrlToBytes('data:;base64,'+expected.toString('base64')),{extension:'png',reason:'export'});
  assert.equal(calls.length,1);const [command,payload,details]=calls[0];assert.equal(command,'write_local_binary_file');
  assert.equal(payload.path,'C:\\owned\\原文😀.png');assert.deepEqual(Buffer.from(payload.contentBase64,'base64'),expected);
  assert.deepEqual(details,{extension:'png',bytes:expected.length,fileName:'原文😀.png',reason:'export'});
});

for (const desktop of [false,true]) test('R14-15 classic image command uses decoded binary output: '+(desktop?'desktop':'browser'), async () => {
  const h=createExportVmHost({desktop,name:'原文😀.md'});await h.renderImage(PNG);
  await h.invoke('downloadExportImage');const write=h.calls.find(x=>x[0]==='writeBinary');assert.ok(write);
  assert.deepEqual(Array.from(write[2]),signature);assert.equal(write[3].extension,'png');assert.equal(write[3].reason,'export');
  assert.equal(h.calls.some(x=>x[0]==='saveFile'),desktop);
  if(!desktop){assert.equal(h.downloads[0].name,'原文😀.png');assert.equal(h.downloads[0].blob.type,'image/png');
    assert.deepEqual(Array.from(new Uint8Array(await h.downloads[0].blob.arrayBuffer())),signature);
    assert.ok(h.calls.some(x=>x[0]==='revoke'&&x[1]===h.downloads[0].href));}
  h.destroy();
});

test('R14-15 invalid data fails before dialog or binary write and later valid export recovers', async () => {
  const h=createExportVmHost({desktop:true});await h.renderImage('data:image/png;base64,!');await h.invoke('downloadExportImage');
  assert.equal(h.calls.some(x=>x[0]==='saveFile'||x[0]==='writeBinary'),false);assert.ok(h.calls.some(row => ['toast','error'].includes(row[0]) && /图片数据无效/.test(row[1])));
  await h.renderImage(PNG);await h.invoke('downloadExportImage');assert.equal(h.calls.filter(x=>x[0]==='writeBinary').length,1);h.destroy();
});

test('R14-15 image bytes are fixed before save dialog even if another preview arrives', async () => {
  const h=createExportVmHost({desktop:true});await h.renderImage(PNG);
  const port=h.platform,original=port.dialogs.saveFile;
  let finish,entered;const ready=new Promise(r=>entered=r);port.dialogs.saveFile=()=>{ entered(); return new Promise(resolve=>{finish=resolve;}); };
  const work=h.invoke('downloadExportImage');await ready;const snapshot=h.imageExporter.getPreview();assert.equal(Object.isFrozen(snapshot),true);assert.throws(()=>{snapshot.dataUrl='data:;base64,AA==';},TypeError);await h.renderImage();finish('C:\\chosen.png');await work;
  assert.equal(h.calls.some(x=>x[0]==='writeBinary'),false,'Replacing a cancellable dialog task suppresses stale output');port.dialogs.saveFile=original;await h.invoke('downloadExportImage');assert.deepEqual(Array.from(h.calls.find(x=>x[0]==='writeBinary')[2]),signature);h.destroy();
});

for(const savePath of [null,'',false,123,{}]) test('R14-15 cancelled or invalid save path never writes: '+JSON.stringify(savePath), async()=>{
  const h=createExportVmHost({desktop:true,savePath});await h.renderImage(PNG);await h.invoke('downloadExportImage');
  assert.equal(h.calls.some(x=>x[0]==='writeBinary'),false);
  assert.equal(h.calls.some(x=>x[0]==='toast'&&x[1]==='toastImageDownloaded'),false);h.destroy();
});

for(const boundary of ['write','dialog','capability','destroyed-port'])test('R14-15 '+boundary+' failure has no success toast or leaked browser URL',async()=>{
  const h=createExportVmHost({desktop:boundary!=='write',failWrite:boundary==='write'});await h.renderImage(PNG);
  const port=h.platform;
  if(boundary==='dialog')port.dialogs.saveFile=async()=>{throw new Error('dialog denied');};
  if(boundary==='capability'){port.capabilities.desktop.dialogs=false;port.capabilities.desktop.fileSystem=false;port.capabilities.browser.fileDownload=false;}
  // R14-18 commands use the owner directly; unmount the actual command capability.
  if(boundary==='destroyed-port'){h.controller.destroy();await assert.rejects(async()=>h.invoke('downloadExportImage'),error=>isExportCancelledError(error)&&error.reason==='destroyed');}
  else await h.invoke('downloadExportImage');assert.equal(h.calls.some(x=>x[0]==='toast'&&x[1]==='toastImageDownloaded'),false);
  assert.equal(h.downloads.length,0);
  if(boundary==='destroyed-port')assert.equal(h.calls.some(x=>x[0]==='saveFile'||x[0]==='writeBinary'),false);
  h.destroy();
});
