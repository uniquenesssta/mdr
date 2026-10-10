import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createExportStyleSheet, mountClassicExportStylePort } from '../src/features/export/index.js';
import { ExportProgressDocument } from './support/export-progress-dom.mjs';
import { createExportVmHost } from './support/export-vm-host.mjs';

const mathCss = readFileSync(join(dirname(createRequire(import.meta.url).resolve('katex')), 'katex.css'), 'utf8');
function harness() {
  const doc = new ExportProgressDocument(); doc.head = doc.createElement('head');
  const owner = createExportStyleSheet({ documentRef: doc, mathCss });
  return { doc, owner, root: doc.createElement('div') };
}

for (const format of ['html', 'word', 'pdf', 'image']) {
  test(`R14-08 ${format} has complete shared math/code/task/table/diagram rules and its format profile`, () => {
    const h = harness(), css = h.owner.getCss(format);
    assert.ok(css.includes(`data-export-format="${format}"`));
    for (const selector of ['.katex-mathml', '.katex-html', '.katex-display', '.preview-code-row', '.markdown-code-token-keyword', '.task-list', '.export-document table', 'svg.f-mermaid-svg']) assert.ok(css.includes(selector), selector);
    assert.doesNotMatch(css, /@font-face|url\(["']?fonts\//);
    if (format !== 'image') assert.doesNotMatch(css, /var\(--export-/);
    assert.equal(h.doc.head.children.length, 0, 'Standalone CSS serialization has no live DOM side effects.');
    h.owner.destroy();
  });
}

test('R14-08 uses the locked vendor layout byte-for-byte except font packaging, preserving accessible MathML', () => {
  const h = harness();
  const layout = mathCss.replace(/@font-face\s*\{[^}]*\}/g, '');
  for (const format of ['html', 'word', 'pdf']) {
    const css = h.owner.getCss(format);
    assert.ok(css.startsWith(layout));
    assert.match(css, /\.katex-mathml\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/);
    assert.doesNotMatch(css, /\.katex-mathml\s*\{[^}]*display:\s*none/);
  }
  h.owner.destroy();
});

test('R14-08 raster-only profile hides the auxiliary representation without rewriting math DOM', () => {
  const h = harness(); h.root.textContent = 'math DOM stays';
  const before = h.root.textContent, lease = h.owner.apply(h.root, 'image');
  assert.match(h.owner.getCss('image'), /data-export-format="image"[^}]*\.katex-mathml\s*\{\s*display:\s*none\s*!important/);
  assert.equal(h.root.textContent, before); lease.release(); h.owner.destroy();
});

test('R14-08 rejects unknown formats before live mutation', () => {
  const h = harness();
  for (const format of ['markdown', '<style>', null, {}, 'HTML']) {
    assert.throws(() => h.owner.getCss(format), TypeError);
    assert.throws(() => h.owner.apply(h.root, format), TypeError);
  }
  assert.equal(h.doc.head.children.length, 0); assert.equal(h.root.className, ''); h.owner.destroy();
});

test('R14-08 rejects missing or unsafe vendor stylesheet text', () => {
  for (const mathCss of [undefined, null, '', ' ', '</style><script>bad()</script>']) assert.throws(() => createExportStyleSheet({ mathCss }), TypeError);
});

test('R14-08 mounts one shared live stylesheet and leaves unrelated roots unchanged', () => {
  const h = harness(), other = h.doc.createElement('div'); other.className = 'preview-content';
  const a = h.owner.apply(h.root, 'image'), b = h.owner.apply(h.doc.createElement('div'), 'pdf');
  assert.equal(h.doc.head.children.length, 1); assert.equal(h.doc.head.children[0].dataset.exportStyleSheet, 'document');
  assert.equal(other.className, 'preview-content'); assert.equal(other.dataset.exportFormat, undefined);
  assert.equal(h.doc.head.children[0].textContent.includes('@font-face'), false);
  a.release(); b.release(); assert.equal(h.doc.head.children.length, 1); h.owner.destroy();
});

test('R14-08 release restores preexisting class and format and is idempotent', () => {
  const h = harness(); h.root.className = 'markdown-body export-document'; h.root.dataset.exportFormat = 'prior';
  const lease = h.owner.apply(h.root, 'pdf'); assert.equal(h.root.dataset.exportFormat, 'pdf');
  lease.release(); lease.release(); assert.equal(h.root.dataset.exportFormat, 'prior'); assert.equal(h.root.className, 'markdown-body export-document'); h.owner.destroy();
});

test('R14-08 a superseded lease cannot undo the current root profile', () => {
  const h = harness(); h.root.className = 'markdown-body';
  const old = h.owner.apply(h.root, 'image'), current = h.owner.apply(h.root, 'pdf');
  old.release(); assert.equal(h.root.dataset.exportFormat, 'pdf'); assert.equal(h.root.classList.contains('export-document'), true);
  current.release(); assert.equal(h.root.className, 'markdown-body'); assert.equal(h.root.dataset.exportFormat, undefined); h.owner.destroy();
});

test('R14-08 concurrent root leases release independently', () => {
  const h = harness(), other = h.doc.createElement('div');
  const a = h.owner.apply(h.root, 'pdf'), b = h.owner.apply(other, 'image');
  a.release(); assert.equal(h.root.className, ''); assert.equal(other.dataset.exportFormat, 'image');
  b.release(); assert.equal(other.className, ''); h.owner.destroy();
});

test('R14-08 owner destroy removes its stylesheet, restores every root and rejects late work', () => {
  const h = harness(), other = h.doc.createElement('div'), unrelated = h.doc.createElement('style'); h.doc.head.append(unrelated);
  const lease = h.owner.apply(h.root, 'pdf'); h.owner.apply(other, 'image');
  h.owner.destroy(); h.owner.destroy(); lease.release();
  assert.deepEqual(h.doc.head.children, [unrelated]); assert.equal(h.root.className, ''); assert.equal(other.dataset.exportFormat, undefined);
  assert.throws(() => h.owner.getCss('html'), /destroyed/); assert.throws(() => h.owner.apply(h.root, 'image'), /destroyed/);
});

test('R14-08 invalid and foreign roots never create a live stylesheet', () => {
  const h = harness(), other = new ExportProgressDocument();
  for (const root of [null, {}, { classList: {}, dataset: {} }, other.createElement('div')]) assert.throws(() => h.owner.apply(root, 'image'), TypeError);
  assert.equal(h.doc.head.children.length, 0); h.owner.destroy();
});

test('R14-08 mounting failure leaves the root intact and the owner can retry', () => {
  const h = harness(), append = h.doc.head.appendChild;
  h.doc.head.appendChild = () => { throw new Error('mount denied'); };
  assert.throws(() => h.owner.apply(h.root, 'image'), /mount denied/); assert.equal(h.root.className, '');
  h.doc.head.appendChild = append; h.owner.apply(h.root, 'image'); assert.equal(h.doc.head.children.length, 1); h.owner.destroy();
});

test('R14-08 scoped port validates required capabilities and rejects duplicate mounts', () => {
  const h = harness(), host = {};
  for (const owner of [null, {}, { getCss() {} }]) assert.throws(() => mountClassicExportStylePort(host, owner), TypeError);
  const mount = mountClassicExportStylePort(host, h.owner);
  assert.equal(Object.isFrozen(mount.port), true); assert.equal(Object.keys(host).length, 0);
  assert.throws(() => mountClassicExportStylePort(host, h.owner), /already mounted/);
  assert.equal(mount.port.getCss('html'), h.owner.getCss('html'));
  const lease = mount.port.apply(h.root, 'image'); assert.equal(Object.isFrozen(lease), true); lease.release();
  mount.destroy(); mount.destroy(); assert.equal(Object.hasOwn(host, 'markdownEditorExportStylePort'), false);
  assert.throws(() => mount.port.getCss('html'), /destroyed/); assert.throws(() => mount.port.apply(h.root, 'pdf'), /destroyed/);
  assert.ok(h.owner.getCss('word')); h.owner.destroy();
});

test('R14-08 port unmount preserves a replacement host property', () => {
  const h = harness(), host = {}, mount = mountClassicExportStylePort(host, h.owner), replacement = {};
  Object.defineProperty(host, 'markdownEditorExportStylePort', { value: replacement, configurable: true });
  mount.destroy(); assert.equal(host.markdownEditorExportStylePort, replacement); h.owner.destroy();
});

for (const [format, operation] of [['html', 'exportHTML'], ['word', 'exportWord']]) {
  test(`R14-08 actual classic ${format} caller serializes the authoritative public stylesheet`, async () => {
    const h = createExportVmHost();
    try {
      await h.invoke(operation); const text = await h.downloads[0].blob.text();
      assert.ok(text.includes('<style>' + h.styles.getCss(format) + '</style>'));
      assert.ok(text.includes(`<body class="export-document" data-export-format="${format}">`));
      assert.equal(h.context.document.head.children.length, 0); assert.equal(h.taskPort.getSnapshot().activeTask, null);
    } finally { h.destroy(); }
  });
}

test('R14-08 actual PDF caller releases document styles on afterprint and fallback', async () => {
  for (const boundary of ['afterprint', 'fallback']) {
    const h = createExportVmHost();
    try {
      await h.invoke('exportPDF'); const root = h.context.preview.children[0];
      assert.equal(root.dataset.exportFormat, 'pdf'); h.timers[0].callback();
      if (boundary === 'afterprint') h.events.get('afterprint')(); else h.timers.at(-1).callback();
      assert.equal(root.dataset.exportFormat, undefined); assert.equal(root.classList.contains('export-document'), false);
      assert.equal(h.taskPort.getSnapshot().activeTask, null);
    } finally { h.destroy(); }
  }
});

test('R14-08 actual image caller applies styles through encoding and releases on success, failure and cancellation', async () => {
  for (const boundary of ['success', 'failure', 'cancelled']) {
    const h = createExportVmHost({ sourceText: '$x^2$' }); let encoded = false;
    const presentation = h.context.document.getElementById('compatibility-business-ports').markdownEditorPresentationPort;
    presentation.loadDomToImage = async () => ({ async toPng(root) {
      encoded = true; assert.equal(root.dataset.exportFormat, 'image'); assert.equal(root.classList.contains('export-document'), true);
      if (boundary === 'failure') throw new Error('encoding failed');
      return 'data:image/png;base64,iVBORw0KGgo=';
    } });
    if (boundary === 'cancelled') presentation.math.renderTree = () => h.cancel();
    try {
      await h.invoke('renderExportImagePreview'); const root = h.nodes.get('export-image-content').children[0];
      assert.equal(encoded, boundary !== 'cancelled'); assert.equal(root.dataset.exportFormat, undefined);
      assert.equal(root.classList.contains('export-document'), false); assert.equal(h.taskPort.getSnapshot().activeTask, null);
    } finally { h.destroy(); }
  }
});
