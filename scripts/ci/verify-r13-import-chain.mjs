import assert from 'node:assert/strict';

export const IMPORT_CHAIN_SCENARIOS = Object.freeze([
  'fetch-failure-no-document', 'fetch-cancel-late-result', 'web-both', 'web-hybrid',
  'native-read-failure-preserves-document', 'file-both', 'file-hybrid', 'recent-file-after-success'
]);

/** Admit only current-commit real Windows chain observations alongside the existing CSP/IPC controls. */
export function assessImportDocumentChain(webview, commit) {
  const chain = webview.importDocumentChain;
  assert.ok(chain, 'R13.13 actual Import → Documents chain evidence is missing.');
  assert.equal(chain.commit, commit, 'Stale import chain evidence.');
  assert.equal(chain.status, 'passed');
  assert.equal(chain.driverProvider, 'embedded-isolated-host');
  assert.equal(chain.transport, 'real Rust fetch/response; owned HTTP server; private archived-host resolver');
  assert.equal(webview.environment.nativeCanaryControlPassed, true);
  assert.equal(webview.environment.globalTauriPublished, false);
  assert.equal(webview.cspControl.executed, false);
  assert.ok(webview.cspControl.violations.includes('script-src-attr'));
  assert.deepEqual(chain.observations.map(item => item.scenario).sort(), [...IMPORT_CHAIN_SCENARIOS].sort());
  for (const observation of chain.observations) {
    assert.equal(observation.passed, true, observation.scenario);
    if (/^(?:web|file)-(?:both|hybrid)$/.test(observation.scenario)) {
      for (const name of ['markdown', 'math', 'mermaid']) assert.equal(observation[name], true);
      if (observation.scenario.startsWith('file-')) assert.equal(observation.image, true);
      assert.equal(observation.navigationUnchanged, true);
      assert.deepEqual(observation.events, []); assert.equal(observation.ipcAttempted, false);
      assert.equal(observation.ipc, null); assert.equal(observation.globalTauriPublished, false);
      assert.deepEqual(observation.eventAttributes, []); assert.deepEqual(observation.unsafeUrls, []);
      assert.equal(observation.embeds, false); assert.equal(observation.clobberingId, false);
    }
  }
  return { scenarios: chain.observations.length, status: 'actual-Windows-import-chain-passed' };
}
