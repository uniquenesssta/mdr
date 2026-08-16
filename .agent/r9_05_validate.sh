#!/usr/bin/env bash
set -euo pipefail

baseline='5d2c939eba569f4fbcd30947888b9f3702e2994d'
actual="$(git ls-remote origin refs/heads/agent/r9-04-validated | awk '{print $1}')"
test "$actual" = "$baseline"
git merge-base --is-ancestor "$baseline" HEAD

python - <<'PY'
import subprocess
baseline = '5d2c939eba569f4fbcd30947888b9f3702e2994d'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
for path in changed:
    if path.startswith('.agent/r9_05_') or path == '.github/workflows/r9-05-validation.yml':
        continue
    raise SystemExit(f'Unexpected pre-validation change from R9-04 baseline: {path}')
PY

npm ci
npm audit --audit-level=high
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_05_apply.py
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_05_test_fix.py

git diff --check
test -e src/features/sync/scroll/preview-scroll-mapper.js
test -e tests/stage-09-preview-scroll-mapper.test.mjs
test -e tests/architecture/stage-09-preview-scroll-mapper.test.mjs
grep -q 'class PreviewScrollMapper' src/features/sync/scroll/preview-scroll-mapper.js
grep -q 'createPreviewScrollMapper' src/features/sync/index.js
grep -q 'markdownEditorPreviewScrollMapper' src/main.js
grep -q 'markdownEditorPreviewScrollMapper' public/app/scroll-sync.js
grep -q 'previewScrollMapper.getContentYForLine' public/app/scroll-sync.js
grep -q 'previewScrollMapper.getLineForContentY' public/app/scroll-sync.js
! grep -Eq 'previewAnchorsCache|previewAnchorMetricsCache|previewBodyResizeObserver|observedPreviewBody|previewBodyResizeTimer' public/app/core.js
! grep -Eq 'previewAnchorsCache|previewAnchorMetricsCache|previewBodyResizeObserver|observedPreviewBody|previewBodyResizeTimer|findLastMetricIndex' public/app/scroll-sync.js
! grep -Eq 'virtualEditor|editorApi|#editor|documentModel|CodeMirror|@codemirror|scheduleTarget|beginUserGesture|markProgrammaticScroll|ScrollSourceOwnership' src/features/sync/scroll/preview-scroll-mapper.js
for path in \
  src/features/sync/scroll/scroll-geometry-session.js \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/editor-selection-reader.js \
  src/features/sync/selection/preview-selection-reader.js \
  src/features/sync/selection/selection-highlight-session.js \
  src/features/sync/selection/selection-retry-scheduler.js \
  src/features/sync/selection/selection-feedback-guard.js; do
  test ! -e "$path"
done

test -z "$(git diff --name-only "$baseline" -- \
  package.json package-lock.json src-tauri \
  src/document/document-model.js \
  src/editor/hybrid/block-registry.js src/editor/hybrid/math-ranges.js src/editor/hybrid/ranges.js src/editor/hybrid/table-model.js \
  src/model-kernel src/features/preview \
  src/features/editor/infrastructure/codemirror-editor-adapter.js \
  src/features/sync/scroll/scroll-source-ownership.js \
  src/features/sync/scroll/scroll-sync-controller.js \
  src/features/sync/scroll/editor-scroll-mapper.js \
  src/sync/selection-controller.js src/sync/selection-mapping.js)"
node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==375) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/scroll/preview-scroll-mapper.js')?.[4]!=='preview-scroll-mapper-geometry-cache') process.exit(2)"
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

node --test tests/stage-09-preview-scroll-mapper.test.mjs | tee /tmp/r9-05-behavior.tap
grep -q '# tests 8' /tmp/r9-05-behavior.tap
grep -q '# pass 8' /tmp/r9-05-behavior.tap
grep -q '# fail 0' /tmp/r9-05-behavior.tap
node --test tests/architecture/stage-09-preview-scroll-mapper.test.mjs | tee /tmp/r9-05-architecture.tap
grep -q '# tests 8' /tmp/r9-05-architecture.tap
grep -q '# pass 8' /tmp/r9-05-architecture.tap
grep -q '# fail 0' /tmp/r9-05-architecture.tap

