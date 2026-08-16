from pathlib import Path
import json

core_path = Path('public/app/core.js')
core = core_path.read_text(encoding='utf-8')
old = "      scheduleEditorMetricsRebuild(80);\n"
new = "      if (coreEditorUiCommandPort.has('preparePreviewEditorMetrics')) coreEditorUiCommandPort.invoke('preparePreviewEditorMetrics');\n"
if core.count(old) != 1:
    raise SystemExit(f'core editor metric refresh target count: {core.count(old)}')
core_path.write_text(core.replace(old, new, 1), encoding='utf-8')

architecture_path = Path('tests/architecture/stage-09-editor-scroll-mapper.test.mjs')
architecture = architecture_path.read_text(encoding='utf-8')
old = """  assert.doesNotMatch(legacy, /createElement\\(['\"]canvas['\"]\\)|getContext\\(['\"]2d['\"]\\)|measureText\\s*\\(|rebuildEditorLineMetrics|scheduleEditorMetricsRebuild/);
});
"""
new = """  assert.doesNotMatch(legacy, /createElement\\(['\"]canvas['\"]\\)|getContext\\(['\"]2d['\"]\\)|measureText\\s*\\(|rebuildEditorLineMetrics|scheduleEditorMetricsRebuild/);
  const core = await read('public/app/core.js');
  assert.doesNotMatch(core, /scheduleEditorMetricsRebuild/);
  assert.match(core, /coreEditorUiCommandPort\\.has\\('preparePreviewEditorMetrics'\\)/);
  assert.match(core, /coreEditorUiCommandPort\\.invoke\\('preparePreviewEditorMetrics'\\)/);
});
"""
if architecture.count(old) != 1:
    raise SystemExit(f'architecture scoped refresh target count: {architecture.count(old)}')
architecture_path.write_text(architecture.replace(old, new, 1), encoding='utf-8')

fixture_path = Path('tests/architecture/fixtures/production-modules.json')
fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
found = False
for record in fixture['modules']:
    if record[0] == 'public/app/core.js':
        record[3] = 'Legacy layout/sidebar/recent-files wrappers and cross-stage document commands; R9-04 editor preference geometry refresh delegates through the scoped Editor UI command port instead of the removed global editor metric rebuild.'
        found = True
        break
if not found:
    raise SystemExit('public/app/core.js inventory record missing')
fixture_path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

print('R9-04 startup integration fixed')
