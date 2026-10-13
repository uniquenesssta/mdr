import assert from 'node:assert/strict';
import test from 'node:test';
import { producePayload } from './support/performance-log/frontend-payload.mjs';

test('R12-14 actual runtime preserves nested structures through the desktop log adapter', async () => {
  const {entries} = await producePayload();
  assert.equal(entries.length, 3);
  const details = entries[0].details;
  assert.equal(typeof details.nested, 'object');
  assert.equal(details.nested.count, 7);
  assert.equal(details.array[0].count, 7);
  assert.equal(details.errorChain.cause.causes[0].count, 4);
  assert.equal(typeof details.errorChain.cause, 'object');
  assert.equal(typeof entries[1].details.nested, 'object');
  assert.equal(entries[1].status, 'warning');
  assert.equal(entries[2].status, 'error');
  assert.equal(entries[0].durationMs, 12.5);
});

test('R12-14 runtime bounds diagnostic containers and safely handles cycles and unsupported values', async () => {
  const {entries} = await producePayload();
  const details = entries[0].details;
  assert.equal(details.cycle.self, '[circular]');
  assert.equal(details.exceptional, '[unserializable]');
  assert.equal(details.items.length, 20);
  assert.equal(details.notFinite, null);
  assert.ok(!Object.hasOwn(details, 'invalid'));
  assert.doesNotThrow(() => JSON.stringify(entries));
});


test('R15-03 actual frontend to desktop payload contains no raw secret before Rust writes', async () => {
  const {entries, secrets} = await producePayload();
  const payload = JSON.stringify(entries);
  for (const secret of secrets) {assert.equal(payload.includes(secret), false); assert.equal(payload.includes(JSON.stringify(secret).slice(1, -1)), false);}
  for (const field of ['nested', 'encoded', 'twice']) {
    assert.equal(entries[0].details[field].count, 7);
    assert.equal(Object.hasOwn(entries[0].details[field], 'path'), false);
    assert.equal(Object.hasOwn(entries[0].details[field], 'body'), false);
    assert.equal(Object.hasOwn(entries[0].details[field], 'token'), false);
  }
  assert.equal(entries[0].details.hasDocumentPath, true);
});