node --test tests/stage-09-editor-scroll-mapper.test.mjs | tee /tmp/r9-04-behavior.tap
grep -q '# tests 7' /tmp/r9-04-behavior.tap
grep -q '# pass 7' /tmp/r9-04-behavior.tap
grep -q '# fail 0' /tmp/r9-04-behavior.tap
node --test tests/architecture/stage-09-editor-scroll-mapper.test.mjs | tee /tmp/r9-04-architecture.tap
grep -q '# tests 7' /tmp/r9-04-architecture.tap
grep -q '# pass 7' /tmp/r9-04-architecture.tap
grep -q '# fail 0' /tmp/r9-04-architecture.tap

node --test tests/stage-09-scroll-controller.test.mjs | tee /tmp/r9-03-behavior.tap
grep -q '# tests 7' /tmp/r9-03-behavior.tap
grep -q '# pass 7' /tmp/r9-03-behavior.tap
grep -q '# fail 0' /tmp/r9-03-behavior.tap
node --test tests/architecture/stage-09-scroll-controller.test.mjs | tee /tmp/r9-03-architecture.tap
grep -q '# tests 6' /tmp/r9-03-architecture.tap
grep -q '# pass 6' /tmp/r9-03-architecture.tap
grep -q '# fail 0' /tmp/r9-03-architecture.tap

node --test tests/stage-09-scroll-source-ownership.test.mjs | tee /tmp/r9-02-behavior.tap
grep -q '# tests 7' /tmp/r9-02-behavior.tap
grep -q '# pass 7' /tmp/r9-02-behavior.tap
grep -q '# fail 0' /tmp/r9-02-behavior.tap
node --test tests/architecture/stage-09-scroll-source-ownership.test.mjs | tee /tmp/r9-02-architecture.tap
grep -q '# tests 6' /tmp/r9-02-architecture.tap
grep -q '# pass 6' /tmp/r9-02-architecture.tap
grep -q '# fail 0' /tmp/r9-02-architecture.tap

node --test tests/stage-09-scroll-contract-freeze.test.mjs | tee /tmp/r9-01-behavior.tap
grep -q '# tests 8' /tmp/r9-01-behavior.tap
grep -q '# pass 8' /tmp/r9-01-behavior.tap
grep -q '# fail 0' /tmp/r9-01-behavior.tap
node --test tests/architecture/stage-09-scroll-contract-freeze.test.mjs | tee /tmp/r9-01-architecture.tap
grep -q '# tests 5' /tmp/r9-01-architecture.tap
grep -q '# pass 5' /tmp/r9-01-architecture.tap
grep -q '# fail 0' /tmp/r9-01-architecture.tap

node --test tests/stage-08*.test.mjs tests/architecture/stage-08*.test.mjs | tee /tmp/stage-08.tap
grep -q '# tests 179' /tmp/stage-08.tap
grep -q '# pass 179' /tmp/stage-08.tap
grep -q '# fail 0' /tmp/stage-08.tap

npm test | tee /tmp/node.tap
node_tests="$(awk '/^# tests /{v=$3} END{print v}' /tmp/node.tap)"
node_pass="$(awk '/^# pass /{v=$3} END{print v}' /tmp/node.tap)"
node_fail="$(awk '/^# fail /{v=$3} END{print v}' /tmp/node.tap)"
test -n "$node_tests"
test "$node_tests" = "$node_pass"
test "$node_fail" = '0'
npm run verify:architecture
npm run test:browser:contract
npm run build

for attempt in 1 2; do
  echo "Built-app attempt $attempt"
  npm run test:browser | tee "/tmp/built-app-$attempt.log"
  grep -q 'Browser tests: 29, passed: 29, failed: 0' "/tmp/built-app-$attempt.log"
done

cat > README.md <<EOF
# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-05 / Stage 9：PreviewScrollMapper 已接管源码行↔预览 content Y 映射、anchor/metric cache 与 preview body 尺寸失效监听；虚拟模式仅消费 Preview Controller virtual height index，经典 scroll-sync 不再持有预览映射状态且 Preview Mapper 不查询 editor 内部；Geometry Session/Selection 尚未启动。验证：R9-05 16/16，R9-04 14/14，R9-03 13/13，R9-02 13/13，R9-01 13/13，Stage 8 179/179，Node ${node_tests}/${node_pass}，Architecture PASS，Browser contract 10/10，Build PASS，Built-app 29/29×2 PASS，audit 0。
EOF
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap

