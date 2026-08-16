#!/usr/bin/env bash
set -euo pipefail

baseline='7d3fd39691459c1f3d12498dd8ec10e5d4228745'
actual="$(git ls-remote origin refs/heads/rewrite/stage-09 | awk '{print $1}')"
test "$actual" = "$baseline"

npm ci
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_04_apply.py
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_04_contract_fix.py
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_04_current_count_fix.py
npm run build

python - <<'PY'
from pathlib import Path
path = Path('tests/e2e/run-browser-tests.mjs')
text = path.read_text(encoding='utf-8')
old = """    await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 20000, description: 'application ready' });
"""
new = """    try {
      await browser.page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 20000, description: 'application ready' });
    } catch (error) {
      let pageState = null;
      try {
        pageState = await browser.page.evaluate(`(()=>({
          readyState: document.readyState,
          htmlClass: document.documentElement.className,
          statusText: document.getElementById('status')?.textContent || '',
          compatibilityHost: Boolean(document.getElementById('compatibility-business-ports')),
          editorScrollMapper: Boolean(document.getElementById('compatibility-business-ports')?.markdownEditorEditorScrollMapper),
          scrollController: Boolean(window.markdownEditorScrollController),
          scrollSync: Boolean(window.markdownEditorScrollSync),
          selectionController: Boolean(window.markdownEditorSelectionController),
          initPromise: Boolean(window.__markdownEditorInitPromise)
        }))()`);
      } catch (stateError) {
        pageState = { stateError: String(stateError?.stack || stateError) };
      }
      console.error('R9-04 STARTUP DIAGNOSTIC STATE', JSON.stringify(pageState, null, 2));
      console.error('R9-04 STARTUP DIAGNOSTIC EXCEPTIONS', JSON.stringify(browser.page.exceptions, null, 2));
      console.error('R9-04 STARTUP DIAGNOSTIC CONSOLE', JSON.stringify(browser.page.consoleMessages, null, 2));
      throw error;
    }
"""
if text.count(old) != 1:
    raise SystemExit(f'app-ready patch target count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
PY

npm run test:browser
