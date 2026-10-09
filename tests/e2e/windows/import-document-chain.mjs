import assert from 'node:assert/strict';
import { join } from 'node:path';

// Drive production UI and public document commands in the real embedded Windows WebView.
// Native HTTP uses the existing Rust command/transport/response pipeline in the archived host.
export async function verifyImportDocumentChain({ browser, fixtureOrigin, filePath, missingPath, requests, evidenceRoot, diagnostics = {} }) {
  const observations = [];
  diagnostics.observations = observations;
  diagnostics.renders = [];
  const baseHref = await browser.execute(() => location.href);
  const fingerprint = () => browser.execute(() => {
    const host = document.getElementById('compatibility-business-ports');
    const documents = host.markdownEditorDocumentControllerPort;
    return { documentId: documents.activeId, records: documents.records.length,
      text: window.markdownEditorDocumentModel.createSnapshot('r13-chain-observation') };
  });
  const startFetch = url => browser.execute(value => {
    if (typeof window.openUrlModal !== 'undefined') throw new Error('Classic import global remains.');
    document.querySelector('#file-menu-dropdown .menu-trigger').click();
    const command = document.querySelector('[data-menu-command="import.web"]');
    if (!command || command.hasAttribute('onclick')) throw new Error('Owned Import menu command is missing or inline.');
    command.click();
    const input = document.getElementById('url-input');
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-clipper-fetch]').click();
  }, url);
  const waitStatus = success => browser.waitUntil(() => browser.execute(expected =>
    document.getElementById('url-status').classList.contains(expected ? 'is-success' : 'is-error'), success),
  { timeout: 35_000, timeoutMsg: 'Native clipper did not publish its explicit fetch outcome.' });
  const close = () => browser.execute(() => document.querySelector('[data-clipper-close]').click());

  await browser.execute(() => {
    const host = document.getElementById('compatibility-business-ports');
    host.markdownEditorDocumentControllerPort.initializeEmptySession({ legacyRecords: [] });
    window.__r12Probe = { events: [], ipcAttempted: false, ipc: null, cspViolations: [] };
  });
  const empty = await fingerprint();
  assert.equal(empty.records, 0); assert.equal(empty.text, '');
  await startFetch(fixtureOrigin + '/r13/non-html'); await waitStatus(false);
  await browser.execute(() => document.querySelector('[data-clipper-insert]').click());
  assert.deepEqual(await fingerprint(), empty, 'Rejected response created a blank document.');
  await close(); observations.push({ scenario: 'fetch-failure-no-document', passed: true });

  await startFetch(fixtureOrigin + '/r13/slow');
  await browser.waitUntil(() => requests.some(item => item.marker === '/r13/slow'), { timeout: 10_000 });
  await close();
  // Wait past the owned delayed body, then challenge the old insert button.
  await browser.execute(async () => { await new Promise(done => setTimeout(done, 1_400));
    document.querySelector('[data-clipper-insert]').click(); });
  assert.deepEqual(await fingerprint(), empty, 'Cancelled fetch published its late body.');
  observations.push({ scenario: 'fetch-cancel-late-result', passed: true });

  await startFetch(fixtureOrigin + '/r13/article'); await waitStatus(true);
  await browser.execute(() => {
    document.querySelector('[data-clipper-insert]').click();
    document.querySelector('[data-clipper-insert]').click();
  });
  const imported = await fingerprint();
  assert.equal(imported.records, 1, 'Successful clipping must lazily create one Documents record.');
  assert.match(imported.text, /R13 imported article/);
  assert.equal(imported.text.match(/R13 imported article/g).length, 1, 'Duplicate insert mutated twice.');
  assert.doesNotMatch(imported.text, /onclick=|onerror=|javascript:|<script|__TAURI_INTERNALS__/i);
  assert.ok(requests.some(item => item.marker === '/r13/article' && item.nativeBrowserHeaders), 'No real Rust HTTP control request.');

  async function inspectModes(source, requireImage) {
    for (const mode of ['both', 'hybrid']) {
      await browser.execute(async layout => {
        const host = document.getElementById('compatibility-business-ports');
        document.getElementById('editor').virtualEditor.setSelection(0, 0);
        host.markdownEditorEditorUiCommandPort.invoke('setLayoutMode', layout);
        if (layout === 'both') await host.markdownEditorPreviewCommandPort.update();
      }, mode);
      const selector = mode === 'both' ? '#preview' : '#editor';
      const renderObservation = { source, mode, status: 'waiting' };
      diagnostics.renders.push(renderObservation);
      try {
        await browser.waitUntil(async () => {
          renderObservation.snapshot = await browser.execute((rootSelector, needsImage) => {
            const root = document.querySelector(rootSelector);
            const image = root?.querySelector('img[alt="owned import image"]');
            const host = document.getElementById('compatibility-business-ports');
            const preview = host.markdownEditorPreviewCommandPort.snapshot;
            return {
              checks: {
                markdown: Boolean(root?.textContent.includes('R13 harmless import text')),
                math: Boolean(root?.querySelector('.katex')),
                mermaid: Boolean(root?.querySelector('[data-mermaid-rendered="true"] svg')),
                strong: Boolean(root?.querySelector('strong, .cm-hybrid-strong')),
                image: !needsImage || Boolean(image?.complete && image.naturalWidth > 0),
                htmlProbe: !needsImage || Boolean(root?.querySelector('[data-r12-probe]'))
              },
              image: image ? { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } : null,
              fences: [...(root?.querySelectorAll('pre > code.language-mermaid') || [])].map(code => ({
                source: code.textContent.slice(0, 200), busy: code.parentElement.dataset.mermaidRendering === 'true',
                error: code.parentElement.dataset.mermaidError === 'true'
              })),
              preview: { status: preview.status, version: preview.version, lastStableResult: preview.lastStableResult, error: preview.error },
              documentVersion: window.markdownEditorDocumentModel.getDocumentVersion(),
              text: root?.textContent.slice(0, 600) || ''
            };
          }, selector, requireImage);
          return Object.values(renderObservation.snapshot.checks).every(value => value === true);
        }, { timeout: 30_000, timeoutMsg: `${source}/${mode}: imported legal content did not render.` });
        renderObservation.status = 'passed';
      } catch (error) {
        renderObservation.status = 'failed';
        renderObservation.error = error.stack || String(error);
        try { await browser.saveScreenshot(join(evidenceRoot, `r13-import-${source}-${mode}-failed.png`)); }
        catch (screenshotError) { renderObservation.screenshotError = String(screenshotError); }
        const missing = Object.entries(renderObservation.snapshot?.checks || {}).filter(([, value]) => value !== true).map(([key]) => key);
        throw new Error(`${source}/${mode}: imported legal content did not render; missing=${missing.join(',') || 'snapshot unavailable'}.`, { cause: error });
      }
      const snapshot = await browser.execute(rootSelector => {
        const root = document.querySelector(rootSelector);
        const body = rootSelector === '#preview' ? root.querySelector('.markdown-body') : root;
        const importedHtml = rootSelector === '#preview' ? [body] : Array.from(root.querySelectorAll('.cm-hybrid-html-body'));
        for (const node of importedHtml) {
          node?.querySelector('[data-r12-kind="click"]')?.click();
          node?.querySelector('[data-r12-kind="javascript"]')?.click();
        }
        const elements = importedHtml.flatMap(node => node ? [...node.querySelectorAll('*')] : []);
        return { href: location.href, events: [...window.__r12Probe.events], ipcAttempted: window.__r12Probe.ipcAttempted,
          ipc: window.__r12Probe.ipc, globalTauriPublished: typeof window.__TAURI__ !== 'undefined',
          eventAttributes: elements.flatMap(node => [...node.attributes].filter(attr => /^on/i.test(attr.name)).map(attr => attr.name)),
          unsafeUrls: elements.flatMap(node => [...node.attributes].filter(attr => ['href', 'src'].includes(attr.name)
            && /^(?:javascript:|vbscript:|data:text\/html)/i.test(attr.value)).map(attr => attr.name)),
          embeds: importedHtml.some(node => node?.querySelector('iframe,object,embed,script,[data-r12-probe] style')),
          clobberingId: Boolean(document.getElementById('__TAURI_INTERNALS__')) };
      }, selector);
      assert.equal(snapshot.href, baseHref, 'Imported content navigated the application.');
      assert.deepEqual(snapshot.events, []); assert.equal(snapshot.ipcAttempted, false); assert.equal(snapshot.ipc, null);
      assert.equal(snapshot.globalTauriPublished, false); assert.deepEqual(snapshot.eventAttributes, []);
      assert.deepEqual(snapshot.unsafeUrls, []); assert.equal(snapshot.embeds, false); assert.equal(snapshot.clobberingId, false);
      observations.push({ scenario: `${source}-${mode}`, passed: true, markdown: true, math: true, mermaid: true,
        image: requireImage ? true : 'extractor intentionally removes webpage images', navigationUnchanged: true, ...snapshot });
      await browser.saveScreenshot(join(evidenceRoot, `r13-import-${source}-${mode}.png`));
    }
  }
  await inspectModes('web', false);
  const beforeFailure = await fingerprint();
  const failed = await browser.execute(path => document.getElementById('compatibility-business-ports')
    .markdownEditorDocumentUiCommandPort.invoke('openImportPath', path), missingPath);
  assert.equal(failed, false); assert.deepEqual(await fingerprint(), beforeFailure);
  observations.push({ scenario: 'native-read-failure-preserves-document', passed: true });
  const loaded = await browser.execute(path => document.getElementById('compatibility-business-ports')
    .markdownEditorDocumentUiCommandPort.invoke('openImportPath', path), filePath);
  assert.equal(loaded, true);
  const fileDocument = await fingerprint();
  assert.equal(fileDocument.records, 2); assert.notEqual(fileDocument.documentId, imported.documentId);
  assert.match(fileDocument.text, /R13 harmless import text/);
  await inspectModes('file', true);
  assert.equal(requests.some(item => /^\/marker\/r12-import-(?:web|file)\/css$/.test(item.marker)), false, 'Imported CSS started a resource request.');
  const recents = await browser.execute(path => JSON.parse(localStorage.getItem('md_editor_recent_files') || '[]').some(item => item.path === path), filePath);
  assert.equal(recents, true);
  observations.push({ scenario: 'recent-file-after-success', passed: true });
  return { commit: process.env.GITHUB_SHA, status: 'passed', driverProvider: 'embedded-isolated-host',
    transport: 'real Rust fetch/response; owned HTTP server; private archived-host resolver', observations };
}
