#!/usr/bin/env bash
set -euo pipefail

baseline='f8ee43b73a46b9a1b51a3513b5d15132f58db415'
actual="$(git ls-remote origin refs/heads/agent/r9-06-validated | awk '{print $1}')"
test "$actual" = "$baseline"
git merge-base --is-ancestor "$baseline" HEAD

python - <<'PY'
import subprocess
baseline = 'f8ee43b73a46b9a1b51a3513b5d15132f58db415'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
for path in changed:
    if path.startswith('.agent/r9_07_'):
        continue
    if path in {'.github/workflows/r9-07-diagnostic.yml', '.github/workflows/r9-07-validation.yml'}:
        continue
    raise SystemExit(f'Unexpected pre-validation change from R9-06 baseline: {path}')
PY

npm ci
npm audit --audit-level=high
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_07_apply.py

git diff --check

test -e src/features/sync/selection/editor-selection-reader.js
test -e src/features/sync/selection/preview-selection-reader.js
test -e tests/stage-09-selection-readers.test.mjs
test -e tests/architecture/stage-09-selection-readers.test.mjs
grep -q 'class EditorSelectionReader' src/features/sync/selection/editor-selection-reader.js
grep -q 'class PreviewSelectionReader' src/features/sync/selection/preview-selection-reader.js
grep -q 'createEditorSelectionReader' src/features/sync/index.js
grep -q 'createPreviewSelectionReader' src/features/sync/index.js
grep -q 'R9-04' src/features/sync/index.js
grep -q 'R9-05' src/features/sync/index.js
grep -q 'R9-06' src/features/sync/index.js
grep -q 'R9-07' src/features/sync/index.js

# Exact R9-07 authority checks.
! grep -Eq 'document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionStart|selectionEnd|selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|sliceText|\.value\b' src/features/sync/selection/editor-selection-reader.js
! grep -Eq 'window\.|globalThis\.|selectionMapping|highlight|feedback|retry|scrollTo|scheduleTarget|markProgrammaticScroll|ScrollSourceOwnership' src/features/sync/selection/preview-selection-reader.js
grep -q "addEventListener('selectionchange'" src/features/sync/selection/preview-selection-reader.js
grep -q "addEventListener('pointerdown'" src/features/sync/selection/preview-selection-reader.js
grep -q "addEventListener('pointerup'" src/features/sync/selection/preview-selection-reader.js
! grep -Eq 'window\.getSelection|selectionStart|selectionEnd|selectionInside\(|previewPointerActive|previewSelectionDirty|addEventListener\(.selectionchange|removeEventListener\(.selectionchange' src/sync/selection-controller.js
! grep -Eq 'editor\.selectionStart|editor\.selectionEnd|window\.getSelection|document\.getSelection' public/app/scroll-sync.js
grep -q 'markdownEditorEditorSelectionReader' src/main.js
grep -q 'markdownEditorPreviewSelectionReader' src/main.js
grep -q 'editorSelectionReader' src/sync/selection-controller.js
grep -q 'previewSelectionReader' src/sync/selection-controller.js

# Later Atomics must remain absent; frozen mapping and prior Stage 9 scroll implementations must be byte-identical.
for path in \
  src/features/sync/selection/selection-sync-controller.js \
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
  src/features/sync/scroll/preview-scroll-mapper.js \
  src/features/sync/scroll/scroll-geometry-session.js \
  src/sync/selection-mapping.js)"

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==378) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/editor-selection-reader.js')?.[4]!=='editor-selection-reader-lifecycle') process.exit(2); if(m.get('src/features/sync/selection/preview-selection-reader.js')?.[4]!=='preview-selection-stability-session') process.exit(3)"
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

node --test tests/stage-09-selection-readers.test.mjs | tee /tmp/r9-07-behavior.tap
grep -q '# tests 7' /tmp/r9-07-behavior.tap
grep -q '# pass 7' /tmp/r9-07-behavior.tap
grep -q '# fail 0' /tmp/r9-07-behavior.tap
node --test tests/architecture/stage-09-selection-readers.test.mjs | tee /tmp/r9-07-architecture.tap
grep -q '# tests 8' /tmp/r9-07-architecture.tap
grep -q '# pass 8' /tmp/r9-07-architecture.tap
grep -q '# fail 0' /tmp/r9-07-architecture.tap

