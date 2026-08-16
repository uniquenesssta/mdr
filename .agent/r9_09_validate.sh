#!/usr/bin/env bash
set -euo pipefail

baseline='7bd768de832b700e4ec25a4a676c00f05fa38c8d'
validated_branch='agent/r9-09-validated'
workflow_path='.github/workflows/stage-07-atomic.yml'

actual="$(git ls-remote origin refs/heads/agent/r9-08-validated | awk '{print $1}')"
test "$actual" = "$baseline"
git merge-base --is-ancestor "$baseline" HEAD

python - <<'PY'
import subprocess
baseline = '7bd768de832b700e4ec25a4a676c00f05fa38c8d'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
for path in changed:
    if path.startswith('.agent/r9_09_'):
        continue
    if path == '.github/workflows/stage-07-atomic.yml':
        continue
    raise SystemExit(f'Unexpected pre-validation change from R9-08 baseline: {path}')
PY

npm ci
npm audit --audit-level=high
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_09_apply.py

git diff --check

test -e src/features/sync/selection/selection-highlight-session.js
test -e tests/stage-09-selection-highlight-session.test.mjs
test -e tests/architecture/stage-09-selection-highlight-session.test.mjs
grep -q 'class SelectionHighlightSession' src/features/sync/selection/selection-highlight-session.js
grep -q 'createSelectionHighlightSession' src/features/sync/index.js
grep -q 'R9-09' src/features/sync/index.js
grep -q "HIGHLIGHT_NAME = 'preview-selection-sync'" src/features/sync/selection/selection-highlight-session.js
grep -q 'this.restoreFactory' src/features/sync/selection/selection-highlight-session.js
grep -q 'clearEffects()' src/features/sync/selection/selection-highlight-session.js
! grep -Eq 'selectionMapping|markdownEditorDocumentModel|editor\.value|createPreviewRangesForSourceSelection|mapPreviewDomPointToSource|setTimeout|requestAnimationFrame|addEventListener|scrollTo|feedbackGuard' src/features/sync/selection/selection-highlight-session.js

grep -q 'markdownEditorSelectionHighlightSession' public/app/scroll-sync.js
grep -q 'selectionHighlightSession.canPresent' public/app/scroll-sync.js
grep -q 'selectionHighlightSession.show' public/app/scroll-sync.js
grep -q 'selectionHighlightSession.clear()' public/app/scroll-sync.js
! grep -Eq 'CSS\.highlights|new Highlight\(|preview-atomic-selection-highlight|preview-text-highlight|preview-source-highlight' public/app/scroll-sync.js

grep -q 'highlightMappedSourceRangeInPreview' public/app/scroll-sync.js
grep -q 'createPreviewRangesForSourceSelection' public/app/scroll-sync.js
grep -q 'mapPreviewDomPointToSource' public/app/scroll-sync.js

grep -q 'markdownEditorSelectionHighlightSession = selectionHighlightSession' src/main.js
grep -q 'highlightSession: selectionHighlightSession' src/main.js
grep -q 'selectionHighlightSession.destroy()' src/main.js
! grep -q 'window.markdownEditorSelectionHighlightSession' src/main.js
grep -q 'this.highlightSession.restore()' src/sync/selection-controller.js
grep -q 'this.highlightSession.clear()' src/sync/selection-controller.js

for path in \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/selection-retry-scheduler.js; do
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
  src/features/sync/selection/editor-selection-reader.js \
  src/features/sync/selection/preview-selection-reader.js \
  src/features/sync/selection/selection-feedback-guard.js \
  src/sync/selection-mapping.js)"

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==380) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-highlight-session.js')?.[4]!=='selection-highlight-session-lifecycle') process.exit(2)"
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

node --test tests/stage-09-selection-highlight-session.test.mjs | tee /tmp/r9-09-behavior.tap
grep -q '# tests 8' /tmp/r9-09-behavior.tap
grep -q '# pass 8' /tmp/r9-09-behavior.tap
grep -q '# fail 0' /tmp/r9-09-behavior.tap
node --test tests/architecture/stage-09-selection-highlight-session.test.mjs | tee /tmp/r9-09-architecture.tap
grep -q '# tests 8' /tmp/r9-09-architecture.tap
grep -q '# pass 8' /tmp/r9-09-architecture.tap
grep -q '# fail 0' /tmp/r9-09-architecture.tap

