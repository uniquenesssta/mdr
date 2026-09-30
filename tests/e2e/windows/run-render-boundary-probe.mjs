import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEmbeddedSession } from './embedded-webdriver-session.mjs';
import { createRenderBoundaryProbe, PROBE_SURFACES } from './render-boundary-probe.mjs';

if (process.platform !== 'win32') throw new Error('R12-22 requires the real Windows WebView.');
if (!process.env.RUNNER_TEMP || !process.env.MARKDOWN_EDITOR_BINARY || !process.env.GITHUB_SHA) {
  throw new Error('CI must supply the isolated host binary, exact commit and owned temporary root.');
}
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const evidenceRoot = resolve(process.env.RUNNER_TEMP, 'r12-22-webview');
const canaryRoot = await mkdtemp(join(resolve(process.env.RUNNER_TEMP), 'r12-22-owned-'));
const canaryPath = join(canaryRoot, 'canary.md');
const canaryText = 'R12-22 OWNED HARMLESS IPC CANARY\n';
await mkdir(evidenceRoot, { recursive: true });
await writeFile(canaryPath, canaryText);
const config = JSON.parse(await readFile(join(repositoryRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
const requests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
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
const evidence = {
  schemaVersion: 1,
  phase: 'baseline-probe-before-A03-remediation',
  commit: process.env.GITHUB_SHA,
  driverProvider: 'embedded-isolated-host',
  csp: config.app.security.csp,
  withGlobalTauri: config.app.withGlobalTauri,
  acceptedSecurityBoundary: false,
  status: 'running',
  surfaces: [],
  requests
};
const persist = () => writeFile(join(evidenceRoot, 'render-boundary-baseline.json'), `${JSON.stringify(evidence, null, 2)}\n`);
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
        origin: location.origin, userAgent: navigator.userAgent,
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
    await persist();

    for (const surface of PROBE_SURFACES) {
      const fixture = createRenderBoundaryProbe(`r12-${surface}`, markerOrigin);
      const observation = { surface, id: fixture.id, status: 'running' };
      evidence.surfaces.push(observation);
      await persist();
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
        } else {
          host.markdownEditorPreviewRendererPort.patchBlocks({
            blocks: [{ id: data.id, html: data.html, startLine: 1, endLine: 1, start: 0, end: data.html.length }],
            changedIds: [data.id], incremental: false
          }, { forceAll: true });
        }
      }, surface, fixture);
      const rootSelector = surface === 'hybrid-html-widget' ? '.cm-hybrid-html-body' : '#preview .markdown-body';
      await browser.waitUntil(() => browser.execute((selector, id) => Boolean(
        document.querySelector(`${selector} [data-r12-probe="${id}"]`)
      ), rootSelector, fixture.id), { timeout: 15_000, timeoutMsg: `${surface} did not mount its actual HTML sink.` });
      await browser.execute((selector, id) => {
        const root = document.querySelector(`${selector} [data-r12-probe="${id}"]`);
        root.querySelector('[data-r12-kind="click"]')?.click();
        root.querySelector('[data-r12-kind="javascript"]')?.click();
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
          javascriptUrlRetained: root.querySelector('[data-r12-kind="javascript"]')?.getAttribute('href')?.startsWith('javascript:') || false,
          retainedEmbeds: ['iframe', 'object', 'embed', 'style'].filter(tag => root.querySelector(tag)),
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
        securityVerdict: 'not-accepted; use observations to design and verify remediation'
      });
      await persist();
      assert.equal(snapshot.harmlessTextPreserved, true, `${surface}: control text missing.`);
      await browser.saveScreenshot(join(evidenceRoot, `${surface}.png`));
    }
  });
  assert.equal(evidence.surfaces.length, PROBE_SURFACES.length);
  evidence.status = 'baseline-probe-completed; A03 remains open';
  console.log(`R12-22 actual Windows WebView baseline: ${evidence.surfaces.length}/${PROBE_SURFACES.length} surfaces observed; A03 NOT accepted.`);
} catch (error) {
  evidence.status = 'baseline-probe-failed; A03 remains open';
  evidence.error = String(error?.stack || error);
  throw error;
} finally {
  await persist();
  await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(canaryRoot, { recursive: true, force: true });
}
