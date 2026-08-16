#!/usr/bin/env bash
set -euo pipefail
self='.agent/r9_11_prepare_cleanup.sh'
python - <<'PY'
from pathlib import Path
path = Path('.agent/r9_11_validate.sh')
text = path.read_text(encoding='utf-8')
old = "PYTHONDONTWRITEBYTECODE=1 python -m py_compile .agent/r9_11_apply.py\nPYTHONDONTWRITEBYTECODE=1 python .agent/r9_11_apply.py"
new = "PYTHONDONTWRITEBYTECODE=1 python -m py_compile .agent/r9_11_apply.py\nrm -rf .agent/__pycache__\nPYTHONDONTWRITEBYTECODE=1 python .agent/r9_11_apply.py"
if text.count(old) != 1:
    raise SystemExit('R9-11 pycompile cleanup marker missing')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
PY
rm -f "$self"
exec bash .agent/r9_11_prepare.sh
