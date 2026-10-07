import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessImportDocumentChain, IMPORT_CHAIN_SCENARIOS } from '../scripts/ci/verify-r13-import-chain.mjs';

const commit = 'a'.repeat(40);
function fixture() {
  return { environment: { nativeCanaryControlPassed: true, globalTauriPublished: false },
    cspControl: { executed: false, violations: ['script-src-attr'] }, importDocumentChain: {
      commit, status: 'passed', driverProvider: 'embedded-isolated-host',
      transport: 'real Rust fetch/response; owned HTTP server; private archived-host resolver',
      observations: IMPORT_CHAIN_SCENARIOS.map(scenario => ({ scenario, passed: true, markdown: true,
        math: true, mermaid: true, image: true, navigationUnchanged: true, events: [], ipcAttempted: false, ipc: null,
        globalTauriPublished: false, eventAttributes: [], unsafeUrls: [], embeds: false, clobberingId: false }))
    } };
}
test('R13.13 requires exact-commit full chain evidence in addition to the preserved R12 sink controls', () => {
  assert.equal(assessImportDocumentChain(fixture(), commit).scenarios, 8);
  for (const change of [
    value => { delete value.importDocumentChain; },
    value => { value.importDocumentChain.commit = 'b'.repeat(40); },
    value => { value.importDocumentChain.observations.pop(); },
    value => { value.importDocumentChain.driverProvider = 'browser-mock'; },
    value => { value.cspControl.executed = true; },
    value => { value.importDocumentChain.observations[2].ipcAttempted = true; },
    value => { value.importDocumentChain.observations[6].image = false; },
    value => { value.importDocumentChain.observations[1].passed = false; }
  ]) {
    const value = fixture(); change(value); assert.throws(() => assessImportDocumentChain(value, commit));
  }
});
test('owned HTTP resolver exists only in the archived Windows host; cumulative admission is mandatory', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [host, production, workflow, probe, closeout] = await Promise.all([
    read('scripts/stage-03/windows/prepare-embedded-driver-host.ps1'), read('src-tauri/src/web_fetch/client.rs'),
    read('.github/workflows/r12-14.yml'), read('tests/e2e/windows/run-render-boundary-probe.mjs'), read('scripts/ci/verify-r12-closeout.mjs')
  ]);
  assert.match(host, /Some\("r13-import\.test"\)/);
  assert.match(host, /url\.port\(\) != Some\(port\)/);
  assert.match(host, /resolve_public\(url\)\.await/);
  assert.doesNotMatch(production, /r13-import\.test|MDR_R13_FIXTURE_PORT/);
  assert.match(production, /fetch_with_resolver\(initial, resolve_public, client_builder\)/);
  assert.match(workflow, /run-render-boundary-probe\.mjs --verify/);
  assert.match(probe, /evidence\.importDocumentChain = await verifyImportDocumentChain/);
  assert.match(closeout, /evidence\.importDocumentChain = assessImportDocumentChain/);
});
