import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { launchChromium } from './lib/cdp-browser.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';

test('R16-03 actual link preview retains one focus owner across consecutive opens and releases all owners on destroy', async () => {
  const host = await startBuiltApplicationHost(resolve('src'));
  let browser;
  try {
    browser = await launchChromium();
    await browser.page.navigate(host.origin + '/runtime/link-preview.js');
    const result = await browser.page.evaluate(`(async () => {
      const { createLinkPreview } = await import('/runtime/link-preview.js');
      const NativeSet = window.Set, owners = [];
      let preview;
      try {
        // Observe real private resource sets without publishing a production test API.
        window.Set = class extends NativeSet { constructor(...args) { super(...args); owners.push(this); } };
        preview = createLinkPreview({ document, window, links: { openExternal: async () => {} }, record() {}, notify() {} });
      } finally { window.Set = NativeSet; }
      const scopes = () => owners.flatMap(owner => [...owner]).filter(value => typeof value?.focusInitial === 'function');
      const counts = [];
      try {
        for (let index = 0; index < 25; index++) {
          preview.open(location.origin + '/runtime/link-preview.js?focus-probe=' + index);
          await new Promise(resolve => requestAnimationFrame(resolve));
          counts.push(scopes().length);
        }
        preview.close('probe-close');
        preview.destroy();
        return { counts, retained: scopes().length, resources: owners.reduce((sum, owner) => sum + owner.size, 0),
          overlayRemoved: !document.getElementById('link-preview-overlay'), open: preview.isOpen(), lateOpen: preview.open(location.href),
          businessGlobal: Object.hasOwn(window, 'markdownEditorLinkPreview') };
      } finally { preview.destroy(); }
    })()`);
    assert.deepEqual(result.counts, Array(25).fill(1));
    assert.deepEqual({ ...result, counts: undefined }, { counts: undefined, retained: 0, resources: 0,
      overlayRemoved: true, open: false, lateOpen: false, businessGlobal: false });
  } finally {
    try { await browser?.close(); } finally { await host.close(); }
  }
});
