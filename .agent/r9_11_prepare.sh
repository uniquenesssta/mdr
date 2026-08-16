#!/usr/bin/env bash
set -euo pipefail
self='.agent/r9_11_prepare.sh'
python - <<'PY'
from pathlib import Path

apply_path = Path('.agent/r9_11_apply.py')
text = apply_path.read_text(encoding='utf-8')
old = 'R9-01 through R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition'
new = 'R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08, R9-09 and R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition'
if text.count(old) != 1:
    raise SystemExit('R9-11 facade traceability marker missing')
text = text.replace(old, new, 1)

marker = "behavior = r'''import test from 'node:test';"
insert = "replace_once(\n    'tests/architecture/stage-08-hybrid-editor-controller.test.mjs',\n    \"  assert.equal(baseline.businessGlobalWrites.length, 13);\",\n    \"  assert.equal(baseline.businessGlobalWrites.length, 12);\"\n)\n\n"
if text.count(marker) != 1:
    raise SystemExit('R9-11 behavior insertion marker missing')
text = text.replace(marker, insert + marker, 1)
apply_path.write_text(text, encoding='utf-8')

validate_path = Path('.agent/r9_11_validate.sh')
validate = validate_path.read_text(encoding='utf-8')
old_scope = " 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs',\n '.agent/r9_11_apply.py',"
new_scope = " 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs',\n 'tests/architecture/stage-08-hybrid-editor-controller.test.mjs',\n '.agent/r9_11_apply.py',"
if validate.count(old_scope) != 1:
    raise SystemExit('R9-11 scope marker missing')
validate = validate.replace(old_scope, new_scope, 1)
old_required = " 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs'\n}"
new_required = " 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs',\n 'tests/architecture/stage-08-hybrid-editor-controller.test.mjs'\n}"
if validate.count(old_required) != 1:
    raise SystemExit('R9-11 required-scope marker missing')
validate_path.write_text(validate.replace(old_required, new_required, 1), encoding='utf-8')
PY
rm -f "$self"
bash .agent/r9_11_validate.sh