node --test tests/stage-09-scroll-geometry-session.test.mjs | tee /tmp/r9-06-behavior.tap
grep -q '# tests 7' /tmp/r9-06-behavior.tap
grep -q '# pass 7' /tmp/r9-06-behavior.tap
grep -q '# fail 0' /tmp/r9-06-behavior.tap
node --test tests/architecture/stage-09-scroll-geometry-session.test.mjs | tee /tmp/r9-06-architecture.tap
grep -q '# tests 7' /tmp/r9-06-architecture.tap
grep -q '# pass 7' /tmp/r9-06-architecture.tap
grep -q '# fail 0' /tmp/r9-06-architecture.tap

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
npm run test:browser:contract | tee /tmp/browser-contract.log
grep -Eq '10[^0-9]+10|10/10|passed: 10' /tmp/browser-contract.log
npm run build

for attempt in 1 2; do
  echo "Built-app attempt $attempt"
  npm run test:browser | tee "/tmp/built-app-$attempt.log"
  grep -q 'Browser tests: 29, passed: 29, failed: 0' "/tmp/built-app-$attempt.log"
done

cat > README.md <<EOF
# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-07 / Stage 9：EditorSelectionReader 与 PreviewSelectionReader 已接管最终编辑器/预览选区边界读取，Preview Reader 独立拥有 selectionchange 与指针选区稳定等待；旧 SelectionSyncController/经典映射仅消费 Reader 快照，不再直接读取 selectionStart/end 或 window.getSelection；Feedback Guard、Highlight Session、Retry Scheduler 与 Selection Controller 正式迁移尚未启动，既有用户行为保持。验证：R9-07 15/15，R9-06 14/14，R9-05 16/16，R9-04 14/14，R9-03~R9-01 13/13，Stage 8 179/179，Node ${node_tests}/${node_pass}，Architecture/Build PASS，Browser contract 10/10，Built-app 29/29×2 PASS，audit 0。
EOF
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap

git diff --check

# Scope audit: explicit R9-07 production paths/new tests plus mechanical historical cardinality/later-file assertions only.
python - <<'PY'
from pathlib import Path
import subprocess
baseline = 'f8ee43b73a46b9a1b51a3513b5d15132f58db415'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
explicit = {
    'README.md',
    'src/features/sync/index.js',
    'src/features/sync/selection/editor-selection-reader.js',
    'src/features/sync/selection/preview-selection-reader.js',
    'src/sync/selection-controller.js',
    'src/main.js',
    'public/app/scroll-sync.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-09-selection-readers.test.mjs',
    'tests/architecture/stage-09-selection-readers.test.mjs',
}
for path in changed:
    if path.startswith('.agent/r9_07_'):
        continue
    if path in {'.github/workflows/r9-07-diagnostic.yml', '.github/workflows/r9-07-validation.yml'}:
        continue
    if path in explicit:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        diff = subprocess.check_output(['git', 'diff', '--unified=0', baseline, '--', path], text=True).splitlines()
        edits = [line for line in diff if line.startswith(('+', '-')) and not line.startswith(('+++', '---'))]
        allowed_tokens = ('editor-selection-reader.js', 'preview-selection-reader.js', 'modules.length, 376', 'modules.length, 378')
        if edits and all(any(token in line for token in allowed_tokens) for line in edits):
            continue
    raise SystemExit(f'Unexpected R9-07 path or non-mechanical historical edit: {path}')
PY

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==378) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/editor-selection-reader.js')?.[4]!=='editor-selection-reader-lifecycle') process.exit(2); if(m.get('src/features/sync/selection/preview-selection-reader.js')?.[4]!=='preview-selection-stability-session') process.exit(3)"
grep -q 'R9-07 / Stage 9' README.md
grep -q 'R9-07 15/15' README.md
grep -q 'R9-06 14/14' README.md
grep -q 'R9-05 16/16' README.md
grep -q 'R9-04 14/14' README.md
grep -q 'R9-03~R9-01 13/13' README.md
grep -q 'Stage 8 179/179' README.md
grep -q "Node ${node_tests}/${node_pass}" README.md
grep -q 'Browser contract 10/10' README.md
grep -q 'Built-app 29/29×2 PASS' README.md
grep -q 'audit 0' README.md
for path in \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/selection-highlight-session.js \
  src/features/sync/selection/selection-retry-scheduler.js \
  src/features/sync/selection/selection-feedback-guard.js; do
  test ! -e "$path"
done
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

rm -f .agent/r9_07_* .github/workflows/r9-07-diagnostic.yml .github/workflows/r9-07-validation.yml

git config user.name atomic-runner
git config user.email atomic-runner@users.noreply.github.com
git add -A
git diff --cached --check
git commit -m 'refactor: complete R9-07 selection readers'
git push --force origin HEAD:agent/r9-07-validated
