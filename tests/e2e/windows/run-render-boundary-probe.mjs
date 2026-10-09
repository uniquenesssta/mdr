import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEmbeddedSession } from './embedded-webdriver-session.mjs';
import { verifyImportDocumentChain } from './import-document-chain.mjs';
import { createRenderBoundaryProbe, PROBE_SURFACES } from './render-boundary-probe.mjs';

if (process.platform !== 'win32') throw new Error('R12-22 requires the real Windows WebView.');
if (!process.env.RUNNER_TEMP || !process.env.MARKDOWN_EDITOR_BINARY || !process.env.GITHUB_SHA) {
  throw new Error('CI must supply the isolated host binary, exact commit and owned temporary root.');
}
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const verifyBoundary = process.argv.includes('--verify');
const evidenceRoot = resolve(process.env.RUNNER_TEMP, 'r12-22-webview');
const canaryRoot = await mkdtemp(join(resolve(process.env.RUNNER_TEMP), 'r12-22-owned-'));
const canaryPath = join(canaryRoot, 'canary.md');
const canaryText = 'R12-22 OWNED HARMLESS IPC CANARY\n';
await mkdir(evidenceRoot, { recursive: true });
await writeFile(canaryPath, canaryText);
const config = JSON.parse(await readFile(join(repositoryRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
const requests = [];
let importArticleHtml = '';
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (['/r13/article', '/r13/slow', '/r13/non-html'].includes(url.pathname)) {
    requests.push({ marker: url.pathname, at: new Date().toISOString(),
      nativeBrowserHeaders: request.headers['user-agent']?.includes('Chrome/126.0.0.0') === true });
    response.writeHead(200, { 'Content-Type': url.pathname === '/r13/non-html' ? 'application/json' : 'text/html', 'Cache-Control': 'no-store' });
    if (url.pathname === '/r13/slow') setTimeout(() => { if (!response.destroyed) response.end(importArticleHtml); }, 1_000);
    else response.end(url.pathname === '/r13/non-html' ? '{"fixture":"rejected"}' : importArticleHtml);
    return;
  }
  if (!/^\/marker\/r12-[a-z-]+\/(?:image|css)$/.test(url.pathname) || url.search) {
    response.writeHead(404).end();
    return;
  }
  // Store only fixed fixture identifiers, never bodies, cookies or other headers.
  requests.push({ marker: url.pathname, at: new Date().toISOString() });
  response.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  response.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
const markerOrigin = `http://127.0.0.1:${server.address().port}`;
const fixtureOrigin = `http://r13-import.test:${server.address().port}`;
process.env.MDR_R13_FIXTURE_PORT = String(server.address().port);
importArticleHtml = '<!doctype html><html><head><title>R13 imported article</title></head><body><article>'
  + '<h1>R13 imported article</h1><p><strong>R13 harmless import text</strong> and <em>legal emphasis</em></p>'
  + '<p>$$x^2$$</p><pre><code class="language-mermaid">flowchart TD\n A[Safe] --&gt; B[Import]\n</code></pre>'
  + createRenderBoundaryProbe('r12-import-web', markerOrigin).html + '</article></body></html>';
const importFilePath = join(canaryRoot, 'import-chain.md');
await writeFile(importFilePath, '# R13 imported file\n\n**R13 harmless import text**\n\n'
  + '![owned import image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n\n'
  + '$$\nx^2\n$$\n\n```mermaid\nflowchart TD\n A[Safe] --> B[Import]\n```\n\n'
  + createRenderBoundaryProbe('r12-import-file', markerOrigin).html + '\n');
const evidence = {
  schemaVersion: 1,
  phase: verifyBoundary ? 'post-remediation-security-regression' : 'baseline-probe-before-A03-remediation',
  commit: process.env.GITHUB_SHA,
  driverProvider: 'embedded-isolated-host',
  csp: config.app.security.csp,
  withGlobalTauri: config.app.withGlobalTauri,
  acceptedSecurityBoundary: false,
  status: 'running',
  surfaces: [],
  requests
};
const persist = () => writeFile(join(evidenceRoot, verifyBoundary ? 'render-boundary-verification.json' : 'render-boundary-baseline.json'), `${JSON.stringify(evidence, null, 2)}\n`);
try {
  await persist();
  await withEmbeddedSession({
    label: 'render-boundary-baseline', port: 4591,
    binaryPath: resolve(process.env.MARKDOWN_EDITOR_BINARY),
    repositoryRoot, artifactDirectory: evidenceRoot
  }, async browser => {
    evidence.environment = await browser.execute(async (path, text) => {
      const host = document.getElementById('compatibility-business-ports');
      if (!host?.markdownEditorPreviewRendererPort || !host?.markdownEditorEditorUiCommandPort) {
        throw new Error('Production rendering ports are unavailable.');
      }
      if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') {
        throw new Error('Actual Tauri IPC is unavailable; browser emulation is not evidence.');
      }
      const result = await window.__TAURI_INTERNALS__.invoke('read_dropped_file', { path });
      const mainResponse = await fetch(location.href);
      window.__r12CanaryPath = path;
      window.__r12CanaryText = text;
      return {
        origin: location.origin, href: location.href, userAgent: navigator.userAgent,
        nativeCanaryControlPassed: result.content === text,
        globalTauriPublished: typeof window.__TAURI__ !== 'undefined',
        internalInvokePresent: true,
        mainResponseCsp: mainResponse.headers.get('content-security-policy'),
        metaCsp: Array.from(document.querySelectorAll('meta[http-equiv]'))
          .filter(node => node.httpEquiv.toLowerCase() === 'content-security-policy')
          .map(node => node.content)
      };
    }, canaryPath, canaryText);
    assert.equal(evidence.environment.nativeCanaryControlPassed, true, 'Owned canary control must reach real Rust.');
    assert.match(evidence.environment.origin, /^https?:\/\/tauri\.localhost$/, 'Must run the embedded production dist.');
    if (verifyBoundary) {
      assert.ok(evidence.environment.mainResponseCsp || evidence.environment.metaCsp.length, 'Production CSP must actually reach the WebView.');
      assert.equal(evidence.environment.globalTauriPublished, false);
      // Independently challenge CSP, bypassing the sanitizer with a test-owned node.
      evidence.cspControl = await browser.execute(async () => {
        window.__r12CspExecuted = false;
        const violations = [];
        const listener = event => violations.push(event.effectiveDirective);
        document.addEventListener('securitypolicyviolation', listener);
        const node = document.createElement('button');
        node.setAttribute('onclick', 'window.__r12CspExecuted=true');
        document.body.append(node);
        node.click();
        await new Promise(accept => setTimeout(accept, 300));
        node.remove();
        document.removeEventListener('securitypolicyviolation', listener);
        return { executed: window.__r12CspExecuted, violations };
      });
      assert.equal(evidence.cspControl.executed, false, 'Inline code must be blocked even without sanitization.');
      assert.ok(evidence.cspControl.violations.includes('script-src-attr'), 'The enforced CSP must explain the block.');
    }
    await persist();

    const surfaces = verifyBoundary ? [...PROBE_SURFACES, 'preview-virtual-block'] : PROBE_SURFACES;
    for (const surface of surfaces) {
      const fixture = createRenderBoundaryProbe(`r12-${surface}`, markerOrigin);
      const observation = { surface, id: fixture.id, status: 'running' };
      evidence.surfaces.push(observation);
      await persist();
      try {
        await browser.execute(async (kind, data) => {
          const host = document.getElementById('compatibility-business-ports');
          window.__r12Probe = { events: [], ipcAttempted: false, ipc: null, cspViolations: [] };
          window.__r12CspListener && document.removeEventListener('securitypolicyviolation', window.__r12CspListener);
          window.__r12CspListener = event => window.__r12Probe.cspViolations.push({
            directive: event.effectiveDirective, disposition: event.disposition,
            blocked: ['inline', 'eval'].includes(event.blockedURI) ? event.blockedURI : 'resource'
          });
          document.addEventListener('securitypolicyviolation', window.__r12CspListener);
          const ui = host.markdownEditorEditorUiCommandPort;
          ui.invoke('setLayoutMode', kind === 'hybrid-html-widget' ? 'hybrid' : 'both');
          if (kind === 'preview-markdown' || kind === 'hybrid-html-widget') {
            const editor = document.getElementById('editor');
            editor.virtualEditor.loadDocument(data.markdown, { selection: data.markdown.length });
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            if (kind === 'preview-markdown') await host.markdownEditorPreviewCommandPort.update();
          } else if (kind === 'preview-full-html') {
            host.markdownEditorPreviewRendererPort.patchHtml(data.html, { forceFullRebuild: true });
          } else if (kind === 'preview-virtual-block') {
            // VirtualWindowController uses this same canonical factory for each mount.
            // Own its connected test mount: the live Preview owns and may repaint #preview.
            const body = document.createElement('div');
            body.id = 'r12-owned-virtual-surface';
            body.className = 'markdown-body';
            Object.assign(body.style, { position: 'fixed', inset: '24px', overflow: 'auto', zIndex: '2147483647', background: 'white' });
            body.append(...host.markdownEditorPreviewRendererPort.createBlockNodes({
              id: data.id, html: data.html, startLine: 1, endLine: 1, start: 0, end: data.html.length
            }));
            document.body.append(body);
            // Exercise the repaint that previously removed the probe, before sampling.
            await host.markdownEditorPreviewCommandPort.update();
            if (!body.isConnected || !body.querySelector('[data-r12-probe]')) {
              throw new Error('Virtual factory probe did not survive the live Preview update.');
            }
          } else {
            host.markdownEditorPreviewRendererPort.patchBlocks({
              blocks: [{ id: data.id, html: data.html, startLine: 1, endLine: 1, start: 0, end: data.html.length }],
              changedIds: [data.id], incremental: false
            }, { forceAll: true });
          }
        }, surface, fixture);
        const rootSelector = surface === 'preview-virtual-block' ? '#r12-owned-virtual-surface'
          : surface === 'hybrid-html-widget' ? '.cm-hybrid-html-body' : '#preview .markdown-body';
        observation.mount = surface === 'preview-virtual-block'
          ? 'canonical factory in owned connected DOM after live Preview update' : 'production rendering surface';
        await browser.waitUntil(() => browser.execute((selector, id) => Boolean(
          document.querySelector(`${selector} [data-r12-probe="${id}"]`)
        ), rootSelector, fixture.id), { timeout: 15_000, timeoutMsg: `${surface} did not mount its actual HTML sink.` });
        await browser.execute((selector, id) => {
          const root = document.querySelector(`${selector} [data-r12-probe="${id}"]`);
          root.querySelector('[data-r12-kind="click"]')?.click();
          for (const kind of ['javascript', 'encoded-url', 'data-url']) root.querySelector(`[data-r12-kind="${kind}"]`)?.click();
        }, rootSelector, fixture.id);
        // Bounded observation window: absence of a marker is inconclusive, never a safety verdict.
        const snapshot = await browser.execute(async (selector, id) => {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000));
          const root = document.querySelector(`${selector} [data-r12-probe="${id}"]`);
          if (!root) throw new Error('Probe left its rendering surface before evidence capture.');
          const attributes = Array.from(root.querySelectorAll('*')).flatMap(node =>
            Array.from(node.attributes).filter(attribute => /^on/i.test(attribute.name)).map(attribute => ({
              element: node.tagName.toLowerCase(), name: attribute.name
            }))
          );
          return {
            eventAttributes: attributes,
            href: location.href,
            javascriptUrlRetained: root.querySelector('[data-r12-kind="javascript"]')?.getAttribute('href')?.startsWith('javascript:') || false,
            retainedEmbeds: ['iframe', 'object', 'embed', 'style'].filter(tag => root.querySelector(tag)),
            unsafeUrls: Array.from(root.querySelectorAll('[href], [src]')).flatMap(node =>
              ['href', 'src'].filter(name => /^(?:(?:javascript|vbscript):|data:text\/html)/i.test(node.getAttribute(name) || ''))),
            unsafeAttributes: Array.from(root.querySelectorAll('*')).flatMap(node =>
              Array.from(node.attributes).filter(attribute => /^(?:name|srcset|formaction|data-editor-action)$/i.test(attribute.name)).map(attribute => attribute.name)),
            clobberingId: Boolean(document.getElementById('__TAURI_INTERNALS__')),
            spoofClass: Boolean(root.querySelector('.cm-hybrid-widget-action')),
            unsafeStyle: Array.from(root.querySelectorAll('[style]')).some(node => /url\s*\(|position\s*:|inset\s*:/i.test(node.getAttribute('style'))),
            boundedColorPreserved: root.querySelector('[data-r12-kind="spoof"]')?.style.color === 'rgb(18, 52, 86)',
            harmlessTextPreserved: root.querySelector('[data-r12-kind="text"]')?.textContent === 'R12 harmless marker',
            events: [...window.__r12Probe.events],
            ipcAttempted: window.__r12Probe.ipcAttempted,
            ipc: window.__r12Probe.ipc,
            cspViolations: [...window.__r12Probe.cspViolations]
          };
        }, rootSelector, fixture.id);
        Object.assign(observation, snapshot, {
          markerRequests: requests.filter(request => request.marker.includes(`/${fixture.id}/`)),
          status: 'observed',
          securityVerdict: verifyBoundary ? 'verification-pending' : 'not-accepted; use observations to design and verify remediation'
        });
        await persist();
        assert.equal(snapshot.harmlessTextPreserved, true, `${surface}: control text missing.`);
        if (verifyBoundary) {
          assert.deepEqual(snapshot.eventAttributes, [], `${surface}: event attributes survived.`);
          assert.deepEqual(snapshot.events, [], `${surface}: injected code ran.`);
          assert.equal(snapshot.ipcAttempted, false, `${surface}: markup reached native IPC.`);
          assert.equal(snapshot.ipc, null);
          assert.equal(snapshot.javascriptUrlRetained, false);
          assert.equal(snapshot.href, evidence.environment.href, `${surface}: document navigated.`);
          assert.deepEqual(snapshot.unsafeUrls, []);
          assert.deepEqual(snapshot.unsafeAttributes, []);
          assert.deepEqual(snapshot.retainedEmbeds, []);
          assert.equal(snapshot.clobberingId, false);
          assert.equal(snapshot.spoofClass, false);
          assert.equal(snapshot.unsafeStyle, false);
          assert.equal(snapshot.boundedColorPreserved, true);
          assert.equal(observation.markerRequests.some(request => request.marker.endsWith('/css')), false, 'Document CSS must not start resource loads.');
          // Passive HTTP images are intentionally supported; their fixed image marker is not script execution.
          observation.securityVerdict = 'attack-fixtures-blocked; normal-content-verification-required';
        }
        await browser.saveScreenshot(join(evidenceRoot, `${surface}.png`));
      } finally {
        if (surface === 'preview-virtual-block') {
          await browser.execute(() => document.getElementById('r12-owned-virtual-surface')?.remove());
        }
      }
    }
    if (verifyBoundary) {
      evidence.normalContent = [];
      const png = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const markdown = '# R12 safe content\n\n**bold** and *emphasis*\n\n![owned image](' + png + ')\n\n$$\nx^2 + y^2\n$$\n\n```mermaid\nflowchart LR\n  A[Safe] --> B[Content]\n```\n\n<details open><summary>safe disclosure</summary><em>safe HTML</em></details>\n';
      for (const mode of ['both', 'hybrid']) {
        await browser.execute(async (layout, source) => {
          const host = document.getElementById('compatibility-business-ports');
          host.markdownEditorEditorUiCommandPort.invoke('setLayoutMode', layout);
          const editor = document.getElementById('editor');
          editor.virtualEditor.loadDocument(source, { selection: 0 });
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          if (layout === 'both') await host.markdownEditorPreviewCommandPort.update();
        }, mode, markdown);
        const selector = mode === 'both' ? '#preview' : '#editor';
        await browser.waitUntil(() => browser.execute(rootSelector => {
          const root = document.querySelector(rootSelector);
          const image = root?.querySelector('img[alt="owned image"]');
          return Boolean(root?.querySelector('.katex') && root?.querySelector('[data-mermaid-rendered="true"] svg')
            && root?.querySelector('details[open] em')?.textContent === 'safe HTML'
            && Boolean(root.querySelector('strong, .cm-hybrid-strong'))
            && root.textContent.includes('bold')
            && image?.complete && image.naturalWidth > 0);
        }, selector), { timeout: 30_000, timeoutMsg: `${mode}: Markdown/image/math/Mermaid/HTML regression failed.` });
        evidence.normalContent.push({ mode, markdown: true, image: true, math: true, mermaid: true, safeHtml: true });
        await browser.saveScreenshot(join(evidenceRoot, `normal-${mode}.png`));
        await persist();
      }
      evidence.importDocumentChainDiagnostics = { commit: process.env.GITHUB_SHA };
      evidence.importDocumentChain = await verifyImportDocumentChain({ browser, fixtureOrigin,
        filePath: importFilePath, missingPath: join(canaryRoot, 'missing.md'), requests, evidenceRoot,
        diagnostics: evidence.importDocumentChainDiagnostics });
      await persist();
    }
  });
  assert.equal(evidence.surfaces.length, PROBE_SURFACES.length + (verifyBoundary ? 1 : 0));
  evidence.acceptedSecurityBoundary = verifyBoundary;
  evidence.status = verifyBoundary ? 'current-sinks-security-regression-passed; repository acceptance requires cumulative gates' : 'baseline-probe-completed; A03 remains open';
  console.log(`R12-22 actual Windows WebView ${verifyBoundary ? 'verification' : 'baseline'}: ${evidence.surfaces.length} surfaces; security regression ${verifyBoundary ? 'passed' : 'NOT accepted'}.`);
} catch (error) {
  evidence.status = 'render-boundary-probe-failed; A03 remains open';
  evidence.error = String(error?.stack || error);
  throw error;
} finally {
  await persist();
  await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(canaryRoot, { recursive: true, force: true });
}
