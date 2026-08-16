#!/usr/bin/env bash
set -euo pipefail

baseline='69de06a8131d697f9bb62dd7b76fc332d596fe15'
validated_branch='agent/r9-11-validated'
validation_workflow='.github/workflows/r9-11-validation.yml'
diagnostic_workflow='.github/workflows/r9-11-diagnostic.yml'

remote_baseline="$(git ls-remote origin refs/heads/agent/r9-10-validated | awk '{print $1}')"
test "$remote_baseline" = "$baseline"
git merge-base --is-ancestor "$baseline" HEAD

# Previous failed-run artifact must never participate in architecture verification.
git rm --cached --ignore-unmatch .agent/r9_11_failure.log >/dev/null 2>&1 || true
rm -f .agent/r9_11_failure.log

python - <<'PY'
import subprocess
baseline='69de06a8131d697f9bb62dd7b76fc332d596fe15'
allowed={
    '.agent/r9_11_apply.py',
    '.agent/r9_11_validate.sh',
    '.github/workflows/r9-11-diagnostic.yml',
    '.github/workflows/r9-11-validation.yml',
}
changed=set(subprocess.check_output(['git','diff','--name-only',baseline],text=True).splitlines())
extra=changed-allowed
if extra:
    raise SystemExit(f'runner contains unexpected pre-apply paths: {sorted(extra)}')
PY

npm ci
npm audit --audit-level=high | tee /tmp/r9-11-audit.log
grep -q 'found 0 vulnerabilities' /tmp/r9-11-audit.log

PYTHONDONTWRITEBYTECODE=1 python -m py_compile .agent/r9_11_apply.py
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_11_apply.py
git diff --check

# R9-11 scope/frozen checks before tests.
git diff --quiet "$baseline" -- src/sync/selection-mapping.js
git diff --quiet "$baseline" -- src/document/document-model.js
git diff --quiet "$baseline" -- src/model-kernel/index.js
git diff --quiet "$baseline" -- package.json package-lock.json
test -f public/app/scroll-sync.js
test ! -e src/features/sync/selection/selection-sync-controller.js
grep -q 'compatibilityPlatformHost.markdownEditorSelectionMapping = selectionMappingApi' src/main.js
! grep -q 'window.markdownEditorSelectionMapping' src/main.js
! grep -q 'window.markdownEditorSelectionMapping' public/app/scroll-sync.js
! grep -q 'window.markdownEditorSelectionMapping' tests/architecture/fixtures/architecture-baseline.json
grep -q 'frozenSelectionMapping.createPreviewRangesForSourceSelection' public/app/scroll-sync.js
grep -q 'frozenSelectionMapping.mapPreviewDomPointToSource' public/app/scroll-sync.js

run_atomic() {
  local label="$1" expected="$2"; shift 2
  local log="/tmp/${label}.tap"
  node --test "$@" | tee "$log"
  grep -q "# tests ${expected}" "$log"
  grep -q "# pass ${expected}" "$log"
  grep -q '# fail 0' "$log"
}

run_atomic r9-11 10 tests/stage-09-frozen-selection-mapping-integration.test.mjs tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs
run_atomic r9-10 16 tests/stage-09-selection-retry-scheduler.test.mjs tests/architecture/stage-09-selection-retry-scheduler.test.mjs
run_atomic r9-09 16 tests/stage-09-selection-highlight-session.test.mjs tests/architecture/stage-09-selection-highlight-session.test.mjs
run_atomic r9-08 16 tests/stage-09-selection-feedback-guard.test.mjs tests/architecture/stage-09-selection-feedback-guard.test.mjs
run_atomic r9-07 15 tests/stage-09-selection-readers.test.mjs tests/architecture/stage-09-selection-readers.test.mjs
run_atomic r9-06 14 tests/stage-09-scroll-geometry-session.test.mjs tests/architecture/stage-09-scroll-geometry-session.test.mjs
run_atomic r9-05 16 tests/stage-09-preview-scroll-mapper.test.mjs tests/architecture/stage-09-preview-scroll-mapper.test.mjs
run_atomic r9-04 14 tests/stage-09-editor-scroll-mapper.test.mjs tests/architecture/stage-09-editor-scroll-mapper.test.mjs
run_atomic r9-03 13 tests/stage-09-scroll-controller.test.mjs tests/architecture/stage-09-scroll-controller.test.mjs
run_atomic r9-02 13 tests/stage-09-scroll-source-ownership.test.mjs tests/architecture/stage-09-scroll-source-ownership.test.mjs
run_atomic r9-01 13 tests/stage-09-scroll-contract-freeze.test.mjs tests/architecture/stage-09-scroll-contract-freeze.test.mjs

