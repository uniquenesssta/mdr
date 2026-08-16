#!/usr/bin/env bash
set -euo pipefail

baseline='6899fda36270a2092d9fab796e37c05f41846717'
validated_branch='agent/r9-10-validated'
workflow_path='.github/workflows/r9-10-validation.yml'

remote_baseline="$(git ls-remote origin refs/heads/agent/r9-09-validated | awk '{print $1}')"
test "$remote_baseline" = "$baseline"

python - <<'PY'
import subprocess
baseline='6899fda36270a2092d9fab796e37c05f41846717'
allowed={'.agent/r9_10_validate.sh','.github/workflows/r9-10-validation.yml',*(f'.agent/r9_10_apply.part{i}' for i in range(1,6))}
changed=set(subprocess.check_output(['git','diff','--name-only',baseline],text=True).splitlines())
extra=changed-allowed
if extra:
    raise SystemExit(f'runner contains unexpected pre-apply paths: {sorted(extra)}')
PY

npm ci
npm audit --audit-level=high | tee /tmp/r9-10-audit.log
grep -q 'found 0 vulnerabilities' /tmp/r9-10-audit.log

cat .agent/r9_10_apply.part{1,2,3,4,5} > /tmp/r9_10_apply.py
PYTHONDONTWRITEBYTECODE=1 python -m py_compile /tmp/r9_10_apply.py
PYTHONDONTWRITEBYTECODE=1 python /tmp/r9_10_apply.py
git diff --check

test -f src/features/sync/selection/selection-retry-scheduler.js
test -f tests/stage-09-selection-retry-scheduler.test.mjs
test -f tests/architecture/stage-09-selection-retry-scheduler.test.mjs
test ! -e src/features/sync/selection/selection-sync-controller.js
for path in \
  package.json package-lock.json \
  src/document/document-model.js \
  src/sync/selection-mapping.js \
  src/features/sync/selection/editor-selection-reader.js \
  src/features/sync/selection/preview-selection-reader.js \
  src/features/sync/selection/selection-feedback-guard.js \
  src/features/sync/selection/selection-highlight-session.js \
  src/features/sync/scroll/scroll-source-ownership.js \
  src/features/sync/scroll/scroll-sync-controller.js \
  src/features/sync/scroll/editor-scroll-mapper.js \
  src/features/sync/scroll/preview-scroll-mapper.js \
  src/features/sync/scroll/scroll-geometry-session.js; do
  git diff --quiet "$baseline" -- "$path"
done
! git diff --name-only "$baseline" -- src-tauri | grep -q .
! git diff --name-only "$baseline" -- src/features/preview | grep -q .
! git diff --name-only "$baseline" -- src/features/hybrid-editor | grep -q .

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==381) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-retry-scheduler.js')?.[4]!=='selection-retry-scheduler-lifecycle') process.exit(2)"

run_atomic() {
  local label="$1" expected="$2"; shift 2
  local log="/tmp/${label}.tap"
  node --test "$@" | tee "$log"
  grep -q "# tests ${expected}" "$log"
  grep -q "# pass ${expected}" "$log"
  grep -q '# fail 0' "$log"
}

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
test "$node_tests" = '224'
test "$node_pass" = '224'
test "$node_fail" = '0'

npm run verify:architecture
npm run test:browser:contract | tee /tmp/browser-contract.log
grep -q 'Browser tests: 10, passed: 10, failed: 0' /tmp/browser-contract.log
npm run build

for attempt in 1 2; do
  echo "Built-app attempt $attempt"
  npm run test:browser | tee "/tmp/built-app-$attempt.log"
  grep -q 'Browser tests: 29, passed: 29, failed: 0' "/tmp/built-app-$attempt.log"
done

cat > README.md <<EOF_README
# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-10：RetryScheduler接管虚拟选区可恢复重试的RAF、次数/version及旧任务取消；仅pending重试，R9-11+未启动。验证：R9-10 16/16，R9-09/R9-08 16/16，R9-07 15/15，R9-06 14/14，R9-05 16/16，R9-04 14/14，R9-03~R9-01 13/13，Stage8 179/179，Node ${node_tests}/${node_pass}，Architecture/Build PASS，Browser 10/10，Built-app 29/29×2，audit 0。
EOF_README
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap
git diff --check

