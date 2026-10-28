import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { getFreePort, launchChromium } from './lib/cdp-browser.mjs';

test('R16-07 actual DEV startup mounts Telemetry once and terminal disposal releases browser resources', { timeout: 90000 }, async () => {
  const server = await createServer({ configLoader: 'native', server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false, hmr: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    browser = await launchChromium();
    await browser.page.navigate('http://127.0.0.1:' + address.port + '/?e2e=1');
    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 30000, description: 'actual DEV application ready' });
    const result = await browser.page.evaluate(`(async () => {
      const api = await import('/src/features/telemetry/index.js');
      const before = api.getPerformanceTelemetryState();
      const remount = api.mountPerformanceTelemetry();
      const entries = [];
      try {
        api.configurePerformancePlatform({ enabled: true, logs: { async writePerformance(batch, meta) {
          if (meta.query) return { ...meta, acceptedCount: 0, state: 'missing' };
          entries.push(...batch);
          return { ...meta, acceptedCount: meta.total, state: 'complete' };
        } } });
        const started = performance.now();
        while (!entries.some(entry => entry.operation === 'frontend.bootstrap')) {
          if (performance.now() - started > 7000) throw Error('actual DEV bootstrap was not flushed');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const running = api.getPerformanceTelemetryState();
        const report = api.destroyPerformanceTelemetry();
        return { before, remount, running, report, after: api.getPerformanceTelemetryState(),
          bootstrapEvents: entries.filter(entry => entry.operation === 'frontend.bootstrap').length,
          lateMount: api.mountPerformanceTelemetry(), perfGlobal: Object.hasOwn(window, 'markdownEditorPerf'),
          e2eInstalled: typeof window.__markdownEditorE2E?.snapshot === 'function' };
      } finally { api.destroyPerformanceTelemetry(); }
    })()`);
    assert.equal(result.before.controlListeners, 3);
    assert.equal(result.remount, false);
    assert.equal(result.bootstrapEvents, 1);
    assert.equal(result.running.state, 'running');
    assert.equal(result.running.controlListeners, 3);
    assert.equal(result.report.cleanupFailed, false);
    assert.equal(result.after.state, 'destroyed');
    assert.equal(result.after.activeResources + result.after.controlListeners + result.after.activeTimers + result.after.activeFrames, 0);
    assert.equal(result.lateMount, false);
    assert.equal(result.perfGlobal, false);
    assert.equal(result.e2eInstalled, true);
    console.log('R16-07 actual DEV Telemetry: ' + JSON.stringify(result));
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
