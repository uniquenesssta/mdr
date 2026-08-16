#!/usr/bin/env bash
set -euo pipefail
self='.agent/r9_11_prepare.sh'
python - <<'PY'
from pathlib import Path
path = Path('.agent/r9_11_apply.py')
text = path.read_text(encoding='utf-8')
old = 'R9-01 through R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition'
new = 'R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08, R9-09 and R9-10 owners remain frozen; R9-11 integrates frozen selection mapping exclusively through model-kernel composition'
if text.count(old) != 1:
    raise SystemExit('R9-11 facade traceability marker missing')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
PY
rm -f "$self"
bash .agent/r9_11_validate.sh