node --test tests/stage-08*.test.mjs tests/architecture/stage-08*.test.mjs | tee /tmp/stage8.tap
grep -q '# tests 179' /tmp/stage8.tap
grep -q '# pass 179' /tmp/stage8.tap
grep -q '# fail 0' /tmp/stage8.tap

npm test | tee /tmp/node.tap
node_tests="$(awk '/^# tests /{v=$3} END{print v}' /tmp/node.tap)"
node_pass="$(awk '/^# pass /{v=$3} END{print v}' /tmp/node.tap)"
node_fail="$(awk '/^# fail /{v=$3} END{print v}' /tmp/node.tap)"
test "$node_tests" = '234'
test "$node_pass" = '234'
test "$node_fail" = '0'

npm run verify:architecture
npm run test:browser:contract | tee /tmp/browser-contract.log
grep -q 'Browser tests: 10, passed: 10, failed: 0' /tmp/browser-contract.log
npm run build
for attempt in 1 2; do
  npm run test:browser | tee "/tmp/built-app-${attempt}.log"
  grep -q 'Browser tests: 29, passed: 29, failed: 0' "/tmp/built-app-${attempt}.log"
done

cat > README.md <<EOF
# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-11：frozen selection mapping仅由model-kernel提供并以scoped capability注入旧同步层；移除window mapping全局，算法/接口未改，R9-12未启动。验证：R9-11 10/10；R9-10~R9-08 16/16；R9-07 15/15；R9-06 14/14；R9-05 16/16；R9-04 14/14；R9-03~R9-01 13/13；Stage8 179/179；Node ${node_tests}/${node_pass}；Architecture/Build PASS；Browser 10/10；Built-app 29/29×2；audit 0。
EOF
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap
git diff --check

python - <<'PY'
import subprocess
from pathlib import Path
baseline='69de06a8131d697f9bb62dd7b76fc332d596fe15'
allowed={
 'README.md',
 'public/app/scroll-sync.js',
 'src/features/sync/index.js',
 'src/main.js',
 'tests/architecture/fixtures/architecture-baseline.json',
 'tests/architecture/fixtures/production-modules.json',
 'tests/stage-09-frozen-selection-mapping-integration.test.mjs',
 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs',
 '.agent/r9_11_apply.py',
 '.agent/r9_11_validate.sh',
 '.github/workflows/r9-11-diagnostic.yml',
 '.github/workflows/r9-11-validation.yml',
}
changed=set(subprocess.check_output(['git','diff','--name-only',baseline],text=True).splitlines())
extra=changed-allowed
if extra:
    raise SystemExit(f'Unexpected R9-11 path: {sorted(extra)}')
required={
 'README.md','public/app/scroll-sync.js','src/features/sync/index.js','src/main.js',
 'tests/architecture/fixtures/architecture-baseline.json','tests/architecture/fixtures/production-modules.json',
 'tests/stage-09-frozen-selection-mapping-integration.test.mjs',
 'tests/architecture/stage-09-frozen-selection-mapping-integration.test.mjs'
}
missing=required-changed
if missing:
    raise SystemExit(f'Missing R9-11 expected changes: {sorted(missing)}')
PY

# Final guards: frozen algorithm untouched, R9-12 still pending.
git diff --quiet "$baseline" -- src/sync/selection-mapping.js src/model-kernel/index.js
grep -q 'buildNormalizedTextMap' public/app/scroll-sync.js
grep -q 'editor.value' public/app/scroll-sync.js
test ! -e src/features/sync/selection/selection-sync-controller.js
node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==381) process.exit(1)"

# Remove all runner-only artifacts before publishing the validated tree.
rm -f .agent/r9_11_apply.py .agent/r9_11_validate.sh .agent/r9_11_failure.log
rm -f "$validation_workflow" "$diagnostic_workflow"
git add -A -- .agent .github/workflows
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .
test -z "$(git diff --name-only "$baseline" -- .agent .github/workflows)"
test -z "$(git diff --cached --name-only "$baseline" -- .agent .github/workflows)"

git add README.md public/app/scroll-sync.js src/features/sync/index.js src/main.js tests

git status --short
GIT_AUTHOR_NAME='atomic-runner' GIT_AUTHOR_EMAIL='atomic-runner@users.noreply.github.com' \
GIT_COMMITTER_NAME='atomic-runner' GIT_COMMITTER_EMAIL='atomic-runner@users.noreply.github.com' \
  git commit -m 'refactor: complete R9-11 frozen selection mapping integration'

current_validated="$(git ls-remote origin "refs/heads/${validated_branch}" | awk '{print $1}')"
if [ -n "$current_validated" ]; then
  git push --force-with-lease="refs/heads/${validated_branch}:${current_validated}" origin HEAD:"refs/heads/${validated_branch}"
else
  git push origin HEAD:"refs/heads/${validated_branch}"
fi
