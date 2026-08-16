#!/usr/bin/env bash
set -euo pipefail

python - <<'PY'
from pathlib import Path

source = Path('.agent/r9_04_validate.sh').read_text(encoding='utf-8')

old = """  ':!.agent/r9_04_validate.sh' \\
  ':!.github/workflows/r9-04-validation.yml' \\
"""
new = """  ':!.agent/r9_04_validate.sh' \\
  ':!.agent/r9_04_current_count_fix.py' \\
  ':!.agent/r9_04_validate_corrected.sh' \\
  ':!.github/workflows/r9-04-validation.yml' \\
"""
if source.count(old) != 1:
    raise SystemExit(f'guard patch target count: {source.count(old)}')
source = source.replace(old, new, 1)

old = "PYTHONDONTWRITEBYTECODE=1 python .agent/r9_04_contract_fix.py\n"
new = old + "PYTHONDONTWRITEBYTECODE=1 python .agent/r9_04_current_count_fix.py\n"
if source.count(old) != 1:
    raise SystemExit(f'count-fix insertion target count: {source.count(old)}')
source = source.replace(old, new, 1)

old = """    '.agent/r9_04_apply.py', '.agent/r9_04_contract_fix.py', '.agent/r9_04_validate.sh',
"""
new = """    '.agent/r9_04_apply.py', '.agent/r9_04_contract_fix.py', '.agent/r9_04_validate.sh',
    '.agent/r9_04_current_count_fix.py', '.agent/r9_04_validate_corrected.sh',
"""
if source.count(old) != 1:
    raise SystemExit(f'allowed-set patch target count: {source.count(old)}')
source = source.replace(old, new, 1)

old = """        if new.replace('inventory.modules.length, 374', 'inventory.modules.length, 373') == old:
            continue
"""
new = """        normalized = new.replace('inventory.modules.length, 374', 'inventory.modules.length, 373')
        normalized = normalized.replace(
            'assert.equal(moduleFixture.modules.length, 374);',
            'assert.equal(moduleFixture.modules.length, 373);'
        )
        if normalized == old:
            continue
"""
if source.count(old) != 1:
    raise SystemExit(f'audit-normalization patch target count: {source.count(old)}')
source = source.replace(old, new, 1)

old = """  .agent/r9_04_contract_fix.py \\
  .agent/r9_04_validate.sh \\
"""
new = """  .agent/r9_04_contract_fix.py \\
  .agent/r9_04_current_count_fix.py \\
  .agent/r9_04_validate.sh \\
  .agent/r9_04_validate_corrected.sh \\
"""
if source.count(old) != 1:
    raise SystemExit(f'cleanup patch target count: {source.count(old)}')
source = source.replace(old, new, 1)

Path('/tmp/r9_04_validate_corrected.sh').write_text(source, encoding='utf-8')
PY

bash /tmp/r9_04_validate_corrected.sh
