import test from 'node:test';
import assert from 'node:assert/strict';
import { mountClassicPreviewRendererPort } from '../../../src/features/preview/compatibility/classic-preview-renderer-port.js';

const methods = [
  'patchHtml','patchBlocks','createBlockNodes','applyBlockSourceRange',
  'renderTaskLists','renderCode','renderMath','renderMermaid'
];

test('Atomic 7.8 classic Preview Renderer Port is scoped, forwards calls and unmounts exactly itself', async () => {
  const calls = [];
  const renderer = Object.fromEntries(methods.map(method => [method, (...args) => { calls.push({ method, args }); return method === 'renderMermaid' ? Promise.resolve('ok') : method; }]));
  const host = {};
  const mount = mountClassicPreviewRendererPort(host, renderer);
  assert.equal(host.markdownEditorPreviewRendererPort.renderCode(['root']), 'renderCode');
  assert.equal(await host.markdownEditorPreviewRendererPort.renderMermaid(['root'], () => false), 'ok');
  assert.deepEqual(calls.map(call => call.method), ['renderCode', 'renderMermaid']);
  const foreign = host.markdownEditorPreviewRendererPort;
  mount.destroy();
  assert.equal(host.markdownEditorPreviewRendererPort, undefined);
  assert.throws(() => foreign.renderMath([]), /destroyed/);
});
