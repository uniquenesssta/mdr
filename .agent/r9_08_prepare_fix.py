from pathlib import Path

apply_path = Path('.agent/r9_08_apply.py')
apply_text = apply_path.read_text(encoding='utf-8')

old_comment = "    ' * Responsibility: Public Stage 9 synchronization contract. R9-04 through R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\\n * Imports: Public synchronization modules only.\\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\\n'"
new_comment = "    ' * Responsibility: Public Stage 9 synchronization contract. R9-04, R9-05, R9-06 and R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\\n * Imports: Public synchronization modules only.\\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\\n'"
if apply_text.count(old_comment) != 1:
    raise RuntimeError(f'expected one Sync facade R9 history marker, found {apply_text.count(old_comment)}')
apply_text = apply_text.replace(old_comment, new_comment, 1)

old_gate = "    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js',\\n\", '')"
new_gate = "    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js',\\n\", '')\n    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js'\\n\", '')"
if apply_text.count(old_gate) != 1:
    raise RuntimeError(f'expected one historical later-file migration marker, found {apply_text.count(old_gate)}')
apply_text = apply_text.replace(old_gate, new_gate, 1)
apply_path.write_text(apply_text, encoding='utf-8')

validate_path = Path('.agent/r9_08_validate.sh')
validate_text = validate_path.read_text(encoding='utf-8')
start_marker = "# Final scope audit. Historical tests may only remove the now-current later-file assertion or move cardinality 378 -> 379.\n"
end_marker = "\nnode -e \"const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==379) process.exit(1);"
start = validate_text.find(start_marker)
end = validate_text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError('R9-08 validator scope-audit markers not found')

scope_audit = r'''# Final scope audit. Historical tests are accepted only when they exactly equal the R9-07 file after the two authorized mechanical migrations.
python - <<'PY'
from pathlib import Path
import subprocess

baseline = 'ff66d2eaa4cd030977cc3c4e57bc886e95d4110a'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
explicit = {
    'README.md',
    'public/app/core.js',
    'public/app/scroll-sync.js',
    'src/features/sync/index.js',
    'src/features/sync/selection/selection-feedback-guard.js',
    'src/main.js',
    'src/sync/selection-controller.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-09-selection-feedback-guard.test.mjs',
    'tests/architecture/stage-09-selection-feedback-guard.test.mjs',
    '.github/workflows/stage-07-atomic.yml',
}
future_guard_with_comma = "  'src/features/sync/selection/selection-feedback-guard.js',\n"
future_guard_without_comma = "  'src/features/sync/selection/selection-feedback-guard.js'\n"
for path in changed:
    if path.startswith('.agent/r9_08_'):
        continue
    if path in explicit:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        try:
            expected = subprocess.check_output(['git', 'show', f'{baseline}:{path}'], text=True)
        except subprocess.CalledProcessError as error:
            raise SystemExit(f'Unexpected new historical test in R9-08: {path}') from error
        expected = expected.replace(future_guard_with_comma, '')
        expected = expected.replace(future_guard_without_comma, '')
        expected = expected.replace('inventory.modules.length, 378', 'inventory.modules.length, 379')
        expected = expected.replace('modules.length, 378', 'modules.length, 379')
        actual = Path(path).read_text(encoding='utf-8')
        if actual == expected:
            continue
        raise SystemExit(f'Historical R9-08 test differs beyond authorized mechanical migrations: {path}')
    raise SystemExit(f'Unexpected R9-08 path: {path}')
PY
'''
validate_text = validate_text[:start] + scope_audit + validate_text[end:]
validate_path.write_text(validate_text, encoding='utf-8')

Path(__file__).unlink()
