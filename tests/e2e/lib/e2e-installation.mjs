import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchChromium } from './cdp-browser.mjs';

// Each case starts a fresh real browser profile; flags and API slots cannot leak
// from the existing opt-in suite or from an earlier positive case.
export async function runE2EInstallationChecks({ test, baseUrl, artifactRoot }) {
  const evidence = [];
  const fixtureSource = '# Installation gate\nactual semantic import';
  for (const row of [
    { name: 'default production page has no E2E global', query: '', enabled: false },
    { name: 'non-exact query cannot enable the production bridge', query: '?e2e=true', enabled: false },
    { name: 'false test flag keeps the production bridge disabled', query: '', flag: false, enabled: false },
    { name: 'string test flag cannot enable the production bridge', query: '', flag: 'true', enabled: false },
    { name: 'exact query enables real semantic actions despite a false flag', query: '?e2e=1', flag: false, enabled: true },
    { name: 'boolean test flag enables real semantic actions without a query', query: '', flag: true, enabled: true }
  ]) {
    await test('R15-10 ' + row.name, async () => {
      const browser = await launchChromium({ width: 1280, height: 900 });
      const result = { name: row.name, query: row.query, expectedEnabled: row.enabled, passed: false };
      evidence.push(result);
      try {
        await browser.page.addInitScript(`
          localStorage.setItem('md_editor_help_shown','true');
          ${Object.hasOwn(row, 'flag') ? 'globalThis.__MARKDOWN_EDITOR_E2E__=' + JSON.stringify(row.flag) + ';' : ''}
        `);
        await browser.page.navigate(baseUrl.replace(/\/$/, '') + '/' + row.query);
        await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), {
          timeoutMs: 20000, description: 'production application ready for installation gate'
        });
        result.observation = await browser.page.evaluate(`(async () => {
          const descriptor=Object.getOwnPropertyDescriptor(window,'__markdownEditorE2E');
          if(!descriptor)return {installed:false,ready:document.documentElement.classList.contains('app-ready'),
            editorAvailable:typeof document.getElementById('editor')?.value==='string'};
          const api=descriptor.value;
          const source=${JSON.stringify(fixtureSource)};
          const loaded=await api.loadMarkdown(source,{layout:'edit',selection:0});
          const exact=api.getEditorValue()===source;
          const stateBefore=api.getState();
          window.dispatchEvent(new Event('pagehide'));
          return {installed:true,ready:loaded.ready,exact,layout:loaded.layout,
            stateBefore,stateAfter:api.getState(),removed:!Object.getOwnPropertyDescriptor(window,'__markdownEditorE2E')};
        })()`);
        assert.equal(result.observation.installed, row.enabled);
        assert.equal(result.observation.ready, true);
        if (row.enabled) {
          assert.equal(result.observation.exact, true); assert.equal(result.observation.layout, 'edit');
          assert.equal(result.observation.stateBefore.destroyed, false);
          assert.equal(result.observation.stateAfter.destroyed, true); assert.equal(result.observation.removed, true);
          for (const state of [result.observation.stateBefore, result.observation.stateAfter]) {
            assert.equal(state.activeOperations, 0); assert.equal(state.pendingWaits, 0);
          }
        } else assert.equal(result.observation.editorAvailable, true);
        result.passed = true;
      } catch (error) {
        result.error = String(error?.stack || error);
        await browser.page.screenshot(join(artifactRoot, 'r15-10-' + evidence.length + '-installation.png')).catch(() => {});
        throw error;
      } finally {
        try { await writeFile(join(artifactRoot, 'r15-10-installation.json'), JSON.stringify(evidence, null, 2)); }
        finally { await browser.close(); }
      }
    });
  }
}