node --test tests/stage-09-selection-feedback-guard.test.mjs | tee /tmp/r9-08-behavior.tap
grep -q '# tests 8' /tmp/r9-08-behavior.tap
grep -q '# pass 8' /tmp/r9-08-behavior.tap
grep -q '# fail 0' /tmp/r9-08-behavior.tap
node --test tests/architecture/stage-09-selection-feedback-guard.test.mjs | tee /tmp/r9-08-architecture.tap
grep -q '# tests 8' /tmp/r9-08-architecture.tap
grep -q '# pass 8' /tmp/r9-08-architecture.tap
grep -q '# fail 0' /tmp/r9-08-architecture.tap

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

R9-09：SelectionHighlightSession 接管 CSS Highlight 多 Range、原子/文本 fallback、remount 恢复与 clear/destroy；R9-10+ 未启动。验证：R9-09 16/16；R9-08 16/16；R9-07 15/15；R9-06 14/14；R9-05 16/16；R9-04 14/14；R9-03~R9-01 13/13；Stage8 179/179；Node ${node_tests}/${node_pass}；Architecture/Build PASS；Browser 10/10；Built-app 29/29×2；audit 0。
EOF
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap

git diff --check

python - <<'PY'
import subprocess
from pathlib import Path

baseline = '7bd768de832b700e4ec25a4a676c00f05fa38c8d'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
explicit = {
    'README.md',
    'public/app/scroll-sync.js',
    'src/features/sync/index.js',
    'src/features/sync/selection/selection-highlight-session.js',
    'src/main.js',
    'src/sync/selection-controller.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-09-selection-highlight-session.test.mjs',
    'tests/architecture/stage-09-selection-highlight-session.test.mjs',
    '.github/workflows/stage-07-atomic.yml',
}

def baseline_text(path):
    return subprocess.check_output(['git', 'show', f'{baseline}:{path}'], text=True)

def normalized_historical(path):
    text = baseline_text(path)
    text = text.replace("  'src/features/sync/selection/selection-highlight-session.js',\n", '')
    lines = []
    for line in text.splitlines(keepends=True):
        if '379' in line and ('modules.length' in line or 'inventory.modules.length' in line):
            line = line.replace('379', '380')
        lines.append(line)
    text = ''.join(lines)
    if path.endswith('stage-09-selection-feedback-guard.test.mjs'):
        text = text.replace('does not advance R9-09+', 'does not advance R9-10+')
        text = text.replace('cardinality 379', 'cardinality 380 after R9-09 inventory growth')
    return text

for path in changed:
    if path.startswith('.agent/r9_09_'):
        continue
    if path in explicit:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        expected = normalized_historical(path)
        actual = Path(path).read_text(encoding='utf-8')
        if actual == expected:
            continue
    raise SystemExit(f'Unexpected R9-09 path or non-mechanical historical edit: {path}')
PY

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==380) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-highlight-session.js')?.[4]!=='selection-highlight-session-lifecycle') process.exit(2)"
grep -q 'R9-09' README.md
grep -q 'R9-09 16/16' README.md
grep -q 'R9-08 16/16' README.md
grep -q 'Stage8 179/179' README.md
grep -q "Node ${node_tests}/${node_pass}" README.md
grep -q 'Built-app 29/29×2' README.md
for path in \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/selection-retry-scheduler.js; do
  test ! -e "$path"
done
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

# Restore permanent workflow to the validated R9-08 bytes and stage all temporary-file deletions before publishing.
git checkout "$baseline" -- "$workflow_path"
rm -f .agent/r9_09_apply.py .agent/r9_09_validate.sh .agent/r9_09_failure.log
git add -A -- .agent "$workflow_path"
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .
git diff --check

test -z "$(git diff --name-only "$baseline" -- .agent .github/workflows)"
test -z "$(git diff --cached --name-only "$baseline" -- .agent .github/workflows)"

git add README.md public/app/scroll-sync.js src/features/sync/index.js \
  src/features/sync/selection/selection-highlight-session.js src/main.js src/sync/selection-controller.js \
  tests/architecture/fixtures/production-modules.json tests/stage-09-selection-highlight-session.test.mjs \
  tests/architecture/stage-09-selection-highlight-session.test.mjs tests

git status --short
GIT_AUTHOR_NAME='atomic-runner' GIT_AUTHOR_EMAIL='atomic-runner@users.noreply.github.com' \
GIT_COMMITTER_NAME='atomic-runner' GIT_COMMITTER_EMAIL='atomic-runner@users.noreply.github.com' \
  git commit -m 'refactor: complete R9-09 selection highlight session'

current_validated="$(git ls-remote origin "refs/heads/${validated_branch}" | awk '{print $1}')"
if [ -n "$current_validated" ]; then
  git push --force-with-lease="refs/heads/${validated_branch}:${current_validated}" origin HEAD:"refs/heads/${validated_branch}"
else
  git push origin HEAD:"refs/heads/${validated_branch}"
fi
