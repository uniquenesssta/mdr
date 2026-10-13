import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createTelemetryRecorder, redactTelemetryDetails, redactTelemetryLabel, redactTelemetryIdentity } from '../src/features/telemetry/index.js';
import { createTelemetryRuntimeHost } from './support/telemetry-runtime-host.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
function recorder(extra = {}) {
  const entries = [], groups = [];
  const api = createTelemetryRecorder({ sessionId: 'privacy-fixture', now: () => 1000, monotonicNow: () => 5,
    emit: value => entries.push(value), aggregate: (operation, options) => groups.push({operation, options}), ...extra });
  return {api, entries, groups};
}

test('R15-03 pure redaction is the sole details owner and all retained runtime diagnostics use minimized hints', () => {
  const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const pure = source('src/features/telemetry/telemetry-redaction.js');
  assert.doesNotMatch(pure, /\b(?:window|document|setTimeout|setInterval|fetch)\s*[.(]|node:fs|writePerformance/);
  assert.match(source('src/features/telemetry/performance-recorder.js'), /redactTelemetryDetails as safeDetails/);
  assert.doesNotMatch(source('src/features/telemetry/performance-recorder.js'), /function safeDetails|new WeakSet/);
  const runtime = source('src/runtime/performance.js');
  assert.match(runtime, /const key = redactTelemetryIdentity/); assert.match(runtime, /const fingerprint = redactTelemetryIdentity/);
});

for (const key of ['body', 'responseBody', 'content', 'html', 'documentText', 'markdown', 'authToken', 'apiKey', 'password', 'filePath', 'paths', 'filename']) {
  test('R15-03 recursively removes private field ' + key + ' before output', () => {
    const f = recorder(); f.api.record('fixture', {details: {nested: {[key]: 'PRIVATE', count: 2}, array: [{[key]: 'PRIVATE', count: 3}]}});
    assert.deepEqual(plain(f.entries[0].details), {nested: {count: 2}, array: [{count: 3}]});
  });
}
for (const value of ['C:\\PrivateRoot\\note.md', '/private/root/note.md', '\\\\server\\share\\note.md', 'data:image/png;base64,PRIVATE', '<p>PRIVATE</p>', '# PRIVATE', 'ordinary PRIVATE prose']) {
  test('R15-03 unclassified free text ' + value.slice(0, 12) + ' is withheld regardless of field name', () => {
    const f = recorder(); f.api.record('fixture', {details: {unexpected: value, items: [value]}});
    assert.deepEqual(plain(f.entries[0].details), {unexpected: '[redacted]', items: ['[redacted]']});
  });
}

test('R15-03 structured and double encoded JSON retain metrics while stripping nested paths/body/secrets', () => {
  const nested = {body: 'PRIVATE', path: '/private/file', token: 'PRIVATE', count: 7};
  const d = redactTelemetryDetails({encoded: JSON.stringify(nested), twice: JSON.stringify(JSON.stringify(nested))});
  assert.deepEqual(plain(d), {encoded: {count: 7}, twice: {count: 7}});
});

test('R15-03 oversized and invalid encoded text fails closed without retaining a truncated secret', () => {
  const d = redactTelemetryDetails({large: 'PRIVATE'.repeat(3000), invalid: '{"body":"PRIVATE'});
  assert.deepEqual(plain(d), {large: '[redacted]', invalid: '[redacted]'});
});

test('R15-03 safe scalar metrics and exact enums survive while enum impersonation is redacted', () => {
  const d = redactTelemetryDetails({contentLength: 2048, textLength: 12, bodyBytes: 30, hasDocumentPath: true,
    contentType: 'text/html', mode: 'hybrid', side: 'editor', origin: 'user', status: 'rendered', extension: 'png',
    unknown: 'editor', nested: {mode: '<p>PRIVATE</p>'}, bad: Infinity});
  assert.equal(d.hasDocumentPath, true); assert.equal(d.contentLength, 2048); assert.equal(d.textLength, 12); assert.equal(d.bodyBytes, 30);
  for (const [key, value] of Object.entries({contentType:'text/html', mode:'hybrid', side:'editor', origin:'user', status:'rendered', extension:'png'})) assert.equal(d[key], value);
  assert.equal(d.unknown, '[redacted]'); assert.equal(d.nested.mode, '[redacted]'); assert.equal(d.bad, null);
});

test('R15-03 private getters are not read and hostile field names never become log keys', () => {
  let reads = 0; const details = Object.defineProperty({count: 3, '<p>PRIVATE</p>': 2}, 'body', {enumerable: true, get() {reads++; throw new Error('PRIVATE');}});
  assert.deepEqual(plain(redactTelemetryDetails(details)), {count:3}); assert.equal(reads, 0);
});

test('R15-03 prototype-shaped keys do not invoke inherited enum methods or mutate prototypes', () => {
  const d = redactTelemetryDetails(JSON.parse('{"__proto__":"PRIVATE","constructor":"PRIVATE","count":2}'));
  assert.equal(Object.getPrototypeOf(d), null); assert.equal(d.__proto__, '[redacted]'); assert.equal(d.constructor, '[redacted]'); assert.equal(d.count, 2);
});

test('R15-03 cycles depth keys arrays and decoded nesting remain bounded and repeat redaction is stable', () => {
  const cycle = {}; cycle.self = cycle;
  let deep = {body:'PRIVATE', count:1}; for (let i=0;i<20;i++) deep={child:deep};
  const d=redactTelemetryDetails({cycle, deep, array:Array(30).fill({body:'PRIVATE', count:1}), many:Object.fromEntries(Array.from({length:100},(_,i)=>['metric'+i,i]))});
  assert.equal(d.cycle.self,'[circular]'); assert.equal(d.array.length,20); assert.ok(Object.keys(d.many).length<=64);
  assert.ok(JSON.stringify(d).includes('[truncated]')); assert.equal(JSON.stringify(d).includes('PRIVATE'),false);
  assert.deepEqual(plain(redactTelemetryDetails(d)), plain(d));
});

for (const aggregate of [false, true]) {
  test('R15-03 ' + (aggregate?'aggregate':'normal') + ' port receives only detached safe fields', () => {
    const f=recorder(), details={body:'PRIVATE', count:2};
    f.api.record('fixture',{aggregate,details,rawBody:'PRIVATE',fingerprint:'PRIVATE'});details.count=9;
    const value=aggregate?f.groups[0].options:f.entries[0];
    assert.equal(value.details.count,2); assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
    assert.equal(Object.hasOwn(value,'rawBody'),false); assert.equal(Object.hasOwn(value,'fingerprint'),false);
  });
}

test('R15-03 malformed envelope paths/HTML/Data URLs are minimized while code-shaped custom labels remain open', () => {
  const f=recorder(); f.api.record('/private/note',{category:'<p>PRIVATE</p>',status:'data:text/plain,PRIVATE'});
  assert.equal(f.entries[0].operation,'[redacted]');assert.equal(f.entries[0].category,'[redacted]');assert.equal(f.entries[0].status,'[redacted]');
  assert.equal(redactTelemetryLabel('future.operation'),'future.operation');
  assert.throws(()=>recorder({sessionId:'/private/path'}),/sessionId/);
});

test('R15-03 dedupe hints retain bounded stable opaque identity without raw filenames or error prose', () => {
  const a=redactTelemetryIdentity('/private/path PRIVATE',240), b=redactTelemetryIdentity('/private/other PRIVATE',240);
  assert.equal(a,redactTelemetryIdentity('/private/path PRIVATE',240));assert.notEqual(a,b);assert.match(a,/^identity-[a-f0-9]{16}$/);
});

test('R15-03 actual Runtime diagnostic aggregate and measured-error paths redact before desktop batches', async t => {
  const h=createTelemetryRuntimeHost({enabled:false});t.after(()=>h.dispose());
  h.api.diagnostic('runtime.error',{dedupeKey:'/private/path',fingerprint:'PRIVATE',details:{body:'PRIVATE',count:1}});
  h.api.record('interaction.input.frame',{aggregate:true,details:{html:'<p>PRIVATE</p>',valueLength:8}});
  const error=new Error('PRIVATE /private/path');assert.throws(()=>h.api.measure('runtime.error',()=>{throw error;}),e=>e===error);
  h.api.drainAggregates();h.configure(true);await h.api.flush();
  assert.equal(h.entries().length,3);assert.equal(JSON.stringify(h.entries()).includes('PRIVATE'),false);assert.equal(JSON.stringify(h.entries()).includes('/private/'),false);
  assert.equal(h.entries().find(x=>x.operation==='interaction.input.frame').details.valueLength,8);
});


test('R15-03 boolean presence getters are read once and cannot substitute raw text on a second access', () => {
  let reads=0;const details=Object.defineProperty({},'hasDocumentPath',{enumerable:true,get(){return ++reads===1?true:'PRIVATE';}});
  assert.deepEqual(plain(redactTelemetryDetails(details)),{hasDocumentPath:true});assert.equal(reads,1);
});

test('R15-03 aggregate duration objects are converted to numeric metrics rather than retained raw', () => {
  const f=recorder();f.api.record('fixture',{aggregate:true,durationMs:{body:'PRIVATE',valueOf:()=>7}});
  assert.equal(f.groups[0].options.durationMs,7);assert.equal(JSON.stringify(f.groups).includes('PRIVATE'),false);
});