python - <<'PY'
import subprocess
from pathlib import Path
baseline='6899fda36270a2092d9fab796e37c05f41846717'
explicit={
 'README.md','public/app/scroll-sync.js','src/features/sync/index.js',
 'src/features/sync/selection/selection-retry-scheduler.js','src/main.js','src/sync/selection-controller.js',
 'tests/architecture/fixtures/production-modules.json',
 'tests/stage-09-selection-retry-scheduler.test.mjs',
 'tests/architecture/stage-09-selection-retry-scheduler.test.mjs',
 '.github/workflows/r9-10-validation.yml'
}
def baseline_text(path):
    return subprocess.check_output(['git','show',f'{baseline}:{path}'],text=True,stderr=subprocess.DEVNULL)
def normalized(path):
    text=baseline_text(path)
    text=text.replace("  'src/features/sync/selection/selection-retry-scheduler.js',\n",'')
    text=text.replace("  'src/features/sync/selection/selection-retry-scheduler.js'\n",'')
    text=text.replace('does not advance R9-10+','does not advance R9-11+')
    lines=[]
    for line in text.splitlines(keepends=True):
        if 'modules.length' in line and '380' in line:
            line=line.replace('380','381')
        lines.append(line)
    text=''.join(lines)
    if path.endswith('stage-09-selection-feedback-guard.test.mjs'):
        text=text.replace(
            "    highlightSession: { restore() { return false; }, clear() {} }\n  }).configure({ syncPreviewToEditor",
            "    highlightSession: { restore() { return false; }, clear() {} },\n    retryScheduler: { schedule() { return false; }, cancel() {} }\n  }).configure({ syncPreviewToEditor"
        )
        text=text.replace(
            "    highlightSession: { restore() { return false; }, clear() {} }\n  });\n  const token = guard.begin('editor');",
            "    highlightSession: { restore() { return false; }, clear() {} },\n    retryScheduler: { schedule() { return false; }, cancel() {} }\n  });\n  const token = guard.begin('editor');"
        )
    if path.endswith('stage-09-selection-highlight-session.test.mjs'):
        text=text.replace('cardinality 380','cardinality 381 after R9-10 inventory growth')
    return text
changed=subprocess.check_output(['git','diff','--name-only',baseline],text=True).splitlines()
for path in changed:
    if path.startswith('.agent/r9_10_'):
        continue
    if path in explicit:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        try:
            expected=normalized(path)
        except subprocess.CalledProcessError:
            raise SystemExit(f'unexpected new historical test: {path}')
        actual=Path(path).read_text(encoding='utf-8')
        if actual==expected:
            continue
    raise SystemExit(f'Unexpected R9-10 path or non-mechanical historical edit: {path}')
PY

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==381) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-retry-scheduler.js')?.[4]!=='selection-retry-scheduler-lifecycle') process.exit(2)"
grep -q 'R9-10 16/16' README.md
grep -q 'Stage8 179/179' README.md
grep -q "Node ${node_tests}/${node_pass}" README.md
grep -q 'Built-app 29/29×2' README.md
test ! -e src/features/sync/selection/selection-sync-controller.js
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

git checkout "$baseline" -- "$workflow_path" 2>/dev/null || rm -f "$workflow_path"
rm -f .agent/r9_10_apply.part{1,2,3,4,5} .agent/r9_10_validate.sh .agent/r9_10_failure.log
git add -A -- "$workflow_path"
git add -A -- .agent 2>/dev/null || true
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .
git diff --check

test -z "$(git diff --name-only "$baseline" -- .agent .github/workflows)"
test -z "$(git diff --cached --name-only "$baseline" -- .agent .github/workflows)"

git add README.md public/app/scroll-sync.js src/features/sync/index.js \
  src/features/sync/selection/selection-retry-scheduler.js src/main.js src/sync/selection-controller.js \
  tests/architecture/fixtures/production-modules.json tests

git status --short
GIT_AUTHOR_NAME='atomic-runner' GIT_AUTHOR_EMAIL='atomic-runner@users.noreply.github.com' \
GIT_COMMITTER_NAME='atomic-runner' GIT_COMMITTER_EMAIL='atomic-runner@users.noreply.github.com' \
  git commit -m 'refactor: complete R9-10 selection retry scheduler'

current_validated="$(git ls-remote origin "refs/heads/${validated_branch}" | awk '{print $1}')"
if [ -n "$current_validated" ]; then
  git push --force-with-lease="refs/heads/${validated_branch}:${current_validated}" origin HEAD:"refs/heads/${validated_branch}"
else
  git push origin HEAD:"refs/heads/${validated_branch}"
fi