git diff --check
test -z "$(git diff --name-only "$baseline" -- \
  package.json package-lock.json src-tauri \
  src/document/document-model.js \
  src/editor/hybrid/block-registry.js src/editor/hybrid/math-ranges.js src/editor/hybrid/ranges.js src/editor/hybrid/table-model.js \
  src/model-kernel src/features/preview \
  src/features/editor/infrastructure/codemirror-editor-adapter.js \
  src/features/sync/scroll/scroll-source-ownership.js \
  src/features/sync/scroll/scroll-sync-controller.js \
  src/features/sync/scroll/editor-scroll-mapper.js \
  src/sync/selection-controller.js src/sync/selection-mapping.js)"

python - <<'PY'
from pathlib import Path
import subprocess
baseline = '5d2c939eba569f4fbcd30947888b9f3702e2994d'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
allowed = {
    'README.md',
    'public/app/core.js',
    'public/app/scroll-sync.js',
    'src/features/sync/index.js',
    'src/features/sync/scroll/preview-scroll-mapper.js',
    'src/main.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-09-preview-scroll-mapper.test.mjs',
    'tests/architecture/stage-09-preview-scroll-mapper.test.mjs',
    'tests/architecture/stage-09-editor-scroll-mapper.test.mjs',
    'tests/architecture/stage-09-scroll-controller.test.mjs',
    'tests/architecture/stage-09-scroll-source-ownership.test.mjs',
    'tests/architecture/stage-09-scroll-contract-freeze.test.mjs',
}
for path in changed:
    if path.startswith('.agent/r9_05_') or path == '.github/workflows/r9-05-validation.yml':
        continue
    if path in allowed:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        try:
            old = subprocess.check_output(['git', 'show', f'{baseline}:{path}'], text=True)
        except subprocess.CalledProcessError:
            raise SystemExit(f'Unexpected new historical test: {path}')
        new = Path(path).read_text(encoding='utf-8')
        normalized = new.replace('inventory.modules.length, 375', 'inventory.modules.length, 374')
        normalized = normalized.replace('moduleFixture.modules.length, 375', 'moduleFixture.modules.length, 374')
        if normalized == old:
            continue
    raise SystemExit(f'Unexpected R9-05 path or non-cardinality historical edit: {path}')
PY

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==375) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/scroll/preview-scroll-mapper.js')?.[4]!=='preview-scroll-mapper-geometry-cache') process.exit(2)"
grep -q 'R9-05 / Stage 9' README.md
grep -q 'R9-05 16/16' README.md
grep -q 'R9-04 14/14' README.md
grep -q 'R9-03 13/13' README.md
grep -q 'R9-02 13/13' README.md
grep -q 'R9-01 13/13' README.md
grep -q 'Stage 8 179/179' README.md
grep -q "Node ${node_tests}/${node_pass}" README.md
grep -q 'Browser contract 10/10' README.md
grep -q 'Built-app 29/29×2 PASS' README.md
grep -q 'audit 0' README.md
! grep -Eq 'previewAnchorsCache|previewAnchorMetricsCache|previewBodyResizeObserver|observedPreviewBody|previewBodyResizeTimer' public/app/core.js
! grep -Eq 'previewAnchorsCache|previewAnchorMetricsCache|previewBodyResizeObserver|observedPreviewBody|previewBodyResizeTimer|findLastMetricIndex' public/app/scroll-sync.js
for path in \
  src/features/sync/scroll/scroll-geometry-session.js \
  src/features/sync/selection/selection-sync-controller.js; do
  test ! -e "$path"
done
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

rm -f .agent/r9_05_* .github/workflows/r9-05-validation.yml

git config user.name atomic-runner
git config user.email atomic-runner@users.noreply.github.com
git add -A
git diff --cached --check
git commit -m 'refactor: complete R9-05 preview scroll mapper'
git push --force origin HEAD:agent/r9-05-validated
